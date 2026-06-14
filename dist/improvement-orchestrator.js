"use strict";
/**
 * P5.0: Self-Improvement Orchestrator
 *
 * The Automation Layer — closes the autonomous improvement loop:
 *   Benchmark → Error Budget → Gap Mining → Priority Selection
 *   → Knowledge Patch → Regression Test → Deploy → Benchmark
 *
 * This is the module that decides WHAT to improve next, replacing
 * manual developer intuition with data-driven prioritization.
 *
 * Core loop: Observe → Analyze → Plan → Execute → Verify
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateImprovementTasks = generateImprovementTasks;
exports.estimatePatchValue = estimatePatchValue;
exports.runImprovementLoop = runImprovementLoop;
exports.printOrchestrationPlan = printOrchestrationPlan;
const evaluation_campaign_1 = require("./evaluation-campaign");
const coverage_dashboard_1 = require("./coverage-dashboard");
const difficulty_map_1 = require("./difficulty-map");
const discovery_analytics_1 = require("./discovery-analytics");
const macro_repair_1 = require("./macro-repair");
const protocol_gap_analyzer_1 = require("./protocol-gap-analyzer");
const protocol_coverage_1 = require("./protocol-coverage");
// ═══════════════════════════════════════════════════════════════
// Task Generator
// ═══════════════════════════════════════════════════════════════
/**
 * Generate prioritized improvement tasks from all available analytics.
 *
 * Inputs:
 *   - Error Budget (what's broken?)
 *   - Coverage Gaps (what's missing?)
 *   - Difficulty Map (what's hardest?)
 *   - Discovery Report (where are candidates not found?)
 *   - Macro Repairs (what patterns are accepted?)
 *
 * Output: ranked list of concrete improvement actions.
 */
function generateImprovementTasks(telemetry, attributed) {
    const tasks = [];
    const failures = attributed.filter(a => a.failureReason !== "success");
    // 1. From Gap Mining: add missing transitions
    const protoDefs = (0, protocol_coverage_1.loadDefaultProtocolDefinitions)();
    const rules = new Map();
    for (const p of protoDefs)
        rules.set(p.name, new Set([...p.rules.keys()]));
    const gapReport = (0, protocol_gap_analyzer_1.analyzeProtocolGaps)(attributed, rules);
    // Missing transitions have highest priority (92% of gaps)
    for (const mt of gapReport.topMissingTransitions.slice(0, 15)) {
        const [fnA, fnB] = mt.split("→");
        const proto = gapReport.gaps.find(g => g.item === mt)?.protocols[0] || "unknown";
        const freq = gapReport.gaps.find(g => g.item === mt)?.frequency || 1;
        const priority = Math.min(1, freq / Math.max(1, failures.length));
        tasks.push({
            id: `improve-transition-${mt.replace(/[→]/g, "-")}`,
            type: "add_transition",
            priority,
            protocol: proto,
            expectedGain: priority * 0.07, // each missing transition found = ~7% potential gain
            evidence: gapReport.gaps.find(g => g.item === mt)?.examples?.slice(0, 3) || [],
            detail: `Add inferred transition: ${fnA} → ${fnB} (${proto}, freq=${freq})`,
            autoApplicable: true,
        });
    }
    // 2. From Macro Mining: add high-acceptance macros as templates
    const macros = (0, macro_repair_1.mineMacroRepairs)(telemetry, 0.7, 3);
    for (const macro of macros.slice(0, 10)) {
        const priority = macro.acceptanceRate * 0.8 + macro.executionSuccessRate * 0.2;
        tasks.push({
            id: `improve-macro-${macro.id}`,
            type: "add_macro",
            priority,
            protocol: macro.protocol,
            expectedGain: 0.03 * (macro.frequency / 10),
            evidence: [macro.goal],
            detail: `Add macro repair: ${macro.actions.join(" → ")} (accept=${(macro.acceptanceRate * 100).toFixed(0)}%, freq=${macro.frequency})`,
            autoApplicable: false, // macros need human review before becoming templates
        });
    }
    // 3. From Coverage: add missing protocol bridges
    const coverage = (0, coverage_dashboard_1.generateCoverageDashboard)();
    for (const report of coverage.reports) {
        for (const mt of report.transitionCoverage.missingTransitions.slice(0, 5)) {
            const priority = 0.5; // coverage gaps have moderate priority
            tasks.push({
                id: `improve-coverage-${report.protocol}-${mt.from}-${mt.to}`,
                type: "expand_protocol",
                priority,
                protocol: report.protocol,
                expectedGain: 0.02,
                evidence: [`${mt.from} → ${mt.to} uncovered in ${report.protocol}`],
                detail: `Add coverage for missing transition: ${mt.from} → ${mt.to} in ${report.protocol}`,
                autoApplicable: false,
            });
        }
    }
    // 4. From Difficulty Map: prioritize hardest protocols
    const statsMap = (0, difficulty_map_1.buildDifficultyMap)([], [...telemetry.all()]);
    const ranking = (0, difficulty_map_1.rankProtocolsByDifficulty)(statsMap);
    for (const r of ranking.filter(r => r.maxDifficulty > 0.1)) {
        tasks.push({
            id: `improve-difficulty-${r.protocol}`,
            type: "expand_template",
            priority: r.maxDifficulty,
            protocol: r.protocol,
            expectedGain: r.maxDifficulty * 0.05,
            evidence: [r.hardestTransition],
            detail: `Prioritize protocol expansion: ${r.protocol} (max difficulty=${(r.maxDifficulty * 100).toFixed(0)}%, hardest: ${r.hardestTransition})`,
            autoApplicable: false,
        });
    }
    // Sort by priority descending
    return tasks.sort((a, b) => b.priority - a.priority);
}
// ═══════════════════════════════════════════════════════════════
// Patch Value Estimation
// ═══════════════════════════════════════════════════════════════
/**
 * Estimate the value of applying a knowledge patch.
 *
 * Uses the error budget to estimate potential improvement:
 *   - Each missing_transition solved = ~7% of missing_candidate cases
 *   - Each macro added = ~3% of relevant cases
 */
