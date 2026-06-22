/**
 * Phase 9: Governance Report CLI
 *
 * Usage:
 *   npx ts-node src/audit/cli.ts --all               full report
 *   npx ts-node src/audit/cli.ts <sessionId>          single session
 *   npx ts-node src/audit/cli.ts --json                JSON output
 *   npx ts-node src/audit/cli.ts --markdown            markdown output
 *   npx ts-node src/audit/cli.ts --help                this message
 */

import { buildGovernanceReport } from "./report-builder";
import { formatAsTerminal } from "./formatters/terminal";
import { formatAsJSON } from "./formatters/json";
import { formatAsMarkdown } from "./formatters/markdown";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Progmune Governance Report CLI

Usage:
  npx ts-node src/audit/cli.ts [options] [sessionId]

Options:
  --all           Generate report for all sessions (default)
  --json          Output as JSON
  --markdown      Output as Markdown
  --terminal      Output for terminal (default)
  --fast          Skip PLSB benchmark (faster)
  --help, -h      Show this help

Examples:
  npx ts-node src/audit/cli.ts --all
  npx ts-node src/audit/cli.ts sess_abc123
  npx ts-node src/audit/cli.ts --json --fast
  npx ts-node src/audit/cli.ts --markdown > governance-report.md
  `);
  process.exit(0);
}

const projectPath = process.env.PROGMUNE_PROJECT_DIR || process.cwd();
const useJson = args.includes("--json");
const useMarkdown = args.includes("--markdown");
const fast = args.includes("--fast");

// sessionId: first non-flag argument
const sessionId = args.find((a) => !a.startsWith("--"));

const report = buildGovernanceReport(projectPath, { fast, sessionId });

let output: string;
if (useJson) {
  output = formatAsJSON(report);
} else if (useMarkdown) {
  output = formatAsMarkdown(report);
} else {
  output = formatAsTerminal(report);
}

console.log(output);
