"use strict";
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
const extract_ir_python_1 = require("./extract-ir-python");
const planner_1 = require("./planner");
const search_planner_1 = require("./search-planner");
const validator_1 = require("./validator");
const python_emitter_1 = require("./python-emitter");
const feedback_1 = require("./feedback");
const llm_1 = require("./llm");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
async function main() {
    const results = [];
    const intents = [
        "实现 login 函数，验证密码，成功则生成JWT，否则返回错误信息",
        "实现批量处理支付 transactions，对每笔交易校验卡片并记录日志",
        "实现数据报表函数，分页获取活跃用户，按类别分组并排序"
    ];
    const planners = ["llm", "search"];
    const projectPath = "./test-500";
    const fns = (0, extract_ir_python_1.extractIRPython)(projectPath);
    fs.writeFileSync("ir.json", JSON.stringify(fns, null, 2));
    console.log(`✅ 项目规模: ${fns.length} 函数\n`);
    for (const intent of intents) {
        for (const planner of planners) {
            const start = Date.now();
            let actions = [];
            try {
                if (planner === "llm") {
                    const result = await (0, planner_1.plan)(intent);
                    actions = result.actions;
                }
                else
                    actions = await (0, search_planner_1.searchPlan)(intent, 2, 4);
            }
            catch (e) {
                results.push({ intent, planner, duration_ms: Date.now() - start, llm_calls: llm_1.callCount, success: false, error: String(e) });
                continue;
            }
            const duration = Date.now() - start;
            const valid = actions.length > 0 && actions.map((a) => (0, validator_1.validateAction)(a)).every((r) => r.valid);
            if (!valid) {
                results.push({ intent, planner, duration_ms: duration, llm_calls: llm_1.callCount, success: false, error: "校验失败或无动作" });
                continue;
            }
            const code = (0, python_emitter_1.emitPython)(actions);
            const tmpFile = path.join(path.resolve(projectPath), "__test.py");
            fs.writeFileSync(tmpFile, code);
            let success = false, error;
            try {
                (0, child_process_1.execSync)(`python3 ${tmpFile}`, { timeout: 5000, encoding: "utf-8", cwd: path.resolve(projectPath) });
                success = true;
            }
            catch (e) {
                error = e.stderr?.toString() || e.toString();
            }
            finally {
                if (fs.existsSync(tmpFile))
                    fs.unlinkSync(tmpFile);
            }
            (0, feedback_1.recordRun)(intent, actions, success, error);
            results.push({ intent, planner, duration_ms: duration, llm_calls: llm_1.callCount, success, error });
            console.log(`${planner} | ${intent.substring(0, 20)}... | ${duration}ms | 调用:${llm_1.callCount} | ${success ? '✅' : '❌'}`);
        }
    }
    console.log("\n📊 500函数压力测试报告:");
    console.table(results.map(r => ({
        Intent: r.intent.substring(0, 30),
        Planner: r.planner,
        Time: r.duration_ms + 'ms',
        LLM: r.llm_calls,
        Success: r.success ? '✅' : '❌'
    })));
    fs.writeFileSync("stress_500_report.json", JSON.stringify(results, null, 2));
    const totalCalls = results.reduce((s, r) => s + r.llm_calls, 0);
    const avgTime = results.reduce((s, r) => s + r.duration_ms, 0) / results.length;
    const successRate = results.filter(r => r.success).length / results.length * 100;
    console.log(`\n📈 汇总: LLM总调用=${totalCalls}, 平均耗时=${avgTime.toFixed(0)}ms, 成功率=${successRate.toFixed(0)}%`);
}
main().catch(console.error);
