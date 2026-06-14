"use strict";
/**
 * P5.4: Continuous Benchmark Expansion Tests
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
const continuous_benchmark_1 = require("./continuous-benchmark");
const knowledge_governance_1 = require("./knowledge-governance");
const skill_library_1 = require("./skill-library");
const planner_telemetry_1 = require("./planner-telemetry");
const CB_DIR = path.resolve(__dirname, "..", "test-continuous-benchmark");
process.env.PROGMUNE_PROJECT_DIR = CB_DIR;
fs.mkdirSync(CB_DIR, { recursive: true });
fs.mkdirSync(path.join(CB_DIR, ".progmune_corpus", "telemetry"), { recursive: true });
fs.mkdirSync(path.join(CB_DIR, ".progmune_corpus", "knowledge"), { recursive: true });
fs.mkdirSync(path.join(CB_DIR, ".progmune_corpus", "skills"), { recursive: true });
(0, vitest_1.describe)("Continuous Benchmark Expansion", () => {
    (0, vitest_1.it)("generates benchmarks from approved patches", () => {
        const store = new knowledge_governance_1.KnowledgePatchStore(path.join(CB_DIR, ".progmune_corpus", "knowledge", `cb-patches-${Date.now()}.json`));
        // Approve a patch
        const patch = store.propose({
            from: "FILE_OPEN", to: "FILE_DIRTY", action: "open_file → write_file",
            protocol: "FileProtocol", confidence: 1.0, evidenceCount: 10, examples: ["test"],
            validation: { benchmarkSupport: 10, trajectorySupport: 10, contradictionCount: 0, status: "verified" },
        });
        store.approve(patch.id, { top1Before: 0.5, top1After: 0.6, top3Before: 0.7, top3After: 0.8 });
        const cases = (0, continuous_benchmark_1.generateBenchmarksFromPatches)(store);
        (0, vitest_1.expect)(cases.length).toBeGreaterThanOrEqual(1);
        (0, vitest_1.expect)(cases[0].source).toBe("patch");
    });
    (0, vitest_1.it)("generates benchmarks from skills", () => {
        const rules = new Map();
        rules.set("open_file", { pre_states: [], post_states: ["FILE_OPEN"] });
        rules.set("write_file", { pre_states: ["FILE_OPEN"], post_states: [] });
        rules.set("close_file", { pre_states: ["FILE_OPEN"], post_states: [], invalidate: ["FILE_OPEN"] });
        const telemetry = new planner_telemetry_1.PlannerTelemetry(path.join(CB_DIR, ".progmune_corpus", "telemetry", `cb-skills-${Date.now()}.jsonl`));
        // Seed with high-confidence file skill
        for (let i = 0; i < 15; i++) {
            const a = ["open_file", "write_file", "close_file"];
            const fp = (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", a, "resource_leak");
            const id = telemetry.recordDecision({
                goal: "safely write", protocol: "FileProtocol", violationType: "resource_leak",
                candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions: a, explanation: "full" }],
                selectedCandidateId: fp,
            });
            telemetry.recordFeedback(id, { decision: "accepted", executionResult: { success: true, violations: [] }, timestamp: Date.now() });
        }
        const lib = new skill_library_1.SkillLibrary();
        lib.learn(telemetry, rules);
        (0, vitest_1.expect)(lib.size).toBeGreaterThanOrEqual(1);
        const cases = (0, continuous_benchmark_1.generateBenchmarksFromSkills)(lib);
        (0, vitest_1.expect)(cases.length).toBeGreaterThanOrEqual(1);
        (0, vitest_1.expect)(cases[0].source).toBe("skill");
        // Resource cleanup variant should also be generated
        (0, vitest_1.expect)(cases.some(c => c.violationType === "resource_leak")).toBe(true);
    });
    (0, vitest_1.it)("runs continuous benchmark pipeline", async () => {
        const rules = new Map();
        rules.set("open_file", { pre_states: [], post_states: ["FILE_OPEN"] });
        rules.set("write_file", { pre_states: ["FILE_OPEN"], post_states: [] });
        rules.set("close_file", { pre_states: ["FILE_OPEN"], post_states: [], invalidate: ["FILE_OPEN"] });
        const telemetry = new planner_telemetry_1.PlannerTelemetry(path.join(CB_DIR, ".progmune_corpus", "telemetry", `cb-full-${Date.now()}.jsonl`));
        for (let i = 0; i < 20; i++) {
            const a = ["open_file", "write_file", "close_file"];
            const fp = (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", a, "resource_leak");
            const id = telemetry.recordDecision({
                goal: "safely write", protocol: "FileProtocol", violationType: "resource_leak",
                candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions: a, explanation: "full" }],
                selectedCandidateId: fp,
            });
            telemetry.recordFeedback(id, { decision: "accepted", executionResult: { success: true, violations: [] }, timestamp: Date.now() });
        }
        const lib = new skill_library_1.SkillLibrary();
        lib.learn(telemetry, rules);
        const store = new knowledge_governance_1.KnowledgePatchStore(path.join(CB_DIR, ".progmune_corpus", "knowledge", `cb-run-${Date.now()}.json`));
        const report = await (0, continuous_benchmark_1.runContinuousBenchmark)(store, lib, path.join(CB_DIR, "expanded-benchmarks"));
        (0, vitest_1.expect)(report.generatedCases).toBeGreaterThanOrEqual(2);
        (0, vitest_1.expect)(report.sourceBreakdown.skills).toBeGreaterThanOrEqual(1);
        (0, continuous_benchmark_1.printContinuousBenchmarkReport)(report);
    }, 60000);
});
