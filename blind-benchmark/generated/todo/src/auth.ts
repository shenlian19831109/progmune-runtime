// Todo list API - auth module

interface User { id: string; username: string; password: string; }
interface Session { token: string; userId: string; }
const users: User[] = [];
const sessions: Session[] = [];

let nextId = 1;

export function registerUser(username: string, password: string): User {
  const user: User = { id: `u${nextId++}`, username, password };
  users.push(user);
  return user;
}

export function authenticateUser(username: string, password: string): Session | null {
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) return null;
  const session: Session = { token: `sess_${nextId++}_${Date.now()}`, userId: user.id };
  sessions.push(session);
  return session;
}

export function verifySession(token: string): User | null {
  const session = sessions.find(s => s.token === token);
  if (!session) return null;
  return users.find(u => u.id === session.userId) || null;
}

export function endSession(token: string): boolean {
  const idx = sessions.findIndex(s => s.token === token);
  if (idx < 0) return false;
  sessions.splice(idx, 1);
  return true;
}
