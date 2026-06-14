/**
 * Auto-benchmark Generator + Expanded Bootstrap Tests
 */

import { describe, it, expect } from "vitest";
import { generateExpandedBenchmarks, printExpandedBenchmarkReport, AutoBenchmarkCase } from "./auto-benchmark-generator";
import { runBootstrapValidation, printBootstrapReport } from "./bootstrap-validation";
import { collectTrajectoriesAtScale } from "./scale-trajectory-collector";

describe("Auto-benchmark Generator", () => {
  it("generates 20+ benchmark cases from all sources", () => {
    const suite = generateExpandedBenchmarks();

    expect(suite.totalCases).toBeGreaterThanOrEqual(20);
    expect(suite.bySource["synthesized"]).toBeGreaterThan(0);
    expect(suite.bySource["realworld"]).toBeGreaterThan(0);

    printExpandedBenchmarkReport(suite);
  });

  it("each benchmark case has valid structure", () => {
    const suite = generateExpandedBenchmarks();

    for (const c of suite.cases) {
      expect(c.broken.length).toBeGreaterThan(0);
      expect(c.expected.length).toBeGreaterThan(0);
      expect(c.expected.length).toBeGreaterThan(0);
      expect(c.broken.length).toBeGreaterThan(0);
      expect(["resource_leak", "missing_prerequisite", "illegal_state_transition"]).toContain(c.violationType);
    }
  });
});

describe("Expanded Bootstrap Validation", () => {
  it("with expanded corpus + expanded benchmarks", async () => {
    const { sequences } = collectTrajectoriesAtScale();
    const suite = generateExpandedBenchmarks();

    // Run bootstrap with expanded corpus
    const result = await runBootstrapValidation(undefined, sequences);

    console.log(`\nExpanded Benchmark Suite: ${suite.totalCases} cases`);
    console.log(`Corpus Size: ${sequences.length} sequences`);
    console.log(`Regenerated Rules: ${result.regeneratedRuleCount}`);
    console.log(`Function Overlap: ${(result.functionOverlap * 100).toFixed(0)}%`);
    console.log(`State Overlap: ${(result.stateOverlap * 100).toFixed(0)}%`);
    console.log(`Behavioral: ${result.behavioralMatch}/${result.behavioralTotal}`);

    // With expanded benchmarks, regenerated rules should be substantial
    expect(result.regeneratedRuleCount).toBeGreaterThanOrEqual(5);
    expect(result.functionOverlap).toBeGreaterThan(0.1);
  }, 30000);
});
