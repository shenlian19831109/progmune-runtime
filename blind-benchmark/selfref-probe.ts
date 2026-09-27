/**
 * §39 探针：D 类「自指排除」词表缺口量化（只读，不改 src）
 *
 * 背景：引擎已有 `if (isAuthFunction && rule.category === "authorization") continue`
 * （protocol-detector.ts:1329 / :1496），但 AUTH_PATTERN 只列了
 * 「用户鉴权入口」（login/register/logout/…），**没列鉴权机制自身的实现**
 * ⇒ 对 JwtAuthGuard.handleRequest / AuthService.getCollabToken / TokenService.verifyJwt
 * / WorkspaceAbilityFactory.createForUser 这类函数报「未鉴权」，属自指谬误。
 *
 * 本脚本回答三个问题（R50：换/扩词表必须做全量对照 + 反向验证，不能拍脑袋）：
 *   ① 候选词集在**正例集**（已人工确认的鉴权机制函数）上的召回
 *   ② 候选词集在**全量真实语料**（9 片 FP 池 perFunction 全名）上的命中率 —— 越低越好
 *   ③ 反向验证：模拟改判据后，实际扫描结果里哪些违规会转绿 —— 必须逐条人工审
 *
 * 用法：
 *   npx tsx blind-benchmark/selfref-probe.ts --sweep          # 候选词集扫描
 *   npx tsx blind-benchmark/selfref-probe.ts --simulate --show 40   # 反向验证
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "blind-benchmark", "reports");

const flag = (name: string, def: string | null = null): string | null => {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
};

/* ---------------- 复刻引擎的 identifierParse（口径必须一致） ---------------- */

function identifierParse(name: string): string[] {
  const parts = name.split(/[_\-\.]/);
  const words: string[] = [];
  for (const part of parts) {
    const camelWords = part.replace(/([a-z])([A-Z])/g, "$1 $2").split(" ");
    for (const w of camelWords) if (w.length > 0) words.push(w);
  }
  return words;
}

/** 类/容器部分：Class.method → Class；无点则空 */
export function containerOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : "";
}

/* ---------------- 现有词表（基线 V0） ---------------- */

const AUTH_PATTERN =
  /\b(register|signup|signin|login|authenticate|createuser|createaccount|registeruser|registernewuser|dologin|verifytoken|validatesession|getuser|getsessionuser|getcurrentuser|endsession|logout|signout|dologout|destroysession|invalidatesession|invalidate|signout|create_account|register_new_user|register_user|sign_up|create_user|do_login|sign_in|log_in|verify_token|validate_session|get_user|get_session_user|get_current_user|do_logout|sign_out|log_out|end_session|invalidate_session|clear_session)\b/i;

export function isAuthV0(name: string): boolean {
  const rawLower = name.toLowerCase();
  return AUTH_PATTERN.test(rawLower) || identifierParse(name).some((w) => AUTH_PATTERN.test(w));
}

/* ---------------- 候选词集（分层，逐级放宽） ---------------- */

/** 容器/类名里出现即视为鉴权机制（**只在点号前的类部分上匹配**） */
const CONTAINER_SETS: { id: string; words: string[] }[] = [
  { id: "c0", words: [] },
  { id: "c1", words: ["auth", "jwt", "guard"] },
  { id: "c2", words: ["auth", "jwt", "guard", "token", "session", "cookie", "credential", "passport", "identity"] },
  { id: "c3", words: ["auth", "jwt", "guard", "token", "session", "cookie", "credential", "passport", "identity", "ability", "permission"] },
];

/** 容器类后缀：Guard / Strategy / AbilityFactory —— 与词集并用 */
const CONTAINER_SUFFIX = /(?:Guard|Strategy|AbilityFactory|AuthGuard|PassportStrategy)$/;

/** 标识符单词（任一部分）命中即视为鉴权机制 */
const WORD_SETS: { id: string; words: string[] }[] = [
  { id: "w0", words: [] },
  { id: "w1", words: ["jwt"] },
  { id: "w2", words: ["jwt", "token"] },
  { id: "w3", words: ["jwt", "token", "cookie", "session"] },
  { id: "w4", words: ["jwt", "token", "cookie", "session", "credential", "passport", "oauth", "sso", "bearer"] },
];

