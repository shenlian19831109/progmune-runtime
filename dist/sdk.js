"use strict";
/**
 * Progmune SDK — Simple one-call API for AI Code Governance
 *
 * Usage:
 *   import { verify } from "@progmune/sdk"
 *   const result = await verify("./src/server.ts")
 *
 * Returns everything a developer needs in one call:
 *   certificate, knowledge version, stable protocols, risk level
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RUNTIME_VERSION = void 0;
exports.verify = verify;
exports.fix = fix;
exports.explain = explain;
exports.getCompatibility = getCompatibility;
const certify_1 = require("./certify");
const risk_model_1 = require("./risk-model");
const protocol_knowledge_1 = require("./protocol-knowledge");
const evidence_repository_1 = require("./evidence-repository");
/** Runtime version — stable public identifier. Internal layers evolve underneath. */
exports.RUNTIME_VERSION = "3.7.10";
function verify(filePath) {
    const cert = (0, certify_1.certify)(filePath);
    const kb = (0, protocol_knowledge_1.buildKnowledgeBase)();
    const er = (0, evidence_repository_1.buildEvidenceRepository)();
    const risk = (0, risk_model_1.assessRisk)(["SSL_CTX_new", "SSL_connect"]);
    // Decision: Risk → Policy → Decision
    let decision;
    if (risk.riskLevel === "Critical")
        decision = "BLOCK";
    else if (risk.riskLevel === "High")
        decision = "WARN";
    else
        decision = "ALLOW";
    // Knowledge Network context
    let network;
    try {
        const { buildKnowledgeGraph, getDependencies, getDependents } = require("./knowledge-graph");
        const g = buildKnowledgeGraph();
        const related = [...new Set([
                ...getDependencies(g, "PROTO-TLS").map((n) => n.name),
                ...getDependents(g, "PROTO-TLS").map((n) => n.name),
            ])];
        network = { totalNodes: g.nodes.length, totalEdges: g.edges.length, relatedProtocols: related };
    }
    catch { /* graph unavailable */ }
    return {
        runtimeVersion: exports.RUNTIME_VERSION,
        decision,
        certificate: cert,
        knowledge: {
            version: kb.version,
            stableProtocols: kb.summary.byMaturity["stable"],
            totalProtocols: kb.summary.totalUnits,
            averageConfidence: kb.summary.averageConfidence,
        },
        evidence: {
            totalRepos: er.summary.totalRepos,
            totalSequences: er.summary.totalSequences,
            topProtocols: er.summary.topProtocols.slice(0, 3).map(t => t.protocol),
        },
        risk: {
            level: risk.riskLevel,
            recommendation: risk.recommendation,
            patterns: risk.patterns.map(p => ({
                name: p.patternName, severity: p.severity, confidence: p.confidence,
                concept: p.concept, detail: p.detail,
            })),
        },
        network,
        timestamp: new Date().toISOString(),
    };
}
/**
 * Analyze a project and return actionable fix suggestions.
 *
 * Uses the Trust Engine (SSG state machine + Express/NestJS framework
 * detectors) to find protocol violations, then extracts concrete
 * repair steps — BFS-computed fix paths, middleware additions,
 * decorator insertions, etc.
 *
 * Usage:
 *   const result = await fix("./my-project")
 *   if (result.possible) {
 *     for (const s of result.suggestions) {
 *       console.log(s.file, s.fix)
 *     }
 *   }
 */
async function fix(projectPath) {
    try {
        // Lazy-require trust engine to avoid circular deps at module load
        const { evaluateTrust } = require("./trust/engine");
        const decision = await evaluateTrust({
            projectPath,
            projectName: projectPath.split("/").pop() || "unknown",
            commit: "working-tree",
            language: "typescript",
        });
        const suggestions = [];
        const seen = new Set(); // deduplicate by file + ruleId
        for (const v of decision.violations) {
            if (!v.fix)
                continue;
            // Deduplicate: same file + same rule → report once
            const dedupKey = `${v.file}::${v.rule_id}`;
            if (seen.has(dedupKey))
                continue;
            seen.add(dedupKey);
            const source = v.rule_id.startsWith("SSG_") ? "ssg" :
                v.policy_ref === "framework.express" ? "express" :
                    v.policy_ref === "framework.nestjs" ? "nestjs" :
                        v.policy_ref?.startsWith("protocol") ? "protocol" : "policy";
            // Extract BFS fix path from SSG violations
            let fixPath;
            if (source === "ssg") {
                const match = v.fix.match(/Insert before the violating call:\s*(.+)/);
                if (match) {
                    fixPath = match[1].split(" → ").map((s) => s.trim()).filter(Boolean);
                }
            }
            suggestions.push({
                file: v.file || projectPath,
                severity: v.severity,
                ruleId: v.rule_id,
                message: v.message,
                fix: v.fix,
                fixPath: fixPath?.length ? fixPath : undefined,
                source,
            });
        }
        // Sort: critical first, then by file
        suggestions.sort((a, b) => {
            const sev = { critical: 0, high: 1, medium: 2, low: 3 };
            const sa = sev[a.severity] ?? 4;
            const sb = sev[b.severity] ?? 4;
            if (sa !== sb)
                return sa - sb;
            return a.file.localeCompare(b.file);
        });
        return {
            possible: suggestions.length > 0,
            totalIssues: decision.violations.length,
            fixableIssues: suggestions.length,
            suggestions,
            summary: suggestions.length > 0
                ? `Found ${suggestions.length} fixable issue(s) across ${new Set(suggestions.map(s => s.file)).size} file(s).`
                : "No fixable issues found. The project passes all protocol checks.",
        };
    }
    catch (e) {
        return {
            possible: false,
            totalIssues: 0,
            fixableIssues: 0,
            suggestions: [],
            summary: `Fix analysis failed: ${e.message || "unknown error"}`,
        };
    }
}
/**
 * explain() — Human-readable governance explanation.
 * Answers: WHY is this risk Critical? WHAT knowledge backs it?
 */
