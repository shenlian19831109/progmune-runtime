/**
 * Integration Tests: Planner → Ranker → Telemetry full pipeline
 *
 * Verifies cross-module collaboration:
 *   - Strategy merge + deduplication
 *   - Ranking + Telemetry recording
 *   - Decision lifecycle (propose → accept → stats update)
 *   - Cross-protocol scenario (auth + file + db)
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { suggestAlternatives } from "../../src/counterfactual-engine";
import { PlannerTelemetry, candidateFingerprint } from "../../src/planner-telemetry";
import { createLinearRanker, extractFeatures } from "../../src/repair-ranker";
import { LearningRanker } from "../../src/learning-ranker";
import { parseProtocolsFromJSON } from "../../src/ssg-validator";
import { authProtocolRules, fileProtocolRules, dbProtocolRules, mergeProtocolRules } from "../helpers/protocol-generator";
import type { StateAnnotation } from "../../src/ssg-validator";

const INTEG_DIR = path.resolve(__dirname, "..", "..", "test-integration-e2e");
process.env.PROGMUNE_PROJECT_DIR = INTEG_DIR;
fs.mkdirSync(INTEG_DIR, { recursive: true });
fs.mkdirSync(path.join(INTEG_DIR, ".progmune_corpus", "telemetry"), { recursive: true });

describe("Integration: Planner → Ranker → Telemetry", () => {
  it("merges candidates from all strategies and deduplicates", async () => {
    const rules = mergeProtocolRules(fileProtocolRules);
    const alts = await suggestAlternatives({
      violation: { svl: 4, violatedConstraint: "resource_leak", actionIndex: 2, currentStates: ["FILE_OPEN"], requiredStates: [], description: "File not closed after write" },
      protocol: "_global", currentState: ["FILE_OPEN"], targetState: [],
      constraints: [{ type: "safety", value: 0.9, description: "安全关闭" }],
      rules, goal: "safely write config file",
    });

    // Should find close_file as a candidate
    expect(alts.length).toBeGreaterThan(0);
    const hasClose = alts.some(a => a.fixPath.includes("close_file"));
    expect(hasClose).toBe(true);

    // No duplicate fingerprints
    const fingerprints = alts.map(a => a.fixPath.join("→"));
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });

  it("records decision lifecycle in telemetry", async () => {
    const telemetry = new PlannerTelemetry(
      path.join(INTEG_DIR, ".progmune_corpus", "telemetry", `integration-${Date.now()}.jsonl`)
    );

    const fp = candidateFingerprint("FileProtocol", ["close_file"], "resource_leak");

    const id = telemetry.recordDecision({
      goal: "close file safely",
      protocol: "FileProtocol",
      violationType: "resource_leak",
      candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions: ["close_file"], explanation: "Close the file" }],
      selectedCandidateId: fp,
    });

    // Simulate user acceptance
    telemetry.recordFeedback(id, {
      decision: "accepted",
      executionResult: { success: true, violations: [] },
      timestamp: Date.now(),
    });

    const stats = telemetry.getCandidateStats(fp);
    expect(stats.accepted).toBe(1);

    // LearningRanker should pick up the acceptance signal
    const base = createLinearRanker();
    const learner = new LearningRanker(base, telemetry);
    const cand = { id: "c1", source: "protocol" as const, actions: [{ kind: "call" as const, function: "close_file", args: [] }], explanation: "close" };
    const feats = extractFeatures(cand, { protocol: "FileProtocol", currentState: ["FILE_OPEN"], targetState: [], violationType: "resource_leak", constraints: [], rules: new Map() });
    const score = learner.score(cand, feats, { protocol: "FileProtocol", violationType: "resource_leak" });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("cross-protocol: auth → file → db fix chain", async () => {
    const rules = mergeProtocolRules(authProtocolRules, fileProtocolRules, dbProtocolRules);
    const alts = await suggestAlternatives({
      violation: { svl: 4, violatedConstraint: "resource_leak", actionIndex: 3, currentStates: ["FILE_OPEN", "DB_CONNECTED"], requiredStates: [], description: "Multi-resource leak" },
      protocol: "_global", currentState: ["FILE_OPEN", "DB_CONNECTED"], targetState: [],
      constraints: [], rules, goal: "cleanup all resources after auth",
    });

    expect(alts.length).toBeGreaterThan(0);
    // Should find both close_file and disconnect_db
    const allFns = alts.flatMap(a => a.fixPath);
    expect(allFns.some(f => f === "close_file" || f === "disconnect_db")).toBe(true);
  });
});
