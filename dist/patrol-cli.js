"use strict";
/**
 * Phase 12: Progmune 免疫巡逻 CLI — `progmune patrol`（形态 B 第一版）
 *
 * 扫描项目 → trust_check → 违规报告 + 建议补丁（绝不自动合并）。
 * 支持 --watch 持续监听（文件变更 → 防抖 → 重新巡逻 → 刷新报告）。
 *
 * Usage:
 *   npx ts-node src/patrol-cli.ts --project <dir> [options]
 *   npm run patrol -- --project <dir> [options]
 *
 * Options:
 *   --project <dir>   目标项目目录（默认 CWD）
 *   --watch           持续监听模式（文件变更后自动重扫）
 *   --json            JSON 输出（单次扫描）
 *   --help, -h
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
const path = __importStar(require("path"));
const agent_patrol_1 = require("./agent-patrol");
const agent_perception_1 = require("./agent-perception");
const agent_permissions_1 = require("./agent-permissions");
// 在 chdir 到项目目录之前按启动 CWD 加载 .env——
// trust 引擎内部的 lazy require（语义映射 LLM 回退）发生在 chdir 之后，
// 若不预载，LLM_API_KEY 不可用，映射降级会导致漏报。
try {
    require("dotenv/config");
}
catch { /* dotenv 可选 */ }
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Progmune 免疫巡逻 (P4) — 监听/扫描 → trust_check → 报告 + 建议补丁（永不自动合并）

Usage:
  npx ts-node src/patrol-cli.ts --project <dir> [options]
  npm run patrol -- --project <dir> [options]

Options:
  --project <dir>   目标项目目录（默认当前目录）
  --watch           持续监听模式（源文件变更后自动重扫并刷新报告）
  --json            JSON 输出（单次扫描）
  --help, -h        显示帮助

Example:
  npm run patrol -- --project demo-patrol
  npm run patrol -- --project demo-patrol --watch
`);
    process.exit(0);
}
const getFlag = (name) => {
    const idx = args.indexOf(`--${name}`);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
};
const projectPath = path.resolve(getFlag("project") || process.cwd());
const watch = args.includes("--watch");
const json = args.includes("--json");
async function scanOnce(label) {
    try {
        const report = await (0, agent_patrol_1.runPatrol)(projectPath);
        // ── P5 安全层：报告写入经 FsSandbox（巡逻预设：写=沙箱白名单） ──
        const writeDecision = (0, agent_permissions_1.decidePermission)("patrol", {
            level: "write",
            target: path.join(projectPath, ".progmune_patrol_report.md"),
            projectPath,
        });
        let reportFile = "";
        if (writeDecision.allowed) {
            reportFile = (0, agent_patrol_1.writePatrolReport)(report, projectPath);
        }
        if (json && !watch) {
            console.log(JSON.stringify(report, null, 2));
        }
        else {
            console.log(`[${label}] ` + (0, agent_patrol_1.formatPatrolTerminal)(report).replace(/\n/g, "\n  "));
            console.log(writeDecision.allowed
                ? `   报告: ${reportFile}`
                : `   ⚠️ 报告写入被沙箱拒绝: ${writeDecision.detail}`);
        }
    }
    catch (e) {
        console.error(`❌ 巡逻失败: ${e?.message || e}`);
    }
}
async function main() {
    process.chdir(projectPath);
    console.log(`🛡️  Progmune 免疫巡逻 (P4) — 项目: ${projectPath}${watch ? "（持续监听）" : ""}`);
    if (!watch) {
        await scanOnce("扫描");
        process.exit(0);
    }
    // 持续监听：RepoWatcher 防抖触发重扫
    await scanOnce("首次");
    let scanning = false;
    const watcher = new agent_perception_1.RepoWatcher(projectPath, async (file) => {
        if (scanning)
            return; // 扫描期间的新变更合并进下一轮
        scanning = true;
        console.log(`🔍 检测到变更: ${file}`);
        await scanOnce("重扫");
        scanning = false;
    }, 1500);
    watcher.start();
    console.log("👂 监听中（Ctrl+C 退出）…");
}
main().catch((e) => {
    console.error(`❌ 巡逻 CLI 异常: ${e?.message || e}`);
    process.exit(1);
});
