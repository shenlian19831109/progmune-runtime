import { plan } from './src/planner';
import { recordEpisode } from './src/memory-layer';

async function test() {
  // 先确保 ir.json 存在（使用测试项目）
  const { extractIRPython } = require('./src/extract-ir-python');
  const fns = extractIRPython('./test-semantic-guard');
  require('fs').writeFileSync('ir.json', JSON.stringify(fns, null, 2));

  console.log("开始规划...");
  const actions = await plan("实现一个登录函数，验证密码后生成JWT并返回");
  if (actions.length > 0) {
    console.log("规划成功，动作数量:", actions.length);
  } else {
    console.log("规划失败");
  }
}

test().catch(console.error);
