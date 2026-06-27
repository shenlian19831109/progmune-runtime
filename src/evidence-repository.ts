/**
 * Evidence Repository — Centralized validation evidence store
 *
 * Collects, indexes, and queries all validation evidence across
 * all repositories and protocol units. The bottom layer of the
 * Progmune architecture stack.
 *
 * Architecture:
 *   Governance Platform → Verification Engine → Protocol Ontology → Evidence Repository
 *
 * Usage:
 *   npx ts-node src/evidence-repository.ts
 *   npx ts-node src/evidence-repository.ts --protocol TLS
 *   npx ts-node src/evidence-repository.ts --repo curl
 */

import * as fs from "fs";
import * as path from "path";
import { buildKnowledgeBase } from "./protocol-knowledge";
import { validateProtocolState } from "./protocol-detector";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface EvidenceRecord {
  repo: string;
  repoType: "application" | "library" | "protocol_library";
  totalSequences: number;
  labeledSequences: number;
  protocolMatches: Array<{
    protocol: string;
    unitId: string;
    matchCount: number;
    totalSequences: number;
    matchRate: number;
    examples: string[][];
  }>;
  timestamp: string;
}

export interface EvidenceRepository {
  name: string;
  version: string;
  generated: string;
  repos: EvidenceRecord[];
  summary: {
    totalRepos: number;
    totalSequences: number;
    totalLabeledSequences: number;
    totalProtocolMatches: number;
    reposByType: Record<string, number>;
    topProtocols: Array<{ protocol: string; repos: number; totalMatches: number }>;
  };
}

// ═══════════════════════════════════════════════════════════════
// Scanner
// ═══════════════════════════════════════════════════════════════

const BENCHMARK_REPOS: Array<{ name: string; type: EvidenceRecord["repoType"] }> = [
  { name: "curl", type: "application" },
  { name: "nginx", type: "application" },
  { name: "redis", type: "application" },
  { name: "apache", type: "application" },
  { name: "openssl", type: "protocol_library" },
  { name: "libssh", type: "library" },
  { name: "nghttp2", type: "library" },
];

