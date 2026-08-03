/**
 * Phase 1: Trust CLI — `progmune trust` command
 *
 * Usage:
 *   npx ts-node src/trust/cli.ts <projectPath> [options]
 *
 * Options:
 *   --commit <sha>     Git commit SHA
 *   --branch <name>    Git branch name
 *   --policy <path>    Policy config file (default: .progmune-policy.json)
 *   --language <lang>  Project language
 *   --json             Output as JSON
 *   --help, -h         Show help
 */

import * as path from "path";
import { evaluateTrust } from "./engine";
import { formatTrustTerminal } from "./formatters/terminal";
import { formatTrustJSON } from "./formatters/json";
import { formatTrustCI, ciExitCode } from "./formatters/ci";
import type { TrustEvaluationContext } from "./types";

const args = process.argv.slice(2);

async function main() {
// Help flag
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Progmune Trust CLI — AI Trust Decision Engine

Usage:
  npx ts-node src/trust/cli.ts <projectPath> [options]

Options:
  --commit <sha>      Git commit SHA for audit trail
  --branch <name>     Git branch name
  --policy <path>     Policy config file (default: .progmune-policy.json)
  --language <lang>   Project language (typescript, python, etc.)
  --json              Output machine-readable JSON
  --help, -h          Show this help

Example:
  npx ts-node src/trust/cli.ts . --commit HEAD --json
`);
  process.exit(0);
}

// Extract positional arg (project path)
const positional = args.filter((a) => !a.startsWith("--"));
const projectPath = positional[0] || process.cwd();

// Parse flags
const getFlag = (name: string): string | undefined => {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
};

const isJson = args.includes("--json");
const isCi = args.includes("--ci");
const commit = getFlag("commit") || "unknown";
const branch = getFlag("branch");
const policy = getFlag("policy");
const language = getFlag("language");

const ctx: TrustEvaluationContext = {
  projectPath: path.resolve(projectPath),
  projectName: path.basename(path.resolve(projectPath)),
  commit,
  branch,
  policyName: policy,
  language,
};

try {
  const decision = await evaluateTrust(ctx);

  if (isJson) {
    console.log(formatTrustJSON(decision));
  } else if (isCi) {
    console.log(formatTrustCI(decision));
  } else {
    console.log(formatTrustTerminal(decision));
  }

  // Exit code reflects decision
  process.exit(ciExitCode(decision));
} catch (e: any) {
  console.error(`❌ Trust evaluation failed: ${e.message}`);
  process.exit(3);
}
}

main();
