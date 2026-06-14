"use strict";
/**
 * P3.18-20: Transition Synthesizer Tests
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const transition_synthesizer_1 = require("./transition-synthesizer");
function makeProtocols() {
    const rules = new Map();
    rules.set("verify_password", { pre_states: ["UNAUTHENTICATED"], post_states: ["PASSWORD_VERIFIED"] });
    rules.set("generate_jwt", { pre_states: ["PASSWORD_VERIFIED"], post_states: ["TOKEN_ISSUED"], invalidate: ["PASSWORD_VERIFIED"] });
    rules.set("create_session", { pre_states: ["TOKEN_ISSUED"], post_states: ["SESSION_ACTIVE"], invalidate: ["TOKEN_ISSUED"] });
    rules.set("logout", { pre_states: ["SESSION_ACTIVE"], post_states: ["UNAUTHENTICATED"], invalidate: ["SESSION_ACTIVE"] });
    rules.set("open_file", { pre_states: [], post_states: ["FILE_OPEN"] });
    rules.set("write_file", { pre_states: ["FILE_OPEN"], post_states: ["FILE_DIRTY"] });
    rules.set("flush_file", { pre_states: ["FILE_DIRTY"], post_states: ["FILE_FLUSHED"] });
    rules.set("close_file", { pre_states: ["FILE_OPEN", "FILE_DIRTY", "FILE_FLUSHED"], post_states: [], invalidate: ["FILE_OPEN", "FILE_DIRTY", "FILE_FLUSHED"] });
    rules.set("connect_db", { pre_states: [], post_states: ["DB_CONNECTED"] });
    rules.set("query_db", { pre_states: ["DB_CONNECTED"], post_states: [] });
    rules.set("disconnect_db", { pre_states: ["DB_CONNECTED"], post_states: [], invalidate: ["DB_CONNECTED"] });
    return [{
            name: "AuthProtocol", states: ["UNAUTHENTICATED", "PASSWORD_VERIFIED", "TOKEN_ISSUED", "SESSION_ACTIVE"],
            initialState: "UNAUTHENTICATED",
            transitions: [], rules: new Map([...rules].filter(([k]) => ["verify_password", "generate_jwt", "create_session", "logout"].includes(k))),
        }, {
            name: "FileProtocol", states: ["FILE_OPEN", "FILE_DIRTY", "FILE_FLUSHED"],
            initialState: "INIT",
            transitions: [], rules: new Map([...rules].filter(([k]) => ["open_file", "write_file", "flush_file", "close_file"].includes(k))),
        }, {
            name: "DBProtocol", states: ["DB_CONNECTED"],
            initialState: "INIT",
            transitions: [], rules: new Map([...rules].filter(([k]) => ["connect_db", "query_db", "disconnect_db"].includes(k))),
        }];
}
(0, vitest_1.describe)("Transition Synthesizer", () => {
    (0, vitest_1.it)("infers transitions from benchmark failures", () => {
        // open_file→flush_file: FILE_OPEN ≠ FILE_DIRTY → genuinely missing transition
        // write_file→close_file: FILE_DIRTY → close_file needs FILE_OPEN/FILE_DIRTY/FILE_FLUSHED → connected
        // But open_file→flush_file is NOT connected (FILE_OPEN vs FILE_DIRTY)
        const failures = [
            { goal: "flush after open without write", protocol: "FileProtocol", expectedRepair: ["open_file", "flush_file"] },
            { goal: "flush after open v2", protocol: "FileProtocol", expectedRepair: ["open_file", "flush_file"] },
        ];
        const inferences = (0, transition_synthesizer_1.synthesizeTransitions)(failures, makeProtocols());
        (0, vitest_1.expect)(inferences.length).toBeGreaterThan(0);
        // open_file→flush_file should be inferred (FILE_OPEN → FILE_DIRTY gap)
        const hasOpenFlush = inferences.some(i => i.action.includes("open_file → flush_file"));
        (0, vitest_1.expect)(hasOpenFlush).toBe(true);
        // Confidence: appears 2x
        const top = inferences[0];
        (0, vitest_1.expect)(top.confidence).toBeGreaterThan(0.5);
        (0, transition_synthesizer_1.printSynthesizerReport)(inferences);
    });
    (0, vitest_1.it)("augments rules with inferred transitions", () => {
        const failures = [
            { goal: "flush after open", protocol: "FileProtocol", expectedRepair: ["open_file", "flush_file"] },
        ];
        const inferences = (0, transition_synthesizer_1.synthesizeTransitions)(failures, makeProtocols());
        const fileProto = makeProtocols().find(p => p.name === "FileProtocol");
        const augmented = (0, transition_synthesizer_1.augmentRulesWithInferences)(fileProto.rules, inferences);
        // Should have the original rules plus inferred bridges
        (0, vitest_1.expect)(augmented.size).toBeGreaterThan(fileProto.rules.size);
        // Should contain an inferred bridge
        const hasBridge = [...augmented.keys()].some(k => k.startsWith("_inferred_"));
        (0, vitest_1.expect)(hasBridge).toBe(true);
    });
    (0, vitest_1.it)("generates gap-driven benchmarks", () => {
        const failures = [
            { goal: "flush after open", protocol: "FileProtocol", expectedRepair: ["open_file", "flush_file"] },
        ];
        const inferences = (0, transition_synthesizer_1.synthesizeTransitions)(failures, makeProtocols());
        const cases = (0, transition_synthesizer_1.generateGapBenchmarks)(inferences);
        (0, vitest_1.expect)(cases.length).toBeGreaterThan(0);
        // Each case targets a specific gap
        for (const c of cases) {
            (0, vitest_1.expect)(c.targetsGap.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(c.broken.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(c.expected.length).toBeGreaterThan(0);
        }
        // Write to disk
        const fp = (0, transition_synthesizer_1.writeGapBenchmarks)(cases);
        (0, vitest_1.expect)(fp).toContain("transition_gaps_");
    });
});
(0, vitest_1.describe)("Candidate Origin Tracking", () => {
    (0, vitest_1.it)("tracks origin stats", () => {
        const candidates = [
            { metadata: { source: "frontier" }, fixPath: ["close_file"] },
            { metadata: { source: "goal_template" }, fixPath: ["verify_password", "generate_jwt"] },
            { metadata: { source: "frontier" }, fixPath: ["open_file", "close_file"] },
            { metadata: { source: "corpus" }, fixPath: ["connect_db", "query_db", "disconnect_db"] },
        ];
        const stats = (0, transition_synthesizer_1.trackCandidateOrigin)(candidates);
        (0, vitest_1.expect)(stats.length).toBe(3); // frontier, goal_template, corpus
        const frontier = stats.find(s => s.origin === "frontier");
        (0, vitest_1.expect)(frontier.count).toBe(2);
        (0, transition_synthesizer_1.printCandidateOriginStats)(stats);
    });
});
(0, vitest_1.describe)("Enhanced Knowledge Score", () => {
    (0, vitest_1.it)("includes discoveryRate", () => {
        const scores = (0, transition_synthesizer_1.computeEnhancedScores)(["FileProtocol", "AuthProtocol", "DBProtocol"], [
            { protocol: "FileProtocol", stateCoverage: 0.6, transitionCoverage: 0.5 },
            { protocol: "AuthProtocol", stateCoverage: 0.8, transitionCoverage: 0.7 },
            { protocol: "DBProtocol", stateCoverage: 0.3, transitionCoverage: 0.2 },
        ], {
            FileProtocol: { total: 20, passed: 10 },
            AuthProtocol: { total: 15, passed: 8 },
            DBProtocol: { total: 10, passed: 2 },
        }, {
            FileProtocol: { total: 20, found: 15 },
            AuthProtocol: { total: 15, found: 12 },
            DBProtocol: { total: 10, found: 3 },
        });
        (0, vitest_1.expect)(scores.length).toBe(3);
        // AuthProtocol should have highest score (better coverage + success)
        (0, vitest_1.expect)(scores[0].protocol).toBe("AuthProtocol");
        (0, vitest_1.expect)(scores[0].discoveryRate).toBeGreaterThan(0.5);
        // DBProtocol should have lowest discovery rate
        const db = scores.find(s => s.protocol === "DBProtocol");
        (0, vitest_1.expect)(db.discoveryRate).toBe(0.3);
    });
});