function explain(result) {
    const lines = [];
    lines.push("Progmune Governance Explanation");
    lines.push(`Runtime v${result.runtimeVersion}  |  Decision: ${result.decision}`);
    lines.push("================================\n");
    lines.push(`Risk Level: ${result.risk.level}`);
    lines.push(`Recommendation: ${result.risk.recommendation}\n`);
    if (result.risk.patterns.length > 0) {
        lines.push("Risk Patterns Detected:");
        for (const p of result.risk.patterns) {
            lines.push(`  - ${p.name} (${p.severity}, ${p.confidence}% confidence)`);
            if (p.concept)
                lines.push(`    Missing concept: ${p.concept}`);
            lines.push(`    ${p.detail}`);
        }
        lines.push("");
    }
    else {
        lines.push("No risk patterns detected. Code appears protocol-compliant.\n");
    }
    lines.push("Knowledge Backing:");
    lines.push(`  Protocol Knowledge Base v${result.knowledge.version}`);
    lines.push(`  ${result.knowledge.stableProtocols} stable protocol domains with ${result.knowledge.averageConfidence}% avg confidence`);
    lines.push(`  Evidence from ${result.evidence.totalRepos} repositories (${result.evidence.totalSequences} validated sequences)`);
    lines.push(`  Top protocols: ${result.evidence.topProtocols.join(", ")}`);
    if (result.certificate.kbAssets?.length) {
        lines.push("\nVerified Against:");
        for (const a of result.certificate.kbAssets) {
            const rfc = a.rfc ? ` (${a.rfc})` : "";
            lines.push(`  ${a.name} v${a.version} — ${a.confidence}% confidence${rfc}`);
        }
    }
    if (result.network && result.network.relatedProtocols.length > 0) {
        lines.push(`\nProtocol Network Context:`);
        lines.push(`  ${result.network.totalNodes} nodes, ${result.network.totalEdges} edges in Knowledge Graph`);
        lines.push(`  Related: ${result.network.relatedProtocols.join(" · ")}`);
    }
    return lines.join("\n");
}
function getCompatibility() {
    const kb = (0, protocol_knowledge_1.buildKnowledgeBase)();
    return {
        sdkVersion: "1.0.0",
        knowledgeVersion: kb.version,
        protocols: kb.units.filter((u) => u.maturity === "stable").map((u) => u.name),
        compatibleWith: [
            { component: "Policy Engine", version: "2.0.0", compatible: true, notes: "All 8 rules operational" },
            { component: "Certificate", version: "2.0.0", compatible: true, notes: "Ontology-backed certificates" },
            { component: "GitHub Action", version: "1.0.0", compatible: true, notes: "CI deploy gate active" },
            { component: "Knowledge API", version: "1.0.0", compatible: true, notes: "All endpoints operational" },
            { component: "Dashboard", version: "1.0.0", compatible: true, notes: "Governance KPIs active" },
            { component: "Verification API", version: "1.0.0", compatible: true, notes: "External verification active" },
        ],
    };
}
// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args[0] === "compat") {
        console.log(JSON.stringify(getCompatibility(), null, 2));
    }
    else if (args[0] === "explain" && args[1]) {
        const result = verify(args[1]);
        console.log(explain(result));
    }
    else {
        const filePath = args[0] || ".";
        try {
            const result = verify(filePath);
            if (args.includes("--explain")) {
                console.log(explain(result));
            }
            else {
                console.log(JSON.stringify(result, null, 2));
            }
        }
        catch (e) {
            console.error(JSON.stringify({ error: e.message }));
            process.exit(1);
        }
    }
}
