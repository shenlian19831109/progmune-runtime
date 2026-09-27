/**
 * §40 候选判据探针：剩余池人工核验之后，三刀候选各能压掉什么（只读，不改 src）
 *
 * 核验 §40.2 发现的三处**判据缺口**（都不是新机制，是 §38/§39 自己没闭合的地方）：
 *
 *   C1 裸 `can` / `allow(auth)` 工厂：verdaccio `publish` 里 `const can = allow(auth, …)`，
 *      路由上挂 `can('publish')` —— calls 里是裸 `can`，§38 的 NAME_A 要求
 *      `can[A-Z_]\w*`（后面必须跟大写/下划线）⇒ 裸 can 落空。（CASL 的
 *      `ability.can(Action.Update, subj)` 同形态，属同一处缺口）
 *   C2 函数名**自身**是授权谓语：`canRemove` 报 "Ownership Check" —— 它**就是**
 *      那个检查。§39 的自指排除只认 AUTH_PATTERN + 机制名，**不认 `can<X>`**。
 *   C3 AUTHZ_ACTION 用**全等**匹配：`mayUpdateIdentity` 拆出 "UpdateIdentity"
 *      不是纯动作词 ⇒ 降为 A-soft 噪声档不收。改成动作词**前缀**匹配。
 *
 * 三刀都必须在**剩余池**（目标批）与**全量 authorization**（对照批）上分别量命中，
 * 比值 ≠ 1× 才证明有鉴别力（R50）。
 *
 * 用法：
 *   npx tsx blind-benchmark/cand40-probe.ts [--show 40]
 */

import * as fs from "fs";
import * as path from "path";
import { nameHits, accepted, AUTHZ_ACTION } from "./authz-probe";

const ROOT = path.resolve(__dirname, "..");
const POOL = path.join(ROOT, "blind-benchmark", "reports", "fp-pool-results.json");
const GOLD = path.join(ROOT, "blind-benchmark", "fp-gold.jsonl");

type Viol = {
  repo: string; fn: string; file: string; rule: string;
  calls: string[]; gold?: string; conf?: string;
};

const goldIndex = new Map<string, { gold: string; conf: string }>();
for (const line of fs.readFileSync(GOLD, "utf8").split("\n")) {
  if (!line.trim()) continue;
  try {
    const g = JSON.parse(line);
    goldIndex.set(`${g.repo}/${g.fn}::${g.rule}`, { gold: g.gold, conf: g.gold_confidence });
  } catch { /* skip */ }
}

const pool = JSON.parse(fs.readFileSync(POOL, "utf8")) as Array<{
  repo: string;
  perFunction: Array<{ name: string; file: string; calls?: string[]; safeguardViolations?: any[] }>;
}>;

const rows: Viol[] = [];
for (const s of pool) {
  for (const f of s.perFunction ?? []) {
    for (const v of f.safeguardViolations ?? []) {
      if (v.category !== "authorization") continue;
      const g = goldIndex.get(`${s.repo}/${f.name}::${v.rule}`);
      rows.push({ repo: s.repo, fn: f.name, file: f.file, rule: v.rule, calls: f.calls ?? [], gold: g?.gold, conf: g?.conf });
    }
  }
}

const key = (r: Viol) => `${r.repo}/${r.fn}::${r.rule}`;

/* ---------------- 已落地的两轮（基线） ---------------- */
const byAuthz = (r: Viol) => accepted(nameHits(r.calls)).length > 0;
const { isAuthStruct, isAuthV0 } = require("./selfref-probe") as typeof import("./selfref-probe");
const bySelf = (r: Viol) => isAuthStruct(r.fn, "V-C") || isAuthV0(r.fn);

const base38 = new Set(rows.filter(byAuthz).map(key));
const base39 = new Set(rows.filter(bySelf).map(key));
const residual = rows.filter((r) => !base38.has(key(r)) && !base39.has(key(r)));

/* ---------------- C1：裸 can（CASL ability.can / verdaccio can('publish')） ----------------
 *
 * ⚠ 只收 **精确** 的 can / cannot 与 `x.can` / `x.cannot`，**不收** `allow`。
 *   第一版把 `allow`（verdaccio 的中间件工厂）也收了，但 `allow` 是通用动词
 *   （配置里 `allow(...)`、CORS `allow_origin`），太宽；而 publish / stage 的
 *   calls 里**本来就有**裸 `can`，不需要靠 allow 兜。
 */
const BARE_CAN = /^(?:can|cannot)$/i;
const QUALIFIED_CAN = /\.(?:can|cannot)$/i;

