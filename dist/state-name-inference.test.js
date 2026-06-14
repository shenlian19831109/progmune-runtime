"use strict";
/**
 * P6.8: State Name Inference Tests
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const state_name_inference_1 = require("./state-name-inference");
const auto_protocol_synthesizer_1 = require("./auto-protocol-synthesizer");
const protocol_coverage_1 = require("./protocol-coverage");
(0, vitest_1.describe)("P6.8 State Name Inference", () => {
    (0, vitest_1.it)("synthesizer generates semantic state names (integrated pipeline)", () => {
        // Use the integrated synthesizer which now calls inferStateName internally
        const protocols = (0, auto_protocol_synthesizer_1.synthesizeAllKnownProtocols)();
        (0, vitest_1.expect)(protocols.length).toBeGreaterThan(0);
        for (const sp of protocols) {
            for (const sr of sp.rules) {
                // Post states should NOT be generic C0_S1 format
                for (const ps of sr.post_states) {
                    if (ps !== "INIT" && !ps.includes("_DONE")) {
                        // Semantic names come from inferStateName: FILE_OPEN, DB_CONNECTED, etc.
                        // or name-derived: DB_S1 (when no hand-written match found)
                        (0, vitest_1.expect)(ps).not.toMatch(/^C\d+_S\d+$/);
                    }
                }
                // Last rule's invalidate should contain semantic state names
                if (sr.invalidate && sr.invalidate.length > 1) {
                    const hasSemantic = sr.invalidate.some(s => s.includes("_OPEN") || s.includes("_CLOSED") || s.includes("_CONNECTED") ||
                        s.includes("_VERIFIED") || s.includes("_ISSUED") || s.includes("_CREATED") ||
                        s.includes("_PRODUCED") || s.includes("_COMPLETED") || s.includes("_READY"));
                    (0, vitest_1.expect)(hasSemantic).toBe(true);
                }
            }
        }
    });
    (0, vitest_1.it)("aligned states use semantically meaningful names", () => {
        const dbSynth = {
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
        const defs = (0, protocol_coverage_1.loadDefaultProtocolDefinitions)();
        const handRules = new Map();
        for (const p of defs)
            for (const [fn, rule] of p.rules)
                handRules.set(fn, rule);
        const aligned = (0, state_name_inference_1.alignSynthesizedProtocols)([dbSynth], handRules);
        const rules = aligned[0].rules;
        // open_file's post_state → FILE_OPEN (matches hand-written open_file rule)
        (0, vitest_1.expect)(rules[0].post_states[0]).toBe("FILE_OPEN");
        // close_file: should invalidate FILE_OPEN (matches hand-written close_file invalidation)
        const closeRule = rules[2];
        (0, vitest_1.expect)(closeRule.invalidate).toBeDefined();
        (0, vitest_1.expect)(closeRule.invalidate.some(s => s.includes("FILE_OPEN") || s.includes("FILE_CLOSED"))).toBe(true);
    });
    (0, vitest_1.it)("full alignment pipeline improves bootstrap overlap", async () => {
        const report = await (0, state_name_inference_1.runStateAlignment)();
        (0, vitest_1.expect)(report.statesAligned).toBeGreaterThan(0);
        // Alignment should maintain or improve function overlap
        (0, vitest_1.expect)(report.afterOverlap).toBeGreaterThanOrEqual(report.beforeOverlap);
        (0, state_name_inference_1.printAlignmentReport)(report);
    }, 30000);
});
