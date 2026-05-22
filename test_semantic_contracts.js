/**
 * 语义合约专项测试
 * ==================
 * 覆盖四种合约类型的全部边界情况
 *
 * checkSemantic 返回语义：
 *   valid = true  → 语义检查通过（无合约违规）
 *   valid = false → 存在合约违规
 */

const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = '/Users/shenlian/progmune-runtime';
const results = { pass: 0, fail: 0, total: 0, details: [] };

function assert(condition, name, detail) {
  results.total++;
  if (condition) { results.pass++; results.details.push({ name, status: '✅', detail }); }
  else { results.fail++; results.details.push({ name, status: '❌', detail }); }
}

function writeIr(ir) {
  fs.writeFileSync(path.join(PROJECT_ROOT, 'ir.json'), JSON.stringify(ir, null, 2));
  delete require.cache[require.resolve('./dist/semantic-validator.js')];
}

function reloadChecker() {
  delete require.cache[require.resolve('./dist/semantic-validator.js')];
  return require('./dist/semantic-validator.js').checkSemantic;
}

console.log('🧪 语义合约专项测试\n');

// ============================================================
// 1. must_be_checked
// ============================================================
console.log('--- must_be_checked ---');

let checkSemantic = reloadChecker();

writeIr([{
  name: 'verify_password',
  contracts: [{ type: 'must_be_checked', description: '密码验证结果必须用于条件判断' }]
}]);

// 1a. 返回值用于 if → valid true（合约满足）
const r1a = checkSemantic('login', [
  { kind: 'call', function: 'verify_password', args: [], assignTo: 'ok' },
  { kind: 'if', condition: 'ok', thenActions: [] }
]);
assert(r1a.valid === true, 'must_be_checked: 返回值用于 if 通过', '');

// 1b. 返回值未用于 if → valid false（合约违规）
const r1b = checkSemantic('login', [
  { kind: 'call', function: 'verify_password', args: [], assignTo: 'ok' }
]);
assert(r1b.valid === false && r1b.errors.some(e => e.includes('verify_password')), 'must_be_checked: 返回值未用于 if 拦截', r1b.errors.join('; '));

// 1c. 未使用 assignTo 保存返回值 → valid false
const r1c = checkSemantic('login', [
  { kind: 'call', function: 'verify_password', args: [] }
]);
assert(r1c.valid === false && r1c.errors.some(e => e.includes('未使用assignTo')), 'must_be_checked: 未使用 assignTo 拦截', r1c.errors.join('; '));

// ============================================================
// 2. sequence_after
// ============================================================
console.log('\n--- sequence_after ---');

checkSemantic = reloadChecker();

writeIr([{
  name: 'generate_jwt',
  contracts: [{ type: 'sequence_after', function: 'verify_password', description: '签发令牌前必须先验证密码' }]
}]);

// 2a. verify_password 在 generate_jwt 之前 → valid true
const r2a = checkSemantic('login', [
  { kind: 'call', function: 'verify_password', args: [], assignTo: 'ok' },
  { kind: 'if', condition: 'ok', thenActions: [
    { kind: 'call', function: 'generate_jwt', args: [] }
  ]}
]);
assert(r2a.valid === true, 'sequence_after: 先验证后签发通过', '');

// 2b. generate_jwt 在 verify_password 之前 → valid false
const r2b = checkSemantic('login', [
  { kind: 'call', function: 'generate_jwt', args: [] },
  { kind: 'call', function: 'verify_password', args: [], assignTo: 'ok' }
]);
assert(r2b.valid === false && r2b.errors.some(e => e.includes('generate_jwt')), 'sequence_after: 跳过验证直接签发拦截', r2b.errors.join('; '));

// 2c. verify_password 从未被调用 → valid false
const r2c = checkSemantic('login', [
  { kind: 'call', function: 'generate_jwt', args: [] }
]);
assert(r2c.valid === false && r2c.errors.some(e => e.includes('generate_jwt')), 'sequence_after: 缺少前置函数拦截', r2c.errors.join('; '));

