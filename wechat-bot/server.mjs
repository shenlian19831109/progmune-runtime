/**
 * Progmune 微信公众号自动回复 Bot（零依赖 Node ≥18，可直接部署）
 *
 * 功能：微信公众号开发者模式 webhook——关键词规则自动回复（与 whatsapp-bot 同规则、同架构）。
 *  - GET  /webhook  微信服务器配置校验（signature/timestamp/nonce/echostr，sha1 签名）
 *  - POST /webhook  收用户消息（XML）→ 规则匹配 → 被动回复（5 秒窗口内同步回包）
 *  - GET  /health   部署存活探针
 *
 * 环境变量：
 *   WEIXIN_TOKEN        （必填）公众号后台「设置与开发 → 基本配置 → 服务器配置」里的 Token（自定义任意串）
 *   WEIXIN_AES_KEY      （可选）消息加解密密钥（43 位）。设置后按「安全模式」收发（AES-256-CBC + 签名）；
 *                       不设置则按「明文模式」收发（测试/低风险场景，README 有说明）
 *   WEIXIN_APP_ID       （可选）开发者 ID(AppID)——安全模式校验/加密回包、图片素材上传需要
 *   WEIXIN_APP_SECRET   （可选）开发者密码(AppSecret)——「群」指令回复二维码图片消息需要
 *                       （后台「基本配置」查看需管理员扫码；未配置时「群」回文字版指引）
 *   WEIXIN_QR_IMAGE_URL （可选）社区二维码合成图 URL（默认仓库 GitHub raw 的 assets/community-qr.png），
 *                       群码 7 天过期后更新仓库该文件即可，bot 到期自动重传新图
 *   PORT                （可选）默认 8080
 *
 * 公众号侧注册步骤见 README.md；服务器配置启用后，后台「自动回复」设置停用、由本服务接管。
 * 回复规则在 RULES 数组内，按顺序匹配（首个命中生效），关键词小写包含匹配——与 whatsapp-bot 保持同步。
 * 「群」关键词在配置了 WEIXIN_APP_SECRET 后回复二维码图片消息（临时素材，3 天有效，到期自动重传）。
 */

import http from "node:http";
import crypto from "node:crypto";

const PORT = process.env.PORT || 8080;
const TOKEN = process.env.WEIXIN_TOKEN || "";
const AES_KEY = process.env.WEIXIN_AES_KEY || "";
const APP_ID = process.env.WEIXIN_APP_ID || "";
const APP_SECRET = process.env.WEIXIN_APP_SECRET || "";
const QR_IMAGE_URL =
  process.env.WEIXIN_QR_IMAGE_URL ||
  "https://raw.githubusercontent.com/shenlian19831109/progmune-runtime/main/assets/community-qr.png";

