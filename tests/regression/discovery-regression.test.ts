/**
 * Discovery Rate Regression Gate
 *
 * Ensures core metrics don't regress below established baselines.
 * These are the canary tests that alert if the system degrades.
 */
import { describe, it, expect } from "vitest";
import { runRealWorldBenchmark } from "../../src/realworld-benchmark";
import { suggestAlternatives } from "../../src/counterfactual-engine";
import { parseProtocolsFromJSON } from "../../src/ssg-validator";
import type { StateAnnotation } from "../../src/ssg-validator";
import * as fs from "fs";
import * as path from "path";

describe("Regression: Discovery Rate", () => {
  it("resource_leak repair: close_file is found", async () => {
    const protoDef = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "..", "..", "protocols.json"), "utf-8")
    );
    const protocols = parseProtocolsFromJSON(protoDef);
    const rules = new Map<string, StateAnnotation>();
    for (const p of protocols) rules.set(p.function, p.protocol);

    const alts = await suggestAlternatives({
      violation: { svl: 4, violatedConstraint: "resource_leak", actionIndex: 2, currentStates: ["FILE_OPEN"], requiredStates: [], description: "File not closed" },
      protocol: "_global", currentState: ["FILE_OPEN"], targetState: [],
      constraints: [], rules, goal: "close file",
    });

    // Regression gate: close_file MUST be found (this was the first capability we proved)
    const hasClose = alts.some(a => a.fixPath.includes("close_file"));
    expect(hasClose).toBe(true);
  });

  it("Real-world Top-3 repair rate ≥ 60%", async () => {
    const report = await runRealWorldBenchmark();
    // Floor: must not regress below 60%
    expect(report.top3RepairRate).toBeGreaterThan(0.60);
  });

  it("Real-world detection rate ≥ 90%", async () => {
    const report = await runRealWorldBenchmark();
    // Floor: must find at least one candidate for 90% of real-world defects
    expect(report.detectionRate).toBeGreaterThan(0.90);
  });
});
