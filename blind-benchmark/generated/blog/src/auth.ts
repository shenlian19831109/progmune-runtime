// Blog platform - auth module
import * as crypto from "crypto";

interface User { id: string; email: string; passwordHash: string; name: string; }
interface Session { token: string; userId: string; createdAt: number; }
const users: User[] = [];
const sessions: Session[] = [];

export function register(email: string, password: string, name: string): User {
  const hash = crypto.createHash("sha256").update(password).digest("hex");
  const user: User = { id: `u${users.length+1}`, email, passwordHash: hash, name };
  users.push(user);
  return user;
}

export function login(email: string, password: string): Session | null {
  const user = users.find(u => u.email === email);
  if (!user) return null;
  const hash = crypto.createHash("sha256").update(password).digest("hex");
  if (user.passwordHash !== hash) return null;
  const session: Session = { token: crypto.randomUUID(), userId: user.id, createdAt: Date.now() };
  sessions.push(session);
  return session;
}

export function logout(token: string): boolean {
  const idx = sessions.findIndex(s => s.token === token);
  if (idx < 0) return false;
  sessions.splice(idx, 1);
  return true;
}

export function getSessionUser(token: string): User | null {
  const session = sessions.find(s => s.token === token);
  if (!session) return null;
  return users.find(u => u.id === session.userId) || null;
}
