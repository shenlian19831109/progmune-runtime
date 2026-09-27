/**
 * §41 抑制审计（**只读**：不改 src、不动冻结母本 fp-pool-results.json）
 *
 * ── 为什么要做这个 ────────────────────────────────────────────────
 * §38 / §39 / §40 / §41 连着五轮都在做同一件事：**把告警压下去**。
 * 每轮的验收也只有两条：① 新增压掉的条目 gold 全是 FP（TP 零损失核对）
 * ② fixture 全绿。但核对用的 gold 是**我们自己**核的，而且是从
 * 「已经被判成违规的那一批」里挑的 ⇒ 存在循环风险：
 *   - 只有**漏救的**才会进 gold ⇒ gold 里永远不会出现「被误压的真漏洞」
 *   - 于是每轮都能拿到「TP = 0」的好成绩
 *
 * 本探针破这个循环：输出**被自指排除（isAuthFunction gate）压掉**的条目清单，
 * 这批条目从来没人看过。若里面混着真漏洞，说明前几轮的抑制下手过重。
 *
 * ── 怎么做（反事实法） ────────────────────────────────────────────
 * 对同一个函数跑两次 detectSafeguardViolations：
 *   ① 实名      → 得到当前结果 R_now
 *   ② 中性名    → 保留同样的 calls/params/exposed，只把 enclosingFuncName 换成
 *                 `analyze`（必然不触发 isAuthFunction）→ 得到 R_cf
 *   ⇒ suppressed = R_cf − R_now  = 纯粹由「名字被认成鉴权机制/鉴权入口」造成的抑制
 * （safeguard 类抑制与名字无关，两次都命中 ⇒ 不在此差集内；那是 §38 的地盘，
 *   需要用另一套反事实，本轮不做。）
 *
 * 用法：
 *   npx tsx blind-benchmark/suppress-audit.ts [--limit N] [--repo X] [--authz-only]
 */
import * as fs from "fs";
import * as path from "path";
import { extractIRWithTypes, FunctionInfo } from "../src/extract-ir";
import { detectSafeguardViolations } from "../src/protocol-detector";

const POOL_DIR = path.resolve(__dirname, "fp-pool");
const OUT = path.resolve(__dirname, "reports/suppress-audit.json");

/** 中性名：不含任何 auth/jwt/token/can 等trigger，必然不被 isAuthFunction 收下 */
const NEUTRAL = "analyzeIntermediate";

const WEB_HANDLER = /\b(handle_request|handleRequest|request_handler|requestHandler)\b/i;
function computeExposed(funcs: Array<{ name: string; calls?: string[] }>): Set<string> {
  const exposed = new Set<string>();
  for (const f of funcs) if (WEB_HANDLER.test(f.name)) for (const c of f.calls || []) exposed.add(c);
  return exposed;
}
function isExposed(name: string, exposed: Set<string>): boolean {
  return exposed.has(name) || exposed.has(name.split(".").pop() || name);
}

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const limit = Number(arg("--limit", "400") ?? 400);
const onlyRepo = arg("--repo");
const authzOnly = process.argv.includes("--authz-only");

interface Row {
  repo: string;
  fn: string;
  file: string;
  line?: number;
  rules: string[];
  params: string[];
  exposed: boolean;
  callsSample: string[];
}

const rows: Row[] = [];
let scanned = 0;

for (const repo of fs
  .readdirSync(POOL_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && (!onlyRepo || e.name === onlyRepo))
  .map((e) => e.name)
  .sort()) {
  const dir = path.join(POOL_DIR, repo);
  let funcs: FunctionInfo[] = [];
  try {
    funcs = extractIRWithTypes(dir).functions.filter((f) => !f.external);
  } catch (e: any) {
    console.log(`  FAIL ${repo}: ${String(e?.message || e).slice(0, 100)}`);
    continue;
  }
  const exposed = computeExposed(funcs);

  for (const f of funcs.filter((x) => x.exported)) {
    const calls = (f.calls || []).filter((c) => !c.startsWith("__progmune"));
    const params = (f.params || []).map((p) => p.name);
    if (!calls.length) continue;
    scanned += 1;

    const ex = isExposed(f.name, exposed);
    const now = detectSafeguardViolations(calls, f.name, "typescript", params, ex);
    const cf = detectSafeguardViolations(calls, NEUTRAL, "typescript", params, ex);
    if (!cf.length) continue;

    const nowKeys = new Set(now.map((v) => v.rule));
    const suppressed = cf.filter((v) => !nowKeys.has(v.rule));
    if (!suppressed.length) continue;

    const rules = suppressed.map((v) => v.rule);
    if (authzOnly && !rules.some((r) => /^Authorization/i.test(r))) continue;

    rows.push({
      repo,
      fn: f.name,
      file: f.file || "",
      line: (f as any).line,
      rules,
      params,
      exposed: ex,
      callsSample: calls.slice(0, 14),
    });
  }
}

console.log("══ §41 抑制审计：被「名字被认成鉴权」压掉的条目 ══\n");
console.log(`扫描 ${scanned} 个 exported 函数 ⇒ 被自指排除压掉 ${rows.length} 条\n`);

const byRule = new Map<string, number>();
for (const r of rows) for (const rule of r.rules) byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
console.log("按规则：");
for (const [rule, n] of [...byRule].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${rule}`);
}

const byRepo = new Map<string, number>();
for (const r of rows) byRepo.set(r.repo, (byRepo.get(r.repo) ?? 0) + 1);
console.log("\n按 repo：");
for (const [repo, n] of [...byRepo].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${repo}`);
}

console.log(`\n明细（前 ${Math.min(limit, rows.length)} 条）：\n`);
for (const r of rows.slice(0, limit)) {
  console.log(`  [${r.repo}] ${r.fn}`);
  console.log(`      file=${r.file}  params=[${r.params.join(",")}]  exposed=${r.exposed}`);
  console.log(`      rules=${r.rules.join(" | ")}`);
  console.log(`      calls=${r.callsSample.join(",")}`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
console.log(`\n已写 ${OUT}`);
