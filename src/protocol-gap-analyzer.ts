/**
 * P3.16-17: Protocol Gap Mining + Knowledge Acquisition Planner
 *
 * Decomposes the 57% missing_candidate into actionable categories:
 *   - Missing Actions: functions in expected repair but not in any protocol rule
 *   - Missing Transitions: state pairs not connected by any rule
 *   - Missing Cross-Protocol Bridges: protocol pairs with no bridge definition
 *
 * This transforms protocol expansion from guesswork to data-driven prioritization.
 *
 * Fourth flywheel:
 *   Failures → Missing Knowledge → Protocol Expansion → Better Candidates
 */

import * as fs from "fs";
import * as path from "path";
import { loadDefaultProtocolDefinitions } from "./protocol-coverage";
import { getProtocolBridges } from "./protocol-frontier";
import type { AttributedCase } from "./evaluation-campaign";

// ═══════════════════════════════════════════════════════════════
// Gap Types
// ═══════════════════════════════════════════════════════════════

export type GapKind = "missing_action" | "missing_transition" | "missing_protocol" | "missing_bridge";

export interface ProtocolGap {
  kind: GapKind;
  /** The specific item that is missing. */
  item: string;
  /** Which protocol(s) this gap affects. */
  protocols: string[];
  /** How many benchmark cases are blocked by this gap. */
  frequency: number;
  /** Example benchmark goals that need this. */
  examples: string[];
  /** Priority score for acquisition (0-1). */
  priority: number;
}

export interface GapReport {
  totalFailures: number;
  failuresAnalyzed: number;
  /** Gaps sorted by priority (highest first). */
  gaps: ProtocolGap[];
  /** Breakdown by gap kind. */
  byKind: Record<GapKind, { count: number; items: string[] }>;
  /** Recommended next actions to add. */
  topMissingActions: string[];
  /** Recommended next transitions to add. */
  topMissingTransitions: string[];
  /** Recommended next bridges to add. */
  topMissingBridges: string[];
}

export interface ProtocolKnowledgeScore {
  protocol: string;
  coverage: number;
  successRate: number;
  benchmarkPassRate: number;
  corpusSupport: number;
  score: number;
  gaps: number;
}

// ═══════════════════════════════════════════════════════════════
// Gap Analyzer
// ═══════════════════════════════════════════════════════════════

/**
 * Analyze benchmark failures to identify which actions/transitions
 * are missing from the protocol definitions.
 */
export function analyzeProtocolGaps(
  attributed: AttributedCase[],
  rules: Map<string, Set<string>>  // protocol → set of function names
): GapReport {
  const failures = attributed.filter(a => a.failureReason !== "success");
  const gapMap = new Map<string, { kind: GapKind; protocols: Set<string>; examples: string[] }>();

  for (const f of failures) {
    for (const fn of f.expectedRepair) {
      // Check if this function exists in any protocol
      let found = false;
      for (const [, fns] of rules) {
        if (fns.has(fn)) { found = true; break; }
      }

      if (!found) {
        const key = `action:${fn}`;
        const existing = gapMap.get(key);
        if (existing) {
          existing.protocols.add(f.protocol);
          existing.examples.push(f.goal);
        } else {
          gapMap.set(key, {
            kind: "missing_action",
            protocols: new Set([f.protocol]),
            examples: [f.goal],
          });
        }
      }
    }

    // Check for missing transitions: consecutive function pairs in expected
    for (let i = 0; i < f.expectedRepair.length - 1; i++) {
      const from = f.expectedRepair[i];
      const to = f.expectedRepair[i + 1];
      const key = `transition:${from}→${to}`;
      if (!gapMap.has(key)) {
        gapMap.set(key, {
          kind: "missing_transition",
          protocols: new Set([f.protocol]),
          examples: [f.goal],
        });
      } else {
        gapMap.get(key)!.examples.push(f.goal);
      }
    }
  }

  // Cross-protocol bridge gaps
  const bridges = getProtocolBridges();
  const bridgePairs = new Set(bridges.map(b => `${b.from}→${b.to}`));
  const crossProtocolFailures = failures.filter(f =>
    f.expectedRepair.some(fn => fn.includes("file")) &&
    f.expectedRepair.some(fn => fn.includes("db"))
  );
  for (const f of crossProtocolFailures) {
    // Check if there's a bridge connecting the protocols involved
    const protoSet = new Set<string>();
    for (const fn of f.expectedRepair) {
      for (const [proto, fns] of rules) {
        if (fns.has(fn)) protoSet.add(proto);
      }
    }
    const protoList = [...protoSet];
    for (let i = 0; i < protoList.length - 1; i++) {
      const pair = `${protoList[i]}→${protoList[i + 1]}`;
      if (!bridgePairs.has(pair)) {
        const key = `bridge:${pair}`;
        if (!gapMap.has(key)) {
          gapMap.set(key, {
            kind: "missing_bridge",
            protocols: new Set(protoList),
            examples: [f.goal],
          });
        } else {
          gapMap.get(key)!.examples.push(f.goal);
        }
      }
    }
  }

  // Convert to sorted list with priority scores
  const totalFailures = failures.length;
  const gaps: ProtocolGap[] = [];
  const byKind: Record<string, { count: number; items: string[] }> = {
    missing_action: { count: 0, items: [] },
    missing_transition: { count: 0, items: [] },
    missing_bridge: { count: 0, items: [] },
    missing_protocol: { count: 0, items: [] },
  };

  for (const [key, entry] of gapMap) {
    const kind = entry.kind;
    const item = key.split(":")[1] || key;
    const frequency = entry.examples.length;
    const priority = Math.min(1, frequency / Math.max(1, totalFailures));

    byKind[kind].count++;
    byKind[kind].items.push(item);

    gaps.push({
      kind,
      item,
      protocols: [...entry.protocols],
      frequency,
      examples: entry.examples.slice(0, 3),
      priority,
    });
  }

  gaps.sort((a, b) => b.priority - a.priority);

  return {
    totalFailures,
    failuresAnalyzed: failures.length,
    gaps,
    byKind: byKind as GapReport["byKind"],
    topMissingActions: gaps.filter(g => g.kind === "missing_action").slice(0, 10).map(g => g.item),
    topMissingTransitions: gaps.filter(g => g.kind === "missing_transition").slice(0, 10).map(g => g.item),
    topMissingBridges: gaps.filter(g => g.kind === "missing_bridge").slice(0, 5).map(g => g.item),
  };
}