/* ---------------- 结构化候选（V-A..V-D）：先窄后宽 ----------------
 *
 * ⚠ 上面那套「容器含 token/session 即算」的宽词集**不能用**，实测它会吃掉
 *   `ApiTokensController.deleteToken` / `AccessTokenController.deletePAT` /
 *   `AccessTokenService.updateLastUsedForPAT` —— 这些是对**凭据做增删改**的端点，
 *   恰恰是**最需要**鉴权的地方，压掉就是真漏报（且不可见，R49 的镜像）。
 *
 * ⇒ 改成两层，且只在「机制」语义上收：
 *   ① 容器是机制类（Guard / Strategy / AbilityFactory）
 *   ② 方法 = 机制动词 × 机制对象，且**只看点号后的方法部分**
 *      （容器词不参与动词匹配，否则 ApiTokensController 会漏进来）
 */

/**
 * 机制类容器 = **机制后缀** × **凭据/授权名词**，两个条件都要满足。
 *
 * ⚠ 只看后缀不够：`Strategy` 是通用设计模式后缀，`CacheStrategy` / `PaymentStrategy`
 *   / `RetryStrategy` 会被误吃（它们跟鉴权无关，压掉就是真漏报）。
 *   `Guard` 同理（NestJS 的 `ThrottlerGuard` 是限流不是鉴权）。
 * ⇒ 加凭据名词约束后：JwtAuthGuard(jwt) ✓、JwtStrategy(jwt) ✓、
 *   WorkspaceAbilityFactory(ability) ✓；ThrottlerGuard ✗、CacheStrategy ✗。
 */
const MECH_CLASS_SUFFIX = /(?:Guard|Strategy|AbilityFactory)$/;
const AUTH_NOUN = [
  "auth", "jwt", "token", "session", "cookie", "credential", "passport",
  "identity", "oauth", "oidc", "ldap", "saml", "bearer", "apikey", "ability", "permission",
];

/** 机制动词：只对凭据做「校验/签发/编解码/刷新」这些原语 */
const MECH_VERB_STRICT = ["verify", "validate", "sign", "generate", "issue", "decode", "parse", "encode", "refresh", "rotate"];
/** 放宽一档：把「取/置/建」也算进去（getCollabToken / setAuthCookie / createToken） */
const MECH_VERB_LOOSE = [...MECH_VERB_STRICT, "get", "set", "create", "build", "make", "issue", "write", "read"];

/**
 * 机制对象：凭据类名词。
 * ⚠ 刻意**不含** password（changePassword/passwordReset 不是机制，是受保护的操作）
 * ⚠ 也刻意**不含** pat —— PAT 是 hoppscotch 的产品专有缩写，收它会把
 *   `AccessTokenService.createPAT`（创建访问令牌，**需要**鉴权）一起吃掉，
 *   这是过拟合到单个仓库的缩写，不是通用凭据名词。
 */
const MECH_OBJECT = ["jwt", "token", "cookie", "session", "credential", "credentials", "signature", "bearer"];

type Variant = "V-A" | "V-B" | "V-C" | "V-D";

export function isAuthStruct(name: string, v: Variant): boolean {
  const container = containerOf(name);
  // ① 机制类容器 = 机制后缀 × 凭据名词（两个都要，见上面注释）
  if (container && MECH_CLASS_SUFFIX.test(container)) {
    const cl = container.toLowerCase();
    if (AUTH_NOUN.some((w) => AUTH_NOUN.includes(w) && cl.includes(w))) return true;
  }
  // ② 方法 = 机制动词 × 机制对象（只看方法部分）
  if (v !== "V-A") {
    const mPart = name.slice(name.lastIndexOf(".") + 1);
    const mw = identifierParse(mPart).map((w) => w.toLowerCase());
    const verbs = v === "V-B" ? MECH_VERB_STRICT : MECH_VERB_LOOSE;
    if (mw.some((w) => verbs.includes(w)) && mw.some((w) => MECH_OBJECT.includes(w))) return true;
  }
  // ③ V-D：容器含机制名词（**宽，会吃掉凭据 CRUD 端点**，仅作对照，不采纳）
  if (v === "V-D" && container) {
    const cl = container.toLowerCase();
    if (["auth", "token", "session", "cookie", "credential", "passport", "identity", "ability", "permission"].some((w) => cl.includes(w)))
      return true;
  }
  return false;
}

function matches(name: string, cw: string[], ww: string[]): boolean {
  const words = identifierParse(name).map((w) => w.toLowerCase());
  if (ww.length && words.some((w) => ww.includes(w))) return true;
  const c = containerOf(name).toLowerCase();
  if (c) {
    if (cw.some((w) => c.includes(w))) return true;
    const raw = containerOf(name);
    if (CONTAINER_SUFFIX.test(raw)) return true;
  }
  return false;
}

/** 候选判据 = V0 ∪ (容器 ∪ 单词) */
function isAuthCand(name: string, cw: string[], ww: string[]): boolean {
  return isAuthV0(name) || matches(name, cw, ww);
}

