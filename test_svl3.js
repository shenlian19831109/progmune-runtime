const fs = require('fs');

// 确保 ir.json 存在
const ir = [
  { name: 'cache_get', params: [{ name: 'key', type: 'str' }], returnType: 'any', file: 'auth.py' },
];
fs.writeFileSync('ir.json', JSON.stringify(ir, null, 2));

// 内联 checkVariableFlow 逻辑
function checkVariableFlow(actions) {
  const errors = [];
  const declared = new Map();

  const isLiteral = (val) => {
    if (typeof val !== 'string') return true;
    if (/^["'`]/.test(val) || /["'`]$/.test(val)) return true;
    if (/^\d+$/.test(val)) return true;
    if (val === 'true' || val === 'false' || val === 'null' || val === 'undefined') return true;
    if (/\s/.test(val) || /[^\w]/.test(val)) return true;
    return false;
  };

  const processAction = (action) => {
    console.log('处理动作:', JSON.stringify(action));
    if (action.kind === 'call') {
      for (const arg of (action.args || [])) {
        const val = arg.value;
        console.log('  参数值:', val, '类型:', typeof val, 'isLiteral:', isLiteral(val), '是否为标识符:', /^[a-zA-Z_]\w*$/.test(val));
        if (typeof val === 'string' && !isLiteral(val)) {
          if (/^[a-zA-Z_]\w*$/.test(val) && !declared.has(val)) {
            const errMsg = "变量 '" + val + "' 未声明就使用";
            errors.push(errMsg);
            console.log('  -> 检测到错误:', errMsg);
          }
        }
      }
      if (action.assignTo) {
        declared.set(action.assignTo, 'any');
        console.log('  声明变量:', action.assignTo);
      }
    }
  };

  for (const action of actions) processAction(action);
  return errors;
}

const actions = [
  {
    kind: 'call',
    function: 'cache_get',
    args: [{ name: 'key', type: 'str', value: 'myCacheKey' }]
  }
];

const errors = checkVariableFlow(actions);
console.log('\n最终错误列表:', JSON.stringify(errors));
console.log(errors.length > 0 ? '✅ SVL-3 生效了！' : '❌ SVL-3 仍未生效');
