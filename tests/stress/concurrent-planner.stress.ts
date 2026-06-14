/**
 * Stress Test: Concurrent Planner Requests
 *
 * Verifies the Planner handles high concurrency without failure
 * and maintains acceptable p95 latency.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { suggestAlternatives } from "../../src/counterfactual-engine";
import { mergeProtocolRules, fileProtocolRules } from "../helpers/protocol-generator";

const STRESS_DIR = path.resolve(__dirname, "..", "..", "test-stress-concurrent");
process.env.PROGMUNE_PROJECT_DIR = STRESS_DIR;
fs.mkdirSync(STRESS_DIR, { recursive: true });

describe("Stress: Concurrent Planner Requests", () => {
  it("handles 100 concurrent requests without failure", async () => {
    const rules = mergeProtocolRules(fileProtocolRules);

    const promises = Array.from({ length: 100 }, (_, i) =>
      suggestAlternatives({
        violation: {
          svl: 4, violatedConstraint: "resource_leak", actionIndex: 2,
          currentStates: ["FILE_OPEN"], requiredStates: [],
          description: `stress ${i}: file not closed`,
        },
        protocol: "_global", currentState: ["FILE_OPEN"], targetState: [],
        constraints: [], rules, goal: `stress goal ${i}`,
      })
    );

    const results = await Promise.all(promises);
    expect(results.length).toBe(100);

    for (const r of results) {
      expect(Array.isArray(r)).toBe(true);
    }
  });

  it("p95 latency under 200ms for file protocol repair", async () => {
    const rules = mergeProtocolRules(fileProtocolRules);
    const latencies: number[] = [];

    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      await suggestAlternatives({
        violation: {
          svl: 4, violatedConstraint: "resource_leak", actionIndex: 1,
          currentStates: ["FILE_OPEN"], requiredStates: [],
          description: `latency test ${i}`,
        },
        protocol: "_global", currentState: ["FILE_OPEN"], targetState: [],
        constraints: [], rules, goal: "close file",
      });
      latencies.push(performance.now() - start);
    }

    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    expect(p95).toBeLessThan(200);
  });
});
