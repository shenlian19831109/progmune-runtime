/**
 * Phase 9-10: Provenance & Accountability CLI
 *
 * Usage:
 *   npx ts-node src/ledger/cli.ts replay <sessionId>
 *   npx ts-node src/ledger/cli.ts accountability <sessionId>
 *   npx ts-node src/ledger/cli.ts accountability <sessionId> --author alice@example.com
 *   npx ts-node src/ledger/cli.ts --json replay <sessionId>
 */

import { buildProvenanceChain } from "./chain-builder";
import { buildAccountabilityChain, verifyAccountabilityChain } from "./accountability";
import type { HumanActor } from "./accountability";
import type {
  ProvenanceChain,
  ProvenanceEvent,
  AccountabilityChain,
  AccountabilityEvent,
} from "./types";

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", cyan: "\x1b[36m",
  yellow: "\x1b[33m", magenta: "\x1b[35m", blue: "\x1b[34m",
};

const args = process.argv.slice(2);

// ── Help ──

if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  console.log(`
Progmune Provenance & Accountability CLI

Usage:
  npx ts-node src/ledger/cli.ts replay <sessionId>
  npx ts-node src/ledger/cli.ts accountability <sessionId> [options]

Options (accountability):
  --author <email>     Human who initiated generation
  --reviewer <email>   Human who reviewed (repeatable)
  --approver <email>   Human who approved deployment
  --deployer <id>      CI/CD system that deployed
  --json               Output as JSON

Examples:
  npx ts-node src/ledger/cli.ts replay sess_abc123
  npx ts-node src/ledger/cli.ts accountability sess_abc123
  npx ts-node src/ledger/cli.ts accountability sess_abc123 \\
    --author alice@example.com --reviewer bob@example.com --deployer github-actions
  `);
  process.exit(0);
}

// ── Parse ──

const useJson = args.includes("--json");
const cmd = args[0]; // "replay" | "accountability"
const sessionId = args[1]?.startsWith("--") ? undefined : args[1];

// Parse actor options
function parseHumanOpt(flag: string): HumanActor | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0 || !args[idx + 1] || args[idx + 1].startsWith("--")) return undefined;
  const email = args[idx + 1];
  return { id: email, name: email.split("@")[0], role: flag.slice(2) };
}

const author = parseHumanOpt("--author");
const reviewer = parseHumanOpt("--reviewer");
const approver = parseHumanOpt("--approver");
const deployerOpt = (() => {
  const idx = args.indexOf("--deployer");
  if (idx < 0 || !args[idx + 1]) return undefined;
  const id = args[idx + 1];
  return { id, name: id };
})();

// ── Dispatch ──