// ═══════════════════════════════════════════════════════════
// 回复规则（顺序匹配，首个命中生效）——与 whatsapp-bot/server.mjs 保持一致
// ═══════════════════════════════════════════════════════════
const RULES = [
  {
    keywords: ["help", "帮助", "menu", "菜单", "hi", "hello", "你好", "在吗"],
    reply:
      "Progmune 自动回复 🤖\n" +
      "• 输入「项目」了解 Progmune 是什么\n" +
      "• 输入「安装」获取安装与使用命令\n" +
      "• 输入「文档」获取文档与白皮书链接\n" +
      "• 输入「群」获取社区群二维码\n" +
      "• 输入「支持」查看语言覆盖范围\n" +
      "更多问题直接发消息，或提 GitHub Issue",
  },
  {
    keywords: ["progmune", "项目", "是什么", "what is", "about", "介绍"],
    reply:
      "Progmune — AI Trust Decision Engine（AI 生成软件的协议生命周期验证）。\n" +
      "验证 AI 生成的代码是否遵循正确的协议流程（TLS 握手、认证流、支付完整性、资源管理）——" +
      "这类违规横跨函数调用序列，SAST/SCA 看不见。\n" +
      "输出 Trust Score + Decision（APPROVED/NEEDS_REVIEW/BLOCKED）+ 证据链，Decision > Score。\n" +
      "仓库：https://github.com/shenlian19831109/progmune-runtime",
  },
  {
    keywords: ["install", "安装", "npm", "quick start", "使用", "怎么用"],
    reply:
      "安装使用：\n" +
      "npm install progmune-runtime\n" +
      "npm run sdk src/server.ts --explain   # 单文件验证（BLOCK/WARN/ALLOW + 证据）\n" +
      "npm run trust -- --project . --json  # Trust 检查（CI 友好 JSON）\n" +
      "npm run check                        # 免疫/覆盖率体检\n" +
      "npm run precision:all                # 基准套件\n" +
      "完整说明：README（github.com/shenlian19831109/progmune-runtime）",
  },
  {
    keywords: ["doc", "文档", "白皮书", "whitepaper", "paper", "手册"],
    reply:
      "文档：\n" +
      "• README（中英双语）：github.com/shenlian19831109/progmune-runtime\n" +
      "• 覆盖矩阵：docs/coverage-matrix.md（中）/ coverage-matrix-en.md（英）\n" +
      "• 项目全解：docs/Progmune_项目全解.html\n" +
      "• 投资人白皮书：docs/Progmune_投资人白皮书_v2.0.html\n" +
      "• 协议盲测基线：blind-benchmark/BASELINE_PROTOCOL_PYTHON_v1.md",
  },
  {
    keywords: ["群", "二维码", "wechat", "微信", "whatsapp group", "join", "加群"],
    image: true, // 素材就绪时回图片消息；否则回下方文字版指引
    reply:
      "社区群二维码（微信 + WhatsApp）见仓库 README「社区与反馈」章节：\n" +
      "github.com/shenlian19831109/progmune-runtime\n" +
      "（图片消息需配置 WEIXIN_APP_SECRET；微信群码 7 天过期，过期请去 README 刷新）",
  },
  {
    keywords: ["支持", "语言", "language", "python", "coverage", "覆盖", "矩阵", "go", "java"],
    reply:
      "语言覆盖（2026-08，v3.7.1）：\n" +
      "• TypeScript ✅ 生产级（盲测 P=86.8% / R=83.6%）\n" +
      "• Python ✅ 协议行（盲测 v1.2：66 gold，Recall 97% / Precision 100% / 0 FP）+ 源码级缺陷检测\n" +
      "• C ⚠️ 研究级（F1=16.5%，L3 跨函数实验已终止）\n" +
      "• Go/Java ❌ 未实现\n" +
      "详情见仓库 docs/coverage-matrix.md",
  },
  {
    keywords: ["version", "版本", "release", "更新"],
    reply:
      "当前最新版本：npm 3.7.2（2026-08-23）。\n" +
      "近两版：3.7.1 词段匹配门控 + 合并形态 IR-first；" +
      "3.7.2 社区双渠道自动回复机器人（微信公众号 + WhatsApp）。\n" +
      "变更记录：CHANGELOG.md（npm 包内 / GitHub 仓库）",
  },
  {
    keywords: ["issue", "bug", "问题", "报错", "失败", "error"],
    reply:
      "有问题优先提 GitHub Issue（附项目类型 + 复现步骤 + 输出片段）：\n" +
      "github.com/shenlian19831109/progmune-runtime/issues\n" +
      "常见项：本地全量 test:unit 语料重负载下需约 1h（以 CI 干净检出为准）；" +
      "npm run check 的覆盖率提示为非阻塞项。",
  },
];

const DEFAULT_REPLY =
  "收到 🤖 未命中关键词。输入「帮助」查看可用指令，" +
  "或提 GitHub Issue：github.com/shenlian19831109/progmune-runtime/issues";

const SUBSCRIBE_REPLY =
  "欢迎关注 Progmune 🤖\n" +
  "Progmune — AI Trust Decision Engine（AI 生成软件的协议生命周期验证）。\n" +
  "输入「帮助」查看全部指令（项目 / 安装 / 文档 / 群 / 支持 / 版本）。\n" +
  "更多问题提 GitHub Issue：github.com/shenlian19831109/progmune-runtime/issues";

const NON_TEXT_REPLY =
  "已收到你的消息 🤖 目前支持文本指令（输入「帮助」查看），" +
  "图片/语音消息暂不识别，可提 GitHub Issue 反馈：github.com/shenlian19831109/progmune-runtime/issues";

