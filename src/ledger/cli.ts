/**
 * Phase 9: Provenance CLI
 *
 * Usage:
 *   npx ts-node src/ledger/cli.ts replay <sessionId>
 *   npx ts-node src/ledger/cli.ts --json <sessionId>
 */

import { buildProvenanceChain } from "./chain-builder";
import type { ProvenanceChain, ProvenanceEvent } from "./types";

// ANSI colors — must be defined before any function that uses them
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
};

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  console.log(`
Progmune Provenance CLI

Usage:
  npx ts-node src/ledger/cli.ts replay <sessionId>
  npx ts-node src/ledger/cli.ts --json <sessionId>

Examples:
  npx ts-node src/ledger/cli.ts replay sess_abc123
  npx ts-node src/ledger/cli.ts --json sess_abc123
  `);
  process.exit(0);
}

const useJson = args.includes("--json");
const sessionId = args.find((a) => a !== "replay" && a !== "--json" && !a.startsWith("--"));

if (!sessionId) {
  console.error("❌ sessionId required. Use --help for usage.");
  process.exit(1);
}

try {
  const chain = buildProvenanceChain(sessionId);

  if (useJson) {
    console.log(JSON.stringify(chain, null, 2));
  } else {
    console.log(formatChainTerminal(chain));
  }
} catch (e: any) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}

// ── Terminal Formatter ──

function stepLabel(step: string): string {
  const labels: Record<string, string> = {
    generation: `${C.cyan}gen${C.reset}    `,
    validation: `${C.yellow}val${C.reset}    `,
    repair: `${C.red}repair${C.reset}  `,
    approval: `${C.green}approve${C.reset} `,
    deploy: `${C.bold}deploy${C.reset}  `,
  };
  return labels[step] || step.padEnd(8);
}

function resultIcon(r: string): string {
  if (r === "passed" || r === "approved") return `${C.green}✓${C.reset}`;
  if (r === "failed") return `${C.red}✗${C.reset}`;
  return `${C.yellow}↻${C.reset}`;
}

function formatChainTerminal(chain: ProvenanceChain): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`${C.bold}${C.cyan}Provenance Chain${C.reset}`);
  lines.push(`  Session:     ${chain.sessionId}`);
  lines.push(`  Intent:      ${chain.intent}`);
  lines.push(`  Integrity:   ${chain.integrity === "intact" ? `${C.green}INTACT${C.reset}` : `${C.red}BROKEN${C.reset}`}`);
  lines.push(`  Chain hash:  ${C.bold}${chain.chainHash}${C.reset}  ${C.dim}(root — tampering breaks this)${C.reset}`);
  lines.push(`  Ledger:      ${chain.finalLedgerHash} (stored: ${chain.storedFingerprintHash || "none"})`);
  lines.push(`  Stats:       ${chain.totalTransitions} transitions (${chain.validTransitions} valid, ${chain.invalidTransitions} invalid), ${chain.repairCount} repairs`);
  lines.push("");

  // Header
  lines.push(`  ${C.dim}idx step      result  artifact                     eventHash       prevHash${C.reset}`);
  lines.push(`  ${C.dim}─── ────────  ──────  ──────────────────────────── ──────────────── ────────────────${C.reset}`);

  for (let i = 0; i < chain.events.length; i++) {
    const e = chain.events[i];
    const prev = e.prevHash ? e.prevHash.slice(0, 14) : "· (genesis)";
    lines.push(
      `  ${String(i).padStart(2, "0")}  ${stepLabel(e.step)} ${resultIcon(e.result)} ${e.artifact.padEnd(28).slice(0, 28)} ${e.hash} ${C.dim}←${prev}${C.reset}`
    );
    if (e.detail) {
      lines.push(`       ${C.dim}${e.detail.slice(0, 80)}${C.reset}`);
    }
  }

  lines.push("");
  lines.push(`  ${C.dim}Chain: ${chain.events.map(e => e.hash).join(" → ")}${C.reset}`);
  lines.push(`  ${C.dim}Root:  ${chain.chainHash}${C.reset}`);
  lines.push("");

  return lines.join("\n");
}
