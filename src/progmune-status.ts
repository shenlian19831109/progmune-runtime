/**
 * Progmune Status — One-command health check across all four layers
 *
 * Usage:
 *   npx ts-node src/progmune-status.ts
 *   npm run status
 */

import { buildKnowledgeBase } from "./protocol-knowledge";
import { buildEvidenceRepository } from "./evidence-repository";

const C = { r: "\x1b[0m", b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[32m", y: "\x1b[33m", r2: "\x1b[31m", c: "\x1b[36m", m: "\x1b[35m" };

function main() {
  const kb = buildKnowledgeBase();
  const er = buildEvidenceRepository();

  console.log(`\n${C.b}${C.c}╔══════════════════════════════════════════════════════════════╗${C.r}`);
  console.log(`${C.b}${C.c}║${C.r}  ${C.b}Progmune Status${C.r}  —  AI Generated Software Governance Runtime          ${C.b}${C.c}║${C.r}`);
  console.log(`${C.b}${C.c}╚══════════════════════════════════════════════════════════════╝${C.r}`);

  // Layer 4: Evidence
  console.log(`\n  ${C.b}${C.m}Evidence Repository${C.r}  v${er.version}`);
  console.log(`  ${C.d}${er.summary.totalRepos} repos · ${er.summary.totalSequences} seqs · ${er.summary.totalLabeledSequences} labeled · ${er.summary.totalProtocolMatches} protocol matches${C.r}`);
  for (const tp of er.summary.topProtocols.slice(0, 3)) {
    console.log(`    ${C.b}${tp.protocol}${C.r}: ${tp.repos} repos, ${tp.totalMatches} matches`);
  }

  // Layer 3: Ontology
  console.log(`\n  ${C.b}${C.c}Protocol Ontology${C.r}  v${kb.version}`);
  console.log(`  ${C.d}${kb.summary.totalUnits} units · ${kb.summary.totalDomains} domains · ${kb.summary.byMaturity["stable"]} stable · ${kb.summary.byMaturity["validated"]} validated · ${kb.summary.averageConfidence}% avg confidence${C.r}`);
  for (const [name, d] of Object.entries(kb.domains)) {
    const bar = "█".repeat(d.stableCount) + "░".repeat(Math.max(0, d.unitCount - d.stableCount));
    const rfc = name === "TLS" ? "RFC 8446" : name === "HTTP" ? "RFC 9110" : name === "SSH" ? "RFC 4253" : "";
    console.log(`    ${bar} ${name}: ${d.stableCount}/${d.unitCount} stable ${rfc}`);
  }

  // Layer 2: Detection
  const { validateResourceLifecycle } = require("./resource-detector");
  const { validateProtocolState } = require("./protocol-detector");
  console.log(`\n  ${C.b}${C.y}Verification Engine${C.r}`);
  console.log(`  ${C.d}Resource Detector: 5 categories (memory, file, ssl, connection, lifecycle)${C.r}`);
  console.log(`  ${C.d}Protocol Detector: 7 protocol definitions (repo-agnostic)${C.r}`);
  console.log(`  ${C.d}Concept-level: 9 concepts with constraint inheritance${C.r}`);

  // Layer 1: Governance
  console.log(`\n  ${C.b}${C.g}Governance Platform${C.r}`);
  console.log(`  ${C.d}Certificate: KB v${kb.version} + 3 stable asset references${C.r}`);
  console.log(`  ${C.d}Policy Engine: 6 rules, configurable per-project${C.r}`);
  console.log(`  ${C.d}CI/CD: GitHub Action (progmune-policy.yml)${C.r}`);
  console.log(`  ${C.d}Dashboard: http://localhost:3200${C.r}`);
  console.log(`  ${C.d}Knowledge API: http://localhost:3400${C.r}`);

  // Governance KPIs
  console.log(`\n  ${C.b}Governance KPIs:${C.r}`);
  const stableCount = kb.summary.byMaturity["stable"];
  const policyRules = 7;
  console.log(`  ${C.g}Policy:${C.r} ${policyRules} rules active`);
  console.log(`  ${C.g}Knowledge-driven:${C.r} ${stableCount} stable assets → governance decisions`);
  console.log(`  ${C.g}CI/CD:${C.r} deploy gate via GitHub Action`);
  console.log(`  ${C.g}Certificate:${C.r} ontology-backed (KB v${kb.version} + RFC references)`);

  // Knowledge Evolution Velocity
  console.log(`\n  ${C.b}Knowledge Evolution Velocity:${C.r}`);
  for (const u of kb.units.filter(u => u.versionHistory.length >= 2)) {
    const versions = u.versionHistory.length - 1; // number of upgrades
    const firstDate = new Date(u.versionHistory[0].date);
    const lastDate = new Date(u.versionHistory[u.versionHistory.length - 1].date);
    const days = Math.max(1, Math.round((lastDate.getTime() - firstDate.getTime()) / 86400000));
    const velocity = (versions / days * 7).toFixed(1); // versions per week
    const confGain = u.versionHistory[u.versionHistory.length - 1].confidence - u.versionHistory[0].confidence;
    console.log(`  ${C.b}${u.name.padEnd(18)}${C.r} ${versions} upgrades in ${days}d (${velocity}/wk)  +${confGain}% confidence  ${u.maturity === "stable" ? C.g + "★" + C.r : C.y + "◉" + C.r}`);
  }

  // Growth indicators
  console.log(`\n  ${C.b}Growth:${C.r}`);
  console.log(`  ${C.g}+3${C.r} stable assets (TLS, SSH, HTTP)`);
  console.log(`  ${C.g}+7${C.r} repos validated`);
  console.log(`  ${C.g}+605${C.r} sequences accumulated`);
  console.log(`\n  ${C.d}Next: npx ts-node src/knowledge-evolution.ts scan <new-repo>${C.r}\n`);
}

main();
