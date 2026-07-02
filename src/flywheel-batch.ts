/**
 * P3: Batch Flywheel Runner
 *
 * Scans all benchmark repos with sequence files, auto-generates proposals,
 * and produces a Flywheel Health Dashboard with operational metrics.
 *
 * Usage:
 *   npx ts-node --transpile-only src/flywheel-batch.ts
 *   npx ts-node --transpile-only src/flywheel-batch.ts --auto-accept
 *   npx ts-node --transpile-only src/flywheel-batch.ts --repos curl,libssh
 */

import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface ScanResult {
  repo: string;
  status: "scanned" | "no_sequences" | "error";
  error?: string;
  proposals: number;
  accepted: number;
  rejected: number;
  topMatches: Array<{ unit: string; count: number }>;
}

interface FlywheelDashboard {
  generated: string;
  totalReposScanned: number;
  reposWithProposals: number;
  totalProposals: number;
  acceptedProposals: number;
  rejectedProposals: number;
  pendingProposals: number;
  knowledgeVelocity: number;       // proposals per scan
  totalConfidenceGained: number;   // sum of confidence gains
  byRepo: ScanResult[];
  assessment: string;
  recommendations: string[];
}

// ═══════════════════════════════════════════════════════════════
// Repo Scanner
// ═══════════════════════════════════════════════════════════════

const BENCHMARKS_DIR = path.resolve(process.cwd(), "benchmarks");
const PROPOSALS_DIR = path.resolve(process.cwd(), ".progmune_corpus", "flywheel");

function scanRepo(repoName: string, autoAccept: boolean = false): ScanResult {
  const seqFile = path.join(BENCHMARKS_DIR, `${repoName}-sequences.json`);

  if (!fs.existsSync(seqFile)) {
    // Try alternate names
    const altFile = path.join(BENCHMARKS_DIR, `${repoName}-manual-sequences.json`);
    if (!fs.existsSync(altFile)) {
      return { repo: repoName, status: "no_sequences", proposals: 0, accepted: 0, rejected: 0, topMatches: [] };
    }
  }

  try {
    // Dynamically invoke the flywheel scanner
    const { scanRepo: flywheelScan } = require("./knowledge-flywheel");

    // The scanRepo function expects a path like "benchmarks/curl"
    const repoPath = path.join("benchmarks", repoName);
    let proposals: any[];
    try {
      proposals = flywheelScan(repoPath);
    } catch (e: any) {
      return {
        repo: repoName,
        status: "error",
        error: e.message || String(e),
        proposals: 0, accepted: 0, rejected: 0,
        topMatches: [],
      };
    }

    let accepted = 0;
    let rejected = 0;

    if (autoAccept && proposals.length > 0) {
      try {
        const { acceptProposal, getProposal } = require("./knowledge-flywheel");
        for (const p of proposals) {
          if (p.suggestion !== "insufficient") {
            try {
              acceptProposal(p.id, { autoApproved: true });
              accepted++;
            } catch {
              // Already accepted or error
            }
          } else {
            rejected++;
          }
        }
      } catch {
        // Accept function might not exist or fail — proposals are still pending
      }
    }

    const topMatches = proposals
      .sort((a: any, b: any) => b.evidenceCount - a.evidenceCount)
      .slice(0, 3)
      .map((p: any) => ({ unit: p.unitName, count: p.evidenceCount }));

    return {
      repo: repoName,
      status: "scanned",
      proposals: proposals.length,
      accepted,
      rejected,
      topMatches,
    };
  } catch (e: any) {
    return {
      repo: repoName,
      status: "error",
      error: e.message || String(e),
      proposals: 0, accepted: 0, rejected: 0,
      topMatches: [],
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// Dashboard Generator
// ═══════════════════════════════════════════════════════════════

function loadFlywheelState(): {
  totalProposals: number;
  accepted: number;
  rejected: number;
  pending: number;
} {
  let totalProposals = 0;
  let accepted = 0;
  let rejected = 0;
  let pending = 0;

  if (fs.existsSync(PROPOSALS_DIR)) {
    const files = fs.readdirSync(PROPOSALS_DIR).filter(f => f.endsWith(".json"));
    totalProposals = files.length;

    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(PROPOSALS_DIR, file), "utf-8"));
        if (data.status === "accepted") accepted++;
        else if (data.status === "rejected") rejected++;
        else pending++;
      } catch { /* skip */ }
    }
  }

  return { totalProposals, accepted, rejected, pending };
}

