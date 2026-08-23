/**
 * Blind Benchmark — Python Protocol Scanner v1
 *
 * 对 generated-protocol-py/ 的每个项目做确定性协议校验（无 LLM），
 * 测量 Python 的 SSG 协议路径（矩阵里的 Auth ⚠️ / Resource ⚠️ 行）。
 *
 * 管线（与生产 trust 引擎路径对齐）：
 *   1. extractIRPython → 写项目根 ir.json（execute() 同款）
 *   2. 规则 = 仓库内置 protocols.json + P4.5 合并项目 IR 注解协议
 *      （项目 @progmune 注解覆盖内置弱约束，如 generate_jwt pre=[PASSWORD_VERIFIED]）
 *   3. 序列 = ir.json 每函数 calls[]（过滤 __progmune_ marker，空序列跳过）
 *      —— trust 引擎 extractCallSequencesFromIR 同款语义
 *   4. 生产校验器：src/trust/ssg-bridge.ts validateSequenceWithSSG
 *      （pre-state / invalidate 失败 → SSGViolation + BFS fixPath）
 *      steps 由调用名直构（{api}）——规范名命中 name-match 分支，等价于
 *      生产路径 LLM 语义映射对规范协议名的输出；LLM 桥接层不参与测量。
 *
 * 已知边界（如实记录，不假装全覆盖）：
 *   - 生产校验器无 endState（资源未释放）检查——T5 金标单列 known-gap，
 *     不计入头条 P/R（对应 SSGRejection.endState 类型存在但桥接循环未用）
 *   - 跨函数状态传播未实现（per-function 序列验证）——与 C 的 L3 同类边界
 *   - LLM 语义桥接层（任意 API 名 → 协议名）不在本基准测量范围
 *
 * Usage: npx ts-node blind-benchmark/scan-protocol-python.ts
 */

import * as fs from "fs";
import * as path from "path";
import { extractIRPython } from "../src/extract-ir-python";
import { validateSequenceWithSSG } from "../src/trust/ssg-bridge";
import type { StateAnnotation } from "../src/ssg-validator";

export const PROTO_REPORT_PATH = path.resolve(__dirname, "reports", "scan-protocol-python-results.json");
const BUILTIN_PROTOCOLS = path.resolve(__dirname, "..", "protocols.json");

// ═══════════════════════════════════════════════════════════════
// 规则装载（内置 + P4.5 注解合并）
// ═══════════════════════════════════════════════════════════════

export interface ProtocolRuleSet {
  rules: Map<string, StateAnnotation>;
  nsInit: Record<string, string>;
}

/**
 * 装载内置 protocols.json + 合并项目 IR 注解协议。
 * 合并语义对齐 trust/engine.ts P4.5：注解覆盖同名内置规则，缺 namespace 继承内置。
 */
export function loadProtocolRulesForProject(projectPath: string): ProtocolRuleSet {
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

  // P4.5：合并项目 ir.json 注解协议
  try {
    const irPath = path.join(projectPath, "ir.json");
    if (fs.existsSync(irPath)) {
      const ir = JSON.parse(fs.readFileSync(irPath, "utf-8"));
      if (Array.isArray(ir)) {
        for (const f of ir) {
          if (!f.protocol) continue;
          const proto = { ...f.protocol };
          const existing = rules.get(String(f.name));
          if (existing?.namespace && !proto.namespace) proto.namespace = existing.namespace;
          rules.set(String(f.name), proto);
        }
      }
    }
  } catch { /* best-effort */ }

  return { rules, nsInit };
}

// ═══════════════════════════════════════════════════════════════
// 扫描
// ═══════════════════════════════════════════════════════════════

export interface ProtocolScanViolation {
  file: string;
  function: string;
  failingFunction: string;
  reason: string;
}

export interface ProtocolScanResult {
  projectId: string;
  functionCount: number;
  sequenceCount: number;
  violations: ProtocolScanViolation[];
}

/**
 * 扫描单个项目：提取 IR → 落盘 ir.json → per-function 序列 → 生产 SSG 桥接校验。
 */
export function scanProjectProtocol(projectPath: string, projectId?: string): ProtocolScanResult {
  const ir = extractIRPython(projectPath);
  fs.writeFileSync(path.join(projectPath, "ir.json"), JSON.stringify(ir, null, 2), "utf-8");

  const { rules, nsInit } = loadProtocolRulesForProject(projectPath);
  const violations: ProtocolScanViolation[] = [];
  let sequenceCount = 0;

  for (const f of ir) {
    const calls = (f.calls || []).filter(
      (c: string) => typeof c === "string" && !c.startsWith("__progmune_"),
    );
    if (calls.length === 0) continue;
    sequenceCount++;

    // 规范协议名直构 steps（name-match 分支）；LLM 语义桥接不参与测量
    const steps = calls.map((c) => ({ api: c, description: "" })) as any[];
    const result = validateSequenceWithSSG(steps, rules, nsInit, String(f.file || ""));
    for (const v of result.violations) {
      violations.push({
        file: String(f.file || ""),
        function: String(f.name || "unknown"),
        failingFunction: v.callName,
        reason: v.explanation,
      });
    }
  }

  return {
    projectId: projectId || path.basename(projectPath),
    functionCount: ir.length,
    sequenceCount,
    violations,
  };
}

// ═══════════════════════════════════════════════════════════════
// Main：全语料扫描
// ═══════════════════════════════════════════════════════════════

function main(): void {
  const genDir = path.resolve(__dirname, "generated-protocol-py");
  const projects = fs.readdirSync(genDir)
    .filter((d) => fs.statSync(path.join(genDir, d)).isDirectory())
    .sort();

  const results: ProtocolScanResult[] = [];
  for (const p of projects) {
    results.push(scanProjectProtocol(path.join(genDir, p), p));
  }

  const report = {
    scan_generated: new Date().toISOString(),
    projects_scanned: results.length,
    total_violations: results.reduce((a, r) => a + r.violations.length, 0),
    results,
  };
  fs.mkdirSync(path.dirname(PROTO_REPORT_PATH), { recursive: true });
  fs.writeFileSync(PROTO_REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");

  for (const r of results) {
    if (r.violations.length > 0) {
      console.log(`${r.projectId}: ${r.violations.length} 违规`);
      for (const v of r.violations) {
        console.log(`  ${v.file}::${v.function} — ${v.failingFunction}: ${v.reason.slice(0, 110)}`);
      }
    }
  }
  console.log(`\n扫描完成：${results.length} 项目，共 ${report.total_violations} 条违规 → ${path.relative(process.cwd(), PROTO_REPORT_PATH)}`);
}

if (require.main === module) main();
