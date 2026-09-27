/**
 * §四十一：acronym 拆分的影响面探针（**只读**，不改 src、不改母本）
 *
 * 背景（§40.8 候选 C5）：`identifierParse("verifyJWTPayload")` → ["verify","JWTPayload"]，
 * ⇒ 词表里无论写 `jwt` 还是 `token` 都进不来 ⇒ verdaccio 的 `verifyJWTPayload`
 * （JWT payload 校验原语 = 鉴权机制本体）判不成 auth function。
 *
 * 但 `identifierParse` 是**主干**：5 个调用点 feeding
 *   - isAuthFunctionName / isAuthMachineryName（是否自指排除）
 *   - effectiveCalls（safeguard 匹配源）
 *   - buildSafeguardContext 的 context words
 *   - triggerParsedWords（trigger 匹配源）
 * ⇒ 改它会同时动 **抑制方向**（多压）和 **触发方向**（多报）。必须两侧都量。
 *
 * 本探针回答三个问题：
 *   Q1 语料里到底有多少标识符卡在 acronym 上？（规模）
 *   Q2 各候选拆分变体会**新增哪些词**？（受益面）
 *   Q3 各变体会**丢掉哪些词**？（LOST 风险）——按 R59，这里必须用 src 的同源判据重算
 *
 * 用法：
 *   npx tsx blind-benchmark/split-probe.ts --show 20
 *   npx tsx blind-benchmark/split-probe.ts --authz     # 只列对 authorization 侧有影响的
 */
import * as fs from "fs";
import * as path from "path";
import {
  identifierParse,
  AUTHZ_PREDICATE_RE,
  AUTHZ_CAN_HELPER_RE,
  AUTHZ_ACCESS_CHECK_RE,
  AUTHZ_BARE_CAN_RE,
} from "../src/protocol-detector";

const ROOT = path.resolve(__dirname, "..");
const POOL = path.join(ROOT, "blind-benchmark/reports/fp-pool-results.json");

/* ---------------- 候选拆分变体 ---------------- */

/** BASE：现状。lower→Upper 切一刀 */
function splitBase(name: string): string[] {
  return identifierParse(name);
}

/**
 * V-A（保守 / 推荐）：在 BASE 之上，只在「连续大写块 + 大写开头的小写词」处再切一刀。
 *   verifyJWTPayload → verify | JWT | Payload
 *   HTTPServer       → HTTP | Server      （前置全大写块单独成词）
 *   getDTOById       → get | DTO | By | Id
 * 不会动 `UserID → User | ID` 这类已经能拆的，也不会切数字。
 */
function splitVA(name: string): string[] {
  const base = identifierParse(name);
  const out: string[] = [];
  for (const w of base) {
    // 形如 XXXXYyyy：把最后一个「大写+小写」整体切出去
    const parts = w
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1\x00$2")
      .split("\x00")
      .filter((x) => x.length > 0);
    if (parts.length > 1) out.push(...parts);
    else out.push(w);
  }
  return out;
}

/** V-A2：V-A 且**保留原块**（同时收录 JWT Payload 与 JWTPayload）⇒ 纯放松，不可能 LOST */
function splitVA2(name: string): string[] {
  const base = identifierParse(name);
  const va = splitVA(name);
  return [...base, ...va.filter((w) => !base.includes(w))];
}

/**
 * V-B（激进 / 对照组）：完整词边界拆分，连数字也切开。
 *   SHA256 → SHA | 256     parseURL → parse | URL
 * 用于回答「激进一档会多多少个词」——按 R57 每刀必须有宽变体对照。
 */
function splitVB(name: string): string[] {
  return name
    .split(/[_\-\.]/)
    .flatMap((p) => (p.match(/[A-Z]+(?![a-z])|[A-Z][a-z]*|[a-z]+|[0-9]+/g) ?? []));
}

const VARIANTS: Array<{ id: string; fn: (s: string) => string[] }> = [
  { id: "V-A  保守(仅大写块)", fn: splitVA },
  { id: "V-A2 保守+保留原块", fn: splitVA2 },
  { id: "V-B  激进(含数字)", fn: splitVB },
];

/* ---------------- 主逻辑 ---------------- */

interface Fn {
  repo: string;
  file: string;
  name: string;
  calls: string[];
  violations: Array<{ rule: string; category: string }>;
}

function loadPool(): Fn[] {
  const raw = JSON.parse(fs.readFileSync(POOL, "utf8"));
  const out: Fn[] = [];
  for (const s of raw) {
    for (const f of s.perFunction ?? []) {
      out.push({
        repo: s.repo,
        file: f.file,
        name: f.name,
        calls: (f.calls ?? []).filter((c: string) => !c.startsWith("__progmune")),
        violations: (f.safeguardViolations ?? []).map((v: any) => ({
          rule: v.rule,
          category: v.category,
        })),
      });
    }
  }
  return out;
}

