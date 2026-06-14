"use strict";
/**
 * Capability Gap Discovery — Graph as Capability Auditor
 *
 * Instead of recommending wrong functions when capabilities are missing,
 * this module identifies WHAT capabilities are needed but don't exist in the IR.
 *
 * Usage: gapAnalysis(intent, ir) → { satisfied, gaps }
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.gapAnalysis = gapAnalysis;
exports.formatGapReport = formatGapReport;
/**
 * Extract capability terms from an intent.
 * e.g., "add oauth2 login support" → ["oauth2", "login", "authentication"]
 */
function extractCapabilities(intent) {
    const lower = intent.toLowerCase();
    const caps = [];
    // Known capability patterns
    const patterns = [
        /\b(oauth2?|jwt|saml|openid)\b/gi,
        /\b(cache|caching|memoize)\b/gi,
        /\b(retry|backoff|circuit\s*breaker)\b/gi,
        /\b(log|logging|audit|trace)\b/gi,
        /\b(validate|validation|sanitize)\b/gi,
        /\b(auth|authenticate|login|logout|session)\b/gi,
        /\b(encrypt|decrypt|hash|sign|verify)\b/gi,
        /\b(queue|publish|subscribe|event\s*bus)\b/gi,
        /\b(rate\s*limiting?|throttle|quota)\b/gi,
        /\b(export|import|serialize|deserialize)\b/gi,
        /\b(notify|notification|alert|webhook)\b/gi,
        /\b(schedule|cron|timer|recurring)\b/gi,
        /\b(report|dashboard|metrics|analytics)\b/gi,
    ];
    for (const pat of patterns) {
        const matches = lower.match(pat);
        if (matches)
            caps.push(...matches.map(m => m.toLowerCase()));
    }
    return [...new Set(caps)];
}
/**
 * Check if a capability exists in the IR function set.
 */
function capabilityExists(cap, ir) {
    const capLower = cap.toLowerCase().replace(/[\s_]+/g, "");
    // Word boundary regex — prevents "oauth2" from matching "auth" via substring
    const capWordBoundary = new RegExp('\\b' + capLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    const matches = [];
    for (const f of ir) {
        if (!f.exported)
            continue;
        const nameLower = f.name.toLowerCase();
        const purposeLower = (f.purpose || "").toLowerCase();
        const tagsLower = (f.tags || []).map(t => t.toLowerCase());
        // Direct name match: whole-word boundary OR exact full-string match
        if (nameLower.length > 2 && (capWordBoundary.test(nameLower) || nameLower === capLower)) {
            matches.push(f.name);
            continue;
        }
        // Purpose match: word boundary only
        if (purposeLower.length > 2 && capWordBoundary.test(purposeLower)) {
            matches.push(f.name);
            continue;
        }
        // Tag match: exact match OR whole-word boundary (NOT substring)
        // e.g., tag "auth" should NOT match capability "oauth2"
        // but tag "auth" SHOULD match capability "auth"
        if (tagsLower.some(t => t.length > 2 && t === capLower)) {
            matches.push(f.name);
        }
        else if (tagsLower.some(t => t.length > 2 && capWordBoundary.test(t))) {
            matches.push(f.name);
        }
    }
    return { exists: matches.length > 0, matches: [...new Set(matches)] };
}
/**
 * Analyze intent against IR to find capability gaps.
 */
function gapAnalysis(intent, ir) {
    const capabilities = extractCapabilities(intent);
    const satisfied = [];
    const gaps = [];
    for (const cap of capabilities) {
        const { exists, matches } = capabilityExists(cap, ir);
        if (exists) {
            satisfied.push(`${cap} (${matches.slice(0, 3).join(", ")})`);
        }
        else {
            gaps.push({
                capability: cap,
                requiredBy: intent,
                confidence: 0.8,
                suggestedNames: [cap.replace(/[\s_]+/g, ""), `${cap}Handler`, `${cap}Service`],
            });
        }
    }
    const coverage = capabilities.length > 0
        ? satisfied.length / capabilities.length
        : 1;
    return { satisfied, gaps, coverage };
}
/**
 * Format gap analysis as a human-readable report.
 */
function formatGapReport(analysis) {
    const lines = [
        `═══ Capability Gap Analysis ═══`,
        `Coverage: ${Math.round(analysis.coverage * 100)}% (${analysis.satisfied.length}/${analysis.satisfied.length + analysis.gaps.length} capabilities)`,
        "",
    ];
    if (analysis.satisfied.length > 0) {
        lines.push("✅ Satisfied:");
        for (const s of analysis.satisfied)
            lines.push(`  - ${s}`);
        lines.push("");
    }
    if (analysis.gaps.length > 0) {
        lines.push("❌ Missing Capabilities:");
        for (const g of analysis.gaps) {
            lines.push(`  - ${g.capability} (confidence: ${Math.round(g.confidence * 100)}%)`);
            lines.push(`    suggested: ${g.suggestedNames.join(", ")}`);
        }
        lines.push("");
        lines.push("💡 These gaps can drive auto-generation of new functions into the IR.");
    }
    return lines.join("\n");
}
