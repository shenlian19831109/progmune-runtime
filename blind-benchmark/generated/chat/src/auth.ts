// Real-time chat backend - auth module

interface User { id: string; username: string; password: string; }
interface Session { token: string; userId: string; }
const users: User[] = [];
const sessions: Session[] = [];

let nextId = 1;

export function createUser(username: string, password: string): User {
  const user: User = { id: `u${nextId++}`, username, password };
  users.push(user);
  return user;
}

export function authenticate(username: string, password: string): Session | null {
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) return null;
  const token = Buffer.from(`${user.id}:${Date.now()}`).toString("base64");
  const session: Session = { token, userId: user.id };
  sessions.push(session);
  return session;
}

export function validateToken(token: string): User | null {
  const s = sessions.find(s => s.token === token);
  if (!s) return null;
  return users.find(u => u.id === s.userId) || null;
}

export function invalidateSession(token: string): void {
  const idx = sessions.findIndex(s => s.token === token);
  if (idx >= 0) sessions.splice(idx, 1);
}
