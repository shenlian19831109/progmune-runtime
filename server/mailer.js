const net = require('net');
const tls = require('tls');

/**
 * 零依赖 Gmail SMTP 客户端（STARTTLS + AUTH LOGIN）。
 * 仅用于 Progmune 官方邮件：订阅确认码 / 版本推送。不引入 npm 依赖。
 *
 * 用法：
 *   const mailer = require('./mailer');
 *   await mailer.sendMail({
 *     user: process.env.GMAIL_USER,
 *     pass: process.env.GMAIL_APP_PASSWORD,
 *     to: 'someone@example.com',
 *     subject: 'Progmune v3.7.26 released',
 *     text: 'plain text body',
 *   });
 */

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_TLS = process.env.SMTP_TLS !== 'off'; // 测试用：off 跳过 STARTTLS（生产默认开启，Gmail 必需）
const SMTP_DEBUG = process.env.SMTP_DEBUG === '1';
const SMTP_TIMEOUT_MS = Number(process.env.SMTP_TIMEOUT_MS || 25000); // 全程超时

function debug(step) { if (SMTP_DEBUG) console.log(`[mailer] ${step}`); }

/** 与 SMTP 服务器对话：发送命令并读取响应，校验响应码（expect 可为码或码数组）。 */
function command(sock, cmd, expect) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      // 多行响应：每行以 "NNN-" 开头（最后一行为 "NNN "）。buf 以 \r\n 结尾时
      // split 末尾是空串——取倒数第二项判断；最后一段可能未收完（无 \r\n），继续等
      const lines = buf.split('\r\n');
      const doneLine = lines.length >= 2 ? lines[lines.length - 2] : "";
      if (doneLine && /^\d{3} /.test(doneLine)) {
        sock.removeListener('data', onData);
        const code = parseInt(doneLine.slice(0, 3), 10);
        const expected = Array.isArray(expect) ? expect : [expect];
        if (expected.includes(code)) {
          resolve(buf);
        } else {
          reject(new Error(`SMTP ${code}: ${doneLine.slice(4, 120)}`));
        }
      }
    };
    sock.on('data', onData);
    sock.once('error', (e) => {
      sock.removeListener('data', onData);
      reject(e);
    });
    if (cmd) sock.write(cmd + '\r\n');
  });
}

function b64(s) {
  return Buffer.from(s, 'utf8').toString('base64');
}

function headerLine(name, value) {
  // RFC 2047：非 ASCII 主题编码，避免中文乱码
  const encoded = /[^\x20-\x7e]/.test(value)
    ? `=?UTF-8?B?${b64(value)}?=`
    : value;
  return `${name}: ${encoded}`;
}

async function sendMail({ user, pass, to, subject, text, fromName }) {
  if (!user || !pass) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD 未配置');

  // 全程超时：任何一步挂起都强制终止并报错（否则调用方 promise 永不落定）
  const sock = net.connect(SMTP_PORT, SMTP_HOST);
  sock.setTimeout(SMTP_TIMEOUT_MS, () => sock.destroy(new Error('SMTP 超时')));
  debug(`connecting ${SMTP_HOST}:${SMTP_PORT}`);
  await new Promise((resolve, reject) => {
    sock.once('connect', resolve);
    sock.once('error', reject);
  });
  debug('connected');
  await command(sock, undefined, 220); // greeting
  debug('greeting ok');
  await command(sock, 'EHLO progmune.top', 250);
  debug('ehlo ok');

  let secure = sock;
  if (SMTP_TLS) {
    await command(sock, 'STARTTLS', 220);
    debug('starttls ok');
    // 升级为 TLS
    secure = await new Promise((resolve, reject) => {
      const t = tls.connect({ socket: sock, servername: SMTP_HOST }, () => resolve(t));
      t.once('error', reject);
    });
    debug('tls handshake ok');
    await command(secure, undefined, 220); // TLS greeting
    await command(secure, 'EHLO progmune.top', 250);
  }
  debug('auth login');
  await command(secure, 'AUTH LOGIN', 334);
  await command(secure, b64(user), 334);
  await command(secure, b64(pass), 235);
  debug('auth ok');

  const from = fromName ? `${fromName} <${user}>` : user;
  await command(secure, `MAIL FROM:<${user}>`, 250);
  await command(secure, `RCPT TO:<${to}>`, [250, 251]);
  await command(secure, 'DATA', 354);
  debug('sending data');

  const message = [
    headerLine('From', from),
    headerLine('To', to),
    headerLine('Subject', subject),
    headerLine('Date', new Date().toUTCString()),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    '.',
  ].join('\r\n');

  await command(secure, message, 250);
  debug('message accepted');
  await command(secure, 'QUIT', 221).catch(() => { /* QUIT 响应可选 */ });
  secure.destroy();
  debug('done');
  return true;
}

module.exports = { sendMail };
