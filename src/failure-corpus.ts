import * as fs from "fs";
import * as path from "path";
import { withLock } from "./file-lock";

export type SVL = "SVL-1" | "SVL-2" | "SVL-3" | "SVL-4";

export interface FailureRecord {
  id: string;
  timestamp: string;
  intent: string;
  projectFunctions: string[];
  violatedSVL: SVL;
  constraintType: string;
  actionSequence: any[];
  errorDetail: string;
  ssgState?: string;
}

const CORPUS_DIR = path.resolve(__dirname, "../failure_corpus");

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function recordFailure(record: Omit<FailureRecord, "id" | "timestamp">) {
  // 使用锁 + 计数器防止同一毫秒内文件名冲突
  withLock("failure-corpus", () => {
    ensureDir(CORPUS_DIR);
    const date = new Date().toISOString().slice(0, 10);
    const dateDir = path.join(CORPUS_DIR, date);
    ensureDir(dateDir);

    // 用计数器保证同一毫秒内不重复
    const seqFile = path.join(CORPUS_DIR, ".seq");
    let seq = 0;
    try { seq = parseInt(fs.readFileSync(seqFile, 'utf-8'), 10); } catch {}
    seq++;
    fs.writeFileSync(seqFile, String(seq));

    const id = `fail_${Date.now()}_${seq}`;
    const fullRecord: FailureRecord = {
      ...record,
      id,
      timestamp: new Date().toISOString(),
    };

    const filename = `${id}.json`;
    const filepath = path.join(dateDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(fullRecord, null, 2));
    console.error(`[FailureCorpus] 记录失败案例: ${id} [${record.violatedSVL}]`);
  });
}

export function getAllFailures(): FailureRecord[] {
  const records: FailureRecord[] = [];
  if (!fs.existsSync(CORPUS_DIR)) return records;
  const dirs = fs.readdirSync(CORPUS_DIR);
  for (const dir of dirs) {
    const dirPath = path.join(CORPUS_DIR, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      if (file.endsWith(".json")) {
        const content = fs.readFileSync(path.join(dirPath, file), "utf-8");
        records.push(JSON.parse(content));
      }
    }
  }
  return records;
}

export function getFailuresBySVL(level: SVL): FailureRecord[] {
  return getAllFailures().filter(r => r.violatedSVL === level);
}

export function getTopFailurePatterns(limit: number = 5): { pattern: string; count: number }[] {
  const counts = new Map<string, number>();
  const all = getAllFailures();
  for (const r of all) {
    const key = `${r.violatedSVL}:${r.constraintType}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function generateCandidateRules(): string[] {
  const patterns = getTopFailurePatterns(3);
  const rules: string[] = [];
  for (const p of patterns) {
    if (p.pattern === "SVL-4:protocol") {
      rules.push("建议：为相关函数添加 SSG 协议约束，检查前置状态。");
    } else if (p.pattern === "SVL-1:symbol_existence") {
      rules.push("建议：检查项目 IR 是否缺少必要的函数定义。");
    } else if (p.pattern === "SVL-3:dataflow") {
      rules.push("建议：强化变量声明检查，确保变量使用前已初始化。");
    }
  }
  return rules;
}
