import { plan } from './src/planner';

async function testProtocolViolation() {
  // 这个意图本身不包含“登录/认证”，但 Planner 可能生成 generate_jwt 等函数。
  // 如果它直接生成 generate_jwt 而跳过 verify_password，SSG 应该拦截。
  // 或者我们可以故意让 Planner 先尝试生成 generate_jwt。
  // 更直接：我们发一个不可能完成的意图，让 Planner 被迫尝试非法顺序。
  console.log("测试1: 正常登录流程（应通过）");
  const actions1 = await plan("实现一个登录函数，验证密码后生成JWT并返回");
  if (actions1.length > 0) console.log("   ✅ 通过");
  else console.log("   ❌ 失败");

  console.log("\n测试2: 直接要求生成令牌（可能因协议违规被拦截）");
  // 不提供认证上下文，系统可能学会先调用 generate_jwt 而触发 SSG 拦截
  const actions2 = await plan("创建一个带令牌的会话");
  if (actions2.length > 0) console.log("   ✅ 生成成功");
  else console.log("   ❌ 被拦截（符合预期）");
}

testProtocolViolation().catch(console.error);