const show = Number(process.argv[process.argv.indexOf("--show") + 1] ?? 15);
const authzOnly = process.argv.includes("--authz");

const pool = loadPool();

// 所有标识符（函数名 + 调用名）
const ids = new Set<string>();
let idTotal = 0;
for (const f of pool) {
  idTotal += 1 + f.calls.length;
  ids.add(f.name);
  for (const c of f.calls) ids.add(c);
}

console.log("══ §41 acronym 拆分影响面 ══\n");
console.log(`母本：${pool.length} 个函数，去重标识符 ${ids.size} 个（含调用名共 ${idTotal} 次）\n`);

/* Q1 规模 */
const ACRO = /[A-Z]{2,}/;
const acronyms = [...ids].filter((i) => ACRO.test(i));
console.log(`Q1 规模：含连续大写（acronym 候选）的标识符 **${acronyms.length}** / ${ids.size} = ${(acronyms.length / ids.size * 100).toFixed(1)}%`);
console.log(`  示例：${acronyms.slice(0, Math.min(show, 24)).join("  ")}\n`);

/* Q2/Q3 各变体的增减词 */
console.log("Q2/Q3 各变体相对 BASE 的词集变化：\n");
console.log("  变体                  新增词(去重)  丢失词(去重)  受益标识符");
for (const v of VARIANTS) {
  const added = new Set<string>();
  const lost = new Set<string>();
  let changed = 0;
  for (const id of ids) {
    const b = new Set(splitBase(id));
    const n = new Set(v.fn(id));
    if (n.size === b.size && [...n].every((w) => b.has(w))) continue;
    changed += 1;
    for (const w of n) if (!b.has(w)) added.add(w);
    for (const w of b) if (!n.has(w)) lost.add(w);
  }
  console.log(
    `  ${v.id.padEnd(22)} ${String(added.size).padStart(6)}      ${String(lost.size).padStart(8)}     ${String(changed).padStart(6)}`
  );
  if (authzOnly) {
    // 新增词里能进词表的（对 authorization 侧真正有用的）
    const useful = [...added].filter(
      (w) =>
        /^(?:jwt|token| Tokens |oauth|oidc|saml|ldap|bearer|apikey|apiKey|md5|sha|hmac|ssl|tls|csrf|uuid|ip|url|uri|acl|rbac|dto|acl)$/i.test(
          w
        )
    );
    if (useful.length) console.log(`      ↳ 含凭据/机制类新词 ${useful.length}：${useful.slice(0, 20).join(", ")}`);
    if (lost.size) console.log(`      ↳ ⚠ 丢失词样本：${[...lost].slice(0, 12).join(", ")}`);
  }
}

/* Q3′ 具体看 impacted 标识符的拆分差异 */
console.log(`\nQ3′ 拆分差异明细（前 ${show} 条，V-A2）：\n`);
let shown = 0;
for (const id of ids) {
  const b = splitBase(id);
  const n = splitVA2(id);
  if (JSON.stringify(b) === JSON.stringify(n)) continue;
  console.log(`  ${id.padEnd(34)} BASE=${JSON.stringify(b)}`);
  console.log(`  ${"".padEnd(34)} V-A2=${JSON.stringify(n)}`);
  if (++shown >= show) break;
}

/* Q4：Authorization 侧的具体受益 —— 哪些函数的新词能让 border 判据命中 */
const AUTHZ_RES: Array<[RegExp, string]> = [
  [AUTHZ_PREDICATE_RE, "casl_predicate"],
  [AUTHZ_CAN_HELPER_RE, "can_helper"],
  [AUTHZ_ACCESS_CHECK_RE, "access_check"],
  [AUTHZ_BARE_CAN_RE, "bare_can"],
];
console.log(`\nQ4 对 §38/§40 四条授权谓语的影响（仅 V-A2 新增词造成的新命中）：\n`);
let hits = 0;
for (const f of pool) {
  const baseWords = new Set([f.name, ...f.calls].flatMap(splitBase).map((w) => w.toLowerCase()));
  const newWords = [...f.name, ...f.calls]
    .flatMap(splitVA2)
    .map((w) => w.toLowerCase())
    .filter((w) => !baseWords.has(w));
  if (!newWords.length) continue;
  for (const [re, label] of AUTHZ_RES) {
    const m = newWords.filter((w) => re.test(w));
    if (m.length) {
      hits += 1;
      console.log(`  [${label}] ${f.repo}/${f.name}  新词=${m.join(",")}`);
    }
  }
}
if (!hits) console.log("  （无）");
