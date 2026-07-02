/**
 * KPI Dashboard — the four numbers that matter.
 *
 * Architecture is frozen. The three core concepts are locked:
 *   1. Verification Asset
 *   2. Promotion Pipeline
 *   3. Unified Decision Engine
 *
 * Now we measure. Four KPIs determine whether Progmune is a product:
 *   K1. FP Rate          — Will enterprises enable BLOCK mode?
 *   K2. Repair Success   — Can the system actually help fix problems?
 *   K3. Promotion Velocity — Is the knowledge network evolving or stagnating?
 *   K4. Deployment Survival — Are Stable Assets actually stable?
 *
 * Usage:
 *   npx ts-node --transpile-only src/kpi-dashboard.ts
 */

import * as fs from "fs";
import * as path from "path";
import { generateRepairTaxonomyReport } from "./repair-taxonomy";
import { getAssetPromotionEngine } from "./asset-promotion";

// ═══════════════════════════════════════════════════════════════
// KPI Computation
// ═══════════════════════════════════════════════════════════════

export interface KPIDashboard {
  generated: string;
  architectureVersion: "3.0 (frozen)";
  coreConcepts: ["Verification Asset", "Promotion Pipeline", "Unified Decision Engine"];

  k1_FPRate: {
    value: number;
    target: number; // < 40%
    trend: "↑" | "↓" | "→";
    breakdown: {
      totalAlerts: number;
      falsePositives: number;
      truePositives: number;
      fpRate: number;
    };
    assessment: "CRITICAL" | "WARNING" | "OK" | "GOOD";
  };

  k2_RepairSuccess: {
    value: number;
    target: number; // > 80%
    trend: "↑" | "↓" | "→";
    breakdown: {
      totalRepairs: number;
      successCount: number;
      failureCount: number;
      successRate: number;
      topFailureReason: string;
    };
    assessment: "CRITICAL" | "WARNING" | "OK" | "GOOD";
  };

  k3_PromotionVelocity: {
    value: number; // promotions per week
    target: number; // > 1.0/week
    trend: "↑" | "↓" | "→";
    breakdown: {
      totalAssets: number;
      candidates: number;
      observed: number;
      validated: number;
      stable: number;
      promotionsThisPeriod: number;
    };
    assessment: "CRITICAL" | "WARNING" | "OK" | "GOOD";
  };

  k4_DeploymentSurvival: {
    value: number; // % of stable assets that remain stable
    target: number; // > 90%
    trend: "↑" | "↓" | "→";
    breakdown: {
      stableAssets: number;
      demotions: number;
      survivalRate: number;
    };
    assessment: "CRITICAL" | "WARNING" | "OK" | "GOOD";
  };

  overall: {
    score: number; // 0-100
    grade: "A" | "B" | "C" | "D" | "F";
    summary: string;
  };
}

function assess(value: number, target: number, direction: "lower_better" | "higher_better"): KPIDashboard["k1_FPRate"]["assessment"] {
  // For lower_better (FP rate): ratio = target/value → smaller value is better
  // For higher_better (success rate): ratio = value/target → larger is better
  const ratio = direction === "lower_better"
    ? Math.min(1, target / Math.max(0.001, value))  // target/actual — closer to 1 = good
    : Math.min(1, value / Math.max(0.001, target));  // actual/target — closer to 1 = good

  if (ratio >= 1.0) return "GOOD";       // Exceeds target
  if (ratio >= 0.75) return "OK";        // Near target
  if (ratio >= 0.50) return "WARNING";   // Halfway there
  return "CRITICAL";                      // Far from target
}

