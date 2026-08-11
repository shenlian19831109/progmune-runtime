/**
 * P6.6: Trajectory Data Augmentation
 *
 * Expands the Trajectory Corpus from ~100 to 5000+ sequences
 * using three unsupervised strategies:
 *
 *   1. Random walk: generates legal sequences from protocol graphs
 *   2. Mutation: semantically-preserving variations of existing trajectories
 *   3. Validation: every generated sequence passes Protocol VM verification
 *
 * Target: function overlap > 60% when P6.5 bootstrap is re-run.
 */

import { loadDefaultProtocolDefinitions } from "./protocol-coverage";
import { synthesizeAllKnownProtocols, SynthesizedProtocol } from "./auto-protocol-synthesizer";
import { searchFrontier, FrontierPath } from "./protocol-frontier";
import { isValidPhysicsSequence } from "./experimental/software-physics";
import type { StateAnnotation } from "./ssg-validator";

// ═══════════════════════════════════════════════════════════════
// Strategy 1: Random Walk Synthesis
// ═══════════════════════════════════════════════════════════════

/**
 * Generate legal action sequences by random walk on protocol graphs.
 *
 * For each protocol rule graph, start from a node with no preconditions,
 * randomly follow outgoing edges, and record the action path.
 * Only outputs sequences that form valid protocol patterns.
 */
export function generateRandomWalks(
  rules: Map<string, StateAnnotation>,
  count: number = 500,
  minLen: number = 2,
  maxLen: number = 6,
  nsInit?: Map<string, string>  // namespace → initial state (e.g., TX_IDLE for transaction)
): string[][] {
  const sequences: string[][] = [];
  const ruleEntries = [...rules.entries()];

  // Build the initial state set: per-namespace starting states
  const initialStateSet = new Set<string>(nsInit?.values() || []);

  // Find entry points: rules with no preconditions, OR rules whose
  // pre_states are all namespace-initial states (allowing protocol-specific starts).
  const entryPoints = ruleEntries.filter(([, rule]) => {
    if (rule.pre_states.length === 0) return true;
    // Also include rules that can start from namespace initial states
    return rule.pre_states.every(s => initialStateSet.has(s));
  });

  if (entryPoints.length === 0) {
    // Use all rules as potential starts
    entryPoints.push(...ruleEntries);
  }

  for (let i = 0; i < count; i++) {
    // Pick a random entry point
    const [startFn] = entryPoints[Math.floor(Math.random() * entryPoints.length)];
    const path: string[] = [startFn];
    const visited = new Set<string>([startFn]);
    let currentFn = startFn;

    // Random walk
    const targetLen = minLen + Math.floor(Math.random() * (maxLen - minLen + 1));
    while (path.length < targetLen) {
      const currentRule = rules.get(currentFn);
      if (!currentRule) break;

      // Find next functions whose pre_states match our post_states,
      // OR functions with empty pre_states (always callable).
      // Allow revisiting functions that have self-transitions (post == pre).
      const candidates = ruleEntries.filter(([fn, r]) => {
        if (visited.has(fn) && !currentRule.post_states.some(ps => r.pre_states.includes(ps) && r.post_states.some(p => p === ps))) {
          // Only allow revisit if it's a self-transition (same state in pre and post)
          return false;
        }
        // Match: our post_state is in their pre_states, OR they have no preconditions
        return currentRule.post_states.some(ps => r.pre_states.includes(ps)) ||
               r.pre_states.length === 0;
      });

      if (candidates.length === 0) {
        // Try to close with an invalidation rule
        const closers = ruleEntries.filter(([fn, r]) =>
          !visited.has(fn) &&
          r.invalidate &&
          r.pre_states.some(ps => currentRule.post_states.includes(ps))
        );
        if (closers.length > 0) {
          const [closerFn] = closers[Math.floor(Math.random() * closers.length)];
          path.push(closerFn);
        }
        break;
      }

      const [nextFn] = candidates[Math.floor(Math.random() * candidates.length)];
      path.push(nextFn);
      visited.add(nextFn);
      currentFn = nextFn;
    }

    // Only keep sequences that form valid physics patterns
    if (path.length >= minLen && isValidPhysicsSequence(path).valid) {
      sequences.push(path);
    }
  }

  return sequences;
}

/** Generate walks from all known protocol rules (hand-written + synthesized). */
export function generateAllRandomWalks(count: number = 500): string[][] {
  const defs = loadDefaultProtocolDefinitions();
  const allRules = new Map<string, StateAnnotation>();
  for (const p of defs) for (const [fn, rule] of p.rules) allRules.set(fn, rule);

  // Build namespace initial states from protocol definitions
  const nsInit = new Map<string, string>();
  for (const p of defs) {
    nsInit.set(p.name, p.initialState);
  }

  // Add synthesized rules
  const synthesized = synthesizeAllKnownProtocols();
  for (const sp of synthesized) {
    for (const sr of sp.rules) {
      allRules.set(sr.function, {
        pre_states: sr.pre_states,
        post_states: sr.post_states,
        invalidate: sr.invalidate,
      });
    }
  }

  return generateRandomWalks(allRules, count, 2, 6, nsInit);
}

// ═══════════════════════════════════════════════════════════════
// Strategy 2: Semantic Mutation
// ═══════════════════════════════════════════════════════════════