const c1 = (r: Viol) => r.calls.some((c) => BARE_CAN.test(c) || QUALIFIED_CAN.test(c));

/* ---------------- C2：函数名自身是授权谓语 ---------------- */
/** 函数自己就是那个检查 ⇒ 对它报"缺检查"是自指谬误。§38 判据 + 名字本身 */
const c2 = (r: Viol) => {
  const bare = r.fn.slice(r.fn.lastIndexOf(".") + 1);
  return accepted(nameHits([bare])).length > 0;
};

/* ---------------- C4：容器**严格等于**鉴权类（Auth / Authorization / AccessControl） ---
 *
 * §39.8 记下的未收项：verdaccio `Auth.allow_*` 家族与
 * `Auth.setLegacyAuthCacheEntry`。容器 `Auth` 不带 Guard/Strategy 后缀，
 * 方法也不是"动词×凭据名词" ⇒ 结构化判据够不着。
 *
 * ⚠ 只能收**严格等于**的裸类名：AuthController / AuthService 是**端点**，
 *   §39 的 V-D 反向验证明确证明 `AuthController.deletePendingUserData` 这类
 *   **不能**压（对凭据/待处理用户做增删改恰恰最需要鉴权）。
 */
const AUTH_CONTAINER_EXACT = /^(?:Auth|Authorization|AccessControl|Permissions?)$/;
const c4 = (r: Viol) => {
  const i = r.fn.lastIndexOf(".");
  if (i <= 0) return false;
  return AUTH_CONTAINER_EXACT.test(r.fn.slice(0, i));
};

/* ---------------- C5：acronym-aware 拆词后再判机制（verifyJWTPayload） ----------------
 *
 * `identifierParse("verifyJWTPayload")` = ["verify", "JWTPayload"] —— 只在
 * `[a-z][A-Z]` 处切，**不认全大写缩写块** ⇒ "jwt" 永远进不了词表
 * ⇒ §39 的"机制动词 × 机制对象"对 verifyJWTPayload / resolveRemoteUser(JWT) /
 * OIDCStrategy / AESLegacy 这类名字全部失效（静默失效，R42 同族）。
 */
function identifierParseAcro(name: string): string[] {
  const parts = name.split(/[_\-\.]/);
  const words: string[] = [];
  for (const part of parts) {
    const camel = part.replace(/([a-z])([A-Z])/g, "$1 $2");
    // 缩写块边界：JWTPayload → JWT Payload；verifyJWT → verify JWT
    const acro = camel.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
    for (const w of acro.split(" ")) if (w.length > 0) words.push(w);
  }
  return words;
}
const MECH_VERB = ["verify", "validate", "sign", "generate", "issue", "decode", "parse", "encode", "refresh", "rotate", "get", "set", "create", "build", "make", "write", "read"];
const MECH_OBJ = ["jwt", "token", "cookie", "session", "credential", "credentials", "signature", "bearer"];
const c5 = (r: Viol) => {
  const i = r.fn.lastIndexOf(".");
  const method = i >= 0 ? r.fn.slice(i + 1) : r.fn;
  const w = identifierParseAcro(method).map((x) => x.toLowerCase());
  return w.some((x) => MECH_VERB.includes(x)) && w.some((x) => MECH_OBJ.includes(x));
};

/* ---------------- 报告 ---------------- */
const show = Number(process.argv.includes("--show") ? process.argv[process.argv.indexOf("--show") + 1] : 30);

const cands: Array<{ id: string; fn: (r: Viol) => boolean; note: string }> = [
  { id: "C1 裸can", fn: c1, note: "calls 含精确 can / cannot / x.can" },
  { id: "C2 自身谓语名", fn: c2, note: "函数名本身就是 can<X>/…Access" },
  { id: "C4 容器=Auth", fn: c4, note: "Class 严格等于 Auth/Authorization/AccessControl" },
  { id: "C5 acronym拆词", fn: c5, note: "verifyJWTPayload 等缩写块不再挡词表" },
];

console.log(`\n=== §40 候选判据（母本 9 片，authorization 全量 ${rows.length} 条，剩余池 ${residual.length} 条）===`);

