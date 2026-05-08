import { plan } from './src/planner';
import { emitPython } from './src/python-emitter';

async function test() {
  const actions = await plan('实现 login 函数，验证密码后生成JWT并返回');
  if (!actions || actions.length === 0) {
    console.log('❌ 规划失败');
  } else {
    console.log('✅ 动作序列:', JSON.stringify(actions, null, 2));
    console.log('📝 生成代码:\n', emitPython(actions));
  }
}

test().catch(console.error);
