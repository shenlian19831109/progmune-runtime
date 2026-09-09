import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import * as crypto from "crypto";

/**
 * Phase 7: Immune Reporter — 失败指纹上报中央语料 hub。
 *
 * 口径（2026-09 修复定稿）：
 * - 默认开启：脱敏指纹自动上报中央 hub（源码与原文函数名永不上传）；
 *   设置 PROGMUNE_HUB=off（或 0/false/no/disabled）可关闭上报。
 * - 数据源：.progmune_corpus/{date}/fail_*.json——与 failure-corpus.ts 统一路径
 *   （此前读仓库根 failure_corpus/ 已废弃，导致 hub 自 2026-05 起零新增）。
 * - 端点：PROGMUNE_HUB 未设 → https://progmune-runtime.fly.dev/report；
 *   设了其他 URL → 自定义 hub。
 * - 脱敏：默认函数名 SHA-256 截断（同名字符串同哈希，模式聚合仍有效）；
 *   PROGMUNE_FINGERPRINT_DETAIL=1 才发送原文函数名。
 */

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

// ── 数据源（与 failure-corpus.ts 统一路径，项目级、可写） ──
const PROJECT_DIR = process.env.PROGMUNE_PROJECT_DIR || process.cwd();
const CORPUS_DIR = process.env.PROGMUNE_CORPUS_DIR || path.resolve(PROJECT_DIR, ".progmune_corpus");
const CURSOR_FILE = path.join(CORPUS_DIR, ".report_cursor.json");

// ── 端点与开关 ──
const HUB_ENV = process.env.PROGMUNE_HUB;
const DETAIL_ENABLED = process.env.PROGMUNE_FINGERPRINT_DETAIL === "1";
const OFF_PATTERN = /^(off|0|false|no|disabled)$/i;

/** 解析上报端点：显式关闭 → null；未设 → 中央 hub；其他 → 自定义 URL。 */
export function resolveEndpoint(env: string | undefined = HUB_ENV): string | null {
  if (env && OFF_PATTERN.test(env)) return null;
  return env || "https://progmune-runtime.fly.dev/report";
}

/** 脱敏：默认哈希函数名；DETAIL 开关打开时保留原文。 */
export function maskFunctionName(name: string, detail: boolean = DETAIL_ENABLED): string {
  if (detail) return name;
  return "fn:" + crypto.createHash("sha256").update(name).digest("hex").substring(0, 12);
}

function getInstanceId(): string {
  const host = require("os").hostname();
  const cwd = process.cwd();
  return crypto.createHash("sha256").update(host + cwd).digest("hex").substring(0, 16);
}

function getReportCursor(): { lastTimestamp: string | null; reportedCount: number } {
  try {
    if (fs.existsSync(CURSOR_FILE))
      return JSON.parse(fs.readFileSync(CURSOR_FILE, "utf-8"));
  } catch { /* report may be unavailable */ }
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

/** 收集语料目录中的新失败指纹（含脱敏处理）。corpusDir 参数便于测试注入。 */
export function extractFingerprints(
  cursor?: { lastTimestamp: string | null },
  corpusDir: string = CORPUS_DIR,
): ImmuneFingerprint[] {
  if (!fs.existsSync(corpusDir)) return [];

  const fingerprints: ImmuneFingerprint[] = [];
  const instanceId = getInstanceId();

  for (const dateDir of fs.readdirSync(corpusDir).sort()) {
    const datePath = path.join(corpusDir, dateDir);
    if (!fs.statSync(datePath).isDirectory()) continue;

    for (const file of fs.readdirSync(datePath).sort()) {
      if (!file.endsWith(".json") || !file.startsWith("fail_")) continue;
      const filePath = path.join(datePath, file);
      let record: any;
      try {
        record = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      } catch { continue; /* 损坏记录跳过，best-effort */ }

      // 游标存在且该记录时间戳 <= 游标，跳过
      if (cursor && cursor.lastTimestamp && (record.timestamp || "") <= cursor.lastTimestamp) continue;

      const funcSeq = (record.actionSequence || [])
        .filter((a: any) => a.kind === "call")
        .map((a: any) => maskFunctionName(String(a.function)));

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
  const endpoint = resolveEndpoint();
  if (endpoint === null) {
    return { success: true, message: "上报已禁用（PROGMUNE_HUB=off），跳过" };
  }

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
    const url = new URL(endpoint);
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(endpoint, {
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
    req.setTimeout(8000, () => req.destroy(new Error("上报超时")));
    req.on("error", (e: Error) => resolve({ success: false, message: `网络错误: ${e.message}` }));
    req.write(payload);
    req.end();
  });
}

export function previewFingerprints(): ImmuneFingerprint[] {
  return extractFingerprints({ lastTimestamp: null });
}
