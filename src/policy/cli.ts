/**
 * Phase 11: Policy Engine CLI
 *
 * Usage:
 *   npx ts-node src/policy/cli.ts check <file.ts>
 *   npx ts-node src/policy/cli.ts check <file.ts> --author alice@example.com
 *   npx ts-node src/policy/cli.ts check <file.ts> --json
 */

import { certify } from "../certify";
import { buildAccountabilityChain } from "../ledger/accountability";
import { evaluatePolicy, loadPolicyConfig } from "./engine";
import type { PolicyContext } from "./engine";
import type { HumanActor } from "../ledger/accountability";

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  console.log(`
Progmune Policy Engine — Deploy Gate

Usage:
  npx ts-node src/policy/cli.ts check <file.ts> [options]

Options:
  --author <email>     Human who initiated generation
  --reviewer <email>   Human reviewer
  --policy <path>      Policy config file (default: .progmune-policy.json)
  --json               Output as JSON

Examples:
  npx ts-node src/policy/cli.ts check src/server.ts
  npx ts-node src/policy/cli.ts check src/server.ts --author alice@example.com
  npx ts-node src/policy/cli.ts check src/server.ts --json
  `);
  process.exit(0);
}

const cmd = args[0];
const filePath = args[1];

function parseHumanOpt(flag: string): HumanActor | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0 || !args[idx + 1] || args[idx + 1].startsWith("--")) return undefined;
  const email = args[idx + 1];
  return { id: email, name: email.split("@")[0], role: flag.slice(2) };
}

const useJson = args.includes("--json");
const author = parseHumanOpt("--author");
const reviewer = parseHumanOpt("--reviewer");
const policyIdx = args.indexOf("--policy");
const policyPath = policyIdx >= 0 ? args[policyIdx + 1] : undefined;

if (cmd !== "check" || !filePath) {
  console.error("❌ Usage: npx ts-node src/policy/cli.ts check <file.ts>");
  process.exit(1);
}

// 1. Certify the file
const cert = certify(filePath);

// 2. Build accountability chain
let acct;
try {
  acct = buildAccountabilityChain(cert.sessionId, {
    author,
    reviewers: reviewer ? [reviewer] : undefined,
  });
} catch {
  // Accountability unavailable — policy will flag human_review violations
}

// 3. Load policy (from project config or defaults)
const projectDir = process.env.PROGMUNE_PROJECT_DIR || process.cwd();
const { rules, source } = loadPolicyConfig(projectDir, policyPath);

// 4. Evaluate policy
const ctx: PolicyContext = {
  certificate: {
    validated: cert.validated,
    confidence: cert.confidence,
    provenanceIntact: cert.provenanceIntact,
    fingerprint: cert.fingerprint,
    violations: cert.violations,
    plsbCoverage: cert.plsbCoverage,
    plsbRecall: cert.plsbRecall,
    degraded: cert.degraded,
    sessionId: cert.sessionId,
    file: cert.file,
  },
  accountability: acct ? {
    humanEvents: acct.humanEvents,
    aiEvents: acct.aiEvents,
    automatedEvents: acct.automatedEvents,
    custodyGap: acct.custodyGap,
  } : undefined,
};

const result = evaluatePolicy(ctx, rules);

if (useJson) {
  console.log(JSON.stringify({ ...result, policySource: source }, null, 2));
} else {
  console.log(formatPolicyResult(result, cert.file, source));
}

process.exit(result.passed ? 0 : 1);

// ── Formatter ──

function formatPolicyResult(result: import("./types").PolicyResult, file: string, policySource?: string): string {
  const lines: string[] = [];

  const verdictColor = result.verdict === "ALLOW" ? C.green
    : result.verdict === "WARN" ? C.yellow : C.red;

  const box = result.verdict === "ALLOW" ? "✅"
    : result.verdict === "WARN" ? "⚠️ " : "❌";

  lines.push("");
  lines.push(`${C.bold}${C.cyan}╔════════════════════════════════════════════════════╗${C.reset}`);
  lines.push(`${C.bold}${C.cyan}║${C.reset}  ${C.bold}Policy Engine — Deploy Gate${C.reset}                         ${C.bold}${C.cyan}║${C.reset}`);
  lines.push(`${C.bold}${C.cyan}╚════════════════════════════════════════════════════╝${C.reset}`);
  lines.push("");
  lines.push(`  File:     ${file}`);
  lines.push(`  Policy:   ${C.dim}${policySource || "built-in defaults"}${C.reset}`);
  lines.push(`  Verdict:  ${verdictColor}${C.bold}${box} ${result.verdict}${C.reset}`);
  lines.push(`  Rules:    ${C.green}${result.passed_rules} passed${C.reset}, ${result.failed_rules > 0 ? C.red : ""}${result.failed_rules} failed${C.reset} / ${result.rules} total`);
  lines.push("");

  if (result.violations.length > 0) {
    lines.push(`  ${C.bold}Violations:${C.reset}`);
    for (const v of result.violations) {
      const sev = v.rule.severity === "block" ? `${C.red}BLOCK${C.reset}` : `${C.yellow}WARN${C.reset}`;
      const ruleName = v.rule.type;
      lines.push(`    ${sev}  ${ruleName.padEnd(16)} ${v.actual} → expected ${v.expected}`);
      if (v.detail) {
        lines.push(`         ${C.dim}${v.detail.slice(0, 90)}${C.reset}`);
      }
    }
    lines.push("");
  }

  lines.push(`  ${result.summary}`);
  lines.push("");

  return lines.join("\n");
}
