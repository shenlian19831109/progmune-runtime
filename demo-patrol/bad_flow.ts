/**
 * 故意违反协议：直接签发 JWT 令牌，跳过密码验证前置
 *
 * @protocol namespace=auth pre_states=["PASSWORD_VERIFIED"] post_states=["TOKEN_ISSUED"]
 */
import { generate_jwt } from "./auth";

export function bad_flow(userId: string): string {
  return generate_jwt(userId, 1);
}
