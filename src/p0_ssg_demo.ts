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

import { StateMachineValidator, SSGRejection, FunctionProtocol } from './ssg-validator';
import { extractIR } from './extract-ir';
import * as fs from 'fs';
import * as path from 'path';

function loadProtocolsFromFile(filePath: string): { protocols: FunctionProtocol[]; initialState: string } {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const protocols: FunctionProtocol[] = [];
  for (const [funcName, rule] of Object.entries(raw.rules || {})) {
    const r = rule as any;
    protocols.push({
      function: funcName,
      protocol: {
        pre_states: r.pre_states || [],
        post_states: r.post_states || [],
        invalidate: r.invalidate,
      },
    });
  }
  return { protocols, initialState: raw.initialState || 'INIT' };
}

function loadProtocolsFromIR(ir: any[]): FunctionProtocol[] {
  return ir
    .filter((f: any) => f.protocol)
    .map((f: any) => ({ function: f.name, protocol: f.protocol }));
}

function runDemo() {
  console.log('═══ Progmune SSG 端到端演示 ═══\n');

  // 1) 加载协议
  const protocolsJson = path.join(__dirname, '..', 'protocols.json');
  const fromFile = fs.existsSync(protocolsJson)
    ? loadProtocolsFromFile(protocolsJson)
    : { protocols: [] as FunctionProtocol[], initialState: 'INIT' };

  // 2) 从 IR 加载协议（@protocol JSDoc 注解）
  const ir = extractIR(path.join(__dirname, '..', 'demo-project'));
  const fromIR = loadProtocolsFromIR(ir);

  // 合并协议
  const allProtocols = [...fromFile.protocols, ...fromIR];
  const uniqueProtocols = new Map<string, FunctionProtocol>();
  allProtocols.forEach(p => uniqueProtocols.set(p.function, p));
  const protocols = [...uniqueProtocols.values()];

  console.log(`📋 已加载 ${protocols.length} 条协议规则:`);
  protocols.forEach(p => {
    console.log(`   ${p.function}: [${p.protocol.pre_states.join(', ')}] → [${p.protocol.post_states.join(', ')}]`);
  });
  console.log();

  // 3) 合法序列
  console.log('── 场景 1: 合法序列 ──');
  const legalSequence = ['verify_password', 'generate_jwt', 'create_session'];
  const ssv1 = new StateMachineValidator(protocols, fromFile.initialState);
  let allPassed = true;

  for (const fn of legalSequence) {
    const result = ssv1.apply(fn);
    if (!result.valid) {
      console.log(StateMachineValidator.explainRejection(result.rejection!));
      allPassed = false;
      break;
    } else {
      console.log(`  ✅ ${fn} → [${result.statesAfter.join(', ')}]`);
    }
  }
  if (allPassed) console.log('  ✔ 合法序列全部通过\n');

  // 4) 非法序列 — 跳过前置步骤
  console.log('── 场景 2: 跳过前置步骤 ──');
  const ssv2 = new StateMachineValidator(protocols, fromFile.initialState);
  const badSequence1 = ['generate_jwt', 'create_session'];
  for (const fn of badSequence1) {
    const result = ssv2.apply(fn);
    if (!result.valid) {
      console.log(StateMachineValidator.explainRejection(result.rejection!));
      console.log();
      // 输出结构化 JSON
      console.log('  📊 结构化报告:');
      console.log('  ' + JSON.stringify(StateMachineValidator.rejectionToJSON(result.rejection!), null, 2).replace(/\n/g, '\n  '));
      break;
    }
    console.log(`  ✅ ${fn} → [${result.statesAfter.join(', ')}]`);
  }

  // 5) 非法序列 — 调用后被撤销
  console.log('\n── 场景 3: 令牌签发后，令牌状态已被消费 ──');
  const ssv3 = new StateMachineValidator(protocols, fromFile.initialState);
  ssv3.apply('verify_password');   // UNAUTHENTICATED → PASSWORD_VERIFIED
  ssv3.apply('generate_jwt');      // PASSWORD_VERIFIED → TOKEN_ISSUED (PASSWORD_VERIFIED 失效)
  ssv3.apply('create_session');    // TOKEN_ISSUED → SESSION_ACTIVE (TOKEN_ISSUED 失效)

  // 尝试再次 generate_jwt — 需要 PASSWORD_VERIFIED，但已被 invalidate
  const result3 = ssv3.apply('generate_jwt');
  if (!result3.valid) {
    console.log(StateMachineValidator.explainRejection(result3.rejection!));
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
}

runDemo();