if (cmd === "replay") {
  if (!sessionId) { console.error("❌ sessionId required"); process.exit(1); }
  try {
    const chain = buildProvenanceChain(sessionId);
    console.log(useJson ? JSON.stringify(chain, null, 2) : formatProvenanceChain(chain));
  } catch (e: any) { console.error(`❌ ${e.message}`); process.exit(1); }

} else if (cmd === "accountability") {
  if (!sessionId) { console.error("❌ sessionId required"); process.exit(1); }
  try {
    const chain = buildAccountabilityChain(sessionId, {
      author,
      reviewers: reviewer ? [reviewer] : undefined,
      approver,
      deployer: deployerOpt,
    });
    if (useJson) {
      console.log(JSON.stringify(chain, null, 2));
    } else {
      console.log(formatAccountabilityChain(chain));
    }
  } catch (e: any) { console.error(`❌ ${e.message}`); process.exit(1); }

} else {
  console.error(`❌ Unknown command: ${cmd}. Use "replay" or "accountability".`);
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════
//  Provenance Chain Formatter
// ═══════════════════════════════════════════════════════════════

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

function formatProvenanceChain(chain: ProvenanceChain): string {
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

  lines.push(`  ${C.dim}idx step      result  artifact                     eventHash       prevHash${C.reset}`);
  lines.push(`  ${C.dim}─── ────────  ──────  ──────────────────────────── ──────────────── ────────────────${C.reset}`);

  for (let i = 0; i < chain.events.length; i++) {
    const e = chain.events[i];
    const prev = e.prevHash ? e.prevHash.slice(0, 14) : "· (genesis)";
    lines.push(
      `  ${String(i).padStart(2, "0")}  ${stepLabel(e.step)} ${resultIcon(e.result)} ${e.artifact.padEnd(28).slice(0, 28)} ${e.hash} ${C.dim}←${prev}${C.reset}`
    );
    if (e.detail) lines.push(`       ${C.dim}${e.detail.slice(0, 80)}${C.reset}`);
  }

  lines.push("");
  lines.push(`  ${C.dim}Chain: ${chain.events.map(e => e.hash).join(" → ")}${C.reset}`);
  lines.push(`  ${C.dim}Root:  ${chain.chainHash}${C.reset}`);
  lines.push("");
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
//  Accountability Chain Formatter
// ═══════════════════════════════════════════════════════════════

function actorTypeIcon(t: string): string {
  const icons: Record<string, string> = {
    human: `${C.blue}👤${C.reset}`,
    llm: `${C.magenta}🤖${C.reset}`,
    validator: `${C.cyan}⚙${C.reset}`,
    reviewer: `${C.green}✅${C.reset}`,
    deployer: `${C.bold}🚀${C.reset}`,
  };
  return icons[t] || "  ";
}

function formatAccountabilityChain(chain: AccountabilityChain): string {
  const lines: string[] = [];
  const integrityIcon = chain.integrity === "intact"
    ? `${C.green}INTACT${C.reset}`
    : `${C.red}BROKEN${C.reset}`;
  const custodyIcon = chain.custodyGap
    ? `${C.yellow}⚠ GAPS DETECTED${C.reset}`
    : `${C.green}VERIFIED${C.reset}`;

  lines.push("");
  lines.push(`${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
  lines.push(`${C.bold}${C.cyan}║${C.reset}  ${C.bold}Accountability Ledger — AI Code Supply Chain${C.reset}                    ${C.bold}${C.cyan}║${C.reset}`);
  lines.push(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════════╝${C.reset}`);
  lines.push("");
  lines.push(`  Session:       ${chain.sessionId}`);
  lines.push(`  Intent:        ${chain.intent}`);
  lines.push(`  Chain hash:    ${C.bold}${chain.chainHash}${C.reset}`);
  lines.push(`  Integrity:     ${integrityIcon}`);
  lines.push(`  Custody:       ${custodyIcon}`);
  const signed = chain.events.filter(e => e.signature).length;
  const sigIcon = signed > 0 ? `${C.green}${signed} signed${C.reset}` : `${C.dim}unsigned${C.reset}`;
  lines.push(`  Signatures:    ${sigIcon}  /  ${chain.totalEvents} events`);
  lines.push(`  Actors:        ${C.blue}${chain.humanEvents} human${C.reset}  ${C.magenta}${chain.aiEvents} AI${C.reset}  ${C.cyan}${chain.automatedEvents} automated${C.reset}`);
  lines.push("");

  // Chain visualization
  lines.push(`  ${C.dim}── AI Code Supply Chain ──${C.reset}`);
  lines.push("");

  for (let i = 0; i < chain.events.length; i++) {
    const e = chain.events[i];
    const icon = actorTypeIcon(e.actorType);
    const actorColor = e.actorType === "human" || e.actorType === "reviewer" ? C.blue
      : e.actorType === "llm" ? C.magenta : C.cyan;

    lines.push(
      `  ${String(i).padStart(2, "0")} ${icon} ${actorColor}${e.actorLabel.padEnd(38).slice(0, 38)}${C.reset} ${resultIcon(e.result)} ${e.action.slice(0, 30)}`
    );
    lines.push(`     ${C.dim}hash: ${e.hash} ← ${e.prevHash ? e.prevHash.slice(0, 14) : "genesis"}${C.reset}`);

    // Connector between events
    if (i < chain.events.length - 1) {
      const nextType = chain.events[i + 1].actorType;
      const connector = e.actorType !== nextType
        ? `${C.yellow}  │   responsibility handoff${C.reset}`
        : `${C.dim}  │${C.reset}`;
      lines.push(connector);
    }
  }

  lines.push("");

  // Custody gap warning
  if (chain.custodyGap) {
    lines.push(`  ${C.yellow}⚠️  Custody gaps detected — some actors could not be verified.${C.reset}`);
    lines.push(`  ${C.dim}→ Use --author, --reviewer, --approver flags to identify human actors.${C.reset}`);
    lines.push("");
  }

  // Root hash
  lines.push(`  ${C.dim}Root: ${chain.chainHash}${C.reset}`);
  lines.push(`  ${C.dim}${chain.totalEvents} events · ${chain.humanEvents} human · ${chain.aiEvents} AI · ${chain.automatedEvents} automated${C.reset}`);
  lines.push("");

  return lines.join("\n");
}
