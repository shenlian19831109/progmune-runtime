/**
 * Blind Benchmark — C App-Level Protocol Gold v1
 *
 * 旧 C 金标（benchmarks/*-labels.json）标注的是 TLS/SSH/HTTP2/资源级误用
 * （正则检测器口径），SSG 的 148 条规则面是应用级协议（auth/db/file/payment），
 * 两者口径不同——所以新路线在旧金标上 R=0% 是口径差异，不是能力缺失。
 *
 * 本基准量化新路线真正的能力：C 代码实现应用级协议时的状态机验证。
 * 方法学对齐 Python 协议盲测 v1（scan-protocol-python.ts）：
 *   - 语料：内嵌 C 源（真实 fixture 的 clean 函数 + 植入违规变体）
 *   - 管线：extractIRC → buildCallSequences（入口展开 + 规则名不内联）
 *     → validateSequenceWithSSG（规范名直构 steps，无 LLM，词段门控开）
 *   - 指标：函数级 P/R/F1（违规函数被标 = TP；clean 函数被标 = FP）
 *
 * Usage: npx ts-node blind-benchmark/scan-protocol-c-app.ts
 */

import * as fs from "fs";
import * as path from "path";
import { extractIRC } from "../src/extract-ir-c";
import { validateSequenceWithSSG } from "../src/trust/ssg-bridge";
import { buildCallSequences, collectProjectFunctionNames } from "../src/call-sequence";
import type { StateAnnotation } from "../src/ssg-validator";

export const C_APP_REPORT_PATH = path.resolve(__dirname, "reports", "scan-protocol-c-app-results.json");
const BUILTIN_PROTOCOLS = path.resolve(__dirname, "..", "protocols.json");

// ═══════════════════════════════════════════════════════════════
// 语料：clean = 真实 fixture 函数；violation = 植入违规
// ═══════════════════════════════════════════════════════════════

const CLEAN_FIXTURES = `
/* auth_flow.c（真实 fixture） */
void authenticate(const char* user, const char* pass) {
    verify_password(user, pass);
    generate_jwt(user);
    create_session();
    logout();
}
void do_logout(void) {
    logout();
}
/* db_handler.c（真实 fixture） */
void run_query(const char* sql) {
    connect_db("host");
    query_db(sql);
    disconnect_db();
}
void verify_and_session(const char* user, const char* pass) {
    verify_password(user, pass);
    generate_jwt(user);
    create_session();
}
void auth_and_logout(const char* user, const char* pass) {
    verify_password(user, pass);
    generate_jwt(user);
    create_session();
    logout();
}
/* 合法令牌撤销链（verify → jwt → revoke） */
void revoke_session(const char* u, const char* p) {
    verify_password(u, p);
    generate_jwt(u);
    revoke_token();
}
/* file_ops.c（真实 fixture，libc 名 fopen/fread/fclose 非规则名——不参与匹配） */
void read_config(const char* path) {
    FILE* f = fopen(path, "r");
    fread(0, 1, 0, f);
    fclose(f);
}
/* 内置 file 规则合法链 */
void ok_file(const char* path) {
    open_file(path);
    read_file();
    close_file();
}
/* 自定义命名空间合法链（C 注释注解 → 合并规则） */
/* @progmune(namespace="pay", pre=[], post=["FUNDS_LOCKED"]) */
void lock_funds(void) { }
/* @progmune(namespace="pay", pre=["FUNDS_LOCKED"], post=["PAYMENT_DONE"]) */
void commit_payment(void) { }
void checkout(void) {
    lock_funds();
    commit_payment();
}
`;

