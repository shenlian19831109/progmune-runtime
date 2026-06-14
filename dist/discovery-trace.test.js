"use strict";
/**
 * P3.24-27: Search Trace + Bridge + Discovery + Replay Tests
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const discovery_trace_1 = require("./discovery-trace");
function makeRules() {
    return new Map([
        ["verify_password", { pre_states: ["UNAUTHENTICATED"], post_states: ["PASSWORD_VERIFIED"] }],
        ["generate_jwt", { pre_states: ["PASSWORD_VERIFIED"], post_states: ["TOKEN_ISSUED"], invalidate: ["PASSWORD_VERIFIED"] }],
        ["create_session", { pre_states: ["TOKEN_ISSUED"], post_states: ["SESSION_ACTIVE"], invalidate: ["TOKEN_ISSUED"] }],
        ["logout", { pre_states: ["SESSION_ACTIVE"], post_states: ["UNAUTHENTICATED"], invalidate: ["SESSION_ACTIVE"] }],
        ["open_file", { pre_states: [], post_states: ["FILE_OPEN"] }],
        ["close_file", { pre_states: ["FILE_OPEN"], post_states: [], invalidate: ["FILE_OPEN"] }],
    ]);
}
(0, vitest_1.describe)("Search Trace", () => {
    (0, vitest_1.it)("traces a frontier search and classifies dead ends", () => {
        const rules = makeRules();
        // Expect "flush_file" which doesn't exist → missing_action
        const trace = (0, discovery_trace_1.traceSearch)(rules, ["FILE_OPEN"], [], ["close_file", "flush_file"], "frontier", "safely write file");
        (0, vitest_1.expect)(trace.expandedNodes.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(trace.deadEnds.length).toBeGreaterThan(0);
        // flush_file is not in the rules → missing_action
        (0, vitest_1.expect)(trace.deadEnds.some(d => d.reason === "missing_action")).toBe(true);
    });
    (0, vitest_1.it)("decomposes missing candidates into root causes", () => {
        const rules = makeRules();
        const traces = [
            (0, discovery_trace_1.traceSearch)(rules, ["FILE_OPEN"], [], ["close_file", "flush_file"], "frontier", "write file"),
            (0, discovery_trace_1.traceSearch)(rules, ["UNAUTHENTICATED"], ["SESSION_ACTIVE"], ["verify_password", "generate_jwt", "create_session"], "frontier", "auth"),
        ];
        const decomposition = (0, discovery_trace_1.decomposeMissingCandidate)(traces);
        (0, vitest_1.expect)(decomposition.total).toBe(2);
        (0, vitest_1.expect)(decomposition.missingAction).toBeGreaterThan(0);
    });
});
(0, vitest_1.describe)("Discovery Benchmark", () => {
    (0, vitest_1.it)("computes three-tier metrics", () => {
        const results = [
            { goal: "case1", discovery: true, top1Hit: true, top3Hit: true, candidateCount: 3 },
            { goal: "case2", discovery: true, top1Hit: false, top3Hit: true, candidateCount: 2 },
            { goal: "case3", discovery: true, top1Hit: false, top3Hit: false, candidateCount: 4 },
            { goal: "case4", discovery: false, top1Hit: false, top3Hit: false, candidateCount: 1,
                decomposition: { total: 1, missingAction: 1, missingTransition: 0, depthLimit: 0, bridgeMissing: 0, preconditionFailed: 0 } },
        ];
        const report = (0, discovery_trace_1.computeDiscoveryReport)(results);
        (0, vitest_1.expect)(report.discoveryRate).toBe(0.75); // 3/4
        (0, vitest_1.expect)(report.top3Rate).toBe(0.5); // 2/4
        (0, vitest_1.expect)(report.top1Rate).toBe(0.25); // 1/4
        (0, discovery_trace_1.printDiscoveryReport)(report);
    });
});
(0, vitest_1.describe)("Counterfactual Replay", () => {
    (0, vitest_1.it)("evaluates off-policy improvement", () => {
        const decisions = [
            { goal: "safely write file", protocol: "FileProtocol",
                candidates: [["open_file", "close_file"], ["close_file"]],
                acceptedActions: ["open_file", "write_file", "close_file"] },
            { goal: "authenticate", protocol: "AuthProtocol",
                candidates: [["verify_password", "generate_jwt"], ["logout"]],
                acceptedActions: ["verify_password", "generate_jwt", "create_session"] },
        ];
        // New generator that adds write_file to file protocol
        function newGen(goal, _protocol) {
            if (goal.includes("safely write"))
                return [["open_file", "write_file", "close_file"]];
            if (goal.includes("authenticate"))
                return [["verify_password", "generate_jwt", "create_session"]];
            return [];
        }
        const eval_ = (0, discovery_trace_1.evaluateOffPolicy)(decisions, newGen);
        // Baseline: 0/2 (neither matches)
        (0, vitest_1.expect)(eval_.baselineRate).toBe(0);
        // New: 2/2 (both match)
        (0, vitest_1.expect)(eval_.newRate).toBe(1);
        (0, vitest_1.expect)(eval_.improvement).toBe(true);
        (0, discovery_trace_1.printReplayEvaluation)(eval_);
    });
});
(0, vitest_1.describe)("Protocol Bridge Learning", () => {
    (0, vitest_1.it)("learns bridges from cross-protocol failures", () => {
        const failures = [
            { goal: "auth then file write", expectedRepair: ["verify_password", "generate_jwt", "open_file", "write_file", "close_file"] },
            { goal: "auth then db query", expectedRepair: ["verify_password", "generate_jwt", "connect_db", "query_db", "disconnect_db"] },
        ];
        const bridges = (0, discovery_trace_1.learnProtocolBridges)(failures);
        (0, vitest_1.expect)(bridges.length).toBeGreaterThanOrEqual(1);
        // AuthProtocol → FileProtocol should be inferred
        const hasAuthFile = bridges.some(b => b.fromProtocol === "AuthProtocol" && b.toProtocol === "FileProtocol");
        const hasAuthDb = bridges.some(b => b.fromProtocol === "AuthProtocol" && b.toProtocol === "DBProtocol");
        (0, vitest_1.expect)(hasAuthFile || hasAuthDb).toBe(true);
        // Both have confidence 1.0 (both appear the same number of times)
        (0, vitest_1.expect)(bridges[0].confidence).toBe(1);
    });
});
