/**
 * P2.5: Repair Acceptance Dashboard
 *
 * Queries the telemetry layer to produce structured reports
 * on which strategies, protocols, goals, and repair patterns
 * perform best. This is the feedback loop that powers P4 Reward Model.
 *
 * Usage:
 *   import { printDashboard } from "./analytics";
 *   printDashboard(telemetry);
 */

import { PlannerTelemetry } from "./planner-telemetry";
import type { RepairCandidate } from "./repair-types";

// ═══════════════════════════════════════════════════════════════
// Strategy Stats
// ═══════════════════════════════════════════════════════════════

export interface StrategyStats {
  strategy: string;
  total: number;
  accepted: number;
  rate: number;
}

export function getStrategyStats(telemetry: PlannerTelemetry): StrategyStats[] {
  const bySource = telemetry.getAcceptanceBySource();
  return Object.entries(bySource)
    .map(([strategy, s]) => ({
      strategy,
      total: s.total,
      accepted: s.accepted,
      rate: s.rate,
    }))
    .sort((a, b) => b.rate - a.rate);
}

// ═══════════════════════════════════════════════════════════════
// Protocol Stats
// ═══════════════════════════════════════════════════════════════

export interface ProtocolStats {
  protocol: string;
  total: number;
  accepted: number;
  rate: number;
}

export function getProtocolStats(telemetry: PlannerTelemetry): ProtocolStats[] {
  const byProtocol = telemetry.getAcceptanceByProtocol();
  return Object.entries(byProtocol)
    .map(([protocol, s]) => ({
      protocol,
      total: s.total,
      accepted: s.accepted,
      rate: s.rate,
    }))
    .sort((a, b) => b.rate - a.rate);
}

// ═══════════════════════════════════════════════════════════════
// Goal Stats
// ═══════════════════════════════════════════════════════════════

export interface GoalStats {
  goal: string;
  total: number;
  accepted: number;
  rate: number;
}

export function getGoalStats(telemetry: PlannerTelemetry): GoalStats[] {
  const byGoal = telemetry.getAcceptanceByGoal();
  return Object.entries(byGoal)
    .map(([goal, s]) => ({
      goal,
      total: s.total,
      accepted: s.accepted,
      rate: s.rate,
    }))
    .sort((a, b) => b.rate - a.rate);
}

// ═══════════════════════════════════════════════════════════════
// Top Repairs
// ═══════════════════════════════════════════════════════════════

export interface TopRepair {
  actions: string;
  count: number;
  goal: string;
  rate: number;
}

export function getTopAcceptedRepairs(telemetry: PlannerTelemetry, k?: number): TopRepair[] {
  return telemetry.getTopAcceptedRepairs(k);
}

export function getTopRejectedRepairs(telemetry: PlannerTelemetry, k?: number): TopRepair[] {
  return telemetry.getTopRejectedRepairs(k);
}

// ═══════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════

export interface DashboardReport {
  summary: {
    totalDecisions: number;
    withFeedback: number;
    overallAcceptanceRate: number;
    /** Repair Adoption Rate — users accepted / (accepted + rejected). */
    adoptionRate: number;
    accepted: number;
    rejected: number;
    modified: number;
  };
  byStrategy: StrategyStats[];
  byProtocol: ProtocolStats[];
  topAccepted: TopRepair[];
  topRejected: TopRepair[];
}

export function generateDashboard(telemetry: PlannerTelemetry): DashboardReport {
  const summary = telemetry.getSummaryStats();
  return {
    summary: {
      totalDecisions: telemetry.size,
      withFeedback: telemetry.withFeedback,
      overallAcceptanceRate: telemetry.getAcceptanceRate(),
      adoptionRate: getRepairAdoptionRate(telemetry),
      accepted: summary.accepted,
      rejected: summary.rejected,
      modified: summary.modified,
    },
    byStrategy: getStrategyStats(telemetry),
    byProtocol: getProtocolStats(telemetry),
    topAccepted: getTopAcceptedRepairs(telemetry, 5),
    topRejected: getTopRejectedRepairs(telemetry, 5),
  };
}

/**
 * Repair Adoption Rate — the most important KPI.
 *
 * "Of all repairs the planner proposed, how many did the user actually accept?"
 * This matters more than Top-1 accuracy because users don't care
 * what the algorithm thinks is right — they care what they're willing to use.
 */
export function getRepairAdoptionRate(telemetry: PlannerTelemetry): number {
  const summary = telemetry.getSummaryStats();
  const total = summary.accepted + summary.rejected;
  if (total === 0) return 0;
  return summary.accepted / total;
}

/**
 * Print a human-readable acceptance dashboard to stdout.
 */
export function printDashboard(telemetry: PlannerTelemetry): void {
  const report = generateDashboard(telemetry);

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║   Repair Acceptance Dashboard            ║");
  console.log("╚══════════════════════════════════════════╝\n");

  console.log(`Total Decisions:     ${report.summary.totalDecisions}`);
  console.log(`With Feedback:       ${report.summary.withFeedback}`);
  console.log(`Acceptance Rate:     ${(report.summary.overallAcceptanceRate * 100).toFixed(1)}%`);
  console.log(`Repair Adoption:     ${(report.summary.adoptionRate * 100).toFixed(1)}%  (${report.summary.accepted} accepted / ${report.summary.rejected} rejected / ${report.summary.modified} modified)\n`);

  if (report.byStrategy.length > 0) {
    console.log("─── By Strategy ───");
    console.log("Strategy          Acceptance");
    console.log("──────────────────────────────");
    for (const s of report.byStrategy) {
      const pct = (s.rate * 100).toFixed(0).padStart(3);
      console.log(`  ${s.strategy.padEnd(16)} ${pct}%  (${s.accepted}/${s.total})`);
    }
    console.log();
  }

  if (report.byProtocol.length > 0) {
    console.log("─── By Protocol ───");
    console.log("Protocol          Acceptance");
    console.log("──────────────────────────────");
    for (const p of report.byProtocol) {
      const pct = (p.rate * 100).toFixed(0).padStart(3);
      console.log(`  ${p.protocol.padEnd(16)} ${pct}%  (${p.accepted}/${p.total})`);
    }
    console.log();
  }

  if (report.topAccepted.length > 0) {
    console.log("─── Top Accepted Repairs ───");
    for (const r of report.topAccepted) {
      console.log(`  ${r.actions}`);
      console.log(`    goal: ${r.goal} | count: ${r.count} | rate: ${(r.rate * 100).toFixed(0)}%\n`);
    }
  }

  if (report.topRejected.length > 0) {
    console.log("─── Top Rejected Repairs ───");
    for (const r of report.topRejected) {
      console.log(`  ${r.actions}`);
      console.log(`    goal: ${r.goal} | count: ${r.count} | rate: ${(r.rate * 100).toFixed(0)}%\n`);
    }
  }
}
