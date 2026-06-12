/**
 * P3.11-13: Pairwise Preference System
 *
 * Upgrades from pointwise (accepted/rejected) to pairwise (A > B)
 * preference data — the primitive format for RLHF.
 *
 * P3.11: RepairPreference data structure + collection
 * P3.12: Enhanced benchmark with acceptableTop3 + unacceptableRepairs
 * P3.13: PreferenceRanker using pairwise win rates
 *
 * Key insight: Top-3 (37%) vs Top-1 (12%) gap = 25%.
 * Correct answers are in the candidate pool but ranked wrong.
 * Pairwise preference is how we fix this.
 */

import * as fs from "fs";
import * as path from "path";
import { candidateFingerprint } from "./planner-telemetry";
import { createLinearRanker, extractFeatures } from "./repair-ranker";
import type { RepairCandidate, CandidateFeatures } from "./repair-types";

// ═══════════════════════════════════════════════════════════════
// P3.11: Pairwise Preference
// ═══════════════════════════════════════════════════════════════

export interface RepairPreference {
  /** Fingerprint of the winning candidate. */
  winner: string;
  /** Fingerprint of the losing candidate. */
  loser: string;
  /** Goal context. */
  goal: string;
  /** Protocol namespace. */
  protocol: string;
  /** When the preference was recorded. */
  timestamp: number;
}

export interface PreferenceStore {
  preferences: RepairPreference[];
  /** Win count by fingerprint. */
  winCounts: Map<string, number>;
  /** Total comparison count by fingerprint. */
  comparisonCounts: Map<string, number>;
}

export function createPreferenceStore(): PreferenceStore {
  return {
    preferences: [],
    winCounts: new Map(),
    comparisonCounts: new Map(),
  };
}

/** Record a pairwise preference: winner > loser. */
export function recordPreference(
  store: PreferenceStore,
  winner: string,
  loser: string,
  goal: string,
  protocol: string
): void {
  const pref: RepairPreference = { winner, loser, goal, protocol, timestamp: Date.now() };
  store.preferences.push(pref);

  store.winCounts.set(winner, (store.winCounts.get(winner) || 0) + 1);
  store.comparisonCounts.set(winner, (store.comparisonCounts.get(winner) || 0) + 1);
  store.comparisonCounts.set(loser, (store.comparisonCounts.get(loser) || 0) + 1);
}

/** Win rate: wins / total comparisons. Default 0.5 for unknowns. */
export function getWinRate(store: PreferenceStore, fingerprint: string, minComparisons: number = 3): number {
  const wins = store.winCounts.get(fingerprint) || 0;
  const total = store.comparisonCounts.get(fingerprint) || 0;
  if (total < minComparisons) return 0.5;
  return wins / total;
}

/** Persist preferences to disk. */
export function savePreferences(store: PreferenceStore, dir?: string): void {
  const outDir = dir || path.resolve(process.cwd(), ".progmune_corpus", "preferences");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `prefs-${new Date().toISOString().slice(0, 10)}.json`),
    JSON.stringify(store.preferences, null, 2)
  );
}

// ═══════════════════════════════════════════════════════════════
// P3.12: Enhanced Benchmark (Ranker Stress Test)
// ═══════════════════════════════════════════════════════════════

export interface RankerBenchmarkCase {
  goal: string;
  protocol: string;
  /** Actions that MUST appear in the top-1 result. */
  expectedTop1: string[];
  /** Actions that are acceptable in the top-3. */
  acceptableTop3: string[][];
  /** Actions that must NOT appear in any result. */
  unacceptableRepairs: string[][];
  violationType: string;
}

export interface RankerStressResult {
  goal: string;
  top1Correct: boolean;
  top3Coverage: number;     // how many acceptable patterns appeared in top-3
  unacceptableFound: boolean; // were any unacceptable repairs returned?
  totalCandidates: number;
  preferenceRankerWinRate: number; // if PreferenceRanker was used
}

export interface RankerStressReport {
  cases: number;
  top1Accuracy: number;      // expectedTop1 was rank 1
  top3Acceptability: number; // all acceptableTop3 patterns found in top 3
  unacceptableFiltered: number; // unacceptable repairs were filtered out
  avgCandidates: number;
}

/**
 * Run a stress test: how well does the ranker distinguish
 * acceptable repairs from unacceptable ones?
 */
