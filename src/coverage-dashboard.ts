/**
 * P3.6: Coverage Dashboard
 *
 * Visualizes protocol coverage gaps, ranks protocols by risk,
 * and generates acquisition priorities.
 *
 * The dashboard answers:
 *   - Which protocols are fully observed? Which are data-poor?
 *   - Where should we collect more data next?
 *   - What transitions should we benchmark first?
 */

import {
  analyzeAllCoverage, loadDefaultProtocolDefinitions,
  CoverageReport, ProtocolDefinition,
} from "./protocol-coverage";
import type { TrajectoryRecord } from "./runtime-types";
import { loadTrajectories } from "./failure-corpus";

// ═══════════════════════════════════════════════════════════════
// Risk ranking
// ═══════════════════════════════════════════════════════════════

export interface ProtocolRisk {
  protocol: string;
  stateCoverage: number;
  transitionCoverage: number;
  trajectoryCount: number;
  risk: "critical" | "high" | "medium" | "low";
  missingTransitionCount: number;
  recommendation: string;
}

export function assessRisk(report: CoverageReport): ProtocolRisk {
  const sc = report.stateCoverage.stateCoverage;
  const tc = report.transitionCoverage.transitionCoverage;
  const avg = (sc + tc) / 2;

  let risk: ProtocolRisk["risk"];
  let recommendation: string;

  if (avg < 0.25) {
    risk = "critical";
    recommendation = `Immediate: add ${report.transitionCoverage.missingTransitions.length} benchmark cases for uncovered transitions`;
  } else if (avg < 0.50) {
    risk = "high";
    recommendation = `Priority: focus on missing ${report.stateCoverage.missingStates.length} states and ${report.transitionCoverage.missingTransitions.length} transitions`;
  } else if (avg < 0.75) {
    risk = "medium";
    recommendation = `Fill remaining gaps: ${report.transitionCoverage.missingTransitions.length} transitions uncovered`;
  } else {
    risk = "low";
    recommendation = "Well-covered. Monitor for regressions.";
  }

  return {
    protocol: report.protocol,
    stateCoverage: sc,
    transitionCoverage: tc,
    trajectoryCount: report.trajectoryCount,
    risk,
    missingTransitionCount: report.transitionCoverage.missingTransitions.length,
    recommendation,
  };
}

// ═══════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════

export interface CoverageDashboard {
  reports: CoverageReport[];
  riskRanking: ProtocolRisk[];
  overallStateCoverage: number;
  overallTransitionCoverage: number;
  totalTrajectories: number;
  criticalProtocols: number;
}

export function generateCoverageDashboard(trajectories?: TrajectoryRecord[]): CoverageDashboard {
  const trajs = trajectories || loadTrajectories();
  const protocols = loadDefaultProtocolDefinitions();
  const reports = analyzeAllCoverage(protocols, trajs);

  const risks = reports.map(assessRisk).sort((a, b) => a.transitionCoverage - b.transitionCoverage);

  const totalStates = reports.reduce((s, r) => s + r.stateCoverage.totalStates, 0);
  const visitedStates = reports.reduce((s, r) => s + r.stateCoverage.visitedStates, 0);
  const totalTrans = reports.reduce((s, r) => s + r.transitionCoverage.totalTransitions, 0);
  const visitedTrans = reports.reduce((s, r) => s + r.transitionCoverage.visitedTransitions, 0);

  return {
    reports,
    riskRanking: risks,
    overallStateCoverage: totalStates > 0 ? visitedStates / totalStates : 0,
    overallTransitionCoverage: totalTrans > 0 ? visitedTrans / totalTrans : 0,
    totalTrajectories: trajs.length,
    criticalProtocols: risks.filter(r => r.risk === "critical" || r.risk === "high").length,
  };
}

export function printCoverageDashboard(dashboard: CoverageDashboard): void {
  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║   Protocol Coverage Dashboard                      ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  console.log(`Trajectories Analyzed: ${dashboard.totalTrajectories}`);
  console.log(`Overall State Coverage:      ${(dashboard.overallStateCoverage * 100).toFixed(0)}%`);
  console.log(`Overall Transition Coverage: ${(dashboard.overallTransitionCoverage * 100).toFixed(0)}%`);
  console.log(`Critical/High Risk Protocols: ${dashboard.criticalProtocols}\n`);

  console.log("─── By Protocol ───");
  console.log("Protocol          State   Trans   Trajs  Risk");
  console.log("────────────────────────────────────────────────");

  for (const r of dashboard.riskRanking) {
    const riskIcon = r.risk === "critical" ? "🔴" : r.risk === "high" ? "🟠" : r.risk === "medium" ? "🟡" : "🟢";
    const sc = (r.stateCoverage * 100).toFixed(0).padStart(3);
    const tc = (r.transitionCoverage * 100).toFixed(0).padStart(3);
    console.log(`  ${r.protocol.padEnd(16)} ${sc}%   ${tc}%   ${String(r.trajectoryCount).padStart(4)}  ${riskIcon} ${r.risk}`);
  }
  console.log();

  // Missing transitions detail for high-risk protocols
  const criticalReports = dashboard.reports.filter(
    r => assessRisk(r).risk === "critical" || assessRisk(r).risk === "high"
  );
  if (criticalReports.length > 0) {
    console.log("─── Highest Risk: Missing Transitions ───");
    for (const r of criticalReports) {
      const missing = r.transitionCoverage.missingTransitions.slice(0, 5);
      if (missing.length === 0) continue;
      console.log(`\n  ${r.protocol} (${r.transitionCoverage.missingTransitions.length} missing):`);
      for (const m of missing) {
        console.log(`    ${m.from} → ${m.to}  (via ${m.rule})`);
      }
    }
    console.log();
  }

  console.log("─── Recommendations ───");
  for (const r of dashboard.riskRanking) {
    if (r.risk === "critical" || r.risk === "high") {
      console.log(`  ${r.protocol}: ${r.recommendation}`);
    }
  }
  console.log();
}
