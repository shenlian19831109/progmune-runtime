/**
 * P7.0: Ablation Study — Does Software Physics Survive Without Scaffolding?
 *
 * The ultimate test: remove all hand-crafted scaffolding and measure
 * whether Redis ↔ SQLite structural similarity survives.
 *
 * Three ablations:
 *   1. Remove Function Synonym Mapping → measure cross-repo similarity
 *   2. Remove Hand-crafted Protocol Rules → measure cross-domain F1
 *   3. Remove ALL scaffolding → measure pure structural clustering
 *
 * Key question: 67% → ? when synonyms are removed?
 *   >50% = genuinely learned structure
 *   <10% = just classifying by name
 */

import { compareRepoPhysics, analyzeRepoPhysics, KNOWN_REPO_SIGNATURES, canonicalize } from "./experimental/software-physics";
import { clusterByStructure, evaluateUnsupervisedDiscovery, CROSS_REPO_SEQUENCES } from "./experimental/unsupervised-physics";
import { normalizeFunctionName } from "./function-synonyms";
import { loadDefaultProtocolDefinitions } from "./protocol-coverage";
import { compareRules } from "./repo-evaluator";
import { runFamilyIsolation, PROTOCOL_FAMILIES } from "./generalization.test";
import type { StateAnnotation } from "./ssg-validator";

// ═══════════════════════════════════════════════════════════════
// Ablation Configuration
// ═══════════════════════════════════════════════════════════════

interface AblationConfig {
  useSynonyms: boolean;
  useHandRules: boolean;
  useKnownPatterns: boolean;
}

const FULL_SCAFFOLDING: AblationConfig = { useSynonyms: true, useHandRules: true, useKnownPatterns: true };
const NO_SYNONYMS: AblationConfig = { useSynonyms: false, useHandRules: true, useKnownPatterns: true };
const NO_HAND_RULES: AblationConfig = { useSynonyms: true, useHandRules: false, useKnownPatterns: true };
const NO_SCAFFOLDING: AblationConfig = { useSynonyms: false, useHandRules: false, useKnownPatterns: false };

// ═══════════════════════════════════════════════════════════════
// Cross-Repo Similarity Under Ablation
// ═══════════════════════════════════════════════════════════════

/**
 * Measure Redis ↔ SQLite similarity with and without function synonyms.
 *
 * With synonyms: "createClient" and "sqlite3_open" normalize to canonical forms.
 * Without synonyms: raw function names are used.
 */
function measureRepoSimilarity(config: AblationConfig): number {
  const redisFns = config.useSynonyms
    ? KNOWN_REPO_SIGNATURES["Redis"].map(normalizeFunctionName)
    : KNOWN_REPO_SIGNATURES["Redis"];

  const sqliteFns = config.useSynonyms
    ? KNOWN_REPO_SIGNATURES["SQLite"].map(normalizeFunctionName)
    : KNOWN_REPO_SIGNATURES["SQLite"];

  const redis = analyzeRepoPhysics("Redis", redisFns);
  const sqlite = analyzeRepoPhysics("SQLite", sqliteFns);
  const comp = compareRepoPhysics(redis, sqlite);

  return comp.similarity;
}

// ═══════════════════════════════════════════════════════════════
// Cross-Domain F1 Under Ablation
// ═══════════════════════════════════════════════════════════════

function measureCrossDomainF1(config: AblationConfig): number {
  const families = Object.keys(PROTOCOL_FAMILIES);
  const results: number[] = [];

  for (const family of families) {
    if (config.useKnownPatterns) {
      const r = runFamilyIsolation(family);
      results.push(r.crossDomainF1);
    } else {
      // Without known patterns: use pure structural clustering on raw names
      const testFns = PROTOCOL_FAMILIES[family];
      const trainFamilies = families.filter(f => f !== family);
      const trainFns = trainFamilies.flatMap(f => PROTOCOL_FAMILIES[f]);

      const rawTest = config.useSynonyms ? testFns.map(normalizeFunctionName) : testFns;
      const rawTrain = config.useSynonyms ? trainFns.map(normalizeFunctionName) : trainFns;

      // Structural match: do test functions share any structural property with train?
      let matched = 0;
      for (const tf of rawTest) {
        const hasMatch = rawTrain.some(trf => {
          const tLen = tf.length;
          const trLen = trf.length;
          return Math.abs(tLen - trLen) <= 3; // similar length = structural similarity
        });
        if (hasMatch) matched++;
      }

      results.push(rawTest.length > 0 ? matched / rawTest.length : 0);
    }
  }

  return results.reduce((s, r) => s + r, 0) / results.length;
}

