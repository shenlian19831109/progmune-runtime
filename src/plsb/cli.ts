/**
 * Phase 9: PLSB CLI
 *
 * Usage:
 *   npx ts-node src/plsb/cli.ts --export        write plsb-v1.0.json
 *   npx ts-node src/plsb/cli.ts --report        write plsb-report.md
 *   npx ts-node src/plsb/cli.ts --all           both
 *   npx ts-node src/plsb/cli.ts --summary       terminal summary
 */

import { generatePLSBArtifact, PLSB_ARTIFACT_PATH } from "./artifact";
import { generatePLSBSchema, PLSB_SCHEMA_PATH } from "./schema";
import { generatePLSBReportMarkdown, PLSB_REPORT_PATH } from "./report-md";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  console.log(`
PLSB CLI — Protocol Lifecycle Security Benchmark

Usage:
  npx ts-node src/plsb/cli.ts [options]

Options:
  --export      Generate ${PLSB_ARTIFACT_PATH}
  --report      Generate ${PLSB_REPORT_PATH}
  --all         Generate both artifact and report
  --summary     Print terminal summary
  --help, -h    Show this help
  `);
  process.exit(0);
}

const doExport = args.includes("--export") || args.includes("--all");
const doReport = args.includes("--report") || args.includes("--all");
const doSummary = args.includes("--summary") || (!doExport && !doReport);

if (doExport) {
  const artifact = generatePLSBArtifact(PLSB_ARTIFACT_PATH);
  generatePLSBSchema(PLSB_SCHEMA_PATH);
  console.log(`✅ Exported: ${PLSB_ARTIFACT_PATH}`);
  console.log(`✅ Schema:   ${PLSB_SCHEMA_PATH}`);
  console.log(`   Public URI: ${artifact["@id"]}`);
  console.log(`   ${artifact.benchmark.metadata.total} entries, ${Object.keys(artifact.benchmark.metadata.byPLS).length}/${artifact.benchmark.taxonomy.length} categories covered`);
}

if (doReport) {
  generatePLSBReportMarkdown(PLSB_REPORT_PATH);
  console.log(`✅ Report: ${PLSB_REPORT_PATH}`);
}

if (doSummary) {
  const { buildPLSB, PROTOCOL_WEAKNESS_TAXONOMY } = require("../plsb-benchmark");
  const benchmark = buildPLSB();
  const taxonomy = PROTOCOL_WEAKNESS_TAXONOMY as any[];
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
