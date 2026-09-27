/**
 * principal-param-probe.ts —— §47 只读探针：把 gold 函数的**参数类型**抽出来看
 *
 * 动机：剩下 12 个仍报的确认误报里，共性看着像「被操作的主体是通过**带类型的 principal
 * 参数**（`user: User` / `user: AuthUser`）传进来的，而不是通过调用某个 auth 函数得到的」。
 * 现有判据只看 calls 列表，读不到这条证据 —— 因为先看 calls 才定型。
 *
 * 本探针不做任何修改，只回答三问：
 *   1. 这 12 条（+24 条真漏洞对照）的参数类型到底长什么样？
 *   2. 「存在 principal 类型参数」这条轴能否区分两类？
 *   3. 如果能，边界怎么画（哪些类型名算 principal）？
 *
 * 用法：npx tsx blind-benchmark/principal-param-probe.ts [repoSubstring]
 */
import * as fs from "fs";
import * as path from "path";
import { extractIRWithTypes } from "../src/extract-ir";
import { detectSafeguardViolations } from "../src/protocol-detector";

const ROOT = path.resolve(__dirname, "..");
const POOL = path.join(ROOT, "blind-benchmark", "fp-pool");
const GOLD = path.join(ROOT, "blind-benchmark", "fp-gold.jsonl");

// §48：族可指定（默认授权族）。--rule 取正则，其余首个位置参数当 repo 子串。
const argv = process.argv.slice(2);
const ruleIdx = argv.indexOf("--rule");
const RULE_RE = new RegExp(ruleIdx >= 0 ? argv[ruleIdx + 1] : "Authorization|Ownership", "i");
const only = argv.find((a, i) => i !== ruleIdx && i !== ruleIdx + 1 && !a.startsWith("--"));

interface Row { repo: string; fn: string; file: string; rule: string; gold: string; calls: string[] }
const rows: Row[] = fs.readFileSync(GOLD, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const goldAuthz = rows.filter((r) => RULE_RE.test(r.rule));
const goldTp = rows.filter((r) => r.gold === "TP" && RULE_RE.test(r.rule));

const want = new Set<string>();
goldAuthz.forEach((r) => want.add(`${r.repo}::${r.fn}`));
goldTp.forEach((r) => want.add(`${r.repo}::${r.fn}`));

const repos = fs.readdirSync(POOL)
  .filter((d) => fs.statSync(path.join(POOL, d)).isDirectory())
  .filter((d) => !only || d.includes(only))
  .filter((d) => rows.some((r) => r.repo === d && (r.gold === "TP" || RULE_RE.test(r.rule))))
  .sort();

// ▼ 以下两个函数与 fp-pool-scan.ts:94-103 **逐字一致**（R59：不许照记忆重写，
//   这里直接从该文件复制，改口径会得到与扫描器不一致的预测 —— §44 已踩过一次）。
const WEB_HANDLER = /\b(handle_request|handleRequest|request_handler|requestHandler)\b/i;
function computeExposed(funcs: Array<{ name: string; calls?: string[] }>): Set<string> {
  const exposed = new Set<string>();
  for (const f of funcs) {
    if (WEB_HANDLER.test(f.name)) for (const c of f.calls || []) exposed.add(c);
  }
  return exposed;
}
function isExposed(name: string, exposed: Set<string>): boolean {
  return exposed.has(name) || exposed.has(name.split(".").pop() || name);
}

const seen = new Set<string>();
console.log(`[probe] repos=${repos.length}`);

for (const repo of repos) {
  const dir = path.join(POOL, repo);
  let funcs: any[];
  try { funcs = extractIRWithTypes(dir).functions.filter((f: any) => !f.external); }
  catch (e: any) { console.log(`FAIL ${repo}: ${String(e?.message).slice(0, 100)}`); continue; }
  const exposed = computeExposed(funcs);
  for (const f of funcs) {
    const key = `${repo}::${f.name}`;
    if (!want.has(key) || seen.has(key)) continue;
    seen.add(key);
    const params = (f.params || []) as Array<{ name: string; type?: string }>;
    const ts = params.map((p) => `${p.name}:${p.type || "?"}`);
    const sv = detectSafeguardViolations(
      f.calls || [], f.name, "typescript",
      params.map((p) => p.name), isExposed(f.name, exposed),
      params.map((p) => p.type || "")
    );
    const rs = rows.filter((r) => `${r.repo}::${r.fn}` === key);
    const goldTags = [...new Set(rs.map((r) => `${r.gold === "TP" ? "TP" : r.gold}`))].join("/");
    console.log(
      `\n${goldTags} ${repo} :: ${f.name}\n` +
      `   params: ${ts.join(", ") || "(none)"}\n` +
      `   calls : ${(f.calls || []).slice(0, 10).join(", ") || "(none)"}\n` +
      `   fires : ${sv.map((v: any) => v.rule).join(" | ") || "(none)"}`
    );
  }
}
console.log(`\n[probe] matched ${seen.size} gold functions`);
