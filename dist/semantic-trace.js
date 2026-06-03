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
 *   ts-node src/semantic-trace.ts --antibodies         → antibody efficacy metrics
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
const terminal_format_1 = require("./terminal-format");
const ssg_validator_1 = require("./ssg-validator");
const semantic_snapshot_1 = require("./semantic-snapshot");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ── Narrative translation ──
function narrateRejection(v) {
    const svlStr = `SVL-${v.svl}`;
    const missing = v.missingStates?.length ? v.missingStates.join(", ") : null;
    const blocked = v.description.match(/(\w+)\s*(要求|requires|blocked|不允许|不合法)/)?.[1] || "unknown";
    switch (svlStr) {
        case "SVL-1":
            return `Planner referenced a function that does not exist in the project.\n     ${(0, terminal_format_1.D)("→ " + v.description)}`;
        case "SVL-2":
            return `Planner called a function with incorrect argument types.\n     ${(0, terminal_format_1.D)("→ " + v.description)}`;
        case "SVL-3":
            return `Planner used a variable before it was defined or referenced it circularly.\n     ${(0, terminal_format_1.D)("→ " + v.description)}`;
        case "SVL-4":
            if (missing) {
                return `Planner attempted to call ${(0, terminal_format_1.R)(blocked)} before ${(0, terminal_format_1.C_)(missing)} was established.`;
            }
            return `Planner violated the protocol contract for ${(0, terminal_format_1.R)(blocked)}.\n     ${(0, terminal_format_1.D)("→ " + v.description)}`;
        default:
            return v.description;
    }
}
function narrateSuccess(actions) {
    const names = actions
        .filter(a => a.kind === "call" && a.function)
        .map(a => a.function)
        .join(" → ");
    return `Successfully completed: ${(0, terminal_format_1.G)(names)}.`;
}
// ── Timeline rendering ──
function formatActionSequence(actions) {
    return actions
        .filter(a => a.kind === "call" && a.function)
        .map(a => (0, terminal_format_1.C_)(a.function + "()"))
        .join(`  ${(0, terminal_format_1.D)("→")}  `);
}
function formatSessionTimeline(session) {
    const width = 66;
    const title = `Intent: ${session.intent}`;
    const header = `┌─ ${(0, terminal_format_1.B)(title)} ${"─".repeat(Math.max(2, width - title.length - 5))}┐`;
    const failedCount = session.attempts.filter(a => a.outcome !== "success").length;
    const resolvedIcon = session.resolved ? (0, terminal_format_1.G)("✔") : (0, terminal_format_1.R)("✖");
    const snapTag = session.snapshotId ? `  │  ${(0, terminal_format_1.D)("Snapshot:")} ${(0, terminal_format_1.D)(session.snapshotId.slice(-16))}` : "";
    const info = `│ Session: ${(0, terminal_format_1.D)(session.sessionId)}  │  Retries: ${failedCount}  │  Resolved: ${resolvedIcon} ${" ".repeat(Math.max(1, 15))}│`;
    const footer = `└${"─".repeat(width - 2)}┘`;
    const lines = [header, info];
    if (snapTag)
        lines.push(snapTag);
    lines.push(footer, "");
    // Render all failure attempts
    const failedAttempts = session.attempts.filter(a => a.outcome !== "success");
    for (let i = 0; i < failedAttempts.length; i++) {
        const a = failedAttempts[i];
        const num = a.attemptNumber;
        const actions = a.generatedActions || [];
        const actionDisplay = formatActionSequence(actions);
        lines.push(`  Attempt ${num} ${"─".repeat(62)}`);
        lines.push(`  │  ${actionDisplay || (0, terminal_format_1.D)("(no actions)")}`);
        lines.push(`  │`);
        // Render each violation in the attempt
        for (const v of a.violations) {
            const narration = narrateRejection(v);
            const lines_narration = narration.split("\n");
            lines.push(`  ${(0, terminal_format_1.R)("✖")}  ${lines_narration[0]}`);
            for (let j = 1; j < lines_narration.length; j++) {
                lines.push(`     ${lines_narration[j]}`);
            }
            // Show SSG context for protocol failures
            if (v.svl === 4) {
                if (v.missingStates?.length) {
                    const missingList = v.missingStates.join(", ");
                    lines.push(`     ${(0, terminal_format_1.D)("→")} Missing: ${(0, terminal_format_1.C_)(missingList)}`);
                }
                if (v.fixPath?.length) {
                    const fixList = v.fixPath.join(" → ");
                    lines.push(`     ${(0, terminal_format_1.D)("→")} Repair:  ${(0, terminal_format_1.Y)(fixList)}`);
                }
                if (v.namespace && v.namespace !== "_global") {
                    lines.push(`     ${(0, terminal_format_1.D)("→")} Namespace: ${(0, terminal_format_1.D)(v.namespace)}`);
                }
            }
        }
        lines.push(`     ${(0, terminal_format_1.D)(`(attempt ${num}/${session.attempts.length})`)}`);
        lines.push("");
    }
    // Final resolution
    if (session.resolved && session.successfulAttempt) {
        const actions = session.successfulAttempt.generatedActions || [];
        const actionDisplay = formatActionSequence(actions);
        lines.push(`  ${(0, terminal_format_1.G)("✔")} Resolution ${"─".repeat(51)}`);
        lines.push(`  │  ${actionDisplay}`);
        lines.push(`  │`);
        const narration = narrateSuccess(actions);
        lines.push(`  ${(0, terminal_format_1.G)("✔")}  ${narration}`);
        lines.push(`     ${(0, terminal_format_1.D)(`Resolved after ${failedCount} retries.`)}`);
        // Phase 3: Ledger consistency check
        if (session.successfulAttempt.transitions.length > 0) {
            const nsInit = new Map([["_global", "INIT"]]);
            const consistency = (0, ssg_validator_1.checkLedgerConsistency)(session.successfulAttempt.transitions, nsInit);
            if (consistency.consistent) {
                lines.push(`     ${(0, terminal_format_1.G)("Ledger: consistent")}`);
            }
            else {
                lines.push(`     ${(0, terminal_format_1.R)(`Ledger: ${consistency.violations.length} violation(s)`)}`);
                for (const v of consistency.violations) {
                    lines.push(`       ${(0, terminal_format_1.D)(`[${v.invariant}] index=${v.index}`)}`);
                }
            }
        }
        lines.push("");
    }
    else if (!session.resolved) {
        lines.push(`  ${(0, terminal_format_1.R)("✖")} ${(0, terminal_format_1.B)("Unresolved")} ${"─".repeat(50)}`);
        lines.push(`     ${(0, terminal_format_1.D)(`Failed after ${failedCount} retries with no successful path.`)}`);
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
        return `${(0, terminal_format_1.D)("No sessions recorded yet.")}\nRun the planner to generate semantic traces.`;
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
        const resolved = s.resolved ? (0, terminal_format_1.G)("✔ resolved") : (0, terminal_format_1.R)("✖ unresolved");
        lines.push(`│ ${pad((0, terminal_format_1.D)(shortId), colW.session)}│ ${pad(shortIntent, colW.intent)}│ ${pad(String(s.attempts.length), colW.attempts)}│ ${pad(resolved, colW.resolved)}│`);
    }
    lines.push(`└${sep}┘`);
    lines.push("");
    lines.push(`${(0, terminal_format_1.D)("Commands:")} timeline | replay | --states | --genome | --learned | --antibodies | --heatmap`);
    return lines.join("\n");
}
// ── Genome summary ──
function formatGenomeSummary() {
    const g = (0, failure_corpus_1.getFailureGenome)();
    if (g.totalFailures === 0) {
        return `${(0, terminal_format_1.D)("No failures recorded yet.")}`;
    }
    const bar = "─".repeat(56);
    const lines = [
        `┌─ ${(0, terminal_format_1.B)("Failure Genome")} ${bar.slice(0, 40)}┐`,
        `│ Total failures: ${(0, terminal_format_1.R)(String(g.totalFailures))}${" ".repeat(39)}│`,
        `│ Average retries: ${(0, terminal_format_1.Y)(String(g.averageRetriesToSuccess))}${" ".repeat(38)}│`,
        `├${bar}┤`,
        `│ ${(0, terminal_format_1.B)("By SVL Level")}${" ".repeat(44)}│`,
        `│   SVL-1 (Symbol):     ${barChart(g.bySVL["SVL-1"], g.totalFailures)} ${g.bySVL["SVL-1"]} │`,
        `│   SVL-2 (Type):       ${barChart(g.bySVL["SVL-2"], g.totalFailures)} ${g.bySVL["SVL-2"]} │`,
        `│   SVL-3 (Dataflow):   ${barChart(g.bySVL["SVL-3"], g.totalFailures)} ${g.bySVL["SVL-3"]} │`,
        `│   SVL-4 (Protocol):   ${barChart(g.bySVL["SVL-4"], g.totalFailures)} ${g.bySVL["SVL-4"]} │`,
        `├${bar}┤`,
    ];
    if (g.topPatterns.length > 0) {
        lines.push(`│ ${(0, terminal_format_1.B)("Top Failure Patterns")}${" ".repeat(37)}│`);
        for (const p of g.topPatterns) {
            const label = `${p.pattern}: ${p.count}x`;
            lines.push(`│   ${label}${" ".repeat(Math.max(1, 52 - label.length))}│`);
        }
        lines.push(`├${bar}┤`);
    }
    if (g.commonFixPaths.length > 0) {
        lines.push(`│ ${(0, terminal_format_1.B)("Common Repair Paths")}${" ".repeat(36)}│`);
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
        lines.push(`│ ${(0, terminal_format_1.B)("By Constraint Type")}${" ".repeat(37)}│`);
        for (const [k, v] of constraints) {
            lines.push(`│   ${k}: ${v}${" ".repeat(Math.max(1, 51 - k.length - String(v).length))}│`);
        }
    }
    lines.push(`└${bar}┘`);
    return lines.join("\n");
}
function barChart(count, total) {
    if (total === 0)
        return (0, terminal_format_1.D)("▏".repeat(0));
    const maxBars = 20;
    const n = Math.round((count / total) * maxBars);
    if (n === 0 && count > 0)
        return (0, terminal_format_1.Y)("▏");
    if (n === 0)
        return (0, terminal_format_1.D)("▏".repeat(0));
    return (0, terminal_format_1.Y)("█".repeat(n)) + (0, terminal_format_1.D)("░".repeat(maxBars - n));
}
// ── Learned patterns ──
function aclBadge(level) {
    switch (level) {
        case "ACL-4": return (0, terminal_format_1.G)(`◆ ${level} (globally stable)`);
        case "ACL-3": return (0, terminal_format_1.C_)(`◈ ${level} (cross-task validated)`);
        case "ACL-2": return (0, terminal_format_1.Y)(`◇ ${level} (repeated observation)`);
        case "ACL-1": return (0, terminal_format_1.D)(`◌ ${level} (single case)`);
        default: return (0, terminal_format_1.D)(level);
    }
}
function formatLearnedPatterns() {
    const learned = (0, failure_corpus_1.getLearnedPatterns)();
    const patterns = learned.failureToFix;
    if (patterns.length === 0) {
        return `${(0, terminal_format_1.D)("No learned patterns yet.")}\nPatterns emerge when sessions capture failures with repair paths.`;
    }
    const lines = [
        `${(0, terminal_format_1.B)("Antibody Registry")} (${patterns.length} patterns)`,
        "─".repeat(72),
    ];
    for (const p of patterns) {
        const path = p.fixPath.join(" → ");
        const intents = p.distinctIntents.slice(0, 3).join(", ");
        const moreIntents = p.distinctIntents.length > 3 ? ` +${p.distinctIntents.length - 3} more` : "";
        const ratePct = Math.round(p.resolvedRate * 100);
        lines.push(`  ${(0, terminal_format_1.B)("Signature:")}  ${(0, terminal_format_1.R)(p.violation)}`);
        lines.push(`  ${(0, terminal_format_1.D)("Repair:")}     ${(0, terminal_format_1.Y)(path)}`);
        lines.push(`  ${(0, terminal_format_1.D)("Confidence:")} ${aclBadge(p.antibodyLevel)}`);
        lines.push(`  ${(0, terminal_format_1.D)("Occurrences:")} ${p.occurrenceCount}x  │  ${(0, terminal_format_1.D)("Resolved:")} ${ratePct}%  │  ${(0, terminal_format_1.D)("Intents:")} ${intents}${moreIntents}`);
        lines.push("");
    }
    return lines.join("\n");
}
// ── Antibody efficacy stats ──
function formatAntibodyStats() {
    const stats = (0, failure_corpus_1.getAntibodyStats)();
    if (stats.totalHits === 0) {
        return `${(0, terminal_format_1.D)("No antibody hits recorded yet.")}\nAntibodies are recorded when the immune system accelerates planning via learned fix paths.`;
    }
    const lines = [];
    lines.push(`${(0, terminal_format_1.B)("Antibody Efficacy Report")}`);
    lines.push("═".repeat(68));
    lines.push("");
    // Summary
    lines.push(`  ${(0, terminal_format_1.B)("Immune Acceleration Summary")}`);
    lines.push(`  ${(0, terminal_format_1.D)("─".repeat(44))}`);
    lines.push(`  Total antibody hits:        ${(0, terminal_format_1.C_)(String(stats.totalHits))}`);
    lines.push(`  ACL-4 fast-path (0 LLM):     ${(0, terminal_format_1.G)(String(stats.fastPathHits))}`);
    lines.push(`  ACL-3 injected hints:        ${(0, terminal_format_1.Y)(String(stats.injectedHintHits))}`);
    lines.push(`  LLM calls saved:             ${(0, terminal_format_1.G)(String(stats.totalLLMCallsSaved))}`);
    lines.push(`  Est. tokens saved:           ${(0, terminal_format_1.G)(stats.totalTokensSaved.toLocaleString())}`);
    lines.push("");
    // By Level
    if (Object.keys(stats.byLevel).length > 0) {
        lines.push(`  ${(0, terminal_format_1.B)("By Antibody Level")}`);
        lines.push(`  ${(0, terminal_format_1.D)("─".repeat(34))}`);
        const levels = ["ACL-4", "ACL-3", "ACL-2", "ACL-1"];
        for (const lvl of levels) {
            const d = stats.byLevel[lvl];
            if (!d)
                continue;
            const icon = lvl === "ACL-4" ? (0, terminal_format_1.G)("◆") : lvl === "ACL-3" ? (0, terminal_format_1.C_)("◈") : lvl === "ACL-2" ? (0, terminal_format_1.Y)("◇") : (0, terminal_format_1.D)("◌");
            lines.push(`  ${icon} ${lvl}: ${d.hits} hits, ${d.llmSaved} LLM saved, ${d.tokensSaved.toLocaleString()} tokens`);
        }
        lines.push("");
    }
    // Top signatures
    if (stats.topSignatures.length > 0) {
        lines.push(`  ${(0, terminal_format_1.B)("Top Antibody Signatures")}`);
        lines.push(`  ${(0, terminal_format_1.D)("─".repeat(40))}`);
        for (const s of stats.topSignatures.slice(0, 5)) {
            const sig = s.signature.length > 42 ? s.signature.slice(0, 39) + "..." : s.signature;
            lines.push(`  ${s.hits}x  ${sig.padEnd(44)} ~${s.avgSimilarity}`);
        }
        lines.push("");
    }
    // Efficiency note
    if (stats.fastPathHits > 0) {
        const pct = Math.round((stats.fastPathHits / stats.totalHits) * 100);
        lines.push(`  ${(0, terminal_format_1.G)(`Immune efficiency: ${pct}% of hits bypassed LLM entirely`)}`);
    }
    return lines.join("\n");
}
// ── Semantic heatmap ──
function formatHeatmap() {
    const h = (0, failure_corpus_1.getSemanticHeatmap)();
    if (h.fragileProtocols.length === 0 && h.svlHotspots.length === 0) {
        return `${(0, terminal_format_1.D)("No heatmap data yet.")}`;
    }
    const lines = [];
    lines.push(`${(0, terminal_format_1.B)("Semantic Heatmap")}`);
    lines.push("═".repeat(72));
    lines.push("");
    // SVL hotspots as horizontal bars
    if (h.svlHotspots.length > 0) {
        lines.push(`  ${(0, terminal_format_1.B)("Immune Layer Activity")}`);
        lines.push(`  ${(0, terminal_format_1.D)("─".repeat(44))}`);
        const maxCount = Math.max(...h.svlHotspots.map(s => s.count), 1);
        const maxBar = 30;
        for (const s of h.svlHotspots) {
            const n = Math.round((s.count / maxCount) * maxBar) || (s.count > 0 ? 1 : 0);
            const bar = (0, terminal_format_1.R)("█".repeat(n)) + (0, terminal_format_1.D)("░".repeat(maxBar - n));
            const pct = `${s.percentage}%`.padStart(4);
            lines.push(`  ${s.svl.padEnd(8)} ${bar} ${String(s.count).padStart(2)} (${pct})`);
        }
        lines.push("");
    }
    // Fragile protocols
    if (h.fragileProtocols.length > 0) {
        lines.push(`  ${(0, terminal_format_1.B)("Fragile Protocols (most blocked functions)")}`);
        lines.push(`  ${(0, terminal_format_1.D)("─".repeat(52))}`);
        for (const fp of h.fragileProtocols.slice(0, 6)) {
            const heat = fp.violationCount >= 5 ? (0, terminal_format_1.R)("●●●") : fp.violationCount >= 3 ? (0, terminal_format_1.Y)("●●") : (0, terminal_format_1.Y)("●");
            lines.push(`  ${heat} ${(0, terminal_format_1.C_)(fp.function + "()")} ${(0, terminal_format_1.D)(`— ${fp.violationCount}x, ${fp.svl}`)}`);
        }
        lines.push("");
    }
    // Constraint clusters
    if (h.constraintClusters.length > 0) {
        lines.push(`  ${(0, terminal_format_1.B)("Constraint Co-occurrence")}`);
        lines.push(`  ${(0, terminal_format_1.D)("─".repeat(40))}`);
        for (const cc of h.constraintClusters.slice(0, 4)) {
            const cluster = cc.constraints.map(c => (0, terminal_format_1.Y)(c)).join(" + ");
            lines.push(`  ${cluster}`);
            lines.push(`  ${(0, terminal_format_1.D)(`  ↳ ${cc.count} anomalies in "${cc.intent.slice(0, 40)}"`)}`);
        }
        lines.push("");
    }
    // High friction intents
    if (h.highFrictionIntents.length > 0) {
        lines.push(`  ${(0, terminal_format_1.B)("High Friction Intents (most adaptations required)")}`);
        lines.push(`  ${(0, terminal_format_1.D)("─".repeat(52))}`);
        for (const fi of h.highFrictionIntents.slice(0, 5)) {
            const friction = fi.adaptationCount >= 4 ? (0, terminal_format_1.R)("■■■") : fi.adaptationCount >= 2 ? (0, terminal_format_1.Y)("■■") : (0, terminal_format_1.Y)("■");
            const types = fi.anomalyTypes.join(", ");
            lines.push(`  ${friction} ${fi.intent.slice(0, 40).padEnd(42)} ${(0, terminal_format_1.D)(`${fi.adaptationCount} adapts, ${types}`)}`);
        }
        lines.push("");
    }
    return lines.join("\n");
}
// ── State transition visualization ──
function loadProtocols() {
    const protocolsJson = path.join(__dirname, "..", "protocols.json");
    const protocols = [];
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
                    namespace: r.namespace,
                },
            });
        }
    }
    return protocols;
}
function formatStateTransitionPathFromLedger(transitions) {
    if (transitions.length === 0) {
        return `${(0, terminal_format_1.D)("No protocol-governed transitions in this sequence.")}`;
    }
    const lines = [];
    // Initial state from first transition
    const initState = transitions[0].statesBefore;
    const mergeStates = (rec) => {
        const all = new Set();
        for (const states of Object.values(rec)) {
            for (const s of states)
                all.add(s);
        }
        return all;
    };
    lines.push(`  ${(0, terminal_format_1.D)([...mergeStates(initState)].join(", ") || "—")}`);
    for (const t of transitions) {
        if (!t.valid)
            continue;
        const fnLabel = (0, terminal_format_1.C_)(t.function + "()");
        const beforeAll = mergeStates(t.statesBefore);
        const afterAll = mergeStates(t.statesAfter);
        const beforeStr = [...beforeAll].join(", ");
        const afterStr = [...afterAll].join(", ");
        const gained = t.acquired || [];
        const lost = t.invalidated || [];
        let delta = "";
        if (gained.length > 0)
            delta += ` ${(0, terminal_format_1.G)("+" + gained.join(",+"))}`;
        if (lost.length > 0)
            delta += ` ${(0, terminal_format_1.R)("-" + lost.join(",-"))}`;
        lines.push(`  │`);
        lines.push(`  ├─ ${fnLabel}`);
        lines.push(`  │  ${(0, terminal_format_1.D)(beforeStr || "—")} ${(0, terminal_format_1.D)("──▶")} ${afterStr || "—"}${delta}`);
        lines.push(`  │`);
    }
    return lines.join("\n");
}
function formatStateTransitions(session) {
    const width = 66;
    const title = `State Transitions: ${session.intent}`;
    const header = `┌─ ${(0, terminal_format_1.B)(title)} ${"─".repeat(Math.max(2, width - title.length - 5))}┐`;
    const resolvedIcon = session.resolved ? (0, terminal_format_1.G)("✔") : (0, terminal_format_1.R)("✖");
    const info = `│ Session: ${(0, terminal_format_1.D)(session.sessionId)}  │  Resolved: ${resolvedIcon} ${" ".repeat(Math.max(1, 15))}│`;
    const footer = `└${"─".repeat(width - 2)}┘`;
    const lines = [header, info, footer, ""];
    if (session.successfulAttempt) {
        lines.push(`  ${(0, terminal_format_1.B)("Successful Path State Machine:")}`);
        lines.push("");
        lines.push(formatStateTransitionPathFromLedger(session.successfulAttempt.transitions));
        lines.push("");
    }
    for (const a of session.attempts) {
        for (const v of a.violations) {
            if (v.svl === 4 && v.fixPath?.length) {
                lines.push(`  ${(0, terminal_format_1.D)("─".repeat(50))}`);
                const actions = a.generatedActions.filter((x) => x.kind === "call" && x.function).map((x) => x.function).join(" → ");
                lines.push(`  ${(0, terminal_format_1.R)("Blocked at:")} ${actions}`);
                lines.push(`  ${(0, terminal_format_1.D)("Repair:")}     ${(0, terminal_format_1.Y)(v.fixPath.join(" → "))}`);
                lines.push("");
            }
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
    const totalRetries = session.attempts.filter(a => a.outcome !== "success").length;
    lines.push("");
    lines.push(`  ${(0, terminal_format_1.B)("Semantic Observatory — Cognitive Session Replay")}`);
    lines.push(`  ${(0, terminal_format_1.D)("─".repeat(w))}`);
    lines.push("");
    lines.push(`  ${(0, terminal_format_1.D)("Intent:")}     ${(0, terminal_format_1.C_)(session.intent)}`);
    lines.push(`  ${(0, terminal_format_1.D)("Session:")}    ${session.sessionId}`);
    lines.push(`  ${(0, terminal_format_1.D)("Adaptations:")} ${totalRetries}`);
    lines.push(`  ${(0, terminal_format_1.D)("Outcome:")}     ${session.resolved ? (0, terminal_format_1.G)("cognitive adaptation successful") : (0, terminal_format_1.R)("cognitive adaptation incomplete")}`);
    lines.push("");
    lines.push(`  ${(0, terminal_format_1.D)("─".repeat(w))}`);
    lines.push("");
    return lines.join("\n");
}
function formatActionList(actions) {
    if (!actions || actions.length === 0)
        return (0, terminal_format_1.D)("(empty sequence)");
    return actions
        .filter(a => a.kind === "call" && a.function)
        .map(a => `  ${(0, terminal_format_1.C_)(a.function + "()")}`)
        .join("\n");
}
function formatAdaptationDiff(prev, current) {
    const prevFns = (prev.generatedActions || []).filter(a => a.kind === "call").map(a => a.function);
    const currFns = (current.generatedActions || []).filter(a => a.kind === "call").map(a => a.function);
    const added = currFns.filter(f => !prevFns.includes(f));
    const removed = prevFns.filter(f => !currFns.includes(f));
    const kept = currFns.filter(f => prevFns.includes(f));
    const lines = [];
    lines.push(`  ${(0, terminal_format_1.B)("Adaptation shift:")}`);
    if (kept.length > 0) {
        lines.push(`    ${(0, terminal_format_1.D)("persisted")}  ${kept.map(f => (0, terminal_format_1.C_)(f + "()")).join(" → ")}`);
    }
    if (removed.length > 0) {
        lines.push(`    ${(0, terminal_format_1.R)("dropped")}    ${removed.map(f => (0, terminal_format_1.R)(f + "()")).join(" → ")}`);
    }
    if (added.length > 0) {
        lines.push(`    ${(0, terminal_format_1.G)("acquired")}   ${added.map(f => (0, terminal_format_1.G)(f + "()")).join(" → ")}`);
    }
    return lines.join("\n");
}
function formatAnomalyReport(a) {
    const lines = [];
    const primary = a.violations[0];
    if (!primary) {
        lines.push(`  ${(0, terminal_format_1.B)("Semantic anomaly:")} ${(0, terminal_format_1.R)("unknown")}`);
        return lines.join("\n");
    }
    const svl = `SVL-${primary.svl}`;
    lines.push(`  ${(0, terminal_format_1.B)("Semantic anomaly:")} ${(0, terminal_format_1.R)(svlLabel(svl))}`);
    lines.push(`  ${(0, terminal_format_1.D)("Layer:")}  ${describeSVLLayer(svl)}`);
    if (primary.svl === 4) {
        const blockedMatch = primary.description.match(/(\w+)\s*(要求|requires|blocked|不允许|不合法)/);
        const blocked = blockedMatch ? blockedMatch[1] : a.generatedActions.find(x => x.kind === "call")?.function || "unknown";
        lines.push(`  ${(0, terminal_format_1.D)("Blocked:")}  ${(0, terminal_format_1.R)(blocked + "()")}`);
        if (primary.missingStates?.length) {
            const missing = primary.missingStates.join(", ");
            lines.push(`  ${(0, terminal_format_1.D)("Missing:")}  ${(0, terminal_format_1.C_)(missing)}`);
        }
        if (primary.fixPath?.length) {
            const fixPath = primary.fixPath.join(" → ");
            lines.push(`  ${(0, terminal_format_1.D)("Required:")} ${(0, terminal_format_1.C_)(fixPath)}`);
        }
    }
    else {
        const detail = primary.description.length > 80 ? primary.description.slice(0, 77) + "..." : primary.description;
        lines.push(`  ${(0, terminal_format_1.D)("Detail:")}  ${detail}`);
    }
    return lines.join("\n");
}
function formatImmuneResponse(a) {
    const lines = [];
    const primary = a.violations[0];
    if (primary?.fixPath?.length) {
        const path = primary.fixPath.join(" → ");
        lines.push(`  ${(0, terminal_format_1.B)("Immune response:")} ${(0, terminal_format_1.Y)("repair path activated")}`);
        lines.push(`  ${(0, terminal_format_1.D)("Repair:")}  ${(0, terminal_format_1.Y)(path)}`);
    }
    else if (a.llmCallCount > 1) {
        lines.push(`  ${(0, terminal_format_1.B)("Immune response:")} ${(0, terminal_format_1.Y)("adaptation requested")}`);
    }
    else {
        lines.push(`  ${(0, terminal_format_1.B)("Immune response:")} ${(0, terminal_format_1.Y)("constraint violation recorded")}`);
    }
    return lines.join("\n");
}
function formatReplayProgress(current, total) {
    const filled = "█".repeat(current);
    const empty = "░".repeat(total - current);
    return `  ${(0, terminal_format_1.D)("[" + filled + empty + "]")} ${current}/${total}`;
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
        console.log(`  ${(0, terminal_format_1.B)("━━━ Adaptation " + (i + 1) + " of " + totalAdaptations + " ━━━")}`);
        console.log("");
        await sleep(300);
        // ── What the cognitive planner attempted ──
        console.log(`  ${(0, terminal_format_1.D)("Cognitive planner action:")}`);
        console.log(formatActionList(a.generatedActions));
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
            console.log(`  ${(0, terminal_format_1.D)("⏳  Cognitive planner re-evaluating...")}`);
            console.log("");
            await sleep(1200);
        }
    }
    // ── Resolution ──
    await sleep(600);
    console.log(`  ${(0, terminal_format_1.B)("━━━ Cognitive Adaptation Complete ━━━")}`);
    console.log("");
    if (session.resolved && session.successfulAttempt) {
        const actions = session.successfulAttempt.generatedActions || [];
        console.log(`  ${(0, terminal_format_1.G)("✔")}  ${(0, terminal_format_1.B)("Successful cognitive path established:")}`);
        console.log(formatActionList(actions));
        console.log("");
        const names = actions.filter(a => a.kind === "call").map(a => a.function).join(" → ");
        console.log(`  ${(0, terminal_format_1.G)("✔")}  ${names}`);
        console.log("");
        // State machine trace (from Semantic Ledger)
        const transitions = session.successfulAttempt.transitions;
        if (transitions.length > 0) {
            console.log(`  ${(0, terminal_format_1.B)("State machine trace (from Ledger):")}`);
            console.log(formatStateTransitionPathFromLedger(transitions));
            console.log("");
        }
        const totalRetries = session.attempts.filter(a => a.outcome !== "success").length;
        console.log(`  ${(0, terminal_format_1.D)(`Total adaptations: ${totalRetries}`)}`);
        console.log(`  ${(0, terminal_format_1.D)(`Session: ${session.sessionId}`)}`);
    }
    else {
        console.log(`  ${(0, terminal_format_1.R)("✖")}  ${(0, terminal_format_1.B)("Cognitive adaptation incomplete")}`);
        console.log("");
        console.log(`  ${(0, terminal_format_1.D)("The planner was unable to find a valid path within the constraint space.")}`);
        const totalRetries = session.attempts.length;
        console.log(`  ${(0, terminal_format_1.D)(`Total adaptations attempted: ${totalRetries}`)}`);
    }
    console.log("");
    console.log(`  ${(0, terminal_format_1.D)("─".repeat(62))}`);
    console.log(`  ${(0, terminal_format_1.D)("Semantic Observatory — replay complete")}`);
    console.log("");
    // Ledger replay validation
    console.log(formatLedgerReplayValidation(session));
}
// ── Ledger Replay Validation (P1-B) ──
function formatLedgerReplayValidation(session) {
    const lines = [];
    lines.push("");
    lines.push(`${(0, terminal_format_1.C_)("Ledger Replay Validation")}`);
    lines.push(`${(0, terminal_format_1.D)("═".repeat(62))}`);
    if (!session.attempts || session.attempts.length === 0) {
        lines.push(`  ${(0, terminal_format_1.D)("No attempts to replay.")}`);
        return lines.join("\n");
    }
    // Load current protocols for ruleHash comparison
    let currentRuleHash = null;
    try {
        const protoPath = path.join(process.env.PROGMUNE_PROJECT_DIR || process.cwd(), "protocols.json");
        if (fs.existsSync(protoPath)) {
            const protoDef = JSON.parse(fs.readFileSync(protoPath, "utf-8"));
            const protocols = (0, ssg_validator_1.parseProtocolsFromJSON)(protoDef);
            const rules = new Map();
            for (const p of protocols)
                rules.set(p.function, p.protocol);
            currentRuleHash = (0, ssg_validator_1.hashRules)(rules);
        }
    }
    catch { /* trace step — best-effort */ }
    const nsInit = new Map();
    nsInit.set("_global", "UNAUTHENTICATED");
    try {
        const protoPath = path.join(process.env.PROGMUNE_PROJECT_DIR || process.cwd(), "protocols.json");
        if (fs.existsSync(protoPath)) {
            const protoDef = JSON.parse(fs.readFileSync(protoPath, "utf-8"));
            if (protoDef.namespaceInitialStates) {
                for (const [ns, s] of Object.entries(protoDef.namespaceInitialStates)) {
                    nsInit.set(ns, s);
                }
            }
        }
    }
    catch { /* trace step — best-effort */ }
    let totalLedgers = 0;
    let consistentLedgers = 0;
    let stateMatchLedgers = 0;
    for (const attempt of session.attempts) {
        const transitions = attempt.transitions || [];
        if (transitions.length === 0)
            continue;
        totalLedgers++;
        const attemptLabel = `Attempt #${attempt.attemptNumber} (${attempt.outcome})`;
        // 1. Invariant check
        const consistency = (0, ssg_validator_1.checkLedgerConsistency)(transitions, nsInit);
        if (consistency.consistent) {
            consistentLedgers++;
            lines.push(`  ${(0, terminal_format_1.G)("✔")} ${attemptLabel}: Invariants clean`);
        }
        else {
            lines.push(`  ${(0, terminal_format_1.R)("✖")} ${attemptLabel}: ${consistency.violations.length} invariant violation(s)`);
            for (const v of consistency.violations.slice(0, 2)) {
                lines.push(`     ${(0, terminal_format_1.D)(`[${v.invariant}] index=${v.index}: ${v.detail || ""}`)}`);
            }
        }
        // 2. rebuildState matches recorded statesAfter (normalized)
        const rebuilt = (0, ssg_validator_1.rebuildState)(transitions, nsInit);
        const lastTransition = transitions[transitions.length - 1];
        const recorded = lastTransition.statesAfter;
        // Normalize: collect all namespace keys, fill empty arrays for missing ones
        const allNs = new Set([...Object.keys(rebuilt), ...Object.keys(recorded)]);
        const norm = (snap) => {
            const out = {};
            for (const ns of [...allNs].sort()) {
                out[ns] = [...(snap[ns] || [])].sort();
            }
            return out;
        };
        const rebuiltNorm = JSON.stringify(norm(rebuilt));
        const recordedNorm = JSON.stringify(norm(recorded));
        if (rebuiltNorm === recordedNorm) {
            stateMatchLedgers++;
            lines.push(`     ${(0, terminal_format_1.G)("rebuildState === recorded")}`);
        }
        else {
            lines.push(`     ${(0, terminal_format_1.R)("rebuildState !== recorded")}`);
            lines.push(`     ${(0, terminal_format_1.D)("  rebuilt:  " + rebuiltNorm)}`);
            lines.push(`     ${(0, terminal_format_1.D)("  recorded: " + recordedNorm)}`);
        }
        // 3. ruleHash comparison
        if (attempt.ruleHash && currentRuleHash) {
            if (attempt.ruleHash === currentRuleHash) {
                lines.push(`     ${(0, terminal_format_1.G)("ruleHash match")} ${(0, terminal_format_1.D)(attempt.ruleHash)}`);
            }
            else {
                lines.push(`     ${(0, terminal_format_1.Y)("ruleHash mismatch")} ${(0, terminal_format_1.D)("attempt: " + attempt.ruleHash + " | current: " + currentRuleHash)}`);
            }
        }
        else if (attempt.ruleHash && !currentRuleHash) {
            lines.push(`     ${(0, terminal_format_1.D)("ruleHash: " + attempt.ruleHash + " (no current protocols to compare)")}`);
        }
    }
    // Session-level ruleHash
    if (session.ruleHash) {
        lines.push("");
        lines.push(`  ${(0, terminal_format_1.D)("Session ruleHash:")} ${session.ruleHash}`);
        if (currentRuleHash) {
            if (session.ruleHash === currentRuleHash) {
                lines.push(`  ${(0, terminal_format_1.G)("Session ruleHash matches current protocols.")}`);
            }
            else {
                lines.push(`  ${(0, terminal_format_1.Y)("Session ruleHash differs from current protocols.")} ${(0, terminal_format_1.D)("Replay may yield different results.")}`);
            }
        }
    }
    // Ledger integrity hash
    {
        const allTransitions = session.attempts.flatMap(a => a.transitions || []);
        if (allTransitions.length > 0) {
            const ledgerHash = (0, ssg_validator_1.hashLedger)(allTransitions);
            lines.push(`  ${(0, terminal_format_1.D)("Ledger hash:")} ${ledgerHash} ${(0, terminal_format_1.D)("(tamper-evident integrity)")}`);
        }
    }
    lines.push("");
    if (totalLedgers === 0) {
        lines.push(`  ${(0, terminal_format_1.D)("No ledger data in this session.")}`);
    }
    else {
        const allOk = consistentLedgers === totalLedgers && stateMatchLedgers === totalLedgers;
        if (allOk) {
            lines.push(`  ${(0, terminal_format_1.G)("✦")} ${(0, terminal_format_1.B)(`Ledger Replay: ${totalLedgers}/${totalLedgers} consistent, all states match`)}`);
        }
        else {
            lines.push(`  ${(0, terminal_format_1.Y)("◇")} ${(0, terminal_format_1.B)(`Ledger Replay: ${consistentLedgers}/${totalLedgers} consistent, ${stateMatchLedgers}/${totalLedgers} state-match`)}`);
        }
    }
    return lines.join("\n");
}
// ── Corpus-wide Ledger Statistics (P1) ──
function formatLedgerStats() {
    const sessions = (0, failure_corpus_1.getAllSessions)();
    const lines = [];
    lines.push(`${(0, terminal_format_1.C_)("Ledger Corpus Statistics")}`);
    lines.push(`${(0, terminal_format_1.D)("═".repeat(62))}`);
    lines.push("");
    let totalSessions = 0;
    let totalLedgers = 0;
    let totalTransitions = 0;
    let validTransitions = 0;
    let invalidTransitions = 0;
    let sessionsWithRuleHash = 0;
    const stateProducers = new Map();
    const stateConsumers = new Map();
    const allRuleHashes = new Set();
    for (const session of sessions) {
        const allTransitions = session.attempts.flatMap(a => a.transitions || []);
        if (allTransitions.length === 0)
            continue;
        totalSessions++;
        totalLedgers += session.attempts.filter(a => (a.transitions || []).length > 0).length;
        totalTransitions += allTransitions.length;
        for (const t of allTransitions) {
            if (t.valid)
                validTransitions++;
            else
                invalidTransitions++;
            for (const s of t.acquired) {
                stateProducers.set(s, (stateProducers.get(s) || 0) + 1);
            }
            for (const states of Object.values(t.statesBefore)) {
                for (const s of states) {
                    stateConsumers.set(s, (stateConsumers.get(s) || 0) + 1);
                }
            }
        }
        if (session.ruleHash) {
            sessionsWithRuleHash++;
            allRuleHashes.add(session.ruleHash);
        }
    }
    if (totalSessions === 0) {
        lines.push(`  ${(0, terminal_format_1.D)("No sessions with ledger data.")}`);
        return lines.join("\n");
    }
    lines.push(`  ${(0, terminal_format_1.B)("Sessions:")}        ${totalSessions} (${(0, terminal_format_1.D)(`${sessions.length} total`)})`);
    lines.push(`  ${(0, terminal_format_1.B)("Ledgers:")}         ${totalLedgers}`);
    lines.push(`  ${(0, terminal_format_1.B)("Transitions:")}     ${totalTransitions} (${(0, terminal_format_1.G)(`${validTransitions} valid`)}, ${(0, terminal_format_1.R)(`${invalidTransitions} invalid`)})`);
    const validPct = totalTransitions > 0 ? Math.round((validTransitions / totalTransitions) * 100) : 0;
    lines.push(`  ${(0, terminal_format_1.B)("Validity rate:")}    ${validPct >= 90 ? (0, terminal_format_1.G)(`${validPct}%`) : (0, terminal_format_1.Y)(`${validPct}%`)}`);
    lines.push(`  ${(0, terminal_format_1.B)("Rule hashes:")}      ${allRuleHashes.size} unique (${sessionsWithRuleHash}/${totalSessions} sessions have ruleHash)`);
    // Top producers
    const topProducers = [...stateProducers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (topProducers.length > 0) {
        lines.push("");
        lines.push(`  ${(0, terminal_format_1.B)("Top produced states:")}`);
        for (const [state, count] of topProducers) {
            lines.push(`    ${(0, terminal_format_1.G)("+" + state)}: ${count}x`);
        }
    }
    // Top consumers
    const topConsumers = [...stateConsumers.entries()]
        .filter(([s]) => !s.startsWith("_"))
        .sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (topConsumers.length > 0) {
        lines.push("");
        lines.push(`  ${(0, terminal_format_1.B)("Top consumed states:")}`);
        for (const [state, count] of topConsumers) {
            lines.push(`    ${(0, terminal_format_1.Y)("←" + state)}: ${count}x`);
        }
    }
    // Per-session detail
    lines.push("");
    lines.push(`  ${(0, terminal_format_1.B)("Per-session breakdown:")}`);
    for (const session of sessions) {
        const allTransitions = session.attempts.flatMap(a => a.transitions || []);
        if (allTransitions.length === 0)
            continue;
        const validCount = allTransitions.filter(t => t.valid).length;
        const hashTag = session.ruleHash ? ` [${(0, terminal_format_1.D)(session.ruleHash.slice(0, 8))}]` : "";
        const intentShort = session.intent.length > 40 ? session.intent.slice(0, 37) + "..." : session.intent;
        lines.push(`  ${(0, terminal_format_1.D)(session.sessionId.slice(-8))} ${validCount}/${allTransitions.length} valid ${(0, terminal_format_1.D)("·")} ${intentShort}${hashTag}`);
    }
    return lines.join("\n");
}
// ── Cross-session Query ──
function formatCrossSessionQuery(operation, state) {
    const sessions = (0, failure_corpus_1.getAllSessions)();
    const lines = [];
    const label = operation === "producer" ? `Producers of "${state}"` : `Consumers of "${state}"`;
    lines.push(`${(0, terminal_format_1.C_)(`Cross-session: ${label}`)}`);
    lines.push(`${(0, terminal_format_1.D)("═".repeat(62))}`);
    lines.push("");
    let found = 0;
    for (const session of sessions) {
        const allTransitions = session.attempts.flatMap(a => a.transitions || []);
        if (allTransitions.length === 0)
            continue;
        let results;
        if (operation === "producer") {
            results = (0, ssg_validator_1.findProducer)(state, allTransitions);
        }
        else {
            results = (0, ssg_validator_1.findConsumer)(state, allTransitions);
        }
        if (results.length === 0)
            continue;
        found++;
        const intentShort = session.intent.length > 50 ? session.intent.slice(0, 47) + "..." : session.intent;
        const funcs = [...new Set(results.map(r => r.transition.function))].join(", ");
        const validCount = allTransitions.filter(t => t.valid).length;
        const hashTag = session.ruleHash ? ` ${(0, terminal_format_1.D)(session.ruleHash.slice(0, 8))}` : "";
        lines.push(`  ${(0, terminal_format_1.D)(session.sessionId.slice(-8))} ${(0, terminal_format_1.G)(`${results.length}x`)} via ${(0, terminal_format_1.C_)(funcs)} ${(0, terminal_format_1.D)(`(${validCount}/${allTransitions.length} valid)${hashTag}`)}`);
        lines.push(`     ${(0, terminal_format_1.D)(intentShort)}`);
    }
    if (found === 0) {
        lines.push(`  ${(0, terminal_format_1.D)(`No sessions found with ${operation} for "${state}".`)}`);
    }
    else {
        lines.push("");
        lines.push(`  ${(0, terminal_format_1.B)(`Found in ${found} session(s).`)}`);
    }
    return lines.join("\n");
}
// ── CLI entry ──
// ── Semantic Snapshot formatting ──
function formatSnapshotList() {
    const snapshots = (0, semantic_snapshot_1.listSnapshots)();
    if (snapshots.length === 0) {
        return `${(0, terminal_format_1.D)("No IR snapshots recorded yet. Run the planner to capture the first snapshot.")}`;
    }
    const lines = [];
    const C_ = (s) => `${terminal_format_1.COLORS.cyan}${s}${terminal_format_1.COLORS.reset}`;
    lines.push(`${C_("IR Snapshots")} (${snapshots.length} total):\n`);
    lines.push(`${(0, terminal_format_1.B)("┌──────────────────────┬──────────────────────┬──────────┬────────────────────────────────┐")}`);
    lines.push(`${(0, terminal_format_1.B)("│")} ${(0, terminal_format_1.B)("Snapshot ID")}       ${(0, terminal_format_1.B)("│")} ${(0, terminal_format_1.B)("Timestamp")}           ${(0, terminal_format_1.B)("│")} ${(0, terminal_format_1.B)("Funcs")}   ${(0, terminal_format_1.B)("│")} ${(0, terminal_format_1.B)("Intent")}                        ${(0, terminal_format_1.B)("│")}`);
    lines.push(`${(0, terminal_format_1.B)("├──────────────────────┼──────────────────────┼──────────┼────────────────────────────────┤")}`);
    for (const snap of snapshots.slice(0, 20)) {
        const id = snap.id.slice(-16);
        const ts = snap.timestamp.slice(0, 19).replace("T", " ");
        const count = String(snap.functions.length).padStart(4);
        const intent = (snap.intent || "").slice(0, 30).padEnd(30);
        lines.push(`${(0, terminal_format_1.D)("│")} ${(0, terminal_format_1.D)(id)} ${(0, terminal_format_1.D)("│")} ${ts} ${(0, terminal_format_1.D)("│")} ${count}   ${(0, terminal_format_1.D)("│")} ${intent} ${(0, terminal_format_1.D)("│")}`);
    }
    lines.push(`${(0, terminal_format_1.B)("└──────────────────────┴──────────────────────┴──────────┴────────────────────────────────┘")}`);
    return lines.join("\n");
}
function formatSnapshotDiff(snapIdA, snapIdB) {
    const a = (0, semantic_snapshot_1.loadSnapshot)(snapIdA);
    const b = (0, semantic_snapshot_1.loadSnapshot)(snapIdB);
    if (!a)
        return `${(0, terminal_format_1.R)("Snapshot not found:")} ${snapIdA}`;
    if (!b)
        return `${(0, terminal_format_1.R)("Snapshot not found:")} ${snapIdB}`;
    const diff = (0, semantic_snapshot_1.diffSnapshots)(a, b);
    const lines = [];
    const C_ = (s) => `${terminal_format_1.COLORS.cyan}${s}${terminal_format_1.COLORS.reset}`;
    lines.push(`${C_("IR Snapshot Diff")}`);
    lines.push(`${(0, terminal_format_1.D)(`${a.id}`)}  →  ${(0, terminal_format_1.D)(`${b.id}`)}`);
    lines.push(`  ${a.timestamp.slice(0, 19)}  →  ${b.timestamp.slice(0, 19)}`);
    lines.push("");
    if (diff.added.length > 0) {
        lines.push(`  ${(0, terminal_format_1.G)("+ Added")} (${diff.added.length}):`);
        for (const f of diff.added) {
            lines.push(`    ${(0, terminal_format_1.G)("+")} ${f.name}(${f.params.map(p => `${p.name}:${p.type}`).join(", ")}) → ${f.returnType}`);
        }
        lines.push("");
    }
    if (diff.removed.length > 0) {
        lines.push(`  ${(0, terminal_format_1.R)("- Removed")} (${diff.removed.length}):`);
        for (const f of diff.removed) {
            lines.push(`    ${(0, terminal_format_1.R)("-")} ${f.name}(${f.params.map(p => `${p.name}:${p.type}`).join(", ")}) → ${f.returnType}`);
        }
        lines.push("");
    }
    if (diff.changed.length > 0) {
        lines.push(`  ${(0, terminal_format_1.Y)("~ Changed")} (${diff.changed.length}):`);
        for (const { before, after } of diff.changed) {
            lines.push(`    ${(0, terminal_format_1.Y)("~")} ${before.name}:`);
            lines.push(`      ${(0, terminal_format_1.R)("-")} ${before.returnType} (${before.params.map(p => `${p.name}:${p.type}`).join(", ")})`);
            lines.push(`      ${(0, terminal_format_1.G)("+")} ${after.returnType} (${after.params.map(p => `${p.name}:${p.type}`).join(", ")})`);
        }
        lines.push("");
    }
    if (diff.unchanged > 0) {
        lines.push(`  ${(0, terminal_format_1.D)(`${diff.unchanged} functions unchanged`)}`);
    }
    if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
        lines.push(`  ${(0, terminal_format_1.D)("No differences — snapshots are identical.")}`);
    }
    return lines.join("\n");
}
// ── Deterministic Replay: validate session against snapshot vs. live IR ──
function formatSessionValidation(session) {
    const lines = [];
    const C_ = (s) => `${terminal_format_1.COLORS.cyan}${s}${terminal_format_1.COLORS.reset}`;
    lines.push(`${C_("Deterministic Replay Validation")}`);
    lines.push(`${(0, terminal_format_1.D)(`Session: ${session.sessionId}`)}`);
    lines.push(`${(0, terminal_format_1.D)(`Intent:  ${session.intent}`)}`);
    lines.push("");
    // Collect all called functions from all attempts + successful path
    const allCalledFns = new Set();
    for (const a of session.attempts) {
        for (const act of (a.generatedActions || [])) {
            if (act.kind === "call" && act.function)
                allCalledFns.add(act.function);
        }
    }
    if (session.successfulAttempt) {
        for (const act of session.successfulAttempt.generatedActions) {
            if (act.kind === "call" && act.function)
                allCalledFns.add(act.function);
        }
    }
    // Load snapshotted IR
    let snapshotFns = null;
    if (session.snapshotId) {
        const snap = (0, semantic_snapshot_1.loadSnapshot)(session.snapshotId);
        if (snap) {
            snapshotFns = new Set(snap.functions.map(f => f.name));
            lines.push(`${(0, terminal_format_1.D)("Snapshot IR:")} ${snap.id} (${snap.functions.length} functions)`);
        }
        else {
            lines.push(`${(0, terminal_format_1.Y)("Snapshot not found:")} ${session.snapshotId}`);
        }
    }
    else {
        lines.push(`${(0, terminal_format_1.D)("No snapshot linked to this session.")}`);
    }
    // Load current IR
    let currentFns = null;
    try {
        const irPath = path.join(process.env.PROGMUNE_PROJECT_DIR || process.cwd(), "ir.json");
        if (fs.existsSync(irPath)) {
            const ir = JSON.parse(fs.readFileSync(irPath, "utf-8"));
            currentFns = new Set(ir.map((f) => f.name));
            lines.push(`${(0, terminal_format_1.D)("Current IR:")}  ir.json (${ir.length} functions)`);
        }
    }
    catch { /* trace step — best-effort */ }
    lines.push("");
    if (!snapshotFns && !currentFns) {
        lines.push(`${(0, terminal_format_1.D)("No IR data available for comparison.")}`);
        return lines.join("\n");
    }
    // Per-function validation table
    const fns = [...allCalledFns].sort();
    if (fns.length === 0) {
        lines.push(`${(0, terminal_format_1.D)("No function calls recorded in this session.")}`);
        return lines.join("\n");
    }
    lines.push(`${(0, terminal_format_1.B)("Function validation (then vs. now):")}`);
    lines.push(`${(0, terminal_format_1.B)("┌────────────────────────────┬──────────┬──────────┬──────────────────────────────────────┐")}`);
    lines.push(`${(0, terminal_format_1.B)("│")} ${(0, terminal_format_1.B)("Function")}                 ${(0, terminal_format_1.B)("│")} ${(0, terminal_format_1.B)("Then")}     ${(0, terminal_format_1.B)("│")} ${(0, terminal_format_1.B)("Now")}      ${(0, terminal_format_1.B)("│")} ${(0, terminal_format_1.B)("Status")}                              ${(0, terminal_format_1.B)("│")}`);
    lines.push(`${(0, terminal_format_1.B)("├────────────────────────────┼──────────┼──────────┼──────────────────────────────────────┤")}`);
    let regressions = 0;
    let additions = 0;
    for (const fn of fns) {
        const existed = snapshotFns ? snapshotFns.has(fn) : null;
        const exists = currentFns ? currentFns.has(fn) : null;
        const thenIcon = existed === null ? (0, terminal_format_1.D)("?") : existed ? (0, terminal_format_1.G)("✔") : (0, terminal_format_1.R)("✖");
        const nowIcon = exists === null ? (0, terminal_format_1.D)("?") : exists ? (0, terminal_format_1.G)("✔") : (0, terminal_format_1.R)("✖");
        let status;
        if (existed === true && exists === true) {
            status = (0, terminal_format_1.D)("stable");
        }
        else if (existed === true && exists === false) {
            status = (0, terminal_format_1.R)("REGRESSION — removed from IR");
            regressions++;
        }
        else if (existed === false && exists === true) {
            status = (0, terminal_format_1.G)("ADDED — new in IR");
            additions++;
        }
        else if (existed === false && exists === false) {
            status = (0, terminal_format_1.R)("MISSING — never existed");
        }
        else {
            status = (0, terminal_format_1.D)("unknown");
        }
        const fnPad = fn.padEnd(26).slice(0, 26);
        lines.push(`${(0, terminal_format_1.D)("│")} ${fnPad} ${(0, terminal_format_1.D)("│")}  ${thenIcon}      ${(0, terminal_format_1.D)("│")}  ${nowIcon}      ${(0, terminal_format_1.D)("│")} ${status.padEnd(36)} ${(0, terminal_format_1.D)("│")}`);
    }
    lines.push(`${(0, terminal_format_1.B)("└────────────────────────────┴──────────┴──────────┴──────────────────────────────────────┘")}`);
    lines.push("");
    // Summary
    if (regressions > 0) {
        lines.push(`${(0, terminal_format_1.R)(`⚠ ${regressions} regression(s) detected — functions removed from IR since this session`)}`);
    }
    if (additions > 0) {
        lines.push(`${(0, terminal_format_1.G)(`+ ${additions} function(s) added to IR since this session`)}`);
    }
    if (regressions === 0 && additions === 0 && fns.length > 0) {
        lines.push(`${(0, terminal_format_1.G)("✔ IR stable — all functions present in both snapshot and current IR.")}`);
    }
    // Protocol validation against snapshot
    if (session.successfulAttempt && session.snapshotId) {
        lines.push("");
        lines.push(`${C_("Protocol re-validation (snapshot IR):")}`);
        const snap = (0, semantic_snapshot_1.loadSnapshot)(session.snapshotId);
        if (snap) {
            // Build protocols from snapshot functions that had @protocol annotations
            // (we approximate from the function list — actual protocol data is in protocols.json)
            try {
                const protoPath = path.join(process.env.PROGMUNE_PROJECT_DIR || process.cwd(), "protocols.json");
                if (fs.existsSync(protoPath)) {
                    const protoDef = JSON.parse(fs.readFileSync(protoPath, "utf-8"));
                    const protocols = (0, ssg_validator_1.parseProtocolsFromJSON)(protoDef);
                    const nsStates = new Map();
                    nsStates.set("_global", "UNAUTHENTICATED");
                    if (protoDef.namespaceInitialStates) {
                        for (const [ns, s] of Object.entries(protoDef.namespaceInitialStates)) {
                            nsStates.set(ns, s);
                        }
                    }
                    // Pure function validation (no StateMachineValidator instance)
                    const rules = new Map();
                    for (const p of protocols)
                        rules.set(p.function, p.protocol);
                    const ruleHash = (0, ssg_validator_1.hashRules)(rules);
                    const ctx = {
                        ledger: [],
                        currentState: (0, ssg_validator_1.rebuildState)([], nsStates),
                    };
                    const transitions = [];
                    let valid = true;
                    for (let i = 0; i < session.successfulAttempt.generatedActions.length; i++) {
                        const act = session.successfulAttempt.generatedActions[i];
                        if (act.kind === "call" && act.function) {
                            const { valid: tValid, transition, rejection } = (0, ssg_validator_1.validateTransition)(ctx, act.function, i, rules, nsStates, ruleHash);
                            transitions.push(transition);
                            ctx.ledger = transitions;
                            if (!tValid) {
                                lines.push(`  ${(0, terminal_format_1.R)("🚫")} ${act.function}: ${rejection?.missingFunctions.join(" → ") || "protocol violation"}`);
                                valid = false;
                            }
                            else {
                                ctx.currentState = transition.statesAfter;
                                lines.push(`  ${(0, terminal_format_1.G)("✅")} ${act.function}`);
                            }
                        }
                    }
                    // Ledger consistency check
                    const consistency = (0, ssg_validator_1.checkLedgerConsistency)(transitions, nsStates);
                    if (!consistency.consistent) {
                        lines.push(`  ${(0, terminal_format_1.R)("⚠")} Ledger consistency: ${consistency.violations.length} violation(s)`);
                        valid = false;
                    }
                    if (valid) {
                        lines.push(`  ${(0, terminal_format_1.G)("✔ All actions satisfy protocol constraints against snapshot IR.")}`);
                    }
                }
            }
            catch (e) {
                lines.push(`  ${(0, terminal_format_1.D)("(protocol re-validation not available)")}`);
            }
        }
    }
    return lines.join("\n");
}
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
    if (arg === "--antibodies") {
        console.log(formatAntibodyStats());
        return;
    }
    if (arg === "--heatmap") {
        console.log(formatHeatmap());
        return;
    }
    if (arg === "--diff-ledgers") {
        const idA = process.argv[3];
        const idB = process.argv[4];
        if (!idA || !idB) {
            console.error(`${(0, terminal_format_1.R)("Usage:")} ts-node src/semantic-trace.ts --diff-ledgers <sessionIdA> <sessionIdB>`);
            process.exit(1);
        }
        const sessions = (0, failure_corpus_1.getAllSessions)();
        const sessA = sessions.find(s => s.sessionId === idA || s.sessionId.startsWith(idA));
        const sessB = sessions.find(s => s.sessionId === idB || s.sessionId.startsWith(idB));
        if (!sessA) {
            console.error(`${(0, terminal_format_1.R)("Session A not found:")} ${idA}`);
            process.exit(1);
        }
        if (!sessB) {
            console.error(`${(0, terminal_format_1.R)("Session B not found:")} ${idB}`);
            process.exit(1);
        }
        const ledgerA = sessA.attempts.flatMap(a => a.transitions || []);
        const ledgerB = sessB.attempts.flatMap(a => a.transitions || []);
        const diff = (0, ssg_validator_1.diffLedgers)(ledgerA, ledgerB);
        console.log(`${(0, terminal_format_1.C_)("Ledger Diff")}`);
        console.log(`${(0, terminal_format_1.D)("═".repeat(50))}`);
        console.log(`  A: ${(0, terminal_format_1.D)(sessA.sessionId)} (${ledgerA.length} transitions)`);
        console.log(`  B: ${(0, terminal_format_1.D)(sessB.sessionId)} (${ledgerB.length} transitions)`);
        console.log("");
        if (diff.identical) {
            console.log(`  ${(0, terminal_format_1.G)("✔ Ledgers are identical.")}`);
        }
        else {
            console.log(`  ${(0, terminal_format_1.G)(`Unchanged: ${diff.unchanged}`)}  ${(0, terminal_format_1.R)(`Only in A: ${diff.onlyInA.length}`)}  ${(0, terminal_format_1.Y)(`Only in B: ${diff.onlyInB.length}`)}  ${(0, terminal_format_1.Y)(`Changed: ${diff.changed.length}`)}`);
            for (const d of diff.onlyInA.slice(0, 3)) {
                console.log(`    ${(0, terminal_format_1.R)("-")} @${d.index} ${d.function} ${(0, terminal_format_1.D)(d.hashA)}`);
            }
            for (const d of diff.onlyInB.slice(0, 3)) {
                console.log(`    ${(0, terminal_format_1.G)("+")} @${d.index} ${d.function} ${(0, terminal_format_1.D)(d.hashB)}`);
            }
            for (const d of diff.changed.slice(0, 3)) {
                console.log(`    ${(0, terminal_format_1.Y)("~")} @${d.index} ${d.function} ${(0, terminal_format_1.D)(d.hashA + " → " + d.hashB)}`);
            }
        }
        return;
    }
    if (arg === "--query-all") {
        const op = process.argv[3];
        const st = process.argv[4];
        if (!op || !st) {
            console.error(`${(0, terminal_format_1.R)("Usage:")} ts-node src/semantic-trace.ts --query-all <producer|consumer> <state>`);
            process.exit(1);
        }
        if (op !== "producer" && op !== "consumer") {
            console.error(`${(0, terminal_format_1.R)("Operation must be 'producer' or 'consumer'.")}`);
            process.exit(1);
        }
        console.log(formatCrossSessionQuery(op, st));
        return;
    }
    if (arg === "--stats") {
        console.log(formatLedgerStats());
        return;
    }
    if (arg === "--snapshots") {
        console.log(formatSnapshotList());
        return;
    }
    if (arg === "--diff") {
        const snapA = process.argv[3];
        const snapB = process.argv[4];
        if (!snapA || !snapB) {
            console.log(formatSnapshotList());
            console.log(`\n${(0, terminal_format_1.D)("Usage:")} ts-node src/semantic-trace.ts --diff <snapshotIdA> <snapshotIdB>`);
            return;
        }
        console.log(formatSnapshotDiff(snapA, snapB));
        return;
    }
    if (arg === "--validate") {
        const sessionId = process.argv[3];
        if (!sessionId) {
            console.error(`${(0, terminal_format_1.R)("Usage:")} ts-node src/semantic-trace.ts --validate <sessionId>`);
            console.error(`\n${(0, terminal_format_1.D)("Validates a session's IR snapshot and replays its Semantic Ledger.")}`);
            process.exit(1);
        }
        const sessionsForValidate = (0, failure_corpus_1.getAllSessions)();
        const session = sessionsForValidate.find(s => s.sessionId === sessionId || s.sessionId.startsWith(sessionId));
        if (!session) {
            console.error(`${(0, terminal_format_1.R)("Session not found:")} ${sessionId}`);
            process.exit(1);
        }
        console.log(formatSessionValidation(session));
        console.log(formatLedgerReplayValidation(session));
        return;
    }
    if (arg === "--ledger") {
        const sessionId = process.argv[3];
        if (!sessionId) {
            console.error(`${(0, terminal_format_1.R)("Usage:")} ts-node src/semantic-trace.ts --ledger <sessionId>`);
            console.error(`\n${(0, terminal_format_1.D)("Replays the Semantic Ledger: rebuildState, invariants, ruleHash comparison.")}`);
            process.exit(1);
        }
        const sessionsForLedger = (0, failure_corpus_1.getAllSessions)();
        const session = sessionsForLedger.find(s => s.sessionId === sessionId || s.sessionId.startsWith(sessionId));
        if (!session) {
            console.error(`${(0, terminal_format_1.R)("Session not found:")} ${sessionId}`);
            process.exit(1);
        }
        console.log(formatLedgerReplayValidation(session));
        return;
    }
    const sessions = (0, failure_corpus_1.getAllSessions)();
    if (arg === "--states") {
        const sessionId = process.argv[3];
        if (!sessionId) {
            console.log(formatSessionSummary(sessions));
            console.log(`\n${(0, terminal_format_1.D)("Usage:")} ts-node src/semantic-trace.ts --states <sessionId>`);
            return;
        }
        const session = sessions.find(s => s.sessionId === sessionId || s.sessionId.startsWith(sessionId));
        if (!session) {
            console.error(`${(0, terminal_format_1.R)("Session not found:")} ${sessionId}`);
            process.exit(1);
        }
        console.log(formatStateTransitions(session));
        return;
    }
    if (arg === "replay") {
        const sessionId = process.argv[3];
        if (!sessionId) {
            console.error(`${(0, terminal_format_1.R)("Usage:")} ts-node src/semantic-trace.ts replay <sessionId>`);
            console.error(`\n${(0, terminal_format_1.D)("Available sessions:")}`);
            for (const s of sessions) {
                console.error(`  ${(0, terminal_format_1.D)(s.sessionId)} — ${s.intent}`);
            }
            process.exit(1);
        }
        const session = sessions.find(s => s.sessionId === sessionId || s.sessionId.startsWith(sessionId));
        if (!session) {
            console.error(`${(0, terminal_format_1.R)("Session not found:")} ${sessionId}`);
            console.error(`\n${(0, terminal_format_1.D)("Available sessions:")}`);
            for (const s of sessions) {
                console.error(`  ${(0, terminal_format_1.D)(s.sessionId)} — ${s.intent}`);
            }
            process.exit(1);
        }
        await replaySession(session);
        return;
    }
    if (arg === "--query") {
        const sessionId = process.argv[3];
        const operation = process.argv[4];
        const operand = process.argv[5];
        if (!sessionId || !operation) {
            console.error(`${(0, terminal_format_1.R)("Usage:")} ts-node src/semantic-trace.ts --query <sessionId> <operation> [state|index]`);
            console.error(`\n${(0, terminal_format_1.B)("Operations:")}`);
            console.error(`  ${(0, terminal_format_1.D)("producer <state>")}   — find transitions that produce a state`);
            console.error(`  ${(0, terminal_format_1.D)("consumer <state>")}   — find transitions that consume a state`);
            console.error(`  ${(0, terminal_format_1.D)("violations")}         — list all invalid transitions`);
            console.error(`  ${(0, terminal_format_1.D)("transition <index>")} — find a transition by action index`);
            console.error(`  ${(0, terminal_format_1.D)("all-states")}         — list all unique states in the ledger`);
            process.exit(1);
        }
        const sessionsForQuery = (0, failure_corpus_1.getAllSessions)();
        const session = sessionsForQuery.find(s => s.sessionId === sessionId || s.sessionId.startsWith(sessionId));
        if (!session) {
            console.error(`${(0, terminal_format_1.R)("Session not found:")} ${sessionId}`);
            process.exit(1);
        }
        // Collect all transitions from all attempts
        const allTransitions = session.attempts.flatMap(a => a.transitions || []);
        if (allTransitions.length === 0) {
            console.log(`${(0, terminal_format_1.D)("No ledger data in this session.")}`);
            return;
        }
        console.log(`${(0, terminal_format_1.C_)("Ledger Query")} — ${session.sessionId}`);
        console.log(`${(0, terminal_format_1.D)("═".repeat(50))}`);
        console.log(`${(0, terminal_format_1.D)(`Ledger size: ${allTransitions.length} transitions`)}`);
        console.log("");
        if (operation === "producer" || operation === "prod") {
            if (!operand) {
                console.error(`${(0, terminal_format_1.R)("Missing state name.")}`);
                process.exit(1);
            }
            const results = (0, ssg_validator_1.findProducer)(operand, allTransitions);
            if (results.length === 0) {
                console.log(`  ${(0, terminal_format_1.D)(`No producer found for "${operand}"`)}`);
            }
            else {
                console.log(`  ${(0, terminal_format_1.B)(`Producers of "${operand}":`)}`);
                for (const r of results) {
                    console.log(`    ${(0, terminal_format_1.G)("→")} ${r.transition.function}() @index=${r.index} [${(0, terminal_format_1.D)(r.namespace)}]`);
                }
            }
        }
        else if (operation === "consumer" || operation === "cons") {
            if (!operand) {
                console.error(`${(0, terminal_format_1.R)("Missing state name.")}`);
                process.exit(1);
            }
            const results = (0, ssg_validator_1.findConsumer)(operand, allTransitions);
            if (results.length === 0) {
                console.log(`  ${(0, terminal_format_1.D)(`No consumer found for "${operand}"`)}`);
            }
            else {
                console.log(`  ${(0, terminal_format_1.B)(`Consumers of "${operand}":`)}`);
                for (const r of results) {
                    console.log(`    ${(0, terminal_format_1.Y)("←")} ${r.transition.function}() @index=${r.index} [${(0, terminal_format_1.D)(r.namespace)}]`);
                }
            }
        }
        else if (operation === "violations" || operation === "viol") {
            const results = (0, ssg_validator_1.findViolations)(allTransitions);
            if (results.length === 0) {
                console.log(`  ${(0, terminal_format_1.G)("No violations — all transitions are valid.")}`);
            }
            else {
                console.log(`  ${(0, terminal_format_1.R)(`${results.length} violation(s):`)}`);
                for (const r of results) {
                    console.log(`    ${(0, terminal_format_1.R)("✖")} ${r.transition.function}() @index=${r.index} [${(0, terminal_format_1.D)(r.namespace)}]`);
                }
            }
        }
        else if (operation === "transition" || operation === "t") {
            if (!operand) {
                console.error(`${(0, terminal_format_1.R)("Missing action index.")}`);
                process.exit(1);
            }
            const idx = parseInt(operand, 10);
            if (isNaN(idx)) {
                console.error(`${(0, terminal_format_1.R)("Invalid index.")}`);
                process.exit(1);
            }
            const result = (0, ssg_validator_1.findTransition)(idx, allTransitions);
            if (!result) {
                console.log(`  ${(0, terminal_format_1.D)(`No transition at index ${idx}`)}`);
            }
            else {
                const t = result.transition;
                console.log(`  ${(0, terminal_format_1.B)(`Transition @${idx}:`)}`);
                console.log(`    function:    ${(0, terminal_format_1.C_)(t.function)}`);
                console.log(`    namespace:   ${(0, terminal_format_1.D)(t.namespace)}`);
                console.log(`    valid:       ${t.valid ? (0, terminal_format_1.G)("yes") : (0, terminal_format_1.R)("no")}`);
                console.log(`    acquired:    ${t.acquired.length ? (0, terminal_format_1.G)("+" + t.acquired.join(",+")) : (0, terminal_format_1.D)("(none)")}`);
                console.log(`    invalidated: ${t.invalidated.length ? (0, terminal_format_1.R)("-" + t.invalidated.join(",-")) : (0, terminal_format_1.D)("(none)")}`);
                if (t.ruleHash)
                    console.log(`    ruleHash:    ${(0, terminal_format_1.D)(t.ruleHash)}`);
            }
        }
        else if (operation === "all-states" || operation === "states") {
            const states = (0, ssg_validator_1.listAllStates)(allTransitions);
            if (states.length === 0) {
                console.log(`  ${(0, terminal_format_1.D)("No states in ledger.")}`);
            }
            else {
                console.log(`  ${(0, terminal_format_1.B)(`All states (${states.length}):`)}`);
                // Group by namespace
                const byNs = new Map();
                for (const s of states) {
                    if (!byNs.has(s.namespace))
                        byNs.set(s.namespace, []);
                    byNs.get(s.namespace).push(s.state);
                }
                for (const [ns, ss] of [...byNs.entries()].sort()) {
                    console.log(`    ${(0, terminal_format_1.C_)(ns)}: ${ss.join(", ")}`);
                }
            }
        }
        else {
            console.error(`${(0, terminal_format_1.R)("Unknown operation:")} ${operation}`);
            console.error(`${(0, terminal_format_1.D)("Valid: producer, consumer, violations, transition, all-states")}`);
            process.exit(1);
        }
        return;
    }
    if (arg && !arg.startsWith("--")) {
        // View a specific session
        const session = sessions.find(s => s.sessionId === arg || s.sessionId.startsWith(arg));
        if (!session) {
            console.error(`${(0, terminal_format_1.R)("Session not found:")} ${arg}`);
            console.error(`\n${(0, terminal_format_1.D)("Available sessions:")}`);
            for (const s of sessions) {
                console.error(`  ${(0, terminal_format_1.D)(s.sessionId)} — ${s.intent}`);
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