// 2d. 链式依赖 A→B→C（C 需要在 B 之后，但 B 在 C 之后出现）
checkSemantic = reloadChecker();
writeIr([{
  name: 'C',
  contracts: [{ type: 'sequence_after', function: 'B', description: 'C 必须在 B 之后' }]
}]);
const r2d = checkSemantic('test', [
  { kind: 'call', function: 'A', args: [] },
  { kind: 'call', function: 'C', args: [] },
  { kind: 'call', function: 'B', args: [] }
]);
assert(r2d.valid === false && r2d.errors.some(e => e.includes('C')), 'sequence_after: 链式依赖 A→B→C 拦截', r2d.errors.join('; '));

// ============================================================
// 3. param_from
// ============================================================
console.log('\n--- param_from ---');

checkSemantic = reloadChecker();

writeIr([{
  name: 'create_session',
  params: [{ name: 'token', type: 'str' }],
  contracts: [{ type: 'param_from', param: 'token', function: 'generate_jwt', description: 'session 的 token 必须来自 generate_jwt' }]
}]);

// 3a. token 来自 generate_jwt 的输出 → valid true
const r3a = checkSemantic('login', [
  { kind: 'call', function: 'generate_jwt', args: [], assignTo: 'jwt' },
  { kind: 'call', function: 'create_session', args: [{ name: 'token', type: 'str', value: 'jwt' }] }
]);
assert(r3a.valid === true, 'param_from: token 来自 generate_jwt 通过', '');

// 3b. token 不来自 generate_jwt → valid false
const r3b = checkSemantic('login', [
  { kind: 'call', function: 'generate_jwt', args: [], assignTo: 'other' },
  { kind: 'call', function: 'create_session', args: [{ name: 'token', type: 'str', value: 'manual_token' }] }
]);
assert(r3b.valid === false && r3b.errors.some(e => e.includes('create_session')), 'param_from: token 不来自 generate_jwt 拦截', r3b.errors.join('; '));

// 3c. generate_jwt 从未被调用 → valid false
const r3c = checkSemantic('login', [
  { kind: 'call', function: 'create_session', args: [{ name: 'token', type: 'str', value: 'jwt' }] }
]);
assert(r3c.valid === false && r3c.errors.some(e => e.includes('create_session')), 'param_from: generate_jwt 未调用拦截', r3c.errors.join('; '));

// 3d. 多级传递 A→B→C（C 的 input 必须来自 B，但实际来自 A）
checkSemantic = reloadChecker();
writeIr([{
  name: 'C',
  params: [{ name: 'input', type: 'str' }],
  contracts: [{ type: 'param_from', param: 'input', function: 'B', description: 'C 的 input 必须来自 B' }]
}]);
const r3d = checkSemantic('test', [
  { kind: 'call', function: 'A', args: [], assignTo: 'a_val' },
  { kind: 'call', function: 'C', args: [{ name: 'input', type: 'str', value: 'a_val' }] }
]);
assert(r3d.valid === false && r3d.errors.some(e => e.includes('C')), 'param_from: 多级传递 A→C 跳过 B 拦截', r3d.errors.join('; '));

// ============================================================
// 4. when_intent
// ============================================================
console.log('\n--- when_intent ---');

checkSemantic = reloadChecker();

writeIr([{
  name: 'send_otp',
  contracts: [{ type: 'must_be_checked', when_intent: ['login', 'signin'], description: '登录场景下 OTP 结果必须检查' }]
}]);

// 4a. 意图匹配时合约生效 → valid false
const r4a = checkSemantic('user login flow', [
  { kind: 'call', function: 'send_otp', args: [], assignTo: 'code' }
]);
assert(r4a.valid === false && r4a.errors.some(e => e.includes('send_otp')), 'when_intent: 意图匹配时合约生效', r4a.errors.join('; '));

