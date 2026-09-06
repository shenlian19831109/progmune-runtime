#!/usr/bin/env node
/**
 * rule-propose.js — 协议规则提案脚手架（Oracle 隔离政策，2026-09-06）
 *
 * AI/自动流程只能提案：新规则写入 protocols.json 时 status="proposed"，
 * 加载端跳过（不参与判定）。人工确认 = 把 status 改为 "confirmed"。
 * 同哲学：scripts/c-alias-propose.js 的确认门（c-aliases confirmed）。
 *
 * 用法：
 *   node scripts/rule-propose.js --file proposal.json
 *   node scripts/rule-propose.js --check              # 列出全部 proposed 规则
 *   node scripts/rule-propose.js --confirm <name>     # 人工确认一条（改 status）
 *
 * proposal.json 形态：
 *   { "my_new_rule": { "namespace": "auth", "pre_states": [...],
 *     "post_states": [...], "description": "..." } }
 */
const fs = require("fs");
const path = require("path");

const PROTOCOLS = path.join(__dirname, "..", "protocols.json");
const argv = process.argv.slice(2);
const getArg = (flag) => {
  const i = argv.indexOf("--" + flag);
  return i !== -1 ? argv[i + 1] : undefined;
};

const data = JSON.parse(fs.readFileSync(PROTOCOLS, "utf-8"));
const rules = data.rules || {};

// ── --check：列出提案区 ──
if (argv.includes("--check")) {
  const proposed = Object.entries(rules).filter(([, r]) => r.status === "proposed");
  if (proposed.length === 0) {
    console.log("无 proposed 规则。");
  } else {
    for (const [name, r] of proposed) {
      console.log(`  ⏳ ${name} (ns=${r.namespace}) — ${r.description || "无描述"}`);
    }
    console.log(`\n共 ${proposed.length} 条待人工确认。确认: node scripts/rule-propose.js --confirm <name>`);
  }
  process.exit(0);
}

// ── --confirm：人工确认 ──
const confirmName = getArg("confirm");
if (confirmName) {
  if (!rules[confirmName]) {
    console.error(`规则不存在: ${confirmName}`);
    process.exit(1);
  }
  if (rules[confirmName].status !== "proposed") {
    console.error(`规则 ${confirmName} 状态为 ${rules[confirmName].status || "confirmed"}，无需确认。`);
    process.exit(1);
  }
  rules[confirmName].status = "confirmed";
  fs.writeFileSync(PROTOCOLS, JSON.stringify(data, null, 2) + "\n");
  console.log(`✅ ${confirmName} 已人工确认（confirmed）——开始参与判定。`);
  process.exit(0);
}

// ── --file：提案 ──
const fileArg = getArg("file");
if (!fileArg) {
  console.error("用法: node scripts/rule-propose.js --file proposal.json | --check | --confirm <name>");
  process.exit(1);
}
const proposal = JSON.parse(fs.readFileSync(fileArg, "utf-8"));
let added = 0;
for (const [name, rule] of Object.entries(proposal)) {
  if (!rule.namespace || !Array.isArray(rule.pre_states) || !Array.isArray(rule.post_states)) {
    console.error(`跳过 ${name}: 必须含 namespace/pre_states/post_states`);
    continue;
  }
  if (rules[name]) {
    console.error(`跳过 ${name}: 规则已存在（status=${rules[name].status || "confirmed"}）`);
    continue;
  }
  rules[name] = { ...rule, status: "proposed" };
  added++;
  console.log(`⏳ 提案入库: ${name} (ns=${rule.namespace}) — status=proposed，不参与判定`);
}
fs.writeFileSync(PROTOCOLS, JSON.stringify(data, null, 2) + "\n");
console.log(`\n${added} 条提案已入 protocols.json（proposed）。`);
console.log("人工确认: node scripts/rule-propose.js --confirm <name>");
console.log("提醒：确认前请复核规则活性（pre 状态在本命名空间可达）——src/trust/protocol-rules-liveness.test.ts 仅断言 confirmed 规则。");
