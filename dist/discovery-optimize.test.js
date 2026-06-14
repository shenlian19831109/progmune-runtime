"use strict";
/**
 * P4.5-4.7: Guided Frontier + Macro Mining + Discovery Analytics Tests
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const guided_frontier_1 = require("./guided-frontier");
const macro_repair_1 = require("./macro-repair");
const discovery_analytics_1 = require("./discovery-analytics");
const planner_telemetry_1 = require("./planner-telemetry");
function mergeProtocolRules(...maps) {
    const m = new Map();
    for (const mp of maps)
        for (const [k, v] of mp)
            m.set(k, v);
    return m;
}
const fileRules = new Map([
    ["open_file", { pre_states: [], post_states: ["FILE_OPEN"] }],
    ["write_file", { pre_states: ["FILE_OPEN"], post_states: [] }],
    ["close_file", { pre_states: ["FILE_OPEN"], post_states: [], invalidate: ["FILE_OPEN"] }],
]);
const authRules = new Map([
    ["verify_password", { pre_states: ["UNAUTHENTICATED"], post_states: ["PASSWORD_VERIFIED"] }],
    ["generate_jwt", { pre_states: ["PASSWORD_VERIFIED"], post_states: ["TOKEN_ISSUED"], invalidate: ["PASSWORD_VERIFIED"] }],
    ["create_session", { pre_states: ["TOKEN_ISSUED"], post_states: ["SESSION_ACTIVE"], invalidate: ["TOKEN_ISSUED"] }],
    ["logout", { pre_states: ["SESSION_ACTIVE"], post_states: ["UNAUTHENTICATED"], invalidate: ["SESSION_ACTIVE"] }],
]);
const dbRules = new Map([
    ["connect_db", { pre_states: [], post_states: ["DB_CONNECTED"] }],
    ["query_db", { pre_states: ["DB_CONNECTED"], post_states: [] }],
    ["disconnect_db", { pre_states: ["DB_CONNECTED"], post_states: [], invalidate: ["DB_CONNECTED"] }],
]);
const OPT_DIR = path.resolve(__dirname, "..", "test-discovery-optimize");
process.env.PROGMUNE_PROJECT_DIR = OPT_DIR;
fs.mkdirSync(OPT_DIR, { recursive: true });
fs.mkdirSync(path.join(OPT_DIR, ".progmune_corpus", "telemetry"), { recursive: true });
function seedHighAcceptanceTelemetry(n) {
    const t = new planner_telemetry_1.PlannerTelemetry(path.join(OPT_DIR, ".progmune_corpus", "telemetry", `opt-${Date.now()}.jsonl`));
    // Pattern: "open_file → write_file → close_file" accepted 90% of the time
    for (let i = 0; i < n; i++) {
        const actions = ["open_file", "write_file", "close_file"];
        const fp = (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", actions, "resource_leak");
        const id = t.recordDecision({
            goal: "safely write config file",
            protocol: "FileProtocol", violationType: "resource_leak",
            candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions, explanation: "full sequence" }],
            selectedCandidateId: fp,
            cost: { latencyMs: 3 + Math.random() * 5 },
        });
        const accepted = Math.random() < 0.9;
        t.recordFeedback(id, {
            decision: accepted ? "accepted" : "rejected",
            executionResult: accepted ? { success: true, violations: [] } : { success: false, violations: ["resource_leak"] },
            timestamp: Date.now(),
        });
    }
    // Auth pattern: accepted 85%
    for (let i = 0; i < n; i++) {
        const actions = ["verify_password", "generate_jwt", "create_session"];
        const fp = (0, planner_telemetry_1.candidateFingerprint)("AuthProtocol", actions, "missing_prerequisite");
        const id = t.recordDecision({
            goal: "authenticate user",
            protocol: "AuthProtocol", violationType: "missing_prerequisite",
            candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions, explanation: "auth flow" }],
            selectedCandidateId: fp,
        });
        const accepted = Math.random() < 0.85;
        t.recordFeedback(id, {
            decision: accepted ? "accepted" : "rejected",
            executionResult: accepted ? { success: true, violations: [] } : undefined,
            timestamp: Date.now(),
        });
    }
    return t;
}
(0, vitest_1.describe)("P4.5 Reward-Guided Frontier", () => {
    (0, vitest_1.it)("guided search finds paths with priority ordering", () => {
        const rules = mergeProtocolRules(authRules, fileRules, dbRules);
        const paths = (0, guided_frontier_1.guidedSearch)(rules, ["UNAUTHENTICATED"], ["SESSION_ACTIVE"]);
        (0, vitest_1.expect)(paths.length).toBeGreaterThan(0);
        // Should find auth path
        const hasAuth = paths.some(p => p.actions.includes("verify_password") && p.actions.includes("generate_jwt"));
        (0, vitest_1.expect)(hasAuth).toBe(true);
        // Paths should be sorted by priority (descending)
        for (let i = 1; i < paths.length; i++) {
            (0, vitest_1.expect)(paths[i - 1].priority).toBeGreaterThanOrEqual(paths[i].priority);
        }
    });
    (0, vitest_1.it)("multi-start finds paths from different initial states", () => {
        const rules = mergeProtocolRules(fileRules, authRules);
        const paths = (0, guided_frontier_1.guidedSearchMulti)(rules, [
            ["FILE_OPEN"],
            ["UNAUTHENTICATED"],
        ], ["SESSION_ACTIVE"]);
        (0, vitest_1.expect)(paths.length).toBeGreaterThan(0);
        // Should include paths from both starting points
        (0, vitest_1.expect)(paths.every(p => p.found)).toBe(true);
    });
});
(0, vitest_1.describe)("P4.6 Macro Repair Mining", () => {
    (0, vitest_1.it)("mines high-acceptance patterns from telemetry", () => {
        const telemetry = seedHighAcceptanceTelemetry(50);
        const macros = (0, macro_repair_1.mineMacroRepairs)(telemetry, 0.7, 3);
        (0, vitest_1.expect)(macros.length).toBeGreaterThanOrEqual(1);
        // File repair pattern should be mined
        const fileMacro = macros.find(m => m.protocol === "FileProtocol");
        (0, vitest_1.expect)(fileMacro).toBeDefined();
        (0, vitest_1.expect)(fileMacro.acceptanceRate).toBeGreaterThan(0.7);
        (0, vitest_1.expect)(fileMacro.actions).toEqual(["open_file", "write_file", "close_file"]);
        (0, macro_repair_1.printMacroReport)(macros);
    });
    (0, vitest_1.it)("persists and loads macros", () => {
        const telemetry = seedHighAcceptanceTelemetry(60);
        const mined = (0, macro_repair_1.mineMacroRepairs)(telemetry, 0.7, 3);
        const fp = (0, macro_repair_1.saveMacroRepairs)(mined);
        (0, vitest_1.expect)(fs.existsSync(fp)).toBe(true);
        const loaded = (0, macro_repair_1.loadMacroRepairs)();
        (0, vitest_1.expect)(loaded.length).toBeGreaterThanOrEqual(mined.length);
    });
    (0, vitest_1.it)("filters out low-frequency patterns", () => {
        const telemetry = new planner_telemetry_1.PlannerTelemetry(path.join(OPT_DIR, ".progmune_corpus", "telemetry", `lowfreq-${Date.now()}.jsonl`));
        // Only 2 samples — below minFrequency=3
        for (let i = 0; i < 2; i++) {
            const fp = (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["close_file"], "resource_leak");
            const id = telemetry.recordDecision({
                goal: "test", protocol: "FileProtocol",
                candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions: ["close_file"], explanation: "close" }],
                selectedCandidateId: fp,
            });
            telemetry.recordFeedback(id, { decision: "accepted", executionResult: { success: true, violations: [] }, timestamp: Date.now() });
        }
        const macros = (0, macro_repair_1.mineMacroRepairs)(telemetry, 0.7, 3);
        (0, vitest_1.expect)(macros.length).toBe(0); // not enough frequency
    });
});
(0, vitest_1.describe)("P4.7 Discovery Analytics", () => {
    (0, vitest_1.it)("computes discovery metrics from attributions", () => {
        const attributed = [
            { caseId: "c1", goal: "safely write", protocol: "FileProtocol", violationType: "resource_leak", expectedRepair: ["close_file"], candidatesReturned: 2, rank: 1, failureReason: "success" },
            { caseId: "c2", goal: "safely write", protocol: "FileProtocol", violationType: "resource_leak", expectedRepair: ["close_file"], candidatesReturned: 1, rank: null, failureReason: "bad_ranking" },
            { caseId: "c3", goal: "authenticate", protocol: "AuthProtocol", violationType: "missing_prerequisite", expectedRepair: ["generate_jwt"], candidatesReturned: 0, rank: null, failureReason: "missing_candidate" },
            { caseId: "c4", goal: "logout user", protocol: "AuthProtocol", violationType: "illegal_state_transition", expectedRepair: ["logout"], candidatesReturned: 0, rank: null, failureReason: "missing_candidate" },
        ];
        const metrics = (0, discovery_analytics_1.computeDiscoveryMetrics)(attributed);
        (0, vitest_1.expect)(metrics.totalCases).toBe(4);
        (0, vitest_1.expect)(metrics.overall).toBe(0.5); // 2/4 discovered
        // FileProtocol: 2/2 discovered
        (0, vitest_1.expect)(metrics.byProtocol["FileProtocol"]).toBe(1.0);
        // AuthProtocol: 0/2 discovered
        (0, vitest_1.expect)(metrics.byProtocol["AuthProtocol"]).toBe(0);
        // resource_leak: 2/2, missing_prerequisite: 0/1, illegal_state_transition: 0/1
        (0, vitest_1.expect)(metrics.byViolation["resource_leak"]).toBe(1.0);
        (0, vitest_1.expect)(metrics.byViolation["missing_prerequisite"]).toBe(0);
    });
    (0, vitest_1.it)("generates full analytics report", async () => {
        const telemetry = seedHighAcceptanceTelemetry(30);
        const report = await (0, discovery_analytics_1.generateFullAnalyticsReport)(telemetry);
        (0, vitest_1.expect)(report.discovery.totalCases).toBeGreaterThanOrEqual(49);
        (0, vitest_1.expect)(report.macroCount).toBeGreaterThanOrEqual(1);
        (0, vitest_1.expect)(report.topMacros.length).toBeGreaterThanOrEqual(1);
        (0, discovery_analytics_1.printDiscoveryDashboard)(report);
    });
});
