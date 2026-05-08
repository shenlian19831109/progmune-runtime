export type PasswordHash = string;
export type Token = string;
export type UserPayload = { id: number; role: string };

export function verifyPassword(plain: string, hash: PasswordHash): boolean {
  return true;
}
export function generateJWT(payload: UserPayload): Token {
  return "mock-token";
}

// 新增复杂类型
export type Role = "admin" | "user" | "guest";
export interface Session {
  user: UserPayload;
  token: Token;
  expires: Date;
}

export function createSession(user: UserPayload, token: Token): Promise<Session> {
  return Promise.resolve({
    user,
    token,
    expires: new Date(),
  });
}

export function checkRole(session: Session, requiredRole: Role): boolean {
  return session.user.role === requiredRole;
}
