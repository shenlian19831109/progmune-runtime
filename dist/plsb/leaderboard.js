"use strict";
/**
 * Phase 12: PLSB Leaderboard
 *
 * Public comparison of protocol lifecycle security detection tools.
 * The market believes rankings, not papers.
 *
 * Generates a transparent, reproducible leaderboard:
 *   - Progmune's real scores from buildPLSB()
 *   - Placeholder rows for other tools with methodology notes
 *   - JSON artifact + Markdown + HTML
 *
 * Usage:
 *   npx ts-node src/plsb/cli.ts --leaderboard
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
exports.LEADERBOARD_MD_PATH = exports.LEADERBOARD_JSON_PATH = void 0;
exports.generateLeaderboard = generateLeaderboard;
exports.formatLeaderboardMarkdown = formatLeaderboardMarkdown;
exports.formatLeaderboardJSON = formatLeaderboardJSON;
exports.exportLeaderboard = exportLeaderboard;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ═══════════════════════════════════════════════════════════════
// Generator
// ═══════════════════════════════════════════════════════════════
function generateLeaderboard() {
    const { buildPLSB, PROTOCOL_WEAKNESS_TAXONOMY } = require("../plsb-benchmark");
    const benchmark = buildPLSB();
    const taxonomy = PROTOCOL_WEAKNESS_TAXONOMY;
    const byPLS = benchmark.metadata?.byPLS || {};
    const covered = taxonomy.filter((t) => (byPLS[t.id] || 0) > 0).length;
    const totalEntries = benchmark.metadata?.total || 0;
    const verifiedEntries = benchmark.metadata?.verified || 0;
    // Progmune's real scores
    const progmuneEntry = {
        tool: "Progmune Runtime",
        version: "3.2.0",
        vendor: "Progmune (Open Source)",
        score: 0, // F1 requires hand-labeled ground truth — will be filled when .progmune_labels.json exists
        recall: 0,
        precision: 0,
        categoriesCovered: covered,
        categoriesTotal: taxonomy.length,
        entriesTested: totalEntries,
        benchmarkDate: new Date().toISOString().slice(0, 10),
        status: "benchmarked",
        methodology: "SSG state machine validation + auto-discovered protocol rules. Score requires hand-labeled ground truth per repo (.progmune_labels.json).",
        artifacts: "benchmarks/plsb-v1.0.json",
        notes: verifiedEntries > 0
            ? `${verifiedEntries} verified gold entries, ${covered}/${taxonomy.length} categories covered. Precision requires annotated labels per target repository.`
            : "Gold dataset ready. Multi-repo labeling in progress.",
    };
    // Comparison tools — not yet independently benchmarked
    const comparisonEntries = [
        {
            tool: "CodeQL",
            version: "—",
            vendor: "GitHub / Microsoft",
            score: 0, recall: 0, precision: 0,
            categoriesCovered: 0, categoriesTotal: taxonomy.length, entriesTested: 0,
            benchmarkDate: "—",
            status: "not_benchmarked",
            methodology: "CodeQL detects data flow and taint patterns but does not model protocol state machines. Protocol lifecycle violations (missing release, double commit, session fixation) fall outside its taint-tracking model. Benchmark integration requires writing custom CodeQL queries for each PLS category.",
            notes: "Custom query pack needed to map PLS-001 through PLS-013 to CodeQL predicates.",
        },
        {
            tool: "Semgrep",
            version: "—",
            vendor: "Semgrep, Inc.",
            score: 0, recall: 0, precision: 0,
            categoriesCovered: 0, categoriesTotal: taxonomy.length, entriesTested: 0,
            benchmarkDate: "—",
            status: "not_benchmarked",
            methodology: "Semgrep matches AST patterns but lacks stateful sequence analysis. Can detect missing function calls only if written as explicit pattern pairs. Protocol lifecycle detection requires cross-function state tracking not available in pattern-matching mode.",
            notes: "Semgrep's taint mode may partially cover PLS-004 (auth bypass) but cannot model acquire→use→release chains.",
        },
        {
            tool: "Snyk Code",
            version: "—",
            vendor: "Snyk Ltd.",
            score: 0, recall: 0, precision: 0,
            categoriesCovered: 0, categoriesTotal: taxonomy.length, entriesTested: 0,
            benchmarkDate: "—",
            status: "not_benchmarked",
            methodology: "Snyk Code uses ML-based vulnerability detection trained on known CVE patterns. May implicitly learn some protocol patterns from training data, but provides no deterministic protocol state machine guarantees.",
            notes: "Black-box evaluation would require running Snyk Code against PLSB benchmark cases and comparing detection results.",
        },
        {
            tool: "Checkmarx SAST",
            version: "—",
            vendor: "Checkmarx Ltd.",
            score: 0, recall: 0, precision: 0,
            categoriesCovered: 0, categoriesTotal: taxonomy.length, entriesTested: 0,
            benchmarkDate: "—",
            status: "not_benchmarked",
            methodology: "Checkmarx provides data flow analysis but does not explicitly model protocol state machines. Requires custom query configuration for cross-functional sequence detection.",
            notes: "Undergoing acquisition by Haveli Investments. Enterprise SAST with custom query support.",
        },
        {
            tool: "Copilot Code Review",
            version: "—",
            vendor: "GitHub / Microsoft",
            score: 0, recall: 0, precision: 0,
            categoriesCovered: 0, categoriesTotal: taxonomy.length, entriesTested: 0,
            benchmarkDate: "—",
            status: "not_benchmarked",
            methodology: "LLM-based code review can identify individual missing function calls but lacks deterministic protocol state machine enforcement. Detection depends on prompt engineering and model behavior, not verifiable rules.",
            notes: "LLM-based review is probabilistic. PLSB requires deterministic detection for governance certification.",
        },
    ];
    const entries = [progmuneEntry, ...comparisonEntries];
    return {
        name: "PLSB Leaderboard",
        version: "1.0.0",
        generated: new Date().toISOString(),
        benchmarkVersion: "v1.0",
        plsbUri: "https://progmune.io/plsb/v1.0",
        entries,
        methodology: {
            description: "Protocol Lifecycle Security Benchmark — measures each tool's ability to detect protocol state machine violations (missing states, illegal transitions, lifecycle breaks) that traditional SAST cannot see.",
            benchmark: "13-category Protocol Weakness Taxonomy (PLS-001 through PLS-013). Gold dataset: 25 manually-verified real-world defect cases.",
            metric: "F1 score = harmonic mean of precision and recall. Precision = true positives / (true positives + false positives). Recall = true positives / (true positives + false negatives).",
            categories: "resource_leak, use_after_free, auth_bypass, session_fixation, privilege_escalation, transaction_violation, double_free, race_condition, missing_validation",
        },
    };
}
// ═══════════════════════════════════════════════════════════════
// Formatters
// ═══════════════════════════════════════════════════════════════
function formatLeaderboardMarkdown(lb) {
    const lines = [];
    lines.push("# PLSB Leaderboard — Protocol Lifecycle Security Detection");
    lines.push("");
    lines.push(`**Version:** ${lb.benchmarkVersion} | **Generated:** ${lb.generated}`);
    lines.push("");
    lines.push(`> ${lb.methodology.description}`);
    lines.push("");
    lines.push("## Scores");
    lines.push("");
    lines.push(`| # | Tool | Score (F1) | Recall | Precision | Categories | Status |`);
    lines.push(`|---|------|-----------|--------|-----------|------------|--------|`);
    for (let i = 0; i < lb.entries.length; i++) {
        const e = lb.entries[i];
        const scoreStr = e.status === "benchmarked" && e.score > 0
            ? `${e.score}%`
            : e.status === "benchmarked"
                ? `⚠️ needs labels`
                : "—";
        const recallStr = e.recall > 0 ? `${e.recall}%` : "—";
        const precisionStr = e.precision > 0 ? `${e.precision}%` : "—";
        const catStr = e.categoriesCovered > 0
            ? `${e.categoriesCovered}/${e.categoriesTotal}`
            : "—";
        const statusStr = e.status === "benchmarked" ? "✅" : "⏳";
        lines.push(`| ${i + 1} | **${e.tool}** | ${scoreStr} | ${recallStr} | ${precisionStr} | ${catStr} | ${statusStr} |`);
    }
    lines.push("");
    // Methodology per tool
    lines.push("## Methodology Notes");
    lines.push("");
    for (const e of lb.entries) {
        lines.push(`### ${e.tool} (${e.vendor})`);
        lines.push("");
        if (e.status === "benchmarked") {
            lines.push(`- **Status:** Benchmarked on PLSB v1.0 gold dataset`);
            lines.push(`- **Entries tested:** ${e.entriesTested}`);
            lines.push(`- **Method:** ${e.methodology}`);
        }
        else {
            lines.push(`- **Status:** Not yet benchmarked on PLSB`);
            lines.push(`- **Why not:** ${e.methodology}`);
        }
        if (e.notes)
            lines.push(`- **Note:** ${e.notes}`);
        lines.push("");
    }
    // How to contribute
    lines.push("## Contributing");
    lines.push("");
    lines.push("Tool vendors and researchers can submit benchmark results by:");
    lines.push("");
    lines.push("1. Cloning [progmune-runtime](https://github.com/shenlian19831109/progmune-runtime)");
    lines.push("2. Running `npm run plsb:export` to get `benchmarks/plsb-v1.0.json`");
    lines.push("3. Testing their tool against the 25 gold cases (13 categories)");
    lines.push("4. Submitting results as a PR to this leaderboard");
    lines.push("");
    lines.push("All submissions must include reproducible methodology and raw detection logs.");
    lines.push("");
    lines.push("---");
    lines.push(`*Leaderboard generated by [Progmune Runtime](https://github.com/shenlian19831109/progmune-runtime)*`);
    lines.push("");
    return lines.join("\n");
}
function formatLeaderboardJSON(lb) {
    return JSON.stringify(lb, null, 2);
}
// ═══════════════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════════════
exports.LEADERBOARD_JSON_PATH = "benchmarks/plsb-leaderboard.json";
exports.LEADERBOARD_MD_PATH = "benchmarks/plsb-leaderboard.md";
function exportLeaderboard(outputDir) {
    const lb = generateLeaderboard();
    const dir = outputDir || "benchmarks";
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    const jsonPath = path.join(dir, "plsb-leaderboard.json");
    const mdPath = path.join(dir, "plsb-leaderboard.md");
    fs.writeFileSync(jsonPath, formatLeaderboardJSON(lb), "utf-8");
    fs.writeFileSync(mdPath, formatLeaderboardMarkdown(lb), "utf-8");
    console.error(`✅ Leaderboard JSON: ${jsonPath}`);
    console.error(`✅ Leaderboard MD:   ${mdPath}`);
    console.error(`   Tools: ${lb.entries.length} (1 benchmarked, ${lb.entries.length - 1} awaiting)`);
    return { json: jsonPath, md: mdPath };
}
