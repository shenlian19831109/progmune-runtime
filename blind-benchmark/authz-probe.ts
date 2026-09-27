/**
 * §三十八 只读探针：对象级授权「谓语 / 客体」形态普查
 *
 * 背景：Authorization 族 UNKNOWN 共 32 条。现有 satisfier（protocol-detector.ts:388）
 * 是**动词白名单**：canModify|canDelete|canEdit|hasPermission|checkOwner…。
 * 而真实世界的授权谓语是**组合式**：
 *   - CASL：ability.cannot(Manage, Settings) / ability.can(Read, 'Page')
 *   - 带前缀 helper：validateCanEdit / validateCanComment（\b 词边界让它们整条漏掉）
 *   - verdaccio：canRemove
 * 另有**客体-self 形态**：removeUserAvatar(user) —— 实参就是当前用户，
 * 操作天然作用于自己，无需额外所有权比较。
 *
 * 本脚本**只读分析、不改判据、不进扫描路径**。目标是回答两件事：
 *   ① 这三类形态在真值 UNKNOWN 上能覆盖多少条（召回）
 *   ② 命中的证据原文是否经得起人工核对（精度）
 *
 * 用法：
 *   npx tsx blind-benchmark/authz-probe.ts --repo docmost --src /tmp/full-docmost
 *   npx tsx blind-benchmark/authz-probe.ts --all
 */

import * as fs from "fs";
import * as path from "path";
import {
  AUTHZ_PREDICATE_RE,
  AUTHZ_CAN_HELPER_RE,
  AUTHZ_ACCESS_CHECK_RE,
} from "../src/protocol-detector";

const ROOT = path.resolve(__dirname, "..");
const GOLD = path.join(ROOT, "blind-benchmark", "fp-gold.jsonl");
const OUT_DIR = path.join(ROOT, "blind-benchmark", "reports");

const flag = (name: string, def: string | null = null): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
};

interface GoldRow {
  repo: string;
  fn: string;
  file: string;
  rule: string;
  calls?: string[];
  gold?: string;
}

/* ---------------- 函数体提取（轻量：花括号计数，不用 ts-morph） ---------------- */

/** 从 startIdx 处的 `{` 开始计数到配对 `}`，返回 [start, end) */
function braceSpan(text: string, openIdx: number): [number, number] | null {
  if (text[openIdx] !== "{") return null;
  let depth = 0;
  let inStr: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    const prev = i > 0 ? text[i - 1] : "";
    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === "/" && prev === "*") inBlockComment = false;
      continue;
    }
    if (inStr) {
      if (c === "\\") i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      inLineComment = true;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      inBlockComment = true;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return [openIdx, i + 1];
    }
  }
  return null;
}

/**
 * 定位函数体。fn 可能是 `Class.method` 或裸名。
 * 返回 { body, start } 或 null（找不到 = 抽取失败，必须单独计数，不能当"无证据"）。
 */
function locate(text: string, fn: string): { body: string; start: number } | null {
  const dot = fn.lastIndexOf(".");
  const cls = dot > 0 ? fn.slice(0, dot) : null;
  const method = dot > 0 ? fn.slice(dot + 1) : fn;

  let haystack = text;
  let base = 0;
  if (cls) {
    // 类体范围：class X ... {  （也认 export class X extends Y）
    const re = new RegExp(`(?:export\\s+)?(?:abstract\\s+)?class\\s+${cls}\\b`);
    const m = re.exec(text);
    if (m) {
      const open = text.indexOf("{", m.index + m[0].length);
      if (open >= 0) {
        const span = braceSpan(text, open);
        if (span) {
          haystack = text.slice(span[0], span[1]);
          base = span[0];
        }
      }
    }
  }

  // 方法/函数声明：`async foo(` `foo(` `foo = (` `foo = async (` `function foo(`
  const declRe = new RegExp(
    `(?:^|\\n)\\s*(?:public\\s+|private\\s+|protected\\s+|static\\s+|async\\s+|readonly\\s+)*` +
      `(?:function\\s+)?${method}\\s*(?:<[^>]*>)?\\s*\\(`,
    "m"
  );
  let m = declRe.exec(haystack);
  if (!m) {
    // 箭头属性：`foo = (a) => {` / `foo = async (a) => {`
    const arrowRe = new RegExp(
      `(?:^|\\n)\\s*(?:public\\s+|private\\s+|protected\\s+|static\\s+|readonly\\s+)*` +
        `${method}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>`,
      "m"
    );
    m = arrowRe.exec(haystack);
    if (!m) return null;
    // 箭头：从 `=>` 后找 `{`，若无 `{` 则是表达式体，取整行
    const arrowIdx = haystack.indexOf("=>", m.index);
    const open = haystack.indexOf("{", arrowIdx);
    if (open < 0) {
      const nl = haystack.indexOf("\n", arrowIdx);
      return { body: haystack.slice(arrowIdx, nl < 0 ? haystack.length : nl), start: base + arrowIdx };
    }
    const span = braceSpan(haystack, open);
    if (!span) return null;
    return { body: haystack.slice(span[0], span[1]), start: base + span[0] };
  }

  const open = haystack.indexOf("{", m.index + m[0].length);
  if (open < 0) return null;
  const span = braceSpan(haystack, open);
  if (!span) return null;
  return { body: haystack.slice(span[0], span[1]), start: base + span[0] };
}

