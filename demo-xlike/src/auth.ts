/**
 * Auth module — AI-generated user registration + login.
 *
 * Protocol: Authentication (Progmune BLOCK-ready, 85% confidence)
 *
 * @protocol auth
 *   register: pre_states=["UNAUTHENTICATED"] post_states=["REGISTERED"]
 *   verify_password: pre_states=["REGISTERED"] post_states=["PASSWORD_VERIFIED"]
 *   create_session: pre_states=["PASSWORD_VERIFIED"] post_states=["SESSION_ACTIVE"] invalidate=["PASSWORD_VERIFIED"]
 *   logout: pre_states=["SESSION_ACTIVE"] post_states=["UNAUTHENTICATED"] invalidate=["SESSION_ACTIVE"]
 * @progmune-generated
 */

import * as crypto from "crypto";

export interface User {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  createdAt: number;
}

export interface Session {
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

const users: Map<string, User> = new Map();
const sessions: Map<string, Session> = new Map();
const SESSION_DURATION = 3600000; // 1 hour

// ── Registration ──

export function register(username: string, password: string, displayName: string): User {
  if (users.has(username)) {
    throw new Error("Username already exists");
  }

  const id = crypto.randomBytes(16).toString("hex");
  const passwordHash = crypto.createHash("sha256").update(password + id).digest("hex");

  const user: User = { id, username, displayName, passwordHash, createdAt: Date.now() };
  users.set(username, user);
  return user;
}

// ── Login Flow ──

export function verify_password(username: string, password: string): User | null {
  const user = users.get(username);
  if (!user) return null;

  const hash = crypto.createHash("sha256").update(password + user.id).digest("hex");
  return hash === user.passwordHash ? user : null;
}

export function create_session(userId: string): Session {
  // Clean up expired sessions
  for (const [token, session] of sessions) {
    if (session.expiresAt < Date.now()) sessions.delete(token);
  }

  const session: Session = {
    token: crypto.randomBytes(32).toString("hex"),
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_DURATION,
  };
  sessions.set(session.token, session);
  return session;
}

export function validateSession(token: string): User | null {
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) return null;
  return getUserById(session.userId);
}

export function logout(token: string): boolean {
  const session = sessions.get(token);
  if (!session) return false;
  sessions.delete(token);
  return true;
}

// ── User lookup ──

export function getUserById(id: string): User | null {
  for (const user of users.values()) {
    if (user.id === id) return user;
  }
  return null;
}

export function getUserByUsername(username: string): User | null {
  return users.get(username) || null;
}

// ── AI-GENERATED BUG: registerAndPost — skips session creation ──

/**
 * BUG: Registers user but returns user object directly instead of creating session.
 * Progmune BLOCK: No session means no auth context for subsequent operations.
 *
 * @progmune-detected: missing create_session after register
 */
export function registerAndPostDirect(username: string, password: string, displayName: string): User {
  const user = register(username, password, displayName);
  // BUG: Should call create_session(user.id) here
  // Progmune detects: user authenticated but no session created
  return user;
}

// ── Correct login flow ──

export function loginFlow(username: string, password: string): Session | null {
  const user = verify_password(username, password);
  if (!user) return null;
  return create_session(user.id);
}
