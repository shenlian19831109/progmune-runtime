"use strict";
/**
 * P5.3: Autonomous Patch Generation Tests
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
const skill_library_1 = require("./skill-library");
const autonomous_patch_1 = require("./autonomous-patch");
const knowledge_governance_1 = require("./knowledge-governance");
const planner_telemetry_1 = require("./planner-telemetry");
const AUTO_DIR = path.resolve(__dirname, "..", "test-autonomous-patch");
process.env.PROGMUNE_PROJECT_DIR = AUTO_DIR;
fs.mkdirSync(AUTO_DIR, { recursive: true });
fs.mkdirSync(path.join(AUTO_DIR, ".progmune_corpus", "telemetry"), { recursive: true });
fs.mkdirSync(path.join(AUTO_DIR, ".progmune_corpus", "knowledge"), { recursive: true });
function seedLibrary(telemetry, rules) {
    // File skill: 90% acceptance
    for (let i = 0; i < 30; i++) {
        const a = ["open_file", "write_file", "close_file"];
        const fp = (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", a, "resource_leak");
        const id = telemetry.recordDecision({
            goal: "safely write config file", protocol: "FileProtocol", violationType: "resource_leak",
            candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions: a, explanation: "full" }],
            selectedCandidateId: fp, cost: { latencyMs: 5 },
        });
        telemetry.recordFeedback(id, { decision: Math.random() < 0.92 ? "accepted" : "rejected", executionResult: { success: true, violations: [] }, timestamp: Date.now() });
    }
    // Auth skill: 88% acceptance
    for (let i = 0; i < 30; i++) {
        const a = ["verify_password", "generate_jwt", "create_session"];
        const fp = (0, planner_telemetry_1.candidateFingerprint)("AuthProtocol", a, "missing_prerequisite");
        const id = telemetry.recordDecision({
            goal: "authenticate user", protocol: "AuthProtocol", violationType: "missing_prerequisite",
            candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions: a, explanation: "auth" }],
            selectedCandidateId: fp,
        });
        telemetry.recordFeedback(id, { decision: Math.random() < 0.88 ? "accepted" : "rejected", executionResult: { success: true, violations: [] }, timestamp: Date.now() });
    }
    const r = rules;
    const lib = new skill_library_1.SkillLibrary();
    lib.learn(telemetry, r);
    return lib;
}
(0, vitest_1.describe)("Autonomous Patch Generation", () => {
    (0, vitest_1.it)("generates patches from high-confidence skills", () => {
        const rules = new Map();
        rules.set("open_file", { pre_states: [], post_states: ["FILE_OPEN"] });
        rules.set("write_file", { pre_states: ["FILE_OPEN"], post_states: [] });
        rules.set("close_file", { pre_states: ["FILE_OPEN"], post_states: [], invalidate: ["FILE_OPEN"] });
        rules.set("verify_password", { pre_states: ["UNAUTHENTICATED"], post_states: ["PASSWORD_VERIFIED"] });
        rules.set("generate_jwt", { pre_states: ["PASSWORD_VERIFIED"], post_states: ["TOKEN_ISSUED"], invalidate: ["PASSWORD_VERIFIED"] });
        rules.set("create_session", { pre_states: ["TOKEN_ISSUED"], post_states: ["SESSION_ACTIVE"], invalidate: ["TOKEN_ISSUED"] });
        const telemetry = new planner_telemetry_1.PlannerTelemetry(path.join(AUTO_DIR, ".progmune_corpus", "telemetry", `auto-${Date.now()}.jsonl`));
        const lib = seedLibrary(telemetry, rules);
        (0, vitest_1.expect)(lib.size).toBeGreaterThanOrEqual(2);
        const store = new knowledge_governance_1.KnowledgePatchStore(path.join(AUTO_DIR, ".progmune_corpus", "knowledge", `auto-patches-${Date.now()}.json`));
        const results = (0, autonomous_patch_1.generatePatchesFromSkills)(lib, telemetry, store, 0.85);
        (0, vitest_1.expect)(results.length).toBeGreaterThanOrEqual(1);
        // File skill (92%) should be approved; Auth skill (88%) also above threshold
        const approved = results.filter(r => r.status === "approved");
        (0, vitest_1.expect)(approved.length).toBeGreaterThanOrEqual(1);
        (0, autonomous_patch_1.printAutonomousReport)({ skills: lib.size, patchesGenerated: results.length, patchesApproved: approved.length, patchesRejected: results.filter(r => r.status === "rejected").length, templatesGenerated: 0, summary: "" }, results);
    });
    (0, vitest_1.it)("generates templates from skills", () => {
        const rules = new Map();
        rules.set("open_file", { pre_states: [], post_states: ["FILE_OPEN"] });
        rules.set("write_file", { pre_states: ["FILE_OPEN"], post_states: [] });
        rules.set("close_file", { pre_states: ["FILE_OPEN"], post_states: [], invalidate: ["FILE_OPEN"] });
        const telemetry = new planner_telemetry_1.PlannerTelemetry(path.join(AUTO_DIR, ".progmune_corpus", "telemetry", `tmpl-${Date.now()}.jsonl`));
        const lib = seedLibrary(telemetry, rules);
        const templates = (0, autonomous_patch_1.generateTemplatesFromSkills)(lib);
        (0, vitest_1.expect)(templates.length).toBeGreaterThanOrEqual(1);
        // Template pattern should contain file operation keywords
        (0, vitest_1.expect)(templates.some(t => t.pattern.includes("open") && t.pattern.includes("write"))).toBe(true);
    });
    (0, vitest_1.it)("runs full autonomous pipeline", () => {
        const rules = new Map();
        rules.set("open_file", { pre_states: [], post_states: ["FILE_OPEN"] });
        rules.set("write_file", { pre_states: ["FILE_OPEN"], post_states: [] });
        rules.set("close_file", { pre_states: ["FILE_OPEN"], post_states: [], invalidate: ["FILE_OPEN"] });
        rules.set("verify_password", { pre_states: ["UNAUTHENTICATED"], post_states: ["PASSWORD_VERIFIED"] });
        rules.set("generate_jwt", { pre_states: ["PASSWORD_VERIFIED"], post_states: ["TOKEN_ISSUED"], invalidate: ["PASSWORD_VERIFIED"] });
        rules.set("create_session", { pre_states: ["TOKEN_ISSUED"], post_states: ["SESSION_ACTIVE"], invalidate: ["TOKEN_ISSUED"] });
        const telemetry = new planner_telemetry_1.PlannerTelemetry(path.join(AUTO_DIR, ".progmune_corpus", "telemetry", `full-${Date.now()}.jsonl`));
        const lib = seedLibrary(telemetry, rules);
        const store = new knowledge_governance_1.KnowledgePatchStore(path.join(AUTO_DIR, ".progmune_corpus", "knowledge", `full-patches-${Date.now()}.json`));
        const report = (0, autonomous_patch_1.runAutonomousPipeline)(lib, telemetry, store);
        (0, vitest_1.expect)(report.skills).toBeGreaterThanOrEqual(2);
        (0, vitest_1.expect)(report.patchesApproved).toBeGreaterThanOrEqual(1);
        (0, vitest_1.expect)(report.templatesGenerated).toBeGreaterThanOrEqual(2);
        (0, autonomous_patch_1.printAutonomousReport)(report);
    });
});
