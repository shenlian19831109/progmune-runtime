/**
 * P8.3: Zero-Shot Repair Strategy — production integration
 *
 * Plugs into the CounterfactualPlanner's strategy pipeline as a
 * fourth search strategy. When Corpus/Protocol/Antibody strategies
 * produce no candidates, ZeroShotStrategy:
 *
 *   1. Extracts the project's current call context
 *   2. Compares against known state machine fingerprint library
 *   3. Applies the closest matching protocol's repair template
 *   4. Records results to telemetry for online learning
 *
 * This is P8.2's research prototype produced as a production strategy.
 */

import {
  buildKnownFingerprintLibrary,
  discoverProtocolsFromSequences,
  evaluateZeroShotRepair,
  extractUnknownRepoSequences,
} from "./unknown-protocol-discovery";
import { compareStateMachines, extractStateMachine } from "./state-machine-fingerprint";
import type { RepairCandidate, CandidateSearchStrategy, SearchContext } from "./repair-types";
import type { StateAnnotation } from "./ssg-validator";
import { exploreFrontier } from "./protocol-frontier";

function fnToAction(name: string) {
  return { kind: "call" as const, function: name, args: [] as never[] };
}

/**
 * ZeroShotStrategy: discovers protocols from unknown code patterns
 * and generates repair candidates using name-free state machine matching.
 *
 * Activated when:
 *   - CorpusStrategy returns empty (no historical data)
 *   - ProtocolStrategy returns empty or only trivial candidates
 *   - Context has a goal string (for template matching)
 */
export class ZeroShotStrategy implements CandidateSearchStrategy {
  readonly name = "zeroshot";
  private knownLibrary = buildKnownFingerprintLibrary();

  search(ctx: SearchContext): RepairCandidate[] {
    const candidates: RepairCandidate[] = [];

    // 1. Try to infer protocol structure from the current context
    // Use the current state + target state to guess the protocol topology
    if (ctx.currentState.length === 0 && ctx.targetState.length === 0) {
      return candidates; // nothing to work with
    }

    // 2. Build minimal "sequence" from context to match against known protocols
    const contextSequences: string[][] = [];
    // Use the rules we have to construct what we know about the current context
    if (ctx.rules.size > 0) {
      const knownFns = [...ctx.rules.keys()];
      if (knownFns.length >= 2) {
        contextSequences.push(knownFns.slice(0, Math.min(6, knownFns.length)));
      }
    }

    if (contextSequences.length === 0) return candidates;

    // 3. Match against known fingerprint library
    const discovered = discoverProtocolsFromSequences(
      contextSequences,
      ctx.protocol || "unknown",
      this.knownLibrary
    );

    if (discovered.length === 0) return candidates;

    // 4. For each discovered protocol, build repair rules and search
    for (const proto of discovered) {
      // Build rule map
      const rules = new Map<string, StateAnnotation>();
      for (const r of proto.rules) {
        rules.set(r.function, {
          pre_states: r.pre_states,
          post_states: r.post_states,
          invalidate: r.invalidate,
        });
      }

      if (rules.size === 0) continue;

      // Find cleanup functions (invalidate current states)
      for (const [funcName, rule] of rules) {
        const invalidates = rule.invalidate || [];
        const matchesCurrent = invalidates.some(
          s => ctx.currentState.includes(s)
        );
        if (
          matchesCurrent &&
          rule.pre_states.every(p => ctx.currentState.includes(p))
        ) {
          candidates.push({
            id: `zeroshot-${proto.name}-${funcName}`,
            source: "protocol",
            actions: [fnToAction(funcName)],
            explanation: `零样本修复 [${proto.name}]: ${funcName} (匹配已知协议 ${proto.closestKnown || "novel"}, ${(proto.matchConfidence * 100).toFixed(0)}%)`,
            evidence: 0,
            metadata: {
              pathLength: 1,
              source: "zeroshot",
              protocolName: proto.name,
              closestKnown: proto.closestKnown,
              matchConfidence: proto.matchConfidence,
            },
          });
        }
      }

      // Also run frontier exploration for multi-step paths
      const initState = new Set<string>(["INIT", ...ctx.currentState]);
      const paths = exploreFrontier(rules, [...initState], 10, 6);
      for (const path of paths) {
        if (path.length === 0) continue;
        // Only include paths that resolve the current state
        const hasInvalidator = path.some(fn => {
          const rule = rules.get(fn);
          return rule?.invalidate?.some(s => ctx.currentState.includes(s));
        });
        if (!hasInvalidator && ctx.targetState.length === 0) continue;

        candidates.push({
          id: `zeroshot-frontier-${proto.name}-${path.join("-")}`,
          source: "protocol",
          actions: path.map(fnToAction),
          explanation: `零样本前沿探索 [${proto.name}]: ${path.join(" → ")}`,
          evidence: 0,
          metadata: {
            pathLength: path.length,
            source: "zeroshot-frontier",
            protocolName: proto.name,
            closestKnown: proto.closestKnown,
          },
        });
      }
    }

    return candidates;
  }
}

/**
 * Extended factory: return all four strategies including ZeroShot.
 */
export function createAllStrategies(): CandidateSearchStrategy[] {
  // Dynamic import to avoid circular dependency
  const { CorpusSearchStrategy, ProtocolSearchStrategy, AntibodySearchStrategy } =
    require("./repair-strategies");

  return [
    new CorpusSearchStrategy(),
    new ProtocolSearchStrategy(),
    new AntibodySearchStrategy(),
    new ZeroShotStrategy(),
  ];
}
