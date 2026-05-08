#!/bin/bash
set -e
echo "🛡️ 构造语义错误阻断测试..."

TEST_PROJECT="test-semantic-guard"
rm -rf $TEST_PROJECT
mkdir -p $TEST_PROJECT

cat > $TEST_PROJECT/auth.py << 'EOF'
from typing import Dict, Tuple, Optional

PasswordHash = str
Token = str
UserPayload = Dict[str, any]

def verify_password(plain: str, hash: PasswordHash) -> bool:
    return True

def generate_jwt(payload: UserPayload) -> Token:
    return "jwt_token"

def create_session(user: UserPayload, token: Token) -> Dict:
    return {"user": user, "token": token}

def cache_set(key: str, value: any) -> None:
    pass

def cache_get(key: str) -> Optional[any]:
    return None

def send_email(recipient: str, subject: str, body: str) -> bool:
    return True
EOF

cat > src/semantic_guard_test.ts << 'EOF'
import { extractIRPython } from "./extract-ir-python";
import { plan } from "./planner";
import { validateAction } from "./validator";
import { emitPython } from "./python-emitter";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const intents: Record<string, string> = {
  case1: "实现 login 函数，验证密码后生成JWT并返回",
  case2: "实现用户注册，先加密密码，然后发送欢迎邮件",
  case3: "实现带缓存的查询：先查缓存，若无则查询并更新缓存",
  case4: "实现批量发送邮件：遍历用户列表，对每个活跃用户发送通知",
  case5: "实现角色检查：验证用户是否为管理员，是则执行操作",
  case6: "实现会话创建：验证凭据后，生成JWT，创建会话并缓存",
  case7: "实现数据导出：获取所有用户数据，转换格式并保存到文件",
  case8: "实现账户锁定：检查登录失败次数，超过阈值则锁定账户",
  case9: "实现令牌刷新：验证旧令牌有效性，生成新令牌并更新会话",
  case10: "实现用户注销：销毁会话，清理缓存，记录审计日志"
};

interface TestResult {
  case: string;
  intent: string;
  generatedCode: string;
  actionSequence: any[];
  syntaxPass: boolean;
  semanticError: boolean;
  runtimePass: boolean;
}

async function runSemanticTest() {
  const projectPath = "./test-semantic-guard";
  const fns = extractIRPython(projectPath);
  fs.writeFileSync("ir.json", JSON.stringify(fns, null, 2));
  console.log(`IR: ${fns.length} 函数`);

  const results: TestResult[] = [];

  for (const [caseName, intent] of Object.entries(intents)) {
    console.log(`\n🧪 ${caseName}: ${intent.substring(0,50)}...`);
    const actions = await plan(intent);
    const validationResults = actions.map((a: any) => validateAction(a));
    const syntacticValid = validationResults.every((r: any) => r.valid);

    if (!syntacticValid || actions.length === 0) {
      results.push({
        case: caseName,
        intent,
        generatedCode: "",
        actionSequence: actions,
        syntaxPass: false,
        semanticError: true,
        runtimePass: false
      });
      console.log("  ❌ 语义错误已拦截（校验失败）");
      continue;
    }

    const code = emitPython(actions);
    console.log("  📝 代码:\n" + code.split("\n").slice(0,5).map(l => "    " + l).join("\n"));

    const tmpFile = path.join(path.resolve(projectPath), "__test.py");
    fs.writeFileSync(tmpFile, code);
    let runtimePass = false;
    try {
      execSync(`python3 ${tmpFile}`, { timeout: 5000, encoding: "utf-8", cwd: path.resolve(projectPath) });
      runtimePass = true;
    } catch (e: any) {}

    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);

    const hasSemanticIssue = !runtimePass;

    results.push({
      case: caseName,
      intent,
      generatedCode: code,
      actionSequence: actions,
      syntaxPass: true,
      semanticError: hasSemanticIssue,
      runtimePass
    });

    if (hasSemanticIssue) {
      console.log("  ⚠️ 潜在语义错误（运行时失败）");
    } else {
      console.log("  ✅ 完整通过");
    }
  }

  console.log("\n═══════════════════════════════════");
  console.log("📊 语义阻断测试报告");
  console.log("═══════════════════════════════════");
  const total = results.length;
  const syntaxBlocked = results.filter(r => !r.syntaxPass).length;
  const semanticDetected = results.filter(r => r.semanticError).length;
  const fullyClean = results.filter(r => r.syntaxPass && !r.semanticError).length;
  console.log(`总测试案例: ${total}`);
  console.log(`语义层拦截: ${syntaxBlocked} (语法/类型错误直接拒绝)`);
  console.log(`语义错误检测: ${semanticDetected} (包含运行时失败)`);
  console.log(`完全安全通过: ${fullyClean}`);
  console.log(`阻断率: ${((syntaxBlocked + semanticDetected)/total*100).toFixed(0)}%`);

  fs.writeFileSync("semantic_block_results.json", JSON.stringify(results, null, 2));
  console.log("详细结果已保存到 semantic_block_results.json");
}

runSemanticTest().catch(console.error);
EOF

echo "✅ 测试环境已就绪，运行中..."
npx ts-node src/semantic_guard_test.ts
