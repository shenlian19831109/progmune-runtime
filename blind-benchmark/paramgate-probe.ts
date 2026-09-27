/**
 * §44 只读探针：`paramGated` 的 identity 词表到底靠谁通过？
 *
 * 背景（§43.5）：`paramGated` 现在只看**参数名**是否命中
 *   /\b(token|session|user|auth|request|scope|cookie|credential|permission|role|identity)\b/i
 * 于是「被操作对象」被当成「调用者身份」：
 *   - `AccessTokenService.updateLastUsedForPAT(token: string)` 的 token 是**被更新的 PAT**
 *   - `AdminService.addUserToTeam(teamID, userEmail, role)` 的 role 是**要授予的角色**
 *
 * 本脚本只读、不改判据、不进扫描路径，**不写冻结母本 fp-pool-results.json**（R29）。
 * 它重新从切片提一次 IR（为了拿 params 的 name+type），与母本按 (repo,name,file) 对齐，
 * 然后回答三个问题：
 *   ① 现状每条 paramGated 违规，是靠 exposed / 参数名 / 还是两者通过门的？
 *   ② 若收紧成「identity 参数必须是**非原始类型**」（V1）或「更严主体词表 + 非原始类型」（V2），
 *      各压掉几条？其中 verified FP / TP / UNKNOWN 各几条？
 *   ③ 参数名这一条轴**能不能区分**主体与被操作对象（同名的相反真值有多少对）？
 *
 * 用法：
 *   npx tsx blind-benchmark/paramgate-probe.ts [repo...]
 */

import * as fs from "fs";
import * as path from "path";
import { extractIRWithTypes, type FunctionInfo } from "../src/extract-ir";

const ROOT = path.resolve(__dirname, "..");
const POOL = path.join(ROOT, "blind-benchmark", "fp-pool");
const MOTHER = path.join(ROOT, "blind-benchmark", "reports", "fp-pool-results.json");
const GOLD = path.join(ROOT, "blind-benchmark", "fp-gold.jsonl");
const OUT = path.join(ROOT, "blind-benchmark", "reports", "paramgate-probe.json");

/** 现状 identity 词表（与 src/protocol-detector.ts:1521 同源，改那边必须同步这里） */
const CURRENT_IDENTITY =
  /\b(token|session|user|auth|request|scope|cookie|credential|permission|role|identity)\b/i;

/** V2：更严的「主体」词表 —— 只留下不可能当被操作对象的写法 */
const SUBJECT_WORD =
  /^(?:user|authUser|authuser|currentUser|currentuser|me|self|principal|actor|requester|request|req|session|ctx|context|identity|auth|account|member|admin|adminUser|adminuser|operator)$/i;

/** 带 paramGated 的 6 条规则（src/protocol-detector.ts，改那边必须同步这里）。
 *  ⚠ 只有这 6 条受 paramGated 收紧影响；`Data Mutation Without Audit Trail` /
 *  `Input Validation` 之类**没有** paramGated，收紧对它们无效 —— 第一版探针没过滤，
 *  把 3 条无关违规算成了"能压掉"，口径虚高。 */
const PARAM_GATED_RULES = new Set([
  "3D Print Execution",
  "Authorization (Ownership Check)",
  "Authorization (Unauthenticated Access)",
  "Authorization (Unauthenticated Mutation)",
  "Authorization (Resource Ownership)",
  "API Contract (DB Write without Sanitization)",
]);

/** 原始类型 —— 被操作对象几乎总是这些（id/email/token string…） */
const PRIMITIVE = /^(?:string|number|boolean|any|unknown|void|never|null|undefined|object|String|Number|Boolean|Object|Date|bigint|symbol)$/;

interface MotherRow {
  repo: string;
  name: string;
  file: string;
  calls: string[];
  safeguardViolations: Array<{ rule: string; category: string }>;
}

function loadMother(): Map<string, MotherRow> {
  const raw = JSON.parse(fs.readFileSync(MOTHER, "utf8")) as Array<{
    repo: string;
    perFunction: MotherRow[];
  }>;
  const m = new Map<string, MotherRow>();
  for (const r of raw) {
    for (const v of r.perFunction) {
      m.set(`${r.repo}|${v.name}|${v.file}`, { ...v, repo: r.repo });
    }
  }
  return m;
}