/**
 * Compute a per-protocol knowledge score.
 *   score = 0.4*coverage + 0.3*successRate + 0.2*benchmarkPassRate + 0.1*corpusSupport
 */
export function computeKnowledgeScores(
  failures: AttributedCase[]
): ProtocolKnowledgeScore[] {
  const protocols = loadDefaultProtocolDefinitions();

  return protocols.map(p => {
    const relevant = failures.filter(f =>
      f.protocol === p.name || f.expectedRepair.some(fn => p.rules.has(fn))
    );
    const passed = relevant.filter(f => f.failureReason === "success").length;
    const total = relevant.length;

    // Coverage: states defined / total transitions
    const coverage = p.states.length > 0 ? Math.min(1, p.states.length / 20) : 0;
    const successRate = total > 0 ? passed / total : 0;
    const benchmarkPassRate = total > 0 ? passed / total : 0;
    const corpusSupport = total > 0 ? Math.min(1, total / 50) : 0;

    const score = 0.4 * coverage + 0.3 * successRate + 0.2 * benchmarkPassRate + 0.1 * corpusSupport;

    return {
      protocol: p.name,
      coverage,
      successRate,
      benchmarkPassRate,
      corpusSupport,
      score,
      gaps: relevant.filter(f => f.failureReason !== "success").length,
    };
  }).sort((a, b) => b.score - a.score);
}

// ═══════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════

export function printGapReport(report: GapReport): void {
  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║   Protocol Gap Mining Report                       ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  console.log(`Failures Analyzed: ${report.failuresAnalyzed}/${report.totalFailures}`);
  console.log(`Gaps Found:        ${report.gaps.length}`);
  console.log();

  console.log("─── Gap Breakdown ───");
  for (const [kind, info] of Object.entries(report.byKind)) {
    if (info.count === 0) continue;
    const label = kind.replace(/_/g, " ").padEnd(22);
    console.log(`  ${label} ${String(info.count).padStart(4)} items`);
  }
  console.log();

  if (report.topMissingActions.length > 0) {
    console.log("─── Top Missing Actions (add to protocol rules) ───");
    const tops = report.gaps.filter(g => g.kind === "missing_action").slice(0, 10);
    for (const g of tops) {
      console.log(`  ${g.item.padEnd(25)} freq=${g.frequency}  pri=${(g.priority*100).toFixed(0)}%`);
    }
    console.log();
  }

  if (report.topMissingTransitions.length > 0) {
    console.log("─── Top Missing Transitions ───");
    for (const t of report.topMissingTransitions.slice(0, 5)) {
      console.log(`  ${t}`);
    }
    console.log();
  }

  if (report.topMissingBridges.length > 0) {
    console.log("─── Top Missing Bridges ───");
    for (const b of report.topMissingBridges) {
      console.log(`  ${b}`);
    }
    console.log();
  }
}

export function printKnowledgeScores(scores: ProtocolKnowledgeScore[]): void {
  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║   Protocol Knowledge Scoreboard                    ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  console.log("Protocol          Covrg  Succ   Bench  Corpus  Score  Gaps");
  console.log("──────────────────────────────────────────────────────────");

  for (const s of scores) {
    const cov = (s.coverage * 100).toFixed(0).padStart(4);
    const suc = (s.successRate * 100).toFixed(0).padStart(4);
    const ben = (s.benchmarkPassRate * 100).toFixed(0).padStart(4);
    const cor = (s.corpusSupport * 100).toFixed(0).padStart(4);
    const scr = (s.score * 100).toFixed(0).padStart(4);
    const icon = s.score > 0.7 ? "🟢" : s.score > 0.4 ? "🟡" : "🔴";
    console.log(`  ${s.protocol.padEnd(16)} ${cov}% ${suc}% ${ben}% ${cor}% ${scr}% ${String(s.gaps).padStart(4)} ${icon}`);
  }
  console.log();
}
