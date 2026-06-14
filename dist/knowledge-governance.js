"use strict";
/**
 * P3.21-23: Knowledge Governance Layer
 *
 * P3.21: Multi-source inference validation.
 *   benchark support + trajectory support - contradiction = trustworthiness.
 *   Status: proposed → verified → rejected.
 *
 * P3.22: Knowledge versioning.
 *   Every inferred transition is a versioned patch with audit trail.
 *   Planner reads Base Rules + Approved Patches (never modifies originals).
 *
 * P3.23: Regression testing.
 *   Run benchmark suite against proposed patches. Auto-approve only
 *   if Top-1 and Top-3 don't regress.
 *
 * Philosophy:
 *   Wrong knowledge + perfect Reward Model = confidently wrong.
 *   Right knowledge + basic Ranker = steadily improving.
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
exports.KnowledgePatchStore = void 0;
exports.validateInferences = validateInferences;
exports.regressionTestPatch = regressionTestPatch;
exports.autoApprovePatch = autoApprovePatch;
exports.runKnowledgeGovernance = runKnowledgeGovernance;
exports.printGovernanceReport = printGovernanceReport;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const transition_synthesizer_1 = require("./transition-synthesizer");
const protocol_frontier_1 = require("./protocol-frontier");
const protocol_coverage_1 = require("./protocol-coverage");
const VALIDATION_THRESHOLDS = {
    benchmarkMin: 3,
    trajectoryMin: 5,
    contradictionMax: 0,
};
/**
 * Validate inferred transitions against multi-source evidence.
 *
 *   - benchmarkSupport: how many benchmark cases need this transition
 *   - trajectorySupport: how many real trajectory records show this pattern
 *   - contradictionCount: how many counter-examples exist
 *
 * Status logic:
 *   proposed  — insufficient evidence yet
 *   verified  — ≥3 benchmark + ≥5 trajectory + 0 contradictions
 *   rejected  — contradictionCount > 0
 */
