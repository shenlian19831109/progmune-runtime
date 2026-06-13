/**
 * P7.1: Name Scrambling — The Decisive Structure Learning Test
 *
 * Replaces all function names with random opaque IDs (F_001, F_172).
 * Only call-graph topology remains. If cross-repo similarity survives
 * without any semantic naming, the system genuinely learns protocol
 * STRUCTURE, not API vocabulary.
 *
 * Three experiments:
 *   1. Name Scrambling: IDs only, topology preserved
 *   2. Topology Scrambling: names preserved, order shuffled
 *   3. Combined: both scrambled
 *
 * Verdict thresholds:
 *   >70% similarity after name scrambling → STRUCTURE LEARNED
 *   <10% similarity after name scrambling → VERB LEARNING
 *   10-70%                                 → PARTIAL
 */

import { compareRepoPhysics, analyzeRepoPhysics, KNOWN_REPO_SIGNATURES } from "./software-physics";
import { clusterByStructure, evaluateUnsupervisedDiscovery, CROSS_REPO_SEQUENCES } from "./unsupervised-physics";
import { runFamilyIsolation, PROTOCOL_FAMILIES } from "./generalization.test";
import { normalizeFunctionName } from "./function-synonyms";

// ═══════════════════════════════════════════════════════════════
// Name Scrambling
// ═══════════════════════════════════════════════════════════════

let _scrambleMap = new Map<string, string>();
let _scrambleCounter = 0;

function resetScrambler(): void {
  _scrambleMap = new Map();
  _scrambleCounter = 0;
}

/** Replace a function name with an opaque ID. Same input → same output. */
function scrambleName(fn: string): string {
  if (_scrambleMap.has(fn)) return _scrambleMap.get(fn)!;
  const id = `F_${String(_scrambleCounter++).padStart(4, "0")}`;
  _scrambleMap.set(fn, id);
  return id;
}

/** Scramble all function names in a set of sequences. */
function scrambleSequences(sequences: string[][]): string[][] {
  resetScrambler();
  return sequences.map(seq => seq.map(scrambleName));
}

/** Scramble repo signatures, keeping per-repo consistency. */
function scrambleRepoSignatures(repo: string): string[] {
  resetScrambler();
  return (KNOWN_REPO_SIGNATURES[repo] || []).map(scrambleName);
}

// ═══════════════════════════════════════════════════════════════
// Topology Scrambling
// ═══════════════════════════════════════════════════════════════

/** Shuffle the order of sequences within a repo (preserving each sequence's internal order). */
function shuffleSequences(sequences: string[][]): string[][] {
  const shuffled = [...sequences];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// ═══════════════════════════════════════════════════════════════
// Experiments
// ═══════════════════════════════════════════════════════════════

export interface ScramblingReport {
  baseline: number;           // original Redis↔SQLite similarity
  nameScrambled: number;      // similarity with random IDs
  topologyScrambled: number;  // similarity with shuffled order
  bothScrambled: number;      // similarity with both scrambled
  nameSurvivalRate: number;   // nameScrambled / baseline
  topologySurvivalRate: number; // topologyScrambled / baseline
  verdict: "structure_learned" | "verb_learning" | "partial";
}

/**
 * Run the name scrambling experiment.
 *
 * This is THE decisive test: replace all function names with F_001, F_002, etc.
 * and measure whether cross-repo similarity survives.
 */
export function runNameScrambling(): ScramblingReport {
  // Baseline: normal names, normal topology
  const redisOrig = KNOWN_REPO_SIGNATURES["Redis"];
  const sqliteOrig = KNOWN_REPO_SIGNATURES["SQLite"];
  const redisB = analyzeRepoPhysics("Redis", redisOrig);
  const sqliteB = analyzeRepoPhysics("SQLite", sqliteOrig);
  const baseline = compareRepoPhysics(redisB, sqliteB).similarity;

  // Experiment 1: Name scrambling (random IDs, topology preserved)
  resetScrambler();
  const redisScrambled = scrambleRepoSignatures("Redis");
  const sqliteScrambled = scrambleRepoSignatures("SQLite");
  const redisNS = analyzeRepoPhysics("Redis", redisScrambled);
  const sqliteNS = analyzeRepoPhysics("SQLite", sqliteScrambled);
  const nameScrambled = compareRepoPhysics(redisNS, sqliteNS).similarity;

  // Experiment 2: Topology scrambling (names preserved, order shuffled)
  const redisShuffled = shuffleSequences([...CROSS_REPO_SEQUENCES["Redis"]]).flat();
  const sqliteShuffled = shuffleSequences([...CROSS_REPO_SEQUENCES["SQLite"]]).flat();
  // Use unique function names from shuffled sequences
  const redisTS = analyzeRepoPhysics("Redis", [...new Set(redisShuffled)]);
  const sqliteTS = analyzeRepoPhysics("SQLite", [...new Set(sqliteShuffled)]);
  const topologyScrambled = compareRepoPhysics(redisTS, sqliteTS).similarity;

  // Experiment 3: Both scrambled
  resetScrambler();
  const redisBoth = [...new Set(redisShuffled)].map(scrambleName);
  const sqliteBoth = [...new Set(sqliteShuffled)].map(scrambleName);
  const redisBS = analyzeRepoPhysics("Redis", redisBoth);
  const sqliteBS = analyzeRepoPhysics("SQLite", sqliteBoth);
  const bothScrambled = compareRepoPhysics(redisBS, sqliteBS).similarity;

  const nameSurvivalRate = baseline > 0 ? nameScrambled / baseline : 0;
  const topologySurvivalRate = baseline > 0 ? topologyScrambled / baseline : 0;

  const verdict: ScramblingReport["verdict"] =
    nameSurvivalRate > 0.7 ? "structure_learned" :
    nameSurvivalRate < 0.1 ? "verb_learning" :
    "partial";

  return {
    baseline, nameScrambled, topologyScrambled, bothScrambled,
    nameSurvivalRate, topologySurvivalRate, verdict,
  };
}

export function printScramblingReport(report: ScramblingReport): void {
  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║   P7.1 Name Scrambling Experiment                  ║");
  console.log("║   The decisive test: structure or vocabulary?      ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  console.log(`Baseline (normal):           ${(report.baseline * 100).toFixed(0)}%`);
  console.log(`Name Scrambled (F_001 IDs):  ${(report.nameScrambled * 100).toFixed(0)}%`);
  console.log(`Topology Scrambled:          ${(report.topologyScrambled * 100).toFixed(0)}%`);
  console.log(`Both Scrambled:              ${(report.bothScrambled * 100).toFixed(0)}%`);
  console.log();
  console.log(`Name Survival Rate:          ${(report.nameSurvivalRate * 100).toFixed(0)}%`);
  console.log(`Topology Survival Rate:      ${(report.topologySurvivalRate * 100).toFixed(0)}%`);
  console.log();
  console.log(`─── Verdict ───`);
  console.log(`  Classification: ${report.verdict.toUpperCase()}`);
  console.log();

  if (report.verdict === "structure_learned") {
    console.log("  ✅ Similarity SURVIVES name scrambling.");
    console.log("     The system learns protocol TOPOLOGY, not API vocabulary.");
    console.log("     Software Physics is REAL.");
  } else if (report.verdict === "verb_learning") {
    console.log("  ❌ Similarity COLLAPSES without semantic names.");
    console.log("     The system learns open/close/create keywords.");
    console.log("     This is verb learning, not structure learning.");
  } else {
    console.log("  ⚠️  Partial survival. Mixed signal.");
  }
  console.log();
}
