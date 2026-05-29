import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export interface IRFunctionSnapshot {
  name: string;
  params: { name: string; type: string }[];
  returnType: string;
}

export interface IRSnapshot {
  id: string;
  timestamp: string;
  intent?: string;
  sessionId?: string;
  functions: IRFunctionSnapshot[];
}

export interface IRDiff {
  added: IRFunctionSnapshot[];
  removed: IRFunctionSnapshot[];
  changed: { before: IRFunctionSnapshot; after: IRFunctionSnapshot }[];
  unchanged: number;
}

const projectDir = process.env.PROGMUNE_PROJECT_DIR || process.cwd();
const SNAPSHOT_DIR = path.resolve(projectDir, ".progmune_corpus", "snapshots");

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** 从 IR 数据创建快照 */
export function createSnapshot(ir: any[], intent?: string, sessionId?: string): IRSnapshot {
  const functions: IRFunctionSnapshot[] = ir.map((f: any) => ({
    name: f.name,
    params: (f.params || []).map((p: any) => ({ name: p.name, type: p.type })),
    returnType: f.returnType || "void",
  }));

  const hash = crypto.createHash("md5")
    .update(JSON.stringify(functions))
    .digest("hex")
    .slice(0, 12);

  return {
    id: `snap_${Date.now()}_${hash}`,
    timestamp: new Date().toISOString(),
    intent,
    sessionId,
    functions,
  };
}

/** 持久化快照 */
export function saveSnapshot(snapshot: IRSnapshot): string {
  ensureDir(SNAPSHOT_DIR);
  fs.writeFileSync(
    path.join(SNAPSHOT_DIR, `${snapshot.id}.json`),
    JSON.stringify(snapshot, null, 2)
  );
  return snapshot.id;
}

/** 加载快照 */
export function loadSnapshot(snapshotId: string): IRSnapshot | null {
  try {
    const raw = fs.readFileSync(path.join(SNAPSHOT_DIR, `${snapshotId}.json`), "utf-8");
    return JSON.parse(raw) as IRSnapshot;
  } catch {
    return null;
  }
}

/** 列出所有快照 */
export function listSnapshots(): IRSnapshot[] {
  const snapshots: IRSnapshot[] = [];
  if (!fs.existsSync(SNAPSHOT_DIR)) return snapshots;
  for (const file of fs.readdirSync(SNAPSHOT_DIR)) {
    if (file.endsWith(".json")) {
      try {
        snapshots.push(JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, file), "utf-8")));
      } catch {}
    }
  }
  snapshots.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return snapshots;
}

/** 计算两个快照之间的差异 */
export function diffSnapshots(before: IRSnapshot, after: IRSnapshot): IRDiff {
  const beforeMap = new Map<string, IRFunctionSnapshot>();
  const afterMap = new Map<string, IRFunctionSnapshot>();

  for (const f of before.functions) beforeMap.set(f.name, f);
  for (const f of after.functions) afterMap.set(f.name, f);

  const added: IRFunctionSnapshot[] = [];
  const removed: IRFunctionSnapshot[] = [];
  const changed: { before: IRFunctionSnapshot; after: IRFunctionSnapshot }[] = [];
  let unchanged = 0;

  for (const [name, f] of afterMap) {
    if (!beforeMap.has(name)) {
      added.push(f);
    } else {
      const bf = beforeMap.get(name)!;
      const bSig = `${bf.returnType}:${bf.params.map(p => `${p.name}:${p.type}`).join(",")}`;
      const aSig = `${f.returnType}:${f.params.map(p => `${p.name}:${p.type}`).join(",")}`;
      if (bSig !== aSig) {
        changed.push({ before: bf, after: f });
      } else {
        unchanged++;
      }
    }
  }

  for (const [name, f] of beforeMap) {
    if (!afterMap.has(name)) {
      removed.push(f);
    }
  }

  return { added, removed, changed, unchanged };
}

/** 生成快照摘要 */
export function summarizeSnapshot(snapshot: IRSnapshot): string {
  const lines = [
    `Snapshot: ${snapshot.id}`,
    `Timestamp: ${snapshot.timestamp}`,
    `Functions: ${snapshot.functions.length}`,
  ];
  if (snapshot.intent) lines.push(`Intent: ${snapshot.intent}`);
  if (snapshot.sessionId) lines.push(`Session: ${snapshot.sessionId}`);
  return lines.join("\n");
}

/** 按 sessionId 查找快照，返回最近的一个（或 undefined） */
export function findSnapshotBySession(sessionId: string): IRSnapshot | undefined {
  const snapshots = listSnapshots();
  return snapshots.find(s => s.sessionId === sessionId);
}