/* ---------------- 正例集：人工确认的「鉴权机制自身」 ----------------
 * 来源：docmost UNKNOWN 里 11 条无授权证据的条目，去重后 7 个目标，
 * 其中 6 个是鉴权机制自身（第 7 个 FavoriteController.removeFavorite 是
 * 「user 作为实参」的 B 类形态，**不该**被自指排除救 —— 它是负例）。
 */

const POSITIVES = [
  { fn: "JwtAuthGuard.handleRequest", file: "src/common/guards/jwt-auth.guard.ts" },
  { fn: "JwtAuthGuard.setJoinedWorkspacesCookie", file: "src/common/guards/jwt-auth.guard.ts" },
  { fn: "AuthController.setAuthCookie", file: "src/core/auth/auth.controller.ts" },
  { fn: "AuthService.getCollabToken", file: "src/core/auth/services/auth.service.ts" },
  { fn: "TokenService.verifyJwt", file: "src/core/auth/services/token.service.ts" },
  { fn: "WorkspaceAbilityFactory.createForUser", file: "src/core/casl/abilities/workspace-ability.factory.ts" },
];

/** 负例：看着像但不是鉴权机制，绝不能被自指排除吃掉 */
const NEGATIVES = [
  { fn: "FavoriteController.removeFavorite", file: "src/core/favorite/favorite.controller.ts" },
  { fn: "AttachmentController.removeIcon", file: "src/core/attachment/attachment.controller.ts" },
  { fn: "SpaceController.deleteSpace", file: "src/core/space/space.controller.ts" },
  { fn: "PageController.updatePage", file: "src/core/page/page.controller.ts" },
  { fn: "WorkspaceController.createWorkspace", file: "src/core/workspace/workspace.controller.ts" },
];

/* ---------------- 全量真实语料 ---------------- */

function loadUniverse(): { repo: string; name: string; violations: string[] }[] {
  const file = path.join(OUT_DIR, "fp-pool-results.json");
  if (!fs.existsSync(file)) {
    console.error(`缺少 ${file}`);
    process.exit(1);
  }
  const pools: any[] = JSON.parse(fs.readFileSync(file, "utf8"));
  const out: { repo: string; name: string; violations: string[] }[] = [];
  for (const p of pools) {
    for (const f of p.perFunction ?? []) {
      const nm = f.name;
      if (!nm) continue;
      out.push({
        repo: p.repo ?? "?",
        name: nm,
        violations: (f.safeguardViolations ?? []).map((v: any) => v.rule ?? ""),
      });
    }
  }
  return out;
}

/* ---------------- ①+② 词集扫描 ---------------- */

function sweep() {
  const uni = loadUniverse();
  console.log(`\n=== ① 候选词集扫描（正例 ${POSITIVES.length} / 负例 ${NEGATIVES.length} / 全量 ${uni.length}）===`);
  console.log(`  V0（现有词表）正例命中 ${POSITIVES.filter((p) => isAuthV0(p.fn)).length}/${POSITIVES.length}`);
  console.log(
    `\n  ${"词集".padEnd(10)}${"正例".padStart(6)}${"负例误吃".padStart(9)}${"全量命中".padStart(10)}${"全量率".padStart(8)}`
  );
  const rows: any[] = [];
  for (const c of CONTAINER_SETS) {
    for (const w of WORD_SETS) {
      const posHit = POSITIVES.filter((p) => isAuthCand(p.fn, c.words, w.words)).length;
      const negHit = NEGATIVES.filter((p) => isAuthCand(p.fn, c.words, w.words)).length;
      const uniHit = uni.filter((u) => isAuthCand(u.name, c.words, w.words)).length;
      const rate = ((uniHit / uni.length) * 100).toFixed(1);
      console.log(
        `  ${(c.id + "+" + w.id).padEnd(10)}${String(posHit + "/" + POSITIVES.length).padStart(6)}` +
          `${String(negHit).padStart(9)}${String(uniHit).padStart(10)}${(rate + "%").padStart(8)}`
      );
      rows.push({ set: c.id + "+" + w.id, pos: posHit, neg: negHit, uni: uniHit, rate: +rate });
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, "selfref-sweep.json"), JSON.stringify({ universe: uni.length, rows }, null, 2));

  /* ---- 结构化变体对照 ---- */
  console.log(`\n=== ①′ 结构化变体（V-A 最窄 → V-D 最宽）===`);
  console.log(`  ${"变体".padEnd(8)}${"正例".padStart(6)}${"负例误吃".padStart(9)}${"全量命中".padStart(10)}${"全量率".padStart(8)}`);
  const vrows: any[] = [];
  for (const v of ["V-A", "V-B", "V-C", "V-D"] as Variant[]) {
    const isAuth = (n: string) => isAuthV0(n) || isAuthStruct(n, v);
    const posHit = POSITIVES.filter((p) => isAuth(p.fn)).length;
    const negHit = NEGATIVES.filter((p) => isAuth(p.fn)).length;
    const uniHit = uni.filter((u) => isAuth(u.name)).length;
    const rate = ((uniHit / uni.length) * 100).toFixed(1);
    console.log(
      `  ${v.padEnd(8)}${String(posHit + "/" + POSITIVES.length).padStart(6)}` +
        `${String(negHit).padStart(9)}${String(uniHit).padStart(10)}${(rate + "%").padStart(8)}`
    );
    vrows.push({ variant: v, pos: posHit, neg: negHit, uni: uniHit, rate: +rate });
  }
  fs.writeFileSync(
    path.join(OUT_DIR, "selfref-sweep.json"),
    JSON.stringify({ universe: uni.length, grid: rows, variants: vrows }, null, 2)
  );
  console.log(`\n  -> reports/selfref-sweep.json`);

  // 全量命中样本（用最宽的词集），供人工审「有没有误吃真业务函数」
  const widest = CONTAINER_SETS[CONTAINER_SETS.length - 1].words;
  const widestW = WORD_SETS[WORD_SETS.length - 1].words;
  const show = Number(flag("show", "25"));
  const hits = uni.filter((u) => isAuthCand(u.name, widest, widestW) && !isAuthV0(u.name));
  console.log(`\n  -- 最宽词集新增命中样本（现有词表之外的）共 ${hits.length} 条，前 ${show} --`);
  for (const h of hits.slice(0, show)) {
    console.log(`    [${h.repo}] ${h.name}`);
  }
}