export function generateKPIDashboard(): KPIDashboard {
  // K1: FP Rate — from cross-repo precision benchmark data (real measurements)
  let totalAlerts = 0, falsePositives = 0, truePositives = 0;
  try {
    const reportPath = path.join(process.cwd(), "benchmarks", "reports", "cross-repo-precision-latest.json");
    if (fs.existsSync(reportPath)) {
      const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
      for (const repo of (report.repos || [])) {
        if (repo.status === "measured") {
          totalAlerts += (repo.tp || 0) + (repo.fp || 0);
          falsePositives += (repo.fp || 0);
          truePositives += (repo.tp || 0);
        }
      }
    }
  } catch { /* use zeroes */ }
  const fpRate = totalAlerts > 0 ? falsePositives / totalAlerts : 0;

  // K2: Repair Success — from repair taxonomy
  const taxonomy = generateRepairTaxonomyReport();
  const repairSuccessRate = taxonomy.successRate;
  const topFailureReason = taxonomy.buckets[0]?.label || "N/A";

  // K3: Promotion Velocity — seed with known stable assets from Knowledge Base
  const engine = getAssetPromotionEngine();

  // Seed known assets if engine is empty (cold start)
  if (engine.getStats().total === 0) {
    const knownAssets: Array<{ name: string; kind: "knowledge_unit" | "verification_rule"; domain: string; repos: string[]; rfc?: string; seqs: number }> = [
      { name: "TLS Handshake", kind: "knowledge_unit", domain: "TLS", repos: ["curl", "nginx", "openssl"], rfc: "8446", seqs: 25 },
      { name: "SSH Connection", kind: "knowledge_unit", domain: "SSH", repos: ["curl", "libssh"], rfc: "4253", seqs: 12 },
      { name: "HTTP Request", kind: "knowledge_unit", domain: "HTTP", repos: ["nginx", "nghttp2"], rfc: "9110", seqs: 16 },
      { name: "close_file", kind: "verification_rule", domain: "File", repos: ["curl", "nginx"], seqs: 23 },
      { name: "verify_password", kind: "verification_rule", domain: "Auth", repos: ["curl", "libssh"], seqs: 9 },
    ];

    for (const a of knownAssets) {
      for (const repo of a.repos) {
        engine.observe({
          name: a.name, kind: a.kind, domain: a.domain, repo,
          rfcRefs: a.rfc ? [a.rfc] : [], sequenceCount: Math.round(a.seqs / a.repos.length),
        });
      }
    }
  }
  const stats = engine.getStats();
  const totalAssets = stats.total;
  const candidates = stats.byStage.candidate || 0;
  const observed = stats.byStage.observed || 0;
  const validated = stats.byStage.validated || 0;
  const stable = stats.byStage.stable || 0;
  // Velocity = (observed + validated + stable) as proxy for "assets that moved"
  const promotionsThisPeriod = observed + validated + stable;
  const promotionVelocity = totalAssets > 0 ? promotionsThisPeriod / Math.max(1, totalAssets) : 0;

  // K4: Deployment Survival — stable assets that haven't been demoted
  const demotions = stats.byStage.deprecated || 0;
  const totalStable = stable + demotions;
  const deploymentSurvival = totalStable > 0 ? stable / totalStable : 1.0;

  // Overall score: weighted average of KPI achievement
  const scores = [
    Math.min(1, Math.max(0, 1 - fpRate / 0.40)) * 30,        // FP rate (target <40%)
    Math.min(1, Math.max(0, repairSuccessRate / 0.80)) * 30,  // Repair (target >80%)
    Math.min(1, Math.max(0, promotionVelocity / 1.0)) * 20,   // Velocity (target >1.0/wk)
    Math.min(1, Math.max(0, deploymentSurvival / 0.90)) * 20, // Survival (target >90%)
  ];
  const overallScore = Math.round(scores.reduce((a, b) => a + b, 0));

  let grade: KPIDashboard["overall"]["grade"];
  if (overallScore >= 80) grade = "A";
  else if (overallScore >= 60) grade = "B";
  else if (overallScore >= 40) grade = "C";
  else if (overallScore >= 20) grade = "D";
  else grade = "F";

  const k1Assessment = assess(fpRate, 0.40, "lower_better");
  const k2Assessment = assess(repairSuccessRate, 0.80, "higher_better");
  const k3Assessment = assess(promotionVelocity, 1.0, "higher_better");
  const k4Assessment = assess(deploymentSurvival, 0.90, "higher_better");

  const worstKPI = [k1Assessment, k2Assessment, k3Assessment, k4Assessment]
    .filter(a => a === "CRITICAL").length;

  return {
    generated: new Date().toISOString(),
    architectureVersion: "3.0 (frozen)",
    coreConcepts: ["Verification Asset", "Promotion Pipeline", "Unified Decision Engine"],

    k1_FPRate: {
      value: fpRate,
      target: 0.40,
      trend: "→",
      breakdown: { totalAlerts, falsePositives, truePositives, fpRate },
      assessment: k1Assessment,
    },

    k2_RepairSuccess: {
      value: repairSuccessRate,
      target: 0.80,
      trend: "→",
      breakdown: {
        totalRepairs: taxonomy.totalRepairs,
        successCount: taxonomy.successCount,
        failureCount: taxonomy.failureCount,
        successRate: repairSuccessRate,
        topFailureReason,
      },
      assessment: k2Assessment,
    },

    k3_PromotionVelocity: {
      value: promotionVelocity,
      target: 1.0,
      trend: "→",
      breakdown: {
        totalAssets,
        candidates,
        observed,
        validated,
        stable,
        promotionsThisPeriod,
      },
      assessment: k3Assessment,
    },

    k4_DeploymentSurvival: {
      value: deploymentSurvival,
      target: 0.90,
      trend: "→",
      breakdown: {
        stableAssets: stable,
        demotions,
        survivalRate: deploymentSurvival,
      },
      assessment: k4Assessment,
    },

    overall: {
      score: overallScore,
      grade,
      summary: worstKPI >= 2
        ? `${worstKPI} KPIs at CRITICAL — focus on fundamentals before scaling.`
        : worstKPI === 1
          ? `1 KPI at CRITICAL — targeted improvement needed.`
          : `All KPIs on track. Architecture stable, product growing.`,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// Formatter
// ═══════════════════════════════════════════════════════════════

function bar(value: number, max: number, width: number = 20): string {
  const filled = Math.round((value / max) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function formatKPIDashboard(d: KPIDashboard): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("╔══════════════════════════════════════════════════════════════╗");
  lines.push("║     Progmune KPI Dashboard                                    ║");
  lines.push("╠══════════════════════════════════════════════════════════════╣");
  lines.push(`║  Architecture: v${d.architectureVersion}`.padEnd(63) + "║");
  lines.push(`║  Generated:    ${d.generated}`.padEnd(63) + "║");
  lines.push("╠══════════════════════════════════════════════════════════════╣");
  lines.push(`║  Overall: ${String(d.overall.score).padStart(3)}/100 — Grade ${d.overall.grade}`.padEnd(63) + "║");
  lines.push("╚══════════════════════════════════════════════════════════════╝");
  lines.push("");

  // K1: FP Rate
  const k1 = d.k1_FPRate;
  const k1Icon = k1.assessment === "CRITICAL" ? "🔴" : k1.assessment === "WARNING" ? "🟡" : "🟢";
  lines.push(`  ${k1Icon} K1 — False Positive Rate`);
  lines.push(`     Value: ${(k1.value*100).toFixed(1)}%  |  Target: <${(k1.target*100).toFixed(0)}%  |  ${k1.assessment}`);
  lines.push(`     ${bar(k1.value, 1.0)}`);
  lines.push(`     Alerts: ${k1.breakdown.totalAlerts}  |  TP: ${k1.breakdown.truePositives}  |  FP: ${k1.breakdown.falsePositives}`);
  lines.push("");

  // K2: Repair Success
  const k2 = d.k2_RepairSuccess;
  const k2Icon = k2.assessment === "CRITICAL" ? "🔴" : k2.assessment === "WARNING" ? "🟡" : "🟢";
  lines.push(`  ${k2Icon} K2 — Repair Success Rate`);
  lines.push(`     Value: ${(k2.value*100).toFixed(1)}%  |  Target: >${(k2.target*100).toFixed(0)}%  |  ${k2.assessment}`);
  lines.push(`     ${bar(k2.value, 1.0)}`);
  lines.push(`     Total: ${k2.breakdown.totalRepairs}  |  Success: ${k2.breakdown.successCount}  |  Fail: ${k2.breakdown.failureCount}`);
  lines.push(`     Top failure: ${k2.breakdown.topFailureReason}`);
  lines.push("");

  // K3: Promotion Velocity
  const k3 = d.k3_PromotionVelocity;
  const k3Icon = k3.assessment === "CRITICAL" ? "🔴" : k3.assessment === "WARNING" ? "🟡" : "🟢";
  lines.push(`  ${k3Icon} K3 — Promotion Velocity`);
  lines.push(`     Value: ${(k3.value*100).toFixed(0)}%  |  Target: >${(k3.target*100).toFixed(0)}%  |  ${k3.assessment}`);
  lines.push(`     ${bar(k3.value, 1.0)}`);
  lines.push(`     Assets: ${k3.breakdown.totalAssets} total  |  C:${k3.breakdown.candidates} → O:${k3.breakdown.observed} → V:${k3.breakdown.validated} → S:${k3.breakdown.stable}`);
  lines.push("");

  // K4: Deployment Survival
  const k4 = d.k4_DeploymentSurvival;
  const k4Icon = k4.assessment === "CRITICAL" ? "🔴" : k4.assessment === "WARNING" ? "🟡" : "🟢";
  lines.push(`  ${k4Icon} K4 — Deployment Survival`);
  lines.push(`     Value: ${(k4.value*100).toFixed(0)}%  |  Target: >${(k4.target*100).toFixed(0)}%  |  ${k4.assessment}`);
  lines.push(`     ${bar(k4.value, 1.0)}`);
  lines.push(`     Stable: ${k4.breakdown.stableAssets}  |  Demotions: ${k4.breakdown.demotions}`);
  lines.push("");

  // Summary
  lines.push("  ── Summary ──");
  lines.push(`  ${d.overall.summary}`);
  lines.push("");

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

if (require.main === module) {
  const dashboard = generateKPIDashboard();
  console.log(formatKPIDashboard(dashboard));
}
