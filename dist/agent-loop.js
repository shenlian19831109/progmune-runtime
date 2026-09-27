"use strict";
/**
 * Phase 12: Agent Loop Controller (P1)
 *
 * Progmune Agent 最小闭环 —— 免疫门在环内的自主实现循环。
 *
 * Loop:
 *   intent → 目标分解(GoalPlanner) → execute()（plan→8门验证→SSG修复→emit→写盘+指纹）
 *         → verifyCompiles / verifyFileMarker（写盘后验证门）
 *         → 失败反馈注入 → 重试(≤maxRetries) → 迭代(≤maxIterations)
 *         → 成功输出带指纹 diff + 完整审计轨迹
 *
 * 铁律（Agent 化设计文档 v1.1）：
 *   1. 验证门必须在环内 —— 写盘前已过 plan/emit 内验证，写盘后再过编译+指纹门；
 *   2. 违规优先确定性修复（execute 内 SSG 修复），其次 LLM 重试，最后明确降级；
 *   3. 失败反馈必须注入下一次尝试 —— 不静默重试同一输入。
 *
 * 设计文档里程碑 M1 验收：
 *   progmune agent "实现 XX" → 全程过验证门 → 编译通过 → 输出带指纹 diff；
 *   失败注入重试 ≤3；审计轨迹完整。
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
exports.computeDiff = computeDiff;
exports.runAgentLoop = runAgentLoop;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const execute_1 = require("./execute");
const goal_planner_1 = require("./goal-planner");
const agent_perception_1 = require("./agent-perception");
const agent_supervision_1 = require("./agent-supervision");
const agent_permissions_1 = require("./agent-permissions");
// ── Helpers ──
/** 单次执行超时包装。超时后底层 promise 继续运行（P1 已知限制，文档化即可）。 */
function withTimeout(p, ms, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
        p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
}
/** 构造失败的 ExecuteResult（execute 抛异常时的兜底） */
function failedExecuteResult(error) {
    return {
        success: false,
        code: "",
        sessionId: "",
        hash: "",
        ruleHash: "",
        irFunctionCount: 0,
        protocolRuleCount: 0,
        violations: 0,
        degraded: false,
        repairApplied: false,
        repairCount: 0,
        repairBranchIds: [],
        error,
    };
}
/** 计算目标文件的 git diff；新文件/非 git 仓库时回退为摘要。 */
function computeDiff(projectPath, filePath) {
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(projectPath, filePath);
    try {
        const out = (0, child_process_1.execSync)(`git -C "${projectPath}" diff -- "${abs}"`, {
            encoding: "utf-8",
            timeout: 10000,
            stdio: "pipe",
        }).trim();
        if (out)
            return out;
        const status = (0, child_process_1.execSync)(`git -C "${projectPath}" status --porcelain -- "${abs}"`, {
            encoding: "utf-8",
            timeout: 10000,
            stdio: "pipe",
        }).trim();
        if (status)
            return `(新文件，未跟踪)\n${status}`;
        return "(无 git 变更)";
    }
    catch (e) {
        // 非 git 仓库或文件不存在 → 回退为文件内容摘要
        try {
            const content = fs.readFileSync(abs, "utf-8");
            return `(git diff 不可用: ${e.message})\n${content.slice(0, 500)}`;
        }
        catch {
            return `(git diff 不可用: ${e.message})`;
        }
    }
}
// ── Main Loop ──
/**
 * 运行 P1 最小 agent loop。
 *
 * @requires INTENT @produces AGENT_LOOP_RESULT
 */