export function runRankerStressTest(
  cases: RankerBenchmarkCase[],
  candidateGenerator: (goal: string, protocol: string) => RepairCandidate[],
  ranker?: (candidates: RepairCandidate[], features: CandidateFeatures[]) => RepairCandidate[]
): RankerStressReport {
  const results: RankerStressResult[] = [];

  for (const tc of cases) {
    const candidates = candidateGenerator(tc.goal, tc.protocol);

    let ranked = candidates;
    if (ranker) {
      const ctx = { protocol: tc.protocol, currentState: [], targetState: [], violationType: tc.violationType, constraints: [], rules: new Map() };
      const features = candidates.map(c => extractFeatures(c, ctx));
      ranked = ranker(candidates, features);
    }

    const top1 = ranked[0];
    const top3 = ranked.slice(0, 3);

    const top1Correct = top1
      ? tc.expectedTop1.every(fn => top1.actions.some(a => a.kind === "call" && (a as any).function === fn))
      : false;

    // Count acceptable patterns in top 3
    let acceptableFound = 0;
    for (const pattern of tc.acceptableTop3) {
      const found = top3.some(c =>
        pattern.every(fn => c.actions.some(a => a.kind === "call" && (a as any).function === fn))
      );
      if (found) acceptableFound++;
    }
    const top3Coverage = tc.acceptableTop3.length > 0 ? acceptableFound / tc.acceptableTop3.length : 0;

    // Check for unacceptable repairs
    const unacceptableFound = tc.unacceptableRepairs.some(pattern =>
      ranked.some(c =>
        pattern.every(fn => c.actions.some(a => a.kind === "call" && (a as any).function === fn))
      )
    );

    results.push({
      goal: tc.goal,
      top1Correct,
      top3Coverage,
      unacceptableFound,
      totalCandidates: candidates.length,
      preferenceRankerWinRate: 0,
    });
  }

  return {
    cases: cases.length,
    top1Accuracy: results.filter(r => r.top1Correct).length / Math.max(1, cases.length),
    top3Acceptability: results.reduce((s, r) => s + r.top3Coverage, 0) / Math.max(1, cases.length),
    unacceptableFiltered: results.filter(r => !r.unacceptableFound).length / Math.max(1, cases.length),
    avgCandidates: results.reduce((s, r) => s + r.totalCandidates, 0) / Math.max(1, cases.length),
  };
}

export function printRankerStressReport(report: RankerStressReport): void {
  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║   Ranker Stress Test Report                        ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  console.log(`Cases:                 ${report.cases}`);
  console.log(`Top-1 Accuracy:        ${(report.top1Accuracy * 100).toFixed(0)}%`);
  console.log(`Top-3 Acceptability:   ${(report.top3Acceptability * 100).toFixed(0)}%`);
  console.log(`Unacceptable Filtered: ${(report.unacceptableFiltered * 100).toFixed(0)}%`);
  console.log(`Avg Candidates:        ${report.avgCandidates.toFixed(1)}`);

  const top3Top1Gap = report.top3Acceptability - report.top1Accuracy;
  console.log(`\n  Top-3/Top-1 Gap:    ${(top3Top1Gap * 100).toFixed(0)}%`);
  if (top3Top1Gap > 0.2) {
    console.log("  ⚠️  Large gap: candidates found but ranked wrong. Priority = ranking.");
  } else {
    console.log("  ✅ Small gap: ranking is working well.");
  }
  console.log();
}

// ═══════════════════════════════════════════════════════════════
// P3.13: Preference Ranker
// ═══════════════════════════════════════════════════════════════

/**
 * PreferenceRanker: ranks candidates by pairwise win rate.
 *
 * Given historical preference data (A > B, B > C, ...),
 * computes Elo-like scores from pairwise comparisons.
 *
 *   score = winRate * 0.6 + heuristicScore * 0.4
 *
 * Where winRate comes from the preference store and
 * heuristicScore comes from the base LinearRanker.
 */
export class PreferenceRanker {
  private store: PreferenceStore;
  private minComparisons: number;

  constructor(store?: PreferenceStore, minComparisons: number = 3) {
    this.store = store || createPreferenceStore();
    this.minComparisons = minComparisons;
  }

