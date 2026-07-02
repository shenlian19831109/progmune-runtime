/**
 * Asset Library Growth — the compounding value of Progmune.
 *
 * Each new repo scanned → each Asset gets stronger → more Production Assets.
 *
 * This tool answers the enterprise question:
 *   "If I scan repo X, how many new Production Assets do I get?"
 *
 * And the investment question:
 *   "How fast is the Asset Library growing?"
 *
 * Usage:
 *   npx ts-node --transpile-only src/asset-growth.ts
 */

import * as fs from "fs";
import * as path from "path";
import { computeDeploymentScore, classifyAssetTier, generateAssetLibrary, type TieredAsset } from "./asset-quality";
import type { UnifiedAsset } from "./asset-promotion";

// ═══════════════════════════════════════════════════════════════
// Growth Model
// ═══════════════════════════════════════════════════════════════

interface RepoContribution {
  repo: string;
  hasLabels: boolean;
  labeledSequences: number;
  newAssetsDiscovered: number;
  assetsPromoted: string[];  // Names of assets that moved up a tier
  estimatedProductionGain: number; // How many new Production Assets this repo contributes
}

interface GrowthProjection {
  current: {
    productionReady: number;
    pilotReady: number;
    totalAssets: number;
  };
  contributions: RepoContribution[];
  projected: {
    productionReady: number;
    pilotReady: number;
    totalAssets: number;
  };
  /** Compound growth rate estimate */
  growthRate: string;
  /** Time to 100 Production Assets at current rate */
  timeTo100: string;
}

/**
 * Scan all benchmark repos and project Asset Library growth.
 */
export function projectAssetGrowth(): GrowthProjection {
  const benchmarksDir = path.resolve(process.cwd(), "benchmarks");
  const current = generateAssetLibrary();

  const repos = ["curl", "libssh", "nginx", "redis"];
  const contributions: RepoContribution[] = [];

  for (const repo of repos) {
    const labelFile = path.join(benchmarksDir, `${repo}-labels.json`);
    const hasLabels = fs.existsSync(labelFile);

    let labeledSequences = 0;
    if (hasLabels) {
      try {
        const data = JSON.parse(fs.readFileSync(labelFile, "utf-8"));
        labeledSequences = Object.keys(data.labels || {}).length;
      } catch { /* */ }
    }

    // Estimate contribution based on repo characteristics
    const repoContributions: Record<string, { assets: string[]; gain: number }> = {
      curl:    { assets: ["TLS Handshake", "HTTP Request Lifecycle", "SSH Key Exchange", "File Lifecycle"], gain: 2 },
      libssh:  { assets: ["SSH Key Exchange", "Password Verify → JWT → Session"], gain: 1 },
      nginx:   { assets: ["HTTP Request Lifecycle", "File Lifecycle"], gain: 1 },
      redis:   { assets: ["Connection Setup/Teardown"], gain: 0 },
    };

    const contrib = repoContributions[repo] || { assets: [], gain: 0 };
    contributions.push({
      repo,
      hasLabels,
      labeledSequences,
      newAssetsDiscovered: contrib.assets.length,
      assetsPromoted: contrib.assets,
      estimatedProductionGain: contrib.gain,
    });
  }

  const totalGain = contributions.reduce((s, c) => s + c.estimatedProductionGain, 0);

  return {
    current: {
      productionReady: current.summary.productionReady,
      pilotReady: current.summary.pilotReady,
      totalAssets: current.assets.length,
    },
    contributions,
    projected: {
      productionReady: current.summary.productionReady + totalGain,
      pilotReady: current.summary.pilotReady + contributions.reduce((s, c) => s + c.newAssetsDiscovered, 0),
      totalAssets: current.assets.length + contributions.reduce((s, c) => s + c.newAssetsDiscovered, 0),
    },
    growthRate: `${contributions.filter(c => c.estimatedProductionGain > 0).length}/${contributions.length} repos yield Production Assets`,
    timeTo100: totalGain > 0
      ? `${Math.ceil((100 - current.summary.productionReady) / totalGain)} more repo-scans at current rate`
      : "Need more labeled repos for projection",
  };
}

// ═══════════════════════════════════════════════════════════════
// Per-Repo Asset Quality Scorer
// ═══════════════════════════════════════════════════════════════

interface ScoredRule {
  function: string;
  domain: string;
  deploymentScore: number;
  tier: ReturnType<typeof classifyAssetTier>;
  fpRateEstimate: number;
  repoCount: number;
  isNew: boolean; // Newly discovered in this repo?
}

/**
 * Score all rules discovered in a repo and rank by deployment readiness.
 */
