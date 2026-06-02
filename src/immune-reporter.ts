import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import * as crypto from "crypto";

interface ImmuneFingerprint {
  instance_id: string;
  timestamp: string;
  violatedSVL: string;
  constraintType: string;
  functionSequence: string[];
  preState?: string[];
  postState?: string[];
  count: number;
}

const REPORT_ENDPOINT = process.env.PROGMUNE_HUB || "http://localhost:3000/report";
const CURSOR_FILE = path.resolve(__dirname, "../.progmune_memory/report_cursor.json");

function getInstanceId(): string {
  const host = require("os").hostname();
  const cwd = process.cwd();
  return crypto.createHash("sha256").update(host + cwd).digest("hex").substring(0, 16);
}

function getReportCursor(): { lastTimestamp: string | null; reportedCount: number } {
  try {
    if (fs.existsSync(CURSOR_FILE))
      return JSON.parse(fs.readFileSync(CURSOR_FILE, "utf-8"));
  } catch {}
  return { lastTimestamp: null, reportedCount: 0 };
}

function saveReportCursor(timestamp: string, count: number) {
  const dir = path.dirname(CURSOR_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    CURSOR_FILE,
    JSON.stringify({ lastTimestamp: timestamp, reportedCount: count, updatedAt: new Date().toISOString() }, null, 2)
  );
}

export function extractFingerprints(cursor?: { lastTimestamp: string | null }): ImmuneFingerprint[] {
  const corpusDir = path.resolve(__dirname, "../failure_corpus");
  if (!fs.existsSync(corpusDir)) return [];

  const fingerprints: ImmuneFingerprint[] = [];
  const instanceId = getInstanceId();

  for (const dateDir of fs.readdirSync(corpusDir).sort()) {
    const datePath = path.join(corpusDir, dateDir);
    if (!fs.statSync(datePath).isDirectory()) continue;

    for (const file of fs.readdirSync(datePath).sort()) {
      if (!file.endsWith(".json")) continue;
      const filePath = path.join(datePath, file);
      const record = JSON.parse(fs.readFileSync(filePath, "utf-8"));

      // 如果游标存在且该记录时间戳 <= 游标，跳过
      if (cursor && cursor.lastTimestamp && record.timestamp <= cursor.lastTimestamp) continue;

      const funcSeq = (record.actionSequence || [])
        .filter((a: any) => a.kind === "call")
        .map((a: any) => a.function);

      fingerprints.push({
        instance_id: instanceId,
        timestamp: record.timestamp,
        violatedSVL: record.violatedSVL,
        constraintType: record.constraintType,
        functionSequence: funcSeq,
        preState: record.ssgState ? [record.ssgState] : undefined,
        postState: undefined,
        count: 1,
      });
    }
  }
  return fingerprints;
}

/** @requires CORPUS @produces FINGERPRINT_REPORT */
export async function reportFingerprints(): Promise<{ success: boolean; message: string }> {
  const cursor = getReportCursor();
  const fingerprints = extractFingerprints(cursor);
  if (fingerprints.length === 0) {
    return { success: true, message: "无新指纹需要上报" };
  }

  // 按时间戳排序，取最新的作为游标
  fingerprints.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const maxTimestamp = fingerprints[fingerprints.length - 1].timestamp;

  const payload = JSON.stringify({ fingerprints });

  return new Promise((resolve) => {
    const url = new URL(REPORT_ENDPOINT);
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(REPORT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, (res: any) => {
      let data = "";
      res.on("data", (chunk: string) => data += chunk);
      res.on("end", () => {
        if (res.statusCode === 200) {
          const total = (cursor.reportedCount || 0) + fingerprints.length;
          saveReportCursor(maxTimestamp, total);
          resolve({ success: true, message: `成功上报 ${fingerprints.length} 条新指纹（累计 ${total} 条）` });
        } else {
          resolve({ success: false, message: `上报失败: ${res.statusCode} ${data}` });
        }
      });
    });
    req.on("error", (e: Error) => resolve({ success: false, message: `网络错误: ${e.message}` }));
    req.write(payload);
    req.end();
  });
}

export function previewFingerprints(): ImmuneFingerprint[] {
  return extractFingerprints({ lastTimestamp: null });
}
