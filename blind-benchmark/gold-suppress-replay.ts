/**
 * gold-suppress-replay.ts —— 区分「被判据压掉」与「切片里根本看不见」
 *
 * 真实池扫描的 perFunction 只收**命中函数**（有告警的函数）。所以 gold 里一条确认误报
 * 不在 perFunction 里，有两种可能：
 *   A. 判据把它压掉了（真收益）
 *   B. 切片没提取到这个函数（分母缺失，不是收益）
 * 两者在扫描结果里长得一模一样。本脚本用离线重放（R29）区分：直接拿 gold 里记录的
 * `calls + fn` 喂当前判据，看它还报不报。
 *   - 重放仍报 ⇒ 判据没压它 ⇒ 属于 B（切片不可见）
 *   - 重放不报 ⇒ 判据压掉了 ⇒ 属于 A（真收益）
 *
 * 限制（R29 已知）：重放拿不到 params / exposed / paramTypes，paramGated 类规则不成立。
 *
 * 用法：npx tsx blind-benchmark/gold-suppress-replay.ts [--rule <正则>] [--scn <结果json>]
 *   --rule 默认 Authorization|Ownership；§48 起可传 Input Validation 等其它族。
 */
import * as fs from "fs";
import * as path from "path";
import { detectSafeguardViolations } from "../src/protocol-detector";

const ROOT = path.resolve(__dirname, "..");
const GOLD = path.join(ROOT, "blind-benchmark", "fp-gold.jsonl");
// §47：默认读**最新**扫描结果；拿 --scn <路径> 指定别的结果做前后对照。
const arg = process.argv.indexOf("--scn");
const SCAN = arg >= 0
  ? path.resolve(process.argv[arg + 1])
  : (process.env.FP_POOL_SCN
      ? path.resolve(process.env.FP_POOL_SCN)
      : path.join(ROOT, "reports", "fp-pool-results.post-47.json"));

interface GoldRow {
  repo: string; fn: string; file: string; rule: string;
  calls: string[]; gold: string;
}

const rows: GoldRow[] = fs.readFileSync(GOLD, "utf8").split("\n")
  .filter((l) => l.trim()).map((l) => JSON.parse(l));

const scan = JSON.parse(fs.readFileSync(SCAN, "utf8"));
const blocks: any[] = Array.isArray(scan) ? scan : scan.results;
const hitIdx = new Set<string>();
for (const b of blocks) {
  for (const f of b.perFunction || []) hitIdx.add(`${b.repo}::${String(f.name).trim()}`);
}

const ruleArg = process.argv.indexOf("--rule");
const RULE_RE = new RegExp(ruleArg >= 0 ? process.argv[ruleArg + 1] : "Authorization|Ownership", "i");
const authzFp = rows.filter((r) => r.gold === "FP" && RULE_RE.test(r.rule));

let aSuppressed = 0, bInvisible = 0, stillFired = 0, notInScan = 0;
const aList: GoldRow[] = [], bList: GoldRow[] = [], firedList: GoldRow[] = [];

for (const r of authzFp) {
  const key = `${r.repo}::${r.fn.trim()}`;
  if (hitIdx.has(key)) { stillFired++; firedList.push(r); continue; }
  notInScan++;
  // 离线重放：当前判据还认不认它
  const vs = detectSafeguardViolations(r.calls || [], r.fn, "typescript");
  const fired = vs.some((v) => (v as any).rule === r.rule);
  if (fired) { bInvisible++; bList.push(r); }
  else { aSuppressed++; aList.push(r); }
}

const total = authzFp.length;
console.log(`「${RULE_RE.source}」族确认误报 ${total} 条`);
console.log(`  仍报（切片里命中）        : ${stillFired}`);
console.log(`  不报 —— A 判据压掉        : ${aSuppressed}`);
console.log(`  不报 —— B 切片不可见      : ${bInvisible}`);
console.log();
console.log("--- A：判据压掉（真收益）---");
for (const r of aList) console.log(`  ${r.repo} :: ${r.fn}  [${r.rule}]`);
console.log();
console.log("--- B：重放仍报，但切片里没有（分母缺失，不是收益）---");
for (const r of bList) console.log(`  ${r.repo} :: ${r.fn}  [${r.rule}]  ${r.file}`);
console.log();
console.log("--- 仍报（待继续压）---");
for (const r of firedList) console.log(`  ${r.repo} :: ${r.fn}  [${r.rule}]`);
