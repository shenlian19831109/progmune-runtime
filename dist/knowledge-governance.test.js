"use strict";
/**
 * P3.21-23: Knowledge Governance Tests
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
const knowledge_governance_1 = require("./knowledge-governance");
const GOV_DIR = path.resolve(__dirname, "..", "test-knowledge-gov");
process.env.PROGMUNE_PROJECT_DIR = GOV_DIR;
fs.mkdirSync(GOV_DIR, { recursive: true });
fs.mkdirSync(path.join(GOV_DIR, ".progmune_corpus", "knowledge"), { recursive: true });
function makeBaseRules() {
    return new Map([
        ["open_file", { pre_states: [], post_states: ["FILE_OPEN"] }],
        ["write_file", { pre_states: ["FILE_OPEN"], post_states: ["FILE_DIRTY"] }],
        ["close_file", { pre_states: ["FILE_OPEN", "FILE_DIRTY"], post_states: [], invalidate: ["FILE_OPEN", "FILE_DIRTY"] }],
    ]);
}
(0, vitest_1.describe)("Inference Validator", () => {
    (0, vitest_1.it)("classifies inferences as proposed/verified/rejected", () => {
        const inferences = [
            { from: "FILE_OPEN", to: "FILE_DIRTY", action: "open_file → flush_file", protocol: "FileProtocol", confidence: 1.0, evidenceCount: 1, examples: ["test"] },
            { from: "FILE_OPEN", to: "FILE_DIRTY", action: "open_file → flush_file", protocol: "FileProtocol", confidence: 1.0, evidenceCount: 3, examples: ["a", "b", "c"] },
        ];
        const validated = (0, knowledge_governance_1.validateInferences)(inferences, 5); // 5 trajectory support
        // First: only 1 benchmark → proposed
        (0, vitest_1.expect)(validated[0].validation.status).toBe("proposed");
        (0, vitest_1.expect)(validated[0].validation.benchmarkSupport).toBe(1);
        (0, vitest_1.expect)(validated[0].validation.trajectorySupport).toBe(5);
        // Second: 3 benchmarks + 5 trajectories → verified
        (0, vitest_1.expect)(validated[1].validation.status).toBe("verified");
    });
});
(0, vitest_1.describe)("Knowledge Patch Store", () => {
    (0, vitest_1.it)("proposes, approves, rejects, and rolls back patches", () => {
        const store = new knowledge_governance_1.KnowledgePatchStore(path.join(GOV_DIR, ".progmune_corpus", "knowledge", `test-${Date.now()}.json`));
        const inference = {
            from: "FILE_OPEN", to: "FILE_DIRTY", action: "open_file → flush_file",
            protocol: "FileProtocol", confidence: 1.0, evidenceCount: 3, examples: ["a", "b", "c"],
            validation: { benchmarkSupport: 3, trajectorySupport: 5, contradictionCount: 0, status: "verified" },
        };
        // Propose
        const patch = store.propose(inference);
        (0, vitest_1.expect)(patch.status).toBe("proposed");
        (0, vitest_1.expect)(patch.id).toMatch(/^KP-/);
        (0, vitest_1.expect)(store.proposed.length).toBe(1);
        // Approve
        const ok = store.approve(patch.id, { top1Before: 0.5, top1After: 0.55, top3Before: 0.7, top3After: 0.75 });
        (0, vitest_1.expect)(ok).toBe(true);
        (0, vitest_1.expect)(store.approved.length).toBe(1);
        (0, vitest_1.expect)(store.approved[0].approvalMetrics?.top1After).toBe(0.55);
        // Rollback
        const rb = store.rollback(patch.id);
        (0, vitest_1.expect)(rb).toBe(true);
        (0, vitest_1.expect)(store.approved.length).toBe(0);
        // Reject a new one
        const p2 = store.propose(inference);
        store.reject(p2.id);
        (0, vitest_1.expect)(store.all.filter(p => p.status === "rejected").length).toBe(1);
    });
    (0, vitest_1.it)("builds augmented rules from approved patches", () => {
        const store = new knowledge_governance_1.KnowledgePatchStore(path.join(GOV_DIR, ".progmune_corpus", "knowledge", `aug-${Date.now()}.json`));
        const inference = {
            from: "FILE_OPEN", to: "FILE_DIRTY", action: "open_file → flush_file",
            protocol: "FileProtocol", confidence: 1.0, evidenceCount: 3, examples: ["a"],
            validation: { benchmarkSupport: 3, trajectorySupport: 5, contradictionCount: 0, status: "verified" },
        };
        const patch = store.propose(inference);
        store.approve(patch.id, { top1Before: 0.5, top1After: 0.6, top3Before: 0.7, top3After: 0.8 });
        const baseRules = makeBaseRules();
        const augmented = store.buildAugmentedRules(baseRules);
        // Should have base rules + 1 patch bridge
        (0, vitest_1.expect)(augmented.size).toBe(baseRules.size + 1);
        const hasBridge = [...augmented.keys()].some(k => k.startsWith("_patch_"));
        (0, vitest_1.expect)(hasBridge).toBe(true);
    });
});
(0, vitest_1.describe)("Regression Test", () => {
    (0, vitest_1.it)("auto-approves if Top-1/Top-3 improves", () => {
        const store = new knowledge_governance_1.KnowledgePatchStore(path.join(GOV_DIR, ".progmune_corpus", "knowledge", `reg-${Date.now()}.json`));
        const patch = store.propose({
            from: "FILE_OPEN", to: "FILE_DIRTY", action: "open_file → flush_file",
            protocol: "FileProtocol", confidence: 1.0, evidenceCount: 3, examples: ["a", "b", "c"],
            validation: { benchmarkSupport: 3, trajectorySupport: 5, contradictionCount: 0, status: "verified" },
        });
        const baseRules = makeBaseRules();
        // Test case: from FILE_OPEN to FILE_DIRTY — this path doesn't exist in base rules (open→write exists, but open→flush is missing)
        const testCases = [
            { currentState: ["FILE_OPEN"], targetState: ["FILE_DIRTY"] },
        ];
        const result = (0, knowledge_governance_1.autoApprovePatch)(patch, baseRules, testCases, store);
        // With augmented rules, the patch adds open_file→flush_file bridge
        // This should improve Top-1 (found paths increase)
        (0, vitest_1.expect)(result.passed).toBe(true);
        (0, vitest_1.expect)(result.top1After).toBeGreaterThanOrEqual(result.top1Before);
    });
});
(0, vitest_1.describe)("Full Governance Pipeline", () => {
    (0, vitest_1.it)("runs synthesize → validate → propose → regression → approve", () => {
        // revoke_token produces UNAUTHENTICATED, create_session needs TOKEN_ISSUED
        // These are NOT connected (UNAUTHENTICATED ≠ TOKEN_ISSUED) → genuine gap
        // Both functions exist in AuthProtocol (protocols.json)
        const failures = [
            { goal: "revoke then create session", protocol: "AuthProtocol", expectedRepair: ["revoke_token", "create_session"] },
            { goal: "revoke then create session v2", protocol: "AuthProtocol", expectedRepair: ["revoke_token", "create_session"] },
        ];
        const testCases = [
            { currentState: ["FILE_OPEN"], targetState: ["FILE_DIRTY"] },
        ];
        const store = new knowledge_governance_1.KnowledgePatchStore(path.join(GOV_DIR, ".progmune_corpus", "knowledge", `full-${Date.now()}.json`));
        const report = (0, knowledge_governance_1.runKnowledgeGovernance)(failures, testCases, store);
        (0, vitest_1.expect)(report.proposed).toBeGreaterThanOrEqual(1);
        (0, knowledge_governance_1.printGovernanceReport)(report);
    });
});
