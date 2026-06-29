/**
 * Knowledge Flywheel — Self-reinforcing knowledge growth pipeline
 *
 * Repo → Scan → Evidence → Confidence → Version Suggestion → Human Review → Merge
 *                                 ↑                                                │
 *                                 └──────────── More Repos ←────────────────────────┘
 *
 * Usage:
 *   npx ts-node src/knowledge-flywheel.ts scan benchmarks/nginx
 *   npx ts-node src/knowledge-flywheel.ts status
 *   npx ts-node src/knowledge-flywheel.ts metrics
 */

import * as fs from "fs";
import * as path from "path";
import { validateProtocolState } from "./protocol-detector";
import { buildKnowledgeBase } from "./protocol-knowledge";
import type { KnowledgeUnit, KnowledgeDebt, Hypothesis } from "./protocol-knowledge";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface FlywheelProposal {
  id: string;
  repo: string;
  timestamp: string;
  unitId: string;
  unitName: string;
  currentVersion: string;
  proposedVersion: string;
  currentConfidence: number;
  proposedConfidence: number;
  evidenceCount: number;
  matchRate: string;
  suggestion: "promote" | "bump" | "evidence_only" | "insufficient";
  reason: string;
  status: "pending" | "accepted" | "rejected";
}

interface FlywheelMetrics {
  totalScans: number;
  totalProposals: number;
  acceptedProposals: number;
  rejectedProposals: number;
  pendingProposals: number;
  knowledgeVelocity: number;    // proposals per scan
  averageConfidenceGain: number;
  reposScanned: string[];
  history: FlywheelProposal[];
}

// ═══════════════════════════════════════════════════════════════
// Scanner
// ═══════════════════════════════════════════════════════════════

const PROPOSALS_DIR = ".progmune_corpus/flywheel";

export function scanRepo(repoPath: string): FlywheelProposal[] {
  const repoName = path.basename(repoPath);
  const seqFile = path.join(path.dirname(repoPath), `${repoName}-sequences.json`);
  if (!fs.existsSync(seqFile)) throw new Error(`No sequences: ${seqFile}`);

  const sequences = JSON.parse(fs.readFileSync(seqFile, "utf-8"));
  const kb = buildKnowledgeBase();
  const proposals: FlywheelProposal[] = [];

  // Match sequences against KB
  const matchCounts: Record<string, number> = {};
  for (const seq of sequences.slice(0, 50)) {
    const result = validateProtocolState(seq.calls || []);
    for (const p of result.matchedProtocols) matchCounts[p] = (matchCounts[p] || 0) + 1;
  }

  for (const [proto, count] of Object.entries(matchCounts)) {
    const unit = kb.units.find(u => u.name === proto);
    if (!unit || count < 3) continue;

    const alreadyEvidenced = (unit.evidence || []).some(e => e.repo === repoName);
    if (alreadyEvidenced) continue;

    let suggestion: FlywheelProposal["suggestion"];
    let proposedVersion = unit.currentVersion;
    let proposedConf = unit.confidence;
    let reason = "";

    if (count >= 10 && unit.maturity !== "stable") {
      // Enough evidence to promote
      suggestion = "promote";
      const [major, minor] = unit.currentVersion.split(".").map(Number);
      proposedVersion = `${major + 1}.0.0`;
      proposedConf = Math.min(95, unit.confidence + 15);
      reason = `${count}/50 sequences matched — strong evidence for promotion to stable. Would add ${repoName} as ${(unit.validatedRepos.length + 1)}th validated repo.`;
    } else if (count >= 5 && unit.confidence < 80) {
      suggestion = "bump";
      const [major, minor, patch] = unit.currentVersion.split(".").map(Number);
      proposedVersion = `${major}.${minor}.${(patch || 0) + 1}`;
      proposedConf = Math.min(90, unit.confidence + 8);
      reason = `${count}/50 sequences matched — confidence bump warranted.`;
    } else if (count >= 3) {
      suggestion = "evidence_only";
      proposedConf = Math.min(90, unit.confidence + 3);
      reason = `${count}/50 matched — evidence addition only. Confidence +3%.`;
    } else {
      suggestion = "insufficient";
      reason = `Only ${count}/50 matched — insufficient for any action.`;
    }

    const proposal: FlywheelProposal = {
      id: `FLY-${Date.now().toString(36)}-${unit.id}`,
      repo: repoName,
      timestamp: new Date().toISOString(),
      unitId: unit.id,
      unitName: unit.name,
      currentVersion: unit.currentVersion,
      proposedVersion,
      currentConfidence: unit.confidence,
      proposedConfidence: proposedConf,
      evidenceCount: count,
      matchRate: `${count}/50`,
      suggestion,
      reason,
      status: "pending",
    };

    proposals.push(proposal);
  }

  // Save proposals
  if (!fs.existsSync(PROPOSALS_DIR)) fs.mkdirSync(PROPOSALS_DIR, { recursive: true });
  for (const p of proposals) {
    fs.writeFileSync(path.join(PROPOSALS_DIR, `${p.id}.json`), JSON.stringify(p, null, 2));
  }

  // Update metrics
  updateMetrics(repoName, proposals);

  return proposals.sort((a, b) => b.evidenceCount - a.evidenceCount);
}

