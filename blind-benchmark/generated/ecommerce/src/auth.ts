// E-commerce backend - auth module

interface User { id: string; email: string; password: string; role: string; }
interface Session { token: string; userId: string; }
const users: User[] = [];
const sessions: Session[] = [];

let nextId = 1;

export function signUp(email: string, password: string): User {
  const user: User = { id: `u${nextId++}`, email, password, role: "customer" };
  users.push(user);
  return user;
}

export function signIn(email: string, password: string): Session | null {
  const user = users.find(u => u.email === email && u.password === password);
  if (!user) return null;
  const session: Session = { token: `tok_${nextId++}`, userId: user.id };
  sessions.push(session);
  return session;
}

export function signOut(token: string): void {
  const idx = sessions.findIndex(s => s.token === token);
  if (idx >= 0) sessions.splice(idx, 1);
}

export function getUser(token: string): User | null {
  const s = sessions.find(s => s.token === token);
  if (!s) return null;
  return users.find(u => u.id === s.userId) || null;
}
