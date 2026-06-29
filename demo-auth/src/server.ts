// @progmune-generated session=demo-auth-002 timestamp=2026-06-29T10:00:00Z ruleHash=auth002
/**
 * @protocol AuthProtocol
 * @state UNAUTHENTICATED
 * @state AUTHENTICATED
 * @state ACCESS_ISSUED
 * @state REFRESHED
 * @state AUTHORIZED
 * @state TERMINATED
 *
 * @transition login: UNAUTHENTICATED -> AUTHENTICATED
 * @transition generate_access_token: AUTHENTICATED -> ACCESS_ISSUED
 * @transition refresh_token: ACCESS_ISSUED -> REFRESHED
 * @transition access_resource: ACCESS_ISSUED -> AUTHORIZED
 * @transition access_resource: REFRESHED -> AUTHORIZED
 * @transition logout: AUTHORIZED -> TERMINATED
 * @transition token_revoke: AUTHORIZED -> TERMINATED
 * @transition token_revoke: REFRESHED -> TERMINATED
 *
 * @purpose JWT + Refresh Token authentication microservice
 * @tags auth, jwt, refresh-token, session, express
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const app = express();
app.use(express.json());

const users: Record<string, { password: string }> = {};
const accessTokens: Record<string, { username: string; expiresAt: number }> = {};
const refreshTokens: Record<string, { username: string; used: boolean; expiresAt: number }> = {};

// ═══════════════════════════════════════════════════════════════
// Protocol Functions (annotated for Progmune)
// ═══════════════════════════════════════════════════════════════

/**
 * @protocol AuthProtocol
 * @pre_states UNAUTHENTICATED
 * @post_states AUTHENTICATED
 */
function login(username: string, password: string): boolean {
  return users[username]?.password === password;
}

/**
 * @protocol AuthProtocol
 * @pre_states AUTHENTICATED
 * @post_states ACCESS_ISSUED
 */
function generateAccessToken(username: string): string {
  const token = jwt.sign({ username, type: 'access' }, 'secret', { expiresIn: '15m' });
  accessTokens[token] = { username, expiresAt: Date.now() + 15 * 60 * 1000 };
  return token;
}

/**
 * @protocol AuthProtocol
 * @pre_states AUTHENTICATED
 * @post_states ACCESS_ISSUED
 */
function generateRefreshToken(username: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  refreshTokens[token] = { username, used: false, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 };
  // ❌ 违规 3：refreshtoken 创建后从未被清理——资源泄漏
  return token;
}

/**
 * @protocol AuthProtocol
 * @pre_states ACCESS_ISSUED
 * @post_states REFRESHED
 */
function refreshAccessToken(refreshToken: string): { accessToken: string } | null {
  const rt = refreshTokens[refreshToken];
  // ❌ 违规 1：refresh token 绕过——未检查是否过期或已使用，直接生成新 token
  // 协议要求：必须验证 refresh token 有效性，标记为已使用
  if (!rt) return null;

  // ❌ 违规 2：Token 重用——未将 refreshToken 标记为 used=true
  // 应该：rt.used = true 或 delete refreshTokens[refreshToken]

  const newAccess = generateAccessToken(rt.username);
  return { accessToken: newAccess };
}

/**
 * @protocol AuthProtocol
 * @pre_states ACCESS_ISSUED, REFRESHED
 * @post_states AUTHORIZED
 */
function accessResource(accessToken: string): { username: string } | null {
  const at = accessTokens[accessToken];
  if (!at || at.expiresAt < Date.now()) return null;
  return { username: at.username };
}

/**
 * @protocol AuthProtocol
 * @pre_states AUTHORIZED, REFRESHED
 * @post_states TERMINATED
 */
function logoutUser(username: string): void {
  for (const [token, data] of Object.entries(accessTokens)) {
    if (data.username === username) delete accessTokens[token];
  }
  // ❌ 违规 4：logout 只清理 access token，未清理 refresh token——资源泄漏
  // 应该同时清理 refreshTokens 中对应 username 的条目
}

/**
 * @protocol AuthProtocol
 * @pre_states AUTHORIZED, REFRESHED
 * @post_states TERMINATED
 */
function revokeToken(token: string): boolean {
  if (refreshTokens[token]) {
    delete refreshTokens[token];
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════
// Routes
// ═══════════════════════════════════════════════════════════════

app.post('/register', (req, res) => {
  const { username, password } = req.body;
  if (users[username]) return res.status(400).json({ error: 'User exists' });
  users[username] = { password };
  res.json({ message: 'User registered' });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (login(username, password)) {
    const accessToken = generateAccessToken(username);
    const refreshToken = generateRefreshToken(username);
    res.json({ accessToken, refreshToken });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

  const result = refreshAccessToken(refreshToken);
  if (!result) return res.status(401).json({ error: 'Invalid refresh token' });

  // ❌ 违规：refresh 后未更新协议状态就直接返回
  res.json(result);
});

app.get('/profile', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });

  const user = accessResource(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });

  res.json({ user: user.username, data: 'sensitive profile data' });
});

app.post('/logout', (req, res) => {
  const { username } = req.body;
  logoutUser(username);
  res.json({ message: 'Logged out' });
});

app.post('/revoke', (req, res) => {
  const { token } = req.body;
  if (revokeToken(token)) {
    res.json({ message: 'Token revoked' });
  } else {
    res.status(404).json({ error: 'Token not found' });
  }
});

app.listen(3000, () => console.log('JWT + Refresh Token server running on port 3000'));

export default app;
