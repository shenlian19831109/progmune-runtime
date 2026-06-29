"use strict";
/**
 * Phase 9: Markdown Formatter
 *
 * Generates a self-contained governance report in GitHub-flavored markdown.
 * Suitable for CI artifacts, PR comments, or PDF conversion.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatAsMarkdown = formatAsMarkdown;
function percent(v) {
    return `${(v * 100).toFixed(0)}%`;
}
function verdictBadge(v) {
    if (v === "PASS")
        return "🟢 **PASS**";
    if (v === "WARN")
        return "🟡 **WARN**";
    return "🔴 **FAIL**";
}
function severityEmoji(s) {
    if (s === "critical")
        return "🔴";
    if (s === "high")
        return "🟠";
    if (s === "medium")
        return "🟡";
    return "⚪";
}
function formatAsMarkdown(report) {
    const { metadata, sessions, ssv, plsb, provenance, antibodies, verdict, recommendations } = report;
    const lines = [];
    // ── Title ──
    lines.push("# AI Code Governance Report");
    lines.push("");
    lines.push(`**Progmune Runtime** — AI Generated Software Governance`);
    lines.push("");
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| Generator | ${metadata.generator} v${metadata.version} |`);
    lines.push(`| Timestamp | ${metadata.timestamp} |`);
    lines.push(`| Project | \`${metadata.projectId}\` |`);
    lines.push(`| Validator | ${metadata.validator} |`);
    lines.push("");
    // ── Verdict ──
    lines.push("## Verdict");
    lines.push("");
    lines.push(`### ${verdictBadge(verdict)}`);
    lines.push("");
    // ── Sessions ──
    lines.push("## Sessions");
    lines.push("");
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total Sessions | ${sessions.total} |`);
    lines.push(`| Verified | ${sessions.verified} |`);
    lines.push(`| Compromised | ${sessions.compromised} |`);
    lines.push(`| Coverage | ${percent(sessions.total > 0 ? sessions.verified / sessions.total : 0)} |`);
    lines.push("");
    // ── SSV ──
    lines.push("## Semantic State Verification (SSV)");
    lines.push("");
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total Checks | ${ssv.totalChecks} |`);
    lines.push(`| Passed | ${ssv.passed} |`);
    lines.push(`| Failed | ${ssv.failed} |`);
    lines.push("");
    // ── PLSB ──
    lines.push("## Protocol Lifecycle Security Benchmark (PLSB)");
    lines.push("");
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Version | v${plsb.version} |`);
    lines.push(`| Total Entries | ${plsb.totalEntries} (${plsb.verifiedEntries} verified) |`);
    lines.push(`| Coverage | ${percent(plsb.coverage)} |`);
    lines.push(`| Recall | ${percent(plsb.recall)} |`);
    lines.push(`| Precision | ${percent(plsb.precision)} |`);
    lines.push("");
    if (plsb.matchedCategories.length > 0) {
        lines.push(`**Covered:** ${plsb.matchedCategories.join(", ")}`);
        lines.push("");
    }
    if (plsb.unmatchedCategories.length > 0) {
        lines.push(`**Uncovered:** ${plsb.unmatchedCategories.join(", ")}`);
        lines.push("");
    }
    // ── Provenance ──
    lines.push("## Provenance (Ledger Integrity)");
    lines.push("");
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total Fingerprints | ${provenance.totalFingerprints} |`);
    lines.push(`| Verified | ${provenance.verified} |`);
    lines.push(`| Tampered | ${provenance.tampered} |`);
    lines.push(`| Not Found | ${provenance.notFound} |`);
    lines.push("");
    // ── Antibodies ──
    lines.push("## Immune System (Antibodies)");
    lines.push("");
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total Hits | ${antibodies.totalHits} |`);
    lines.push(`| Fast-Path Hits | ${antibodies.fastPathHits} |`);
    lines.push(`| LLM Calls Saved | ${antibodies.llmCallsSaved} |`);
    lines.push(`| Tokens Saved | ${antibodies.tokensSaved.toLocaleString()} |`);
    lines.push("");
    // ── Session Details ──
    if (sessions.details.length > 0 && sessions.details.length <= 20) {
        lines.push("## Session Details");
        lines.push("");
        lines.push(`| Session ID | Intent | Transitions | Valid | Verified | Consistent |`);
        lines.push(`|------------|--------|-------------|-------|----------|------------|`);
        for (const d of sessions.details) {
            const v = d.fingerprintVerified ? "✅" : "❌";
            const c = d.consistencyPassed ? "✅" : "⚠️";
            lines.push(`| \`${d.sessionId.slice(0, 20)}...\` | ${d.intent.slice(0, 30)} | ${d.transitionCount} | ${d.validTransitions} | ${v} | ${c} |`);
        }
        lines.push("");
    }
    // ── Recommendations ──
    if (recommendations.length > 0) {
        lines.push("## Recommendations");
        lines.push("");
        for (const r of recommendations) {
            lines.push(`- ${severityEmoji(r.severity)} **[${r.severity.toUpperCase()}]** ${r.message}`);
            lines.push(`  - Action: ${r.action}`);
        }
        lines.push("");
    }
    else {
        lines.push("## Recommendations");
        lines.push("");
        lines.push("✅ No issues found. All systems nominal.");
        lines.push("");
    }
    // ── Footer ──
    lines.push("---");
    lines.push("");
    lines.push("*Report generated by [Progmune Runtime](https://github.com/shenlian19831109/progmune-runtime) — AI Generated Software Governance*");
    lines.push("");
    return lines.join("\n");
}
