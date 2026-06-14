/**
 * Large Protocol Graph Builders
 *
 * Generates structured protocol graphs for stress and soak testing:
 *   - Chain: linear sequence S0→S1→...→Sn
 *   - Tree: branching hierarchy with configurable depth/branch factor
 *   - Grid: 2D grid with right+down edges
 *
 * All produce maps compatible with searchFrontier().
 */
import type { StateAnnotation } from "../../src/ssg-validator";

/** Build a linear chain protocol: S0 → S1 → ... → S{n-1} */
export function buildChainProtocol(numStates: number): Map<string, StateAnnotation> {
  const rules = new Map<string, StateAnnotation>();
  for (let i = 0; i < numStates - 1; i++) {
    rules.set(`step_${i}`, {
      pre_states: [`S${i}`],
      post_states: [`S${i + 1}`],
    });
  }
  return rules;
}

/** Build a tree protocol with given depth and branching factor. */
export function buildTreeProtocol(depth: number, branchFactor: number): Map<string, StateAnnotation> {
  const rules = new Map<string, StateAnnotation>();
  const totalNodes = (Math.pow(branchFactor, depth + 1) - 1) / (branchFactor - 1);

  for (let i = 0; i < totalNodes; i++) {
    for (let b = 0; b < branchFactor; b++) {
      const child = i * branchFactor + b + 1;
      if (child < totalNodes) {
        rules.set(`branch_${i}_to_${child}`, {
          pre_states: [`N${i}`],
          post_states: [`N${child}`],
        });
      }
    }
  }
  return rules;
}

/** Build a 2D grid protocol with right+down edges. */
export function buildGridProtocol(width: number, height: number): Map<string, StateAnnotation> {
  const rules = new Map<string, StateAnnotation>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = y * width + x;

      if (x + 1 < width) {
        rules.set(`right_${id}`, {
          pre_states: [`C${id}`],
          post_states: [`C${id + 1}`],
        });
      }
      if (y + 1 < height) {
        rules.set(`down_${id}`, {
          pre_states: [`C${id}`],
          post_states: [`C${id + width}`],
        });
      }
    }
  }
  return rules;
}

/** Total node count utility. */
export function nodeCount(rules: Map<string, StateAnnotation>): number {
  const states = new Set<string>();
  for (const rule of rules.values()) {
    for (const s of rule.pre_states) states.add(s);
    for (const s of rule.post_states) states.add(s);
  }
  return states.size;
}
