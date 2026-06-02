"use strict";
/**
 * Progmune Check — 一键代码库免疫状态巡检
 *
 * Usage: npm run check
 *
 * 检查项目：
 *  1. IR 重新提取（确保与当前代码同步）
 *  2. TypeScript 编译（零类型错误）
 *  3. SSG dev_pipeline 协议验证
 *  4. Ledger 不变量 + 回放验证 (Invariant-0, Invariant-1, Replay)
 *  5. 各命名空间状态快照
 *  6. 失败基因组概要
 *  7. 抗体效能统计
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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const ssg_validator_1 = require("./ssg-validator");
const failure_corpus_1 = require("./failure-corpus");
const runtime_invariants_1 = require("./runtime-invariants");
const ledger_registry_1 = require("./ledger-registry");
const deterministic_replay_1 = require("./deterministic-replay");
const protocol_registry_1 = require("./protocol-registry");
const C = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    gray: "\x1b[90m",
    bold: "\x1b[1m",
};
const G = (s) => `${C.green}${s}${C.reset}`;
const R = (s) => `${C.red}${s}${C.reset}`;
const Y = (s) => `${C.yellow}${s}${C.reset}`;
const C_ = (s) => `${C.cyan}${s}${C.reset}`;
const D = (s) => `${C.gray}${s}${C.reset}`;
const B = (s) => `${C.bold}${s}${C.reset}`;
let failures = 0;
let warnings = 0;
// ── CLI: single-session ledger validation ──
const cliArg = process.argv[2];
if (cliArg === "--ledger") {
    const sessionId = process.argv[3];
    if (!sessionId) {
        console.error(`${R("Usage:")} npx ts-node src/check.ts --ledger <sessionId>`);
        process.exit(1);
    }
    const sessions = (0, failure_corpus_1.getAllSessions)();
    const session = sessions.find(s => s.sessionId === sessionId || s.sessionId.startsWith(sessionId));
    if (!session) {
        console.error(`${R("Session not found:")} ${sessionId}`);
        process.exit(1);
    }
    const nsInit = new Map();
    nsInit.set("_global", "UNAUTHENTICATED");
    try {
        const protoPath = path.resolve(__dirname, "../protocols.json");
        if (fs.existsSync(protoPath)) {
            const protoDef = JSON.parse(fs.readFileSync(protoPath, "utf-8"));
            if (protoDef.namespaceInitialStates) {
                for (const [ns, s] of Object.entries(protoDef.namespaceInitialStates)) {
                    nsInit.set(ns, s);
                }
            }
        }
    }
    catch { }
    const allTransitions = session.attempts.flatMap(a => a.transitions || []);
    if (allTransitions.length === 0) {
        console.log(`${D("No ledger data in this session.")}`);
        process.exit(0);
    }
    console.log(`${C_("Ledger Validation")} — ${session.sessionId}`);
    console.log(`${D("═".repeat(50))}`);
    console.log(`  Intent: ${session.intent}`);
    console.log(`  Ledger: ${allTransitions.length} transitions across ${session.attempts.filter(a => (a.transitions || []).length > 0).length} attempt(s)`);
    // Invariants
    const consistency = (0, ssg_validator_1.checkLedgerConsistency)(allTransitions, nsInit);
    console.log(`  Invariants: ${consistency.consistent ? G("clean") : R(`${consistency.violations.length} violations`)}`);
    // Replay
    const rebuilt = (0, ssg_validator_1.rebuildState)(allTransitions, nsInit);
    const lastTransition = allTransitions[allTransitions.length - 1];
    const recorded = lastTransition.statesAfter;
    const allNs = new Set([...Object.keys(rebuilt), ...Object.keys(recorded)]);
    const norm = (snap) => {
        const out = {};
        for (const ns of [...allNs].sort())
            out[ns] = [...(snap[ns] || [])].sort();
        return out;
    };
    const replayOk = JSON.stringify(norm(rebuilt)) === JSON.stringify(norm(recorded));
    console.log(`  Replay: ${replayOk ? G("state matches") : R("state mismatch")}`);
    // Integrity
    const ledgerHash = (0, ssg_validator_1.hashLedger)(allTransitions);
    console.log(`  Fingerprint: ${D(ledgerHash)}`);
    // Per-attempt detail
    for (const attempt of session.attempts) {
        const ts = attempt.transitions || [];
        if (ts.length === 0)
            continue;
        const validCount = ts.filter(t => t.valid).length;
        const consAtt = (0, ssg_validator_1.checkLedgerConsistency)(ts, nsInit);
        console.log(`  ${D("─".repeat(40))}`);
        console.log(`  Attempt #${attempt.attemptNumber} (${attempt.outcome}): ${validCount}/${ts.length} valid, invariants ${consAtt.consistent ? G("ok") : R("fail")}`);
        for (const t of ts) {
            const icon = t.valid ? G("✓") : R("✗");
            const delta = [t.acquired.length ? G("+" + t.acquired.join(",")) : "", t.invalidated.length ? R("-" + t.invalidated.join(",")) : ""].filter(Boolean).join(" ");
            console.log(`    ${icon} ${t.function.padEnd(22)} ${D(t.namespace.padEnd(14))} ${delta || D("(no delta)")}`);
        }
    }
    if (consistency.consistent && replayOk) {
        console.log(`\n  ${G("✔")} ${B("Ledger is valid and replayable.")}`);
        process.exit(0);
    }
    else {
        console.log(`\n  ${R("✖")} ${B("Ledger has issues.")}`);
        process.exit(1);
    }
}
function step(label) {
    console.log(`\n${B("━━━")} ${B(label)} ${"━".repeat(Math.max(2, 60 - label.length))}`);
}
function pass(msg) {
    console.log(`  ${G("✔")}  ${msg}`);
}
function fail(msg) {
    console.log(`  ${R("✖")}  ${msg}`);
    failures++;
}
function warn(msg) {
    console.log(`  ${Y("!")}  ${msg}`);
    warnings++;
}
// CLI: --verify — fingerprint integrity check
if (cliArg === "--verify") {
    console.log(`${B("━━━")} ${B("Fingerprint Verification")} ${"━".repeat(40)}`);
    const summary = (0, ledger_registry_1.verifyAllFingerprints)();
    console.log(`  Total fingerprints: ${summary.total}`);
    console.log(`  ${G("✔")} Valid: ${summary.valid}`);
    if (summary.tampered > 0) {
        console.log(`  ${R("✖")} Tampered: ${summary.tampered}`);
        for (const r of summary.verified.filter(r => r.tampered)) {
            console.log(`     ${R(r.sessionId)}: stored=${r.stored.ledgerHash.slice(0, 16)} current=${(r.currentHash || "?").slice(0, 16)}`);
        }
    }
    if (summary.notFound > 0) {
        console.log(`  ${Y("!")} Sessions missing: ${summary.notFound} (fingerprint exists but session file gone)`);
    }
    console.log();
    if (summary.tampered > 0) {
        console.log(`${R("✖")} Integrity check failed.`);
        process.exit(1);
    }
    else {
        console.log(`${G("✔")} All execution certificates intact.`);
        process.exit(0);
    }
}
// ── 1. IR 提取 ──
step("1/6 IR 提取");
try {
    (0, child_process_1.execSync)("npx ts-node src/extract-ir.ts .", { stdio: "pipe", cwd: path.resolve(__dirname, "..") });
    const irRaw = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../ir.json"), "utf-8"));
    const ir = Array.isArray(irRaw) ? irRaw : (irRaw.functions || []);
    const externalCount = ir.filter((f) => f.external).length;
    pass(`IR 提取完成: ${ir.length} 个函数 (${externalCount} 外部)`);
}
catch (e) {
    fail(`IR 提取失败: ${e.message}`);
}
// ── 2. TypeScript 编译 ──
step("2/6 TypeScript 类型检查");
try {
    (0, child_process_1.execSync)("npx tsc --noEmit", { stdio: "pipe", cwd: path.resolve(__dirname, "..") });
    pass("零类型错误");
}
catch (e) {
    const stderr = e.stderr?.toString() || e.stdout?.toString() || "";
    const lines = stderr.split("\n").filter((l) => l.includes("error TS"));
    if (lines.length > 0) {
        fail(`${lines.length} 个类型错误`);
        lines.slice(0, 5).forEach((l) => console.log(`    ${D(l.trim())}`));
        if (lines.length > 5)
            console.log(`    ${D(`... 及其他 ${lines.length - 5} 个错误`)}`);
    }
    else {
        fail(`编译失败`);
    }
}
// ── 3. SSG 协议验证 ──
step("3/6 SSG 协议验证");
const protoPath = path.resolve(__dirname, "../protocols.json");
if (!fs.existsSync(protoPath)) {
    fail("protocols.json 不存在");
}
else {
    const protoDef = JSON.parse(fs.readFileSync(protoPath, "utf-8"));
    const protocols = (0, ssg_validator_1.parseProtocolsFromJSON)(protoDef);
    pass(`已加载 ${protocols.length} 条协议规则`);
    // 检查命名空间
    const namespaces = new Set(protocols.map((p) => p.protocol.namespace || "_global"));
    console.log(`     ${D("命名空间:")} ${[...namespaces].map(n => C_(n)).join(", ")}`);
    // dev_pipeline 验证
    const nsStates = new Map();
    nsStates.set("_global", "UNAUTHENTICATED");
    if (protoDef.namespaceInitialStates) {
        for (const [ns, s] of Object.entries(protoDef.namespaceInitialStates)) {
            nsStates.set(ns, s);
        }
    }
    // dev_pipeline 验证 (pure functions, no StateMachineValidator instance)
    const rules = new Map();
    for (const p of protocols)
        rules.set(p.function, p.protocol);
    const ruleHash = (0, ssg_validator_1.hashRules)(rules);
    const ctx = {
        ledger: [],
        currentState: (0, ssg_validator_1.rebuildState)([], nsStates),
    };
    const transitions = [];
    const devSeq = [
        { fn: "extractIR", name: "IR 提取" },
        { fn: "validateAction", name: "动作校验" },
        { fn: "validateActionSequence", name: "序列校验" },
        { fn: "emitCode", name: "代码生成" },
        { fn: "recordSession", name: "会话记录" },
    ];
    let pipelineOk = true;
    for (let i = 0; i < devSeq.length; i++) {
        const { fn, name } = devSeq[i];
        const { valid, transition, rejection } = (0, ssg_validator_1.validateTransition)(ctx, fn, i, rules, nsStates, ruleHash);
        transitions.push(transition);
        ctx.ledger = transitions;
        if (valid) {
            ctx.currentState = transition.statesAfter;
            const gained = transition.acquired.length ? G("+" + transition.acquired.join(",+")) : "";
            const lost = transition.invalidated.length ? R("-" + transition.invalidated.join(",-")) : "";
            console.log(`  ${G("✅")} ${fn.padEnd(25)} ${[gained, lost].filter(Boolean).join(" ") || D("(no delta)")}`);
        }
        else {
            const missing = rejection?.missingFunctions.join(" → ") || "?";
            console.log(`  ${R("🚫")} ${fn.padEnd(25)} ${R("需 " + missing)}`);
            pipelineOk = false;
        }
    }
    if (pipelineOk) {
        pass("dev_pipeline 协议全部通过");
    }
    else {
        fail("dev_pipeline 协议存在违规");
    }
    // Per-namespace 状态 (from ledger via rebuildState)
    const snap = (0, ssg_validator_1.rebuildState)(transitions, nsStates);
    console.log(`\n  ${B("命名空间状态快照:")}`);
    for (const [ns, states] of Object.entries(snap).sort()) {
        const statesStr = states.length > 0 ? states.map(s => C_(s)).join(", ") : D("(empty)");
        console.log(`    ${C_(ns.padEnd(20))} ${statesStr}`);
    }
}
// ── 4. Ledger 不变量检查 (Phase 3) ──
step("4/6 Ledger 不变量");
{
    // Load namespace initial states from protocols.json for correct replay
    const nsInit = (0, protocol_registry_1.getNsInit)();
    let checked = 0;
    let consistent = 0;
    let stateMatch = 0;
    const allLedgers = [];
    const violationsDetail = [];
    const replayMismatchDetail = [];
    const sessionsDir = path.resolve(process.env.PROGMUNE_PROJECT_DIR || process.cwd(), ".progmune_corpus/sessions");
    const norm = (snap, allNs) => {
        const out = {};
        for (const ns of [...allNs].sort()) {
            out[ns] = [...(snap[ns] || [])].sort();
        }
        return out;
    };
    if (fs.existsSync(sessionsDir)) {
        for (const file of fs.readdirSync(sessionsDir)) {
            if (!file.endsWith(".json"))
                continue;
            try {
                const session = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), "utf-8"));
                for (const attempt of (session.attempts || [])) {
                    const transitions = attempt.transitions || [];
                    if (transitions.length === 0)
                        continue;
                    allLedgers.push(...transitions);
                    // Invariant check
                    const result = (0, ssg_validator_1.checkLedgerConsistency)(transitions, nsInit);
                    checked++;
                    if (result.consistent) {
                        consistent++;
                    }
                    else {
                        for (const v of result.violations.slice(0, 2)) {
                            violationsDetail.push(`[${v.invariant}] session=${session.sessionId} idx=${v.index}`);
                        }
                    }
                    // Replay check: rebuildState === recorded statesAfter
                    const rebuilt = (0, ssg_validator_1.rebuildState)(transitions, nsInit);
                    const recorded = transitions[transitions.length - 1].statesAfter;
                    const allNs = new Set([...Object.keys(rebuilt), ...Object.keys(recorded)]);
                    if (JSON.stringify(norm(rebuilt, allNs)) === JSON.stringify(norm(recorded, allNs))) {
                        stateMatch++;
                    }
                    else {
                        replayMismatchDetail.push(`session=${session.sessionId} attempt=${attempt.attemptNumber}`);
                    }
                }
            }
            catch { }
        }
    }
    if (checked === 0) {
        pass("无可检查的 Ledger（需要更多规划会话）");
    }
    else if (consistent === checked && stateMatch === checked) {
        const combinedHash = (0, ssg_validator_1.hashLedger)(allLedgers);
        pass(`全部 ${checked} 个 Ledger 通过 (Invariant-0 + Invariant-1 + Replay) | 完整性指纹: ${combinedHash}`);
    }
    else {
        if (consistent < checked) {
            fail(`${checked - consistent}/${checked} 个 Ledger 存在一致性问题`);
            for (const d of violationsDetail.slice(0, 3)) {
                console.log(`     ${D(d)}`);
            }
            // P0: Strict mode — invariant violations are now hard failures
            if (process.env.PROGMUNE_STRICT !== "false") {
                console.log(`     ${R("PROGMUNE_STRICT=true — 不变量违规视为硬错误")}`);
            }
        }
        if (stateMatch < checked) {
            fail(`${checked - stateMatch}/${checked} 个 Ledger 回放状态不匹配`);
            for (const d of replayMismatchDetail.slice(0, 3)) {
                console.log(`     ${D(d)}`);
            }
        }
        if (consistent === checked && stateMatch === checked) {
            // This shouldn't happen due to outer condition, but keep it safe
        }
    }
    // P0: Strict invariant assertion — catch any violation that escaped per-session checks
    // Per-ledger check (not combined, since different sessions have independent index sequences)
    if (process.env.PROGMUNE_STRICT !== "false" && checked > 0) {
        let invariantFailed = false;
        for (const file of fs.readdirSync(sessionsDir)) {
            if (!file.endsWith(".json"))
                continue;
            try {
                const session = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), "utf-8"));
                for (const attempt of (session.attempts || [])) {
                    const transitions = attempt.transitions || [];
                    if (transitions.length === 0)
                        continue;
                    try {
                        (0, runtime_invariants_1.assertLedgerInvariants)(transitions, nsInit);
                    }
                    catch (e) {
                        if (e instanceof runtime_invariants_1.InvariantViolationError) {
                            invariantFailed = true;
                            console.log(`     ${R(`[${e.detail.invariant}] session=${session.sessionId} attempt=${attempt.attemptNumber}: ${e.message.slice(0, 80)}`)}`);
                        }
                    }
                }
            }
            catch { }
        }
        if (invariantFailed) {
            fail("PROGMUNE_STRICT=true — 严格不变量断言发现违规");
        }
    }
    // P0: Fingerprint registration — ensure every session has an execution certificate
    {
        const registered = (0, ledger_registry_1.registerAllMissingFingerprints)();
        if (registered > 0) {
            console.log(`     ${C_(`新注册 ${registered} 个指纹`)}`);
        }
    }
    // Phase 6: Auto Replay — replay is health check, not special command
    if (checked > 0) {
        const sessionFiles = fs.readdirSync(sessionsDir).filter(f => f.endsWith(".json"));
        const toReplay = sessionFiles.length <= 20
            ? sessionFiles
            : sessionFiles.slice(-10); // sample recent 10 if > 20
        let replayed = 0;
        let replayPassed = 0;
        for (const file of toReplay) {
            try {
                const sid = file.replace(".json", "");
                const result = (0, deterministic_replay_1.replaySession)(sid);
                replayed++;
                if (result.success)
                    replayPassed++;
                else if (result.divergencePoint !== undefined) {
                    console.log(`     ${Y(`Replay divergence: ${sid.slice(0, 13)}... at index ${result.divergencePoint}`)}`);
                }
            }
            catch { }
        }
        if (replayed > 0) {
            const status = replayPassed === replayed
                ? `${G("✔")}  ${replayed}/${replayed} Replay 通过`
                : `${Y("!")}  ${replayPassed}/${replayed} Replay 通过`;
            console.log(`     ${status}`);
        }
    }
}
// ── 5. 失败基因组 ──
step("5/6 失败基因组");
const genome = (0, failure_corpus_1.getFailureGenome)();
if (genome.totalFailures === 0) {
    pass("零失败记录");
}
else {
    warn(`${genome.totalFailures} 次违规记录`);
    console.log(`     SVL-1: ${genome.bySVL["SVL-1"]}  |  SVL-2: ${genome.bySVL["SVL-2"]}  |  SVL-3: ${genome.bySVL["SVL-3"]}  |  SVL-4: ${genome.bySVL["SVL-4"]}`);
    console.log(`     ${D("平均重试:")} ${genome.averageRetriesToSuccess}`);
    if (genome.commonFixPaths.length > 0) {
        const top = genome.commonFixPaths[0];
        console.log(`     ${D("最常用修复:")} ${Y(top.fixPath.join(" → "))} (${top.count}x)`);
    }
}
// ── 6. 抗体效能 ──
step("6/6 抗体效能");
const abStats = (0, failure_corpus_1.getAntibodyStats)();
if (abStats.totalHits === 0) {
    pass("暂无抗体命中（需要更多会话积累）");
}
else {
    const pct = Math.round((abStats.fastPathHits / abStats.totalHits) * 100);
    pass(`${abStats.totalHits} 次命中 | ${abStats.fastPathHits} 快速通道 | ${abStats.totalLLMCallsSaved} 次 LLM 节省 | ${abStats.totalTokensSaved} tokens 节省`);
    console.log(`     ${D("免疫效率:")} ${G(pct + "%")} ${D("绕过 LLM")}`);
}
// ── 7. Progmune Coverage ──
step("7/7 覆盖率");
{
    const { auditDirectory } = require("./audit");
    const srcDir = path.resolve(process.env.PROGMUNE_PROJECT_DIR || process.cwd(), "src");
    const auditResult = auditDirectory(srcDir);
    const pct = Math.round(auditResult.coverage * 100);
    if (pct >= 50) {
        pass(`@progmune-generated 覆盖率 ${pct}% (${auditResult.progmuneFiles}/${auditResult.totalFiles})`);
    }
    else if (pct >= 20) {
        warn(`覆盖率 ${pct}% — 低于 50% 目标 (${auditResult.progmuneFiles}/${auditResult.totalFiles})`);
    }
    else {
        fail(`覆盖率 ${pct}% — 严重低于 20% (${auditResult.progmuneFiles}/${auditResult.totalFiles})`);
    }
    const { getExecutionMetrics } = require("./execute");
    const m = getExecutionMetrics();
    if (m.generated > 0) {
        console.log(`     ${D(`执行次数: ${m.generated} | 修复: ${m.repaired} | 最近: ${m.lastGeneration || '无'}`)}`);
    }
}
// ── 总结 ──
console.log(`\n${"═".repeat(66)}`);
if (failures === 0 && warnings === 0) {
    console.log(`  ${G("✦")}  ${B("免疫状态: 健康")}  — 所有检查通过，SSG 协议正常，零类型错误。`);
}
else if (failures === 0) {
    console.log(`  ${Y("◇")}  ${B("免疫状态: 正常")}  — ${warnings} 个提示，无阻塞性问题。`);
}
else {
    console.log(`  ${R("✖")}  ${B("免疫状态: 需要关注")}  — ${failures} 个失败, ${warnings} 个警告。`);
}
console.log(`${"═".repeat(66)}\n`);
process.exit(failures > 0 ? 1 : 0);
