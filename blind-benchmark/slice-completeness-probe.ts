/**
 * §43 只读探针：切片语料的**调用方完整性**普查。
 *
 * 为什么需要它：§43 发现 Service 层 9 条 FP 的判别证据是「上游入口带 guard」，
 * 而 `AccessTokenService.updateLastUsedForPAT` 的调用方（AccessTokenInterceptor）
 * **根本不在切片内**（hoppscotch 切片缺 src/interceptors/）。
 * ⇒ 若切片普遍不完整，那么「调用图上溯」这类跨函数机制在 fp-pool 上**无法验证**，
 *   fp-pool 就不能当它的验证场（必须先换完整仓库快照）。
 *
 * 本脚本只读、不改判据、不进扫描路径。回答一个问题：
 *   池里每个函数，切片内能否找到它的调用方？入边为 0 的比例是多少？
 *
 * 用法：
 *   npx tsx blind-benchmark/slice-completeness-probe.ts [repo...]
 */

import * as fs from "fs";
import * as path from "path";
import { buildGraph, type Graph } from "./call-graph-lib";

const ROOT = path.resolve(__dirname, "..");
const POOL = path.join(ROOT, "blind-benchmark", "fp-pool");

const bare = (n: string) => n.slice(n.lastIndexOf(".") + 1);

function probe(repo: string) {
  const dir = path.join(POOL, repo);
  if (!fs.existsSync(dir)) {
    console.log(`\n### ${repo} —— 切片不存在`);
    return;
  }
  let g: Graph;
  try {
    g = buildGraph(dir, true);
  } catch (e) {
    console.log(`\n### ${repo} —— buildGraph 失败: ${String(e).slice(0, 120)}`);
    return;
  }
  // 入边统计：谁调用了 bare(name)
  const inDeg = new Map<string, number>();
  for (const f of g.facts) {
    for (const q of f.qcalls) {
      const m = q.method;
      if (!m) continue;
      inDeg.set(m, (inDeg.get(m) || 0) + 1);
    }
  }
  const total = g.facts.length;
  let noIn = 0;
  const samples: string[] = [];
  for (const f of g.facts) {
    const n = bare(f.name);
    if (!(inDeg.get(n) || 0)) {
      noIn++;
      if (samples.length < 12) samples.push(`${f.name}  (${f.file})`);
    }
  }
  const pct = total ? ((noIn / total) * 100).toFixed(1) : "n/a";
  console.log(`\n### ${repo}`);
  console.log(`  callable 总数        : ${total}`);
  console.log(`  切片内无调用方(入边0): ${noIn}  (${pct}%)`);
  for (const s of samples) console.log(`      - ${s}`);
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const repos = args.length
  ? args
  : fs
      .readdirSync(POOL, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

console.log("=== §43 切片调用方完整性（入边 0 = 切片内找不到调用方）===");
for (const r of repos) probe(r);