// ═══════════════════════════════════════════════════════════════
// Metrics
// ═══════════════════════════════════════════════════════════════

const METRICS_FILE = ".progmune_corpus/flywheel-metrics.json";

export function loadMetrics(): FlywheelMetrics {
  try { return JSON.parse(fs.readFileSync(METRICS_FILE, "utf-8")); } catch {
    return { totalScans: 0, totalProposals: 0, acceptedProposals: 0, rejectedProposals: 0, pendingProposals: 0, knowledgeVelocity: 0, averageConfidenceGain: 0, reposScanned: [], history: [] };
  }
}

function updateMetrics(repo: string, proposals: FlywheelProposal[]): void {
  const m = loadMetrics();
  if (!m.reposScanned.includes(repo)) m.reposScanned.push(repo);
  m.totalScans++;
  m.totalProposals += proposals.length;
  m.pendingProposals += proposals.filter(p => p.suggestion !== "insufficient").length;
  m.history.push(...proposals);
  if (m.totalScans > 0) m.knowledgeVelocity = Math.round((m.totalProposals / m.totalScans) * 10) / 10;
  m.averageConfidenceGain = m.history.filter(p => p.suggestion !== "insufficient").reduce((s, p) => s + (p.proposedConfidence - p.currentConfidence), 0) / Math.max(1, m.history.filter(p => p.suggestion !== "insufficient").length);
  if (!fs.existsSync(".progmune_corpus")) fs.mkdirSync(".progmune_corpus");
  fs.writeFileSync(METRICS_FILE, JSON.stringify(m, null, 2));
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

if (require.main === module) {
  const args = process.argv.slice(2);
  const C = { r: "\x1b[0m", b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[32m", y: "\x1b[33m", r2: "\x1b[31m", c: "\x1b[36m" };

  if (args[0] === "scan" && args[1]) {
    console.error(`\n${C.b}${C.c}Flywheel: Scanning ${args[1]}${C.r}\n`);
    const proposals = scanRepo(args[1]);
    const actionable = proposals.filter(p => p.suggestion !== "insufficient");
    for (const p of proposals) {
      const icon = p.suggestion === "promote" ? "⭐" : p.suggestion === "bump" ? "📈" : p.suggestion === "evidence_only" ? "✅" : "—";
      console.log(`  ${icon} ${p.unitName}: ${p.matchRate} → ${p.suggestion}`);
      console.log(`     v${p.currentVersion} → v${p.proposedVersion} | ${p.currentConfidence}% → ${p.proposedConfidence}%`);
      console.log(`     ${p.reason}`);
      if (p.suggestion !== "insufficient") console.log(`     ${C.d}Review: ${PROPOSALS_DIR}/${p.id}.json${C.r}`);
    }
    if (actionable.length > 0) {
      console.log(`\n  ${C.g}${actionable.length} actionable proposal(s) saved.${C.r}`);
      console.log(`  ${C.d}Review proposals in ${PROPOSALS_DIR}/ and accept to grow Knowledge Base.${C.r}`);
    }
    console.log("");

  } else if (args[0] === "status") {
    const m = loadMetrics();
    console.log(`\n${C.b}${C.c}Knowledge Flywheel${C.r}\n`);
    console.log(`  Scans:     ${m.totalScans} repos (${m.reposScanned.join(", ") || "none"})`);
    console.log(`  Proposals: ${m.totalProposals} total, ${m.acceptedProposals} accepted, ${m.rejectedProposals} rejected, ${m.pendingProposals} pending`);
    console.log(`  Velocity:  ${m.knowledgeVelocity} proposals/scan`);
    console.log(`  Avg Gain:  +${m.averageConfidenceGain.toFixed(1)}% confidence per proposal`);
    const recent = m.history.slice(-5);
    if (recent.length > 0) {
      console.log(`\n  Recent proposals:`);
      for (const p of recent) {
        const icon = p.status === "accepted" ? C.g + "✓" : p.status === "rejected" ? C.r2 + "✗" : C.y + "⏳";
        console.log(`  ${icon}${C.r} ${p.unitName}: ${p.matchRate} → ${p.suggestion} (${p.repo})`);
      }
    }
    console.log("");

  } else if (args[0] === "debt") {
    const kb = buildKnowledgeBase();
    console.log(`\n${C.b}${C.c}Knowledge Debt Dashboard${C.r}\n`);
    for (const u of kb.units.filter(u => u.maturity === "stable" || u.maturity === "validated")) {
      const b = u.confidenceBreakdown;
      if (!b) continue;
      const sDebt = 100 - b.structural;
      const cDebt = 100 - b.crossRepo;
      const dDebt = 100 - b.deployment;
      const total = Math.round(sDebt * 0.3 + cDebt * 0.3 + dDebt * 0.4);
      const bar = "█".repeat(Math.min(10, Math.round(total / 10))) + "░".repeat(Math.max(0, 10 - Math.round(total / 10)));
      const rec = dDebt > 30 ? "Need more deployment observations" : sDebt > 10 ? "Refine state machine" : "Healthy";
      console.log(`  ${bar} ${C.b}${u.name}${C.r}  Debt: ${total}%`);
      console.log(`     Structural:  ${b.structural}% (gap: ${sDebt}%)  |  Cross-Repo: ${b.crossRepo}% (gap: ${cDebt}%)  |  Deployment: ${b.deployment}% (gap: ${dDebt}%)`);
      console.log(`     → ${rec}`);
    }
    console.log(`\n  ${C.d}Debt = weighted gap from 100%. Fix deployment debt first — it's the weakest link.${C.r}\n`);

  } else if (args[0] === "roi") {
    const m = loadMetrics();
    const kb = buildKnowledgeBase();
    console.log(`\n${C.b}${C.c}Knowledge ROI Report${C.r}\n`);
    console.log(`  Flywheel Stats:`);
    console.log(`    Scans:        ${m.totalScans} repos`);
    console.log(`    Proposals:    ${m.totalProposals} generated, ${m.acceptedProposals} accepted`);
    console.log(`    Velocity:     ${m.knowledgeVelocity} proposals/scan`);
    console.log(`    Avg Gain:     +${m.averageConfidenceGain.toFixed(1)}% per proposal`);
    console.log(`\n  Knowledge Growth:`);
    const stableCount = kb.units.filter(u => u.maturity === "stable").length;
    console.log(`    Stable Units: ${stableCount} (from 0)`);
    console.log(`    Repos:        ${kb.summary.totalValidatedRepos} validated`);
    console.log(`    Evidence:     ${kb.summary.totalValidatedSequences} sequences`);
    console.log(`\n  Per-Unit ROI:`);
    for (const u of kb.units.filter(u => u.maturity === "stable")) {
      const breakdown = u.confidenceBreakdown;
      console.log(`    ${C.b}${u.name}${C.r} v${u.currentVersion}`);
      if (breakdown) {
        console.log(`      Structural:  ${breakdown.structural}%  (state machine stability)`);
        console.log(`      Cross-Repo:  ${breakdown.crossRepo}%  (multi-repo validation)`);
        console.log(`      Deployment:  ${breakdown.deployment}%  (real-world acceptance)`);
      }
      const obs = u.observations?.length || 0;
      console.log(`      Observations: ${obs} deployment feedback events`);
    }
    console.log(`\n  ${C.d}Flywheel: ${m.totalScans} scans → ${m.totalProposals} proposals → ${m.acceptedProposals} accepted → ${stableCount} stable → +${m.averageConfidenceGain.toFixed(1)}% avg confidence${C.r}\n`);

  } else if (args[0] === "metrics") {
    console.log(JSON.stringify(loadMetrics(), null, 2));

  } else {
    console.log(`
${C.b}Knowledge Flywheel${C.r}

${C.d}Usage:${C.r}
  npx ts-node src/knowledge-flywheel.ts scan <repoPath>
      Scan a repo and generate evidence proposals

  npx ts-node src/knowledge-flywheel.ts status
      View flywheel metrics and recent proposals

  npx ts-node src/knowledge-flywheel.ts metrics
      Export full metrics as JSON

${C.d}The Flywheel:${C.r}
  Repo → Scan → Evidence → Confidence → Version → Review → Merge
      ↑                                                      │
      └──────────────── More Repos ←─────────────────────────┘
    `);
  }
}