/* ---------------- ③ 反向验证：模拟改判据，看哪些违规转绿 ---------------- */

function simulate() {
  const v = (flag("v", "V-C") as Variant) ?? "V-C";
  const uni = loadUniverse();
  const isAuth = (n: string) => isAuthV0(n) || isAuthStruct(n, v);

  // 模拟：authorization 类目规则在 isAuthFunction 时会被 continue
  const AUTHZ_RULE = /^Authorization/i;
  let total = 0;
  let turned = 0;
  const rows: any[] = [];
  for (const u of uni) {
    const newAuth = isAuth(u.name);
    const oldAuth = isAuthV0(u.name);
    for (const r of u.violations) {
      if (!AUTHZ_RULE.test(r)) continue;
      total++;
      if (!oldAuth && newAuth) {
        turned++;
        rows.push({ repo: u.repo, fn: u.name, rule: r });
      }
    }
  }
  console.log(`\n=== ③ 反向验证（变体 ${v}）===`);
  console.log(`  Authorization 族违规总计        ${total}`);
  console.log(`  现有词表未抑制、新词表会抑制    ${turned}  (${((turned / (total || 1)) * 100).toFixed(1)}%)`);
  const show = Number(flag("show", "40"));
  console.log(`\n  -- 转绿清单（前 ${Math.min(show, rows.length)} 条，须逐条人工审）--`);
  for (const r of rows.slice(0, show)) {
    console.log(`    [${r.repo}] ${r.fn.padEnd(48)} ${r.rule}`);
  }
  fs.writeFileSync(
    path.join(OUT_DIR, `selfref-simulate-${v}.json`),
    JSON.stringify({ variant: v, total, turned, rows }, null, 2)
  );
  console.log(`\n  -> reports/selfref-simulate-${v}.json`);
}

function hits() {
  const v = (flag("v", "V-C") as Variant) ?? "V-C";
  const uni = loadUniverse();
  const isAuth = (n: string) => isAuthV0(n) || isAuthStruct(n, v);
  const hit = uni.filter((u) => isAuth(u.name));
  const show = Number(flag("show", "60"));
  console.log(`\n=== 全量命中清单（变体 ${v}）共 ${hit.length}/${uni.length} ===`);
  const seen = new Set<string>();
  for (const h of hit) {
    if (seen.has(h.name)) continue;
    seen.add(h.name);
    console.log(`    [${h.repo}] ${h.name}${isAuthV0(h.name) ? "   (现有词表已覆盖)" : ""}`);
  }
  void show;
}

function main() {
  if (process.argv.includes("--hits")) {
    hits();
    return;
  }
  if (process.argv.includes("--sweep")) {
    sweep();
    return;
  }
  if (process.argv.includes("--simulate")) {
    simulate();
    return;
  }
  console.log("用法：--sweep | --hits [--v V-C] | --simulate [--v V-C] [--show N]");
}

main();
