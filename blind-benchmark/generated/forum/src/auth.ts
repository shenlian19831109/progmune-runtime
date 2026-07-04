// Discussion forum - auth module

interface User { id: string; username: string; email: string; password: string; role: string; }
interface Session { token: string; userId: string; createdAt: number; }
const users: User[] = [];
const sessions: Session[] = [];

let nextId = 1;

export function createAccount(username: string, email: string, password: string): User {
  const user: User = { id: `u${nextId++}`, username, email, password, role: "member" };
  users.push(user);
  return user;
}

export function logIn(email: string, password: string): Session | null {
  const user = users.find(u => u.email === email && u.password === password);
  if (!user) return null;
  const session: Session = { token: `sess_${nextId++}`, userId: user.id, createdAt: Date.now() };
  sessions.push(session);
  return session;
}

export function logOut(token: string): void {
  const idx = sessions.findIndex(s => s.token === token);
  if (idx >= 0) sessions.splice(idx, 1);
}

export function getCurrentUser(token: string): User | null {
  const s = sessions.find(s => s.token === token);
  if (!s) return null;
  return users.find(u => u.id === s.userId) || null;
}

export function isModerator(token: string): boolean {
  const user = getCurrentUser(token);
  return user?.role === "moderator" || user?.role === "admin";
}
