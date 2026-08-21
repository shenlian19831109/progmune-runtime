/**
 * Phase 12: Agent 免疫巡逻 (P4) —— 形态 B 第一版
 *
 * 监听/扫描项目 → trust_check（Trust Engine 全量评估）→ 违规报告 + 建议补丁。
 *
 * 修复信任悖论（设计文档铁律）：
 *   100% 检测精度 ≠ 修复正确率。巡逻第一形态**只报告 + 建议补丁，
 *   绝不自动合并**（autoApplied 恒为 false）——修错比不修更糟，
 *   第一份错误修复会摧毁"免疫巡逻"信任。
 *
 * 感知职责：每次扫描前强制重提 IR（IR_STALE 的消费方），保证验证的是新世界。
 */

import * as fs from "fs";
import * as path from "path";
import { evaluateTrust } from "./trust/engine";
import type { TrustDecision, TrustViolation } from "./trust/types";
import { collectGitContext } from "./agent-perception";
import { extractIR } from "./extract-ir";
import type { AuditEvent } from "./agent-loop";

// ── Types ──

export interface PatrolFinding {
  rule_id: string;
  severity: string;
  file: string;
  function: string;
  message: string;
  /** 建议修复路径（violationTraces.fixPath / BFS）——只建议，不应用 */
  fixPath: string[];
  /** 修复建议（violation.fix） */
  fix: string;
  /** 证据链摘要（evidence + why） */
  evidence: string;
  /** 推理步骤回放（ledger/状态轨迹） */
  reasoningSteps: string[];
}

export interface PatrolReport {
  scannedAt: string;
  project: string;
  branch: string;
  commit: string;
  decision: string;
  score: number;
  confidence: string;
  findings: PatrolFinding[];
  summary: { total: number; critical: number; high: number; medium: number; low: number };
  auditTrail: AuditEvent[];
  engineVersion: string;
  checkId: string;
  /** 修复信任悖论：巡逻永不自动合并 */
  autoApplied: false;
  changedFiles: string[];
}

// ── Main ──

/**
 * 运行一次免疫巡逻：重提 IR → evaluateTrust → 映射违规（含 fixPath）→ 报告。
 */
export async function runPatrol(projectPath: string): Promise<PatrolReport> {
  const abs = path.resolve(projectPath);
  const git = collectGitContext(abs);

  // 感知：扫描前强制重提 IR（IR_STALE 消费方）——验证的是新世界
  try {
    const ir = extractIR(abs);
    fs.writeFileSync(path.join(abs, "ir.json"), JSON.stringify(ir, null, 2));
  } catch { /* IR 提取失败不阻塞 —— trust 引擎会降级 */ }

  const decision: TrustDecision = await evaluateTrust({
    projectPath: abs,
    projectName: path.basename(abs),
    commit: git.available ? (git.recentCommits[0]?.split(" ")[0] || "unknown") : "unknown",
    branch: git.available ? git.branch : undefined,
  });

  // fixPath 来自引擎的 violationTraces（BFS 修复路径）
  const traces = new Map(
    (decision.violationTraces || []).map((t) => [`${t.rule_id}|${t.file}|${t.function}`, t]),
  );

  const findings: PatrolFinding[] = decision.violations.map((v: TrustViolation) => {
    const trace = traces.get(`${v.rule_id}|${v.file}|${v.function}`);
    return {
      rule_id: v.rule_id,
      severity: v.severity,
      file: v.file,
      function: v.function,
      message: v.message,
      fixPath: trace?.fixPath || [],
      fix: v.fix,
      evidence: v.evidence,
      reasoningSteps: (trace?.steps || []).map(
        (s) => `[${s.label}] ${s.action} → ${s.explanation}`,
      ),
    };
  });

  const auditTrail: AuditEvent[] = [
    {
      timestamp: new Date().toISOString(),
      event: "patrol:scan",
      detail:
        `decision=${decision.overall.decision} score=${decision.overall.score} ` +
        `violations=${decision.violations.length}`,
    },
    {
      timestamp: decision.timestamp,
      event: "patrol:trust-audit",
      detail:
        `checkId=${decision.auditTrail.checkId} engine=${decision.engineVersion} ` +
        `reproducible=${decision.auditTrail.reproducible}`,
    },
  ];

  return {
    scannedAt: new Date().toISOString(),
    project: decision.project,
    branch: git.available ? git.branch : "",
    commit: decision.commit,
    decision: decision.overall.decision,
    score: decision.overall.score,
    confidence: decision.overall.confidence,
    findings,
    summary: {
      total: decision.summary.total,
      critical: decision.summary.critical,
      high: decision.summary.high,
      medium: decision.summary.medium,
      low: decision.summary.low,
    },
    auditTrail,
    engineVersion: decision.engineVersion,
    checkId: decision.auditTrail.checkId,
    autoApplied: false,
    changedFiles: git.changedFiles,
  };
}

