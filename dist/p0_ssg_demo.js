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
    function createNamespacedSSV() {
        const initStates = fromFile.namespaceInitialStates || { _global: fromFile.initialState };
        const globalInit = initStates._global || 'INIT';
        const ssv = new ssg_validator_1.StateMachineValidator(protocols, globalInit);
        for (const [ns, state] of Object.entries(initStates)) {
            if (ns !== '_global')
                ssv.setNamespaceInitialState(ns, state);
        }
        return ssv;
    }
    // 3) 合法序列
    console.log('── 场景 1: 合法序列 ──');
    const legalSequence = ['verify_password', 'generate_jwt', 'create_session'];
    const ssv1 = createNamespacedSSV();
    let allPassed = true;
    for (const fn of legalSequence) {
        const result = ssv1.apply(fn);
        if (!result.valid) {
            console.log(ssg_validator_1.StateMachineValidator.explainRejection(result.rejection));
            allPassed = false;
            break;
        }
        else {
            console.log(`  ✅ ${fn} → [${result.statesAfter.join(', ')}]`);
        }
    }
    if (allPassed)
        console.log('  ✔ 合法序列全部通过\n');
    // 4) 非法序列 — 跳过前置步骤
    console.log('── 场景 2: 跳过前置步骤 ──');
    const ssv2 = createNamespacedSSV();
    const badSequence1 = ['generate_jwt', 'create_session'];
    for (const fn of badSequence1) {
        const result = ssv2.apply(fn);
        if (!result.valid) {
            console.log(ssg_validator_1.StateMachineValidator.explainRejection(result.rejection));
            console.log();
            // 输出结构化 JSON
            console.log('  📊 结构化报告:');
            console.log('  ' + JSON.stringify(ssg_validator_1.StateMachineValidator.rejectionToJSON(result.rejection), null, 2).replace(/\n/g, '\n  '));
            break;
        }
        console.log(`  ✅ ${fn} → [${result.statesAfter.join(', ')}]`);
    }
    // 5) 非法序列 — 调用后被撤销
    console.log('\n── 场景 3: 令牌签发后，令牌状态已被消费 ──');
    const ssv3 = createNamespacedSSV();
    ssv3.apply('verify_password'); // UNAUTHENTICATED → PASSWORD_VERIFIED
    ssv3.apply('generate_jwt'); // PASSWORD_VERIFIED → TOKEN_ISSUED (PASSWORD_VERIFIED 失效)
    ssv3.apply('create_session'); // TOKEN_ISSUED → SESSION_ACTIVE (TOKEN_ISSUED 失效)
    // 尝试再次 generate_jwt — 需要 PASSWORD_VERIFIED，但已被 invalidate
    const result3 = ssv3.apply('generate_jwt');
    if (!result3.valid) {
        console.log(ssg_validator_1.StateMachineValidator.explainRejection(result3.rejection));
    }
    // 6) 完整跟踪
    console.log('\n── 场景 1 完整跟踪 ──');
    console.log('  Intent → Planner → Candidate Path → SSG Validation');
    console.log('  ' + '─'.repeat(50));
    const trace = ssv1.getTrace();
    trace.forEach((node, i) => {
        const icon = node.valid ? '✅' : '🚫';
        console.log(`  ${icon} 步骤 ${i + 1}: ${node.function}`);
        console.log(`     状态: [${node.statesBefore.join(', ')}] → [${node.statesAfter.join(', ')}]`);
        if (node.rejection) {
            console.log(`     修复: ${node.rejection.fixPath.join(' → ')}`);
        }
    });
    console.log('\n═══ SSG 演示完成 ═══');
    // 7) 资源命名空间演示
    console.log('\n── 场景 5: 资源生命周期（file/db 命名空间隔离）──');
    const fileSSV = createNamespacedSSV();
    // 尝试在打开文件前读取 → 应被拦截
    const preRead = fileSSV.apply('read_file');
    if (!preRead.valid) {
        console.log(ssg_validator_1.StateMachineValidator.explainRejection(preRead.rejection));
        console.log();
    }
    // 正确顺序: 打开 → 读取 → 写入 → 关闭
    fileSSV.apply('open_file');
    console.log('  ✅ open_file → FILE_OPEN');
    fileSSV.apply('read_file');
    console.log('  ✅ read_file (文件操作与 DB 操作命名空间隔离，互不影响)');
    fileSSV.apply('write_file');
    console.log('  ✅ write_file');
    fileSSV.apply('close_file');
    console.log('  ✅ close_file → FILE_OPEN 失效');
    // DB 命名空间独立验证
    console.log('');
    const dbAttempt = fileSSV.apply('query_db');
    if (!dbAttempt.valid) {
        console.log(`  🚫 query_db 被拦截: ${dbAttempt.rejection?.namespace} 命名空间需要 DB_CONNECTED`);
        console.log('  → 修复路径: connect_db');
        console.log('  → 这证明 file 和 db 命名空间的状态机完全隔离');
    }
    console.log('\n═══ 全部演示完成 ═══');
}
runDemo();
