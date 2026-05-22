/**
 * 并发安全测试
 * ============
 * 测试 feedback.json 和 Failure Corpus 在并发写入时的数据完整性
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

async function main() {
  console.log('🧪 并发安全测试\n');

  // ============================================================
  // 1. feedback.json 并发写入
  // ============================================================
  console.log('--- feedback.json 并发写入 ---');

  const feedbackPath = path.join(PROJECT_ROOT, 'feedback.json');
  const backup = fs.existsSync(feedbackPath) ? fs.readFileSync(feedbackPath, 'utf-8') : null;
  fs.writeFileSync(feedbackPath, '[]');

  const { recordRun } = require('./dist/feedback.js');

  const concurrency = 20;
  const promises = [];
  for (let i = 0; i < concurrency; i++) {
    promises.push(new Promise(resolve => {
      setImmediate(() => {
        try { recordRun(`test_concurrent_${i}`, [{ kind: 'call', function: `func_${i}`, args: [] }], true); } catch(e) {}
        resolve();
      });
    }));
  }
  await Promise.all(promises);
  await new Promise(r => setTimeout(r, 500));

  const feedbackData = JSON.parse(fs.readFileSync(feedbackPath, 'utf-8'));
  assert(feedbackData.length === concurrency, 'feedback.json: 并发 20 次写入不丢数据', `期望 ${concurrency} 条，实际 ${feedbackData.length} 条`);
  if (backup) fs.writeFileSync(feedbackPath, backup);

  // ============================================================
  // 2. Failure Corpus 并发写入
  // ============================================================
  console.log('\n--- Failure Corpus 并发写入 ---');

  const { recordFailure, getAllFailures } = require('./dist/failure-corpus.js');

  const beforeCount = getAllFailures().length;
  const concurrency2 = 30;
  const promises2 = [];

  for (let i = 0; i < concurrency2; i++) {
    promises2.push(new Promise(resolve => {
      setImmediate(() => {
        try {
          recordFailure({
            intent: `concurrent_test_${i}`,
            projectFunctions: ['f'],
            violatedSVL: 'SVL-1',
            constraintType: 'symbol_existence',
            actionSequence: [],
            errorDetail: 'concurrent test'
          });
        } catch(e) {}
        resolve();
      });
    }));
  }
  await Promise.all(promises2);
  await new Promise(r => setTimeout(r, 500));

  const afterCount = getAllFailures().length;
  assert(afterCount - beforeCount === concurrency2, 'Failure Corpus: 并发 30 次写入不丢数据', `期望新增 ${concurrency2} 条，实际新增 ${afterCount - beforeCount} 条`);

  // ============================================================
  // 3. 记忆系统并发写入
  // ============================================================
  console.log('\n--- 记忆系统并发写入 ---');

  const { recordEpisode, getRecentEpisodes } = require('./dist/memory-layer.js');

  const beforeEp = getRecentEpisodes(100).length;
  const concurrency3 = 20;
  const promises3 = [];

  for (let i = 0; i < concurrency3; i++) {
    promises3.push(new Promise(resolve => {
      setImmediate(() => {
        try {
          recordEpisode({
            intent: `concurrent_mem_${i}`,
            actions: [{ kind: 'assign', target: 'x', value: '1' }],
            success: true
          });
        } catch(e) {}
        resolve();
      });
    }));
  }
  await Promise.all(promises3);
  await new Promise(r => setTimeout(r, 500));

  const afterEp = getRecentEpisodes(100).length;
  assert(afterEp - beforeEp === concurrency3, '记忆系统: 并发 20 次写入不丢数据', `期望新增 ${concurrency3} 条，实际新增 ${afterEp - beforeEp} 条`);

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
}

main().catch(console.error);