/* ---------------- 三类形态 ---------------- */

/**
 * A. 谓语式：can/cannot/may/isAllowed/hasPermission + 动作。
 *    ⚠ 精度要害：`can` 后必须跟**大写开头**或下划线（canRemove / CanEdit），
 *      这样天然排除 cancel / candidate / cannot-parse 这类同形非授权词。
 */
const PREDICATE_RE =
  /\b(?:cannot|can_not|isUnable|unable_to|isDenied|deny|forbid|forbidden)\s*\(|\b(?:can|able[A-Z]|isAble[A-Z]|may|might[A-Z]|isAllowed|isPermitted|hasPermission|checkPermission|authorize|isAuthorized|authorised|isAuthorised|allowed[A-Z]|permitted[A-Z])[A-Z_]\w*\s*\(/g;

/** A′. 带前缀 helper：validateCanEdit / assertCanDelete / verifyCanManage */
const PREFIXED_RE = /\b\w*(?:Can|May|Allowed|Permitted|Authorized)(?:[A-Z]\w+)?\s*\(/g;

/** B. 客体-self 形态：实参是当前用户，且被调函数名自指（作用于自己） */
const SELF_ARG_RE = /\b(?:user|authUser|currentUser|req\.user|request\.user|me|self|account)\b/;
const SELF_FN_RE = /\b\w*(?:User|Self|Me|Own|Profile|Avatar|Account|Password|Session)\w*\s*\(/g;

/** C. 显式比较式（现有词表已在，这里只用于对照基线） */
const COMPARE_RE = /\b(?:ownerId|authorId|userId|createdBy|created_by|uploadedBy)\s*[!=]==?|\.(?:owner|user|author)\s*[!=]==?/;

interface Hit {
  kind: "A" | "A′" | "B" | "C";
  text: string;
}

function probe(body: string): Hit[] {
  const hits: Hit[] = [];
  const seen = new Set<string>();
  const add = (kind: Hit["kind"], m: RegExpExecArray) => {
    const key = `${kind}:${m[0]}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ kind, text: m[0].replace(/\s+/g, " ") });
  };
  for (const re of [PREDICATE_RE, PREFIXED_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    const kind = re === PREDICATE_RE ? "A" : "A′";
    while ((m = re.exec(body)) !== null) add(kind, m);
  }
  // B：只在实参确实引用当前用户时才算
  SELF_FN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SELF_FN_RE.exec(body)) !== null) {
    // 取该调用的实参（粗：到配对右括号），看里面有没有当前用户
    const open = body.indexOf("(", m.index);
    if (open < 0) continue;
    let depth = 0;
    let end = open;
    for (let i = open; i < body.length; i++) {
      if (body[i] === "(") depth++;
      else if (body[i] === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const args = body.slice(open, end + 1);
    if (SELF_ARG_RE.test(args)) add("B", { 0: m[0] + args.slice(0, 40) } as RegExpExecArray);
  }
  if (COMPARE_RE.test(body)) hits.push({ kind: "C", text: "ownership comparison" });
  return hits;
}

/* ---------------- 词形判据（**calls 列表** 接口版） ----------------
 *
 * ⚠ 引擎判据接口只有 **调用名列表**（protocol-detector 的 safeguards 是在
 *   calls 上跑正则），**没有实参**。所以下面只收**名字层面**可判的形态，
 *   凡需实参的（"user.id 作为第一参数"）一律不收 —— 收了也落不进主干。
 */

/**
 * A. CASL 谓语：cannot( / canRemove( / mayCreate(
 * ⚠ `cannot` 必须**单列**：第一版把它塞进 `[A-Z_]\w*` 后缀组里，
 *   结果 "cannot"（无后缀）整条不匹配 —— 26 条只命中 2 条就是这个 bug。
 *   而裸 `can` 刻意**不收**（cancel / candidate 同形，且太宽）。
 */
export const NAME_A =
  /^(?:cannot|can_not|isUnable|isDenied|isForbidden)$|^(?:can|able|may|isAble|isAllowed|isPermitted|hasPermission|checkPermission|authorize|isAuthorized|authorised|allowed|permitted)[A-Z_]\w*$/;

/**
 * ⚠⚠ 口径同源（2026-09-25 §40 踩到）：本探针曾经自己维护一份 AUTHZ_ACTION 词表，
 * 并且用 `^(…)$` **全等**匹配，而落地到 src 的 `AUTHZ_PREDICATE_RE` 是
 * **前缀**匹配（无结束锚）。两份判据漂移的后果是：探针说"这条没救"，
 * 落地代码其实早就救了 ⇒ 会据此去改一个根本不存在的缺口。
 * **此后本探针一律 import src 的同名常量**，不再自带词表。
 */

/** 谓语形态（can/may/… + 大写开头），但动作词不在 src 词表内 ⇒ 噪声档 */
const PREDICATE_SHAPE =
  /^(?:can|able|may|isAble|isAllowed|isPermitted|hasPermission|checkPermission|authorize|isAuthorized|authorised|allowed|permitted)[A-Z_]\w*$/;

/** `can<X>` 分层：命中 src 谓语 ⇒ A-act；只有形态没动作词 ⇒ A-soft（不收但计数） */
export function tierA(name: string): "A-core" | "A-act" | "A-soft" | null {
  if (AUTHZ_PREDICATE_RE.test(name)) {
    return /^(?:cannot|can_not|isUnable|isDenied|isForbidden)$/i.test(name) ? "A-core" : "A-act";
  }
  if (PREDICATE_SHAPE.test(name)) return "A-soft";
  return null;
}

/** A′. 带前缀 helper：validateCanEdit / assertCanDelete —— 与 src 同源 */
export const NAME_A2 = AUTHZ_CAN_HELPER_RE;

/**
 * A″. 访问/所有权校验：validateSpaceAccess / assertOwnership —— 与 src 同源
 * ⚠ 必须**限定前缀是校验动词**。第一版只要求名字含 Access ⇒
 *   `deleteByUsersWithoutSpaceAccess`（数据删除）、`getUserIdsWithSpaceAccess`（查询）
 *   全被误判成授权校验。含 Access 的**数据操作**比含 Access 的**校验**多得多。
 */
export const NAME_A3 = AUTHZ_ACCESS_CHECK_RE;

/** 数据操作动词（用于判定"这是个会改数据的调用"，限定 B 类的作用域） */
const DATA_VERB =
  /^(?:remove|delete|update|upsert|create|insert|save|add|set|patch|put|destroy|drop|write|edit|modify|toggle|assign|transfer|share|upload)\w*$/i;

export function nameHits(calls: string[]): { kind: string; name: string }[] {
  const out: { kind: string; name: string }[] = [];
  for (const c of calls) {
    const ta = tierA(c);
    if (ta) out.push({ kind: ta, name: c });
    else if (NAME_A2.test(c)) out.push({ kind: "A′", name: c });
    else if (NAME_A3.test(c)) out.push({ kind: "A″", name: c });
  }
  return out;
}

/** 判据层：只收高精度档（A-soft 是噪声档，**不收但必须单列计数** —— R19） */
export const ACCEPTED = new Set(["A-core", "A-act", "A′", "A″"]);
export const accepted = (hits: { kind: string; name: string }[]) => hits.filter((h) => ACCEPTED.has(h.kind));

/**
 * 基线比率对照（R19 同族：分母必须含"被判据拒掉的那些"）。
 * 在全量 callable 上：先按 trigger 正则取分母，再看词形命中率。
 * 若全量命中率 ≈ UNKNOWN 批的命中率 ⇒ 形态无鉴别力（放水）。
 */
function rate(repo: string, src: string, rows: GoldRow[]) {
  // 动态 import，避免 --rate 之外也要付 ts-morph 的加载代价
  const { buildGraph } = require("./call-graph-lib") as typeof import("./call-graph-lib");
  const g = buildGraph(src);

  // 与 protocol-detector.ts:388 同源的 trigger + 现有 satisfier
  const TRIGGER =
    /\b(delete|remove|toggle|modify|edit|lock|ban|refund|assign|transfer|share|schedule|upload|update)(?:[A-Z]\w*|_\w+)|(?:[A-Z]\w*|_\w+)(Delete|Remove|Toggle|Modify|Edit|Lock|Ban|Refund|Assign|Transfer|Share|Schedule|Upload|Update)\b/i;
  const EXISTING =
    /\b(?:checkOwner|isOwner|ownerId\s*[!=]==?|authorId\s*[!=]==?|userId\s*[!=]==?|createdBy\s*[!=]==?|\.owner\s*[!=]==?|\.user\s*[!=]==?|hasPermission|checkPermission|checkAccess|isAuthorized|checkRole|requireRole|adminCheck|isAdmin|canModify|canDelete|canEdit|__progmune_ownership_checked__)\b/i;

  const bare = (n: string) => n.slice(n.lastIndexOf(".") + 1);
  const universe = g.facts.filter((f) => TRIGGER.test(bare(f.name)));
  const callsOf = (f: (typeof g.facts)[number]) => f.qcalls.map((q) => q.method);

  let hitNew = 0;
  let hitSoft = 0;
  let hitExisting = 0;
  const samples: any[] = [];
  const softSamples: any[] = [];
  for (const f of universe) {
    const calls = callsOf(f);
    const ex = EXISTING.test(calls.join(" "));
    const nh = nameHits(calls);
    if (ex) hitExisting++;
    if (nh.some((h) => h.kind === "A-soft")) {
      hitSoft++;
      if (softSamples.length < 200)
        softSamples.push({ fn: f.name, hits: nh.filter((h) => h.kind === "A-soft").map((h) => h.name) });
    }
    if (accepted(nh).length) {
      hitNew++;
      if (!ex && samples.length < 400)
        samples.push({ fn: f.name, file: f.file, hits: nh.map((h) => `${h.kind}:${h.name}`) });
    }
  }

  // UNKNOWN 批 —— **必须用同一张图的 calls**（R25 同族：口径不一致则不可比）。
  // 引擎 calls 字段与 ts-morph qcalls 抽取口径不同，混着比会得出假结论。
  const byName = new Map<string, (typeof g.facts)[number]>();
  for (const f of g.facts) {
    if (!byName.has(f.name)) byName.set(f.name, f);
    if (!byName.has(bare(f.name))) byName.set(bare(f.name), f);
  }
  const unk = rows.filter((r) => r.repo === repo && /Authorization/i.test(r.rule || ""));
  let unkHit = 0;
  let unkLocated = 0;
  const unkRows: any[] = [];
  for (const t of unk) {
    const f = byName.get(t.fn) ?? byName.get(bare(t.fn));
    if (!f) continue;
    unkLocated++;
    const nh = nameHits(callsOf(f));
    if (accepted(nh).length) unkHit++;
    unkRows.push({ fn: t.fn, rule: t.rule, hits: nh.map((h) => `${h.kind}:${h.name}`) });
  }

  const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : "-");
  console.log(`\n=== ${repo} 基线比率对照 ===`);
  console.log(`  trigger 命中全集（分母）        ${universe.length}`);
  console.log(`  现有 satisfier 已抑制          ${hitExisting}  (${pct(hitExisting, universe.length)}%)`);
  console.log(`  新词形命中（判据层）           ${hitNew}  (${pct(hitNew, universe.length)}%)`);
  console.log(`  A-soft 噪声档（**不收**）      ${hitSoft}  (${pct(hitSoft, universe.length)}%)`);
  console.log(`  其中**现有判据漏、新词形补上**  ${samples.length}`);
  console.log(`  UNKNOWN 批命中                 ${unkHit}/${unkLocated}  (${pct(unkHit, unkLocated)}%)  [图上定位到 ${unkLocated}/${unk.length}]`);
  console.log(
    `  ⇒ 鉴别力 = UNKNOWN批命中率 / 全量命中率 = ` +
      `${pct(unkHit, unk.length)}% / ${pct(hitNew, universe.length)}%`
  );

  const show = Number(flag("show", "10"));
  console.log(`\n  -- 新增抑制样本（现有判据漏的）前 ${Math.min(show, samples.length)} 条 --`);
  for (const s of samples.slice(0, show)) {
    console.log(`    ${s.fn.padEnd(45)} ${s.hits.join(" ")}`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, `authz-rate-${repo}.json`),
    JSON.stringify({ repo, universe: universe.length, hitExisting, hitNew, hitSoft, newlySuppressed: samples, softSamples, unkHit, unkLocated, unk: unk.length, unkRows }, null, 2)
  );
}

/* ---------------- 反向验证：在**实际扫描结果**上模拟改判据 ----------------
 *
 * R18：改判据前必须能回答「改了会转绿哪些、退回去是否只落在自己这组」。
 * 这里不跑引擎，直接在 fp-pool-results.json 的 perFunction.safeguardViolations 上，
 * 用同一套 nameHits 判据重放：命中 ⇒ 该条违规会被抑制（转绿）。
 */
function simulate() {
  const file = path.join(OUT_DIR, "fp-pool-results.json");
  if (!fs.existsSync(file)) { console.error(`缺少 ${file}`); process.exit(1); }
  const pools: any[] = JSON.parse(fs.readFileSync(file, "utf8"));

  const AUTHZ_RULE = /Authorization|Ownership/i;
  let total = 0;
  let turned = 0;
  const rows: any[] = [];
  const byRule: Record<string, { total: number; turned: number }> = {};

  for (const p of pools) {
    for (const f of p.perFunction ?? []) {
      for (const v of f.safeguardViolations ?? []) {
        if (!AUTHZ_RULE.test(v.rule ?? "")) continue;
        total++;
        const b = byRule[v.rule] ?? (byRule[v.rule] = { total: 0, turned: 0 });
        b.total++;
        const hits = accepted(nameHits(f.calls ?? []));
        if (hits.length) {
          turned++;
          b.turned++;
          rows.push({
            repo: p.repo, fn: f.name, file: f.file, rule: v.rule,
            hits: hits.map((h) => `${h.kind}:${h.name}`),
          });
        }
      }
    }
  }

  console.log(`\n=== 反向验证：模拟改判据（9 片 FP 池的实际扫描结果）===`);
  console.log(`  Authorization 族违规总计   ${total}`);
  console.log(`  新判据会抑制（转绿）       ${turned}  (${((turned / (total || 1)) * 100).toFixed(1)}%)`);
  console.log(`\n  按规则：`);
  for (const [r, b] of Object.entries(byRule).sort((a, c) => c[1].total - a[1].total)) {
    console.log(`    ${r.padEnd(42)} ${String(b.turned).padStart(3)}/${String(b.total).padStart(3)}`);
  }
  const show = Number(flag("show", "20"));
  console.log(`\n  -- 转绿清单（前 ${Math.min(show, rows.length)} 条）--`);
  for (const r of rows.slice(0, show)) {
    console.log(`    [${r.repo}] ${r.fn.padEnd(40)} ${r.rule.slice(0, 28).padEnd(30)} ${r.hits.join(" ")}`);
  }
  fs.writeFileSync(path.join(OUT_DIR, "authz-simulate.json"), JSON.stringify({ total, turned, byRule, rows }, null, 2));
  console.log(`\n  完整清单 -> reports/authz-simulate.json`);
}

/* ---------------- 主流程 ---------------- */

function run(repo: string, src: string, rows: GoldRow[]) {
  const targets = rows.filter((r) => r.repo === repo && /Authorization/i.test(r.rule || ""));
  if (!targets.length) {
    console.log(`[authz] ${repo}: 无 Authorization 族条目`);
    return null;
  }

  const results: any[] = [];
  let notFound = 0;
  for (const t of targets) {
    const abs = path.join(src, t.file);
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      notFound++;
      results.push({ ...t, err: "file-missing", hits: [] });
      continue;
    }
    const loc = locate(text, t.fn);
    if (!loc) {
      notFound++;
      results.push({ ...t, err: "fn-not-located", hits: [] });
      continue;
    }
    // 装饰器证据：函数体**之前**紧邻的那段（@UseGuards 等）
    const pre = text.slice(Math.max(0, loc.start - 400), loc.start);
    const deco = (pre.match(/@[A-Za-z_$][\w$]*(\([^)]*\))?/g) ?? []).slice(-6);
    results.push({ ...t, deco, hits: probe(loc.body), bodyLen: loc.body.length });
  }

  const covered = results.filter((r) => r.hits?.length);
  const byKind: Record<string, number> = {};
  for (const r of results) for (const h of r.hits ?? []) byKind[h.kind] = (byKind[h.kind] ?? 0) + 1;

  console.log(`\n=== ${repo} ===`);
  console.log(
    `[authz] Authorization 族 ${targets.length} 条 | 抽到函数体 ${targets.length - notFound} ` +
      `| 有授权证据 ${covered.length} | 无证据 ${targets.length - notFound - covered.length} | 抽取失败 ${notFound}`
  );
  console.log(`  形态计数: ${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(" ") || "无"}`);

  const show = Number(flag("show", "6"));
  for (const r of results.slice(0, show)) {
    console.log(`\n  ${r.fn}  [${r.rule}]`);
    if (r.err) {
      console.log(`    ⚠ ${r.err}`);
      continue;
    }
    if (r.deco?.length) console.log(`    装饰器: ${r.deco.join(" ")}`);
    if (!r.hits.length) console.log(`    — 无授权证据 —`);
    for (const h of r.hits) console.log(`    [${h.kind}] ${h.text}`);
  }

  return { repo, targets: targets.length, located: targets.length - notFound, covered: covered.length, byKind, results };
}

function main() {
  const rows: GoldRow[] = fs
    .readFileSync(GOLD, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (process.argv.includes("--simulate")) { simulate(); return; }

  if (process.argv.includes("--rate")) {
    const rr = flag("repo");
    const ss = flag("src");
    if (!rr || !ss) { console.error("--rate 需 --repo 与 --src"); process.exit(1); }
    rate(rr, ss, rows);
    return;
  }

  const all = process.argv.includes("--all");
  let src = flag("src");
  let repo = flag("repo");
  const out: any[] = [];

  if (all || (repo && src)) {
    const list: [string, string][] = all
      ? [
          ["docmost", "/tmp/full-docmost"],
          ["hedgedoc", "/tmp/full-hedgedoc"],
          ["verdaccio", "/tmp/full-verdaccio"],
        ]
      : [[repo!, src!]];
    for (const [r, s] of list) {
      if (!fs.existsSync(s)) {
        console.log(`[authz] 跳过 ${r}：源码不在 ${s}`);
        continue;
      }
      const res = run(r, s, rows);
      if (res) {
        out.push(res);
        fs.writeFileSync(
          path.join(OUT_DIR, `authz-probe-${r}.json`),
          JSON.stringify(res, null, 2)
        );
      }
    }
  } else {
    console.error("用法: --repo <name> --src <dir>  或  --all");
    process.exit(1);
  }

  if (out.length > 1) {
    console.log(`\n[汇总] 报告写入 ${OUT_DIR}/authz-probe-*.json`);
  }
}

if (process.argv[1] && /authz-probe\.ts$/.test(process.argv[1])) main();
