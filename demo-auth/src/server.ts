// @progmune-generated session=demo-auth-001 timestamp=2026-06-29T09:00:00Z ruleHash=auth001
/**
 * @protocol AuthProtocol
 * @state UNAUTHENTICATED
 * @state AUTHENTICATED
 * @state TOKEN_ISSUED
 * @state AUTHORIZED
 * @state TERMINATED
 *
 * @transition login: UNAUTHENTICATED -> AUTHENTICATED
 * @transition generate_token: AUTHENTICATED -> TOKEN_ISSUED
 * @transition access_resource: TOKEN_ISSUED -> AUTHORIZED
 * @transition logout: AUTHORIZED -> TERMINATED
 *
 * @purpose Authentication and session management microservice
 * @tags auth, jwt, session, express
 */

import express from 'express';
import jwt from 'jsonwebtoken';

const app = express();
app.use(express.json());

// 模拟用户数据库
const users: Record<string, { password: string }> = {};
const sessions: Record<string, string> = {};

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
 * @post_states TOKEN_ISSUED
 */
function generateToken(username: string): string {
  const token = jwt.sign({ username }, 'secret', { expiresIn: '1h' });
  sessions[username] = token;
  // ❌ 违规 2：资源泄漏 — JWT 生成后未记录失效时间或清理旧 token
  // sessions 中的旧 token 从未被清理，也没有设置过期检查
  return token;
}

/**
 * @protocol AuthProtocol
 * @pre_states TOKEN_ISSUED
 * @post_states AUTHORIZED
 */
function accessResource(token: string): boolean {
  const decoded = jwt.verify(token, 'secret') as { username: string };
  return !!sessions[decoded.username];
}

/**
 * @protocol AuthProtocol
 * @pre_states AUTHORIZED
 * @post_states TERMINATED
 */
function logoutUser(username: string): void {
  delete sessions[username];
}

// ── Routes ──

app.post('/register', (req, res) => {
  const { username, password } = req.body;
  if (users[username]) return res.status(400).json({ error: 'User exists' });
  users[username] = { password };
  res.json({ message: 'User registered' });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (login(username, password)) {
    // 调用 generateToken 生成 JWT —— 合法步骤
    const token = generateToken(username);
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// ❌ 违规 1：认证绕过
// /profile 端点缺少 JWT 验证 —— 直接从 UNAUTHENTICATED 访问受保护资源
// 协议要求：必须先 login → generate_token → 才能 access_resource
// 但这里跳过了所有这些步骤，仅靠 query 参数判断
app.get('/profile', (req, res) => {
  const { userId } = req.query;
  if (userId && users[userId as string]) {
    res.json({ user: userId, data: 'sensitive info' });
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

app.post('/logout', (req, res) => {
  const { username } = req.body;
  logoutUser(username);
  res.json({ message: 'Logged out' });
});

app.listen(3000, () => console.log('Server running on port 3000'));

export default app;
