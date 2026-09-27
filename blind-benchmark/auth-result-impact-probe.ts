/**
 * §46 ③ 顶层债务 —— 反事实预测探针（只读，不改判别逻辑）
 *
 * 债务：safeguard 只看「**是否调用**」了 auth 函数，不看「**是否检查其结果**」。
 *       const u = getSession(t); if (!u) return null;   ← 真检查了
 *       getSession(t); return data;                     ← 结果被丢弃（真漏洞，当前也豁免）
 * 收紧（要求「调用且检查结果」）会让后者转为告警 ⇒ **增报**。
 *
 * 本探针不改源码，用**反事实**回答「增报面有多大」：
 *   对盲测里每个函数，比较
 *     V0 = detect(calls, name)                    —— 现状
 *     V1 = detect(calls 去掉 auth 词, name)        —— 假设 auth_check 完全不生效
 *   V1 − V0 中属于 Authorization 族的，就是「当前靠 auth_check 豁免、
 *   收紧后会转为告警」的条目 ⇒ ③ 的增报上界。
 *
 * ⚠ 口径：这里**不传 params**（results 里没有），paramGated 因此不生效，
 *   判定面比真实扫描宽 ⇒ 结果是**上界**，不是精确值。
 *
 * 用法：npx tsx blind-benchmark/auth-result-impact-probe.ts [结果文件]
 */
import { readFileSync } from "fs";
import { detectSafeguardViolations } from "../src/protocol-detector";

// 与 Unauthenticated Access/Mutation 的 auth_check 词表同源（从 src 正则复制的**校验类**词，
// 不含 __progmune_* 标记与装饰器 —— 只看"真的调用了某个校验函数"）
const AUTH_CHECK_WORDS = new Set([
  "getuser", "validatetoken", "verifytoken", "verifysession", "validatesession",
  "getsessionuser", "getsession", "getcurrentuser", "requireauth", "withauth",
  "checkauth", "isauth", "hasauth", "checkaccess", "hasaccess",
  "get_user", "get_session_user", "get_current_user", "validate_session", "verify_token",
  "require_auth", "with_auth", "check_auth", "auth_required", "authenticate_user",
  "authenticate_request", "authenticate_token", "authenticate",
  "tokencheck", "tokenverify", "tokenvalid", "sessioncheck", "sessionverify", "sessionvalid",
  "authcheck", "authguard", "authmiddleware", "login_required", "permission_required",
  "check_authorization", "check_permission",
]);

const isAuthCall = (c: string) => AUTH_CHECK_WORDS.has(c.toLowerCase().replace(/[.]/g, ""));

const resultsPath = process.argv[2] || "blind-benchmark/reports/batch-scan-results.json";
const d = JSON.parse(readFileSync(resultsPath, "utf-8"));

// 可选：`--bare <file>` —— 只统计「调用了 auth 但**没有**守卫其结果」的函数。
// ③ 的收紧（要求「调用且检查结果」）只影响这一类：GUARDED 的拿到标记，仍豁免。
// 清单由 auth-result-probe.py --dump-bare 产出。
const bareIdx = process.argv.indexOf("--bare");
let bareSet: Set<string> | null = null;
if (bareIdx >= 0 && process.argv[bareIdx + 1]) {
  const bare = JSON.parse(readFileSync(process.argv[bareIdx + 1], "utf-8")) as Array<
    { project: string; file: string; name: string }>;
  bareSet = new Set(bare.map((b) => `${b.project}|${b.file}|${b.name}`));
  console.log(`（只统计 BARE 清单：${bareSet.size} 条）\n`);
}

let nFn = 0;
let nReliesOnAuthCheck = 0;
const gained: Array<{ proj: string; fn: string; rules: string[] }> = [];

for (const pr of d.projects) {
  for (const f of pr.perFunction || []) {
    nFn++;
    if (bareSet && !bareSet.has(`${pr.project}|${f.file}|${f.name}`)) continue;
    const calls: string[] = f.calls || [];
    const name: string = f.name;
    const v0 = detectSafeguardViolations(calls, name, "typescript")
      .map((v: any) => v.rule);
    const stripped = calls.filter((c) => !isAuthCall(c));
    if (stripped.length === calls.length) continue;   // 没调 auth 词 ⇒ 与 ③ 无关
    const v1 = detectSafeguardViolations(stripped, name, "typescript")
      .map((v: any) => v.rule);
    const newAz = v1.filter(
      (r: string) => r.startsWith("Authorization") && !v0.includes(r)
    );
    if (newAz.length) {
      nReliesOnAuthCheck++;
      gained.push({ proj: pr.project, fn: name, rules: newAz });
    }
  }
}

console.log(`函数总数 ${nFn}`);
console.log(`体里调用了 auth 校验词、且当前**靠它**豁免的函数：${nReliesOnAuthCheck}`);
console.log("⇒ 这就是 ③ 收紧后的增报上界（这些函数会开始报 Unauthenticated）\n");

const byFn = new Map<string, number>();
for (const g of gained) byFn.set(g.fn.split(".").pop()!, (byFn.get(g.fn.split(".").pop()!) || 0) + 1);
console.log("按函数名 top20:", [...byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20));
console.log("\n样例 15 条:");
for (const g of gained.slice(0, 15)) console.log(`  [${g.proj}] ${g.fn}  →  ${g.rules.join(", ")}`);
