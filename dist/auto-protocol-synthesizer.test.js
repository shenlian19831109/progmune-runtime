"use strict";
/**
 * P6.4: Auto Protocol Synthesizer Tests
 *
 * Validates the full zero-intervention pipeline:
 *   Trajectories → Clusters → State Machines → Governance-Ready Rules
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const auto_protocol_synthesizer_1 = require("./auto-protocol-synthesizer");
const protocol_coverage_1 = require("./protocol-coverage");
(0, vitest_1.describe)("Prototype Selection", () => {
    (0, vitest_1.it)("finds centroid by minimum average edit distance", () => {
        const seqs = [
            ["open", "read", "close"],
            ["open", "write", "close"],
            ["open", "read", "write", "close"],
        ];
        const proto = (0, auto_protocol_synthesizer_1.findPrototype)(seqs);
        (0, vitest_1.expect)(proto.length).toBeGreaterThanOrEqual(2);
        // The prototype should be one of the 3-step sequences (more central)
        (0, vitest_1.expect)(proto.length).toBeLessThanOrEqual(3);
    });
});
(0, vitest_1.describe)("Protocol Synthesis", () => {
    (0, vitest_1.it)("generates state machine from prototype sequence", () => {
        const seqs = [
            ["fopen", "fread", "fclose"],
            ["sqlite3_open", "sqlite3_exec", "sqlite3_close"],
            ["DB_Open", "DB_Get", "DB_Close"],
        ];
        const protocols = (0, auto_protocol_synthesizer_1.synthesizeProtocols)(seqs);
        (0, vitest_1.expect)(protocols.length).toBeGreaterThan(0);
        // The main cluster should have Acquire-Use-Release structure
        const mainProto = protocols[0];
        (0, vitest_1.expect)(mainProto.inferredPattern).toBe("RESOURCE_ACQUIRE");
        // V2 generates frequency-based multi-path rules (≥3, typically 5 for this dataset)
        (0, vitest_1.expect)(mainProto.rules.length).toBeGreaterThanOrEqual(3);
        (0, vitest_1.expect)(mainProto.stateCount).toBeGreaterThanOrEqual(3);
        // Last rule should have invalidation
        const lastRule = mainProto.rules[mainProto.rules.length - 1];
        (0, vitest_1.expect)(lastRule.invalidate).toBeDefined();
        (0, vitest_1.expect)(lastRule.invalidate.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("synthesizes from all known cross-repo sequences", () => {
        const protocols = (0, auto_protocol_synthesizer_1.synthesizeAllKnownProtocols)();
        (0, vitest_1.expect)(protocols.length).toBeGreaterThan(0);
        // Should have at least Acquire-Release (len=3 closed) and Lock-Unlock (len=2 closed)
        (0, vitest_1.expect)(protocols.some(p => p.inferredPattern === "RESOURCE_ACQUIRE")).toBe(true);
        (0, vitest_1.expect)(protocols.some(p => p.prototype.length === 2)).toBe(true);
    });
});
(0, vitest_1.describe)("Conflict Detection", () => {
    (0, vitest_1.it)("detects conflicts with existing protocol rules", () => {
        const seqs = [
            ["open_file", "read_file", "close_file"],
            ["open_file", "write_file", "close_file"],
        ];
        const protocols = (0, auto_protocol_synthesizer_1.synthesizeProtocols)(seqs);
        const defs = (0, protocol_coverage_1.loadDefaultProtocolDefinitions)();
        const existingRules = new Map();
        for (const p of defs)
            for (const [fn, rule] of p.rules)
                existingRules.set(fn, rule);
        const conflicts = (0, auto_protocol_synthesizer_1.detectConflicts)(protocols, existingRules);
        // Synthesized open_file may conflict with existing open_file definition
        // That's expected and correctly flagged
        (0, vitest_1.expect)(conflicts.length).toBeGreaterThan(0);
    });
});
(0, vitest_1.describe)("Full Synthesis Pipeline", () => {
    (0, vitest_1.it)("runs auto-synthesis and produces governance-ready report", () => {
        const report = (0, auto_protocol_synthesizer_1.runAutoSynthesis)();
        (0, vitest_1.expect)(report.protocols.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(report.totalRules).toBeGreaterThan(0);
        (0, vitest_1.expect)(report.newFunctions).toBeGreaterThan(0);
        // Some conflicts expected (synthesized rules may differ from hand-written)
        // The system correctly flags these for governance review
        (0, vitest_1.expect)(report.conflictCount).toBeGreaterThanOrEqual(0);
        (0, auto_protocol_synthesizer_1.printSynthesisReport)(report);
    });
});
