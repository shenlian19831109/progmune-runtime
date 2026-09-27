"use strict";
/**
 * Phase 12: Agent 操作级安全层 (P5 v1) —— 沙箱 + 审批门
 *
 * 设计文档 P5 决策结果：DSH（deepseek-harness）不可验证/不存在，
 * 按「独立立项」自建最小可用集：
 *
 *   读（read）   → 自动
 *   写（write）  → 必须经验证门（execute 的 8 门 + 编译/指纹；巡逻报告走 FsSandbox 白名单）
 *   跑 shell（exec）    → 审批门（交互确认或 --yes）
 *   提交（commit）      → 审批门（本版默认拒绝，需显式 --approve-commit）
 *
 * 修复信任悖论：自动修复/自动合并 = 永不（autoApplied 恒 false，由 agent-patrol 保证）。
 * 每次权限决策产出审计事件，供 loop/patrol 审计轨迹复用。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRESET_AGENT = exports.PRESET_PATROL = void 0;
exports.checkSandboxWrite = checkSandboxWrite;
exports.decidePermission = decidePermission;
exports.interactiveConfirm = interactiveConfirm;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ── Presets ──
exports.PRESET_PATROL = {
    read: "auto",
    write: "sandbox", // 只允许 .progmune_* 报告文件
    exec: "deny", // 巡逻不执行 shell
    commit: "deny",
};
exports.PRESET_AGENT = {
    read: "auto",
    // 写文件的安全由 execute 内置验证门保证（8 门 + SSG + 编译/指纹，免疫门在环内）——
    // 权限层不重复设门，避免双重审批拖垮自主循环。
    write: "auto",
    exec: "approve", // 跑测试等 shell 操作需审批（--yes 或交互确认）
    commit: "deny", // P5 v1 不自动 commit
};
function presetOf(name) {
    return name === "patrol" ? exports.PRESET_PATROL : exports.PRESET_AGENT;
}
// ── FsSandbox ──
/** 巡逻报告等产品文件白名单（相对项目根） */
const SANDBOX_ALLOWED_FILES = new Set([".progmune_patrol_report.md", ".progmune_patrol_report.json"]);
/** 判断目标路径是否在项目目录内。 */
function isInsideProject(projectPath, target) {
    const absProject = path.resolve(projectPath);
    const absTarget = path.resolve(target);
    return absTarget === absProject || absTarget.startsWith(absProject + path.sep);
}
/**
 * 沙箱写判定：仅允许项目内 + 白名单文件。
 */
function checkSandboxWrite(ctx) {
    const absProject = path.resolve(ctx.projectPath);
    const rel = path.relative(absProject, path.resolve(ctx.target));
    const allowed = isInsideProject(absProject, ctx.target) && SANDBOX_ALLOWED_FILES.has(rel.replace(/\\/g, "/"));
    return {
        allowed,
        level: "write",
        detail: allowed
            ? `sandbox: 项目内白名单文件 ${rel}`
            : `sandbox: 拒绝写入 ${rel}（不在白名单或超出项目边界）`,
        audit: { event: "permission:sandbox", detail: allowed ? `allow write ${rel}` : `deny write ${rel}` },
    };
}
// ── Decision Engine ──
/**
 * 按预设判定一次操作。规则：
 *   auto    → 允许
 *   sandbox → FsSandbox 白名单判定
 *   approve → 审批门（preApproved 或交互确认）
 *   deny    → 拒绝
 */
function decidePermission(preset, ctx, confirmFn) {
    const mode = presetOf(preset)[ctx.level];
    if (mode === "auto") {
        return {
            allowed: true,
            level: ctx.level,
            detail: `auto: ${ctx.level} ${ctx.target}`,
            audit: { event: "permission:auto", detail: `${ctx.level} ${ctx.target}` },
        };
    }
    if (mode === "sandbox") {
        return checkSandboxWrite(ctx);
    }
    if (mode === "approve") {
        const prompt = `审批请求: ${ctx.level} → ${ctx.target}`;
        const approved = ctx.preApproved === true || (confirmFn ? confirmFn(prompt) : false);
        return {
            allowed: approved,
            level: ctx.level,
            detail: approved ? `approve: ${ctx.level} ${ctx.target}` : `审批未通过: ${ctx.level} ${ctx.target}`,
            audit: { event: "permission:approve", detail: approved ? `approved ${ctx.level} ${ctx.target}` : `denied ${ctx.level} ${ctx.target}` },
        };
    }
    return {
        allowed: false,
        level: ctx.level,
        detail: `deny: ${ctx.level} ${ctx.target}（P5 v1 默认拒绝，需显式升级预设）`,
        audit: { event: "permission:deny", detail: `${ctx.level} ${ctx.target}` },
    };
}
// ── Interactive confirm (TTY) ──
/** 交互确认：读 stdin 一行，y/yes 为同意。无 TTY 时返回 false。 */
function interactiveConfirm(prompt) {
    if (!process.stdin.isTTY)
        return false;
    const fd = fs.openSync("/dev/tty", "r"); // 直读 tty，绕过管道 stdin
    try {
        process.stdout.write(`${prompt} [y/N] `);
        const buf = Buffer.alloc(16);
        const n = fs.readSync(fd, buf, 0, 16, null);
        const answer = buf.toString("utf-8", 0, n).trim().toLowerCase();
        return answer === "y" || answer === "yes";
    }
    catch {
        return false;
    }
    finally {
        try {
            fs.closeSync(fd);
        }
        catch { /* ignore */ }
    }
}
