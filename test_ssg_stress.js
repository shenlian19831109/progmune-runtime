/**
 * SSG 状态机压力测试
 * ==================
 * 测试大规模状态图下的性能
 */

const { StateMachineValidator } = require('./dist/ssg-validator.js');

const results = { pass: 0, fail: 0, total: 0, details: [] };

function assert(condition, name, detail) {
  results.total++;
  if (condition) { results.pass++; results.details.push({ name, status: '✅', detail }); }
  else { results.fail++; results.details.push({ name, status: '❌', detail }); }
}

console.log('🧪 SSG 状态机压力测试\n');

// ============================================================
// 1. 大规模状态图（20 个状态，30 条跃迁）
// ============================================================
console.log('--- 大规模状态图 (20 states, 30 transitions) ---');

const states = [];
for (let i = 0; i < 20; i++) states.push(`S${i}`);

const protocols = [];
for (let i = 0; i < 19; i++) {
  protocols.push({
    function: `step_${i}`,
    protocol: { pre_states: [states[i]], post_states: [states[i+1]], invalidate: [states[i]] }
  });
}
// 添加一些跨层跃迁
protocols.push({
  function: 'jump',
  protocol: { pre_states: ['S0'], post_states: ['S10'], invalidate: ['S0'] }
});

const start = Date.now();
const ssv = new StateMachineValidator(protocols, 'S0');
for (let i = 0; i < 19; i++) {
  const r = ssv.apply(`step_${i}`);
  if (!r.valid) { console.log(`  失败于 step_${i}: ${r.error}`); break; }
}
const linearTime = Date.now() - start;
assert(linearTime < 100, '大规模状态图: 线性跃迁耗时 < 100ms', `${linearTime}ms`);

// ============================================================
// 2. 非法跃迁检测性能（1000 次调用）
// ============================================================
console.log('\n--- 非法跃迁检测 (1000次) ---');

const ssv2 = new StateMachineValidator(protocols, 'S0');
const start2 = Date.now();
let illegalCount = 0;
for (let i = 0; i < 1000; i++) {
  const r = ssv2.apply('jump');
  if (!r.valid) illegalCount++;
}
const illegalTime = Date.now() - start2;
assert(illegalTime < 500, '非法跃迁检测: 1000 次耗时 < 500ms', `${illegalTime}ms, 拦截 ${illegalCount} 次`);

// ============================================================
// 3. findMissingSteps 性能（复杂图）
// ============================================================
console.log('\n--- findMissingSteps 性能 ---');

// 构建分支状态图：S0 → S1/S2 → S3/S4 → S5
const branchProtocols = [
  { function: 'to_S1', protocol: { pre_states: ['S0'], post_states: ['S1'], invalidate: ['S0'] } },
  { function: 'to_S2', protocol: { pre_states: ['S0'], post_states: ['S2'], invalidate: ['S0'] } },
  { function: 'to_S3', protocol: { pre_states: ['S1'], post_states: ['S3'], invalidate: ['S1'] } },
  { function: 'to_S4', protocol: { pre_states: ['S2'], post_states: ['S4'], invalidate: ['S2'] } },
  { function: 'to_S5', protocol: { pre_states: ['S3', 'S4'], post_states: ['S5'] } },
  // 非法跃迁（用于触发 findMissingSteps）
  { function: 'illegal_final', protocol: { pre_states: ['S5'], post_states: ['DONE'] } },
];

const ssv3 = new StateMachineValidator(branchProtocols, 'S0');
const start3 = Date.now();
const r3 = ssv3.apply('illegal_final');
const missingTime = Date.now() - start3;
assert(r3.valid === false && missingTime < 50, 'findMissingSteps: 分支图耗时 < 50ms', `${missingTime}ms`);

// ============================================================
// 4. 空规则处理
// ============================================================
console.log('\n--- 空规则处理 ---');

const ssv4 = new StateMachineValidator([], 'INIT');
const r4 = ssv4.apply('any_function');
assert(r4.valid === true, '空规则: 任意函数通过', '');

// ============================================================
// 5. 超大规则集（100 条规则）
// ============================================================
console.log('\n--- 超大规则集 (100 rules) ---');

const manyRules = [];
for (let i = 0; i < 100; i++) {
  manyRules.push({
    function: `func_${i}`,
    protocol: { pre_states: [`PRE_${i}`], post_states: [`POST_${i}`] }
  });
}
const start5 = Date.now();
const ssv5 = new StateMachineValidator(manyRules, 'PRE_0');
const r5a = ssv5.apply('func_0');
const r5b = ssv5.apply('func_99');
const manyTime = Date.now() - start5;
assert(r5a.valid === true && r5b.valid === false, '超大规则集: 100 规则初始化+2次调用', `${manyTime}ms`);

// ============================================================
// 6. 状态膨胀（同时处于多个状态）
// ============================================================
console.log('\n--- 多状态并发 ---');

// 注意：grant_role_a/b/c 不移除 INIT，因为需要允许多角色同时存在
const multiStateProtocols = [
  { function: 'grant_role_a', protocol: { pre_states: ['INIT'], post_states: ['ROLE_A'] } },
  { function: 'grant_role_b', protocol: { pre_states: ['INIT'], post_states: ['ROLE_B'] } },
  { function: 'grant_role_c', protocol: { pre_states: ['INIT'], post_states: ['ROLE_C'] } },
  { function: 'access_admin', protocol: { pre_states: ['ROLE_A', 'ROLE_B'], post_states: ['ADMIN'] } },
];
const ssv6 = new StateMachineValidator(multiStateProtocols, 'INIT');
ssv6.apply('grant_role_a');
ssv6.apply('grant_role_b');
const r6a = ssv6.apply('access_admin');
assert(r6a.valid === true, '多状态并发: 同时拥有 ROLE_A+ROLE_B 可访问 admin', 'states: ' + ssv6.getCurrentStates().join(','));

const ssv6b = new StateMachineValidator(multiStateProtocols, 'INIT');
ssv6b.apply('grant_role_a');
const r6b = ssv6b.apply('access_admin');
assert(r6b.valid === false, '多状态并发: 只有 ROLE_A 无法访问 admin', '需要 [ROLE_A,ROLE_B]，当前状态: ' + ssv6b.getCurrentStates().join(','));

// 验证所有三个角色都授予后才能访问
const ssv6c = new StateMachineValidator(multiStateProtocols, 'INIT');
ssv6c.apply('grant_role_a');
ssv6c.apply('grant_role_b');
ssv6c.apply('grant_role_c');
const r6c = ssv6c.apply('access_admin');
assert(r6c.valid === true, '多状态并发: ROLE_A+ROLE_B+ROLE_C 可访问 admin', 'states: ' + ssv6c.getCurrentStates().join(','));

// ============================================================
// 报告
// ============================================================
console.log('\n========================================');
console.log(`结果: ${results.pass}/${results.total} 通过`);
console.log('========================================\n');

results.details.forEach(d => console.log(`  ${d.status} ${d.name}${d.detail ? ' (' + d.detail + ')' : ''}`));

const passRate = (results.pass / results.total * 100).toFixed(0);
console.log(`\n通过率: ${passRate}%`);
process.exit(results.fail > 0 ? 1 : 0);