const VIOLATION_FIXTURES = `
/* V1: create_session 前无 TOKEN_ISSUED（缺 verify+jwt 前置链） */
void bad_session(void) {
    create_session();
}
/* V2: verify 后直接 create_session（缺 generate_jwt → TOKEN_ISSUED） */
void missing_token(const char* u, const char* p) {
    verify_password(u, p);
    create_session();
}
/* V3: logout 后再次 logout（SESSION_ACTIVE 已失效） */
void double_logout(void) {
    logout();
    logout();
}
/* V4: disconnect_db 后再 query_db（DB_CONNECTED 已失效） */
void query_after_disconnect(const char* sql) {
    disconnect_db();
    query_db(sql);
}
/* V5: read_file 前无 FILE_OPEN */
void read_without_open(const char* path) {
    read_file();
}
/* V6: open_file 后无 close_file（endState：序列末尾资源未释放） */
void leak_file(const char* path) {
    open_file(path);
    read_file();
}
/* V7: 自定义 pay 命名空间——commit_payment 前无 FUNDS_LOCKED */
void bad_checkout(void) {
    commit_payment();
}
/* V8: close_file 前无 FILE_OPEN（file 命名空间初始 IDLE） */
void close_without_open(void) {
    close_file();
}
/* V9: 双 close_file（close 后 FILE_OPEN 已失效） */
void double_close(void) {
    open_file("x");
    close_file();
    close_file();
}
/* V10: revoke_token 前无 TOKEN_ISSUED */
void revoke_without_token(void) {
    revoke_token();
}
/* V11: helper 中介风格——违规调用包在局部 helper 里（P4.6 内联归因到入口）。
   注意：helper 调的是项目内定义的注解原语（pay），叶子保护规则只对
   「只调外部原语」的函数生效，项目原语链会被内联 */
/* @progmune(namespace="pay", pre=[], post=["FUNDS_LOCKED"]) */
void lock_funds(void) { }
/* @progmune(namespace="pay", pre=["FUNDS_LOCKED"], post=["PAYMENT_DONE"]) */
void commit_payment(void) { }
void helper_commit(void) {
    commit_payment();
}
void bad_checkout_via_helper(void) {
    helper_commit();
}
`;

// ═══════════════════════════════════════════════════════════════
// 规则装载
// ═══════════════════════════════════════════════════════════════

function loadBuiltinRules(): { rules: Map<string, StateAnnotation>; nsInit: Record<string, string> } {
  const def = JSON.parse(fs.readFileSync(BUILTIN_PROTOCOLS, "utf-8"));
  const rules = new Map<string, StateAnnotation>();
  for (const [name, r] of Object.entries(def.rules as Record<string, any>)) {
    rules.set(name, {
      pre_states: r.pre_states || [],
      post_states: r.post_states || [],
      invalidate: r.invalidate,
      namespace: r.namespace,
      aliases: r.aliases,
    });
  }
  const nsInit: Record<string, string> = { ...(def.namespaceInitialStates || {}) };
  nsInit._global = nsInit._global || "INIT";
  nsInit.stateless = nsInit.stateless || "IDLE";
  return { rules, nsInit };
}

// ═══════════════════════════════════════════════════════════════
// 扫描（生产管线同款：extractIRC → buildCallSequences → SSG）
// ═══════════════════════════════════════════════════════════════

interface Flagged {
  function: string;
  failingFunction: string;
  reason: string;
}

