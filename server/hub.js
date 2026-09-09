const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Progmune Immune Hub — 中央失败语料汇聚服务器。
 *
 * 防护层（2026-09 上线）：
 * 1. 字段白名单 + 类型校验（SVL-1~4、时间戳 ±窗口、序列长度上限）
 * 2. 请求体 512KB / 每请求 ≤500 条
 * 3. hub 侧按 实例+时间戳+模式 去重（内存 + 当日文件已有记录）
 * 4. 每实例每 10 分钟 ≤5 次请求（429）
 * 5. 每日总量 ≤10000 条
 * 6. 可选共享密钥：PROGMUNE_HUB_TOKEN 设置后要求 Bearer 认证
 */

const DATA_DIR = process.env.PROGMUNE_HUB_DATA_DIR || path.resolve(__dirname, "../immune_hub_data");
const RULES_FILE = path.resolve(__dirname, "../global_antibodies.json");
const HUB_TOKEN = process.env.PROGMUNE_HUB_TOKEN || "";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── 防护参数 ──
const MAX_BODY_BYTES = 512 * 1024;                 // 512KB
const MAX_FINGERPRINTS_PER_REQUEST = 500;
const MAX_FUNCTION_SEQ_ITEMS = 20;
const MAX_FUNCTION_NAME_LEN = 128;
const MAX_PRE_STATE_ITEMS = 5;
const MAX_PRE_STATE_LEN = 64;
const MAX_DAILY_RECORDS = 10000;
const RATE_WINDOW_MS = 10 * 60 * 1000;             // 10 分钟
const RATE_MAX_REQUESTS = 5;
const TS_PAST_LIMIT_MS = 90 * 24 * 60 * 60 * 1000; // 90 天前拒绝
const TS_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;     // 未来 >24h 拒绝

// ── 内存状态（单机 hub，重启清零可接受；数据本体在卷上） ──
const rateHits = new Map();   // key -> number[]（请求时间戳）
let seenToday = new Set();    // 当日去重指纹集
let seenTodayDate = "";
let dailyCount = 0;

function todayStr() { return new Date().toISOString().slice(0, 10); }

function loadSeenToday() {
  const today = todayStr();
  if (seenTodayDate === today) return;
  seenTodayDate = today;
  seenToday = new Set();
  dailyCount = 0;
  const filePath = path.join(DATA_DIR, `${today}.json`);
  try {
    if (fs.existsSync(filePath)) {
      const records = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      for (const r of records) {
        if (r && r._dedupKey) seenToday.add(r._dedupKey);
        dailyCount++;
      }
    }
  } catch { /* 当日文件损坏则从空集开始，best-effort */ }
}