function matchRule(text) {
  const lower = (text || "").toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) return rule;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// 二维码图片素材：access_token + 临时素材上传（「群」指令回复图片消息）
// ═══════════════════════════════════════════════════════════
const QR_MEDIA_TTL_MS = 2.5 * 24 * 60 * 60 * 1000; // 临时素材 3 天有效，留 12h 余量提前重传

let accessTokenCache = { token: "", expiresAt: 0 };
let qrMedia = null; // { mediaId, uploadedAt }

async function getAccessToken() {
  if (!APP_ID || !APP_SECRET) return "";
  if (accessTokenCache.token && Date.now() < accessTokenCache.expiresAt - 60_000) {
    return accessTokenCache.token;
  }
  try {
    const url =
      "https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential" +
      `&appid=${encodeURIComponent(APP_ID)}&secret=${encodeURIComponent(APP_SECRET)}`;
    const data = await (await fetch(url)).json();
    if (!data.access_token) {
      console.error(`[mp] gettoken failed: ${JSON.stringify(data)}`);
      return "";
    }
    accessTokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    console.log(`[mp] access_token refreshed (expires in ${data.expires_in}s)`);
    return data.access_token;
  } catch (err) {
    console.error(`[mp] gettoken error: ${err?.message || err}`);
    return "";
  }
}

async function uploadQrImage() {
  const token = await getAccessToken();
  if (!token) return null;
  let imgRes;
  try {
    imgRes = await fetch(QR_IMAGE_URL);
  } catch (err) {
    console.error(`[mp] fetch QR image failed: ${err?.message || err}`);
    return null;
  }
  if (!imgRes.ok) {
    console.error(`[mp] fetch QR image failed: HTTP ${imgRes.status}`);
    return null;
  }
  const imgBuf = Buffer.from(await imgRes.arrayBuffer());
  const boundary = `----ProgmuneMP${Date.now().toString(16)}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="media"; filename="community-qr.png"\r\n` +
        `Content-Type: image/png\r\n\r\n`,
    ),
    imgBuf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  try {
    const data = await (
      await fetch(
        `https://api.weixin.qq.com/cgi-bin/media/upload?access_token=${token}&type=image`,
        {
          method: "POST",
          headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
          body,
        },
      )
    ).json();
    if (!data.media_id) {
      console.error(`[mp] media upload failed: ${JSON.stringify(data)}`);
      return null;
    }
    console.log(`[mp] QR image uploaded, media_id=${data.media_id}`);
    return { mediaId: data.media_id, uploadedAt: Date.now() };
  } catch (err) {
    console.error(`[mp] media upload error: ${err?.message || err}`);
    return null;
  }
}

/** 确保素材可用：启动后/到期后/「群」请求时触发；失败 30 分钟后再试 */
async function ensureQrMedia() {
  if (!APP_ID || !APP_SECRET) return;
  if (qrMedia && Date.now() - qrMedia.uploadedAt < QR_MEDIA_TTL_MS) return;
  qrMedia = await uploadQrImage();
  if (!qrMedia) setTimeout(ensureQrMedia, 30 * 60 * 1000);
}

// ═══════════════════════════════════════════════════════════
// 微信签名校验（sha1：sort([token, timestamp, nonce(, encrypt)]) 后拼接）
// ═══════════════════════════════════════════════════════════
function sha1Signature(parts) {
  const sorted = parts.filter(Boolean).sort().join("");
  return crypto.createHash("sha1").update(sorted).digest("hex");
}

function verifySignature(query, encrypt) {
  if (!TOKEN) return true; // 本地冒烟未配 Token 时不校验
  const { signature, msg_signature: msgSig, timestamp, nonce } = query;
  const expected = encrypt ? msgSig : signature;
  if (!expected || !timestamp || !nonce) return false;
  return sha1Signature([TOKEN, timestamp, nonce, encrypt]) === expected;
}

