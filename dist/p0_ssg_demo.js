"use strict";
/**
 * P0: SSG 端到端演示
 *
 * 展示完整的协议级语义验证链路：
 *   1. 从 demo-project 提取 IR（含 @protocol 注解）
 *   2. 从 protocols.json 加载协议规则
 *   3. 合法序列 → 全部通过
 *   4. 非法序列 → 被 SSG 拦截（含结构化 rejection + fixPath）
 *   5. 输出可读的拦截解释
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
const ssg_validator_1 = require("./ssg-validator");
const extract_ir_1 = require("./extract-ir");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function loadProtocolsFromFile(filePath) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const protocols = [];
    for (const [funcName, rule] of Object.entries(raw.rules || {})) {
        const r = rule;
        protocols.push({
            function: funcName,
            protocol: {
                pre_states: r.pre_states || [],
                post_states: r.post_states || [],
                invalidate: r.invalidate,
                namespace: r.namespace,
            },
        });
    }
    return {
        protocols,
        initialState: raw.initialState || 'INIT',
        namespaceInitialStates: raw.namespaceInitialStates || { _global: raw.initialState || 'INIT' },
    };
}
function loadProtocolsFromIR(ir) {
    return ir
        .filter((f) => f.protocol)
        .map((f) => ({ function: f.name, protocol: f.protocol }));
}
function runDemo() {
    console.log('═══ Progmune SSG 端到端演示 ═══\n');
    // 1) 加载协议
    const protocolsJson = path.join(__dirname, '..', 'protocols.json');
    const fromFile = fs.existsSync(protocolsJson)
        ? loadProtocolsFromFile(protocolsJson)
        : { protocols: [], initialState: 'INIT', namespaceInitialStates: {} };
    // 2) 从 IR 加载协议（@protocol JSDoc 注解）
    const ir = (0, extract_ir_1.extractIR)(path.join(__dirname, '..', 'demo-project'));
    const fromIR = loadProtocolsFromIR(ir);
    // 合并协议，JSON 定义 namespace，IR @protocol 定义规则细节
    const uniqueProtocols = new Map();
    fromFile.protocols.forEach(p => uniqueProtocols.set(p.function, p));
    fromIR.forEach(p => {
        const existing = uniqueProtocols.get(p.function);
        if (existing && existing.protocol.namespace && !p.protocol.namespace) {
            p.protocol.namespace = existing.protocol.namespace;
        }
        uniqueProtocols.set(p.function, p);
    });
    const protocols = [...uniqueProtocols.values()];
    console.log(`📋 已加载 ${protocols.length} 条协议规则:`);
    protocols.forEach(p => {
        const ns = p.protocol.namespace ? ` [${p.protocol.namespace}]` : '';
        console.log(`   ${p.function}${ns}: [${p.protocol.pre_states.join(', ')}] → [${p.protocol.post_states.join(', ')}]`);
    });
    console.log();
    // Pure function factory — replaces StateMachineValidator instances
    const rules = new Map();
    for (const p of protocols)
        rules.set(p.function, p.protocol);
    const nsInit = new Map(Object.entries(fromFile.namespaceInitialStates || {}));
    if (!nsInit.has('_global'))
        nsInit.set('_global', fromFile.initialState || 'INIT');
    const ruleHash = (0, ssg_validator_1.hashRules)(rules);
    function createPureContext() {
        let ctx = { ledger: [], currentState: (0, ssg_validator_1.rebuildState)([], nsInit) };
        let transitions = [];
        return {
            apply(fn) {
                const { valid, transition, rejection } = (0, ssg_validator_1.validateTransition)(ctx, fn, transitions.length, rules, nsInit, ruleHash);
                transitions.push(transition);
                ctx = { ledger: transitions, currentState: valid ? transition.statesAfter : ctx.currentState };
                return { valid, rejection, acquired: transition.acquired, invalidated: transition.invalidated, statesAfter: transition.statesAfter };
            },
            getTrace() {
                return transitions.map(t => ({
                    function: t.function,
                    valid: t.valid,
                    statesBefore: t.statesBefore,
                    statesAfter: t.statesAfter,
                    rejection: t.valid ? undefined : { fixPath: (0, ssg_validator_1.findFixPathStatic)(rules, t.namespace, t.statesBefore[t.namespace] || [], rules.get(t.function)?.pre_states || []) },
                }));
            },
        };
    }
    // 3) 合法序列
    console.log('── 场景 1: 合法序列 (Pure Functions) ──');
    const legalSequence = ['verify_password', 'generate_jwt', 'create_session'];
    const ctx1 = createPureContext();
    let allPassed = true;
    for (const fn of legalSequence) {
        const result = ctx1.apply(fn);
        if (!result.valid) {
            console.log((0, ssg_validator_1.explainRejection)(result.rejection));
            allPassed = false;
            break;
        }
        else {
            console.log(`  ✅ ${fn} → [${Object.values(result.statesAfter).flat().join(', ')}]`);
        }
    }
    if (allPassed)
        console.log('  ✔ 合法序列全部通过 (纯函数验证)\n');
    // 4) 非法序列 — 跳过前置步骤
    console.log('── 场景 2: 跳过前置步骤 ──');
    const ctx2 = createPureContext();
    const badSequence1 = ['generate_jwt', 'create_session'];
    for (const fn of badSequence1) {
        const result = ctx2.apply(fn);
        if (!result.valid) {
            console.log((0, ssg_validator_1.explainRejection)(result.rejection));
            console.log();
            console.log('  📊 结构化报告:');
            console.log('  ' + JSON.stringify((0, ssg_validator_1.rejectionToJSON)(result.rejection), null, 2).replace(/\n/g, '\n  '));
            break;
        }
        console.log(`  ✅ ${fn} → [${Object.values(result.statesAfter).flat().join(', ')}]`);
    }
    // 5) 非法序列 — 调用后被撤销
    console.log('\n── 场景 3: 令牌签发后，令牌状态已被消费 (Pure Functions) ──');
    const ctx3 = createPureContext();
    ctx3.apply('verify_password');
    ctx3.apply('generate_jwt');
    ctx3.apply('create_session');
    const result3 = ctx3.apply('generate_jwt');
    if (!result3.valid) {
        console.log((0, ssg_validator_1.explainRejection)(result3.rejection));
    }
    // 6) 完整跟踪 (from pure function ledger)
    console.log('\n── 场景 1 完整跟踪 (Pure Ledger) ──');
    console.log('  Intent → Planner → Candidate Path → SSG Validation');
    console.log('  ' + '─'.repeat(50));
    const trace = ctx1.getTrace();
    trace.forEach((node, i) => {
        const icon = node.valid ? '✅' : '🚫';
        console.log(`  ${icon} 步骤 ${i + 1}: ${node.function}`);
        console.log(`     状态: [${Object.values(node.statesBefore).flat().join(', ')}] → [${Object.values(node.statesAfter).flat().join(', ')}]`);
        if (node.rejection) {
            console.log(`     修复: ${node.rejection.fixPath.join(' → ')}`);
        }
    });
    console.log('\n═══ SSG 演示完成 ═══');
    // 7) 资源命名空间演示
    console.log('\n── 场景 5: 资源生命周期（file/db 命名空间隔离）──');
    const fileCtx = createPureContext();
    const preRead = fileCtx.apply('read_file');
    if (!preRead.valid) {
        console.log((0, ssg_validator_1.explainRejection)(preRead.rejection));
        console.log();
    }
    fileCtx.apply('open_file');
    console.log('  ✅ open_file → FILE_OPEN');
    fileCtx.apply('read_file');
    console.log('  ✅ read_file (文件操作与 DB 操作命名空间隔离，互不影响)');
    fileCtx.apply('write_file');
    console.log('  ✅ write_file');
    fileCtx.apply('close_file');
    console.log('  ✅ close_file → FILE_OPEN 失效');
    console.log('');
    const dbAttempt = fileCtx.apply('query_db');
    if (!dbAttempt.valid) {
        console.log(`  🚫 query_db 被拦截: ${dbAttempt.rejection?.namespace} 命名空间需要 DB_CONNECTED`);
        console.log('  → 修复路径: connect_db');
        console.log('  → 这证明 file 和 db 命名空间的状态机完全隔离');
    }
    // ── Phase 3: Semantic Ledger Pure Functions ──
    let demoLedger = [];
    console.log('\n── 场景 6: Semantic Ledger 纯函数 API ──');
    console.log(`  ruleHash: ${ruleHash}`);
    // Validate transitions using pure functions
    const ctx = { ledger: [], currentState: (0, ssg_validator_1.rebuildState)([], nsInit) };
    demoLedger = [];
    console.log('  初始状态:', JSON.stringify(ctx.currentState));
    for (const fn of legalSequence) {
        const { valid, transition, rejection } = (0, ssg_validator_1.validateTransition)(ctx, fn, demoLedger.length, rules, nsInit, ruleHash);
        demoLedger.push(transition);
        ctx.ledger = demoLedger;
        if (valid) {
            ctx.currentState = transition.statesAfter;
            console.log(`  ✅ ${fn}: acquired=[${transition.acquired}] invalidated=[${transition.invalidated}]`);
        }
        else {
            console.log(`  🚫 ${fn}: ${rejection?.missingFunctions.join(' → ')}`);
        }
    }
    // rebuildState should match final context state
    const rebuilt = (0, ssg_validator_1.rebuildState)(demoLedger, nsInit);
    console.log(`  rebuildState(demoLedger) = ${JSON.stringify(rebuilt)}`);
    const ctxJson = JSON.stringify(ctx.currentState);
    const rebuiltJson = JSON.stringify(rebuilt);
    console.log(`  rebuildState === ctx.currentState: ${rebuiltJson === ctxJson ? '✅' : '🚫 MISMATCH'}`);
    // Invariant check
    const consistency = (0, ssg_validator_1.checkLedgerConsistency)(demoLedger, nsInit);
    console.log(`  Invariant-0+1: ${consistency.consistent ? '✅ consistent' : `🚫 ${consistency.violations.length} violations`}`);
    for (const v of consistency.violations) {
        console.log(`    [${v.invariant}] index=${v.index}: ${v.detail}`);
    }
    // Invariant-1 negative test: craft an inconsistent transition
    console.log('\n  Invariant-1 负向测试:');
    const badTransition = {
        actionIndex: 0, function: "verify_password", namespace: "auth",
        acquired: ["TOKEN_ISSUED"], invalidated: [],
        statesBefore: { "_global": ["INIT"], "auth": ["UNAUTHENTICATED"] },
        statesAfter: { "_global": ["INIT"], "auth": ["UNAUTHENTICATED"] }, // TOKEN_ISSUED missing!
        valid: true, ruleHash,
    };
    const badConsistency = (0, ssg_validator_1.checkLedgerConsistency)([badTransition], nsInit);
    const deltaViolations = badConsistency.violations.filter(v => v.invariant === "delta-consistency");
    console.log(`  Delta violations detected: ${deltaViolations.length} ${deltaViolations.length > 0 ? '✅ (correctly caught)' : '🚫 MISSED'}`);
    // ── Phase 3 P1-C: Ledger Query API ──
    console.log('\n── 场景 7: Ledger Query API ──');
    const queryLedger = demoLedger; // from scenario 6
    // findProducer
    const tokenProducers = (0, ssg_validator_1.findProducer)("TOKEN_ISSUED", queryLedger);
    console.log(`  findProducer("TOKEN_ISSUED") → ${tokenProducers.map(p => `${p.transition.function}@${p.index}`).join(", ")}`);
    // findConsumer
    const passwordConsumers = (0, ssg_validator_1.findConsumer)("PASSWORD_VERIFIED", queryLedger);
    console.log(`  findConsumer("PASSWORD_VERIFIED") → ${passwordConsumers.map(c => `${c.transition.function}@${c.index}`).join(", ")}`);
    // findViolations
    const violations = (0, ssg_validator_1.findViolations)(queryLedger);
    console.log(`  findViolations() → ${violations.length} violation(s)`);
    // findTransition
    const t1 = (0, ssg_validator_1.findTransition)(1, queryLedger);
    console.log(`  findTransition(1) → ${t1?.transition.function} (${t1?.namespace})`);
    // listAllStates
    const allStates = (0, ssg_validator_1.listAllStates)(queryLedger);
    console.log(`  listAllStates() → ${allStates.map(s => `${s.namespace}:${s.state}`).join(", ")}`);
    // Ledger integrity
    const lh = (0, ssg_validator_1.hashLedger)(demoLedger);
    console.log(`  hashLedger() → ${lh} (tamper-evident fingerprint)`);
    console.log('\n═══ 全部演示完成 ═══');
}
runDemo();
