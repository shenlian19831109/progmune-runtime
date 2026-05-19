const http = require('http');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, "../immune_hub_data");
const RULES_FILE = path.resolve(__dirname, "../global_antibodies.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const PORT = process.env.PORT || 8080;

// 工具函数：读取所有指纹数据
function getAllFingerprints() {
  const all = [];
  if (!fs.existsSync(DATA_DIR)) return all;
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const records = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
    all.push(...records);
  }
  return all;
}

// 仪表板 API
function handleDashboard(req, res) {
  const fingerprints = getAllFingerprints();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // 今日/本周/总计
  const todayCount = fingerprints.filter(f => f.timestamp.startsWith(today)).length;
  const weekCount = fingerprints.filter(f => f.timestamp >= weekAgo).length;
  const totalCount = fingerprints.length;

  // 高频错误模式 (Top 10)
  const patternMap = new Map();
  fingerprints.forEach(f => {
    const seq = Array.isArray(f.functionSequence) ? f.functionSequence.join(' → ') : f.functionSequence;
    const key = `${f.violatedSVL} | ${f.constraintType} | ${seq || '(empty)'}`;
    patternMap.set(key, (patternMap.get(key) || 0) + 1);
  });
  const topPatterns = [...patternMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([pattern, count]) => ({ pattern, count }));

  // 最近10条时间线
  const timeline = fingerprints
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
    .slice(0, 10)
    .map(f => ({
      time: f.timestamp,
      svl: f.violatedSVL,
      pattern: Array.isArray(f.functionSequence) ? f.functionSequence.join(' → ') : f.functionSequence,
    }));

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ todayCount, weekCount, totalCount, topPatterns, timeline }));
}

// 静态页面
function handleDashboardPage(res) {
  const htmlPath = path.resolve(__dirname, "../public/dashboard.html");
  if (fs.existsSync(htmlPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(htmlPath, 'utf-8'));
  } else {
    res.writeHead(404);
    res.end('Dashboard page not found');
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/report') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { fingerprints } = JSON.parse(body);
        const date = new Date().toISOString().slice(0, 10);
        const filePath = path.join(DATA_DIR, `${date}.json`);
        let existing = [];
        if (fs.existsSync(filePath)) {
          existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
        existing.push(...fingerprints);
        fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
        console.log(`[Hub] 收到 ${fingerprints.length} 条指纹，总计 ${existing.length} 条`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', received: fingerprints.length, total: existing.length }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  } else if (req.method === 'GET' && req.url === '/antibodies') {
    if (fs.existsSync(RULES_FILE)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(fs.readFileSync(RULES_FILE, 'utf-8'));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Hub] 免疫汇聚服务器已启动: 0.0.0.0:${PORT}`);
});
