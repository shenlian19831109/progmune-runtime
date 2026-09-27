/**
 * §41 抑制**归因**（只读）—— 定位「到底是哪一个调用充当了压制的理由」
 *
 * 与 `suppress-audit.ts` 的区别：
 *   - suppress-audit 抓的是 **isAuthFunction 自指排除**（改动 enclosingFuncName 做反事实）
 *   - 本探针抓的是 **safeguard 类抑制**（改动 calls 做反事实）：
 *       某规则本来会报，但因为 calls 里有个词**命中了它的 safeguard** ⇒ 不报。
 *     这类抑制的量远大于自指排除（§38 一次加了 3 条谓语就压掉 21 条），
 *     而且**从来没有被审计过**。
 *
 * 反事实法：对同一次调用做 N+1 次 detect ——
 *   base = detect(calls, NEUTRAL, …)
 *   ∀c ∈ calls: alt_c = detect(calls \ {c}, NEUTRAL, …)
 *   newly_c = alt_c \ base   ⇒ c 就是这条规则的「压制理由」
 *
 * 用 NEUTRAL 而不是实名：把自指排除的影响从方程里消掉，
 * 保证差集**只**反映 safeguard。（§39/§40 的自指排除已由 suppress-audit 单独审计。）
 *
 * 产出用来回答两个问题：
 *   Q1 哪些调用名充当了压制理由？（词频表）
 *   Q2 其中有没有**不该算授权证据的通用名**？
 *      例：若 `includes` / `String` / `debug` 能压掉 Authorization 规则，
 *      说明某条 safeguard 正则宽到失去意义 —— 这是抑制侧最严重的失效模式。
 *
 * 用法：
 *   npx tsx blind-benchmark/suppress-why.ts [--repo X] [--authz-only] [--limit N]
 */
import * as fs from "fs";
import * as path from "path";
import { extractIRWithTypes, FunctionInfo } from "../src/extract-ir";
import { detectSafeguardViolations } from "../src/protocol-detector";

const POOL_DIR = path.resolve(__dirname, "fp-pool");
const OUT = path.resolve(__dirname, "reports/suppress-why.json");
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
const onlyRepo = arg("--repo");
const authzOnly = process.argv.includes("--authz-only");
const limit = Number(arg("--limit", "40") ?? 40);

/** 压制理由记录：一次「call → 被它压掉的规则」 */
interface Why {
  repo: string;
  fn: string;
  file: string;
  rule: string;
  reason: string; // 充当压制理由的调用名
}

const whys: Why[] = [];
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
  } catch {
    continue;
  }
  const exposed = computeExposed(funcs);

  for (const f of funcs.filter((x) => x.exported)) {
    const calls = (f.calls || []).filter((c: string) => !c.startsWith("__progmune"));
    const uniq = [...new Set(calls)];
    if (uniq.length < 2) continue;
    const params = (f.params || []).map((p) => p.name);
    const ex = isExposed(f.name, exposed);
    scanned += 1;

    const base = new Set(
      detectSafeguardViolations(calls, NEUTRAL, "typescript", params, ex).map((v) => v.rule)
    );
    // drop-one counterfactual
    for (const c of uniq) {
      const alt = detectSafeguardViolations(
        calls.filter((x: string) => x !== c),
        NEUTRAL,
        "typescript",
        params,
        ex
      );
      for (const v of alt) {
        if (base.has(v.rule)) continue;
        if (authzOnly && !/^Authorization/i.test(v.rule)) continue;
        whys.push({ repo, fn: f.name, file: f.file || "", rule: v.rule, reason: c });
      }
    }
  }
}

console.log("══ §41 抑制归因：哪一个调用充当了压制理由 ══\n");
console.log(`扫描 ${scanned} 个 exported 函数 ⇒ ${whys.length} 条「call → 压掉的规则」\n`);

/* Q1 压制理由词频 */
const freq = new Map<string, Set<string>>();
for (const w of whys) {
  if (!freq.has(w.reason)) freq.set(w.reason, new Set());
  freq.get(w.reason)!.add(w.rule);
}
console.log("Q1 压制理由词频（reason → 能压掉几条不同规则）：\n");
const sorted = [...freq.entries()].sort((a, b) => b[1].size - a[1].size || freq.size - freq.size);
for (const [reason, rules] of sorted.slice(0, limit)) {
  console.log(
    `  ${String(rules.size).padStart(2)} rules  ${reason.padEnd(30)} ${[...rules].map((r) => r.replace("Authorization ", "")).join(" | ")}`
  );
}

/* Q2 可疑的通用名 */
const GENERIC =
  /^(?:includes|String|Number|Boolean|Array|Object|JSON|Date|Promise|map|filter|forEach|push|pop|slice|split|join|indexOf|keys|values|entries|toString|valueOf|then|catch|next|error|log|debug|info|warn|now|getTime|setDate|assign|parse|stringify|clone|create|get|set|save|find|findOne|update|remove|delete|send|emit|callback|done|err)$/i;
const suspicious = whys.filter((w) => GENERIC.test(w.reason));
console.log(`\nQ2 ⚠ 通用名充当压制理由：**${suspicious.length}** 条\n`);
const byReason = new Map<string, number>();
for (const s of suspicious) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
for (const [r, n] of [...byReason].sort((a, b) => b[1] - a[1]).slice(0, limit)) {
  console.log(`  ${String(n).padStart(4)}  ${r}`);
  const ex = suspicious.filter((s) => s.reason === r).slice(0, 2);
  for (const e of ex) console.log(`          e.g. [${e.repo}] ${e.fn} :: ${e.rule}`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(whys, null, 1));
console.log(`\n已写 ${OUT}`);