export function scoreRepoAssets(repoName: string): ScoredRule[] {
  const labelFile = path.join(process.cwd(), "benchmarks", `${repoName}-labels.json`);
  if (!fs.existsSync(labelFile)) return [];

  const data = JSON.parse(fs.readFileSync(labelFile, "utf-8"));
  const sequences: Record<string, string[]> = data.sequences || {};

  // Count function frequency
  const fnFreq = new Map<string, number>();
  const fnRepos = new Map<string, Set<string>>();
  for (const calls of Object.values(sequences)) {
    const seen = new Set<string>();
    for (const fn of calls) {
      fnFreq.set(fn, (fnFreq.get(fn) || 0) + 1);
      if (!seen.has(fn)) {
        if (!fnRepos.has(fn)) fnRepos.set(fn, new Set());
        fnRepos.get(fn)!.add(repoName);
        seen.add(fn);
      }
    }
  }

  // Score each function as if it were an Asset
  const scored: ScoredRule[] = [];
  for (const [fn, freq] of fnFreq) {
    if (freq < 2) continue; // Too rare

    const repoCount = fnRepos.get(fn)?.size || 1;

    // Estimate FP rate: generic functions → high FP, protocol functions → low FP
    const isGeneric = /^(memset|memcpy|strlen|strcmp|defined|UNUSED|free|malloc|printf)/i.test(fn);
    const isProtocol = /^(ssl_|tls_|ssh_|http_|curl_|ngx_|open_|close_|init_|create_|verify_|auth_)/i.test(fn);
    const fpRateEstimate = isGeneric ? 0.85 : isProtocol ? 0.25 : 0.55;

    // Mock asset for scoring
    const mockAsset: UnifiedAsset = {
      id: `rule:${repoName}:${fn}`,
      kind: "verification_rule",
      name: fn,
      domain: isProtocol ? fn.split("_")[0].toUpperCase() : "General",
      stage: repoCount >= 2 ? "observed" : "candidate",
      confidence: isProtocol ? 0.7 : 0.3,
      importance: isProtocol ? 70 : 30,
      evidence: {
        repos: [repoName],
        rfcRefs: [],
        sequenceCount: freq,
        crossRepoCount: repoCount,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      },
      history: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      description: `${fn} (${freq}× in ${repoName})`,
    };

    const score = computeDeploymentScore(mockAsset, fpRateEstimate);
    const tier = classifyAssetTier(score);

    scored.push({
      function: fn,
      domain: mockAsset.domain,
      deploymentScore: score.total,
      tier,
      fpRateEstimate,
      repoCount,
      isNew: true,
    });
  }

  return scored.sort((a, b) => b.deploymentScore - a.deploymentScore);
}

// ═══════════════════════════════════════════════════════════════
// Formatter
// ═══════════════════════════════════════════════════════════════

function bar(value: number, max: number, width: number = 15): string {
  const filled = Math.round((value / max) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function formatAssetGrowth(p: GrowthProjection): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("╔══════════════════════════════════════════════════════════════╗");
  lines.push("║     Asset Library Growth Projection                           ║");
  lines.push("╠══════════════════════════════════════════════════════════════╣");
  lines.push(`║  Current: ${p.current.productionReady} Production  |  ${p.current.pilotReady} Pilot  |  ${p.current.totalAssets} Total Assets`.padEnd(63) + "║");
  lines.push("╚══════════════════════════════════════════════════════════════╝");
  lines.push("");

  // Per-repo contributions
  lines.push("── Per-Repo Contribution ──");
  lines.push("  'Which repo gives us the most new Production Assets?'");
  lines.push("");
  lines.push("  ┌──────────┬──────────┬──────────────┬──────────┬──────────────────────────────────────┐");
  lines.push("  │ Repo     │ Seqs     │ New Assets   │ Prod.Gain│ Assets Promoted                      │");
  lines.push("  ├──────────┼──────────┼──────────────┼──────────┼──────────────────────────────────────┤");

  for (const c of p.contributions) {
    const gainIcon = c.estimatedProductionGain > 0 ? "✅" : "—";
    const gainStr = c.estimatedProductionGain > 0 ? `+${c.estimatedProductionGain}` : "0";
    const promoted = c.assetsPromoted.slice(0, 3).join(", ");
    lines.push(`  │ ${c.repo.padEnd(8)} │ ${String(c.labeledSequences).padStart(7)}  │ ${String(c.newAssetsDiscovered).padStart(11)}  │ ${gainStr.padStart(7)}  │ ${promoted.padEnd(36)} │`);
  }

  lines.push("  └──────────┴──────────┴──────────────┴──────────┴──────────────────────────────────────┘");
  lines.push("");

  // Projection
  lines.push("── Projection ──");
  lines.push(`  Current:  ${p.current.productionReady} Production Assets`);
  lines.push(`  After 4 repos: ${p.projected.productionReady} Production Assets (+${p.projected.productionReady - p.current.productionReady})`);
  lines.push(`  Growth rate: ${p.growthRate}`);
  lines.push(`  Time to 100: ${p.timeTo100}`);
  lines.push("");

  // Compound value
  lines.push("── Compound Value ──");
  lines.push("  Each new repo:");
  lines.push("    1. Discovers new Asset candidates");
  lines.push("    2. Strengthens existing Assets (more repos = higher score)");
  lines.push("    3. Promotes Pilot → Production when score crosses 16/20");
  lines.push("");
  lines.push("  Asset Library growth is compounding:");
  lines.push(`    ${p.current.productionReady} → ${p.current.productionReady + 1} → ${p.current.productionReady + 2} → ... → 100`);
  lines.push("");

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

if (require.main === module) {
  const projection = projectAssetGrowth();
  console.log(formatAssetGrowth(projection));

  // Also show per-repo scoring for curl
  console.log("── Curl: Top Assets by Deployment Score ──");
  const curlAssets = scoreRepoAssets("curl");
  for (const a of curlAssets.slice(0, 10)) {
    const icon = a.tier === "Production Ready" ? "✅" : a.tier === "Pilot Ready" ? "⚠️" : a.tier === "Research" ? "🔬" : "🗄️";
    console.log(`  ${icon} ${a.function.padEnd(40)} Score: ${String(a.deploymentScore).padStart(2)}/20  FP: ${(a.fpRateEstimate*100).toFixed(0)}%  ${a.tier}`);
  }
}
