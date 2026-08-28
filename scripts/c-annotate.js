#!/usr/bin/env node
/**
 * C 注解脚手架——注解驱动定位的采纳生死线工具。
 *
 * 两种模式：
 *
 * 1) 模板模式（单条手写）
 *    node scripts/c-annotate.js --namespace auth --function start_channel_session \
 *        --pre PASSWORD_VERIFIED --post SESSION_ACTIVE [--invalidate X] \
 *        [--alias-call ssh_userauth_password --alias-rule verify_password]
 *
 * 2) 扫描建议模式（未注解项目的原语注解候选清单）
 *    node scripts/c-annotate.js --scan <projectDir> [--limit N] [--write] [--all] [--include-resource]
 *    —— 按函数名词汇启发式生成建议（角色/命名空间/状态转移预填的注释块）；
 *       默认 dry-run 只打印；--write 把高置信建议插入函数定义上方
 *       （--all 连中置信一起写入；已存在 @progmune 注释的函数跳过）。
 *       open/close 资源生命周期建议默认不自动写入（事件驱动代码上触发
 *       跨函数窗口 FP，REALWORLD_C_V7.md 实测），--include-resource 强制。
 *    与 c-alias-propose.js 同一哲学：建议是「填空起点」，人工确认后生效。
 */

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