// ═══════════════════════════════════════════════════════════
// 安全模式（AES-256-CBC，PKCS7 32 字节块）加解密
// 微信规范（WXBizMsgCrypt 参考实现）：IV = AES 密钥前 16 字节，密文不带 IV 前缀
// ═══════════════════════════════════════════════════════════
const AES_KEY_BUF = AES_KEY ? Buffer.from(`${AES_KEY}=`, "base64") : null;
const IV_BUF = AES_KEY_BUF ? AES_KEY_BUF.subarray(0, 16) : null;

function pkcs7Pad(buf) {
  const pad = 32 - (buf.length % 32);
  return Buffer.concat([buf, Buffer.alloc(pad, pad)]);
}
function pkcs7Unpad(buf) {
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 32) throw new Error("bad pkcs7 padding");
  return buf.subarray(0, buf.length - pad);
}
function decryptMsg(encryptB64) {
  const cipher = Buffer.from(encryptB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-cbc", AES_KEY_BUF, IV_BUF);
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(cipher), decipher.final()]);
  const unpadded = pkcs7Unpad(plain);
  if (unpadded.length < 20) throw new Error("decrypted payload too short");
  const msgLen = unpadded.readUInt32BE(16);
  const msg = unpadded.subarray(20, 20 + msgLen).toString("utf8");
  const appid = unpadded.subarray(20 + msgLen).toString("utf8");
  if (APP_ID && appid !== APP_ID) {
    throw new Error(
      `appid mismatch: expect "${APP_ID}" got "${appid}" (msgLen=${msgLen}, total=${unpadded.length})`,
    );
  }
  return msg;
}
function encryptMsg(msg) {
  const random = crypto.randomBytes(16);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(Buffer.byteLength(msg));
  const plain = Buffer.concat([random, len, Buffer.from(msg), Buffer.from(APP_ID || "")]);
  const cipher = crypto.createCipheriv("aes-256-cbc", AES_KEY_BUF, IV_BUF);
  cipher.setAutoPadding(false);
  const enc = Buffer.concat([cipher.update(pkcs7Pad(plain)), cipher.final()]);
  return enc.toString("base64");
}

// ═══════════════════════════════════════════════════════════
// 极简 XML 解析/构造（微信公众号消息为扁平结构 + CDATA）
// ═══════════════════════════════════════════════════════════
function parseXml(xml) {
  const out = {};
  // 跳过根标签 <xml>：公众号消息为扁平结构，内层标签直接平铺解析（CDATA 兼容）
  const re = /<(?!xml)(\w+)>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/\1>/g;
  let m;
  while ((m = re.exec(xml))) out[m[1]] = m[2];
  return out;
}

function buildReplyXml(fromUser, toUser, msgType, bodyXml) {
  return (
    "<xml>\n" +
    `<ToUserName><![CDATA[${fromUser}]]></ToUserName>\n` +
    `<FromUserName><![CDATA[${toUser}]]></FromUserName>\n` +
    `<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>\n` +
    `<MsgType><![CDATA[${msgType}]]></MsgType>\n` +
    bodyXml +
    "\n</xml>"
  );
}

function wrapEncryptedReply(xml, timestamp, nonce) {
  const encrypt = encryptMsg(xml);
  return (
    "<xml>\n" +
    `<Encrypt><![CDATA[${encrypt}]]></Encrypt>\n` +
    `<MsgSignature><![CDATA[${sha1Signature([TOKEN, timestamp, nonce, encrypt])}]]></MsgSignature>\n` +
    `<TimeStamp>${timestamp}</TimeStamp>\n` +
    `<Nonce><![CDATA[${nonce}]]></Nonce>\n` +
    "</xml>"
  );
}

