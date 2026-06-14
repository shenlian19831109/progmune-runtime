"use strict";
/**
 * P4.6: Macro Repair Mining
 *
 * Mines high-acceptance trajectory patterns from Telemetry
 * and converts them into reusable MacroRepair templates.
 *
 * A MacroRepair is a frequently-accepted action sequence that
 * can be directly suggested as a repair candidate — serving
 * as a fourth candidate source alongside Corpus/Protocol/Antibody.
 *
 * Example mined macro:
 *   verify_password → generate_jwt → create_session
 *   (acceptance: 92%, frequency: 45)
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
exports.mineMacroRepairs = mineMacroRepairs;
exports.saveMacroRepairs = saveMacroRepairs;
exports.loadMacroRepairs = loadMacroRepairs;
exports.printMacroReport = printMacroReport;
const planner_telemetry_1 = require("./planner-telemetry");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const MACRO_DIR = path.resolve(process.env.PROGMUNE_PROJECT_DIR || process.cwd(), ".progmune_corpus", "macros");
function ensureDir(dir) {
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
}
// ═══════════════════════════════════════════════════════════════
// Mining
// ═══════════════════════════════════════════════════════════════
/**
 * Mine high-acceptance action sequences from telemetry data.
 *
 * Scans all decisions with feedback, groups by action signature,
 * and identifies sequences that meet minimum acceptance + frequency thresholds.
 */
function mineMacroRepairs(telemetry, minAcceptance = 0.7, minFrequency = 3) {
    const decisions = telemetry.all();
    // Group by action signature + protocol
    const groups = new Map();
    for (const d of decisions) {
        if (!d.feedback || !d.selectedCandidateId || !d.protocol)
            continue;
        const sel = d.candidates.find(c => c.candidateId === d.selectedCandidateId);
        if (!sel || sel.actions.length === 0)
            continue;
        const key = `${d.protocol}:${sel.actions.join("→")}`;
        const entry = groups.get(key);
        if (entry) {
            entry.count++;
            if (d.feedback.decision === "accepted")
                entry.accepted++;
            else
                entry.rejected++;
            if (d.feedback.executionResult?.success === true)
                entry.execSuccess++;
            else if (d.feedback.executionResult?.success === false)
                entry.execFailure++;
            if (d.cost?.latencyMs)
                entry.totalLatency += d.cost.latencyMs;
            entry.goals.set(d.goal, (entry.goals.get(d.goal) || 0) + 1);
            entry.violationTypes.set(d.violationType || "unknown", (entry.violationTypes.get(d.violationType || "unknown") || 0) + 1);
        }
        else {
            groups.set(key, {
                accepted: d.feedback.decision === "accepted" ? 1 : 0,
                rejected: d.feedback.decision === "rejected" ? 1 : 0,
                execSuccess: d.feedback.executionResult?.success === true ? 1 : 0,
                execFailure: d.feedback.executionResult?.success === false ? 1 : 0,
                totalLatency: d.cost?.latencyMs || 0,
                count: 1,
                goals: new Map([[d.goal, 1]]),
                violationTypes: new Map([[d.violationType || "unknown", 1]]),
            });
        }
    }
    const macros = [];
    for (const [key, entry] of groups) {
        if (entry.count < minFrequency)
            continue;
        const totalFeedback = entry.accepted + entry.rejected;
        const acceptanceRate = totalFeedback > 0 ? entry.accepted / totalFeedback : 0;
        if (acceptanceRate < minAcceptance)
            continue;
        const execTotal = entry.execSuccess + entry.execFailure;
        const executionSuccessRate = execTotal > 0 ? entry.execSuccess / execTotal : 0;
        const [protocol, actionStr] = key.split(":");
        const actions = actionStr.split("→");
        const topGoal = [...entry.goals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";
        const topViolation = [...entry.violationTypes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";
        macros.push({
            id: `macro-${(0, planner_telemetry_1.candidateFingerprint)(protocol, actions, topViolation)}`,
            actions,
            protocol,
            violationType: topViolation,
            acceptanceRate,
            executionSuccessRate,
            frequency: entry.count,
            avgLatencyMs: entry.count > 0 ? entry.totalLatency / entry.count : 0,
            goal: topGoal,
        });
    }
    return macros.sort((a, b) => b.acceptanceRate - a.acceptanceRate);
}
/**
 * Persist mined macros for reuse across sessions.
 */
function saveMacroRepairs(macros) {
    ensureDir(MACRO_DIR);
    const filepath = path.join(MACRO_DIR, `macros-${new Date().toISOString().slice(0, 10)}.json`);
    fs.writeFileSync(filepath, JSON.stringify(macros, null, 2));
    return filepath;
}
/**
 * Load previously mined macros.
 */
function loadMacroRepairs() {
    if (!fs.existsSync(MACRO_DIR))
        return [];
    const macros = [];
    const files = fs.readdirSync(MACRO_DIR).filter(f => f.endsWith(".json"));
    for (const file of files) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(MACRO_DIR, file), "utf-8"));
            if (Array.isArray(data))
                macros.push(...data);
        }
        catch { /* skip */ }
    }
    return macros.sort((a, b) => b.acceptanceRate - a.acceptanceRate);
}
function printMacroReport(macros) {
    console.log("\n─── Macro Repair Mining Report ───");
    console.log(`Mined ${macros.length} high-acceptance repair templates\n`);
    if (macros.length === 0) {
        console.log("  No macros meet the minimum thresholds. Collect more feedback data.");
        return;
    }
    console.log("Top 10 Macros:");
    console.log("Accept  ExecOk  Freq  Actions");
    console.log("──────────────────────────────────────────────────");
    for (const m of macros.slice(0, 10)) {
        const acc = (m.acceptanceRate * 100).toFixed(0).padStart(4);
        const exec = (m.executionSuccessRate * 100).toFixed(0).padStart(4);
        const freq = String(m.frequency).padStart(4);
        console.log(`  ${acc}%  ${exec}%  ${freq}  ${m.actions.join(" → ")}`);
    }
    console.log();
}
