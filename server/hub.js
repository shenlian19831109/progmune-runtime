const http = require('http');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, "../immune_hub_data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/report") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { fingerprints } = JSON.parse(body);
        const date = new Date().toISOString().slice(0, 10);
        const filePath = path.join(DATA_DIR, `${date}.json`);

        let existing = [];
        if (fs.existsSync(filePath)) {
          existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        }
        existing.push(...fingerprints);
        fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));

        console.log(`[Hub] 收到 ${fingerprints.length} 条指纹，总计 ${existing.length} 条`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", received: fingerprints.length, total: existing.length }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end("Not Found");
  }
});

// 关键修复：显式绑定到 0.0.0.0
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Hub] 免疫汇聚服务器已启动: 0.0.0.0:${PORT}`);
});
