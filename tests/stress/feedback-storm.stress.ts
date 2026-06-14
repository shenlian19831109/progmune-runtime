/**
 * Stress Test: Feedback Storm
 *
 * Verifies Telemetry handles massive write throughput
 * and doesn't leak memory under sustained load.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { PlannerTelemetry, candidateFingerprint } from "../../src/planner-telemetry";

const STORM_DIR = path.resolve(__dirname, "..", "..", "test-stress-feedback");
process.env.PROGMUNE_PROJECT_DIR = STORM_DIR;
fs.mkdirSync(STORM_DIR, { recursive: true });
fs.mkdirSync(path.join(STORM_DIR, ".progmune_corpus", "telemetry"), { recursive: true });

describe("Stress: Feedback Storm", () => {
  it("sustains 1000 feedback writes with acceptable throughput", () => {
    const telemetry = new PlannerTelemetry(
      path.join(STORM_DIR, ".progmune_corpus", "telemetry", `storm-${Date.now()}.jsonl`)
    );

    const total = 1000;
    const start = Date.now();

    for (let i = 0; i < total; i++) {
      const fp = candidateFingerprint("Test", [`action_${i}`], "stress");
      const id = telemetry.recordDecision({
        goal: `storm goal ${i}`,
        protocol: "Test",
        candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions: [`action_${i}`], explanation: `test ${i}` }],
        selectedCandidateId: fp,
      });
      telemetry.recordFeedback(id, {
        decision: i % 2 === 0 ? "accepted" : "rejected",
        timestamp: Date.now(),
      });
    }

    const duration = Date.now() - start;
    const rate = total / Math.max(1, duration / 1000);

    // With JSONL file I/O: baseline throughput (regression check)
    expect(rate).toBeGreaterThan(30);
  }, 60000);

  it("does not leak memory after 5000 writes", () => {
    const telemetry = new PlannerTelemetry(
      path.join(STORM_DIR, ".progmune_corpus", "telemetry", `mem-${Date.now()}.jsonl`)
    );

    const initialMem = process.memoryUsage().heapUsed;

    for (let i = 0; i < 5000; i++) {
      const fp = candidateFingerprint("MemTest", [`mem_fn_${i}`], "stress");
      const id = telemetry.recordDecision({
        goal: `mem goal ${i}`,
        protocol: "MemTest",
        candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions: [`mem_fn_${i}`], explanation: `mem ${i}` }],
      });
      telemetry.recordFeedback(id, { decision: "accepted", timestamp: Date.now() });
    }

    const afterMem = process.memoryUsage().heapUsed;
    const deltaMB = (afterMem - initialMem) / (1024 * 1024);

    expect(deltaMB).toBeLessThan(50);
  }, 120000);
});
