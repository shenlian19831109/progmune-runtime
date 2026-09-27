/**
 * §46 ① mint 三词的对称性论证 —— 黑盒探针（只读，不改判别逻辑）
 *
 * 问题：`create_access_token|create_refresh_token|create_jwt_token` 这三个「签发令牌」
 * 函数只出现在 `Authorization (Unauthenticated Mutation)` 的 auth_check 词表里，
 * `Authorization (Unauthenticated Access)` 没有。§45 做集合 diff 时发现，当时以
 * 「签发 ≠ 校验调用者」为由**没有**补到 Access。
 *
 * 本探针回答三件事：
 *   A. 现状：这三个词是否真的能让规则豁免？（用落地正则，不手抄）
 *   B. 语义反例：补到 Access 会不会压掉本该报的读类函数？
 *   C. 影响面：全部语料（118 TS 项目 / 38 python / fr-corpus / fp-pool）是否命中过？
 *
 * 用法：npx tsx blind-benchmark/mint-symmetry-probe.ts
 */
import { detectSafeguardViolations } from "../src/protocol-detector";

// 签名：(calls, ownName, language, params?, exposed?, paramTypes?)
// ⚠ 第 5 参是 exposed（布尔），第 6 参才是 paramTypes —— 别传错位
const az = (calls: string[], own: string) =>
  detectSafeguardViolations(calls, own, "typescript", ["user"], false, ["AuthUser"])
    .filter((v) => v.rule.startsWith("Authorization"))
    .map((v) => v.rule.replace("Authorization ", ""));

console.log("=== A. 现状：mint 词是否让规则豁免 ===");
// ⚠ 名字必须避开 §39 AUTH_PATTERN：ownName 含 User/Token/Auth 会被「鉴权机制自身」抢先压掉
//   （createUser / getUserToken 都压根不进 Authorization 判定，测不出 mint 的承重）
const cases: Array<[string, string[], string]> = [
  ["写类 + 调 create_access_token（登录/签发入口）", ["create_access_token", "save"], "createThing"],
  ["写类 + 调 create_jwt_token", ["create_jwt_token", "save"], "createThing"],
  ["写类 + 无认证调用（对照：应报）", ["save", "insert"], "createThing"],
  ["读类 + 调 create_access_token", ["create_access_token", "query"], "getThing"],
  ["读类 + 调 create_jwt_token", ["create_jwt_token", "query"], "getThing"],
  ["读类 + 无认证调用（对照：应报）", ["query", "find"], "getThing"],
];
for (const [label, calls, own] of cases) {
  const r = az(calls, own);
  console.log(`  ${r.length ? "报" : "免"}  ${label}\n        calls=${JSON.stringify(calls)} own=${own} => ${r.length ? r.join(", ") : "(none)"}`);
}

console.log("\n=== B. 语义反例（若把 mint 补进 Access 会被压掉的） ===");
console.log("  getUserToken(userId) 内调 create_access_token：");
console.log("    - 这是「为某个 user 签发令牌」的读/写混合入口");
console.log("    - 调用 create_access_token 恰恰说明它**没有**校验调用者身份");
console.log("    - 若 mint 算 auth_check ⇒ 该函数被豁免 ⇒ 假阴性");
console.log("  ⇒ 同形状相反真值成立：login()（该免）vs getUserToken()（不该免）");
console.log("  ⇒ 按 R66，mint 词不具备判别力，不得补进 Access。");

console.log("\n=== C. 影响面（语料是否命中） ===");
console.log("  见 §46.2：generated/ 118 项目、fr-corpus、fp-pool 9 切片、");
console.log("  python 语料 38 项目 —— grep `create_access_token|create_refresh_token|create_jwt_token` 全部零命中。");
console.log("  ⇒ 删掉这三个词：零差分、零风险；但能永久消除 R69 词表 diff 的诱饵。");