// ── 模式 2：扫描建议 ──
if (args.includes("--scan")) {
  const dir = arg("--scan");
  if (!dir) {
    console.error("用法: node scripts/c-annotate.js --scan <projectDir> [--limit N] [--write] [--all]");
    process.exit(1);
  }
  runScan(path.resolve(dir), {
    limit: parseInt(arg("--limit") || "20", 10),
    write: args.includes("--write"),
    includeMedium: args.includes("--all"),
    includeResource: args.includes("--include-resource"),
  }).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
} else {
  // ── 模式 1：模板 ──
  const namespace = arg("--namespace");
  const fn = arg("--function");
  const pre = arg("--pre") || "";
  const post = arg("--post") || "";
  const invalidate = arg("--invalidate") || null;
  const aliasCall = arg("--alias-call");
  const aliasRule = arg("--alias-rule");

  if (!namespace || !fn) {
    console.error("用法: node scripts/c-annotate.js --namespace <ns> --function <fn> [--pre S1,S2] [--post S1,S2] [--invalidate S] [--alias-call <库API> --alias-rule <规则名>]");
    console.error("      或: node scripts/c-annotate.js --scan <projectDir> [--write] [--all]");
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
}

// ═══════════════════════════════════════════════════════════════
//  扫描建议模式
// ═══════════════════════════════════════════════════════════════

/** 提取并写盘 ir.json（与引擎同款兜底：缺才提取；--write 后重提以刷新注解状态） */
function extractAndWrite(projectDir, note) {
  const irPath = path.join(projectDir, "ir.json");
  if (!fs.existsSync(irPath) && !note) console.log("ir.json 不存在——按项目语言自动提取…");
  try {
    const { extractProjectIR } = require(path.join(__dirname, "..", "dist", "extract-project-ir.js"));
    const ir = extractProjectIR(projectDir);
    fs.writeFileSync(irPath, JSON.stringify(ir, null, 2));
    if (!note) console.log(`已写入 ${irPath}（${ir.functions ? ir.functions.length : ir.length} 函数）`);
  } catch (e) {
    throw new Error(`提取失败: ${e.message}`);
  }
  return JSON.parse(fs.readFileSync(irPath, "utf-8"));
}

async function runScan(projectDir, opts) {
  // 1) 读取/生成 ir.json
  let ir = null;
  if (!fs.existsSync(path.join(projectDir, "ir.json"))) {
    ir = extractAndWrite(projectDir, false);
  } else {
    ir = JSON.parse(fs.readFileSync(path.join(projectDir, "ir.json"), "utf-8"));
  }
  let functions = Array.isArray(ir) ? ir : (ir.functions || []);

  // 2) 建议生成（与引擎同款：规则名函数/已注解函数自动排除）
  const { suggestAnnotations } = require(path.join(__dirname, "..", "dist", "annotation-suggest.js"));
  const suggestions = suggestAnnotations(functions, undefined, opts.limit);
  if (suggestions.length === 0) {
    console.log("未发现可建议的原语注解候选（已注解/规则名/无词汇命中的函数已排除）。");
    return;
  }

  // 3) 渲染
  const roleLabels = { verify: "凭证比对", establish: "登录完成", guard: "权限守卫", open: "资源获取", close: "资源释放" };
  console.log(`\n建议 ${suggestions.length} 条（${suggestions.filter(s => s.confidence === "high").length} 高置信 / ${suggestions.filter(s => s.confidence === "medium").length} 中置信）：\n`);
  for (const s of suggestions) {
    console.log(`【${roleLabels[s.role]}】${s.confidence === "high" ? "●高" : "○中"} ${s.function} @ ${s.file}`);
    console.log(`  理由: ${s.reasons.join(" / ")}`);
    console.log(`  ${s.template}`);
    console.log("");
  }

  if (!opts.write) {
    console.log("dry-run：未写入任何文件。确认后加 --write 写入（默认只写高置信，--all 连中置信写入；资源生命周期 open/close 需 --include-resource）。");
    return;
  }

  // 4) 写入：锚定函数定义行（含 NAME( 且行尾非 ;——声明与调用通常以 ; 结尾）
  // 实测（REALWORLD_C_V7.md）：open/close 资源生命周期注解在事件驱动代码上
  // 触发跨函数窗口 FP 类（open/close 分处不同函数窗口——V1 记录的 L3 边界），
  // 自动应用不安全，默认跳过；auth 类（verify/establish/guard，状态单调、
  // 单函数自足）实测 0 新 FP，可安全自动应用。
  let written = 0;
  let skippedResource = 0;
  let skippedMask = 0;
  for (const s of suggestions) {
    if (s.confidence !== "high" && !opts.includeMedium) continue;
    if ((s.role === "open" || s.role === "close") && !opts.includeResource) {
      skippedResource++;
      continue;
    }
    // 掩蔽风险：注解把函数变原语（函数内顺序不检查），若其体内调用
    // 其他规则原语，握有的违规会被掩蔽——自动写入跳过，人工确认后手写
    if (s.maskRisk) {
      console.log(`跳过 ${s.function}：掩蔽风险（函数体调用规则原语，注解后体内序列不再被验证——REALWORLD_C_V7.md）`);
      skippedMask++;
      continue;
    }
    const file = path.join(projectDir, s.file);
    if (!fs.existsSync(file)) { console.log(`跳过 ${s.function}：文件不存在 ${s.file}`); continue; }
    const lines = fs.readFileSync(file, "utf-8").split("\n");
    const defIdx = lines.findIndex((line) =>
      line.includes(`${s.function}(`) && !/;\s*$/.test(line)
    );
    if (defIdx < 0) { console.log(`跳过 ${s.function}：未找到单行签名定义（多行签名请手动粘贴）`); continue; }
    const prevLine = lines[defIdx - 1] || "";
    if (prevLine.includes("@progmune")) { console.log(`跳过 ${s.function}：上方已有注解`); continue; }
    lines.splice(defIdx, 0, s.template);
    fs.writeFileSync(file, lines.join("\n"));
    written++;
    console.log(`已写入 ${s.function} @ ${s.file}`);
  }
  // 写入后刷新 ir.json——否则重扫读到陈旧 IR，已注解函数仍出现在建议里
  if (written > 0) {
    const fresh = extractAndWrite(projectDir, true);
    functions = Array.isArray(fresh) ? fresh : (fresh.functions || []);
    console.log("ir.json 已刷新（注解合并生效，重扫将排除已注解函数）。");
  }
  if (skippedResource > 0) {
    console.log(`跳过 ${skippedResource} 条资源生命周期建议（open/close）——事件驱动代码上自动应用触发跨函数窗口 FP（REALWORLD_C_V7.md），加 --include-resource 强制写入。`);
  }
  if (skippedMask > 0) {
    console.log(`共 ${skippedMask} 条掩蔽风险建议被跳过（人工确认后可手写——工具不提供强制写入开关）。`);
  }
  console.log(`\n完成：写入 ${written} 条注解。重扫验证：node scripts/c-annotate.js --scan ${projectDir}`);
}
