/**
 * End-to-End Acceptance Tests: Real user workflow simulation
 *
 * Simulates the complete developer journey:
 *   1. Submit a goal with broken code → get repair suggestions
 *   2. Accept a repair → verify execution
 *   3. Check feedback recorded → verify future ranking changes
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { suggestAlternatives } from "../../src/counterfactual-engine";
import { PlannerTelemetry, candidateFingerprint } from "../../src/planner-telemetry";
import { createLinearRanker, extractFeatures } from "../../src/repair-ranker";
import { LearningRanker } from "../../src/learning-ranker";
import { parseProtocolsFromJSON } from "../../src/ssg-validator";
import { fileProtocolRules } from "../helpers/protocol-generator";
import type { StateAnnotation } from "../../src/ssg-validator";
import type { RepairCandidate } from "../../src/repair-types";

const E2E_DIR = path.resolve(__dirname, "..", "..", "test-e2e-workflow");
process.env.PROGMUNE_PROJECT_DIR = E2E_DIR;
fs.mkdirSync(E2E_DIR, { recursive: true });
fs.mkdirSync(path.join(E2E_DIR, ".progmune_corpus", "telemetry"), { recursive: true });

/**
 * Simulates the full developer workflow:
 *   Goal → Planner → Top-3 → User selects → Execution → Feedback → Ranking update
 */
async function fullWorkflow(
  goal: string,
  brokenActions: string[],
  rules: Map<string, StateAnnotation>,
  protocol: string
): Promise<{
  candidates: RepairCandidate[];
  selected: RepairCandidate | null;
  accepted: boolean;
  telemetryStats: { totalDecisions: number; withFeedback: number };
}> {
  // Step 1: Compute current state from broken actions
  const currentStates = new Set<string>();
  for (const fn of brokenActions) {
    const rule = rules.get(fn);
    if (rule) { for (const post of rule.post_states) currentStates.add(post); if (rule.invalidate) rule.invalidate.forEach(s => currentStates.delete(s)); }
  }

  // Step 2: Get repair suggestions
  const alts = await suggestAlternatives({
    violation: { svl: 4, violatedConstraint: "resource_leak", actionIndex: brokenActions.length, currentStates: [...currentStates], requiredStates: [], description: `${goal}: incomplete sequence` },
    protocol, currentState: [...currentStates], targetState: [],
    constraints: [{ type: "safety", value: 0.9, description: "安全操作" }],
    rules, goal,
  });

  if (alts.length === 0) {
    const telemetry = new PlannerTelemetry(path.join(E2E_DIR, ".progmune_corpus", "telemetry", `e2e-${Date.now()}.jsonl`));
    return { candidates: [], selected: null, accepted: false, telemetryStats: { totalDecisions: 0, withFeedback: 0 } };
  }

  // Step 3: User selects the first candidate
  const selected = alts[0];
  const telemetry = new PlannerTelemetry(path.join(E2E_DIR, ".progmune_corpus", "telemetry", `e2e-${Date.now()}.jsonl`));

  const fp = candidateFingerprint(protocol, selected.fixPath, "resource_leak");
  const id = telemetry.recordDecision({
    goal, protocol, violationType: "resource_leak",
    candidates: alts.map(a => ({ candidateId: candidateFingerprint(protocol, a.fixPath, "resource_leak"), source: a.source, evidenceSources: [a.source], actions: a.fixPath, explanation: a.description })),
    selectedCandidateId: fp,
  });

  // Step 4: User accepts and execution succeeds
  telemetry.recordFeedback(id, {
    decision: "accepted",
    executionResult: { success: true, violations: [] },
    timestamp: Date.now(),
  });

  return {
    candidates: alts.map(a => ({
      id: candidateFingerprint(protocol, a.fixPath, "resource_leak"),
      source: a.source === "ssg_bfs" ? "protocol" : a.source as RepairCandidate["source"],
      actions: a.fixPath.map(fn => ({ kind: "call" as const, function: fn, args: [] })),
      explanation: a.description,
    })),
    selected: {
      id: fp,
      source: selected.source === "ssg_bfs" ? "protocol" : selected.source as RepairCandidate["source"],
      actions: selected.fixPath.map(fn => ({ kind: "call" as const, function: fn, args: [] })),
      explanation: selected.description,
    },
    accepted: true,
    telemetryStats: { totalDecisions: telemetry.size, withFeedback: telemetry.withFeedback },
  };
}