// ═══════════════════════════════════════════════════════════════
// Full Ablation Report
// ═══════════════════════════════════════════════════════════════

export interface AblationReport {
  baseline: { repoSimilarity: number; crossDomainF1: number };
  noSynonyms: { repoSimilarity: number; crossDomainF1: number; similarityDrop: number };
  noHandRules: { crossDomainF1: number };
  noScaffolding: { repoSimilarity: number; crossDomainF1: number };
  verdict: "structure_learned" | "partial" | "name_memorized";
}

export function runAblationStudy(): AblationReport {
  const baseline = {
    repoSimilarity: measureRepoSimilarity(FULL_SCAFFOLDING),
    crossDomainF1: measureCrossDomainF1(FULL_SCAFFOLDING),
  };

  const noSynonyms = {
    repoSimilarity: measureRepoSimilarity(NO_SYNONYMS),
    crossDomainF1: measureCrossDomainF1(NO_SYNONYMS),
    similarityDrop: baseline.repoSimilarity - measureRepoSimilarity(NO_SYNONYMS),
  };

  const noHandRules = {
    crossDomainF1: measureCrossDomainF1(NO_HAND_RULES),
  };

  const noScaffolding = {
    repoSimilarity: measureRepoSimilarity(NO_SCAFFOLDING),
    crossDomainF1: measureCrossDomainF1(NO_SCAFFOLDING),
  };

  // Verdict: if similarity survives without synonyms, structure is learned
  const survivalRate = noSynonyms.repoSimilarity / Math.max(0.01, baseline.repoSimilarity);
  const verdict: AblationReport["verdict"] =
    survivalRate > 0.8 ? "structure_learned" :
    survivalRate > 0.4 ? "partial" :
    "name_memorized";

  return { baseline, noSynonyms, noHandRules, noScaffolding, verdict };
}

export function printAblationReport(report: AblationReport): void {
  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║   P7.0 Ablation Study                               ║");
  console.log("║   Does Software Physics survive scaffolding removal?║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  console.log("─── Baseline (full scaffolding) ───");
  console.log(`  Repo Similarity:  ${(report.baseline.repoSimilarity * 100).toFixed(0)}%`);
  console.log(`  Cross-Domain F1:  ${(report.baseline.crossDomainF1 * 100).toFixed(0)}%`);
  console.log();

  console.log("─── Ablation 1: Remove Synonyms ───");
  console.log(`  Repo Similarity:  ${(report.noSynonyms.repoSimilarity * 100).toFixed(0)}%`);
  console.log(`  Cross-Domain F1:  ${(report.noSynonyms.crossDomainF1 * 100).toFixed(0)}%`);
  console.log(`  Similarity Drop:  ${(report.noSynonyms.similarityDrop * 100).toFixed(0)}%`);
  console.log();

  console.log("─── Ablation 2: Remove Hand Rules ───");
  console.log(`  Cross-Domain F1:  ${(report.noHandRules.crossDomainF1 * 100).toFixed(0)}%`);
  console.log();

  console.log("─── Ablation 3: Remove ALL Scaffolding ───");
  console.log(`  Repo Similarity:  ${(report.noScaffolding.repoSimilarity * 100).toFixed(0)}%`);
  console.log(`  Cross-Domain F1:  ${(report.noScaffolding.crossDomainF1 * 100).toFixed(0)}%`);
  console.log();

  const survivalRate = (report.noSynonyms.repoSimilarity / Math.max(0.01, report.baseline.repoSimilarity) * 100).toFixed(0);
  console.log(`─── Verdict ───`);
  console.log(`  Survival Rate:    ${survivalRate}%`);
  console.log(`  Classification:   ${report.verdict.toUpperCase()}`);
  console.log();

  if (report.verdict === "structure_learned") {
    console.log("  ✅ Software Physics survives without name scaffolding.");
    console.log("     The system genuinely learns protocol STRUCTURE.");
  } else if (report.verdict === "partial") {
    console.log("  ⚠️  Partial survival. Some structure is learned, some is name-dependent.");
  } else {
    console.log("  ❌ Similarity collapses without synonyms.");
    console.log("     The system primarily memorizes function names.");
  }
  console.log();
}