  /** Get the pairwise win rate for a candidate's fingerprint. */
  winRate(candidate: RepairCandidate, protocol: string, violationType?: string): number {
    const actions = candidate.actions
      .filter(a => a.kind === "call")
      .map(a => (a as { function: string }).function);
    const fp = candidateFingerprint(protocol, actions, violationType);
    return getWinRate(this.store, fp, this.minComparisons);
  }

  /**
   * Rank candidates by combining pairwise win rate with heuristic score.
   *
   *   score = winRate * 0.6 + heuristicScore * 0.4
   *
   * Where heuristicScore comes from LinearRanker (protocolSafety, performance, etc.)
   * and winRate comes from historical pairwise preferences.
   */
  rank(
    candidates: RepairCandidate[],
    features: CandidateFeatures[],
    protocol: string,
    violationType?: string
  ): RepairCandidate[] {
    const baseRanker = createLinearRanker();
    const heuristicScores = features.map(f => baseRanker.score(f));

    const scored = candidates.map((c, i) => ({
      candidate: c,
      score:
        this.winRate(c, protocol, violationType) * 0.6 +
        heuristicScores[i] * 0.4,
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.candidate);
  }

  get preferences(): RepairPreference[] {
    return this.store.preferences;
  }
}

// ═══════════════════════════════════════════════════════════════
// Pairwise Preference Benchmarks
// ═══════════════════════════════════════════════════════════════

/** Pre-built pairwise benchmark cases for ranker stress testing. */
export const PAIRWISE_BENCHMARK_CASES: RankerBenchmarkCase[] = [
  {
    goal: "safely write config file",
    protocol: "FileProtocol",
    expectedTop1: ["open_file", "write_file", "close_file"],
    acceptableTop3: [
      ["open_file", "write_file", "close_file"],
      ["open_file", "write_file", "flush", "close_file"],
    ],
    unacceptableRepairs: [
      ["write_file"],           // skip open
      ["open_file", "write_file"], // missing close
    ],
    violationType: "resource_leak",
  },
  {
    goal: "authenticate user",
    protocol: "AuthProtocol",
    expectedTop1: ["verify_password", "generate_jwt", "create_session"],
    acceptableTop3: [
      ["verify_password", "generate_jwt", "create_session"],
      ["verify_password", "generate_jwt"],
    ],
    unacceptableRepairs: [
      ["generate_jwt"],                      // skip verify
      ["create_session"],                    // skip verify+jwt
      ["logout"],                            // wrong direction
    ],
    violationType: "missing_prerequisite",
  },
  {
    goal: "logout user",
    protocol: "AuthProtocol",
    expectedTop1: ["verify_password", "generate_jwt", "create_session", "logout"],
    acceptableTop3: [
      ["verify_password", "generate_jwt", "create_session", "logout"],
    ],
    unacceptableRepairs: [
      ["logout"],  // skip prerequisites entirely
    ],
    violationType: "illegal_state_transition",
  },
  {
    goal: "query database safely",
    protocol: "DBProtocol",
    expectedTop1: ["connect_db", "query_db", "disconnect_db"],
    acceptableTop3: [
      ["connect_db", "query_db", "disconnect_db"],
    ],
    unacceptableRepairs: [
      ["query_db"],              // no connection
      ["connect_db", "query_db"], // missing disconnect
    ],
    violationType: "missing_prerequisite",
  },
  {
    goal: "extract IR and validate",
    protocol: "IRProtocol",
    expectedTop1: ["extractIR", "validateAction"],
    acceptableTop3: [
      ["extractIR", "validateAction"],
      ["extractIR", "validateAction", "validateActionSequence"],
    ],
    unacceptableRepairs: [
      ["validateAction"],        // skip extract
      ["emitCode"],              // skip entire pipeline
    ],
    violationType: "missing_prerequisite",
  },
  {
    goal: "full IR pipeline",
    protocol: "IRProtocol",
    expectedTop1: ["extractIR", "validateAction", "validateActionSequence", "emitCode", "recordSession"],
    acceptableTop3: [
      ["extractIR", "validateAction", "validateActionSequence", "emitCode", "recordSession"],
      ["extractIR", "validateAction", "validateActionSequence", "emitCode"],
    ],
    unacceptableRepairs: [
      ["extractIR", "emitCode"], // skip validation
      ["recordSession"],         // skip everything
    ],
    violationType: "missing_prerequisite",
  },
];
