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
const planner_1 = require("./planner");
const validator_1 = require("./validator");
const python_emitter_1 = require("./python-emitter");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
// 直接使用当前目录下的 ir.json，不再重新提取
const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8"));
console.log(`IR: ${ir.length} 函数 (含合约)`);
const intents = {
    case1: "实现 login 函数，验证密码后生成JWT并返回",
    case2: "实现用户注册，先加密密码，然后发送欢迎邮件",
    case3: "实现带缓存的查询：先查缓存，若无则查询并更新缓存",
    case4: "实现批量发送邮件：遍历用户列表，对每个活跃用户发送通知",
    case5: "实现角色检查：验证用户是否为管理员，是则执行操作",
    case6: "实现会话创建：验证凭据后，生成JWT，创建会话并缓存",
    case7: "实现数据导出：获取所有用户数据，转换格式并保存到文件",
    case8: "实现账户锁定：检查登录失败次数，超过阈值则锁定账户",
    case9: "实现令牌刷新：验证旧令牌有效性，生成新令牌并更新会话",
    case10: "实现用户注销：销毁会话，清理缓存，记录审计日志"
};
async function runSemanticTest() {
    const results = [];
    for (const [caseName, intent] of Object.entries(intents)) {
        console.log(`\n🧪 ${caseName}: ${intent.substring(0, 50)}...`);
        const result = await (0, planner_1.plan)(intent);
        const actions = result.actions;
        if (!actions || actions.length === 0) {
            results.push({ case: caseName, intent, generatedCode: "", actionSequence: [], syntaxPass: false, semanticError: true, runtimePass: false });
            console.log("  ❌ 规划失败（无输出）");
            continue;
        }
        const seqResult = (0, validator_1.validateActionSequence)(actions);
        const syntaxPass = seqResult.valid;
        if (!syntaxPass) {
            console.log("  ❌ 语法/变量校验失败:", seqResult.errors.join(", "));
            results.push({ case: caseName, intent, generatedCode: "", actionSequence: actions, syntaxPass: false, semanticError: true, runtimePass: false });
            continue;
        }
        const code = (0, python_emitter_1.emitPython)(actions);
        console.log("  📝 代码:\n" + code.split("\n").slice(0, 8).map(l => "    " + l).join("\n"));
        const tmpFile = path.join(path.resolve("./test-semantic-guard"), "__test.py");
        fs.writeFileSync(tmpFile, code);
        let runtimePass = false;
        try {
            (0, child_process_1.execSync)(`python3 ${tmpFile}`, { timeout: 5000, encoding: "utf-8", cwd: path.resolve("./test-semantic-guard") });
            runtimePass = true;
        }
        catch (e) { }
        if (fs.existsSync(tmpFile))
            fs.unlinkSync(tmpFile);
        // 语义错误标记：如果序列中重要的业务函数缺失，视为语义错误（已在规划时由 checkSemantic 拦截）
        const hasSemanticError = !runtimePass || actions.length <= 1; // 简单判断：只有1个调用的视为不完整
        results.push({ case: caseName, intent, generatedCode: code, actionSequence: actions, syntaxPass, semanticError: hasSemanticError, runtimePass });
        console.log(hasSemanticError ? "  ⚠️ 潜在语义错误" : "  ✅ 完整通过");
    }
    console.log("\n═══════════════════════════════════");
    console.log("📊 语义阻断测试报告");
    console.log("═══════════════════════════════════");
    const total = results.length;
    const syntaxBlocked = results.filter(r => !r.syntaxPass).length;
    const semanticDetected = results.filter(r => r.semanticError).length;
    const fullyClean = results.filter(r => r.syntaxPass && !r.semanticError).length;
    console.log(`总测试案例: ${total}`);
    console.log(`语法/变量层拦截: ${syntaxBlocked}`);
    console.log(`语义错误检测: ${semanticDetected}`);
    console.log(`完全安全通过: ${fullyClean}`);
    console.log(`阻断率: ${((syntaxBlocked + semanticDetected) / total * 100).toFixed(0)}%`);
    fs.writeFileSync("semantic_block_results.json", JSON.stringify(results, null, 2));
    console.log("详细结果已保存到 semantic_block_results.json");
}
runSemanticTest().catch(console.error);
