/**
 * P5.1: Skill Library
 *
 * Formalizes MacroGraph nodes into a queryable, composable skill catalog.
 *
 * A Skill is a named, reusable action sequence with known preconditions,
 * effects, and success metrics. It abstracts the low-level action space
 * into a higher-level skill space, reducing planner search depth.
 *
 * Three-level hierarchy:
 *   Goal  →  Skill  →  Action
 *   (what)   (how)     (primitive)
 *
 * Example:
 *   Goal:  "safely write config file"
 *   Skill: safe_file_write
 *   Macro: [open_file, write_file, close_file]
 *   Effect: FILE_OPEN → FILE_DIRTY → FILE_CLOSED
 */

import * as fs from "fs";
import * as path from "path";
import { MacroGraphBuilder, MacroNode } from "./macro-graph";
import { PlannerTelemetry } from "./planner-telemetry";
import type { StateAnnotation } from "./ssg-validator";

// ═══════════════════════════════════════════════════════════════
// Skill Types
// ═══════════════════════════════════════════════════════════════

export interface Skill {
  id: string;
  /** Human-readable goal this skill satisfies. */
  goal: string;
  /** Protocol namespace. */
  protocol: string;
  /** States required before this skill can execute. */
  preconditions: string[];
  /** States produced or invalidated after execution. */
  effects: string[];
  /** Ordered action sequence. */
  macro: string[];
  /** Historical success rate (execution). */
  successRate: number;
  /** User acceptance rate. */
  acceptanceRate: number;
  /** How many times observed. */
  frequency: number;
  /** Average latency in ms. */
  avgLatencyMs: number;
}

const SKILL_DIR = path.resolve(
  process.env.PROGMUNE_PROJECT_DIR || process.cwd(),
  ".progmune_corpus", "skills"
);

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ═══════════════════════════════════════════════════════════════
// Skill Library
// ═══════════════════════════════════════════════════════════════

export class SkillLibrary {
  private skills: Map<string, Skill> = new Map();
  /** Index: effects → skills that produce this effect. */
  private byEffect: Map<string, Skill[]> = new Map();
  /** Index: preconditions → skills that require this state. */
  private byPrecond: Map<string, Skill[]> = new Map();

  /**
   * Learn skills from telemetry via MacroGraph mining.
   */
  learn(telemetry: PlannerTelemetry, rules: Map<string, StateAnnotation>): void {
    const builder = new MacroGraphBuilder();
    const graph = builder.learnMacros(telemetry, rules, 0.7, 3);

    for (const [, node] of graph.nodes) {
      this.addSkill(nodeToSkill(node));
    }
  }

  /** Add a skill to the library, updating indexes. */
  addSkill(skill: Skill): void {
    this.skills.set(skill.id, skill);

    for (const effect of skill.effects) {
      const list = this.byEffect.get(effect) || [];
      list.push(skill);
      this.byEffect.set(effect, list);
    }
    for (const pre of skill.preconditions) {
      const list = this.byPrecond.get(pre) || [];
      list.push(skill);
      this.byPrecond.set(pre, list);
    }
  }

  /**
   * Find skills whose preconditions are satisfied by current state.
   */
  findApplicable(currentStates: string[]): Skill[] {
    const currentSet = new Set(currentStates);
    return [...this.skills.values()].filter(s =>
      s.preconditions.length === 0 || s.preconditions.every(p => currentSet.has(p))
    );
  }

  /**
   * Find skills that produce a target state (effect match).
   */
  findProducers(targetState: string): Skill[] {
    return this.byEffect.get(targetState) || [];
  }