for (const c of cands) {
  const hitRes = residual.filter(c.fn);
  const hitAll = rows.filter(c.fn);
  const rateAll = hitAll.length / rows.length;
  const rateRes = hitRes.length / residual.length;
  console.log(`\n--- ${c.id}（${c.note}）---`);
  console.log(`  剩余池命中 ${hitRes.length}/${residual.length} = ${(rateRes * 100).toFixed(1)}%`);
  console.log(`  全量命中   ${hitAll.length}/${rows.length} = ${(rateAll * 100).toFixed(1)}%`);
  console.log(`  鉴别力     ${(rateRes / (rateAll || 1)).toFixed(2)}×`);
  const golds = new Map<string, number>();
  for (const r of hitRes) golds.set(`${r.gold ?? "-"}`, (golds.get(`${r.gold ?? "-"}`) ?? 0) + 1);
  console.log(`  命中条目的 gold：${[...golds.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}`);
  for (const r of hitRes.slice(0, show)) console.log(`    [${r.repo}] ${r.fn} :: ${r.rule} <${r.gold ?? "-"}>`);
  console.log(`  【全量命中清单，标 * 的是已被 §38/§39 压掉的（用于查误伤）】`);
  for (const r of hitAll.slice(0, show)) {
    const already = !base38.has(key(r)) && !base39.has(key(r)) ? " " : "*";
    console.log(`   ${already} [${r.repo}] ${r.fn} :: ${r.rule} <${r.gold ?? "-"}>`);
  }
}

/* ---------------- 宽变体对照（R57：抑制方向改动必须报"宽一档会多压什么"） ----------
 *
 * 每一刀都配一个**宽一档**的变体，用来证明窄判据不是随手收紧，而是有边界：
 *   W1 = C1 去掉精确匹配（改成含 can 的词级匹配，即 identifierParse 拆词后命中）
 *   W2 = C2 连"只有形态没有动作词"（canSendEmail 这类）也收
 *   W4 = C4 容器放宽到 Auth*（AuthController / AuthService 也算）
 */
/** W1：去掉精确匹配 ⇒ cancel / candidate / canSendEmail 全进来 */
const W1 = (r: Viol) => r.calls.some((c) => /can|cannot/i.test(c));
const W2 = (r: Viol) => {
  const i = r.fn.lastIndexOf(".");
  const m = i >= 0 ? r.fn.slice(i + 1) : r.fn;
  return /^(?:can|able|may|isAble|isAllowed|isPermitted|hasPermission|checkPermission|authorize|isAuthorized|authorised|allowed|permitted|cannot)[A-Z_]?\w*$/i.test(m);
};
const W4 = (r: Viol) => {
  const i = r.fn.lastIndexOf(".");
  return i > 0 && /^Auth/i.test(r.fn.slice(0, i));
};

if (process.argv.includes("--wide")) {
  const narrow = (r: Viol) => c1(r) || c2(r) || c4(r);
  const wide = (r: Viol) => W1(r) || W2(r) || W4(r);
  for (const [tag, fn] of [["W1 裸can放宽(词级)", W1], ["W2 自身谓语放宽(含A-soft)", W2], ["W4 容器放宽(Auth*)", W4]] as const) {
    const extra = rows.filter((r) => fn(r) && !narrow(r));
    console.log(`\n--- ${tag}：比窄判据多压 ${extra.length} 条 ---`);
    for (const r of extra.slice(0, 25)) console.log(`    [${r.repo}] ${r.fn} :: ${r.rule} <${r.gold ?? "-"}>`);
  }
  const allWide = rows.filter(wide);
  console.log(`\n宽变体合计压 ${allWide.length} / 窄变体压 ${rows.filter(narrow).length}`);
}

/* 三刀并集在剩余池上 */
const union = residual.filter((r) => cands.some((c) => c.fn(r)));
console.log(`\n=== 三刀并集：剩余池 ${residual.length} → 压掉 ${union.length} → 剩 ${residual.length - union.length} ===`);
const left = residual.filter((r) => !cands.some((c) => c.fn(r)));
console.log(`\n--- 仍未救的 ${left.length} 条 ---`);
for (const r of left) console.log(`  [${r.repo}] ${r.fn} :: ${r.rule} <${r.gold ?? "-"}>`);

fs.writeFileSync(
  path.join(ROOT, "blind-benchmark", "reports", "cand40.json"),
  JSON.stringify(
    {
      total: rows.length,
      residual: residual.length,
      c1: residual.filter(c1).map((r) => `${r.repo}/${r.fn}::${r.rule}`),
      c2: residual.filter(c2).map((r) => `${r.repo}/${r.fn}::${r.rule}`),
      c5: residual.filter(c5).map((r) => `${r.repo}/${r.fn}::${r.rule}`),
      left: left.map((r) => `${r.repo}/${r.fn}::${r.rule}`),
    },
    null,
    2
  )
);
console.log("\n已写 reports/cand40.json");