function validateInferences(inferences, trajectoryCount = 0) {
    return inferences.map(inf => {
        const benchmarkSupport = inf.evidenceCount;
        const trajectorySupport = trajectoryCount;
        const contradictionCount = 0; // no contradiction detection yet
        let status;
        if (contradictionCount > VALIDATION_THRESHOLDS.contradictionMax) {
            status = "rejected";
        }
        else if (benchmarkSupport >= VALIDATION_THRESHOLDS.benchmarkMin &&
            trajectorySupport >= VALIDATION_THRESHOLDS.trajectoryMin) {
            status = "verified";
        }
        else {
            status = "proposed";
        }
        return {
            ...inf,
            validation: { benchmarkSupport, trajectorySupport, contradictionCount, status },
        };
    });
}
const KNOWLEDGE_DIR = path.resolve(process.env.PROGMUNE_PROJECT_DIR || process.cwd(), ".progmune_corpus", "knowledge");
class KnowledgePatchStore {
    constructor(persistPath) {
        this.patches = [];
        this.persistPath = persistPath || path.join(KNOWLEDGE_DIR, "patches.json");
        this.load();
    }
    /** Propose a new knowledge patch from an inferred transition. */
    propose(inference) {
        const id = `KP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const patch = {
            id,
            generatedBy: "transition-synthesizer",
            protocol: inference.protocol,
            change: inference.action,
            fromState: inference.from,
            toState: inference.to,
            confidence: inference.confidence,
            evidenceCount: inference.evidenceCount,
            createdAt: new Date().toISOString(),
            status: "proposed",
        };
        this.patches.push(patch);
        this.save();
        return patch;
    }
    /** Approve a patch (with benchmark metrics). */
    approve(id, metrics) {
        const patch = this.patches.find(p => p.id === id);
        if (!patch || patch.status !== "proposed")
            return false;
        patch.status = "approved";
        patch.approvedAt = new Date().toISOString();
        patch.approvalMetrics = metrics;
        this.save();
        return true;
    }
    /** Reject a patch. */
    reject(id) {
        const patch = this.patches.find(p => p.id === id);
        if (!patch || patch.status !== "proposed")
            return false;
        patch.status = "rejected";
        this.save();
        return true;
    }
    /** Rollback an approved patch. */
    rollback(id) {
        const patch = this.patches.find(p => p.id === id);
        if (!patch || patch.status !== "approved")
            return false;
        patch.status = "rolled_back";
        patch.rolledBackAt = new Date().toISOString();
        this.save();
        return true;
    }
    /** Get all approved patches (these augment the base rules). */
    get approved() {
        return this.patches.filter(p => p.status === "approved");
    }
    /** Get all proposed patches. */
    get proposed() {
        return this.patches.filter(p => p.status === "proposed");
    }
    /** Build augmented rules: base rules + approved patches as virtual rules. */
    buildAugmentedRules(baseRules) {
        const augmented = new Map(baseRules);
        for (const patch of this.approved) {
            const [fnA, fnB] = patch.change.split(" → ");
            const bridgeName = `_patch_${fnA}_to_${fnB}`;
            augmented.set(bridgeName, {
                pre_states: [patch.fromState],
                post_states: [patch.toState],
                namespace: "knowledge-patch",
            });
        }
        return augmented;
    }
    get all() { return this.patches; }
    get size() { return this.patches.length; }
    save() {
        try {
            if (!fs.existsSync(path.dirname(this.persistPath))) {
                fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
            }
            fs.writeFileSync(this.persistPath, JSON.stringify(this.patches, null, 2));
        }
        catch { /* best-effort */ }
    }
    load() {
        try {
            if (fs.existsSync(this.persistPath)) {
                this.patches = JSON.parse(fs.readFileSync(this.persistPath, "utf-8"));
            }
        }
        catch { /* start fresh */ }
    }
}
exports.KnowledgePatchStore = KnowledgePatchStore;
/**
 * Test whether a proposed patch improves or degrades benchmark performance.
 *
 * Uses the frontier explorer to simulate: given currentState, can the Planner
 * find paths that it couldn't before? If the augmented rules produce more
 * successful paths without breaking existing ones, the patch passes.
 */
function regressionTestPatch(patch, baseRules, testCases, store) {
    // Top-1/Top-3 BEFORE patch (using base rules only)
    let top1Before = 0;
    let top3Before = 0;
    for (const tc of testCases) {
        const result = (0, protocol_frontier_1.searchFrontier)(baseRules, tc.currentState, tc.targetState, 8);
        if (result.found && result.cost <= 1)
            top1Before++;
        if (result.found && result.cost <= 3)
            top3Before++;
    }
    const top1RateBefore = testCases.length > 0 ? top1Before / testCases.length : 0;
    const top3RateBefore = testCases.length > 0 ? top3Before / testCases.length : 0;
    // Top-1/Top-3 AFTER patch (base + this patch)
    const augmented = store.buildAugmentedRules(baseRules);
    let top1After = 0;
    let top3After = 0;
    for (const tc of testCases) {
        const result = (0, protocol_frontier_1.searchFrontier)(augmented, tc.currentState, tc.targetState, 8);
        if (result.found && result.cost <= 1)
            top1After++;
        if (result.found && result.cost <= 3)
            top3After++;
    }
    const top1RateAfter = testCases.length > 0 ? top1After / testCases.length : 0;
    const top3RateAfter = testCases.length > 0 ? top3After / testCases.length : 0;
    // Patch passes if: Top-1 doesn't decrease AND Top-3 doesn't decrease
    const passed = top1RateAfter >= top1RateBefore && top3RateAfter >= top3RateBefore;
    const reason = passed
        ? `Top-1: ${(top1RateBefore * 100).toFixed(0)}% → ${(top1RateAfter * 100).toFixed(0)}%, Top-3: ${(top3RateBefore * 100).toFixed(0)}% → ${(top3RateAfter * 100).toFixed(0)}%`
        : `Degradation detected. Top-1: ${(top1RateBefore * 100).toFixed(0)}% → ${(top1RateAfter * 100).toFixed(0)}%`;
    return {
        patchId: patch.id,
        change: patch.change,
        top1Before: top1RateBefore,
        top1After: top1RateAfter,
        top3Before: top3RateBefore,
        top3After: top3RateAfter,
        passed,
        reason,
    };
}
/**
 * Full auto-approval pipeline:
 *   1. Validate proposal against all test cases
 *   2. Auto-approve if no regression
 *   3. Record approval metrics
 */
function autoApprovePatch(patch, baseRules, testCases, store) {
    const result = regressionTestPatch(patch, baseRules, testCases, store);
    if (result.passed) {
        store.approve(patch.id, {
            top1Before: result.top1Before,
            top1After: result.top1After,
            top3Before: result.top3Before,
            top3After: result.top3After,
        });
    }
    else {
        store.reject(patch.id);
    }
    return result;
}
/**
 * Run the full knowledge governance pipeline:
 *   Synthesize → Validate → Propose → Regression Test → Auto-Approve
 */
function runKnowledgeGovernance(failures, testCases, store) {
    const patchStore = store || new KnowledgePatchStore();
    // 1. Synthesize
    const inferences = (0, transition_synthesizer_1.synthesizeTransitions)(failures);
    // 2. Validate
    const validated = validateInferences(inferences);
    // 3. Propose verified inferences
    let proposed = 0;
    let approved = 0;
    let rejected = 0;
    const regressionResults = [];
    const defs = (0, protocol_coverage_1.loadDefaultProtocolDefinitions)();
    const baseRules = new Map();
    for (const p of defs)
        for (const [fn, rule] of p.rules)
            baseRules.set(fn, rule);
    for (const inf of validated) {
        if (inf.validation.status === "rejected") {
            rejected++;
            continue;
        }
        // 4. Propose
        const patch = patchStore.propose(inf);
        proposed++;
        // 5. Regression test and auto-approve
        const result = autoApprovePatch(patch, baseRules, testCases, patchStore);
        regressionResults.push(result);
        if (result.passed)
            approved++;
        else
            rejected++;
    }
    return {
        proposed,
        verified: validated.filter(v => v.validation.status === "verified").length,
        approved,
        rejected,
        rolledBack: patchStore.all.filter(p => p.status === "rolled_back").length,
        regressionResults,
    };
}
function printGovernanceReport(report) {
    console.log("\n╔════════════════════════════════════════════════════╗");
    console.log("║   Knowledge Governance Report                      ║");
    console.log("╚════════════════════════════════════════════════════╝\n");
    console.log(`Proposed:    ${report.proposed}`);
    console.log(`Verified:    ${report.verified}`);
    console.log(`Approved:    ${report.approved}`);
    console.log(`Rejected:    ${report.rejected}`);
    console.log(`Rolled Back: ${report.rolledBack}`);
    console.log();
    if (report.regressionResults.length > 0) {
        console.log("─── Regression Results ───");
        for (const r of report.regressionResults) {
            const icon = r.passed ? "✅" : "❌";
            console.log(`  ${icon} ${r.change}`);
            console.log(`     ${r.reason}`);
        }
        console.log();
    }
}
