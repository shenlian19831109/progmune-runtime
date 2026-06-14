"use strict";
/**
 * P5.3: Autonomous Patch Generation
 *
 * Closes the self-improvement loop by auto-generating goal templates
 * and knowledge patches from the Skill Library.
 *
 * Loop: Skill Library → Goal Templates → Knowledge Patches
 *       → Regression Test → Auto-Approve → Deploy
 *
 * This is the final piece of the autonomous Meta-Learning System.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatePatchesFromSkills = generatePatchesFromSkills;
exports.generateTemplatesFromSkills = generateTemplatesFromSkills;
exports.runAutonomousPipeline = runAutonomousPipeline;
exports.printAutonomousReport = printAutonomousReport;
const knowledge_governance_1 = require("./knowledge-governance");
const knowledge_governance_2 = require("./knowledge-governance");
const protocol_coverage_1 = require("./protocol-coverage");
/**
 * Generate knowledge patches from high-confidence skills.
 *
 * For each skill with success rate > threshold, creates:
 *   1. A proposed KnowledgePatch
 *   2. Runs regression test
 *   3. Auto-approves if no regression
 *
 * @returns Results for each skill processed
 */
function generatePatchesFromSkills(library, telemetry, patchStore, minSuccessRate = 0.85) {
    const store = patchStore || new knowledge_governance_1.KnowledgePatchStore();
    const results = [];
    // Load protocol rules for regression testing
    const defs = (0, protocol_coverage_1.loadDefaultProtocolDefinitions)();
    const baseRules = new Map();
    for (const p of defs)
        for (const [fn, rule] of p.rules)
            baseRules.set(fn, rule);
    // Build test cases: for each skill, verify Frontier can find the skill's actions
    const testCases = [];
    for (const skill of library.all()) {
        testCases.push({
            currentState: skill.preconditions,
            targetState: skill.effects.length > 0 ? [skill.effects[0]] : [],
        });
    }
    for (const skill of library.all()) {
        if (skill.successRate < minSuccessRate) {
            results.push({
                skillId: skill.id,
                skillGoal: skill.goal,
                status: "skipped",
                reason: `Success rate ${(skill.successRate * 100).toFixed(0)}% < ${(minSuccessRate * 100).toFixed(0)}% threshold`,
            });
            continue;
        }
        // Check if already proposed
        const existing = store.all.find(p => p.change === skill.macro.join(" → "));
        if (existing) {
            results.push({
                skillId: skill.id, skillGoal: skill.goal, patchId: existing.id,
                status: existing.status === "approved" ? "approved" : "skipped",
                reason: `Already ${existing.status}`,
            });
            continue;
        }
        // Propose patch: this skill's macro as a virtual rule
        const patch = store.propose({
            from: skill.preconditions[0] || "INIT",
            to: skill.effects[0] || "COMPLETED",
            action: skill.macro.join(" → "),
            protocol: skill.protocol,
            confidence: skill.successRate,
            evidenceCount: skill.frequency,
            examples: [skill.goal],
            validation: {
                benchmarkSupport: skill.frequency,
                trajectorySupport: skill.frequency,
                contradictionCount: 0,
                status: "verified",
            },
        });
        results.push({
            skillId: skill.id,
            skillGoal: skill.goal,
            patchId: patch.id,
            status: "generated",
            reason: `Proposed from skill (${(skill.successRate * 100).toFixed(0)}% success, ${skill.frequency} samples)`,
        });
        // Run regression test
        const regResult = (0, knowledge_governance_2.regressionTestPatch)(patch, baseRules, testCases, store);
        if (regResult.passed) {
            store.approve(patch.id, {
                top1Before: regResult.top1Before,
                top1After: regResult.top1After,
                top3Before: regResult.top3Before,
                top3After: regResult.top3After,
            });
            results[results.length - 1].status = "approved";
        }
        else {
            store.reject(patch.id);
            results[results.length - 1].status = "rejected";
        }
    }
    return results;
}
/**
 * Auto-generate goal templates from skills.
 *
 * Converts each skill's action sequence into a regex pattern
 * that matches related natural language goals.
 */
function generateTemplatesFromSkills(library) {
    return library.all().map(skill => {
        // Generate a regex pattern from the action names
        const keywords = skill.macro
            .flatMap(fn => fn.split("_"))
            .filter(w => w.length > 2)
            .filter(w => !["then", "file", "the"].includes(w));
        const pattern = keywords.join(".*");
        return {
            pattern,
            protocol: skill.protocol,
            actions: skill.macro,
            skillId: skill.id,
            successRate: skill.successRate,
        };
    });
}
/**
 * Run the full autonomous patch generation pipeline.
 *
 *   Skill Library → Templates + Patches → Regression → Approve
 */
function runAutonomousPipeline(library, telemetry, patchStore) {
    const store = patchStore || new knowledge_governance_1.KnowledgePatchStore();
    const patchResults = generatePatchesFromSkills(library, telemetry, store);
    const templates = generateTemplatesFromSkills(library);
    const approved = patchResults.filter(r => r.status === "approved").length;
    const rejected = patchResults.filter(r => r.status === "rejected").length;
    return {
        skills: library.size,
        patchesGenerated: patchResults.length,
        patchesApproved: approved,
        patchesRejected: rejected,
        templatesGenerated: templates.length,
        summary: approved > 0
            ? `${approved} patches auto-approved. ${templates.length} templates generated. System is self-extending.`
            : `No patches met the approval threshold. ${templates.length} templates generated.`,
    };
}
function printAutonomousReport(report, results) {
    console.log("\n╔════════════════════════════════════════════════════╗");
    console.log("║   P5.3 Autonomous Patch Generation                 ║");
    console.log("╚════════════════════════════════════════════════════╝\n");
    console.log(`Skills in Library:   ${report.skills}`);
    console.log(`Patches Generated:   ${report.patchesGenerated}`);
    console.log(`Patches Approved:    ${report.patchesApproved}`);
    console.log(`Patches Rejected:    ${report.patchesRejected}`);
    console.log(`Templates Generated: ${report.templatesGenerated}`);
    console.log();
    console.log(`Summary: ${report.summary}`);
    console.log();
    if (results && results.length > 0) {
        console.log("─── Patch Details ───");
        for (const r of results) {
            const icon = r.status === "approved" ? "✅" : r.status === "rejected" ? "❌" : r.status === "skipped" ? "⏭️" : "📝";
            console.log(`  ${icon} ${r.skillGoal}`);
            console.log(`     ${r.reason}`);
        }
        console.log();
    }
}