// 4b. 意图不匹配时合约静默跳过 → valid true
const r4b = checkSemantic('query report data', [
  { kind: 'call', function: 'send_otp', args: [], assignTo: 'code' }
]);
assert(r4b.valid === true, 'when_intent: 意图不匹配时合约跳过', '');

// 4c. when_intent 未设置时始终生效
checkSemantic = reloadChecker();
writeIr([{
  name: 'check_access',
  contracts: [{ type: 'must_be_checked', description: '访问检查结果必须用于条件判断' }]
}]);
const r4c = checkSemantic('any intent here', [
  { kind: 'call', function: 'check_access', args: [], assignTo: 'result' }
]);
assert(r4c.valid === false && r4c.errors.some(e => e.includes('check_access')), 'when_intent: 未设置时始终生效', r4c.errors.join('; '));

// ============================================================
// 5. require_param
// ============================================================
console.log('\n--- require_param ---');

checkSemantic = reloadChecker();

writeIr([{
  name: 'send_email',
  params: [{ name: 'to', type: 'str' }],
  contracts: [{ type: 'require_param', param: 'to', not_empty: true, description: '收件人地址不能为空' }]
}]);

// 5a. 参数为空模板 → valid false
const r5a = checkSemantic('send', [
  { kind: 'call', function: 'send_email', args: [{ name: 'to', type: 'str', value: '{}' }] }
]);
assert(r5a.valid === false && r5a.errors.some(e => e.includes('send_email')), 'require_param: 空模板参数拦截', r5a.errors.join('; '));

// 5b. 参数为空字符串 → valid false
const r5b = checkSemantic('send', [
  { kind: 'call', function: 'send_email', args: [{ name: 'to', type: 'str', value: '' }] }
]);
assert(r5b.valid === false && r5b.errors.some(e => e.includes('send_email')), 'require_param: 空字符串拦截', r5b.errors.join('; '));

// 5c. 参数正常 → valid true
const r5c = checkSemantic('send', [
  { kind: 'call', function: 'send_email', args: [{ name: 'to', type: 'str', value: 'user@example.com' }] }
]);
assert(r5c.valid === true, 'require_param: 正常参数通过', '');

// ============================================================
// 6. 组合合约
// ============================================================
console.log('\n--- 组合合约 ---');

checkSemantic = reloadChecker();

writeIr([{
  name: 'process_payment',
  params: [{ name: 'amount', type: 'int' }],
  contracts: [
    { type: 'sequence_after', function: 'validate_user', description: '支付前必须验证用户' },
    { type: 'must_be_checked', description: '支付结果必须检查' }
  ]
}]);

// 6a. 两个合约都违规 → valid false
const r6a = checkSemantic('pay', [
  { kind: 'call', function: 'process_payment', args: [{ name: 'amount', type: 'int', value: 100 }], assignTo: 'pay_result' }
]);
assert(r6a.valid === false && r6a.errors.length >= 1, '组合合约: 两个都违规拦截', r6a.errors.join('; '));

// 6b. 两个合约都满足 → valid true
const r6b = checkSemantic('pay', [
  { kind: 'call', function: 'validate_user', args: [] },
  { kind: 'call', function: 'process_payment', args: [{ name: 'amount', type: 'int', value: 100 }], assignTo: 'pay_result' },
  { kind: 'if', condition: 'pay_result', thenActions: [] }
]);
assert(r6b.valid === true, '组合合约: 都满足时通过', '');

// ============================================================
// 报告
// ============================================================
console.log('\n========================================');
console.log(`结果: ${results.pass}/${results.total} 通过`);
console.log('========================================\n');

results.details.forEach(d => {
  console.log(`  ${d.status} ${d.name}`);
  if (d.detail) console.log(`     ${d.detail}`);
});

const passRate = (results.pass / results.total * 100).toFixed(0);
console.log(`\n通过率: ${passRate}%`);
process.exit(results.fail > 0 ? 1 : 0);
