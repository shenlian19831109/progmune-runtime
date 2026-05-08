const { plan } = require('./dist/planner.js');
const fs = require('fs');

// 先确保 ir.json 存在（使用 test-semantic-guard 项目的 IR）
const fns = require('./dist/extract-ir-python.js').extractIRPython('./test-semantic-guard');
fs.writeFileSync('ir.json', JSON.stringify(fns, null, 2));
console.log('IR 函数数量:', fns.length);

plan('实现 login 函数，验证密码后生成JWT并返回')
  .then(actions => {
    if (!actions || actions.length === 0) {
      console.log('❌ Planner 返回空数组');
    } else {
      console.log('✅ 动作序列:', JSON.stringify(actions, null, 2));
    }
  })
  .catch(err => {
    console.error('🔥 Plan 失败:', err);
  });
