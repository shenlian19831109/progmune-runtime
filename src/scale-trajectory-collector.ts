/**
 * Scale Trajectory Collector
 *
 * Generates 500+ validated trajectories from repo signatures
 * using AST extraction + augmentation + Protocol VM validation.
 *
 * Pipeline:
 *   Repo Signatures → AST extraction → Synonym normalization
 *   → Random walks → Mutations → Validation → Dedup → Corpus
 */

import { MINING_SIGNATURES } from "./protocol-mining";
import { EXPANDED_TRAJECTORIES } from "./trajectory-corpus";
import { CROSS_REPO_SEQUENCES } from "./unsupervised-physics";
import { generateRandomWalks, mutateTrajectories, runAugmentation } from "./trajectory-augmentation";
import { normalizeFunctionName } from "./function-synonyms";
import { isValidPhysicsSequence } from "./software-physics";
import { loadDefaultProtocolDefinitions } from "./protocol-coverage";
import { synthesizeAllKnownProtocols } from "./auto-protocol-synthesizer";
import type { StateAnnotation } from "./ssg-validator";

export interface CollectionReport {
  sourceRepos: number;
  sourceSequences: number;
  randomWalks: number;
  mutations: number;
  totalCollected: number;
  validSequences: number;
  duplicateRemoved: number;
  finalCorpusSize: number;
}

/**
 * Collect trajectories at scale from all available sources.
 *
 * Combines:
 *   1. Mining signatures (21 repos, 64 sequences)
 *   2. Expanded trajectories (10 libraries, 50 sequences)
 *   3. Cross-repo sequences (5 repos, 15 sequences)
 *   4. Random walks from protocol rules
 *   5. Mutations of existing trajectories
 *
 * All sequences are normalized, validated, and deduplicated.
 */
export function collectTrajectoriesAtScale(): { sequences: string[][]; report: CollectionReport } {
  // Collect all source sequences
  const sourceSeqs: string[][] = [];

  // Source 1: Mining signatures
  for (const sig of MINING_SIGNATURES) {
    for (const p of sig.patterns) {
      if (p.length >= 2) sourceSeqs.push(p);
    }
  }

  // Source 2: Expanded trajectories
  for (const lib of EXPANDED_TRAJECTORIES) {
    for (const seq of lib.sequences) {
      if (seq.length >= 2) sourceSeqs.push(seq);
    }
  }

  // Source 3: Cross-repo sequences
  for (const seqs of Object.values(CROSS_REPO_SEQUENCES)) {
    for (const seq of seqs) {
      if (seq.length >= 2) sourceSeqs.push(seq);
    }
  }

  const sourceCount = sourceSeqs.length;
  const uniqueSources = new Set(sourceSeqs.map(s => s.join("→")));

  // Normalize all sequences
  const normalized = sourceSeqs.map(seq => seq.map(normalizeFunctionName));

  // Build protocol rules for validation
  const defs = loadDefaultProtocolDefinitions();
  const rules = new Map<string, StateAnnotation>();
  const nsInit = new Map<string, string>();
  for (const p of defs) {
    nsInit.set(p.name, p.initialState);
    for (const [fn, rule] of p.rules) rules.set(fn, rule);
  }

  const synthesized = synthesizeAllKnownProtocols();
  for (const sp of synthesized) {
    for (const sr of sp.rules) {
      rules.set(sr.function, {
        pre_states: sr.pre_states,
        post_states: sr.post_states,
        invalidate: sr.invalidate,
      });
    }
  }

  // Generate random walks from all rules + synthesized (push to 200+)
  const walks = generateRandomWalks(rules, 5000, 2, 10, nsInit);
  const normalizedWalks = walks.map(seq => seq.map(normalizeFunctionName));

  // Generate mutations at scale
  const seedForMutations = [...normalized, ...normalizedWalks];
  const mutations = mutateTrajectories(seedForMutations.slice(0, 800), rules, 3000);
  const normalizedMutations = mutations.map(seq => seq.map(normalizeFunctionName));

  // Combine all
  const allSequences = [...normalized, ...normalizedWalks, ...normalizedMutations];

  // Validate: only keep valid physics sequences
  let valid = allSequences.filter(seq => isValidPhysicsSequence(seq).valid);

  // Deduplicate
  const seen = new Set<string>();
  const unique: string[][] = [];
  for (const seq of valid) {
    const key = seq.join("→");
    if (!seen.has(key) && seq.length >= 2) {
      seen.add(key);
      unique.push(seq);
    }
  }

  return {
    sequences: unique,
    report: {
      sourceRepos: MINING_SIGNATURES.length + EXPANDED_TRAJECTORIES.length,
      sourceSequences: sourceCount,
      randomWalks: walks.length,
      mutations: mutations.length,
      totalCollected: allSequences.length,
      validSequences: valid.length,
      duplicateRemoved: valid.length - unique.length,
      finalCorpusSize: unique.length,
    },
  };
}

export function printCollectionReport(report: CollectionReport): void {
  console.log("\n─── Scale Trajectory Collection Report ───");
  console.log(`  Source Repos:        ${report.sourceRepos}`);
  console.log(`  Source Sequences:    ${report.sourceSequences}`);
  console.log(`  Random Walks:        ${report.randomWalks}`);
  console.log(`  Mutations:           ${report.mutations}`);
  console.log(`  Total Collected:     ${report.totalCollected}`);
  console.log(`  Valid Sequences:     ${report.validSequences}`);
  console.log(`  Duplicates Removed:  ${report.duplicateRemoved}`);
  console.log(`  Final Corpus Size:   ${report.finalCorpusSize}`);
  console.log();
}
