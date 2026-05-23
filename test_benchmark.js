/**
 * 端到端基准测试
 * ==============
 * 测量约束引擎各环节的性能开销
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

console.log('🧪 端到端基准测试\n');

// ============================================================
// 1. validateActionSequence 性能
// ============================================================
console.log('--- validateActionSequence 性能 ---');

// 构建 100 个函数的 IR
const ir = [];
for (let i = 0; i < 100; i++) {
  ir.push({ name: `func_${i}`, params: [{ name: 'x', type: 'str' }], returnType: 'bool' });
}
fs.writeFileSync(path.join(PROJECT_ROOT, 'ir.json'), JSON.stringify(ir));
Object.keys(require.cache).filter(k => k.includes('validator')).forEach(k => delete require.cache[k]);
const { validateActionSequence } = require('./dist/validator.js');

// 1a. 合法动作序列（100 次调用）
const validActions = [];
for (let i = 0; i < 100; i++) {
  validActions.push({ kind: 'call', function: `func_${i % 100}`, args: [{ name: 'x', type: 'str', value: 'test' }], assignTo: `r${i}` });
}
const start1 = Date.now();
const r1 = validateActionSequence(validActions);
const t1 = Date.now() - start1;
assert(r1.valid, '100 次合法调用通过', `${t1}ms`);

// 1b. 非法动作序列（100 次调用不存在的函数）
const invalidActions = [];
for (let i = 0; i < 100; i++) {
  invalidActions.push({ kind: 'call', function: `no_such_func_${i}`, args: [] });
}
const start1b = Date.now();
const r1b = validateActionSequence(invalidActions);
const t1b = Date.now() - start1b;
assert(!r1b.valid && r1b.errors.length === 100, '100 次非法调用全部拦截', `${t1b}ms, ${r1b.errors.length} 个错误`);

// ============================================================
// 2. checkSemantic 性能
// ============================================================
console.log('\n--- checkSemantic 性能 ---');

const { checkSemantic } = require('./dist/semantic-validator.js');

const irWithContracts = [];
for (let i = 0; i < 50; i++) {
  irWithContracts.push({
    name: `secure_func_${i}`,
    params: [{ name: 'input', type: 'str' }],
    contracts: [
      { type: 'must_be_checked', description: '结果必须检查' },
      { type: 'sequence_after', function: `secure_func_${Math.max(0, i-1)}`, description: '必须顺序执行' }
    ]
  });
}
fs.writeFileSync(path.join(PROJECT_ROOT, 'ir.json'), JSON.stringify(irWithContracts));
delete require.cache[require.resolve('./dist/semantic-validator.js')];
const { checkSemantic: check2 } = require('./dist/semantic-validator.js');

const semActions = [];
for (let i = 0; i < 50; i++) {
  semActions.push({ kind: 'call', function: `secure_func_${i}`, args: [{ name: 'input', type: 'str', value: 'data' }], assignTo: `r${i}` });
}
// 全部没有 if 检查 → 全部违规
const start2 = Date.now();
const r2 = check2('benchmark', semActions);
const t2 = Date.now() - start2;
assert(!r2.valid && r2.errors.length >= 50, '50 个合约全部检测', `${t2}ms, ${r2.errors.length} 个违规`);

// ============================================================
// 3. SSG 状态机性能（1000 次跃迁）
// ============================================================
console.log('\n--- SSG 性能 ---');

const { StateMachineValidator } = require('./dist/ssg-validator.js');

const ssgProtocols = [];
for (let i = 0; i < 50; i++) {
  ssgProtocols.push({
    function: `step_${i}`,
    protocol: { pre_states: [`S${i}`], post_states: [`S${i+1}`], invalidate: [`S${i}`] }
  });
}
const ssv = new StateMachineValidator(ssgProtocols, 'S0');
const start3 = Date.now();
for (let i = 0; i < 50; i++) {
  ssv.apply(`step_${i}`);
}
const t3 = Date.now() - start3;
assert(t3 < 100, 'SSG: 50 次跃迁耗时 < 100ms', `${t3}ms`);

// ============================================================
// 4. 完整 pipeline 模拟（IR → plan → emit）
// ============================================================
console.log('\n--- Pipeline 端到端 ---');

const { emitPython } = require('./dist/python-emitter.js');

const pipelineActions = [
  { kind: 'assign', target: 'email', value: '"user@example.com"' },
  { kind: 'call', function: 'validate_email', args: [{ name: 'email', type: 'str', value: 'email' }], assignTo: 'valid' },
  { kind: 'if', condition: 'valid', thenActions: [
    { kind: 'call', function: 'send_otp', args: [{ name: 'email', type: 'str', value: 'email' }], assignTo: 'sent' }
  ], elseActions: [
    { kind: 'return', value: '"invalid email"' }
  ]}
];

const start4 = Date.now();
const code = emitPython(pipelineActions);
const t4 = Date.now() - start4;
assert(code.length > 0 && code.includes('def main'), 'emitPython: 生成有效 Python 代码', `${t4}ms, ${code.length} 字符`);

// ============================================================
// 5. 内存使用（加载大 IR）
// ============================================================
console.log('\n--- 内存使用 ---');

const hugeIr = [];
for (let i = 0; i < 5000; i++) {
  hugeIr.push({
    name: `f_${i}`,
    params: [{ name: 'p1', type: 'str' }, { name: 'p2', type: 'int' }],
    returnType: 'dict',
    file: 'huge.py'
  });
}
fs.writeFileSync(path.join(PROJECT_ROOT, 'ir.json'), JSON.stringify(hugeIr));
Object.keys(require.cache).filter(k => k.includes('validator')).forEach(k => delete require.cache[k]);
const { validateActionSequence: v5 } = require('./dist/validator.js');

const start5 = Date.now();
const r5 = v5([{ kind: 'call', function: 'f_2500', args: [{ name: 'p1', type: 'str', value: 'x' }, { name: 'p2', type: 'int', value: '1' }] }]);
const t5 = Date.now() - start5;
assert(r5.valid && t5 < 200, '5000 函数 IR 中查找 < 200ms', `${t5}ms`);

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
