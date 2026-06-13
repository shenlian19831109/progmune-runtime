/**
 * P6.8: State Name Inference Tests
 */

import { describe, it, expect } from "vitest";
import { alignSynthesizedProtocols, runStateAlignment, printAlignmentReport } from "./state-name-inference";
import { synthesizeAllKnownProtocols, SynthesizedProtocol, SynthesizedRule } from "./auto-protocol-synthesizer";
import { loadDefaultProtocolDefinitions } from "./protocol-coverage";
import type { StateAnnotation } from "./ssg-validator";

describe("P6.8 State Name Inference", () => {
  it("synthesizer generates semantic state names (integrated pipeline)", () => {
    // Use the integrated synthesizer which now calls inferStateName internally
    const protocols = synthesizeAllKnownProtocols();

    expect(protocols.length).toBeGreaterThan(0);

    for (const sp of protocols) {
      for (const sr of sp.rules) {
        // Post states should NOT be generic C0_S1 format
        for (const ps of sr.post_states) {
          if (ps !== "INIT" && !ps.includes("_DONE")) {
            // Semantic names come from inferStateName: FILE_OPEN, DB_CONNECTED, etc.
            // or name-derived: DB_S1 (when no hand-written match found)
            expect(ps).not.toMatch(/^C\d+_S\d+$/);
          }
        }
        // Last rule's invalidate should contain semantic state names
        if (sr.invalidate && sr.invalidate.length > 1) {
          const hasSemantic = sr.invalidate.some(s =>
            s.includes("_OPEN") || s.includes("_CLOSED") || s.includes("_CONNECTED") ||
            s.includes("_VERIFIED") || s.includes("_ISSUED") || s.includes("_CREATED") ||
            s.includes("_PRODUCED") || s.includes("_COMPLETED") || s.includes("_READY")
          );
          expect(hasSemantic).toBe(true);
        }
      }
    }
  });

  it("aligned states use semantically meaningful names", () => {
    const dbSynth: SynthesizedProtocol = {
      clusterId: "DB",
      prototype: ["open_file", "write_file", "close_file"],
      rules: [
        { function: "open_file", pre_states: ["INIT"], post_states: ["DB_S1"] },
        { function: "write_file", pre_states: ["DB_S1"], post_states: ["DB_S2"] },
        { function: "close_file", pre_states: ["DB_S2"], post_states: ["DB_DONE"], invalidate: ["DB_S1", "DB_S2"] },
      ],
      stateCount: 4,
      inferredPattern: "RESOURCE_ACQUIRE",
      confidence: 1.0,
    };

    const defs = loadDefaultProtocolDefinitions();
    const handRules = new Map<string, StateAnnotation>();
    for (const p of defs) for (const [fn, rule] of p.rules) handRules.set(fn, rule);

    const aligned = alignSynthesizedProtocols([dbSynth], handRules);
    const rules = aligned[0].rules;

    // open_file's post_state → FILE_OPEN (matches hand-written open_file rule)
    expect(rules[0].post_states[0]).toBe("FILE_OPEN");

    // close_file: should invalidate FILE_OPEN (matches hand-written close_file invalidation)
    const closeRule = rules[2];
    expect(closeRule.invalidate).toBeDefined();
    expect(closeRule.invalidate!.some(s => s.includes("FILE_OPEN") || s.includes("FILE_CLOSED"))).toBe(true);
  });

  it("full alignment pipeline improves bootstrap overlap", async () => {
    const report = await runStateAlignment();

    expect(report.statesAligned).toBeGreaterThan(0);
    // Alignment should maintain or improve function overlap
    expect(report.afterOverlap).toBeGreaterThanOrEqual(report.beforeOverlap);

    printAlignmentReport(report);
  }, 30000);
});
