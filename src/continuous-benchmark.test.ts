/**
 * P5.4: Continuous Benchmark Expansion Tests
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { generateBenchmarksFromPatches, generateBenchmarksFromSkills, runContinuousBenchmark, printContinuousBenchmarkReport } from "./continuous-benchmark";
import { KnowledgePatchStore } from "./knowledge-governance";
import { SkillLibrary } from "./skill-library";
import { PlannerTelemetry, candidateFingerprint } from "./planner-telemetry";
import type { StateAnnotation } from "./ssg-validator";

const CB_DIR = path.resolve(__dirname, "..", "test-continuous-benchmark");
process.env.PROGMUNE_PROJECT_DIR = CB_DIR;
fs.mkdirSync(CB_DIR, { recursive: true });
fs.mkdirSync(path.join(CB_DIR, ".progmune_corpus", "telemetry"), { recursive: true });
fs.mkdirSync(path.join(CB_DIR, ".progmune_corpus", "knowledge"), { recursive: true });
fs.mkdirSync(path.join(CB_DIR, ".progmune_corpus", "skills"), { recursive: true });

describe("Continuous Benchmark Expansion", () => {
  it("generates benchmarks from approved patches", () => {
    const store = new KnowledgePatchStore(
      path.join(CB_DIR, ".progmune_corpus", "knowledge", `cb-patches-${Date.now()}.json`)
    );

    // Approve a patch
    const patch = store.propose({
      from: "FILE_OPEN", to: "FILE_DIRTY", action: "open_file → write_file",
      protocol: "FileProtocol", confidence: 1.0, evidenceCount: 10, examples: ["test"],
      validation: { benchmarkSupport: 10, trajectorySupport: 10, contradictionCount: 0, status: "verified" },
    });
    store.approve(patch.id, { top1Before: 0.5, top1After: 0.6, top3Before: 0.7, top3After: 0.8 });

    const cases = generateBenchmarksFromPatches(store);
    expect(cases.length).toBeGreaterThanOrEqual(1);
    expect(cases[0].source).toBe("patch");
  });

  it("generates benchmarks from skills", () => {
    const rules = new Map<string, StateAnnotation>();
    rules.set("open_file", { pre_states: [], post_states: ["FILE_OPEN"] });
    rules.set("write_file", { pre_states: ["FILE_OPEN"], post_states: [] });
    rules.set("close_file", { pre_states: ["FILE_OPEN"], post_states: [], invalidate: ["FILE_OPEN"] });

    const telemetry = new PlannerTelemetry(
      path.join(CB_DIR, ".progmune_corpus", "telemetry", `cb-skills-${Date.now()}.jsonl`)
    );

    // Seed with high-confidence file skill
    for (let i = 0; i < 15; i++) {
      const a = ["open_file", "write_file", "close_file"];
      const fp = candidateFingerprint("FileProtocol", a, "resource_leak");
      const id = telemetry.recordDecision({
        goal: "safely write", protocol: "FileProtocol", violationType: "resource_leak",
        candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions: a, explanation: "full" }],
        selectedCandidateId: fp,
      });
      telemetry.recordFeedback(id, { decision: "accepted", executionResult: { success: true, violations: [] }, timestamp: Date.now() });
    }

    const lib = new SkillLibrary();
    lib.learn(telemetry, rules);
    expect(lib.size).toBeGreaterThanOrEqual(1);

    const cases = generateBenchmarksFromSkills(lib);
    expect(cases.length).toBeGreaterThanOrEqual(1);
    expect(cases[0].source).toBe("skill");
    // Resource cleanup variant should also be generated
    expect(cases.some(c => c.violationType === "resource_leak")).toBe(true);
  });

  it("runs continuous benchmark pipeline", async () => {
    const rules = new Map<string, StateAnnotation>();
    rules.set("open_file", { pre_states: [], post_states: ["FILE_OPEN"] });
    rules.set("write_file", { pre_states: ["FILE_OPEN"], post_states: [] });
    rules.set("close_file", { pre_states: ["FILE_OPEN"], post_states: [], invalidate: ["FILE_OPEN"] });

    const telemetry = new PlannerTelemetry(
      path.join(CB_DIR, ".progmune_corpus", "telemetry", `cb-full-${Date.now()}.jsonl`)
    );

    for (let i = 0; i < 20; i++) {
      const a = ["open_file", "write_file", "close_file"];
      const fp = candidateFingerprint("FileProtocol", a, "resource_leak");
      const id = telemetry.recordDecision({
        goal: "safely write", protocol: "FileProtocol", violationType: "resource_leak",
        candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions: a, explanation: "full" }],
        selectedCandidateId: fp,
      });
      telemetry.recordFeedback(id, { decision: "accepted", executionResult: { success: true, violations: [] }, timestamp: Date.now() });
    }

    const lib = new SkillLibrary();
    lib.learn(telemetry, rules);

    const store = new KnowledgePatchStore(
      path.join(CB_DIR, ".progmune_corpus", "knowledge", `cb-run-${Date.now()}.json`)
    );

    const report = await runContinuousBenchmark(store, lib, path.join(CB_DIR, "expanded-benchmarks"));

    expect(report.generatedCases).toBeGreaterThanOrEqual(2);
    expect(report.sourceBreakdown.skills).toBeGreaterThanOrEqual(1);

    printContinuousBenchmarkReport(report);
  }, 60000);
});
