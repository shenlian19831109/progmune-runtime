"use strict";
/**
 * Semantic Observatory — Terminal-based Semantic Trace Viewer
 *
 * Reads IntentSessions from the failure corpus and renders a timeline-first
 * view of AI reasoning evolution: attempts, failures, repair paths, and success.
 *
 * Usage:
 *   ts-node src/semantic-trace.ts                      → all sessions summary
 *   ts-node src/semantic-trace.ts <sessionId>          → full timeline for one session
 *   ts-node src/semantic-trace.ts replay <sessionId>   → step-by-step cognitive replay
 *   ts-node src/semantic-trace.ts --states <sessionId> → state transition visualization
 *   ts-node src/semantic-trace.ts --genome             → failure genome summary
 *   ts-node src/semantic-trace.ts --learned            → antibody registry with ACL levels
 *   ts-node src/semantic-trace.ts --heatmap            → semantic heatmap
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
const failure_corpus_1 = require("./failure-corpus");
// ── ANSI colors ──
const C = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m", gray: "\x1b[90m", bold: "\x1b[1m", dim: "\x1b[2m" };
const G = (s) => `${C.green}${s}${C.reset}`;
const R = (s) => `${C.red}${s}${C.reset}`;
const Y = (s) => `${C.yellow}${s}${C.reset}`;
const C_ = (s) => `${C.cyan}${s}${C.reset}`;
const D = (s) => `${C.gray}${s}${C.reset}`;
const B = (s) => `${C.bold}${s}${C.reset}`;
function narrateRejection(a) {
    const svl = a.violatedSVL;
    const missing = a.ssgMissingFunctions?.length ? a.ssgMissingFunctions.join(", ") : null;
    // Try to extract the blocked function from the error
    const blockedMatch = a.errorDetail.match(/(\w+)\s*(要求|requires|blocked|不允许|不合法)/);
    const blocked = blockedMatch ? blockedMatch[1] : a.actionSequence[0]?.function || "unknown";
    switch (svl) {
        case "SVL-1":
            return `Planner referenced a function that does not exist in the project.\n     ${D("→ " + a.errorDetail)}`;
        case "SVL-2":
            return `Planner called a function with incorrect argument types.\n     ${D("→ " + a.errorDetail)}`;
        case "SVL-3":
            return `Planner used a variable before it was defined or referenced it circularly.\n     ${D("→ " + a.errorDetail)}`;
        case "SVL-4":
            if (missing) {
                return `Planner attempted to call ${R(blocked)} before ${C_(missing)} was established.`;
            }
            return `Planner violated the protocol contract for ${R(blocked)}.\n     ${D("→ " + a.errorDetail)}`;
        default:
            return a.errorDetail;
    }
}
function narrateSuccess(actions) {
    const names = actions
        .filter(a => a.kind === "call" && a.function)
        .map(a => a.function)
        .join(" → ");
    return `Successfully completed: ${G(names)}.`;
}
// ── Timeline rendering ──
function formatActionSequence(actions) {
    return actions
        .filter(a => a.kind === "call" && a.function)
        .map(a => C_(a.function + "()"))
        .join(`  ${D("→")}  `);
}
function formatSessionTimeline(session) {
    const width = 66;
    const title = `Intent: ${session.intent}`;
    const header = `┌─ ${B(title)} ${"─".repeat(Math.max(2, width - title.length - 5))}┐`;
    const resolvedIcon = session.resolved ? G("✔") : R("✖");
    const info = `│ Session: ${D(session.sessionId)}  │  Retries: ${session.totalRetries}  │  Resolved: ${resolvedIcon} ${" ".repeat(Math.max(1, 15))}│`;
    const footer = `└${"─".repeat(width - 2)}┘`;
    const lines = [header, info, footer, ""];
    // Render all failure attempts
    for (let i = 0; i < session.attempts.length; i++) {
        const a = session.attempts[i];
        const num = i + 1;
        const actions = a.actionSequence || [];
        const actionDisplay = formatActionSequence(actions);
        lines.push(`  Attempt ${num} ${"─".repeat(62)}`);
        lines.push(`  │  ${actionDisplay || D("(no actions)")}`);
        lines.push(`  │`);
        const narration = narrateRejection(a);
        const lines_narration = narration.split("\n");
        lines.push(`  ${R("✖")}  ${lines_narration[0]}`);
        for (let j = 1; j < lines_narration.length; j++) {
            lines.push(`     ${lines_narration[j]}`);
        }
        // Show SSG context for protocol failures
        if (a.violatedSVL === "SVL-4") {
            if (a.ssgMissingFunctions?.length) {
                const missingList = a.ssgMissingFunctions.join(", ");
                lines.push(`     ${D("→")} Missing: ${C_(missingList)}`);
            }
            if (a.ssgFixPath?.length) {
                const fixList = a.ssgFixPath.join(" → ");
                lines.push(`     ${D("→")} Repair:  ${Y(fixList)}`);
            }
        }
        if (a.plannerAttempt && a.plannerRetryTotal && a.plannerRetryTotal > 1) {
            lines.push(`     ${D(`(retry ${a.plannerAttempt}/${a.plannerRetryTotal})`)}`);
        }
        lines.push("");
    }
    // Final resolution
    if (session.resolved && session.successfulAlternative) {
        const actions = session.successfulAlternative || [];
        const actionDisplay = formatActionSequence(actions);
        lines.push(`  ${G("✔")} Resolution ${"─".repeat(51)}`);
        lines.push(`  │  ${actionDisplay}`);
        lines.push(`  │`);
        const narration = narrateSuccess(actions);
        lines.push(`  ${G("✔")}  ${narration}`);
        lines.push(`     ${D(`Resolved after ${session.totalRetries} retries.`)}`);
        lines.push("");
    }
    else if (!session.resolved) {
        lines.push(`  ${R("✖")} ${B("Unresolved")} ${"─".repeat(50)}`);
        lines.push(`     ${D(`Failed after ${session.totalRetries} retries with no successful path.`)}`);
        lines.push("");
    }
    return lines.join("\n");
}
// ── Summary table rendering ──
function pad(s, w) {
    const visible = s.replace(/\x1b\[[0-9;]*m/g, "").length;
    return s + " ".repeat(Math.max(0, w - visible));
}
function formatSessionSummary(sessions) {
    if (sessions.length === 0) {
        return `${D("No sessions recorded yet.")}\nRun the planner to generate semantic traces.`;
    }
    const header = `Sessions in failure corpus (${sessions.length} total):\n`;
    const colW = { session: 16, intent: 28, attempts: 10, resolved: 10 };
    const sep = "─".repeat(70);
    const lines = [
        header,
        `┌${sep}┐`,
        `│ ${pad("Session", colW.session)}│ ${pad("Intent", colW.intent)}│ ${pad("Attempts", colW.attempts)}│ ${pad("Resolved", colW.resolved)}│`,
        `├${sep}┤`,
    ];
    for (const s of sessions) {
        const shortId = s.sessionId.length > 14 ? s.sessionId.slice(0, 13) + "…" : s.sessionId;
        const shortIntent = s.intent.length > 26 ? s.intent.slice(0, 25) + "…" : s.intent;
        const resolved = s.resolved ? G("✔ resolved") : R("✖ unresolved");
        lines.push(`│ ${pad(D(shortId), colW.session)}│ ${pad(shortIntent, colW.intent)}│ ${pad(String(s.attempts.length), colW.attempts)}│ ${pad(resolved, colW.resolved)}│`);
    }
    lines.push(`└${sep}┘`);
    lines.push("");
    lines.push(`${D("Commands:")} timeline | replay | --states | --genome | --learned | --heatmap`);
    return lines.join("\n");
}
// ── Genome summary ──
function formatGenomeSummary() {
    const g = (0, failure_corpus_1.getFailureGenome)();
    if (g.totalFailures === 0) {
        return `${D("No failures recorded yet.")}`;
    }
    const bar = "─".repeat(56);
    const lines = [
        `┌─ ${B("Failure Genome")} ${bar.slice(0, 40)}┐`,
        `│ Total failures: ${R(String(g.totalFailures))}${" ".repeat(39)}│`,
        `│ Average retries: ${Y(String(g.averageRetriesToSuccess))}${" ".repeat(38)}│`,
        `├${bar}┤`,
        `│ ${B("By SVL Level")}${" ".repeat(44)}│`,
        `│   SVL-1 (Symbol):     ${barChart(g.bySVL["SVL-1"], g.totalFailures)} ${g.bySVL["SVL-1"]} │`,
        `│   SVL-2 (Type):       ${barChart(g.bySVL["SVL-2"], g.totalFailures)} ${g.bySVL["SVL-2"]} │`,
        `│   SVL-3 (Dataflow):   ${barChart(g.bySVL["SVL-3"], g.totalFailures)} ${g.bySVL["SVL-3"]} │`,
        `│   SVL-4 (Protocol):   ${barChart(g.bySVL["SVL-4"], g.totalFailures)} ${g.bySVL["SVL-4"]} │`,
        `├${bar}┤`,
    ];
    if (g.topPatterns.length > 0) {
        lines.push(`│ ${B("Top Failure Patterns")}${" ".repeat(37)}│`);
        for (const p of g.topPatterns) {
            const label = `${p.pattern}: ${p.count}x`;
            lines.push(`│   ${label}${" ".repeat(Math.max(1, 52 - label.length))}│`);
        }
        lines.push(`├${bar}┤`);
    }
    if (g.commonFixPaths.length > 0) {
        lines.push(`│ ${B("Common Repair Paths")}${" ".repeat(36)}│`);
        for (const fp of g.commonFixPaths.slice(0, 4)) {
            const path = fp.fixPath.join(" → ");
            const label = `  ${path} (${fp.count}x)`;
            const trimmed = label.length > 52 ? label.slice(0, 49) + "..." : label;
            lines.push(`│ ${trimmed}${" ".repeat(Math.max(1, 52 - trimmed.length))}│`);
        }
        lines.push(`├${bar}┤`);
    }
    // By constraint type
    const constraints = Object.entries(g.byConstraintType).sort((a, b) => b[1] - a[1]);
    if (constraints.length > 0) {
        lines.push(`│ ${B("By Constraint Type")}${" ".repeat(37)}│`);
        for (const [k, v] of constraints) {
            lines.push(`│   ${k}: ${v}${" ".repeat(Math.max(1, 51 - k.length - String(v).length))}│`);
        }
    }
    lines.push(`└${bar}┘`);
    return lines.join("\n");
}
function barChart(count, total) {
    if (total === 0)
        return D("▏".repeat(0));
    const maxBars = 20;
    const n = Math.round((count / total) * maxBars);
    if (n === 0 && count > 0)
        return Y("▏");
    if (n === 0)
        return D("▏".repeat(0));
    return Y("█".repeat(n)) + D("░".repeat(maxBars - n));
}
// ── Learned patterns ──
function aclBadge(level) {
    switch (level) {
        case "ACL-4": return G(`◆ ${level} (globally stable)`);
        case "ACL-3": return C_(`◈ ${level} (cross-task validated)`);
        case "ACL-2": return Y(`◇ ${level} (repeated observation)`);
        case "ACL-1": return D(`◌ ${level} (single case)`);
        default: return D(level);
    }
}
function formatLearnedPatterns() {
    const learned = (0, failure_corpus_1.getLearnedPatterns)();
    const patterns = learned.failureToFix;
    if (patterns.length === 0) {
        return `${D("No learned patterns yet.")}\nPatterns emerge when sessions capture failures with repair paths.`;
    }
    const lines = [
        `${B("Antibody Registry")} (${patterns.length} patterns)`,
        "─".repeat(72),
    ];
    for (const p of patterns) {
        const path = p.fixPath.join(" → ");
        const intents = p.distinctIntents.slice(0, 3).join(", ");
        const moreIntents = p.distinctIntents.length > 3 ? ` +${p.distinctIntents.length - 3} more` : "";
        const ratePct = Math.round(p.resolvedRate * 100);
        lines.push(`  ${B("Signature:")}  ${R(p.violation)}`);
        lines.push(`  ${D("Repair:")}     ${Y(path)}`);
        lines.push(`  ${D("Confidence:")} ${aclBadge(p.antibodyLevel)}`);
        lines.push(`  ${D("Occurrences:")} ${p.occurrenceCount}x  │  ${D("Resolved:")} ${ratePct}%  │  ${D("Intents:")} ${intents}${moreIntents}`);
        lines.push("");
    }
    return lines.join("\n");
}
// ── Semantic heatmap ──
const failure_corpus_2 = require("./failure-corpus");
const ssg_validator_1 = require("./ssg-validator");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function formatHeatmap() {
    const h = (0, failure_corpus_2.getSemanticHeatmap)();
    if (h.fragileProtocols.length === 0 && h.svlHotspots.length === 0) {
        return `${D("No heatmap data yet.")}`;
    }
    const lines = [];
    lines.push(`${B("Semantic Heatmap")}`);
    lines.push("═".repeat(72));
    lines.push("");
    // SVL hotspots as horizontal bars
    if (h.svlHotspots.length > 0) {
        lines.push(`  ${B("Immune Layer Activity")}`);
        lines.push(`  ${D("─".repeat(44))}`);
        const maxCount = Math.max(...h.svlHotspots.map(s => s.count), 1);
        const maxBar = 30;
        for (const s of h.svlHotspots) {
            const n = Math.round((s.count / maxCount) * maxBar) || (s.count > 0 ? 1 : 0);
            const bar = R("█".repeat(n)) + D("░".repeat(maxBar - n));
            const pct = `${s.percentage}%`.padStart(4);
            lines.push(`  ${s.svl.padEnd(8)} ${bar} ${String(s.count).padStart(2)} (${pct})`);
        }
        lines.push("");
    }
    // Fragile protocols
    if (h.fragileProtocols.length > 0) {
        lines.push(`  ${B("Fragile Protocols (most blocked functions)")}`);
        lines.push(`  ${D("─".repeat(52))}`);
        for (const fp of h.fragileProtocols.slice(0, 6)) {
            const heat = fp.violationCount >= 5 ? R("●●●") : fp.violationCount >= 3 ? Y("●●") : Y("●");
            lines.push(`  ${heat} ${C_(fp.function + "()")} ${D(`— ${fp.violationCount}x, ${fp.svl}`)}`);
        }
        lines.push("");
    }
    // Constraint clusters
    if (h.constraintClusters.length > 0) {
        lines.push(`  ${B("Constraint Co-occurrence")}`);
        lines.push(`  ${D("─".repeat(40))}`);
        for (const cc of h.constraintClusters.slice(0, 4)) {
            const cluster = cc.constraints.map(c => Y(c)).join(" + ");
            lines.push(`  ${cluster}`);
            lines.push(`  ${D(`  ↳ ${cc.count} anomalies in "${cc.intent.slice(0, 40)}"`)}`);
        }
        lines.push("");
    }
    // High friction intents
    if (h.highFrictionIntents.length > 0) {
        lines.push(`  ${B("High Friction Intents (most adaptations required)")}`);
        lines.push(`  ${D("─".repeat(52))}`);
        for (const fi of h.highFrictionIntents.slice(0, 5)) {
            const friction = fi.adaptationCount >= 4 ? R("■■■") : fi.adaptationCount >= 2 ? Y("■■") : Y("■");
            const types = fi.anomalyTypes.join(", ");
            lines.push(`  ${friction} ${fi.intent.slice(0, 40).padEnd(42)} ${D(`${fi.adaptationCount} adapts, ${types}`)}`);
        }
        lines.push("");
    }
    return lines.join("\n");
}
// ── State transition visualization ──
function loadProtocols() {
    const protocolsJson = path.join(__dirname, "..", "protocols.json");
    const protocols = [];
    // From protocols.json
    if (fs.existsSync(protocolsJson)) {
        const raw = JSON.parse(fs.readFileSync(protocolsJson, "utf-8"));
        for (const [funcName, rule] of Object.entries(raw.rules || {})) {
            const r = rule;
            protocols.push({
                function: funcName,
                protocol: {
                    pre_states: r.pre_states || [],
                    post_states: r.post_states || [],
                    invalidate: r.invalidate,
                },
            });
        }
    }
    return protocols;
}
function formatStateTransitionPath(actions) {
    const protocols = loadProtocols();
    if (protocols.length === 0) {
        return `${D("No protocol rules loaded. Add @protocol annotations or protocols.json.")}`;
    }
    const ssv = new ssg_validator_1.StateMachineValidator(protocols, "UNAUTHENTICATED");
    // Apply all protocol-governed actions
    for (const a of actions) {
        if (a.kind !== "call" || !a.function)
            continue;
        const proto = protocols.find(p => p.function === a.function);
        if (!proto)
            continue;
        ssv.apply(a.function);
    }
    const trace = ssv.getTrace();
    if (trace.length === 0) {
        return `${D("No protocol-governed functions in this sequence.")}`;
    }
    const lines = [];
    // Initial state
    lines.push(`  ${D("UNAUTHENTICATED")}`);
    for (const step of trace) {
        if (!step.valid)
            continue;
        const fnLabel = C_(step.function + "()");
        const beforeStr = (step.statesBefore || []).join(", ");
        const afterStr = (step.statesAfter || []).join(", ");
        // State delta
        const before = step.statesBefore || [];
        const after = step.statesAfter || [];
        const gained = after.filter((s) => !before.includes(s));
        const lost = before.filter((s) => !after.includes(s));
        let delta = "";
        if (gained.length > 0)
            delta += ` ${G("+" + gained.join(",+"))}`;
        if (lost.length > 0)
            delta += ` ${R("-" + lost.join(",-"))}`;
        lines.push(`  │`);
        lines.push(`  ├─ ${fnLabel}`);
        lines.push(`  │  ${D(beforeStr || "—")} ${D("──▶")} ${afterStr || "—"}${delta}`);
        lines.push(`  │`);
    }
    return lines.join("\n");
}
function formatStateTransitions(session) {
    const width = 66;
    const title = `State Transitions: ${session.intent}`;
    const header = `┌─ ${B(title)} ${"─".repeat(Math.max(2, width - title.length - 5))}┐`;
    const resolvedIcon = session.resolved ? G("✔") : R("✖");
    const info = `│ Session: ${D(session.sessionId)}  │  Resolved: ${resolvedIcon} ${" ".repeat(Math.max(1, 15))}│`;
    const footer = `└${"─".repeat(width - 2)}┘`;
    const lines = [header, info, footer, ""];
    // Show state transitions for the successful path
    if (session.successfulAlternative) {
        lines.push(`  ${B("Successful Path State Machine:")}`);
        lines.push("");
        lines.push(formatStateTransitionPath(session.successfulAlternative));
        lines.push("");
    }
    // Show each failed attempt's state
    for (const a of session.attempts) {
        if (a.violatedSVL === "SVL-4" && a.ssgFixPath) {
            lines.push(`  ${D("─".repeat(50))}`);
            const actions = (a.actionSequence || []).filter((x) => x.function).map((x) => x.function).join(" → ");
            lines.push(`  ${R("Blocked at:")} ${actions}`);
            lines.push(`  ${D("Repair:")}     ${Y(a.ssgFixPath.join(" → "))}`);
            lines.push("");
        }
    }
    return lines.join("\n");
}
// ── Session Replay ──
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function clearScreen() {
    process.stdout.write("\x1b[2J\x1b[H");
}
function svlLabel(svl) {
    switch (svl) {
        case "SVL-1": return "symbol anomaly";
        case "SVL-2": return "type anomaly";
        case "SVL-3": return "dataflow anomaly";
        case "SVL-4": return "protocol anomaly";
        default: return "semantic anomaly";
    }
}
function describeSVLLayer(svl) {
    switch (svl) {
        case "SVL-1": return "Immune Layer 1 — Symbol Existence";
        case "SVL-2": return "Immune Layer 2 — Type Integrity";
        case "SVL-3": return "Immune Layer 3 — Dataflow Validity";
        case "SVL-4": return "Immune Layer 4 — Protocol Legality";
        default: return `Immune Layer — ${svl}`;
    }
}
function formatReplayHeader(session) {
    const lines = [];
    const w = 62;
    lines.push("");
    lines.push(`  ${B("Semantic Observatory — Cognitive Session Replay")}`);
    lines.push(`  ${D("─".repeat(w))}`);
    lines.push("");
    lines.push(`  ${D("Intent:")}     ${C_(session.intent)}`);
    lines.push(`  ${D("Session:")}    ${session.sessionId}`);
    lines.push(`  ${D("Adaptations:")} ${session.totalRetries}`);
    lines.push(`  ${D("Outcome:")}     ${session.resolved ? G("cognitive adaptation successful") : R("cognitive adaptation incomplete")}`);
    lines.push("");
    lines.push(`  ${D("─".repeat(w))}`);
    lines.push("");
    return lines.join("\n");
}
function formatActionList(actions) {
    if (!actions || actions.length === 0)
        return D("(empty sequence)");
    return actions
        .filter(a => a.kind === "call" && a.function)
        .map(a => `  ${C_(a.function + "()")}`)
        .join("\n");
}
function formatAdaptationDiff(prev, current) {
    const prevFns = (prev.actionSequence || []).filter(a => a.function).map(a => a.function);
    const currFns = (current.actionSequence || []).filter(a => a.function).map(a => a.function);
    const added = currFns.filter(f => !prevFns.includes(f));
    const removed = prevFns.filter(f => !currFns.includes(f));
    const kept = currFns.filter(f => prevFns.includes(f));
    const lines = [];
    lines.push(`  ${B("Adaptation shift:")}`);
    if (kept.length > 0) {
        lines.push(`    ${D("persisted")}  ${kept.map(f => C_(f + "()")).join(" → ")}`);
    }
    if (removed.length > 0) {
        lines.push(`    ${R("dropped")}    ${removed.map(f => R(f + "()")).join(" → ")}`);
    }
    if (added.length > 0) {
        lines.push(`    ${G("acquired")}   ${added.map(f => G(f + "()")).join(" → ")}`);
    }
    return lines.join("\n");
}
function formatAnomalyReport(a) {
    const lines = [];
    const svl = a.violatedSVL;
    lines.push(`  ${B("Semantic anomaly:")} ${R(svlLabel(svl))}`);
    lines.push(`  ${D("Layer:")}  ${describeSVLLayer(svl)}`);
    // Diagnostic
    if (svl === "SVL-4") {
        const blockedMatch = a.errorDetail.match(/(\w+)\s*(要求|requires|blocked|不允许|不合法)/);
        const blocked = blockedMatch ? blockedMatch[1] : a.actionSequence[0]?.function || "unknown";
        lines.push(`  ${D("Blocked:")}  ${R(blocked + "()")}`);
        if (a.ssgMissingFunctions?.length) {
            const missing = a.ssgMissingFunctions.join(", ");
            lines.push(`  ${D("Missing:")}  ${C_(missing)}`);
        }
        if (a.ssgFixPath?.length) {
            const fixPath = a.ssgFixPath.join(" → ");
            lines.push(`  ${D("Required:")} ${C_(fixPath)}`);
        }
    }
    else {
        // Extract key info from errorDetail
        const detail = a.errorDetail.length > 80 ? a.errorDetail.slice(0, 77) + "..." : a.errorDetail;
        lines.push(`  ${D("Detail:")}  ${detail}`);
    }
    return lines.join("\n");
}
function formatImmuneResponse(a) {
    const lines = [];
    if (a.ssgFixPath?.length) {
        const path = a.ssgFixPath.join(" → ");
        lines.push(`  ${B("Immune response:")} ${Y("repair path activated")}`);
        lines.push(`  ${D("Repair:")}  ${Y(path)}`);
    }
    else if (a.plannerRetryTotal && a.plannerRetryTotal > 1) {
        lines.push(`  ${B("Immune response:")} ${Y("adaptation requested")}`);
    }
    else {
        lines.push(`  ${B("Immune response:")} ${Y("constraint violation recorded")}`);
    }
    return lines.join("\n");
}
function formatReplayProgress(current, total) {
    const filled = "█".repeat(current);
    const empty = "░".repeat(total - current);
    return `  ${D("[" + filled + empty + "]")} ${current}/${total}`;
}
async function replaySession(session) {
    clearScreen();
    console.log(formatReplayHeader(session));
    await sleep(1200);
    const attempts = session.attempts;
    const totalAdaptations = attempts.length;
    for (let i = 0; i < attempts.length; i++) {
        const a = attempts[i];
        const prev = i > 0 ? attempts[i - 1] : null;
        // ── Step header ──
        console.log(`  ${B("━━━ Adaptation " + (i + 1) + " of " + totalAdaptations + " ━━━")}`);
        console.log("");
        await sleep(300);
        // ── What the cognitive planner attempted ──
        console.log(`  ${D("Cognitive planner action:")}`);
        console.log(formatActionList(a.actionSequence));
        console.log("");
        await sleep(400);
        // ── Semantic anomaly ──
        console.log(formatAnomalyReport(a));
        console.log("");
        await sleep(500);
        // ── Immune response ──
        console.log(formatImmuneResponse(a));
        console.log("");
        await sleep(400);
        // ── Adaptation diff (if not first attempt) ──
        if (prev) {
            console.log(formatAdaptationDiff(prev, a));
            console.log("");
            await sleep(400);
        }
        // ── Progress bar ──
        console.log(formatReplayProgress(i + 1, totalAdaptations));
        console.log("");
        // ── Inter-adaptation pause ──
        if (i < attempts.length - 1) {
            console.log(`  ${D("⏳  Cognitive planner re-evaluating...")}`);
            console.log("");
            await sleep(1200);
        }
    }
    // ── Resolution ──
    await sleep(600);
    console.log(`  ${B("━━━ Cognitive Adaptation Complete ━━━")}`);
    console.log("");
    if (session.resolved && session.successfulAlternative) {
        const actions = session.successfulAlternative || [];
        console.log(`  ${G("✔")}  ${B("Successful cognitive path established:")}`);
        console.log(formatActionList(actions));
        console.log("");
        const names = actions.filter(a => a.kind === "call" && a.function).map(a => a.function).join(" → ");
        console.log(`  ${G("✔")}  ${names}`);
        console.log("");
        // State machine trace
        const protocols = loadProtocols();
        if (protocols.length > 0) {
            console.log(`  ${B("State machine trace:")}`);
            console.log(formatStateTransitionPath(actions));
            console.log("");
        }
        console.log(`  ${D(`Total adaptations: ${session.totalRetries}`)}`);
        console.log(`  ${D(`Session: ${session.sessionId}`)}`);
    }
    else {
        console.log(`  ${R("✖")}  ${B("Cognitive adaptation incomplete")}`);
        console.log("");
        console.log(`  ${D("The planner was unable to find a valid path within the constraint space.")}`);
        console.log(`  ${D(`Total adaptations attempted: ${session.totalRetries}`)}`);
    }
    console.log("");
    console.log(`  ${D("─".repeat(62))}`);
    console.log(`  ${D("Semantic Observatory — replay complete")}`);
    console.log("");
}
// ── CLI entry ──
async function main() {
    const arg = process.argv[2];
    if (arg === "--genome") {
        console.log(formatGenomeSummary());
        return;
    }
    if (arg === "--learned") {
        console.log(formatLearnedPatterns());
        return;
    }
    if (arg === "--heatmap") {
        console.log(formatHeatmap());
        return;
    }
    const sessions = (0, failure_corpus_1.getAllSessions)();
    if (arg === "--states") {
        const sessionId = process.argv[3];
        if (!sessionId) {
            console.log(formatSessionSummary(sessions));
            console.log(`\n${D("Usage:")} ts-node src/semantic-trace.ts --states <sessionId>`);
            return;
        }
        const session = sessions.find(s => s.sessionId === sessionId || s.sessionId.startsWith(sessionId));
        if (!session) {
            console.error(`${R("Session not found:")} ${sessionId}`);
            process.exit(1);
        }
        console.log(formatStateTransitions(session));
        return;
    }
    if (arg === "replay") {
        const sessionId = process.argv[3];
        if (!sessionId) {
            console.error(`${R("Usage:")} ts-node src/semantic-trace.ts replay <sessionId>`);
            console.error(`\n${D("Available sessions:")}`);
            for (const s of sessions) {
                console.error(`  ${D(s.sessionId)} — ${s.intent}`);
            }
            process.exit(1);
        }
        const session = sessions.find(s => s.sessionId === sessionId || s.sessionId.startsWith(sessionId));
        if (!session) {
            console.error(`${R("Session not found:")} ${sessionId}`);
            console.error(`\n${D("Available sessions:")}`);
            for (const s of sessions) {
                console.error(`  ${D(s.sessionId)} — ${s.intent}`);
            }
            process.exit(1);
        }
        await replaySession(session);
        return;
    }
    if (arg && !arg.startsWith("--")) {
        // View a specific session
        const session = sessions.find(s => s.sessionId === arg || s.sessionId.startsWith(arg));
        if (!session) {
            console.error(`${R("Session not found:")} ${arg}`);
            console.error(`\n${D("Available sessions:")}`);
            for (const s of sessions) {
                console.error(`  ${D(s.sessionId)} — ${s.intent}`);
            }
            process.exit(1);
        }
        console.log(formatSessionTimeline(session));
        return;
    }
    console.log(formatSessionSummary(sessions));
}
if (require.main === module) {
    main().catch(console.error);
}
