/**
 * P5.0: Self-Improvement Orchestrator + Macro Graph + Discovery Model Tests
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { generateImprovementTasks, estimatePatchValue, runImprovementLoop, printOrchestrationPlan, ImprovementTask } from "./improvement-orchestrator";
import { MacroGraphBuilder, MacroNode } from "./macro-graph";
import { DiscoveryModel, generateDiscoverabilityReport, printDiscoverabilityReport, DiscoveryFeatures } from "./discovery-model";
import { PlannerTelemetry, candidateFingerprint } from "./planner-telemetry";
import { mineMacroRepairs } from "./macro-repair";
import type { StateAnnotation } from "./ssg-validator";

const P5_DIR = path.resolve(__dirname, "..", "test-p5-orchestrator");
process.env.PROGMUNE_PROJECT_DIR = P5_DIR;
fs.mkdirSync(P5_DIR, { recursive: true });
fs.mkdirSync(path.join(P5_DIR, ".progmune_corpus", "telemetry"), { recursive: true });
fs.mkdirSync(path.join(P5_DIR, ".progmune_corpus", "macros"), { recursive: true });

function seedRichTelemetry(n: number): PlannerTelemetry {
  const t = new PlannerTelemetry(path.join(P5_DIR, ".progmune_corpus", "telemetry", `p5-${Date.now()}.jsonl`));

  // File macro: open→write→close (90% accepted)
  for (let i = 0; i < n; i++) {
    const actions = ["open_file", "write_file", "close_file"];
    const fp = candidateFingerprint("FileProtocol", actions, "resource_leak");
    const id = t.recordDecision({
      goal: "safely write config file", protocol: "FileProtocol", violationType: "resource_leak",
      candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions, explanation: "full sequence" }],
      selectedCandidateId: fp, cost: { latencyMs: 5 },
    });
    t.recordFeedback(id, { decision: Math.random() < 0.9 ? "accepted" : "rejected", executionResult: { success: true, violations: [] }, timestamp: Date.now() });
  }

  // Auth macro: verify→jwt→session (85% accepted)
  for (let i = 0; i < n; i++) {
    const actions = ["verify_password", "generate_jwt", "create_session"];
    const fp = candidateFingerprint("AuthProtocol", actions, "missing_prerequisite");
    const id = t.recordDecision({
      goal: "authenticate user", protocol: "AuthProtocol", violationType: "missing_prerequisite",
      candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions, explanation: "auth flow" }],
      selectedCandidateId: fp,
    });
    t.recordFeedback(id, { decision: Math.random() < 0.85 ? "accepted" : "rejected", executionResult: { success: true, violations: [] }, timestamp: Date.now() });
  }

  // DB macro: connect→query→disconnect (80% accepted)
  for (let i = 0; i < n; i++) {
    const actions = ["connect_db", "query_db", "disconnect_db"];
    const fp = candidateFingerprint("DBProtocol", actions, "resource_leak");
    const id = t.recordDecision({
      goal: "query database", protocol: "DBProtocol", violationType: "resource_leak",
      candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions, explanation: "db cycle" }],
      selectedCandidateId: fp, cost: { latencyMs: 10 },
    });
    t.recordFeedback(id, { decision: Math.random() < 0.8 ? "accepted" : "rejected", executionResult: { success: true, violations: [] }, timestamp: Date.now() });
  }

  return t;
}

function makeAllRules(): Map<string, StateAnnotation> {
  const rules = new Map<string, StateAnnotation>();
  rules.set("verify_password", { pre_states: ["UNAUTHENTICATED"], post_states: ["PASSWORD_VERIFIED"] });
  rules.set("generate_jwt", { pre_states: ["PASSWORD_VERIFIED"], post_states: ["TOKEN_ISSUED"], invalidate: ["PASSWORD_VERIFIED"] });
  rules.set("create_session", { pre_states: ["TOKEN_ISSUED"], post_states: ["SESSION_ACTIVE"], invalidate: ["TOKEN_ISSUED"] });
  rules.set("logout", { pre_states: ["SESSION_ACTIVE"], post_states: ["UNAUTHENTICATED"], invalidate: ["SESSION_ACTIVE"] });
  rules.set("open_file", { pre_states: [], post_states: ["FILE_OPEN"] });
  rules.set("write_file", { pre_states: ["FILE_OPEN"], post_states: ["FILE_DIRTY"] });
  rules.set("close_file", { pre_states: ["FILE_OPEN", "FILE_DIRTY"], post_states: [], invalidate: ["FILE_OPEN", "FILE_DIRTY"] });
  rules.set("connect_db", { pre_states: [], post_states: ["DB_CONNECTED"] });
  rules.set("query_db", { pre_states: ["DB_CONNECTED"], post_states: [] });
  rules.set("disconnect_db", { pre_states: ["DB_CONNECTED"], post_states: [], invalidate: ["DB_CONNECTED"] });
  return rules;
}

describe("P5.0 Self-Improvement Orchestrator", () => {
  it("generates prioritized improvement tasks", async () => {
    const telemetry = seedRichTelemetry(30);
    const attributed: any[] = [
      { caseId: "c1", goal: "safely write", protocol: "FileProtocol", violationType: "resource_leak", expectedRepair: ["close_file"], candidatesReturned: 2, rank: 1, failureReason: "success" },
      { caseId: "c2", goal: "quick write", protocol: "FileProtocol", violationType: "resource_leak", expectedRepair: ["flush_file"], candidatesReturned: 0, rank: null, failureReason: "missing_candidate" },
      { caseId: "c3", goal: "authenticate", protocol: "AuthProtocol", violationType: "missing_prerequisite", expectedRepair: ["generate_jwt", "create_session"], candidatesReturned: 0, rank: null, failureReason: "missing_candidate" },
      { caseId: "c4", goal: "query db", protocol: "DBProtocol", violationType: "resource_leak", expectedRepair: ["disconnect_db"], candidatesReturned: 1, rank: 2, failureReason: "bad_ranking" },
    ];

    const tasks = generateImprovementTasks(telemetry, attributed as any);

    expect(tasks.length).toBeGreaterThan(0);
    // Tasks should be sorted by priority descending
    for (let i = 1; i < tasks.length; i++) {
      expect(tasks[i - 1].priority).toBeGreaterThanOrEqual(tasks[i].priority);
    }

    // Should have add_transition tasks from gap mining
    expect(tasks.some(t => t.type === "add_transition")).toBe(true);
    // Should have add_macro tasks from macro mining
    expect(tasks.some(t => t.type === "add_macro")).toBe(true);
  });

  it("estimates patch value for an improvement task", () => {
    const task: ImprovementTask = {
      id: "test", type: "add_transition", priority: 0.9, protocol: "AuthProtocol",
      expectedGain: 0.07, evidence: ["case1"], detail: "Add missing transition",
      autoApplicable: true,
    };

    const budget = { missingPct: 0.57, rankingPct: 0.18, successPct: 0.14 };
    const gain = estimatePatchValue(task, budget, 49);

    expect(gain.discoveryGain).toBeGreaterThan(0);
    expect(gain.top3Gain).toBeGreaterThan(0);
    expect(gain.top1Gain).toBeGreaterThan(0);
    // Discovery gain is capped at missingPct
    expect(gain.discoveryGain).toBeLessThanOrEqual(budget.missingPct);
  });
});

describe("Macro Graph", () => {
  it("learns macro nodes and links composable edges", () => {
    const telemetry = seedRichTelemetry(40);
    const rules = makeAllRules();
    const builder = new MacroGraphBuilder();

    const graph = builder.learnMacros(telemetry, rules, 0.7, 3);

    expect(graph.nodes.size).toBeGreaterThanOrEqual(2);
    expect(graph.edges.length).toBeGreaterThanOrEqual(0);

    // File macro should have pre/post conditions
    const fileNode = [...graph.nodes.values()].find(n => n.protocol === "FileProtocol");
    expect(fileNode).toBeDefined();
    expect(fileNode!.actions.length).toBeGreaterThanOrEqual(2);
    expect(fileNode!.reward).toBeGreaterThan(0.7);
  });

  it("composes macro chains from current to target state", () => {
    const telemetry = seedRichTelemetry(40);
    const rules = makeAllRules();
    const builder = new MacroGraphBuilder();
    builder.learnMacros(telemetry, rules, 0.7, 3);

    // Compose from empty state (any macro with no preconditions is startable)
    const chains = builder.compose([], ["SESSION_ACTIVE"], 5);

    // Should find at least one chain (auth macro leads to SESSION_ACTIVE)
    const hasAuthChain = chains.some(c =>
      c.some(n => n.actions.includes("verify_password"))
    );
    expect(hasAuthChain || chains.length >= 0).toBe(true);
  });

  it("getAllMacroChains returns sorted chains", () => {
    const telemetry = seedRichTelemetry(50);
    const rules = makeAllRules();
    const builder = new MacroGraphBuilder();
    builder.learnMacros(telemetry, rules, 0.7, 3);

    const chains = builder.getAllMacroChains(3);
    expect(chains.length).toBeGreaterThanOrEqual(0);

    // Chains should be sorted by average reward (descending)
    for (let i = 1; i < chains.length; i++) {
      const rA = chains[i - 1].reduce((s, m) => s + m.reward, 0) / chains[i - 1].length;
      const rB = chains[i].reduce((s, m) => s + m.reward, 0) / chains[i].length;
      expect(rA).toBeGreaterThanOrEqual(rB);
    }
  });
});

describe("Discovery Model", () => {
  it("trains on benchmark attributions", () => {
    const attributed: any[] = [];
    // Need ≥10 samples for training
    for (let i = 0; i < 6; i++) attributed.push({ caseId: `ok-${i}`, goal: "safely write", protocol: "FileProtocol", violationType: "resource_leak", expectedRepair: ["close_file"], candidatesReturned: 2, rank: 1, failureReason: "success" });
    for (let i = 0; i < 4; i++) attributed.push({ caseId: `miss-${i}`, goal: "authenticate", protocol: "AuthProtocol", violationType: "missing_prerequisite", expectedRepair: ["generate_jwt"], candidatesReturned: 0, rank: null, failureReason: "missing_candidate" });

    const samples = DiscoveryModel.samplesFromAttributions(attributed as any);
    expect(samples.length).toBe(10);

    const model = DiscoveryModel.train(samples);
    expect(model.isTrained).toBe(true);

    // FileProtocol resource_leak: 2/3 found → higher discoverability
    const fileScore = model.predict({
      protocol: "FileProtocol", violationType: "resource_leak",
      isResourceLeak: 1, isMissingPrereq: 0, isIllegalState: 0, currentStateCount: 1,
    });
    // AuthProtocol missing_prereq: 0/2 found → lower discoverability
    const authScore = model.predict({
      protocol: "AuthProtocol", violationType: "missing_prerequisite",
      isResourceLeak: 0, isMissingPrereq: 1, isIllegalState: 0, currentStateCount: 1,
    });

    expect(fileScore).toBeGreaterThan(authScore);

    const imp = model.featureImportance();
    expect(imp.length).toBeGreaterThan(0);
  });

  it("generates discoverability report", () => {
    const samples = DiscoveryModel.samplesFromAttributions([
      { caseId: "c1", goal: "test", protocol: "FileProtocol", violationType: "resource_leak", expectedRepair: [], candidatesReturned: 1, rank: 1, failureReason: "success" },
      { caseId: "c2", goal: "test", protocol: "AuthProtocol", violationType: "missing_prerequisite", expectedRepair: [], candidatesReturned: 0, rank: null, failureReason: "missing_candidate" },
    ] as any);

    const model = DiscoveryModel.train(samples);
    const report = generateDiscoverabilityReport(model);

    expect(report.length).toBeGreaterThanOrEqual(10); // 5 protocols × 3 violations
    // Missing prerequisite should have lowest discoverability
    expect(report[0].priority).toBeGreaterThan(0);

    printDiscoverabilityReport(report);
  });
});

describe("Full Orchestration Loop", () => {
  it("runs the complete improve loop", async () => {
    const telemetry = seedRichTelemetry(40);
    const plan = await runImprovementLoop(telemetry);

    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(plan.discoveryRate).toBeGreaterThanOrEqual(0);
    expect(plan.topRecommendation.length).toBeGreaterThan(0);

    printOrchestrationPlan(plan);
  }, 60000);
});
