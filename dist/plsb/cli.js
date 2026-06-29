"use strict";
/**
 * Phase 9: PLSB CLI
 *
 * Usage:
 *   npx ts-node src/plsb/cli.ts --export        write plsb-v1.0.json
 *   npx ts-node src/plsb/cli.ts --report        write plsb-report.md
 *   npx ts-node src/plsb/cli.ts --all           both
 *   npx ts-node src/plsb/cli.ts --summary       terminal summary
 */
Object.defineProperty(exports, "__esModule", { value: true });
const artifact_1 = require("./artifact");
const schema_1 = require("./schema");
const report_md_1 = require("./report-md");
const leaderboard_1 = require("./leaderboard");
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    console.log(`
PLSB CLI — Protocol Lifecycle Security Benchmark

Usage:
  npx ts-node src/plsb/cli.ts [options]

Options:
  --export      Generate ${artifact_1.PLSB_ARTIFACT_PATH}
  --report      Generate ${report_md_1.PLSB_REPORT_PATH}
  --all          Generate both artifact and report
  --leaderboard  Generate PLSB Leaderboard (JSON + Markdown)
  --summary      Print terminal summary
  --help, -h     Show this help
  `);
    process.exit(0);
}
const doExport = args.includes("--export") || args.includes("--all");
const doReport = args.includes("--report") || args.includes("--all");
const doSummary = args.includes("--summary") || (!doExport && !doReport);
if (args.includes("--leaderboard")) {
    (0, leaderboard_1.exportLeaderboard)();
    process.exit(0);
}
if (doExport) {
    const artifact = (0, artifact_1.generatePLSBArtifact)(artifact_1.PLSB_ARTIFACT_PATH);
    (0, schema_1.generatePLSBSchema)(schema_1.PLSB_SCHEMA_PATH);
    console.log(`✅ Exported: ${artifact_1.PLSB_ARTIFACT_PATH}`);
    console.log(`✅ Schema:   ${schema_1.PLSB_SCHEMA_PATH}`);
    console.log(`   Public URI: ${artifact["@id"]}`);
    console.log(`   ${artifact.benchmark.metadata.total} entries, ${Object.keys(artifact.benchmark.metadata.byPLS).length}/${artifact.benchmark.taxonomy.length} categories covered`);
}
if (doReport) {
    (0, report_md_1.generatePLSBReportMarkdown)(report_md_1.PLSB_REPORT_PATH);
    console.log(`✅ Report: ${report_md_1.PLSB_REPORT_PATH}`);
}
if (doSummary) {
    const { buildPLSB, PROTOCOL_WEAKNESS_TAXONOMY } = require("../plsb-benchmark");
    const benchmark = buildPLSB();
    const taxonomy = PROTOCOL_WEAKNESS_TAXONOMY;
    const byPLS = benchmark.metadata?.byPLS || {};
    console.log("");
    console.log("PLSB v1.0 — Protocol Lifecycle Security Benchmark");
    console.log("==================================================");
    console.log(`  Entries:    ${benchmark.metadata?.total || 0} (${benchmark.metadata?.verified || 0} verified)`);
    console.log(`  Recall:     ${((benchmark.metadata?.recall || 0) * 100).toFixed(0)}%`);
    console.log(`  Precision:  ${((benchmark.metadata?.precision || 0) * 100).toFixed(0)}%`);
    console.log("");
    for (const t of taxonomy) {
        const count = byPLS[t.id] || 0;
        const icon = count > 0 ? "✅" : "⚠️";
        console.log(`  ${icon} ${t.id} ${t.name.padEnd(22)} ${t.category.padEnd(18)} ${count} entries`);
    }
    console.log("");
}
