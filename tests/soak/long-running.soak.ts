/**
 * Soak Test: Long-Running Stability
 *
 * Runs the Planner continuously for 10 minutes (configurable to 1 hour)
 * to verify no memory leaks or degradation under sustained load.
 *
 * Run with: node --expose-gc node_modules/.bin/vitest run tests/soak/
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { suggestAlternatives } from "../../src/counterfactual-engine";
import { PlannerTelemetry, candidateFingerprint } from "../../src/planner-telemetry";
import { mergeProtocolRules, fileProtocolRules } from "../helpers/protocol-generator";

const SOAK_DIR = path.resolve(__dirname, "..", "..", "test-soak");
process.env.PROGMUNE_PROJECT_DIR = SOAK_DIR;
fs.mkdirSync(SOAK_DIR, { recursive: true });
fs.mkdirSync(path.join(SOAK_DIR, ".progmune_corpus", "telemetry"), { recursive: true });

describe("Soak: Long Running Stability", () => {
  it(
    "runs for 10 minutes without memory leak",
    async () => {
      const rules = mergeProtocolRules(fileProtocolRules);
      const telemetry = new PlannerTelemetry(
        path.join(SOAK_DIR, ".progmune_corpus", "telemetry", `soak-${Date.now()}.jsonl`)
      );

      const durationMs = 10 * 60 * 1000; // 10 minutes
      const intervalMs = 1000;           // 1 request per second
      const steps = Math.floor(durationMs / intervalMs);
      const memorySnapshots: number[] = [];

      for (let i = 0; i < steps; i++) {
        await suggestAlternatives({
          violation: {
            svl: 4, violatedConstraint: "resource_leak", actionIndex: 2,
            currentStates: ["FILE_OPEN"], requiredStates: [],
            description: `soak ${i}: file not closed`,
          },
          protocol: "_global", currentState: ["FILE_OPEN"], targetState: [],
          constraints: [], rules, goal: `soak goal ${i}`,
        });

        // Record feedback every cycle
        const fp = candidateFingerprint("FileProtocol", ["close_file"], "resource_leak");
        const id = telemetry.recordDecision({
          goal: `soak goal ${i}`,
          protocol: "FileProtocol", violationType: "resource_leak",
          candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions: ["close_file"], explanation: "close" }],
          selectedCandidateId: fp,
        });
        telemetry.recordFeedback(id, {
          decision: i % 2 === 0 ? "accepted" : "rejected",
          executionResult: i % 2 === 0 ? { success: true, violations: [] } : undefined,
          timestamp: Date.now(),
        });

        // Memory snapshot every minute (60 iterations at 1s interval)
        if (i % 60 === 0) {
          if (typeof global.gc === "function") global.gc();
          memorySnapshots.push(process.memoryUsage().heapUsed);
        }

        await new Promise(resolve => setTimeout(resolve, intervalMs - 5)); // account for processing time
      }

      // Verify memory growth < 20% over the run
      if (memorySnapshots.length >= 2) {
        const first = memorySnapshots[0];
        const last = memorySnapshots[memorySnapshots.length - 1];
        const growth = (last - first) / Math.max(1, first);
        expect(growth).toBeLessThan(0.2);
      }

      // Verify telemetry is still functional
      const stats = telemetry.getCandidateStats(
        candidateFingerprint("FileProtocol", ["close_file"], "resource_leak")
      );
      expect(stats.accepted).toBeGreaterThan(0);
      expect(stats.rejected).toBeGreaterThan(0);
    },
    15 * 60 * 1000 // 15 minute timeout
  );
});
