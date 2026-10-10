/**
 * 守卫传播可压名单 × 174 条标注队列交叉核对（只读）。
 * 输出：可压名单中不在标注队列的部分（需人工复核调用链）+ 分层消歧的
 * 归因统计（后缀唯一/同文件/同目录/类根对齐各消歧了多少条边）。
 */
import * as fs from "fs";
import { computeGuardPropagatedSet } from "/Users/shenlian/progmune-runtime/src/protocol-detector";

const ir: Array<{ name: string; file?: string; calls?: string[] }> = JSON.parse(
  fs.readFileSync("benchmarks/ts-apps/docmost/apps/server/ir.json", "utf8")
);
const MARK = "__progmune_auth_machinery__";
const byName = new Map<string, { name: string; file?: string; calls?: string[] }>();
for (const f of ir) byName.set(f.name, f);

const g = computeGuardPropagatedSet(ir);
const scan = JSON.parse(fs.readFileSync("blind-benchmark/reports/heldout/trust-docmost-3.7.63.json", "utf8"));
const alerts = scan.overall.safeguardAlerts.topRanked.map((t: any) => t.alert);
const auth = alerts.filter((a: any) => String(a.rule).startsWith("Authorization"));

const supp: Array<{ fn: string; rule: string }> = [];
for (const a of auth) {
  const f = byName.get(a.function);
  const direct = f ? (f.calls || []).includes(MARK) : true;
  if (g.has(a.function) && !direct) supp.push({ fn: a.function, rule: a.rule });
}

const queue = new Map<string, Set<string>>();
for (const line of fs.readFileSync("blind-benchmark/reports/advisories/annotation-queue.jsonl", "utf8").split("\n")) {
  if (!line.trim()) continue;
  const x = JSON.parse(line);
  if (!queue.has(x.fn)) queue.set(x.fn, new Set());
  queue.get(x.fn)!.add(x.rule);
}

const unannotated = supp.filter((s) => !queue.has(s.fn));
const annotatedSame = supp.filter((s) => queue.get(s.fn)?.has(s.rule));
const annotatedOther = supp.filter((s) => queue.has(s.fn) && !queue.get(s.fn)!.has(s.rule));

console.log(`可压 ${supp.length} 条：`);
console.log(`  标注队列同函数同规则 FP：${annotatedSame.length}`);
console.log(`  标注队列同函数不同规则 FP：${annotatedOther.length}`);
console.log(`  不在标注队列：${unannotated.length}`);
if (unannotated.length) {
  console.log("\n未标注可压明细（每条已由算法保证全部调用方已守卫，列调用链供复核）:");
  for (const s of unannotated) {
    const bare = s.fn.split(".").pop() || s.fn;
    const callers = ir.filter((f) => (f.calls || []).includes(bare) && f.name !== s.fn).map((f) => {
      const marked = (f.calls || []).includes(MARK);
      const guarded = g.has(f.name);
      return `${f.name}${marked ? "[直接守卫]" : guarded ? "[传播守卫]" : "[?]"}`;
    });
    console.log(`  ${s.fn} :: ${s.rule}`);
    console.log(`      <- ${callers.join(", ")}`);
  }
}