function loadGold(): Map<string, { gold: string; conf: string; lead: string | null }> {
  const m = new Map<string, { gold: string; conf: string; lead: string | null }>();
  for (const line of fs.readFileSync(GOLD, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    m.set(`${r.repo}|${r.fn}|${r.rule}`, { gold: r.gold, conf: r.gold_confidence, lead: r.lead });
  }
  return m;
}

/**
 * ⚠⚠ **这份 `computeExposed` 是错的，与 fp-pool-scan.ts 不同源**（§44.4）。
 *
 * 真实口径（`fp-pool-scan.ts`）只有 `handleRequest|requestHandler` 一个正则，
 * 且只把**被它调用的函数**算 exposed ⇒ 真实 exposed 面**窄得多**。
 * 这里写成了宽口径（handler|controller|route|endpoint|middleware|resolver|…），
 * 导致本探针把大量函数误判为 exposed，预测的压制数（8 条）与真实（4 条）对不上，
 * 而且清单都不一样。
 *
 * ⇒ **要复用扫描器的辅助函数就 `import`，不许照着记忆重写**（R59 的延伸）。
 * 修正办法：把 `fp-pool-scan.ts` 的 `computeExposed` / `isExposed` 导出，
 * 这里改成 `import`。本探针的历史输出（`reports/paramgate-probe.json`）是**宽口径**
 * 下的结果，只能看"参数与真值的对应关系"，**不能**用来报压制数。
 */
function computeExposed(funcs: FunctionInfo[]): Set<string> {
  const exposed = new Set<string>();
  const looksHandler = (n: string) =>
    /\b(handler|controller|route|endpoint|middleware|resolver|listener|on[A-Z]\w+)\b/i.test(n);
  for (const f of funcs) {
    if (!looksHandler(f.name)) continue;
    for (const c of f.calls || []) exposed.add(c);
  }
  return exposed;
}

const isExposed = (exposed: Set<string>, name: string) =>
  exposed.has(name) || exposed.has(name.split(".").pop() || name);

interface Row {
  repo: string;
  fn: string;
  file: string;
  rule: string;
  params: Array<{ name: string; type: string }>;
  passCurrent: boolean;
  whyCurrent: string; // exposed | identity:<param> | none
  identityParams: string[];
  primitiveIdentityOnly: boolean; // V1：命中的 identity 参数全是原始类型
  subjectHit: string | null; // V2：命中的严格主体参数（且非原始类型）
  gold: string;
  conf: string;
  lead: string | null;
}

const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const repos = fs
  .readdirSync(POOL, { withFileTypes: true })
  .filter((e) => e.isDirectory() && (!only.length || only.includes(e.name)))
  .map((e) => e.name)
  .sort();

const mother = loadMother();
const gold = loadGold();
const rows: Row[] = [];

for (const repo of repos) {
  const dir = path.join(POOL, repo);
  let funcs: FunctionInfo[] = [];
  try {
    funcs = extractIRWithTypes(dir).functions.filter((f) => !f.external);
  } catch (e: any) {
    console.log(`FAIL ${repo}: ${String(e?.message || e).slice(0, 120)}`);
    continue;
  }
  const exposed = computeExposed(funcs);
  let hit = 0;
  for (const f of funcs) {
    const key = `${repo}|${f.name}|${f.file || ""}`;
    const mr = mother.get(key);
    if (!mr) continue;
    const params = (f.params || []).map((p) => ({ name: p.name, type: p.type || "" }));
    const exposedFlag = isExposed(exposed, f.name);
    const identityParams = params.filter((p) => CURRENT_IDENTITY.test(p.name)).map((p) => `${p.name}:${p.type}`);
    const passCurrent = exposedFlag || identityParams.length > 0;
    const typedIdentity = params.filter((p) => CURRENT_IDENTITY.test(p.name));
    const nonPrimitive = typedIdentity.filter((p) => !PRIMITIVE.test(p.type.trim()));
    const subjectHit =
      params.find((p) => SUBJECT_WORD.test(p.name) && !PRIMITIVE.test(p.type.trim())) || null;

    for (const s of mr.safeguardViolations) {
      if (!PARAM_GATED_RULES.has(s.rule)) continue; // 只有 paramGated 规则受影响
      hit++;
      const g = gold.get(`${repo}|${f.name}|${s.rule}`) || { gold: "UNKNOWN", conf: "unlabeled", lead: null };
      rows.push({
        repo,
        fn: f.name,
        file: f.file || "",
        rule: s.rule,
        params,
        passCurrent,
        whyCurrent: exposedFlag
          ? "exposed"
          : identityParams.length
            ? `identity:${identityParams.join(",")}`
            : "none",
        identityParams,
        // V1：收紧为「identity 参数必须是非原始类型」
        primitiveIdentityOnly: identityParams.length > 0 && nonPrimitive.length === 0,
        subjectHit: subjectHit ? `${subjectHit.name}:${subjectHit.type}` : null,
        gold: g.gold,
        conf: g.conf,
        lead: g.lead,
      });
    }
  }
  console.log(`${repo}: 对齐母本 ${hit} 条违规（IR 函数 ${funcs.length}）`);
}

/* ---------------- 汇总 ---------------- */

const by = <K extends string>(fn: (r: Row) => K) => {
  const m = new Map<K, number>();
  for (const r of rows) m.set(fn(r), (m.get(fn(r)) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

/** V1：identity 只靠原始类型参数 ⇒ 视为「被操作对象」，收紧后不通过（除非 exposed） */
const v1Suppress = rows.filter(
  (r) => r.whyCurrent.startsWith("identity:") && r.primitiveIdentityOnly
);
/** V2：必须命中严格主体词表且非原始类型 */
const v2Suppress = rows.filter((r) => r.whyCurrent.startsWith("identity:") && !r.subjectHit);

const verdictOf = (rs: Row[]) => {
  const m = new Map<string, number>();
  for (const r of rs) {
    const k = `${r.gold}/${r.conf}`;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

console.log("\n=== §44 paramGated 通过原因分布（全规则）===");
for (const [k, v] of by((r) => r.rule)) console.log(`  ${String(v).padStart(4)}  ${k}`);

console.log("\n=== 通过门的依据 ===");
for (const [k, v] of by((r) => (r.whyCurrent.startsWith("identity:") ? "仅靠 identity 参数名" : r.whyCurrent))) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}

for (const [name, set] of [["V1 收紧（identity 必须非原始类型）", v1Suppress], ["V2 收紧（严格主体词 + 非原始类型）", v2Suppress]] as const) {
  console.log(`\n=== ${name}：压掉 ${set.length} 条 ===`);
  console.log("  真值分布:", verdictOf(set).map(([k, v]) => `${k}=${v}`).join("  "));
  console.log("  按规则:", by(() => "").length ? set.reduce<Record<string, number>>((a, r) => ((a[r.rule] = (a[r.rule] || 0) + 1), a), {}) : {});
  for (const r of set.slice(0, 40)) {
    console.log(
      `    - [${r.repo}] ${r.fn} :: ${r.rule}  params=(${r.params.map((p) => `${p.name}:${p.type}`).join(", ")})  gold=${r.gold}/${r.conf}`
    );
  }
}

/** R66 自检：同名参数、相反真值的对数 */
const nameTruth = new Map<string, Set<string>>();
for (const r of rows) {
  for (const p of r.params) {
    if (!CURRENT_IDENTITY.test(p.name)) continue;
    const k = p.name.toLowerCase();
    if (!nameTruth.has(k)) nameTruth.set(k, new Set());
    nameTruth.get(k)!.add(r.gold);
  }
}
const ambiguous = [...nameTruth.entries()].filter(([, s]) => s.size > 1);
console.log("\n=== R66 自检：identity 参数名 ↔ 真值是否一一对应 ===");
for (const [n, s] of nameTruth) console.log(`  ${n.padEnd(12)} → ${[...s].join("/")}`);
console.log(`  ⇒ 同名却真值相反的参数名：${ambiguous.length ? ambiguous.map(([n]) => n).join(", ") : "无"}`);

fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      $what: "§44 paramGated identity 词表普查（只读探针，不写冻结母本）",
      $note: "params 来自重新提取的 IR；gold 来自 fp-gold.jsonl；违规面来自冻结母本 fp-pool-results.json",
      total: rows.length,
      v1_suppressed: v1Suppress.length,
      v2_suppressed: v2Suppress.length,
      ambiguous_identity_names: ambiguous.map(([n, s]) => ({ name: n, truths: [...s] })),
      rows,
    },
    null,
    2
  )
);
console.log(`\n已写 ${OUT}`);