// ── Formatters ──

/** 终端一行摘要。 */
export function formatPatrolTerminal(r: PatrolReport): string {
  const icon = r.decision === "APPROVED" ? "✅" : r.decision === "BLOCKED" ? "🛑" : "⚠️";
  const lines = [
    `${icon} 免疫巡逻: ${r.project} — ${r.decision} (score=${r.score}, confidence=${r.confidence})`,
    `   违规: ${r.summary.total} (critical=${r.summary.critical} high=${r.summary.high} ` +
      `medium=${r.summary.medium} low=${r.summary.low}) ｜ 自动合并: 永不（只报告+建议）`,
  ];
  for (const f of r.findings.slice(0, 10)) {
    lines.push(
      `   [${f.severity}] ${f.rule_id} @ ${f.file}${f.function ? `::${f.function}` : ""}` +
      (f.fixPath.length > 0 ? ` → 建议补丁: ${f.fixPath.join(" → ")}` : ""),
    );
  }
  if (r.findings.length > 10) lines.push(`   … 其余 ${r.findings.length - 10} 项见报告`);
  return lines.join("\n");
}

/** 完整 Markdown 巡逻报告（含证据链回放，可入审计档案）。 */
export function formatPatrolMarkdown(r: PatrolReport): string {
  const lines: string[] = [
    `# 🛡️ Progmune 免疫巡逻报告`,
    ``,
    `- 扫描时间: ${r.scannedAt}`,
    `- 项目: ${r.project}${r.branch ? `（分支 ${r.branch}）` : ""}`,
    `- 提交: ${r.commit}`,
    `- 决策: **${r.decision}** ｜ 分数: ${r.score} ｜ 置信度: ${r.confidence}`,
    `- 引擎: ${r.engineVersion} ｜ checkId: ${r.checkId}`,
    `- **自动合并: 永不**（只报告 + 建议补丁，修复需人工审批）`,
    ``,
    `## 违规摘要`,
    ``,
    `| 严重级 | 数量 |`,
    `|---|---|`,
    `| critical | ${r.summary.critical} |`,
    `| high | ${r.summary.high} |`,
    `| medium | ${r.summary.medium} |`,
    `| low | ${r.summary.low} |`,
    `| **合计** | **${r.summary.total}** |`,
    ``,
  ];

  if (r.findings.length === 0) {
    lines.push(`✅ 未发现违规。`, ``);
  } else {
    lines.push(`## 违规明细与建议补丁`, ``);
    r.findings.forEach((f, i) => {
      lines.push(
        `### ${i + 1}. [${f.severity}] ${f.rule_id} — ${f.file}${f.function ? `::${f.function}` : ""}`,
        ``,
        `- **问题**: ${f.message}`,
        `- **修复建议**: ${f.fix}`,
      );
      if (f.fixPath.length > 0) {
        lines.push(`- **建议补丁路径**（不自动应用）: \`${f.fixPath.join(" → ")}\``);
      }
      if (f.reasoningSteps.length > 0) {
        lines.push(``, `**推理回放**:`, ``);
        f.reasoningSteps.forEach((s) => lines.push(`  - ${s}`));
      }
      lines.push(``);
    });
  }

  lines.push(`## 证据链（可回放）`, ``);
  r.auditTrail.forEach((e) => lines.push(`- \`${e.timestamp}\` **${e.event}**: ${e.detail}`));
  if (r.changedFiles.length > 0) {
    lines.push(``, `## 扫描时变更文件`, ``);
    r.changedFiles.forEach((f) => lines.push(`- ${f}`));
  }
  lines.push(``, `---`, `*由 Progmune 免疫巡逻生成。修复责任: 人工审批后应用。*`, ``);
  return lines.join("\n");
}

/** 写入巡逻报告到项目目录，返回文件路径。 */
export function writePatrolReport(r: PatrolReport, projectPath: string): string {
  const reportPath = path.join(path.resolve(projectPath), ".progmune_patrol_report.md");
  fs.writeFileSync(reportPath, formatPatrolMarkdown(r), "utf-8");
  return reportPath;
}
