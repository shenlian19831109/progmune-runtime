/**
 * P4.5-4.7: Guided Frontier + Macro Mining + Discovery Analytics Tests
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { guidedSearch, guidedSearchMulti } from "./guided-frontier";
import { mineMacroRepairs, saveMacroRepairs, loadMacroRepairs, printMacroReport, MacroRepair } from "./macro-repair";
import { computeDiscoveryMetrics, generateFullAnalyticsReport, printDiscoveryDashboard } from "./discovery-analytics";
import { PlannerTelemetry, candidateFingerprint } from "./planner-telemetry";
import type { StateAnnotation } from "./ssg-validator";
import type { AttributedCase } from "./evaluation-campaign";

function mergeProtocolRules(...maps: Map<string, StateAnnotation>[]): Map<string, StateAnnotation> {
  const m = new Map<string, StateAnnotation>();
  for (const mp of maps) for (const [k, v] of mp) m.set(k, v);
  return m;
}
const fileRules = new Map<string, StateAnnotation>([
  ["open_file", { pre_states: [], post_states: ["FILE_OPEN"] }],
  ["write_file", { pre_states: ["FILE_OPEN"], post_states: [] }],
  ["close_file", { pre_states: ["FILE_OPEN"], post_states: [], invalidate: ["FILE_OPEN"] }],
]);
const authRules = new Map<string, StateAnnotation>([
  ["verify_password", { pre_states: ["UNAUTHENTICATED"], post_states: ["PASSWORD_VERIFIED"] }],
  ["generate_jwt", { pre_states: ["PASSWORD_VERIFIED"], post_states: ["TOKEN_ISSUED"], invalidate: ["PASSWORD_VERIFIED"] }],
  ["create_session", { pre_states: ["TOKEN_ISSUED"], post_states: ["SESSION_ACTIVE"], invalidate: ["TOKEN_ISSUED"] }],
  ["logout", { pre_states: ["SESSION_ACTIVE"], post_states: ["UNAUTHENTICATED"], invalidate: ["SESSION_ACTIVE"] }],
]);
const dbRules = new Map<string, StateAnnotation>([
  ["connect_db", { pre_states: [], post_states: ["DB_CONNECTED"] }],
  ["query_db", { pre_states: ["DB_CONNECTED"], post_states: [] }],
  ["disconnect_db", { pre_states: ["DB_CONNECTED"], post_states: [], invalidate: ["DB_CONNECTED"] }],
]);

const OPT_DIR = path.resolve(__dirname, "..", "test-discovery-optimize");
process.env.PROGMUNE_PROJECT_DIR = OPT_DIR;
fs.mkdirSync(OPT_DIR, { recursive: true });
fs.mkdirSync(path.join(OPT_DIR, ".progmune_corpus", "telemetry"), { recursive: true });

function seedHighAcceptanceTelemetry(n: number): PlannerTelemetry {
  const t = new PlannerTelemetry(path.join(OPT_DIR, ".progmune_corpus", "telemetry", `opt-${Date.now()}.jsonl`));

  // Pattern: "open_file → write_file → close_file" accepted 90% of the time
  for (let i = 0; i < n; i++) {
    const actions = ["open_file", "write_file", "close_file"];
    const fp = candidateFingerprint("FileProtocol", actions, "resource_leak");
    const id = t.recordDecision({
      goal: "safely write config file",
      protocol: "FileProtocol", violationType: "resource_leak",
      candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions, explanation: "full sequence" }],
      selectedCandidateId: fp,
      cost: { latencyMs: 3 + Math.random() * 5 },
    });
    const accepted = Math.random() < 0.9;
    t.recordFeedback(id, {
      decision: accepted ? "accepted" : "rejected",
      executionResult: accepted ? { success: true, violations: [] } : { success: false, violations: ["resource_leak"] },
      timestamp: Date.now(),
    });
  }

  // Auth pattern: accepted 85%
  for (let i = 0; i < n; i++) {
    const actions = ["verify_password", "generate_jwt", "create_session"];
    const fp = candidateFingerprint("AuthProtocol", actions, "missing_prerequisite");
    const id = t.recordDecision({
      goal: "authenticate user",
      protocol: "AuthProtocol", violationType: "missing_prerequisite",
      candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions, explanation: "auth flow" }],
      selectedCandidateId: fp,
    });
    const accepted = Math.random() < 0.85;
    t.recordFeedback(id, {
      decision: accepted ? "accepted" : "rejected",
      executionResult: accepted ? { success: true, violations: [] } : undefined,
      timestamp: Date.now(),
    });
  }

  return t;
}

describe("P4.5 Reward-Guided Frontier", () => {
  it("guided search finds paths with priority ordering", () => {
    const rules = mergeProtocolRules(authRules, fileRules, dbRules);

    const paths = guidedSearch(rules, ["UNAUTHENTICATED"], ["SESSION_ACTIVE"]);

    expect(paths.length).toBeGreaterThan(0);
    // Should find auth path
    const hasAuth = paths.some(p =>
      p.actions.includes("verify_password") && p.actions.includes("generate_jwt")
    );
    expect(hasAuth).toBe(true);

    // Paths should be sorted by priority (descending)
    for (let i = 1; i < paths.length; i++) {
      expect(paths[i - 1].priority).toBeGreaterThanOrEqual(paths[i].priority);
    }
  });

  it("multi-start finds paths from different initial states", () => {
    const rules = mergeProtocolRules(fileRules, authRules);

    const paths = guidedSearchMulti(rules, [
      ["FILE_OPEN"],
      ["UNAUTHENTICATED"],
    ], ["SESSION_ACTIVE"]);

    expect(paths.length).toBeGreaterThan(0);
    // Should include paths from both starting points
    expect(paths.every(p => p.found)).toBe(true);
  });
});

describe("P4.6 Macro Repair Mining", () => {
  it("mines high-acceptance patterns from telemetry", () => {
    const telemetry = seedHighAcceptanceTelemetry(50);

    const macros = mineMacroRepairs(telemetry, 0.7, 3);

    expect(macros.length).toBeGreaterThanOrEqual(1);

    // File repair pattern should be mined
    const fileMacro = macros.find(m => m.protocol === "FileProtocol");
    expect(fileMacro).toBeDefined();
    expect(fileMacro!.acceptanceRate).toBeGreaterThan(0.7);
    expect(fileMacro!.actions).toEqual(["open_file", "write_file", "close_file"]);

    printMacroReport(macros);
  });

  it("persists and loads macros", () => {
    const telemetry = seedHighAcceptanceTelemetry(60);
    const mined = mineMacroRepairs(telemetry, 0.7, 3);

    const fp = saveMacroRepairs(mined);
    expect(fs.existsSync(fp)).toBe(true);

    const loaded = loadMacroRepairs();
    expect(loaded.length).toBeGreaterThanOrEqual(mined.length);
  });

  it("filters out low-frequency patterns", () => {
    const telemetry = new PlannerTelemetry(
      path.join(OPT_DIR, ".progmune_corpus", "telemetry", `lowfreq-${Date.now()}.jsonl`)
    );
    // Only 2 samples — below minFrequency=3
    for (let i = 0; i < 2; i++) {
      const fp = candidateFingerprint("FileProtocol", ["close_file"], "resource_leak");
      const id = telemetry.recordDecision({
        goal: "test", protocol: "FileProtocol",
        candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions: ["close_file"], explanation: "close" }],
        selectedCandidateId: fp,
      });
      telemetry.recordFeedback(id, { decision: "accepted", executionResult: { success: true, violations: [] }, timestamp: Date.now() });
    }

    const macros = mineMacroRepairs(telemetry, 0.7, 3);
    expect(macros.length).toBe(0); // not enough frequency
  });
});

describe("P4.7 Discovery Analytics", () => {
  it("computes discovery metrics from attributions", () => {
    const attributed: AttributedCase[] = [
      { caseId: "c1", goal: "safely write", protocol: "FileProtocol", violationType: "resource_leak", expectedRepair: ["close_file"], candidatesReturned: 2, rank: 1, failureReason: "success" },
      { caseId: "c2", goal: "safely write", protocol: "FileProtocol", violationType: "resource_leak", expectedRepair: ["close_file"], candidatesReturned: 1, rank: null, failureReason: "bad_ranking" },
      { caseId: "c3", goal: "authenticate", protocol: "AuthProtocol", violationType: "missing_prerequisite", expectedRepair: ["generate_jwt"], candidatesReturned: 0, rank: null, failureReason: "missing_candidate" },
      { caseId: "c4", goal: "logout user", protocol: "AuthProtocol", violationType: "illegal_state_transition", expectedRepair: ["logout"], candidatesReturned: 0, rank: null, failureReason: "missing_candidate" },
    ];

    const metrics = computeDiscoveryMetrics(attributed);

    expect(metrics.totalCases).toBe(4);
    expect(metrics.overall).toBe(0.5); // 2/4 discovered

    // FileProtocol: 2/2 discovered
    expect(metrics.byProtocol["FileProtocol"]).toBe(1.0);
    // AuthProtocol: 0/2 discovered
    expect(metrics.byProtocol["AuthProtocol"]).toBe(0);

    // resource_leak: 2/2, missing_prerequisite: 0/1, illegal_state_transition: 0/1
    expect(metrics.byViolation["resource_leak"]).toBe(1.0);
    expect(metrics.byViolation["missing_prerequisite"]).toBe(0);
  });

  it("generates full analytics report", async () => {
    const telemetry = seedHighAcceptanceTelemetry(30);
    const report = await generateFullAnalyticsReport(telemetry);

    expect(report.discovery.totalCases).toBeGreaterThanOrEqual(49);
    expect(report.macroCount).toBeGreaterThanOrEqual(1);
    expect(report.topMacros.length).toBeGreaterThanOrEqual(1);

    printDiscoveryDashboard(report);
  });
});