describe("E2E: Developer Workflow", () => {
  it("full cycle: broken code → repair → accept → telemetry updated", async () => {
    const result = await fullWorkflow("safely write config file", ["open_file", "write_file"], fileProtocolRules, "FileProtocol");

    // Should have at least one candidate
    expect(result.candidates.length).toBeGreaterThan(0);

    // Top candidate should include close_file
    expect(result.selected).toBeDefined();
    expect(result.selected!.actions.some(a => a.kind === "call" && (a as any).function === "close_file")).toBe(true);

    // Telemetry should record the decision
    expect(result.telemetryStats.totalDecisions).toBe(1);
    expect(result.telemetryStats.withFeedback).toBe(1);
  });

  it("feedback influences future ranking", async () => {
    // First repair: use close_file
    const result1 = await fullWorkflow("safely write config file", ["open_file", "write_file"], fileProtocolRules, "FileProtocol");
    expect(result1.accepted).toBe(true);

    // Verify that the accepted repair's stats are recorded
    const telemetry = new PlannerTelemetry(path.join(E2E_DIR, ".progmune_corpus", "telemetry", `e2e-feedback-${Date.now()}.jsonl`));

    const fpSafe = candidateFingerprint("FileProtocol", ["close_file"], "resource_leak");
    const fpLeak = candidateFingerprint("FileProtocol", ["write_file"], "resource_leak");

    // Accept safe 5 times
    for (let i = 0; i < 5; i++) {
      const id = telemetry.recordDecision({
        goal: "safely write", protocol: "FileProtocol",
        candidates: [
          { candidateId: fpSafe, source: "protocol", evidenceSources: ["protocol"], actions: ["close_file"], explanation: "safe" },
          { candidateId: fpLeak, source: "corpus", evidenceSources: ["corpus"], actions: ["write_file"], explanation: "leaky" },
        ],
        selectedCandidateId: fpSafe,
      });
      telemetry.recordFeedback(id, { decision: "accepted", executionResult: { success: true, violations: [] }, timestamp: Date.now() });
    }

    // Reject leaky 3 times
    for (let i = 0; i < 3; i++) {
      const id = telemetry.recordDecision({
        goal: "safely write", protocol: "FileProtocol",
        candidates: [
          { candidateId: fpSafe, source: "protocol", evidenceSources: ["protocol"], actions: ["close_file"], explanation: "safe" },
          { candidateId: fpLeak, source: "corpus", evidenceSources: ["corpus"], actions: ["write_file"], explanation: "leaky" },
        ],
        selectedCandidateId: fpLeak,
      });
      telemetry.recordFeedback(id, { decision: "rejected", timestamp: Date.now() });
    }

    // LearningRanker should prefer safe over leaky
    const learner = new LearningRanker(createLinearRanker(), telemetry);
    const safe = { id: "safe", source: "protocol" as const, actions: [{ kind: "call" as const, function: "close_file", args: [] }], explanation: "safe" };
    const leak = { id: "leak", source: "corpus" as const, actions: [{ kind: "call" as const, function: "write_file", args: [] }], explanation: "leaky" };
    const features = [
      { protocolSafety: 1.0, historicalSuccessRate: 0.5, actionCount: 1, latencyCost: 0.2, auditability: 0.9, corpusEvidence: 0, source: "protocol" as const },
      { protocolSafety: 0.3, historicalSuccessRate: 0.5, actionCount: 1, latencyCost: 0.2, auditability: 0.3, corpusEvidence: 0, source: "corpus" as const },
    ];
    const ranked = learner.rank([leak, safe], features, { protocol: "FileProtocol", violationType: "resource_leak" });

    // Safe has higher acceptance (5/5) than leak (0/3→0.5 default) → should rank higher
    // Verify acceptance values reflect feedback history
    expect(ranked.some(r => r.id === "safe" && r.acceptance > 0.5)).toBe(true);
    expect(ranked.some(r => r.id === "leak" && r.acceptance <= 0.5)).toBe(true);
  });

  it("multiple repair cycles accumulate feedback correctly", () => {
    const telemetry = new PlannerTelemetry(path.join(E2E_DIR, ".progmune_corpus", "telemetry", `e2e-multi-${Date.now()}.jsonl`));

    const cycles = [
      { goal: "safely write file", accept: true },
      { goal: "read and close file", accept: true },
      { goal: "quick write", accept: false },
      { goal: "safely write config", accept: true },
      { goal: "append and close", accept: false },
    ];

    for (const cycle of cycles) {
      const fp = candidateFingerprint("FileProtocol", ["open_file", "write_file", "close_file"], "resource_leak");
      const id = telemetry.recordDecision({
        goal: cycle.goal, protocol: "FileProtocol", violationType: "resource_leak",
        candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions: ["open_file", "write_file", "close_file"], explanation: "full sequence" }],
        selectedCandidateId: fp,
      });
      telemetry.recordFeedback(id, {
        decision: cycle.accept ? "accepted" : "rejected",
        executionResult: cycle.accept ? { success: true, violations: [] } : undefined,
        timestamp: Date.now(),
      });
    }

    const summary = telemetry.getSummaryStats();
    expect(summary.totalDecisions).toBe(5);
    expect(summary.withFeedback).toBe(5);
    expect(summary.accepted).toBe(3);
    expect(summary.rejected).toBe(2);

    // Adoption rate = 3/5 = 60%
    const adoptionRate = summary.accepted / (summary.accepted + summary.rejected);
    expect(adoptionRate).toBe(0.6);
  });
});
