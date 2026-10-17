/**
 * 修冤枉第十刀预研探针：公开设计端点传播（只读，import 真实实现）
 *
 * 判据草案（镜像第九刀，base 扩为 {公开} ∪ {已守卫} ∪ {作业面}）：
 *   函数 F 的每个直接调用方都 ∈ 公开∪守卫∪作业 ⇒ 授权族告警不适用
 *   ——每条到达 F 的路径要么被 @Public() 故意公开、要么已过守卫、
 *   要么源起作业（无请求面）。
 *
 * 本探针做三件事：
 *   1. 量化 Part A（直接）：@Public() 方法自身的授权族告警数
 *   2. 量化 Part B（传播）：调用方全 ∈ 公开∪守卫∪作业 的告警数
 *      （与第九刀差集 = 涉及公开路径的新增豁免）
 *   3. 输出候选清单（fn + 调用方归类）供 FN 风险复核
 *
 * 用法：npx ts-node blind-benchmark/knife10-public-surface-probe.ts [--show 40]
 */

import * as fs from "fs";
import * as path from "path";
import {
  computeGuardPropagatedSet,
  computeJobSurfacePropagatedSet,
  computePublicSurfacePropagatedSet,
  computeResolvedCallerMap,
} from "../src/protocol-detector";

const ROOT = path.resolve(__dirname, "..");
const IR_PATH = path.join(ROOT, "benchmarks", "ts-apps", "docmost", "apps", "server", "ir.json");
const BASELINE = path.join(ROOT, "blind-benchmark", "reports", "heldout", "trust-docmost-69ab-pre.json");

// docmost 15 个 @Public() 方法（2026-10-16 源码 grep，4 个 controller）
const PUBLIC_METHODS = [
  "WorkspaceController.getWorkspacePublicInfo", "WorkspaceController.getInvitationById",
  "WorkspaceController.acceptInvite", "WorkspaceController.checkHostname",
  "PublicSpaceController.getInfo", "PublicSpaceController.getDirectory",
  "PublicSpaceController.getTree", "PublicSpaceController.getPageInfo",
  "PublicSpaceController.transclusionLookup",
  "SearchController.searchShare", "SearchController.searchPublicSpace",
  "ShareController.getSharedPageInfo", "ShareController.getShare",
  "ShareController.transclusionLookup", "ShareController.getSharePageTree",
];

const functions: Array<{ name: string; file?: string; calls?: string[] }> =
  JSON.parse(fs.readFileSync(IR_PATH, "utf8"));
console.log(`IR functions: ${functions.length}`);

const guardPropagated = computeGuardPropagatedSet(functions);
const jobSurfacePropagated = computeJobSurfacePropagatedSet(functions);
const publicSet = new Set(PUBLIC_METHODS.filter((n) => functions.some((f) => f.name === n)));
console.log(`guard ${guardPropagated.size} | job ${jobSurfacePropagated.size} | public in IR ${publicSet.size}/${PUBLIC_METHODS.length}`);

// ── 读 3.7.68 告警流（授权族 raw）──
const report = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
const authRaw: Array<{ rule: string; fn: string; file?: string }> = [];
for (const g of report.overall.safeguardAlerts.groups) {
  if (!/Authorization/.test(g.rule)) continue;
  for (const e of g.alerts ?? []) authRaw.push({ rule: g.rule, fn: e.alert.function, file: e.alert.file });
}
console.log(`authorization raw alerts: ${authRaw.length}`);

// ── Part A：@Public 方法自身 ──
const partA = authRaw.filter((r) => publicSet.has(r.fn));
console.log(`\n=== Part A（@Public 方法自身）: ${partA.length} 条 ===`);
const aByFn = new Map<string, number>();
for (const r of partA) aByFn.set(r.fn, (aByFn.get(r.fn) ?? 0) + 1);
for (const [fn, n] of [...aByFn.entries()].sort((x, y) => y[1] - x[1])) {
  const rules = partA.filter((r) => r.fn === fn).map((r) => r.rule.replace("Authorization (", "").replace(")", "")).join("+");
  console.log(`  ${fn.padEnd(48)} x${n} [${rules}]`);
}

// ── Part B：传播（base = 公开 ∪ 守卫 ∪ 作业）──
// import 真实实现（R59）
const propagated = computePublicSurfacePropagatedSet(functions, publicSet, guardPropagated, jobSurfacePropagated, { maxRounds: 1 });
const partB = authRaw.filter((r) => propagated.has(r.fn) && !publicSet.has(r.fn));
console.log(`\n=== Part B（传播新增，调用方全 ∈ 公开∪守卫∪作业）: ${partB.length} 条 ===`);
const bByRule = new Map<string, number>();
for (const r of partB) bByRule.set(r.rule, (bByRule.get(r.rule) ?? 0) + 1);
console.log(`按规则: ${JSON.stringify(Object.fromEntries(bByRule))}`);

// 与第九刀差集：哪些是「涉及公开路径」的新增（第九刀已豁免的 16 条不在 raw 里）
const resolved = computeResolvedCallerMap(functions);
const show = process.argv.includes("--show") ? parseInt(process.argv[process.argv.indexOf("--show") + 1] ?? "40") : 40;
console.log(`\n=== Part B 候选清单（前 ${show}）[pub]=公开 [g]=守卫 [j]=作业 ===`);
for (const h of partB.slice(0, show)) {
  const callers = resolved.get(h.fn) || [];
  const tags = callers.map((c) => (publicSet.has(c.caller) ? "[pub]" : "") + (guardPropagated.has(c.caller) ? "[g]" : "") + (jobSurfacePropagated.has(c.caller) ? "[j]" : "") + (c.resolved ? "" : "[歧义]"));
  console.log(`  ${h.fn.padEnd(52)} ← ${callers.map((c, i) => `${c.caller}${tags[i]}`).join(", ") || "∅"}`);
}

// ── 合计 ──
const total = partA.length + partB.length;
console.log(`\n=== 第十刀合计覆盖: ${total} 条（A ${partA.length} + B ${partB.length}）===`);
fs.writeFileSync(
  path.join(ROOT, "blind-benchmark", "reports", "knife10-public-candidates.json"),
  JSON.stringify({ partA, partB }, null, 2)
);
console.log(`wrote knife10-public-candidates.json`);
