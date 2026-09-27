/**
 * §45 精确影响预测（只读，不改 src）
 *
 * 原理：加 triggerOwnNameOnly 后 triggerCalls 变为 [ownName]。
 *      其它条件（paramGated / exposed / requireMarker / safeguard / isAuthFunction）完全不变。
 *      ⇒ LOST(f, R) ⟺ R ∈ 当前违规(f)  ∧  trigger 不命中 ownName(f)
 * 判定「trigger 是否命中 ownName」用黑盒：detectSafeguardViolations([], ownName, ...) 是否产出 R。
 * （参数侧用 params=["user"] + paramTypes=["User"] 保证 paramGate 放行，隔离出 trigger 这一个变量）
 */
import * as fs from "fs";
import { detectSafeguardViolations } from "/Users/shenlian/progmune-runtime/src/protocol-detector";

const BASE = process.argv[2] || "/Users/shenlian/progmune-runtime/blind-benchmark/reports/batch-scan-results.json";
const d = JSON.parse(fs.readFileSync(BASE, "utf8"));

const cache = new Map<string, Set<string>>();
function ownNameHits(ownName: string): Set<string> {
  if (cache.has(ownName)) return cache.get(ownName)!;
  const vs = detectSafeguardViolations([], ownName, "typescript", ["user"], false, ["User"]);
  const s = new Set(vs.filter((v) => String(v.rule).startsWith("Authorization")).map((v) => String(v.rule)));
  cache.set(ownName, s);
  return s;
}

let total = 0;
const lost: Array<{ proj: string; fn: string; rule: string }> = [];
const survive: Array<{ proj: string; fn: string; rule: string }> = [];

for (const pr of d.projects) {
  for (const v of pr.perFunction || []) {
    const own = String(v.name).split(".").pop() || String(v.name);
    for (const s of v.safeguardViolations || []) {
      if (!String(s.rule).startsWith("Authorization")) continue;
      total++;
      if (ownNameHits(own).has(String(s.rule))) survive.push({ proj: pr.project, fn: v.name, rule: s.rule });
      else lost.push({ proj: pr.project, fn: v.name, rule: s.rule });
    }
  }
}

console.log(`基线 ${BASE.split("/").pop()}`);
console.log(`当前 AZ 违规总数 ${total}`);
console.log(`  ownName 命中 trigger ⇒ 保留 : ${survive.length}`);
console.log(`  ownName 不命中 ⇒ §45 会压掉 : ${lost.length}`);

const byFn = new Map<string, number>();
for (const l of lost) byFn.set(l.fn, (byFn.get(l.fn) || 0) + 1);
console.log("\n被压函数名分布：");
[...byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([k, n]) => console.log(`   ${n.toString().padStart(4)}  ${k}`));

const byProj = new Set(lost.map((l) => l.proj));
console.log(`\n涉及项目 ${byProj.size} 个：${[...byProj].sort().join(", ")}`);

const byRule = new Map<string, number>();
for (const l of lost) byRule.set(l.rule, (byRule.get(l.rule) || 0) + 1);
console.log("\n按规则：");
[...byRule.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`   ${n.toString().padStart(4)}  ${k}`));

console.log("\n非 handleRequest 的明细（真正的差分，需逐条判断真假）：");
lost.filter((l) => l.fn !== "handleRequest").forEach((l) => console.log(`   [${l.proj}] ${l.fn} :: ${l.rule}`));
