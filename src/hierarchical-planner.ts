/**
 * P5.2: Hierarchical Planner
 *
 * Three-level search: Goal → Skill → Action
 *
 * Uses SkillLibrary to lift planning from the action space into
 * the skill space, reducing search depth by an order of magnitude.
 *
 * When a Goal matches a known Skill chain, the planner expands
 * the skill into its action sequence directly — no BFS needed.
 *
 * When no skills match, falls back to action-level Frontier BFS.
 *
 * DiscoveryModel guides the search toward discoverable paths,
 * prioritizing skill chains that are most likely to yield candidates.
 */

import { SkillLibrary, Skill } from "./skill-library";
import { searchFrontier, FrontierPath } from "./protocol-frontier";
import { guidedSearch, GuidedPath, GuidedSearchConfig } from "./guided-frontier";
import { DiscoveryModel } from "./discovery-model";
import type { StateAnnotation } from "./ssg-validator";
import type { RepairCandidate } from "./repair-types";

// ═══════════════════════════════════════════════════════════════
// Hierarchical Candidate
// ═══════════════════════════════════════════════════════════════

export interface HierarchicalCandidate {
  /** Action-level repair sequence. */
  actions: string[];
  /** Skill chain used (if any). Empty = action-level fallback. */
  skillChain: string[];
  /** Source: "skill" (direct match), "skill-compose" (multi-skill chain), "frontier" (action BFS). */
  source: "skill" | "skill-compose" | "frontier";
  /** Quality score for ranking. */
  score: number;
}

// ═══════════════════════════════════════════════════════════════
// Hierarchical Planner
// ═══════════════════════════════════════════════════════════════

export class HierarchicalPlanner {
  private library: SkillLibrary;
  private rules: Map<string, StateAnnotation>;
  private discoveryModel?: DiscoveryModel;

  constructor(
    library: SkillLibrary,
    rules: Map<string, StateAnnotation>,
    discoveryModel?: DiscoveryModel
  ) {
    this.library = library;
    this.rules = rules;
    this.discoveryModel = discoveryModel;
  }

  /**
   * Plan a repair using Goal → Skill → Action hierarchy.
   *
   * 1. Check if any single skill directly satisfies the goal
   * 2. If not, try composing multiple skills into a chain
   * 3. If no skill chain works, fall back to action-level Frontier BFS
   *
   * @param goal Natural language goal (for discovery scoring)
   * @param currentStates Current protocol states
   * @param targetStates Desired protocol states
   * @param violationType Type of violation
   * @param maxCandidates Max number of candidates to return
   */
  plan(
    goal: string,
    currentStates: string[],
    targetStates: string[],
    violationType: string,
    maxCandidates: number = 10
  ): HierarchicalCandidate[] {
    const candidates: HierarchicalCandidate[] = [];

    // ── Level 1: Direct skill match ──
    const applicable = this.library.findApplicable(currentStates);
    for (const skill of applicable) {
      // Does this skill's effects satisfy the target?
      const effectsMatch = targetStates.length === 0 || targetStates.every(t => skill.effects.includes(t));
      // Or does the skill produce a cleanup effect?
      const cleanupMatch = targetStates.length === 0 && skill.effects.length > 0;

      if (effectsMatch || cleanupMatch) {
        const score = this.scoreSkill(skill, goal, violationType);
        candidates.push({
          actions: skill.macro,
          skillChain: [skill.id],
          source: "skill",
          score,
        });
      }
    }

    // ── Level 2: Composed skill chain ──
    if (targetStates.length > 0) {
      const chains = this.library.compose(currentStates, targetStates, 4);
      for (const chain of chains) {
        const actions = this.library.expand(chain);
        const avgScore = chain.reduce((s, sk) => s + this.scoreSkill(sk, goal, violationType), 0) / chain.length;
        candidates.push({
          actions,
          skillChain: chain.map(s => s.id),
          source: "skill-compose",
          score: avgScore,
        });
      }
    }

    // ── Level 3: Action-level Frontier BFS (fallback) ──
    const frontierPaths = guidedSearch(this.rules, currentStates, targetStates);
    for (const path of frontierPaths.slice(0, maxCandidates)) {
      // Skip if this path is already covered by a skill
      const alreadyCovered = candidates.some(c =>
        c.actions.length === path.actions.length &&
        c.actions.every((a, i) => a === path.actions[i])
      );
      if (!alreadyCovered) {
        candidates.push({
          actions: path.actions,
          skillChain: [],
          source: "frontier",
          score: path.priority || 0.5,
        });
      }
    }

    // Sort by score descending, deduplicate, return top K
    const seen = new Set<string>();
    const unique: HierarchicalCandidate[] = [];
    for (const c of candidates.sort((a, b) => b.score - a.score)) {
      const key = c.actions.join("→");
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(c);
    }

    return unique.slice(0, maxCandidates);
  }

  /**
   * Score a skill using discovery model + acceptance rate.
   *
   *   score = discoveryProb × 0.5 + acceptanceRate × 0.3 + matchBonus × 0.2
   */
  private scoreSkill(skill: Skill, goal: string, violationType: string): number {
    let discoveryProb = 0.5;
    if (this.discoveryModel) {
      discoveryProb = this.discoveryModel.predict({
        protocol: skill.protocol,
        violationType,
        isResourceLeak: violationType === "resource_leak" ? 1 : 0,
        isMissingPrereq: violationType === "missing_prerequisite" ? 1 : 0,
        isIllegalState: violationType === "illegal_state_transition" ? 1 : 0,
        currentStateCount: skill.preconditions.length,
      });
    }

    const matchBonus = skill.goal.toLowerCase().includes(goal.toLowerCase().slice(0, 10)) ? 1.0 : 0.5;

    return discoveryProb * 0.5 + skill.acceptanceRate * 0.3 + matchBonus * 0.2;
  }

  /**
   * Quick plan: return only skill-based candidates (no BFS fallback).
   * Fast path for common repairs.
   */
  quickPlan(goal: string, currentStates: string[]): HierarchicalCandidate[] {
    const applicable = this.library.findApplicable(currentStates);
    return applicable.map(skill => ({
      actions: skill.macro,
      skillChain: [skill.id],
      source: "skill" as const,
      score: skill.acceptanceRate,
    })).sort((a, b) => b.score - a.score);
  }
}

// ═══════════════════════════════════════════════════════════════
// Convenience factory
// ═══════════════════════════════════════════════════════════════

export function createHierarchicalPlanner(
  telemetry: any, // PlannerTelemetry
  rules: Map<string, StateAnnotation>,
  discoveryModel?: DiscoveryModel
): HierarchicalPlanner {
  const library = new SkillLibrary();
  library.learn(telemetry, rules);
  return new HierarchicalPlanner(library, rules, discoveryModel);
}
