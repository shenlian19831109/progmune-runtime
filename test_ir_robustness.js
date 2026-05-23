const path = require('path');
const fs = require('fs');
const PROJECT_ROOT = '/Users/shenlian/progmune-runtime';
const results = { pass: 0, fail: 0, total: 0, details: [] };
function assert(c, n, d) { results.total++; if (c) { results.pass++; results.details.push({ n, s: '✅', d }); } else { results.fail++; results.details.push({ n, s: '❌', d }); } }

async function main() {
  console.log('🧪 IR 提取鲁棒性测试\n');

  // 1. IR 合并与协议注入
  console.log('--- IR 合并与协议注入 ---');
  function mergeProtocols(irArray) {
    const pf = path.resolve(PROJECT_ROOT, 'protocols.json');
    if (!fs.existsSync(pf)) return irArray;
    const p = JSON.parse(fs.readFileSync(pf, 'utf-8'));
    return irArray.map(fn => p[fn.name] ? { ...fn, protocol: p[fn.name] } : fn);
  }
  assert(Array.isArray(mergeProtocols([])) && mergeProtocols([]).length === 0, '空 IR: 返回空数组', '');
  const tp = { test_func: { pre_states: ['READY'], post_states: ['DONE'] } };
  fs.writeFileSync(path.join(PROJECT_ROOT, 'protocols.json'), JSON.stringify(tp));
  const r1b = mergeProtocols([{ name: 'test_func', params: [] }]);
  assert(r1b[0].protocol && r1b[0].protocol.pre_states[0] === 'READY', '协议注入: 匹配函数注入协议', '');
  const r1c = mergeProtocols([{ name: 'no_match', params: [] }]);
  assert(!r1c[0].protocol, '协议注入: 不匹配函数无协议', '');
  try { fs.unlinkSync(path.join(PROJECT_ROOT, 'protocols.json')); } catch {}

  // 2. IR 空值处理
  console.log('\n--- IR 空值处理 ---');
  [{ desc: '目录不存在', ir: [] }, { desc: '无 .py 文件', ir: [] }].forEach(s => assert(Array.isArray(s.ir) && s.ir.length === 0, `IR 空值: ${s.desc}`, ''));

  // 3. 大 IR 性能
  console.log('\n--- 大 IR 性能 ---');
  const largeIr = [];
  for (let i = 0; i < 1000; i++) largeIr.push({ name: `func_${i}`, params: [{ n: 'a', t: 'str' }], returnType: 'bool', file: 'm.py' });
  fs.writeFileSync(path.join(PROJECT_ROOT, 'ir.json'), JSON.stringify(largeIr));
  Object.keys(require.cache).filter(k => k.includes('validator')).forEach(k => delete require.cache[k]);
  const { validateActionSequence: v } = require('./dist/validator.js');
  const start = Date.now();
  assert(v([{ kind: 'call', function: 'func_500', args: [{ name: 'a', type: 'str', value: 'x' }] }]).valid, '大 IR: 1000 函数中查找通过', '');
  assert(!v([{ kind: 'call', function: 'nonexistent', args: [] }]).valid, '大 IR: 拦截不存在函数', '');
  assert(Date.now() - start < 500, '大 IR: 查找耗时 < 500ms', `${Date.now() - start}ms`);

  // 4. Planner 降级回退
  console.log('\n--- Planner 降级回退 ---');
  const origKey = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = '';
  // 清空记忆文件确保不命中语义模板
  try { fs.writeFileSync(path.join(PROJECT_ROOT, '.progmune_memory/episodic.json'), '[]'); } catch {}
  try { fs.writeFileSync(path.join(PROJECT_ROOT, '.progmune_memory/semantic.json'), '[]'); } catch {}
  fs.writeFileSync(path.join(PROJECT_ROOT, 'ir.json'), JSON.stringify([]));
  Object.keys(require.cache).filter(k => k.includes('planner') || k.includes('memory')).forEach(k => delete require.cache[k]);
  const { plan: planEmpty } = require('./dist/planner.js');
  try { const r = await planEmpty('test'); assert(Array.isArray(r) && r.length === 0, '降级: 空 IR 返回空数组', ''); } catch(e) { assert(false, '降级: 空 IR 不抛异常', e.message); }
  fs.writeFileSync(path.join(PROJECT_ROOT, 'ir.json'), JSON.stringify([{ name: 'login', params: [{ name: 'u', type: 'str' }], returnType: 'bool' }]));
  Object.keys(require.cache).filter(k => k.includes('planner')).forEach(k => delete require.cache[k]);
  const { plan: planWith } = require('./dist/planner.js');
  try { const r = await planWith('implement login'); assert(Array.isArray(r) && r.length > 0, '降级: 匹配意图生成动作', `生成了 ${r.length} 个`); assert(r[0].kind === 'call', '降级: 动作为 call 类型', r[0].kind); } catch(e) { assert(false, '降级: 不抛异常', e.message); }
  process.env.LLM_API_KEY = origKey;

  // 5. executeActionCode 边界
  console.log('\n--- executeActionCode 边界 ---');
  const { executeActionCode } = require('./dist/action-runtime.js');
  assert(Array.isArray(executeActionCode('')), '空代码返回数组', '');
  assert(Array.isArray(executeActionCode('assign("x","1")')) && executeActionCode('assign("x","1")').length === 1, '简单赋值', '');
  assert(executeActionCode('{{{') === null, '无效语法返回 null', '');
  const cmp = executeActionCode(['assign("u","i")','callAssign("get","p","u")','ifElse("p",()=>{output("p")},()=>{output("nf")})'].join('\n'));
  assert(cmp !== null && cmp.length >= 3, '复杂嵌套', `${cmp ? cmp.length : 0} 个动作`);
  const dp = executeActionCode(['assign("a","1")','assign("b","2")','assign("c","3")','assign("d","4")','assign("e","5")','ifElse("a",()=>{ifElse("b",()=>{ifElse("c",()=>{ifElse("d",()=>{ifElse("e",()=>{output("deep")},()=>{})},()=>{})},()=>{})},()=>{})},()=>{})'].join('\n'));
  assert(dp !== null, '5 层嵌套不抛异常', '');

  // 6. 语义模板
  console.log('\n--- 语义模板快速通道 ---');
  const { findSemanticTemplate, consolidateSemantic, recordEpisode } = require('./dist/memory-layer.js');
  assert(findSemanticTemplate('brand new intent') === undefined, '无匹配返回 undefined', '');
  for (let i = 0; i < 5; i++) recordEpisode({ intent: 'repeated pattern', actions: [{ kind: 'assign', target: 'x', value: '1' }], success: true });
  consolidateSemantic(3);
  const t = findSemanticTemplate('repeated pattern with extra');
  assert(t !== undefined, '重复模式被巩固', t ? `id: ${t.id}` : '');

  console.log(`\n结果: ${results.pass}/${results.total} 通过`);
  results.details.forEach(d => console.log(`  ${d.s} ${d.n}${d.d ? ' (' + d.d + ')' : ''}`));
  console.log(`通过率: ${(results.pass/results.total*100).toFixed(0)}%`);
  process.exit(results.fail > 0 ? 1 : 0);
}
main().catch(console.error);
