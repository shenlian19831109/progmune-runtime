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
/**
 * policy/engine.test.ts — 策略引擎 fail-closed 回归（审计修复 2026-09-06）
 *
 * 锁定 Kimi 审计的三条修复：
 * 1. risk 规则不再伪造 ["SSL_CTX_new","SSL_connect"] 输入——无真实调用
 *    数据时按 fail-closed 计违规
 * 2. 配置解析失败显式携带 configError（不再静默回退默认）
 * 3. execute 写盘策略门：项目 opt-in（.progmune-policy.json）时 BLOCK
 *    回滚写盘；未配置时无操作
 */
const vitest_1 = require("vitest");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const engine_1 = require("./engine");
const execute_1 = require("../execute");
let dir;
(0, vitest_1.beforeEach)(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-policy-")); });
(0, vitest_1.afterEach)(() => { fs.rmSync(dir, { recursive: true, force: true }); });
function baseCtx(file) {
    return {
        certificate: {
            validated: true,
            confidence: "high",
            provenanceIntact: true,
            fingerprint: "test-fp",
            violations: 0,
            plsbCoverage: "10/13",
            plsbRecall: 1,
            degraded: false,
            sessionId: "test-session",
            file,
            timestamp: new Date().toISOString(),
        },
        accountability: {
            humanEvents: 1,
            aiEvents: 1,
            automatedEvents: 0,
            custodyGap: false,
        },
    };
}
(0, vitest_1.describe)("policy engine（fail-closed 回归）", () => {
    (0, vitest_1.it)("risk 规则：无可提取调用数据 → 显式违规（fail-closed，不再伪造输入）", () => {
        const f = path.join(dir, "empty.ts");
        fs.writeFileSync(f, "");
        const result = (0, engine_1.evaluatePolicy)(baseCtx(f));
        const riskViolations = result.violations.filter((v) => v.rule.type === "risk");
        (0, vitest_1.expect)(riskViolations.length).toBeGreaterThanOrEqual(1);
        (0, vitest_1.expect)(riskViolations[0].detail).toContain("fail-closed");
    });
    (0, vitest_1.it)("risk 规则：真实调用提取后良性代码不产生风险违规", () => {
        const f = path.join(dir, "benign.ts");
        fs.writeFileSync(f, "function hello() { console.log('x'); return computeSum(a, b); }");
        const result = (0, engine_1.evaluatePolicy)(baseCtx(f));
        const riskViolations = result.violations.filter((v) => v.rule.type === "risk");
        (0, vitest_1.expect)(riskViolations).toHaveLength(0);
    });
    (0, vitest_1.it)("loadPolicyConfig：JSON 解析失败显式携带 configError（不再静默回退）", () => {
        fs.writeFileSync(path.join(dir, ".progmune-policy.json"), "{ broken json !!!");
        const res = (0, engine_1.loadPolicyConfig)(dir);
        (0, vitest_1.expect)(res.configError).toBeDefined();
        (0, vitest_1.expect)(res.configError).toContain("Failed to parse");
    });
    (0, vitest_1.it)("空规则集 fail-closed：[] 是 truthy 但必须拒绝（BLOCK，非 ALLOW）", () => {
        const f = path.join(dir, "empty.ts");
        fs.writeFileSync(f, "");
        const result = (0, engine_1.evaluatePolicy)(baseCtx(f), []);
        (0, vitest_1.expect)(result.passed).toBe(false);
        (0, vitest_1.expect)(result.verdict).toBe("BLOCK");
        (0, vitest_1.expect)(result.violations.some((v) => v.rule.type === "policy_config")).toBe(true);
    });
});
(0, vitest_1.describe)("execute 写盘策略门（opt-in）", () => {
    const MARKED = `// @progmune-generated session=s1 timestamp=2026-09-06T00:00:00.000Z
function doThing() { return 1; }
`;
    (0, vitest_1.it)("未配置 .progmune-policy.json → 无操作（旧行为）", () => {
        const f = path.join(dir, "out.ts");
        fs.writeFileSync(f, MARKED);
        const gate = (0, execute_1.applyPolicyGateAfterWrite)(dir, f);
        (0, vitest_1.expect)(gate.blocked).toBe(false);
        (0, vitest_1.expect)(fs.existsSync(f)).toBe(true);
    });
    (0, vitest_1.it)("配置阻断规则 → BLOCK 回滚（新文件删除）", () => {
        fs.writeFileSync(path.join(dir, ".progmune-policy.json"), JSON.stringify({
            inherit: false,
            rules: [{ type: "confidence", severity: "block", threshold: 2 }],
        }));
        const f = path.join(dir, "out.ts");
        fs.writeFileSync(f, MARKED);
        const gate = (0, execute_1.applyPolicyGateAfterWrite)(dir, f);
        (0, vitest_1.expect)(gate.blocked).toBe(true);
        (0, vitest_1.expect)(gate.decision).toBe("BLOCK");
        (0, vitest_1.expect)(fs.existsSync(f)).toBe(false); // 回滚 = 删除新文件
    });
    (0, vitest_1.it)("配置阻断规则 → BLOCK 回滚（已有文件恢复原内容）", () => {
        fs.writeFileSync(path.join(dir, ".progmune-policy.json"), JSON.stringify({
            inherit: false,
            rules: [{ type: "confidence", severity: "block", threshold: 2 }],
        }));
        const f = path.join(dir, "out.ts");
        const prev = "// original content\n";
        const gate = (0, execute_1.applyPolicyGateAfterWrite)(dir, f, prev);
        (0, vitest_1.expect)(gate.blocked).toBe(true);
        (0, vitest_1.expect)(fs.readFileSync(f, "utf-8")).toBe(prev); // 恢复原内容
    });
});
