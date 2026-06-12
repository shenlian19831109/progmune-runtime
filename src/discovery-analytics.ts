/**
 * P4.7: Discovery Analytics
 *
 * Makes DiscoveryRate a first-class KPI alongside Top-1/Top-3.
 *
 * Discovery Rate = fraction of benchmark cases where at least one
 * correct candidate was found (regardless of ranking).
 *
 * Tracks:
 *   - Discovery Rate by Protocol
 *   - Discovery Rate by Violation Type
 *   - Discovery Rate by Goal
 *   - Trend over time (with timestamps)
 */

import * as fs from "fs";
import * as path from "path";
import { runFailureAttribution, AttributedCase } from "./evaluation-campaign";
import { generateCoverageDashboard } from "./coverage-dashboard";
import { buildDifficultyMap, rankProtocolsByDifficulty } from "./difficulty-map";
import { mineMacroRepairs, MacroRepair } from "./macro-repair";
import { PlannerTelemetry } from "./planner-telemetry";

// ═══════════════════════════════════════════════════════════════
// Discovery Metrics
// ═══════════════════════════════════════════════════════════════

export interface DiscoveryMetrics {
  overall: number;
  byProtocol: Record<string, number>;
  byViolation: Record<string, number>;
  byGoal: Record<string, number>;
  totalCases: number;
}

/**
 * Compute discovery metrics from benchmark attributions.
 *
 * "Discovered" = at least one candidate was found (failureReason != "missing_candidate").
 */
export function computeDiscoveryMetrics(attributed: AttributedCase[]): DiscoveryMetrics {
  const total = attributed.length;

  const byProtocol: Record<string, { total: number; discovered: number }> = {};
  const byViolation: Record<string, { total: number; discovered: number }> = {};
  const byGoal: Record<string, { total: number; discovered: number }> = {};

  for (const a of attributed) {
    const discovered = a.failureReason !== "missing_candidate" && a.failureReason !== "bad_protocol_model";

    // By protocol
    const proto = a.protocol || "unknown";
    if (!byProtocol[proto]) byProtocol[proto] = { total: 0, discovered: 0 };
    byProtocol[proto].total++;
    if (discovered) byProtocol[proto].discovered++;

    // By violation
    const viol = a.violationType || "unknown";
    if (!byViolation[viol]) byViolation[viol] = { total: 0, discovered: 0 };
    byViolation[viol].total++;
    if (discovered) byViolation[viol].discovered++;

    // By goal (first 2 words)
    const goalKey = a.goal.split(" ").slice(0, 3).join(" ");
    if (!byGoal[goalKey]) byGoal[goalKey] = { total: 0, discovered: 0 };
    byGoal[goalKey].total++;
    if (discovered) byGoal[goalKey].discovered++;
  }

  const toRates = (rec: Record<string, { total: number; discovered: number }>) =>
    Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, v.total > 0 ? v.discovered / v.total : 0]));

  return {
    overall: total > 0 ? attributed.filter(a => a.failureReason !== "missing_candidate").length / total : 0,
    byProtocol: toRates(byProtocol),
    byViolation: toRates(byViolation),
    byGoal: toRates(byGoal),
    totalCases: total,
  };
}

// ═══════════════════════════════════════════════════════════════
// Full Analytics Dashboard
// ═══════════════════════════════════════════════════════════════

export interface FullAnalyticsReport {
  timestamp: string;
  discovery: DiscoveryMetrics;
  macroCount: number;
  topMacros: MacroRepair[];
  errorBudget: { missingPct: number; rankingPct: number; successPct: number };
}

export async function generateFullAnalyticsReport(
  telemetry: PlannerTelemetry
): Promise<FullAnalyticsReport> {
  const attributed = await runFailureAttribution();
  const discovery = computeDiscoveryMetrics(attributed);
  const macros = mineMacroRepairs(telemetry);

  const missing = attributed.filter(a => a.failureReason === "missing_candidate").length;
  const ranking = attributed.filter(a => a.failureReason === "bad_ranking").length;
  const success = attributed.filter(a => a.failureReason === "success").length;
  const total = attributed.length;

  return {
    timestamp: new Date().toISOString(),
    discovery,
    macroCount: macros.length,
    topMacros: macros.slice(0, 5),
    errorBudget: {
      missingPct: total > 0 ? missing / total : 0,
      rankingPct: total > 0 ? ranking / total : 0,
      successPct: total > 0 ? success / total : 0,
    },
  };
}

export function printDiscoveryDashboard(report: FullAnalyticsReport): void {
  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║   Discovery Analytics Dashboard                    ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  console.log(`Timestamp:    ${report.timestamp}`);
  console.log(`Total Cases:  ${report.discovery.totalCases}`);
  console.log();

  // Discovery Rate
  const dr = (report.discovery.overall * 100).toFixed(0);
  console.log(`⭐ Discovery Rate: ${dr}%`);
  console.log();

  // Error Budget
  console.log("─── Error Budget ───");
  console.log(`  Missing Candidate: ${(report.errorBudget.missingPct*100).toFixed(0)}%`);
  console.log(`  Bad Ranking:       ${(report.errorBudget.rankingPct*100).toFixed(0)}%`);
  console.log(`  Success:           ${(report.errorBudget.successPct*100).toFixed(0)}%`);
  console.log();

  // By Protocol
  console.log("─── Discovery by Protocol ───");
  for (const [proto, rate] of Object.entries(report.discovery.byProtocol).sort((a, b) => b[1] - a[1])) {
    const pct = (rate * 100).toFixed(0).padStart(3);
    const bar = "█".repeat(Math.round(rate * 20));
    console.log(`  ${proto.padEnd(16)} ${pct}% ${bar}`);
  }
  console.log();

  // By Violation
  console.log("─── Discovery by Violation ───");
  for (const [viol, rate] of Object.entries(report.discovery.byViolation).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${viol.padEnd(22)} ${(rate*100).toFixed(0)}%`);
  }
  console.log();

  // Macros
  if (report.topMacros.length > 0) {
    console.log("─── Top Macros ───");
    for (const m of report.topMacros) {
      console.log(`  ${m.actions.join(" → ")}  (accept: ${(m.acceptanceRate*100).toFixed(0)}%, freq: ${m.frequency})`);
    }
    console.log(`  Total macros mined: ${report.macroCount}`);
    console.log();
  }
}