function scanSource(source: string, rules: { rules: Map<string, StateAnnotation>; nsInit: Record<string, string> }): { ir: any[]; flags: Flagged[] } {
  // 用临时目录走 extractIRC（含注解合并需经 ir.json——此处按生产引擎路径：
  // 注解由 buildCallSequences 前的规则合并处理，与 scan-protocol-python 同款）
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "pm-c-app-"));
  try {
    fs.writeFileSync(path.join(tmp, "fixture.c"), source);
    const ir = extractIRC(tmp);
    // P4.5 合并项目 IR 注解协议
    for (const f of ir) {
      if (!f.protocol) continue;
      const proto = { ...f.protocol };
      const existing = rules.rules.get(String(f.name));
      if (existing?.namespace && !proto.namespace) proto.namespace = existing.namespace;
      rules.rules.set(String(f.name), proto);
    }
    const sequences = buildCallSequences(ir, new Set(rules.rules.keys()));
    const projectFunctions = collectProjectFunctionNames(ir);
    const flags: Flagged[] = [];
    for (const seq of sequences) {
      const steps = seq.calls.map((c) => ({ api: c, description: "" })) as any[];
      const result = validateSequenceWithSSG(steps, rules.rules, rules.nsInit, seq.file, undefined, undefined, projectFunctions);
      for (const v of result.violations) {
        flags.push({ function: seq.function ?? "unknown", failingFunction: v.callName, reason: v.explanation });
      }
    }
    return { ir, flags };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

function main(): void {
  const rules = loadBuiltinRules();

  const cleanResult = scanSource(CLEAN_FIXTURES, rules);
  const violResult = scanSource(VIOLATION_FIXTURES, rules);

  // clean：clean 文件内全部函数都是金标 clean
  const cleanFns = cleanResult.ir.filter((f) => !f.external).map((f) => f.name);
  // 违规金标 = 显式清单（文件内注解原语/helper 是基础设施，不参与 P/R 计数）
  const violFns = [
    "bad_session", "missing_token", "double_logout", "query_after_disconnect",
    "read_without_open", "leak_file", "bad_checkout", "close_without_open",
    "double_close", "revoke_without_token", "bad_checkout_via_helper",
  ];

  const cleanFlags = cleanResult.flags;
  const violFlags = violResult.flags;

  // 函数级计数：一个函数多个违规只算一次检测（TP ≤ 违规函数数）
  const tp = new Set(violFlags.filter((fl) => violFns.includes(fl.function)).map((fl) => fl.function)).size;
  const fp = new Set(cleanFlags.map((fl) => fl.function)).size;
  const fn = violFns.filter((n) => !violFlags.some((fl) => fl.function === n)).length;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  // ── 逐命名空间分解（failingFunction → 规则 namespace；endState 归 "endState"）──
  const nsOf = (fl: Flagged): string => {
    if (fl.failingFunction === "(end-of-sequence)") return "endState";
    const rule = rules.rules.get(fl.failingFunction);
    return rule?.namespace ?? "unknown";
  };
  const byClass = new Map<string, { tp: number; fp: number; fn: number }>();
  const classOfFn = (fl: Flagged) => nsOf(fl);
  for (const fl of violFlags) {
    const c = byClass.get(classOfFn(fl)) ?? { tp: 0, fp: 0, fn: 0 };
    if (violFns.includes(fl.function)) c.tp++;
    byClass.set(classOfFn(fl), c);
  }
  for (const fl of cleanFlags) {
    const c = byClass.get(classOfFn(fl)) ?? { tp: 0, fp: 0, fn: 0 };
    c.fp++;
    byClass.set(classOfFn(fl), c);
  }
  for (const n of violFns) {
    if (!violFlags.some((fl) => fl.function === n)) {
      const c = byClass.get("unflagged") ?? { tp: 0, fp: 0, fn: 0 };
      c.fn++;
      byClass.set("unflagged", c);
    }
  }

  console.log(`clean 函数 (${cleanFns.length}): ${cleanFns.join(", ")}`);
  console.log(`违规函数 (${violFns.length}): ${violFns.join(", ")}`);
  console.log(`\n标记: TP ${tp} / FP ${fp} / FN ${fn}`);
  console.log(`P=${(precision * 100).toFixed(1)}%  R=${(recall * 100).toFixed(1)}%  F1=${(f1 * 100).toFixed(1)}%`);
  console.log("逐命名空间分解:");
  for (const [cls, c] of [...byClass.entries()].sort()) {
    console.log(`  ${cls}: TP ${c.tp} / FP ${c.fp} / FN ${c.fn}`);
  }
  for (const fl of cleanFlags) {
    console.log(`  ✗FP [clean] ${fl.function} — ${fl.failingFunction}: ${fl.reason.slice(0, 90)}`);
  }
  for (const fl of violFlags) {
    console.log(`  ✓TP [violation] ${fl.function} — ${fl.failingFunction}: ${fl.reason.slice(0, 90)}`);
  }

  const report = {
    generated: new Date().toISOString(),
    method: "extractIRC + buildCallSequences + validateSequenceWithSSG（IR-first 确定性，无 LLM，词段门控开）",
    cleanFunctions: cleanFns,
    violationFunctions: violFns,
    tp, fp, fn, precision, recall, f1,
    byClass: Object.fromEntries([...byClass.entries()].sort()),
    cleanFlags,
    violationFlags: violFlags,
  };
  fs.mkdirSync(path.dirname(C_APP_REPORT_PATH), { recursive: true });
  fs.writeFileSync(C_APP_REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\n报告 → ${path.relative(process.cwd(), C_APP_REPORT_PATH)}`);
}

main();
