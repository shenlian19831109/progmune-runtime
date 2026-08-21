/**
 * Demo 项目: 用户认证系统
 * 用于展示 SSG (Semantic State Graph) 协议验证
 *
 * 每个函数通过 JSDoc @protocol 注解声明其状态转换规则。
 * 这些注解在 IR 提取时被解析，驱动 SSG 状态机。
 */

/**
 * 验证用户密码
 * @protocol pre_states=["UNAUTHENTICATED"] post_states=["PASSWORD_VERIFIED"]
 */
export function verify_password(username: string, password: string): boolean {
  return password === "correct";
}

/**
 * 签发 JWT 令牌
 * @protocol pre_states=["PASSWORD_VERIFIED"] post_states=["TOKEN_ISSUED"] invalidate=["PASSWORD_VERIFIED"]
 */
export function generate_jwt(userId: string, expiresIn: number): string {
  return "eyJhbGciOi...";
}

/**
 * 创建用户会话
 * @protocol pre_states=["TOKEN_ISSUED"] post_states=["SESSION_ACTIVE"] invalidate=["TOKEN_ISSUED"]
 */
export function create_session(token: string): { sessionId: string } {
  return { sessionId: "sess_abc123" };
}

/**
 * 撤销令牌
 * @protocol pre_states=["TOKEN_ISSUED"] post_states=["UNAUTHENTICATED"] invalidate=["TOKEN_ISSUED"]
 */
export function revoke_token(token: string): void {
  // 将 token 加入黑名单
}

/**
 * 登出
 * @protocol pre_states=["SESSION_ACTIVE"] post_states=["UNAUTHENTICATED"] invalidate=["SESSION_ACTIVE"]
 */
export function logout(sessionId: string): void {
  // 销毁会话
}

/**
 * 获取用户资料（无协议约束）
 * @protocol pre_states=[] post_states=[]
 */
export function get_user_profile(userId: string): { name: string; email: string } {
  return { name: "Alice", email: "alice@example.com" };
}