function generateDashboard(results: ScanResult[]): FlywheelDashboard {
  const scanned = results.filter(r => r.status === "scanned");
  const state = loadFlywheelState();

  const totalProposals = results.reduce((s, r) => s + r.proposals, 0);
  const reposWithProposals = results.filter(r => r.proposals > 0).length;
  const knowledgeVelocity = scanned.length > 0
    ? totalProposals / scanned.length
    : 0;

  const totalConfidenceGained = state.accepted * 3 + state.pending * 1.5;

  let assessment = "IDLE";
  if (scanned.length >= 3 && state.accepted >= 2) {
    assessment = "FLYWHEEL SPINNING — knowledge growing";
  } else if (scanned.length >= 1 && state.pending >= 1) {
    assessment = "BOOTSTRAPPING — proposals pending review";
  } else if (scanned.length === 0) {
    assessment = "STALLED — no repos with sequences";
  } else {
    assessment = "STARTING — scan complete, awaiting proposals";
  }

  const recommendations: string[] = [];
  if (state.pending > 3) {
    recommendations.push(`${state.pending} proposals pending — review and accept high-confidence ones`);
  }
  if (knowledgeVelocity < 0.5) {
    recommendations.push("Knowledge velocity low — need more repos with high match rates");
  }
  if (state.accepted === 0 && state.pending > 0) {
    recommendations.push("No proposals accepted yet — start reviewing to activate flywheel");
  }
  if (state.accepted > 0) {
    recommendations.push("Flywheel active — continue scanning new repos to reinforce accepted knowledge");
  }

  return {
    generated: new Date().toISOString(),
    totalReposScanned: scanned.length,
    reposWithProposals,
    totalProposals,
    acceptedProposals: state.accepted,
    rejectedProposals: state.rejected,
    pendingProposals: state.pending,
    knowledgeVelocity: Math.round(knowledgeVelocity * 100) / 100,
    totalConfidenceGained: Math.round(totalConfidenceGained),
    byRepo: results,
    assessment,
    recommendations,
  };
}

// ═══════════════════════════════════════════════════════════════
// Formatting
// ═══════════════════════════════════════════════════════════════

function formatDashboard(d: FlywheelDashboard): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("╔══════════════════════════════════════════════════════════════╗");
  lines.push("║        Knowledge Flywheel Health Dashboard                   ║");
  lines.push("╠══════════════════════════════════════════════════════════════╣");
  lines.push(`║  Generated: ${d.generated}  ║`);
  lines.push("╚══════════════════════════════════════════════════════════════╝");
  lines.push("");

  // Summary metrics
  lines.push("── Flywheel Metrics ──");
  lines.push(`  Repos scanned:      ${d.totalReposScanned}`);
  lines.push(`  Repos with proposals: ${d.reposWithProposals}`);
  lines.push(`  Total proposals:    ${d.totalProposals}`);
  lines.push(`  Accepted:           ${d.acceptedProposals} ★`);
  lines.push(`  Pending:            ${d.pendingProposals}`);
  lines.push(`  Rejected:           ${d.rejectedProposals}`);
  lines.push(`  Knowledge velocity: ${d.knowledgeVelocity} proposals/scan`);
  lines.push(`  Confidence gained:  +${d.totalConfidenceGained}%`);
  lines.push(`  Assessment:         ${d.assessment}`);
  lines.push("");

  // Per-repo table
  lines.push("── Per-Repo Scan Results ──");
  for (const repo of d.byRepo) {
    if (repo.status === "no_sequences") {
      lines.push(`  ${repo.repo}: ⏭️ no sequences`);
    } else if (repo.status === "error") {
      lines.push(`  ${repo.repo}: ❌ ${repo.error}`);
    } else {
      const icon = repo.proposals > 0 ? "📊" : "✓";
      lines.push(`  ${icon} ${repo.repo}: ${repo.proposals} proposals`);
      if (repo.topMatches.length > 0) {
        const matches = repo.topMatches.map(m => `${m.unit}(${m.count})`).join(", ");
        lines.push(`     Top matches: ${matches}`);
      }
    }
  }

  lines.push("");
  lines.push("── Recommendations ──");
  for (const r of d.recommendations) {
    lines.push(`  • ${r}`);
  }
  lines.push("");

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// Save
// ═══════════════════════════════════════════════════════════════

function saveDashboard(dashboard: FlywheelDashboard): void {
  const metricsPath = path.resolve(
    process.cwd(),
    ".progmune_corpus",
    "flywheel-metrics.json"
  );
  fs.writeFileSync(metricsPath, JSON.stringify(dashboard, null, 2));
  console.log(`Dashboard saved to ${metricsPath}`);
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

function main() {
  const args = process.argv.slice(2);
  const autoAccept = args.includes("--auto-accept");
  const repoArg = args.find(a => a.startsWith("--repos="));

  // Find all repos with sequence files
  const allRepos: string[] = [];
  if (fs.existsSync(BENCHMARKS_DIR)) {
    const files = fs.readdirSync(BENCHMARKS_DIR);
    const seqRepos = new Set<string>();
    for (const file of files) {
      const match = file.match(/^(.+)-sequences\.json$/);
      if (match) seqRepos.add(match[1]);
    }
    allRepos.push(...seqRepos);
  }

  const repoNames = repoArg
    ? repoArg.replace("--repos=", "").split(",")
    : allRepos;

  console.log(`Scanning ${repoNames.length} repos...`);
  if (autoAccept) console.log(`  (auto-accepting proposals with sufficient evidence)`);

  const results = repoNames.map(name => scanRepo(name, autoAccept));
  const dashboard = generateDashboard(results);

  console.log(formatDashboard(dashboard));
  saveDashboard(dashboard);
}

main();
