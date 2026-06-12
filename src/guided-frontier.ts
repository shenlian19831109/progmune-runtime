/**
 * P4.5: Reward-Guided Frontier
 *
 * Priority queue BFS that uses learned reward signals to guide search.
 *
 *   priority = rewardProbability + bridgeBonus + coverageBonus
 *
 * Where:
 *   - rewardProbability: from LogisticRewardModel (how likely is this path to be accepted?)
 *   - bridgeBonus: bonus for paths that cross protocol boundaries (diversity)
 *   - coverageBonus: bonus for paths that visit rarely-seen states (exploration)
 *
 * Unlike standard BFS (FIFO), this explores promising paths first,
 * increasing the chance of finding high-quality candidates within depth limits.
 */

import { searchFrontier, FrontierPath } from "./protocol-frontier";
import type { StateAnnotation } from "./ssg-validator";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface GuidedSearchConfig {
  rewardWeight: number;
  bridgeWeight: number;
  coverageWeight: number;
  maxPaths: number;
  maxDepth: number;
}

const DEFAULT_GUIDED_CONFIG: GuidedSearchConfig = {
  rewardWeight: 0.5,
  bridgeWeight: 0.3,
  coverageWeight: 0.2,
  maxPaths: 15,
  maxDepth: 10,
};

export interface GuidedPath extends FrontierPath {
  rewardScore: number;
  priority: number;
}

// ═══════════════════════════════════════════════════════════════
// Priority Queue
// ═══════════════════════════════════════════════════════════════

class PriorityQueue<T> {
  private items: { item: T; priority: number }[] = [];

  enqueue(item: T, priority: number): void {
    this.items.push({ item, priority });
    this.items.sort((a, b) => b.priority - a.priority); // descending
  }

  dequeue(): T | undefined {
    return this.items.shift()?.item;
  }

  get length(): number { return this.items.length; }
}

// ═══════════════════════════════════════════════════════════════
// Reward Estimator
// ═══════════════════════════════════════════════════════════════

/** Heuristic reward: shorter paths are safer (proxy for reward probability). */
function estimateReward(actions: string[]): number {
  if (actions.length === 0) return 0.5;
  const normLength = Math.min(1, actions.length / 10);
  return 1.0 - normLength * 0.5; // 0.5 ~ 1.0
}

/** Check if a function name bridges two protocols. */
function isBridgeAction(fn: string): boolean {
  // Functions that produce states consumed by other protocols
  const bridges = ["create_session", "logout", "open_file", "close_file", "connect_db", "disconnect_db", "extractIR", "recordSession"];
  return bridges.includes(fn);
}

/** Track state visit frequency for coverage bonus. */
class StateCoverage {
  private visits = new Map<string, number>();

  visit(state: string): void {
    this.visits.set(state, (this.visits.get(state) || 0) + 1);
  }

  bonus(state: string): number {
    const count = this.visits.get(state) || 0;
    // Rarely visited states get higher bonus
    return Math.max(0, 1.0 - count / 5);
  }
}

// ═══════════════════════════════════════════════════════════════
// Guided Frontier Search
// ═══════════════════════════════════════════════════════════════

/**
 * Reward-guided frontier search.
 *
 * Uses a priority queue where each partial path is scored by:
 *   priority = rewardWeight × rewardProbability
 *            + bridgeWeight × bridgeBonus
 *            + coverageWeight × coverageBonus
 *
 * This biases exploration toward paths that are:
 *   1. Likely to be accepted (short, safe)
 *   2. Cross protocol boundaries (diverse)
 *   3. Visit rarely-seen states (exploratory)
 */
export function guidedSearch(
  rules: Map<string, StateAnnotation>,
  currentStates: string[],
  targetStates: string[],
  config?: Partial<GuidedSearchConfig>
): GuidedPath[] {
  const cfg = { ...DEFAULT_GUIDED_CONFIG, ...config };
  const results: GuidedPath[] = [];
  const coverage = new StateCoverage();

  const queue = new PriorityQueue<{
    states: Set<string>;
    actions: string[];
    stateList: string[];
    depth: number;
  }>();

  // Enqueue initial state
  const initPriority = cfg.rewardWeight * 0.5 + cfg.bridgeWeight * 0.3 + cfg.coverageWeight * 0.2;
  queue.enqueue({
    states: new Set(currentStates),
    actions: [],
    stateList: [...currentStates],
    depth: 0,
  }, initPriority);

  const visited = new Set<string>();
  visited.add([...currentStates].sort().join(","));

  while (queue.length > 0 && results.length < cfg.maxPaths) {
    const current = queue.dequeue();
    if (!current) break;
    if (current.depth >= cfg.maxDepth) continue;

    const { states, actions, stateList, depth } = current;

    // Check target reached
    if (targetStates.length > 0 && targetStates.every(t => states.has(t)) && actions.length > 0) {
      results.push({
        actions: [...actions],
        states: [...stateList],
        cost: depth,
        found: true,
        rewardScore: estimateReward(actions),
        priority: 0, // filled below
      });
      continue;
    }

    // Resource cleanup detection
    if (targetStates.length === 0 && actions.length > 0) {
      const hasOpen = states.has("FILE_OPEN") || states.has("DB_CONNECTED");
      if (!hasOpen) {
        results.push({
          actions: [...actions],
          states: [...stateList],
          cost: depth,
          found: true,
          rewardScore: estimateReward(actions),
          priority: 0,
        });
        continue;
      }
    }

    for (const [fn, rule] of rules) {
      const preOk = rule.pre_states.length === 0 || rule.pre_states.every(p => states.has(p));
      if (!preOk) continue;

      const nextStates = new Set(states);
      if (rule.invalidate) rule.invalidate.forEach(s => { nextStates.delete(s); coverage.visit(s); });
      for (const post of rule.post_states) { nextStates.add(post); coverage.visit(post); }

      const nextKey = [...nextStates].sort().join(",");
      if (visited.has(nextKey)) continue;
      visited.add(nextKey);

      const newActions = [...actions, fn];

      // Compute priority
      const rewardProb = estimateReward(newActions);
      const bridgeBonus = isBridgeAction(fn) ? 0.3 : 0;
      const covBonus = [...nextStates].reduce((s, st) => s + coverage.bonus(st), 0) / Math.max(1, nextStates.size);

      const priority =
        cfg.rewardWeight * rewardProb +
        cfg.bridgeWeight * bridgeBonus +
        cfg.coverageWeight * covBonus;

      queue.enqueue({
        states: nextStates,
        actions: newActions,
        stateList: [...stateList, ...rule.post_states],
        depth: depth + 1,
      }, priority);
    }
  }

  // Fill priority scores
  for (const r of results) {
    r.priority = cfg.rewardWeight * r.rewardScore;
  }

  return results.sort((a, b) => b.priority - a.priority);
}

/**
 * Multi-start guided search: try multiple initial states.
 */
export function guidedSearchMulti(
  rules: Map<string, StateAnnotation>,
  currentStatesCandidates: string[][],
  targetStates: string[],
  config?: Partial<GuidedSearchConfig>
): GuidedPath[] {
  const allResults: GuidedPath[] = [];

  for (const startStates of currentStatesCandidates) {
    const paths = guidedSearch(rules, startStates, targetStates, config);
    allResults.push(...paths);
  }

  // Deduplicate and sort by priority
  const seen = new Set<string>();
  const unique: GuidedPath[] = [];
  for (const p of allResults) {
    const key = p.actions.join("→");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }

  return unique.sort((a, b) => b.priority - a.priority);
}