/** 根据消息内容决定回复：{type:"text",content} | {type:"image",mediaId} | null（不回复） */
function decideReply(msg) {
  if (msg.MsgType === "event") {
    if (msg.Event === "subscribe") return { type: "text", content: SUBSCRIBE_REPLY };
    return null; // 取关/菜单点击等事件不回复
  }
  if (msg.MsgType === "text") {
    const rule = matchRule(msg.Content);
    if (rule?.image) {
      if (qrMedia) return { type: "image", mediaId: qrMedia.mediaId };
      ensureQrMedia(); // 后台预加载，下一次即可收到图片
      const pending = APP_ID && APP_SECRET
        ? "社区群二维码图片准备中 🤖 请稍等几秒再发一次「群」；也可直接去仓库 README「社区与反馈」章节扫码：github.com/shenlian19831109/progmune-runtime"
        : "社区群二维码（图片消息需配置 WEIXIN_APP_SECRET 才能发送）：\n" +
          "• 微信群码（7 天过期）+ WhatsApp 群码见 README「社区与反馈」：\n" +
          "github.com/shenlian19831109/progmune-runtime";
      return { type: "text", content: pending };
    }
    return { type: "text", content: rule ? rule.reply : DEFAULT_REPLY };
  }
  return { type: "text", content: NON_TEXT_REPLY };
}

// ═══════════════════════════════════════════════════════════
// HTTP 服务
// ═══════════════════════════════════════════════════════════
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  if (req.method === "GET" && url.pathname === "/webhook") {
    // 微信服务器配置校验：signature=sha1(sort([token, timestamp, nonce]))，匹配则回 echostr
    const query = Object.fromEntries(url.searchParams);
    const challenge = url.searchParams.get("echostr");
    if (challenge && verifySignature(query)) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(challenge);
    } else {
      res.writeHead(403);
      res.end("signature mismatch");
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/webhook") {
    const query = Object.fromEntries(url.searchParams);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");

    // 安全模式：报文外层只有 Encrypt，msg_signature=sha1(sort([token, ts, nonce, Encrypt内容]))
    const encrypted = AES_KEY_BUF !== null && rawBody.includes("<Encrypt>");
    let msgXml = rawBody;
    if (encrypted) {
      const encryptContent = parseXml(rawBody).Encrypt;
      if (!verifySignature(query, encryptContent)) {
        res.writeHead(401);
        res.end("bad signature");
        return;
      }
      try {
        msgXml = decryptMsg(encryptContent);
      } catch (err) {
        console.error(`[mp] decrypt failed: ${err?.message || err}`);
        res.writeHead(400);
        res.end("bad encrypt");
        return;
      }
    } else if (!verifySignature(query)) {
      res.writeHead(401);
      res.end("bad signature");
      return;
    }

    const msg = parseXml(msgXml);
    const reply = decideReply(msg);
    console.log(
      `[mp] ${msg.MsgType || "?"} from ${msg.FromUserName || "?"}: ` +
        `"${(msg.Content || msg.Event || "").slice(0, 80)}" → ` +
        (reply?.type === "image" ? `image(${reply.mediaId})` : `${(reply?.content || "").slice(0, 40)}...`),
    );

    res.writeHead(200, { "Content-Type": "text/xml; charset=utf-8" });
    if (!reply) {
      res.end("success"); // 不回复：微信约定回 "success"（或空串）
      return;
    }

    // 被动回复须在 5 秒窗口内同步回包
    const timestamp = query.timestamp || String(Math.floor(Date.now() / 1000));
    const nonce = query.nonce || String(Math.floor(Date.now() / 1000));
    const replyXml =
      reply.type === "image"
        ? buildReplyXml(
            msg.FromUserName,
            msg.ToUserName,
            "image",
            `<Image><MediaId><![CDATA[${reply.mediaId}]]></MediaId></Image>`,
          )
        : buildReplyXml(
            msg.FromUserName,
            msg.ToUserName,
            "text",
            `<Content><![CDATA[${reply.content}]]></Content>`,
          );
    res.end(encrypted ? wrapEncryptedReply(replyXml, timestamp, nonce) : replyXml);
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

if (!TOKEN) {
  console.warn(
    "[mp] 警告：缺少环境变量 WEIXIN_TOKEN——签名校验已跳过（本地冒烟可用 curl 直接测规则）。",
  );
}
if (!APP_ID || !APP_SECRET) {
  console.warn(
    "[mp] 警告：缺少 WEIXIN_APP_ID / WEIXIN_APP_SECRET——「群」指令将回复文字版二维码指引（图片消息需两者齐全）。",
  );
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[mp] Progmune WeChat MP bot listening on :${PORT}`);
  ensureQrMedia(); // 后台预加载二维码素材（不阻塞监听）
});