function fingerprintKey(f) {
  const seq = Array.isArray(f.functionSequence) ? f.functionSequence.join("→") : "";
  const raw = `${f.instance_id}|${f.timestamp}|${f.violatedSVL}|${f.constraintType}|${seq}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** 白名单过滤 + 校验；非法返回 null */
function sanitizeFingerprint(raw) {
  if (!raw || typeof raw !== "object") return null;

  const ts = typeof raw.timestamp === "string" ? raw.timestamp : "";
  const t = Date.parse(ts);
  const now = Date.now();
  if (!ts || isNaN(t)) return null;
  if (t > now + TS_FUTURE_SKEW_MS || t < now - TS_PAST_LIMIT_MS) return null;

  const svl = String(raw.violatedSVL || "");
  if (!/^SVL-[1-4]$/.test(svl)) return null;

  const iid = String(raw.instance_id || "").slice(0, 64);
  if (!iid) return null;

  const ct = String(raw.constraintType || "").slice(0, 64);
  const seq = (Array.isArray(raw.functionSequence) ? raw.functionSequence : [])
    .slice(0, MAX_FUNCTION_SEQ_ITEMS)
    .map((x) => String(x).slice(0, MAX_FUNCTION_NAME_LEN));

  let pre;
  if (Array.isArray(raw.preState)) {
    pre = raw.preState.slice(0, MAX_PRE_STATE_ITEMS).map((group) =>
      Array.isArray(group) ? group.slice(0, MAX_PRE_STATE_ITEMS).map((s) => String(s).slice(0, MAX_PRE_STATE_LEN)) : []
    );
  }

  const count = Number.isFinite(raw.count) ? Math.min(Math.max(1, Math.floor(raw.count)), 1000) : 1;

  return {
    instance_id: iid,
    timestamp: ts,
    violatedSVL: svl,
    constraintType: ct,
    functionSequence: seq,
    ...(pre ? { preState: pre } : {}),
    count,
  };
}

function jsonResponse(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

function handleReport(req, res) {
  let body = "";
  let aborted = false;
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) {
      aborted = true;
      req.destroy();
    }
  });
  req.on('error', () => {});
  req.on('end', () => {
    if (aborted || body.length > MAX_BODY_BYTES) {
      jsonResponse(res, 413, { error: "payload too large" });
      return;
    }
    if (HUB_TOKEN) {
      const auth = String(req.headers.authorization || "");
      if (auth !== `Bearer ${HUB_TOKEN}`) {
        jsonResponse(res, 401, { error: "unauthorized" });
        return;
      }
    }
    let parsed;
    try { parsed = JSON.parse(body); } catch {
      jsonResponse(res, 400, { error: "invalid JSON" });
      return;
    }
    const rawList = Array.isArray(parsed.fingerprints) ? parsed.fingerprints : [];
    if (rawList.length === 0 || rawList.length > MAX_FINGERPRINTS_PER_REQUEST) {
      jsonResponse(res, 400, { error: "fingerprints count out of range (1-500)" });
      return;
    }

    // 限流：优先按实例，缺实例按来源 IP
    const rateKey = String((rawList[0] && rawList[0].instance_id) || req.socket.remoteAddress || "unknown");
    const now = Date.now();
    const hits = (rateHits.get(rateKey) || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (hits.length >= RATE_MAX_REQUESTS) {
      rateHits.set(rateKey, hits);
      jsonResponse(res, 429, { error: "rate limited" });
      return;
    }
    hits.push(now);
    rateHits.set(rateKey, hits);

    loadSeenToday();

    const stored = [];
    let rejected = 0;
    let deduped = 0;
    for (const raw of rawList) {
      if (stored.length >= MAX_DAILY_RECORDS - dailyCount) break; // 当日总量上限
      const f = sanitizeFingerprint(raw);
      if (!f) { rejected++; continue; }
      const key = fingerprintKey(f);
      if (seenToday.has(key)) { deduped++; continue; }
      seenToday.add(key);
      f._dedupKey = key;
      stored.push(f);
    }

    if (stored.length > 0) {
      const filePath = path.join(DATA_DIR, `${todayStr()}.json`);
      let existing = [];
      try {
        if (fs.existsSync(filePath)) existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      } catch { existing = []; }
      existing.push(...stored);
      fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
      dailyCount = existing.length;
    }

    console.log(`[Hub] 收到 ${rawList.length} 条：入库 ${stored.length}，去重 ${deduped}，拒绝 ${rejected}`);
    jsonResponse(res, 200, {
      status: 'ok',
      received: rawList.length,
      stored: stored.length,
      deduped,
      rejected,
      total: dailyCount,
    });
  });
}

// 工具函数：读取所有指纹数据
function getAllFingerprints() {
  const all = [];
  if (!fs.existsSync(DATA_DIR)) return all;
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    let records;
    try {
      records = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
    } catch { continue; }
    all.push(...records);
  }
  return all;
}

// 仪表板 API（含本周高频模式，供落地页实时展示）
function topPatternsOf(list, n) {
  const patternMap = new Map();
  list.forEach(f => {
    const seq = Array.isArray(f.functionSequence) ? f.functionSequence.join(' → ') : f.functionSequence;
    const key = `${f.violatedSVL} | ${f.constraintType} | ${seq || '(empty)'}`;
    patternMap.set(key, (patternMap.get(key) || 0) + 1);
  });
  return [...patternMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([pattern, count]) => ({ pattern, count }));
}

function handleDashboard(req, res) {
  const fingerprints = getAllFingerprints();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const todayCount = fingerprints.filter(f => f.timestamp.startsWith(today)).length;
  const weekFingerprints = fingerprints.filter(f => (f.timestamp || '') >= weekAgo);
  const weekCount = weekFingerprints.length;
  const totalCount = fingerprints.length;

  const topPatterns = topPatternsOf(fingerprints, 10);
  const topPatternsWeek = topPatternsOf(weekFingerprints, 10);

  const timeline = fingerprints
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
    .slice(0, 10)
    .map(f => ({
      time: f.timestamp,
      svl: f.violatedSVL,
      pattern: Array.isArray(f.functionSequence) ? f.functionSequence.join(' → ') : f.functionSequence,
    }));

  jsonResponse(res, 200, { todayCount, weekCount, totalCount, topPatterns, topPatternsWeek, timeline });
}

// 静态页面
function handleDashboardPage(res) {
  const htmlPath = path.resolve(__dirname, "../public/dashboard.html");
  if (fs.existsSync(htmlPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' });
    res.end(fs.readFileSync(htmlPath, 'utf-8'));
  } else {
    res.writeHead(404);
    res.end('Dashboard page not found');
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/report') {
    handleReport(req, res);
  } else if (req.method === 'GET' && req.url === '/antibodies') {
    if (fs.existsSync(RULES_FILE)) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(fs.readFileSync(RULES_FILE, 'utf-8'));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end('[]');
    }
  } else if (req.method === 'GET' && req.url === '/api/dashboard') {
    handleDashboard(req, res);
  } else if (req.method === 'GET' && (req.url === '/' || req.url === '/dashboard')) {
    handleDashboardPage(res);
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(process.env.PORT || 8080, '0.0.0.0', () => {
  console.log(`[Hub] 免疫汇聚服务器已启动: 0.0.0.0:${process.env.PORT || 8080}${HUB_TOKEN ? "（Bearer 认证开启）" : "（开放模式：限流+校验+去重防护）"}`);
});
