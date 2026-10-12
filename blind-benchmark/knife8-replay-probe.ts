/**
 * 第八刀离线重放探针（R29：拿已记录的 calls+name 直接喂检测器，不重提 IR）
 *
 * 候选修法：Mutation 规则 excludePatterns 增补三个词撞形状——
 *   E1 /\bforUpdate\b/                          Kysely 悲观锁（SELECT 非变更）
 *   E2 /\bcreateCipheriv\b|\bcreateDecipheriv\b/  crypto AEAD 构造器
 *   E3 /\bwith[A-Z]\w*UpdatedBy\b/              select 子查询构建器名
 * 及 Access 规则增补：
 *   E4 /\bgetConfig\b/                          存储驱动配置读取
 *
 * 输出：①docmost 逐函数 Mutation/Access 判定翻转清单（预期只翻词撞类）
 *      ②盲测语料（batch-scan-results.json）中含这些 token 的函数计数
 *        （>0 则须人工判断漂移，=0 则零漂移由构造保证）
 *
 * 用法：npx ts-node blind-benchmark/knife8-replay-probe.ts
 */

import * as fs from "fs";
import * as path from "path";
import { identifierParse } from "../src/protocol-detector";

const ROOT = path.resolve(__dirname, "..");
const IR = path.join(ROOT, "benchmarks", "ts-apps", "docmost", "apps", "server", "ir.json");
const BS = path.join(ROOT, "blind-benchmark", "reports", "batch-scan-results.json");

const MUT_EXCLUDES = [/\bforUpdate\b/, /\bcreateCipheriv\b|\bcreateDecipheriv\b/, /\bwith[A-Z]\w*UpdatedBy\b/];
const ACCESS_EXCLUDES = [/\bgetConfig\b/];

const ir = JSON.parse(fs.readFileSync(IR, "utf8"));
const functions: Array<{ name: string; file?: string; calls?: string[]; params?: Array<{ name: string; type?: string }> }> =
  Array.isArray(ir) ? ir : ir.functions || [];

function effectiveCallsOf(f: { name: string; calls?: string[] }): string[] {
  const ownName = f.name.split(".").pop() || f.name;
  const raw = [ownName, ...(f.calls || [])];
  const words: string[] = [];
  for (const c of raw) words.push(...identifierParse(c));
  return [...new Set([...raw, ...words])];
}

// 当前告警流（第七刀后）
const report = JSON.parse(fs.readFileSync(path.join(ROOT, "blind-benchmark/reports/heldout/trust-docmost-66ab-pre.json"), "utf8"));
type Row = { rule: string; fn: string };
const rows: Row[] = [];
for (const g of report.overall.safeguardAlerts.groups) {
  if (g.rule !== "Authorization (Unauthenticated Mutation)" && g.rule !== "Authorization (Unauthenticated Access)") continue;
  for (const e of g.alerts ?? []) rows.push({ rule: g.rule, fn: e.alert.function });
}
const mutFns = new Set(rows.filter((r) => r.rule.includes("Mutation")).map((r) => r.fn));
const accFns = new Set(rows.filter((r) => r.rule.includes("Access")).map((r) => r.fn));
console.log(`当前告警流：Mutation ${mutFns.size} / Access ${accFns.size}`);

console.log("\n=== 预测压掉（docmost）===");
let predMut = 0, predAcc = 0;
const byName = new Map(functions.map((f) => [f.name, f]));
for (const f of functions) {
  const eff = effectiveCallsOf(f);
  if (mutFns.has(f.name)) {
    const hit = MUT_EXCLUDES.filter((re) => eff.some((c) => re.test(c)));
    if (hit.length) {
      predMut++;
      console.log(`  Mutation  ${f.name.padEnd(50)} matched=[${hit.map((h) => eff.find((c) => h.test(c))).join(",")}]`);
    }
  }
  if (accFns.has(f.name)) {
    const hit = ACCESS_EXCLUDES.filter((re) => eff.some((c) => re.test(c)));
    if (hit.length) {
      predAcc++;
      console.log(`  Access    ${f.name.padEnd(50)} matched=[${hit.map((h) => eff.find((c) => h.test(c))).join(",")}]`);
    }
  }
}
console.log(`\n预测压掉合计：Mutation ${predMut} + Access ${predAcc}`);

// 盲测语料含候选 token 的函数计数
console.log("\n=== 盲测语料（batch-scan-results.json）token 存在性 ===");
const bs = JSON.parse(fs.readFileSync(BS, "utf8"));
let tokHits = 0;
const hitProjects = new Set<string>();
for (const p of bs.projects) {
  for (const pf of p.perFunction || []) {
    const eff = effectiveCallsOf(pf);
    for (const re of [...MUT_EXCLUDES, ...ACCESS_EXCLUDES]) {
      if (eff.some((c) => re.test(c))) {
        tokHits++;
        hitProjects.add(p.project);
      }
    }
  }
}
console.log(`含候选 token 的函数数: ${tokHits}（项目 ${hitProjects.size} 个）${tokHits === 0 ? "⇒ 零漂移由构造保证" : "⇒ 需人工判断"}`);
