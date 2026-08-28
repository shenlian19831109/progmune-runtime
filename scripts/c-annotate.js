#!/usr/bin/env node
/**
 * C 注解脚手架（MVP）——注解驱动定位的采纳生死线工具。
 *
 * 生成 @progmune 注释块模板（贴在函数定义上方）+ 可选库边界别名条目建议
 * （.progmune_aliases.json 格式）。把「3 注解/协议」的成本降到「3 次填空」。
 *
 * 用法：
 *   node scripts/c-annotate.js --namespace auth --function start_channel_session \
 *       --pre PASSWORD_VERIFIED --post SESSION_ACTIVE [--invalidate X] \
 *       [--alias-call ssh_userauth_password --alias-rule verify_password]
 */

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

const namespace = arg("--namespace");
const fn = arg("--function");
const pre = arg("--pre") || "";
const post = arg("--post") || "";
const invalidate = arg("--invalidate") || null;
const aliasCall = arg("--alias-call");
const aliasRule = arg("--alias-rule");

if (!namespace || !fn) {
  console.error("用法: node scripts/c-annotate.js --namespace <ns> --function <fn> [--pre S1,S2] [--post S1,S2] [--invalidate S] [--alias-call <库API> --alias-rule <规则名>]");
  process.exit(1);
}

const fmtList = (s) => (s ? `[${s.split(",").map((x) => `"${x.trim()}"`).join(", ")}]` : "[]");

console.log("/* ── 注解块模板：贴到函数定义上方 ──────────────────────────── */");
console.log(`/* @progmune(namespace="${namespace}", pre=${fmtList(pre)}, post=${fmtList(post)}${invalidate ? `, invalidate=${fmtList(invalidate)}` : ""}) */`);
console.log("");
if (aliasCall && aliasRule) {
  console.log("/* ── 库边界别名条目：加入项目 .progmune_aliases.json（跨项目迁移） ── */");
  console.log(`/* ${JSON.stringify({ call: aliasCall, rule: aliasRule })} */`);
  console.log("");
  console.log("/* 回写提案：node scripts/c-alias-propose.js <projectDir> —— 校验后提案入共享 C 别名表 */");
} else {
  console.log("/* 提示：库 API 调用（外部函数）用别名而非注解——--alias-call/--alias-rule 生成条目建议 */");
}
