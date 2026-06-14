"use strict";
/**
 * P3.16-17: Protocol Gap Mining Tests
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const protocol_gap_analyzer_1 = require("./protocol-gap-analyzer");
function makeAttributedCases() {
    return [
        { caseId: "c1", goal: "authenticate user", protocol: "AuthProtocol", violationType: "missing_prerequisite", expectedRepair: ["verify_password", "generate_jwt", "create_session"], plannerTop1: ["logout"], candidatesReturned: 1, rank: null, failureReason: "missing_candidate" },
        { caseId: "c2", goal: "authenticate user", protocol: "AuthProtocol", violationType: "missing_prerequisite", expectedRepair: ["verify_password", "generate_jwt", "create_session"], plannerTop1: ["logout"], candidatesReturned: 1, rank: null, failureReason: "missing_candidate" },
        { caseId: "c3", goal: "full auth lifecycle", protocol: "AuthProtocol", violationType: "missing_prerequisite", expectedRepair: ["verify_password", "generate_jwt", "create_session", "logout"], plannerTop1: ["logout"], candidatesReturned: 1, rank: null, failureReason: "missing_candidate" },
        { caseId: "c4", goal: "safely write file", protocol: "FileProtocol", violationType: "resource_leak", expectedRepair: ["open_file", "write_file", "flush_file", "close_file"], plannerTop1: ["close_file"], candidatesReturned: 1, rank: null, failureReason: "missing_candidate" },
        { caseId: "c5", goal: "safely write file", protocol: "FileProtocol", violationType: "resource_leak", expectedRepair: ["open_file", "write_file", "flush_file", "close_file"], plannerTop1: ["close_file"], candidatesReturned: 1, rank: null, failureReason: "missing_candidate" },
        { caseId: "c6", goal: "query db safely", protocol: "DBProtocol", violationType: "missing_prerequisite", expectedRepair: ["connect_db", "query_db", "disconnect_db"], plannerTop1: ["disconnect_db"], candidatesReturned: 1, rank: null, failureReason: "missing_candidate" },
        { caseId: "c7", goal: "auth then file then db", protocol: "FileProtocol", violationType: "resource_leak", expectedRepair: ["verify_password", "open_file", "write_file", "close_file", "connect_db", "query_db", "disconnect_db"], plannerTop1: ["close_file"], candidatesReturned: 1, rank: null, failureReason: "missing_candidate" },
        { caseId: "c8", goal: "success case", protocol: "FileProtocol", violationType: "resource_leak", expectedRepair: ["open_file", "write_file", "close_file"], plannerTop1: ["open_file", "write_file", "close_file"], candidatesReturned: 3, rank: 1, failureReason: "success" },
    ];
}
(0, vitest_1.describe)("Protocol Gap Analyzer", () => {
    (0, vitest_1.it)("identifies missing actions from failures", () => {
        const cases = makeAttributedCases();
        // Build rules map: only existing protocol functions
        const rules = new Map();
        rules.set("AuthProtocol", new Set(["verify_password", "generate_jwt", "create_session", "logout", "revoke_token"]));
        rules.set("FileProtocol", new Set(["open_file", "read_file", "write_file", "close_file"]));
        rules.set("DBProtocol", new Set(["connect_db", "query_db", "disconnect_db"]));
        rules.set("IRProtocol", new Set(["extractIR", "validateAction", "validateActionSequence", "emitCode", "recordSession"]));
        const report = (0, protocol_gap_analyzer_1.analyzeProtocolGaps)(cases, rules);
        (0, vitest_1.expect)(report.failuresAnalyzed).toBe(7); // 8 total, 1 success
        (0, vitest_1.expect)(report.gaps.length).toBeGreaterThan(0);
        // flush_file should appear as a missing action
        const missingActions = report.gaps.filter(g => g.kind === "missing_action");
        (0, vitest_1.expect)(missingActions.some(g => g.item === "flush_file")).toBe(true);
        // flush_file appears in 2 cases (c4, c5)
        const flushGap = missingActions.find(g => g.item === "flush_file");
        (0, vitest_1.expect)(flushGap?.frequency).toBe(2);
        (0, protocol_gap_analyzer_1.printGapReport)(report);
    });
    (0, vitest_1.it)("computes knowledge scores per protocol", () => {
        const cases = makeAttributedCases();
        const scores = (0, protocol_gap_analyzer_1.computeKnowledgeScores)(cases);
        (0, vitest_1.expect)(scores.length).toBe(4);
        // FileProtocol has success case → higher score
        const file = scores.find(s => s.protocol === "FileProtocol");
        (0, vitest_1.expect)(file.successRate).toBeGreaterThan(0);
        (0, protocol_gap_analyzer_1.printKnowledgeScores)(scores);
    });
});
