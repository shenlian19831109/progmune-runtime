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
const extract_ir_1 = require("./extract-ir");
const planner_1 = require("./planner");
const validator_1 = require("./validator");
const emitter_1 = require("./emitter");
const runtime_1 = require("./runtime");
const fs = __importStar(require("fs"));
async function runTest(name, actions) {
    console.log(`\n🧪 测试: ${name}`);
    // 校验
    const results = actions.map((a) => (0, validator_1.validateAction)(a));
    const valid = results.every((r) => r.valid);
    if (!valid) {
        console.log("  ❌ 校验器拦截:");
        results.forEach((r, i) => { if (!r.valid)
            console.log(`    动作${i}: ${r.errors}`); });
        return;
    }
    // 发射代码
    const code = (0, emitter_1.emitCode)(actions);
    console.log("  生成的代码:\n" + code.split("\n").map(l => "    " + l).join("\n"));
    // 编译运行
    const execResult = (0, runtime_1.runAndCheck)(code);
    if (!execResult.success) {
        console.log("  ❌ 编译/运行失败 (类型系统生效)");
        console.log("    错误摘要:", execResult.error?.split("\n")[0]);
    }
    else {
        console.log("  ✅ 运行通过 (需人工复核是否真正安全)");
    }
}
async function main() {
    console.log("═══════════════════════════════════════");
    console.log("  BrainyCode v2.0 – 扩展语义拦截测试");
    console.log("═══════════════════════════════════════");
    // 1. 提取 IR
    console.log("\n📊 提取 IR...");
    const fns = (0, extract_ir_1.extractIR)("./test-login");
    fs.writeFileSync("ir.json", JSON.stringify(fns, null, 2));
    console.log(`✅ 函数数量: ${fns.length}`);
    // 2. 获取正常动作序列
    const intent = "实现登录接口，验证密码后返回 JWT，并记录日志";
    console.log("\n🧠 正常规划...");
    const result = await (0, planner_1.plan)(intent);
    const normalActions = result.actions;
    console.log("🎯 正常动作:");
    console.log(JSON.stringify(normalActions, null, 2));
    // 3. 正常流程
    await runTest("正常流程", normalActions);
    // 4. 错误注入测试集
    const maliciousTests = [
        {
            name: "篡改参数类型 (PasswordHash -> Token)",
            modify: (actions) => {
                const copy = JSON.parse(JSON.stringify(actions));
                for (const a of copy) {
                    if (a.kind === "call" && a.function === "verifyPassword") {
                        const hashArg = a.args.find((x) => x.name === "hash");
                        if (hashArg)
                            hashArg.type = "Token";
                    }
                }
                return copy;
            }
        },
        {
            name: "调用不存在的函数",
            modify: (actions) => {
                const copy = JSON.parse(JSON.stringify(actions));
                copy.push({ kind: "call", function: "hackSystem", args: [] });
                return copy;
            }
        },
        {
            name: "参数数量错误 (verifyPassword 只给一个参数)",
            modify: (actions) => {
                const copy = JSON.parse(JSON.stringify(actions));
                for (const a of copy) {
                    if (a.kind === "call" && a.function === "verifyPassword") {
                        a.args = [a.args[0]]; // 只保留第一个参数
                    }
                }
                return copy;
            }
        },
        {
            name: "将 string 参数类型改为 number",
            modify: (actions) => {
                const copy = JSON.parse(JSON.stringify(actions));
                for (const a of copy) {
                    if (a.kind === "call" && a.function === "verifyPassword") {
                        const plainArg = a.args.find((x) => x.name === "plain");
                        if (plainArg)
                            plainArg.type = "number";
                    }
                }
                return copy;
            }
        }
    ];
    for (const test of maliciousTests) {
        const maliciousActions = test.modify(normalActions);
        await runTest(test.name, maliciousActions);
    }
    console.log("\n═══════════════════════════════════════");
    console.log("  ✅ 扩展测试完成");
    console.log("═══════════════════════════════════════");
}
main().catch(console.error);
