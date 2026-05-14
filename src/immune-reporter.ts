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
const FINGERPRINT_FILE = path.resolve(__dirname, "../.progmune_memory/fingerprints.json");

function getInstanceId(): string {
  const host = require("os").hostname();
  const cwd = process.cwd();
  return crypto.createHash("sha256").update(host + cwd).digest("hex").substring(0, 16);
}

export function extractFingerprints(): ImmuneFingerprint[] {
  const corpusDir = path.resolve(__dirname, "../failure_corpus");
  if (!fs.existsSync(corpusDir)) return [];

  const fingerprints: ImmuneFingerprint[] = [];
  const instanceId = getInstanceId();

  for (const dateDir of fs.readdirSync(corpusDir)) {
    const datePath = path.join(corpusDir, dateDir);
    if (!fs.statSync(datePath).isDirectory()) continue;

    for (const file of fs.readdirSync(datePath)) {
      if (!file.endsWith(".json")) continue;
      const record = JSON.parse(fs.readFileSync(path.join(datePath, file), "utf-8"));

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

export async function reportFingerprints(): Promise<{ success: boolean; message: string }> {
  const fingerprints = extractFingerprints();
  if (fingerprints.length === 0) {
    return { success: true, message: "无新指纹需要上报" };
  }

  let reported: string[] = [];
  if (fs.existsSync(FINGERPRINT_FILE)) {
    reported = JSON.parse(fs.readFileSync(FINGERPRINT_FILE, "utf-8"));
  }
  const newFingerprints = fingerprints.filter(f => !reported.includes(f.functionSequence.join(",")));
  if (newFingerprints.length === 0) {
    return { success: true, message: "所有指纹已上报，无新增" };
  }

  const payload = JSON.stringify({ fingerprints: newFingerprints });

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
          const updated = [...reported, ...newFingerprints.map(f => f.functionSequence.join(","))];
          const dir = path.dirname(FINGERPRINT_FILE);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(FINGERPRINT_FILE, JSON.stringify(updated, null, 2));
          resolve({ success: true, message: `成功上报 ${newFingerprints.length} 条新指纹` });
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
  return extractFingerprints();
}
