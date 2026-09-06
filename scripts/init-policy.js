#!/usr/bin/env node
/**
 * init-policy.js — 分资产分级策略模板落地（2026-09-06，docs/TIERED_POLICY.md）
 *
 * 用法：
 *   node scripts/init-policy.js --tier 1|2|3 [--dir <目标目录>]
 *
 * 产物：<目标目录>/.progmune-policy.json（模板拷贝）
 * Tier-1 落地即激活写盘策略门（execute 写盘即时验证、BLOCK 回滚）
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const getArg = (flag) => {
  const i = argv.indexOf("--" + flag);
  return i !== -1 ? argv[i + 1] : undefined;
};

const tier = getArg("tier");
const targetDir = getArg("dir") || process.cwd();

if (!["1", "2", "3"].includes(tier)) {
  console.error("用法: node scripts/init-policy.js --tier 1|2|3 [--dir <目标目录>]");
  console.error("  1 = 强制（致命资产：鉴权/支付/资源生命周期）——写盘策略门激活");
  console.error("  2 = 标准（业务逻辑）——violations 阻断，其余 WARN");
  console.error("  3 = 观察（工具/demo）——只报告不拦截");
  process.exit(1);
}

const template = path.join(__dirname, "..", "templates", `.progmune-policy.tier${tier}.json`);
if (!fs.existsSync(template)) {
  console.error(`模板不存在: ${template}`);
  process.exit(1);
}

const dest = path.join(targetDir, ".progmune-policy.json");
if (fs.existsSync(dest)) {
  console.error(`目标已存在策略配置: ${dest}`);
  console.error(`如需更换档位请先删除或修改现有配置（避免静默覆盖）。`);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(template, dest);

const tierName = { "1": "强制（写盘策略门已激活）", "2": "标准", "3": "观察" }[tier];
console.log(`✅ Tier-${tier}（${tierName}）策略已落地: ${dest}`);
console.log(`   验证: npx ts-node src/policy/cli.ts check <file>`);
