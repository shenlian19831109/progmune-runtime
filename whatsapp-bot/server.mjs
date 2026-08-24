/**
 * Progmune WhatsApp 自动回复 Bot（零依赖 Node ≥18，可直接部署）
 *
 * 功能：WhatsApp Business Cloud API webhook——关键词规则自动回复。
 *  - GET  /webhook  Meta 验证握手（verify_token / challenge）
 *  - POST /webhook  收消息 → 规则匹配 → Graph API 回复
 *  - GET  /health   部署存活探针
 *
 * 环境变量：
 *   WHATSAPP_VERIFY_TOKEN    （必填）Meta 后台配置的 webhook 验证令牌（自定义任意串）
 *   WHATSAPP_ACCESS_TOKEN    （必填）Meta 应用 System User 的长期访问令牌
 *   WHATSAPP_PHONE_NUMBER_ID （必填）WhatsApp 业务号码 ID（Meta 后台可见）
 *   WHATSAPP_APP_SECRET      （可选）设置后校验 X-Hub-Signature-256 签名（防伪造回调）
 *   PORT                     （可选）默认 8080
 *
 * Meta 侧注册步骤见 README.md；测试模式（5 个测试号码）无需商业验证即可收发。
 *
 * 回复规则在 RULES 数组内，按顺序匹配（首个命中生效），关键词小写包含匹配。
 */

import http from "node:http";
import crypto from "node:crypto";

const PORT = process.env.PORT || 8080;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "";
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || "";
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const APP_SECRET = process.env.WHATSAPP_APP_SECRET || "";
const GRAPH_API = "https://graph.facebook.com/v21.0";

// ═══════════════════════════════════════════════════════════
// 回复规则（顺序匹配，首个命中生效）
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
    image: true, // 命中后先发社区二维码图片，再发下方文字
    reply:
      "社区群二维码已发送 👆\n" +
      "• 微信群码（7 天过期，过期请去 README 刷新）\n" +
      "• WhatsApp 群\n" +
      "群码也会同步在仓库 README「社区与反馈」章节：github.com/shenlian19831109/progmune-runtime",
  },
  {
    keywords: ["支持", "语言", "language", "python", "coverage", "覆盖", "矩阵", "go", "java"],
    reply:
      "语言覆盖（2026-08，v3.7.2）：\n" +
      "• TypeScript ✅ 生产级——协议行 ✅×4（Auth/Payment/Data Integrity/Ledger）+ 源码级检测；盲测 795 gold，Recall 98.5%（有效 100%）/ Precision 100%\n" +
      "• Python ✅——协议行 ✅×2（Auth/Resource Lifecycle，盲测 v1.2：66 gold，97%/100%/0 FP）+ 源码级检测（盲测 729 gold，Recall 100%）\n" +
      "• C ⚠️ 研究级——TLS/SSL/SSH/HTTP2/HTTP Request ✅，gold 基准 F1=16.5%\n" +
      "• Go / Java ❌ 未实现\n" +
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

function matchRule(text) {
  const lower = (text || "").toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) return rule;
  }
  return null;
}

// 社区二维码合成图（微信 + WhatsApp 群码并排），与仓库 assets/community-qr.png 同步
const GROUP_IMAGE_URL =
  "https://raw.githubusercontent.com/shenlian19831109/progmune-runtime/main/assets/community-qr.png";

// ═══════════════════════════════════════════════════════════
// Meta Graph API：发送回复
// ═══════════════════════════════════════════════════════════
async function sendReply(to, body) {
  try {
    const res = await fetch(`${GRAPH_API}/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body },
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`[bot] Graph API ${res.status}: ${text}`);
      return false;
    }
    console.log(`[bot] replied to ${to} (${body.length} chars)`);
    return true;
  } catch (err) {
    // 网络/Graph API 故障不得打崩服务：记录失败，消息丢失（WhatsApp 用户可重发）
    console.error(`[bot] send failed to ${to}: ${err?.cause?.code || err?.message || err}`);
    return false;
  }
}

/** 发送图片消息（link 需公网可访问） */
async function sendImage(to, link) {
  try {
    const res = await fetch(`${GRAPH_API}/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "image",
        image: { link },
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`[bot] Graph API image ${res.status}: ${text}`);
      return false;
    }
    console.log(`[bot] sent image to ${to}`);
    return true;
  } catch (err) {
    console.error(`[bot] send image failed to ${to}: ${err?.cause?.code || err?.message || err}`);
    return false;
  }
}

/** 提取回调中的文本消息（忽略状态回执等非消息事件） */
function extractTextMessages(payload) {
  const out = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      for (const msg of value.messages || []) {
        if (msg.type === "text" && msg.from && msg.text?.body) {
          out.push({ from: msg.from, body: msg.text.body });
        }
      }
    }
  }
  return out;
}

/** X-Hub-Signature-256 校验（配置 APP_SECRET 时启用） */
function verifySignature(rawBody, header) {
  if (!APP_SECRET) return true; // 未配置则不校验
  if (!header) return false;
  const expected = crypto.createHmac("sha256", APP_SECRET).update(rawBody).digest("hex");
  const actual = header.startsWith("sha256=") ? header.slice(7) : header;
  return crypto.timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(actual, "utf8"),
  );
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
    // Meta 验证握手：hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (VERIFY_TOKEN && token === VERIFY_TOKEN && challenge) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(challenge);
    } else {
      res.writeHead(403);
      res.end("verify_token mismatch");
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/webhook") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks);

    if (!verifySignature(rawBody.toString("utf8"), req.headers["x-hub-signature-256"])) {
      res.writeHead(401);
      res.end("bad signature");
      return;
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.writeHead(400);
      res.end("bad json");
      return;
    }

    // 立即 200（WhatsApp 要求快速响应；回复异步发出）
    res.writeHead(200);
    res.end("ok");

    for (const { from, body } of extractTextMessages(payload)) {
      const rule = matchRule(body);
      if (rule?.image) {
        // 「群」：先发社区二维码图片，再补一句文字
        console.log(`[bot] ${from}: "群" → 发送社区二维码图片`);
        await sendImage(from, GROUP_IMAGE_URL);
        await sendReply(from, rule.reply);
      } else {
        const reply = rule ? rule.reply : DEFAULT_REPLY;
        console.log(`[bot] ${from}: "${body.slice(0, 80)}" → ${reply.slice(0, 40)}...`);
        await sendReply(from, reply);
      }
    }
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

if (!VERIFY_TOKEN || !ACCESS_TOKEN || !PHONE_NUMBER_ID) {
  console.warn(
    "[bot] 警告：缺少环境变量 WHATSAPP_VERIFY_TOKEN / WHATSAPP_ACCESS_TOKEN / " +
      "WHATSAPP_PHONE_NUMBER_ID——webhook 验证与回复将失败（本地冒烟可用 curl 直接测规则）。",
  );
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[bot] Progmune WhatsApp bot listening on :${PORT}`);
});