function estimatePatchValue(task, errorBudget, totalCases) {
    const missingCases = Math.round(totalCases * errorBudget.missingPct);
    switch (task.type) {
        case "add_transition":
            // Each new transition can cover ~5-10% of missing cases
            return {
                discoveryGain: Math.min(task.expectedGain, errorBudget.missingPct),
                top3Gain: task.expectedGain * 0.5,
                top1Gain: task.expectedGain * 0.2,
            };
        case "add_macro":
            return {
                discoveryGain: task.expectedGain,
                top3Gain: task.expectedGain * 0.6,
                top1Gain: task.expectedGain * 0.3,
            };
        case "add_bridge":
            return {
                discoveryGain: task.expectedGain,
                top3Gain: task.expectedGain * 0.4,
                top1Gain: task.expectedGain * 0.15,
            };
        default:
            return {
                discoveryGain: task.expectedGain,
                top3Gain: task.expectedGain * 0.3,
                top1Gain: task.expectedGain * 0.1,
            };
    }
}
// ═══════════════════════════════════════════════════════════════
// Full Orchestration Loop
// ═══════════════════════════════════════════════════════════════
async function runImprovementLoop(telemetry) {
    // 1. Observe: run benchmark
    const attributed = await (0, evaluation_campaign_1.runFailureAttribution)();
    const budget = (0, evaluation_campaign_1.computeErrorBudget)(attributed);
    const discovery = (0, discovery_analytics_1.computeDiscoveryMetrics)(attributed);
    // 2. Analyze: generate improvement tasks
    const tasks = generateImprovementTasks(telemetry, attributed);
    // 3. Estimate value of top tasks
    const topTasks = tasks.slice(0, 5).map(t => ({
        ...t,
        gain: estimatePatchValue(t, { missingPct: budget.percentages.missing_candidate || 0, rankingPct: budget.percentages.bad_ranking || 0, successPct: budget.successRate }, budget.totalCases),
    }));
    // 4. Top recommendation
    const top = topTasks[0];
    const topRec = top
        ? `#1: ${top.detail} (priority=${(top.priority * 100).toFixed(0)}%, est. discovery gain=${(top.gain.discoveryGain * 100).toFixed(1)}%)`
        : "No improvements needed — all metrics within target range.";
    return {
        timestamp: new Date().toISOString(),
        errorBudget: { missingPct: budget.percentages.missing_candidate || 0, rankingPct: budget.percentages.bad_ranking || 0, successPct: budget.successRate },
        discoveryRate: discovery.overall,
        tasks,
        topRecommendation: topRec,
    };
}
function printOrchestrationPlan(plan) {
    console.log("\n╔════════════════════════════════════════════════════╗");
    console.log("║   P5.0 Self-Improvement Orchestrator               ║");
    console.log("╚════════════════════════════════════════════════════╝\n");
    console.log(`Timestamp:       ${plan.timestamp}`);
    console.log(`Discovery Rate:  ${(plan.discoveryRate * 100).toFixed(0)}%`);
    console.log(`Error Budget:    missing=${(plan.errorBudget.missingPct * 100).toFixed(0)}%  ranking=${(plan.errorBudget.rankingPct * 100).toFixed(0)}%  success=${(plan.errorBudget.successPct * 100).toFixed(0)}%`);
    console.log();
    console.log(`Top Recommendation: ${plan.topRecommendation}`);
    console.log();
    if (plan.tasks.length > 0) {
        console.log("─── Prioritized Improvement Tasks ───");
        console.log("Pri    Type              Protocol        Detail");
        console.log("─────────────────────────────────────────────────────────");
        for (const t of plan.tasks.slice(0, 15)) {
            const pri = (t.priority * 100).toFixed(0).padStart(4);
            const type = t.type.replace(/_/g, " ").padEnd(16);
            console.log(`  ${pri}%  ${type} ${t.protocol.padEnd(16)} ${t.detail.slice(0, 50)}`);
        }
        console.log();
    }
}
