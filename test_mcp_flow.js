const { extractIRPython } = require('./dist/extract-ir-python.js');
const { plan } = require('./dist/planner.js');
const { validateActionSequence } = require('./dist/validator.js');
const { emitPython } = require('./dist/python-emitter.js');
const fs = require('fs');

async function test() {
  // 检查环境变量
  console.log('LLM_API_KEY:', process.env.LLM_API_KEY ? process.env.LLM_API_KEY.substring(0, 8) + '...' : '未设置');
  
  const projectPath = './test-semantic-guard';
  
  // 提取 IR
  const fns = extractIRPython(projectPath);
  fs.writeFileSync('ir.json', JSON.stringify(fns, null, 2));
  console.log('IR 函数数量:', fns.length);
  
  // 规划
  try {
    const actions = await plan('实现 login 函数，验证密码后生成JWT并返回');
    if (!actions || actions.length === 0) {
      console.error('❌ Planner 返回空数组');
      return;
    }
    console.log('动作序列长度:', actions.length);
    
    // 校验
    const seqResult = validateActionSequence(actions);
    if (!seqResult.valid) {
      console.error('校验失败:', seqResult.errors);
      return;
    }
    console.log('校验通过');
    
    // 发射代码
    const code = emitPython(actions);
    console.log('生成代码:\n', code);
  } catch (e) {
    console.error('🔥 流程异常:', e);
  }
}

test();
