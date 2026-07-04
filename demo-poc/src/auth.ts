/**
 * Auth module — AI-generated JWT authentication flow.
 *
 * Protocol: Authentication (Progmune BLOCK-ready, 85% confidence)
 * RFC: 6749 (OAuth 2.0), 7519 (JWT)
 *
 * Correct protocol order:
 *   verify_password → generate_jwt → create_session → (use) → logout
 *
 * @protocol auth
 *   pre_states=["UNAUTHENTICATED"] post_states=["PASSWORD_VERIFIED"]
 * @protocol auth
 *   pre_states=["PASSWORD_VERIFIED"] post_states=["TOKEN_ISSUED"] invalidate=["PASSWORD_VERIFIED"]
 * @protocol auth
 *   pre_states=["TOKEN_ISSUED"] post_states=["SESSION_ACTIVE"] invalidate=["TOKEN_ISSUED"]
 * @protocol auth
 *   pre_states=["SESSION_ACTIVE"] post_states=["UNAUTHENTICATED"] invalidate=["SESSION_ACTIVE"]
 */

import * as crypto from "crypto";

// ── Types ──

interface User {
  id: string;
  username: string;
  passwordHash: string;
}

interface Session {
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

// ── In-memory store (production would use a database) ──

const users: Map<string, User> = new Map();
const sessions: Map<string, Session> = new Map();

// ── Protocol Step 1: verify_password ──

/**
 * Verify user password against stored hash.
 * @protocol auth pre_states=["UNAUTHENTICATED"] post_states=["PASSWORD_VERIFIED"]
 */
export function verify_password(username: string, password: string): boolean {
  const user = users.get(username);
  if (!user) return false;

  const hash = crypto
    .createHash("sha256")
    .update(password + user.id)
    .digest("hex");

  return hash === user.passwordHash;
}

// ── Protocol Step 2: generate_jwt ──

/**
 * Generate JWT token after password verification.
 * @protocol auth pre_states=["PASSWORD_VERIFIED"] post_states=["TOKEN_ISSUED"] invalidate=["PASSWORD_VERIFIED"]
 */
export function generate_jwt(userId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  ).toString("base64url");
  const signature = crypto
    .createHmac("sha256", "progmune-demo-secret")
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

// ── Protocol Step 3: create_session ──

/**
 * Create session after JWT issuance.
 * @protocol auth pre_states=["TOKEN_ISSUED"] post_states=["SESSION_ACTIVE"] invalidate=["TOKEN_ISSUED"]
 */
export function create_session(userId: string): Session {
  const session: Session = {
    token: crypto.randomBytes(32).toString("hex"),
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 3600000, // 1 hour
  };
  sessions.set(session.token, session);
  return session;
}

// ── Protocol Step 4: logout ──

/**
 * Logout and invalidate session.
 * @protocol auth pre_states=["SESSION_ACTIVE"] post_states=["UNAUTHENTICATED"] invalidate=["SESSION_ACTIVE"]
 */
export function logout(sessionToken: string): boolean {
  return sessions.delete(sessionToken);
}

// ── Utility ──

export function registerUser(username: string, password: string): User {
  const id = crypto.randomBytes(16).toString("hex");
  const passwordHash = crypto
    .createHash("sha256")
    .update(password + id)
    .digest("hex");
  const user: User = { id, username, passwordHash };
  users.set(username, user);
  return user;
}

// ── AI-GENERATED BUG (intentional — Progmune should catch this) ──
// This function skips verify_password and calls create_session directly.
// Progmune will BLOCK this because TOKEN_ISSUED is required before SESSION_ACTIVE.

/**
 * BUG: Quick login that skips password verification.
 * Progmune verdict: BLOCK (missing verify_password before create_session)
 */
export function insecureQuickLogin(username: string): Session | null {
  const user = users.get(username);
  if (!user) return null;

  // BUG: create_session called without verify_password + generate_jwt
  // Progmune detects: pre_states=["TOKEN_ISSUED"] not satisfied
  // State is UNAUTHENTICATED, but create_session requires TOKEN_ISSUED
  return create_session(user.id);
}

// ── Correct usage example ──

export function loginFlow(username: string, password: string): Session | null {
  // Step 1: verify_password
  if (!verify_password(username, password)) return null;

  // Step 2: generate_jwt
  const jwt = generate_jwt(username);

  // Step 3: create_session
  return create_session(username);
}