export function buildEvidenceRepository(): EvidenceRepository {
  const kb = buildKnowledgeBase();
  const repos: EvidenceRecord[] = [];

  for (const repo of BENCHMARK_REPOS) {
    const seqFile = path.join("benchmarks", `${repo.name}-sequences.json`);
    const labelFile = path.join("benchmarks", `${repo.name}-labels.json`);

    if (!fs.existsSync(seqFile)) continue;

    const sequences = JSON.parse(fs.readFileSync(seqFile, "utf-8"));
    let labeledSeqs = 0;
    if (fs.existsSync(labelFile)) {
      const labels = JSON.parse(fs.readFileSync(labelFile, "utf-8"));
      labeledSeqs = Object.keys(labels.labels || labels).length;
    }

    // Match protocols against sequences
    const matchMap: Record<string, { unitId: string; matchCount: number; examples: string[][] }> = {};

    for (const seq of sequences.slice(0, 50)) {
      const result = validateProtocolState(seq.calls || []);
      for (const proto of result.matchedProtocols) {
        if (!matchMap[proto]) {
          const unit = kb.units.find(u => u.name === proto);
          matchMap[proto] = { unitId: unit?.id || proto, matchCount: 0, examples: [] };
        }
        matchMap[proto].matchCount++;
        if (matchMap[proto].examples.length < 3) {
          matchMap[proto].examples.push((seq.calls || []).slice(0, 5));
        }
      }
    }

    const protocolMatches = Object.entries(matchMap)
      .map(([proto, data]) => ({
        protocol: proto,
        unitId: data.unitId,
        matchCount: data.matchCount,
        totalSequences: Math.min(50, sequences.length),
        matchRate: Math.round((data.matchCount / Math.min(50, sequences.length)) * 100),
        examples: data.examples,
      }))
      .sort((a, b) => b.matchCount - a.matchCount);

    repos.push({
      repo: repo.name,
      repoType: repo.type,
      totalSequences: sequences.length,
      labeledSequences: labeledSeqs,
      protocolMatches,
      timestamp: new Date().toISOString().slice(0, 10),
    });
  }

  // Summary
  const allMatches = repos.flatMap(r => r.protocolMatches);
  const protoSummary: Record<string, { repos: number; totalMatches: number }> = {};
  for (const m of allMatches) {
    if (!protoSummary[m.protocol]) protoSummary[m.protocol] = { repos: 0, totalMatches: 0 };
    protoSummary[m.protocol].repos++;
    protoSummary[m.protocol].totalMatches += m.matchCount;
  }

  const topProtocols = Object.entries(protoSummary)
    .map(([p, d]) => ({ protocol: p, repos: d.repos, totalMatches: d.totalMatches }))
    .sort((a, b) => b.repos - a.repos || b.totalMatches - a.totalMatches);

  return {
    name: "Progmune Evidence Repository",
    version: "1.0.0",
    generated: new Date().toISOString(),
    repos,
    summary: {
      totalRepos: repos.length,
      totalSequences: repos.reduce((s, r) => s + r.totalSequences, 0),
      totalLabeledSequences: repos.reduce((s, r) => s + r.labeledSequences, 0),
      totalProtocolMatches: allMatches.length,
      reposByType: {
        application: repos.filter(r => r.repoType === "application").length,
        library: repos.filter(r => r.repoType === "library").length,
        protocol_library: repos.filter(r => r.repoType === "protocol_library").length,
      },
      topProtocols,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

export function formatEvidenceTerminal(repo: EvidenceRepository, filter?: { protocol?: string; repo?: string }): string {
  const C = { r: "\x1b[0m", b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[32m", y: "\x1b[33m", r2: "\x1b[31m", c: "\x1b[36m" };
  const l: string[] = [];
  l.push(`\n${C.b}${C.c}Evidence Repository${C.r}  v${repo.version}`);
  l.push(`${C.d}${repo.summary.totalRepos} repos · ${repo.summary.totalSequences} seqs · ${repo.summary.totalLabeledSequences} labeled · ${repo.summary.totalProtocolMatches} protocol matches${C.r}\n`);

  // Top protocols
  l.push(`${C.b}Top Protocols by Evidence:${C.r}`);
  for (const tp of repo.summary.topProtocols) {
    const bar = "█".repeat(Math.min(tp.repos, 7));
    l.push(`  ${bar} ${C.b}${tp.protocol}${C.r}: ${tp.repos} repos, ${tp.totalMatches} total matches`);
  }

  // Per-repo breakdown
  l.push(`\n${C.b}Per-Repository Evidence:${C.r}`);
  const filteredRepos = filter?.repo ? repo.repos.filter(r => r.repo === filter.repo) : repo.repos;

  for (const r of filteredRepos) {
    const typeIcon = r.repoType === "protocol_library" ? "🔬" : r.repoType === "library" ? "📚" : "📦";
    l.push(`\n  ${typeIcon} ${C.b}${r.repo}${C.r} (${r.repoType}, ${r.totalSequences} seqs, ${r.labeledSequences} labeled)`);
    if (r.protocolMatches.length === 0) {
      l.push(`    ${C.d}No protocol matches${C.r}`);
    } else {
      for (const m of r.protocolMatches) {
        const matchBar = m.matchRate >= 30 ? C.g : m.matchRate >= 10 ? C.y : C.d;
        l.push(`    ${matchBar}${m.matchRate}%${C.r} ${m.protocol}: ${m.matchCount}/${m.totalSequences} sequences`);
        if (filter?.protocol === m.protocol && m.examples.length > 0) {
          for (const ex of m.examples) l.push(`      ${C.d}${ex.join(" → ")}${C.r}`);
        }
      }
    }
  }

  l.push("");
  return l.join("\n");
}

export const EVIDENCE_PATH = "benchmarks/evidence-repository.json";

if (require.main === module) {
  const er = buildEvidenceRepository();
  const args = process.argv.slice(2);
  const pIdx = args.indexOf("--protocol"); const rIdx = args.indexOf("--repo");
  const filter = { protocol: pIdx >= 0 ? args[pIdx + 1] : undefined, repo: rIdx >= 0 ? args[rIdx + 1] : undefined };

  if (args.includes("--export")) {
    if (!fs.existsSync("benchmarks")) fs.mkdirSync("benchmarks");
    fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(er, null, 2));
    console.error(`✅ Exported: ${EVIDENCE_PATH}`);
  }
  console.log(formatEvidenceTerminal(er, filter));
}