async function runAgentLoop(opts) {
    const projectPath = path.resolve(opts.projectPath);
    const maxIterations = opts.maxIterations ?? 5;
    const maxRetries = opts.maxRetries ?? 3;
    const timeoutMs = opts.timeoutMs ?? 120000;
    const includeContext = opts.includeContext ?? false;
    const runTestsGate = opts.runTests ?? false;
    const attempts = [];
    const auditTrail = [];
    const audit = (event, detail) => auditTrail.push({ timestamp: new Date().toISOString(), event, detail });
    audit("loop:start", `intent="${opts.intent}" project=${projectPath} file=${opts.filePath || "(未指定)"} ` +
        `maxIterations=${maxIterations} maxRetries=${maxRetries} timeoutMs=${timeoutMs} ` +
        `context=${includeContext} tests=${runTestsGate}`);
    // ── P2 感知：git 上下文（best-effort） ──
    let gitContext;
    let contextHint = "";
    if (includeContext) {
        gitContext = (0, agent_perception_1.collectGitContext)(projectPath);
        audit("perception:git", gitContext.available
            ? `branch=${gitContext.branch} commits=${gitContext.recentCommits.length} ` +
                `changed=${gitContext.changedFiles.length} files=${gitContext.sourceFiles.length}`
            : `不可用: ${gitContext.error}`);
        if (gitContext.available) {
            contextHint =
                `\n[项目上下文：分支 ${gitContext.branch}；` +
                    `最近提交: ${gitContext.recentCommits.slice(0, 2).join(" / ") || "(无)"}；` +
                    `变更文件: ${gitContext.changedFiles.slice(0, 5).join(", ") || "(无)"}]`;
        }
    }
    // ── P2 感知：初始 IR 函数名集合（成功时算增量） ──
    let prevIRNames;
    try {
        const { ir } = (0, agent_perception_1.extractIRWithDelta)(projectPath);
        prevIRNames = new Set(ir.map((f) => String(f.name || "")).filter(Boolean));
        audit("perception:ir", `初始 IR ${prevIRNames.size} 个函数`);
    }
    catch (e) {
        audit("perception:ir", `初始 IR 提取失败（忽略）: ${e.message}`);
    }
    // ── 目标分解（best-effort，不阻塞主循环） ──
    let subgoals = [];
    try {
        subgoals = (0, goal_planner_1.expandGoalActions)(opts.intent);
        audit("goal:decompose", subgoals.length > 0 ? `子目标: ${subgoals.join(" → ")}` : "无模板命中，单目标直行");
    }
    catch (e) {
        audit("goal:decompose", `目标分解失败（忽略）: ${e.message}`);
    }
    let attemptNo = 0;
    const baseIntent = `${opts.intent}${contextHint}`;
    let currentIntent = baseIntent;
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
        audit("iteration:start", `第 ${iteration}/${maxIterations} 轮`);
        for (let retry = 0; retry < maxRetries; retry++) {
            attemptNo++;
            const startedAt = new Date().toISOString();
            audit("attempt:start", `#${attemptNo} (iter ${iteration}, retry ${retry}) intent="${currentIntent.slice(0, 120)}"`);
            // ── 执行（内部含 plan → 8 门验证 → SSG 修复 → emit → 写盘+指纹） ──
            let result;
            try {
                result = await withTimeout((0, execute_1.execute)(currentIntent, projectPath, opts.filePath), timeoutMs, `execute #${attemptNo}`);
            }
            catch (e) {
                result = failedExecuteResult(`execute 抛出异常: ${e.message}`);
            }
            // ── 写盘后验证门（编译 + 指纹标记） ──
            let compilePass = false;
            let markerPass = false;
            let filePath = opts.filePath || result.filePath;
            if (result.success && filePath) {
                const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(projectPath, filePath);
                try {
                    const compile = (0, execute_1.verifyCompiles)(resolved);
                    compilePass = compile.pass;
                    const marker = (0, execute_1.verifyFileMarker)(resolved);
                    markerPass = marker.marked;
                }
                catch (e) {
                    audit("verify:error", `写盘后验证门异常: ${e.message}`);
                }
            }
            else if (result.success) {
                // 产码模式（未指定输出文件）：编译门不适用；指纹门改为检查代码头部标记
                compilePass = true;
                markerPass = result.code.includes("@progmune-generated");
            }
            // ── P3 自监督：项目测试门（可选，编译/指纹通过后才跑） ──
            let testRan = false;
            let testPass = true;
            let testFailureSummary = "";
            if (result.success && compilePass && markerPass && runTestsGate && filePath) {
                // ── P5 安全层：跑测试 = shell 执行 → 审批门 ──
                const execDecision = (0, agent_permissions_1.decidePermission)("agent", { level: "exec", target: "项目测试（npm test / pytest）", projectPath, preApproved: opts.approveExec }, agent_permissions_1.interactiveConfirm);
                audit(execDecision.audit.event, execDecision.audit.detail);
                if (!execDecision.allowed) {
                    audit("verify:test", "测试门被审批门拒绝，跳过（--yes 可预批准）");
                }
                else {
                    try {
                        const t = (0, agent_supervision_1.runProjectTests)(projectPath);
                        testRan = t.ran;
                        testPass = t.pass;
                        if (t.ran) {
                            audit("verify:test", t.pass ? `测试通过 (${t.command})` : `测试失败: ${t.failures.slice(0, 3).join(" | ")}`);
                            if (!t.pass)
                                testFailureSummary = `项目测试失败: ${t.failures.slice(0, 3).join("；")}`;
                        }
                    }
                    catch (e) {
                        audit("verify:test", `测试门异常（忽略）: ${e.message}`);
                    }
                }
            }
            const attempt = {
                attempt: attemptNo,
                iteration,
                intent: currentIntent,
                feedback: attemptNo > 1 ? currentIntent.slice(opts.intent.length) || undefined : undefined,
                startedAt,
                success: result.success && compilePass && markerPass && (!testRan || testPass),
                degraded: result.degraded || false,
                sessionId: result.sessionId || "",
                filePath,
                fingerprint: result.hash || "",
                ruleHash: result.ruleHash || "",
                irFunctionCount: result.irFunctionCount,
                violations: result.violations,
                repairApplied: result.repairApplied,
                repairCount: result.repairCount,
                compilePass,
                markerPass,
                testRan,
                testPass,
                error: result.error,
            };
            attempts.push(attempt);
            // ── 成功出口 ──
            if (attempt.success) {
                const diff = filePath ? computeDiff(projectPath, filePath) : "(未指定输出文件，无 diff)";
                audit("attempt:ok", `#${attemptNo} 验证门全通过: sessionId=${result.sessionId} fingerprint=${result.hash} ` +
                    `compile=${compilePass} marker=${markerPass} test=${testRan ? testPass : "(未跑)"} ` +
                    `repairApplied=${result.repairApplied}`);
                audit("loop:success", `fingerprint=${result.hash} 迭代=${iteration} 重试=${attemptNo - 1}`);
                // ── P2 感知：成功时 IR 增量（agent 写盘后 IR 变化观测） ──
                let irDelta;
                try {
                    const { delta } = (0, agent_perception_1.extractIRWithDelta)(projectPath, prevIRNames);
                    irDelta = delta;
                    audit("perception:ir", `IR 增量: +${delta.added.length} -${delta.removed.length} (共 ${delta.functionCount} 函数)` +
                        (delta.added.length > 0 ? ` 新增: ${delta.added.join(", ")}` : ""));
                }
                catch (e) {
                    audit("perception:ir", `成功时 IR 增量提取失败（忽略）: ${e.message}`);
                }
                return {
                    success: true,
                    attempts,
                    iterations: iteration,
                    retries: attemptNo - 1,
                    subgoals,
                    filePath,
                    fingerprint: result.hash,
                    diff,
                    auditTrail,
                    degraded: result.degraded || false,
                    irDelta,
                    gitContext,
                };
            }
            // ── 失败反馈注入（不静默重试同一输入） ──
            const reasons = [];
            if (!result.success)
                reasons.push(result.error || "执行失败");
            if (result.success && !compilePass)
                reasons.push("编译验证未通过");
            if (result.success && !markerPass)
                reasons.push("指纹标记缺失");
            if (testFailureSummary)
                reasons.push(testFailureSummary);
            const feedback = reasons.join("；");
            audit("attempt:fail", `#${attemptNo} ${feedback || "未知原因"}`);
            if (retry < maxRetries - 1) {
                currentIntent = `${baseIntent}\n[上一次尝试失败：${feedback}。请修复后重新实现。]`;
                audit("retry", `注入反馈后重试 #${retry + 2}/${maxRetries}`);
            }
            else {
                currentIntent = baseIntent; // 进入下一迭代前复位意图
            }
        }
        audit("iteration:end", `第 ${iteration} 轮耗尽 ${maxRetries} 次重试`);
    }
    audit("loop:exhausted", `迭代上限 ${maxIterations} 轮后仍未成功，共 ${attemptNo} 次尝试`);
    return {
        success: false,
        attempts,
        iterations: maxIterations,
        retries: attemptNo,
        subgoals,
        fingerprint: "",
        diff: "",
        auditTrail,
        degraded: attempts.some((a) => a.degraded),
        gitContext,
    };
}