  /**
   * Compose a skill chain from current state to goal state.
   *
   * Returns the shortest chain (by skill count) that transforms
   * currentStates into a state set containing targetStates.
   */
  compose(currentStates: string[], targetStates: string[], maxDepth: number = 4): Skill[][] {
    const chains: Skill[][] = [];
    const currentSet = new Set(currentStates);

    // BFS over skill space
    const visited = new Set<string>();
    const queue: { skills: Skill[]; states: Set<string>; depth: number }[] = [];

    // Seed: skills that can fire from current state
    const startable = this.findApplicable(currentStates);
    for (const s of startable) {
      const next = new Set(currentStates);
      for (const e of s.effects) next.add(e);
      queue.push({ skills: [s], states: next, depth: 1 });
      visited.add(s.id);
    }

    while (queue.length > 0 && chains.length < 10) {
      const { skills, states, depth } = queue.shift()!;
      if (depth > maxDepth) continue;

      // Target reached?
      if (targetStates.length > 0 && targetStates.every(t => states.has(t))) {
        chains.push(skills);
        continue;
      }

      // Try the next skill
      const nextSkills = this.findApplicable([...states]);
      for (const ns of nextSkills) {
        if (skills.some(s => s.id === ns.id)) continue; // no cycles
        const key = skills.map(s => s.id).join("→") + "→" + ns.id;
        if (visited.has(key)) continue;
        visited.add(key);

        const next = new Set(states);
        for (const e of ns.effects) next.add(e);
        queue.push({ skills: [...skills, ns], states: next, depth: depth + 1 });
      }
    }

    // Sort by success rate (descending)
    chains.sort((a, b) => {
      const rA = a.reduce((s, sk) => s + sk.successRate, 0) / a.length;
      const rB = b.reduce((s, sk) => s + sk.successRate, 0) / b.length;
      return rB - rA;
    });

    return chains;
  }

  /**
   * Expand a skill chain into a flat action sequence.
   */
  expand(skills: Skill[]): string[] {
    return skills.flatMap(s => s.macro);
  }

  /**
   * Expand a single skill by name into its action sequence.
   */
  expandSkill(skillId: string): string[] | null {
    const skill = this.skills.get(skillId);
    return skill ? [...skill.macro] : null;
  }

  /** All skills in the library. */
  all(): Skill[] {
    return [...this.skills.values()].sort((a, b) => b.successRate - a.successRate);
  }

  /** Number of skills. */
  get size(): number { return this.skills.size; }

  // ── Persistence ──

  save(filepath?: string): string {
    ensureDir(SKILL_DIR);
    const fp = filepath || path.join(SKILL_DIR, `skills-${new Date().toISOString().slice(0, 10)}.json`);
    fs.writeFileSync(fp, JSON.stringify([...this.skills.values()], null, 2));
    return fp;
  }

  load(filepath?: string): void {
    const fp = filepath || path.join(SKILL_DIR, `skills-${new Date().toISOString().slice(0, 10)}.json`);
    if (!fs.existsSync(fp)) return;
    try {
      const data: Skill[] = JSON.parse(fs.readFileSync(fp, "utf-8"));
      for (const s of data) this.addSkill(s);
    } catch { /* empty or corrupted */ }
  }
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function nodeToSkill(node: MacroNode): Skill {
  // Infer a goal description from the action names
  const goalPattern = node.actions
    .map(fn => fn.replace(/_/g, " "))
    .join(" then ");

  return {
    id: node.id,
    goal: goalPattern,
    protocol: node.protocol,
    preconditions: node.preconditions,
    effects: node.postconditions,
    macro: node.actions,
    successRate: node.reward,
    acceptanceRate: node.reward,
    frequency: node.frequency,
    avgLatencyMs: node.source?.avgLatencyMs || 0,
  };
}

export function printSkillLibrary(library: SkillLibrary): void {
  console.log("\n─── Skill Library ───");
  console.log(`Skills: ${library.size}`);
  console.log();

  const skills = library.all();
  if (skills.length === 0) {
    console.log("  No skills learned yet. Collect more feedback data.");
    return;
  }

  console.log("Success  Accept  Freq  Skill");
  console.log("──────────────────────────────────────────────────");

  for (const s of skills.slice(0, 15)) {
    const succ = (s.successRate * 100).toFixed(0).padStart(4);
    const acc = (s.acceptanceRate * 100).toFixed(0).padStart(4);
    const freq = String(s.frequency).padStart(4);
    console.log(`  ${succ}%  ${acc}%  ${freq}  ${s.goal}`);
    console.log(`         protocol: ${s.protocol.padEnd(12)} pre: [${s.preconditions.join(",") || "none"}] → [${s.effects.join(",") || "none"}]`);
  }
  console.log();
}