/**
 * Generate variations of existing trajectories while preserving semantics.
 *
 * Mutations:
 *   - Insert: add a valid intermediate step
 *   - Replace: swap an action with a functionally similar one
 *   - Extend: add cleanup steps at the end
 *
 * Each variant is validated: must still form a valid protocol sequence.
 */
export function mutateTrajectories(
  trajectories: string[][],
  rules: Map<string, StateAnnotation>,
  count: number = 200
): string[][] {
  const variants: string[][] = [];
  const ruleEntries = [...rules.entries()];

  for (let i = 0; i < count; i++) {
    const original = trajectories[Math.floor(Math.random() * trajectories.length)];
    if (original.length < 2) continue;

    const mutationType = Math.random();

    if (mutationType < 0.4) {
      // INSERT: add an action between two existing steps
      const insertPos = 1 + Math.floor(Math.random() * (original.length - 1));
      const preAction = original[insertPos - 1];
      const preRule = rules.get(preAction);
      if (preRule && preRule.post_states.length > 0) {
        const midState = preRule.post_states[0];
        const candidates = ruleEntries.filter(([fn, r]) =>
          r.pre_states.includes(midState) && !original.includes(fn)
        );
        if (candidates.length > 0) {
          const [insertFn] = candidates[Math.floor(Math.random() * candidates.length)];
          const variant = [...original.slice(0, insertPos), insertFn, ...original.slice(insertPos)];
          if (isValidPhysicsSequence(variant).valid) variants.push(variant);
        }
      }
    } else if (mutationType < 0.7) {
      // REPLACE: swap an action
      const replacePos = Math.floor(Math.random() * original.length);
      const origFn = original[replacePos];
      const origRule = rules.get(origFn);
      if (origRule) {
        const candidates = ruleEntries.filter(([fn, r]) =>
          fn !== origFn &&
          r.pre_states.some(s => origRule.pre_states.includes(s)) &&
          r.post_states.some(s => origRule.post_states.includes(s))
        );
        if (candidates.length > 0) {
          const [replaceFn] = candidates[Math.floor(Math.random() * candidates.length)];
          const variant = [...original];
          variant[replacePos] = replaceFn;
          if (isValidPhysicsSequence(variant).valid) variants.push(variant);
        }
      }
    } else {
      // EXTEND: add a cleanup step
      const lastFn = original[original.length - 1];
      const lastRule = rules.get(lastFn);
      if (lastRule && lastRule.post_states.length > 0) {
        const finalState = lastRule.post_states[0];
        const candidates = ruleEntries.filter(([fn, r]) =>
          r.invalidate && r.pre_states.includes(finalState) && !original.includes(fn)
        );
        if (candidates.length > 0) {
          const [extendFn] = candidates[Math.floor(Math.random() * candidates.length)];
          variants.push([...original, extendFn]);
        }
      }
    }
  }

  return variants;
}

// ═══════════════════════════════════════════════════════════════
// Full Augmentation Pipeline
// ═══════════════════════════════════════════════════════════════

export interface AugmentationReport {
  originalCount: number;
  randomWalks: number;
  mutations: number;
  totalAugmented: number;
  validRate: number;
}

/**
 * Run the full augmentation pipeline.
 *
 * Generates random walks + mutations, validates all against Protocol VM,
 * and reports the expanded corpus size.
 */
export function runAugmentation(
  existingTrajectories: string[][] = [],
  walkCount: number = 500,
  mutationCount: number = 200
): { sequences: string[][]; report: AugmentationReport } {
  const defs = loadDefaultProtocolDefinitions();
  const allRules = new Map<string, StateAnnotation>();
  for (const p of defs) for (const [fn, rule] of p.rules) allRules.set(fn, rule);

  // Add synthesized rules
  const synthesized = synthesizeAllKnownProtocols();
  for (const sp of synthesized) {
    for (const sr of sp.rules) {
      allRules.set(sr.function, {
        pre_states: sr.pre_states,
        post_states: sr.post_states,
        invalidate: sr.invalidate,
      });
    }
  }

  // Strategy 1: Random walks
  const walks = generateRandomWalks(allRules, walkCount);

  // Strategy 2: Mutations (from existing + walks)
  const seedTrajectories = existingTrajectories.length > 0 ? existingTrajectories : walks;
  const mutations = mutateTrajectories(seedTrajectories, allRules, mutationCount);

  const allSequences = [...existingTrajectories, ...walks, ...mutations];

  // Deduplicate
  const seen = new Set<string>();
  const unique: string[][] = [];
  for (const seq of allSequences) {
    const key = seq.join("→");
    if (!seen.has(key) && seq.length >= 2) {
      seen.add(key);
      unique.push(seq);
    }
  }

  // Validate: only keep valid physics sequences
  const valid = unique.filter(seq => isValidPhysicsSequence(seq).valid);

  return {
    sequences: valid,
    report: {
      originalCount: existingTrajectories.length,
      randomWalks: walks.length,
      mutations: mutations.length,
      totalAugmented: valid.length,
      validRate: unique.length > 0 ? valid.length / unique.length : 0,
    },
  };
}

export function printAugmentationReport(report: AugmentationReport): void {
  console.log("\n─── P6.6 Trajectory Augmentation ───");
  console.log(`  Original:     ${report.originalCount}`);
  console.log(`  Random Walks: ${report.randomWalks}`);
  console.log(`  Mutations:    ${report.mutations}`);
  console.log(`  Total Unique: ${report.totalAugmented}`);
  console.log(`  Valid Rate:   ${(report.validRate * 100).toFixed(0)}%`);
  console.log();
}
