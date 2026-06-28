/**
 * Knowledge Evolution Pipeline
 *
 * Transforms the Knowledge Base from manual maintenance to a
 * self-growing system: scan → discover → propose → review → accept.
 *
 * Usage:
 *   npx ts-node src/knowledge-evolution.ts scan <repoPath>
 *   npx ts-node src/knowledge-evolution.ts propose <repoPath>
 *   npx ts-node src/knowledge-evolution.ts changelog
 */

import * as fs from "fs";
import * as path from "path";
import { validateProtocolState } from "./protocol-detector";
import { buildKnowledgeBase } from "./protocol-knowledge";
import type { KnowledgeUnit, VersionSnapshot } from "./protocol-knowledge";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface ScanResult {
  repo: string;
  timestamp: string;
  totalSequences: number;
  existingMatches: Array<{ protocol: string; sequenceCount: number; examples: string[][] }>;
  unmatchedSequences: Array<{ function: string; calls: string[]; frequency: number }>;
  proposalCandidates: ProposalCandidate[];
}

interface ProposalCandidate {
  protocolName: string;        // Which existing protocol this extends
  category: string;
  newPatterns: string[];        // New function patterns found
  evidenceRepo: string;
  evidenceSequences: number;
  suggestedAction: "extend" | "new_protocol" | "no_action";
  confidence: number;
}

interface KnowledgeProposal {
  id: string;
  timestamp: string;
  repo: string;
  changes: Array<{
    assetId: string;
    assetName: string;
    action: "promote" | "extend_patterns" | "add_evidence" | "new_asset";
    before: Partial<VersionSnapshot>;
    after: Partial<VersionSnapshot>;
    reason: string;
    newPatterns?: string[];
  }>;
  changelog: string;
  status: "proposed" | "accepted" | "rejected";
}

// ═══════════════════════════════════════════════════════════════
// Step 1: Scan
// ═══════════════════════════════════════════════════════════════

export function scanRepo(repoPath: string): ScanResult {
  const repoName = path.basename(repoPath);
  const seqFile = path.join(path.dirname(repoPath), `${repoName}-sequences.json`);

  if (!fs.existsSync(seqFile)) {
    throw new Error(`No sequences file: ${seqFile}. Run C extraction first.`);
  }

  const sequences = JSON.parse(fs.readFileSync(seqFile, "utf-8"));
  const kb = buildKnowledgeBase();

  // Match against existing protocols
  const existingMatches: ScanResult["existingMatches"] = [];
  const matchedProtocols = new Set<string>();
  const unmatched: ScanResult["unmatchedSequences"] = [];

  for (const seq of sequences.slice(0, 50)) {
    const result = validateProtocolState(seq.calls || []);
    for (const p of result.matchedProtocols) {
      matchedProtocols.add(p);
    }
    if (result.matchedProtocols.length === 0) {
      unmatched.push({
        function: seq.function || "?",
        calls: (seq.calls || []).slice(0, 8),
        frequency: seq.totalCalls || 0,
      });
    }
  }

  for (const proto of matchedProtocols) {
    const matchingSeqs = sequences.filter((s: any) => {
      const r = validateProtocolState(s.calls || []);
      return r.matchedProtocols.includes(proto);
    });
    existingMatches.push({
      protocol: proto,
      sequenceCount: matchingSeqs.length,
      examples: matchingSeqs.slice(0, 3).map((s: any) => (s.calls || []).slice(0, 5)),
    });
  }

  // Generate proposal candidates from unmatched sequences
  const candidates = generateProposals(unmatched, kb, repoName);

  return {
    repo: repoName,
    timestamp: new Date().toISOString(),
    totalSequences: sequences.length,
    existingMatches,
    unmatchedSequences: unmatched.slice(0, 20),
    proposalCandidates: candidates,
  };
}

function generateProposals(
  unmatched: ScanResult["unmatchedSequences"],
  kb: ReturnType<typeof buildKnowledgeBase>,
  repoName: string
): ProposalCandidate[] {
  const candidates: ProposalCandidate[] = [];

  // Group unmatched functions by common prefixes
  const groups: Record<string, string[]> = {};
  for (const u of unmatched) {
    // Find the closest existing protocol by call pattern similarity
    for (const call of u.calls) {
      for (const asset of kb.units) {
        if (asset.steps.some(s => new RegExp(s.split(" ")[0] || "", "i").test(call))) {
          const key = asset.name;
          if (!groups[key]) groups[key] = [];
          groups[key].push(call);
        }
      }
    }
  }

  for (const [proto, calls] of Object.entries(groups)) {
    if (calls.length >= 2) {
      const uniqueCalls = [...new Set(calls)];
      candidates.push({
        protocolName: proto,
        category: kb.units.find(a => a.name === proto)?.category || "connection",
        newPatterns: uniqueCalls.slice(0, 5),
        evidenceRepo: repoName,
        evidenceSequences: unmatched.length,
        suggestedAction: "extend",
        confidence: Math.min(70, 30 + uniqueCalls.length * 10),
      });
    }
  }

  return candidates.slice(0, 5);
}

// ═══════════════════════════════════════════════════════════════
// Step 2: Propose
// ═══════════════════════════════════════════════════════════════

export function proposeUpdate(repoPath: string): KnowledgeProposal {
  const scan = scanRepo(repoPath);
  const kb = buildKnowledgeBase();
  const id = `PROPOSAL-${Date.now().toString(36)}`;
  const changes: KnowledgeProposal["changes"] = [];

  // For each matched protocol, propose evidence addition
  for (const match of scan.existingMatches) {
    const asset = kb.units.find(a => a.name === match.protocol);
    if (!asset) continue;

    const alreadyValidated = asset.validatedRepos.includes(scan.repo);
    if (!alreadyValidated) {
      changes.push({
        assetId: asset.id,
        assetName: asset.name,
        action: "add_evidence",
        before: { validatedRepos: [...asset.validatedRepos], validatedSequences: asset.validatedSequences, confidence: asset.confidence },
        after: {
          validatedRepos: [...asset.validatedRepos, scan.repo],
          validatedSequences: asset.validatedSequences + scan.totalSequences,
          confidence: Math.min(95, asset.confidence + 5),
        },
        reason: `${scan.repo} sequences match ${asset.name} protocol (${match.sequenceCount}/50 sequences)`,
      });
    }
  }

  // For proposal candidates, suggest extensions
  for (const cand of scan.proposalCandidates) {
    const asset = kb.units.find(a => a.name === cand.protocolName);
    if (!asset || cand.suggestedAction !== "extend") continue;

    changes.push({
      assetId: asset.id,
      assetName: asset.name,
      action: "extend_patterns",
      before: { confidence: asset.confidence },
      after: { confidence: Math.min(90, asset.confidence + 8) },
      reason: `${cand.evidenceRepo} found ${cand.newPatterns.length} new call patterns matching ${asset.name}: ${cand.newPatterns.join(", ")}`,
      newPatterns: cand.newPatterns,
    });
  }

  // Generate changelog
  const changelog = generateChangelog(changes, scan.repo);

  const proposal: KnowledgeProposal = {
    id, timestamp: new Date().toISOString(), repo: scan.repo,
    changes, changelog, status: "proposed",
  };

  // Save proposal for review
  const proposalDir = ".progmune_corpus/proposals";
  if (!fs.existsSync(proposalDir)) fs.mkdirSync(proposalDir, { recursive: true });
  fs.writeFileSync(path.join(proposalDir, `${id}.json`), JSON.stringify(proposal, null, 2));

  return proposal;
}

// ═══════════════════════════════════════════════════════════════
// Step 3: Changelog
// ═══════════════════════════════════════════════════════════════

function generateChangelog(changes: KnowledgeProposal["changes"], repo: string): string {
  const lines: string[] = [];
  lines.push(`# Knowledge Base Changelog`);
  lines.push("");
  lines.push(`**Source:** ${repo}`);
  lines.push(`**Date:** ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");

  for (const c of changes) {
    lines.push(`## ${c.assetName} (${c.assetId})`);
    lines.push("");
    lines.push(`**Action:** ${c.action}`);
    lines.push(`**Reason:** ${c.reason}`);
    lines.push("");

    if (c.before.confidence !== undefined && c.after.confidence !== undefined) {
      lines.push(`| Metric | Before | After |`);
      lines.push(`|--------|--------|-------|`);
      lines.push(`| Confidence | ${c.before.confidence}% | ${c.after.confidence}% |`);
      if (c.before.validatedRepos && c.after.validatedRepos) {
        lines.push(`| Repos | ${c.before.validatedRepos.join(", ")} | ${c.after.validatedRepos.join(", ")} |`);
      }
      if (c.before.validatedSequences !== undefined && c.after.validatedSequences !== undefined) {
        lines.push(`| Sequences | ${c.before.validatedSequences} | ${c.after.validatedSequences} |`);
      }
      lines.push("");
    }

    if (c.newPatterns) {
      lines.push(`**New patterns:** \`${c.newPatterns.join("`, `")}\``);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function formatUnitEvolution(unit: any): string {
  const l: string[] = [];
  l.push(`\nKnowledge Evolution: ${unit.name} (${unit.id})`);
  l.push(`Domain: ${unit.domain}  |  Maturity: ${unit.maturity}  |  Version: ${unit.currentVersion}`);
  l.push(`Confidence: ${unit.confidence}%  |  RFC: ${unit.rfcReference || "none"}`);
  l.push(`Repos: ${unit.validatedRepos.join(", ")}  |  Sequences: ${unit.validatedSequences}`);
  l.push(`\nVersion History:`);
  for (const v of unit.versionHistory) {
    const f1Str = v.f1 !== undefined ? ` F1=${(v.f1*100).toFixed(0)}%` : "";
    const reposStr = v.validatedRepos.length > 0 ? ` repos=[${v.validatedRepos.join(",")}]` : "";
    const decisionIcon = v.decision?.outcome === "approved" ? "✅" : v.decision?.outcome === "rejected" ? "❌" : "↻";
    l.push(`  ${decisionIcon} v${v.version} (${v.date}) → ${v.confidence}% conf, ${v.validatedSequences} seqs${reposStr}${f1Str}`);
    l.push(`    ${v.notes}`);
    if (v.decision) {
      l.push(`    Decision: ${v.decision.outcome.toUpperCase()} by ${v.decision.decidedBy} — ${v.decision.reason}`);
      l.push(`    Evidence: ${v.decision.evidence.join("; ")}`);
    }
  }
  if (unit.concepts && unit.concepts.length > 0) {
    l.push(`\nConcepts (${unit.concepts.length}):`);
    for (const c of unit.concepts) {
      l.push(`  ${c.name} (${c.required ? "required" : "optional"}) — ${c.description}`);
      l.push(`    Constraints: ${c.constraints.join("; ")}`);
    }
  }
  if (unit.relations && unit.relations.length > 0) {
    l.push(`\nRelations:`);
    for (const r of unit.relations) {
      l.push(`  ${r.type} → ${r.targetId}: ${r.description}`);
    }
  }
  if (unit.evidence && unit.evidence.length > 0) {
    l.push(`\nEvidence (${unit.evidence.length}):`);
    for (const e of unit.evidence) {
      l.push(`  ${e.repo} (${e.type}): ${e.sequences} sequences, ${e.date}`);
    }
  }
  l.push("");
  return l.join("\n");
}

export function generateFullChangelog(): string {
  const kb = buildKnowledgeBase();
  const lines: string[] = [];
  lines.push("# Knowledge Base Full Changelog\n");

  for (const asset of kb.units) {
    lines.push(`## ${asset.name} (${asset.id})\n`);
    lines.push(`**Current:** v${asset.currentVersion} · ${asset.maturity} · ${asset.confidence}% confidence\n`);
    lines.push(`| Version | Date | Confidence | Repos | Seqs | Notes |`);
    lines.push(`|---------|------|------------|-------|------|-------|`);
    for (const v of asset.versionHistory) {
      lines.push(`| v${v.version} | ${v.date} | ${v.confidence}% | ${v.validatedRepos.length} | ${v.validatedSequences} | ${v.notes} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const repoPath = args[1] ? path.resolve(args[1]) : ".";

  const C = { r: "\x1b[0m", b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[32m", y: "\x1b[33m", r2: "\x1b[31m", c: "\x1b[36m" };

  if (cmd === "scan") {
    console.error(`\n${C.b}${C.c}Scanning: ${repoPath}${C.r}\n`);
    try {
      const scan = scanRepo(repoPath);
      console.log(`  Sequences: ${scan.totalSequences}`);
      console.log(`  Matched protocols: ${scan.existingMatches.length}`);
      for (const m of scan.existingMatches) {
        console.log(`    ${C.g}${m.protocol}${C.r}: ${m.sequenceCount}/50 sequences`);
        if (m.examples.length > 0) console.log(`      ${C.d}${m.examples[0].slice(0, 4).join(" → ")}${C.r}`);
      }
      console.log(`  Unmatched: ${scan.unmatchedSequences.length}`);
      if (scan.unmatchedSequences.length > 0) {
        console.log(`    ${C.y}Top patterns:${C.r}`);
        for (const u of scan.unmatchedSequences.slice(0, 5)) {
          console.log(`      ${u.function} → ${u.calls.slice(0, 4).join(", ")}`);
        }
      }
      console.log(`  Proposal candidates: ${scan.proposalCandidates.length}`);
      for (const c of scan.proposalCandidates) {
        console.log(`    ${c.protocolName}: ${c.suggestedAction} (${c.confidence}% confidence, ${c.evidenceSequences} evidence seqs)`);
      }
      console.log("");
    } catch (e: any) {
      console.error(`${C.r2}❌ ${e.message}${C.r}`);
      process.exit(1);
    }
  } else if (cmd === "propose") {
    console.error(`\n${C.b}${C.c}Generating proposal...${C.r}\n`);
    try {
      const proposal = proposeUpdate(repoPath);
      console.log(`  Proposal: ${proposal.id}`);
      console.log(`  Changes: ${proposal.changes.length}`);
      for (const c of proposal.changes) {
        console.log(`    ${c.action}: ${c.assetName} — ${c.reason.slice(0, 80)}`);
      }
      console.log(`\n${proposal.changelog}`);
      console.log(`\n  ${C.y}Review: .progmune_corpus/proposals/${proposal.id}.json${C.r}`);
      console.log(`  ${C.d}To accept: update src/protocol-knowledge.ts with proposed changes${C.r}\n`);
    } catch (e: any) {
      console.error(`${C.r2}❌ ${e.message}${C.r}`);
      process.exit(1);
    }
  } else if (cmd === "diff") {
    const unitId = args[1];
    const v1 = args[2];
    const v2 = args[3];
    if (!unitId || !v1 || !v2) { console.error("Usage: diff <unitId> <v1> <v2>"); process.exit(1); }
    const kb = buildKnowledgeBase();
    const unit = kb.units.find(u => u.id === unitId || u.name === unitId);
    if (!unit) { console.error(`Unit not found: ${unitId}`); process.exit(1); }
    const ver1 = unit.versionHistory.find((v: any) => v.version === v1);
    const ver2 = unit.versionHistory.find((v: any) => v.version === v2);
    if (!ver1 || !ver2) { console.error("Version not found"); process.exit(1); }
    const C = { r: "\x1b[0m", b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[32m", r2: "\x1b[31m", y: "\x1b[33m" };
    const delta = (a: number, b: number) => `${b - a >= 0 ? "+" : ""}${b - a}`;
    console.log(`\n${C.b}Knowledge Diff: ${unit.name}${C.r}`);
    console.log(`${C.d}${v1} → ${v2}  (${ver1.date} → ${ver2.date})${C.r}\n`);
    console.log(`  Confidence:    ${ver1.confidence}% → ${C.b}${ver2.confidence}%${C.r}  (${delta(ver1.confidence, ver2.confidence)}%)`);
    console.log(`  Repos:         ${ver1.validatedRepos.length} → ${ver2.validatedRepos.length}  ${ver2.validatedRepos.filter((r: string) => !ver1.validatedRepos.includes(r)).length > 0 ? C.g + "+ " + ver2.validatedRepos.filter((r: string) => !ver1.validatedRepos.includes(r)).join(", ") + C.r : ""}`);
    console.log(`  Sequences:     ${ver1.validatedSequences} → ${ver2.validatedSequences}  (${delta(ver1.validatedSequences, ver2.validatedSequences)})`);
    if (ver1.f1 !== undefined && ver2.f1 !== undefined) {
      const f1Delta = ver2.f1 - ver1.f1;
      console.log(`  F1 Score:      ${(ver1.f1*100).toFixed(0)}% → ${(ver2.f1*100).toFixed(0)}%  (${f1Delta >= 0 ? "+" : ""}${(f1Delta*100).toFixed(0)}pp)`);
    }
    if (ver1.precision !== undefined && ver2.precision !== undefined) {
      console.log(`  Precision:     ${(ver1.precision*100).toFixed(0)}% → ${(ver2.precision*100).toFixed(0)}%`);
    }
    if (ver1.recall !== undefined && ver2.recall !== undefined) {
      console.log(`  Recall:        ${(ver1.recall*100).toFixed(0)}% → ${(ver2.recall*100).toFixed(0)}%`);
    }
    // Concept changes
    const v1Concepts = unit.concepts?.length || 0;
    const v2Concepts = v1Concepts; // concepts tracked at unit level currently
    console.log(`  Concepts:      ${v1Concepts} defined`);
    // Decision trail
    if (ver1.decision && ver2.decision) {
      console.log(`\n  Decision Trail:`);
      console.log(`  v${v1}: ${ver1.decision.outcome.toUpperCase()} by ${ver1.decision.decidedBy}`);
      console.log(`  v${v2}: ${ver2.decision.outcome.toUpperCase()} by ${ver2.decision.decidedBy}`);
    }
    console.log(`\n  ${C.d}${ver2.notes}${C.r}\n`);

  } else if (cmd === "benchmark") {
    const unitId = args[1];
    if (!unitId) { console.error("Usage: benchmark <unitId>"); process.exit(1); }
    const kb = buildKnowledgeBase();
    const unit = kb.units.find(u => u.id === unitId || u.name === unitId);
    if (!unit) { console.error(`Unit not found: ${unitId}`); process.exit(1); }
    console.log(`\n${unit.name} — Benchmark History`);
    console.log(`Version   Date        F1     Prec   Recall  FP    FN    Confidence`);
    console.log(`───────   ──────────  ─────  ─────  ─────  ────  ────  ──────────`);
    for (const v of unit.versionHistory) {
      const f1 = v.f1 !== undefined ? `${(v.f1*100).toFixed(0)}%`.padStart(5) : "  N/A ";
      const p = v.precision !== undefined ? `${(v.precision*100).toFixed(0)}%`.padStart(5) : "  N/A ";
      const r = v.recall !== undefined ? `${(v.recall*100).toFixed(0)}%`.padStart(5) : "  N/A ";
      console.log(`v${v.version.padEnd(7)} ${v.date}  ${f1}  ${p}  ${r}  ${String(unit.fpHistory[unit.versionHistory.indexOf(v)] || "—").padStart(4)}  ${String(unit.fnHistory[unit.versionHistory.indexOf(v)] || "—").padStart(4)}  ${v.confidence}%`);
    }
    const first = unit.versionHistory[0];
    const last = unit.versionHistory[unit.versionHistory.length - 1];
    if (first.f1 !== undefined && last.f1 !== undefined) {
      console.log(`\n  F1 improvement: ${(first.f1*100).toFixed(0)}% → ${(last.f1*100).toFixed(0)}% (${last.f1 > first.f1 ? "+" : ""}${((last.f1 - first.f1)*100).toFixed(0)}pp)`);
    }
    console.log("");

  } else if (cmd === "changelog") {
    const unitFilter = args.includes("--unit") ? args[args.indexOf("--unit") + 1] : undefined;
    if (unitFilter) {
      const kb = buildKnowledgeBase();
      const unit = kb.units.find(u => u.id === unitFilter || u.name === unitFilter);
      if (!unit) { console.error(`Unit not found: ${unitFilter}`); process.exit(1); }
      console.log(formatUnitEvolution(unit));
    } else {
      console.log(generateFullChangelog());
    }
  } else {
    console.log(`
${C.b}Knowledge Evolution Pipeline${C.r}

${C.d}Usage:${C.r}
  npx ts-node src/knowledge-evolution.ts scan <repoPath>
      Scan a repo, match protocols, discover new patterns

  npx ts-node src/knowledge-evolution.ts propose <repoPath>
      Generate a Knowledge Base update proposal with changelog

  npx ts-node src/knowledge-evolution.ts changelog
      Show full Knowledge Base version history

${C.d}Examples:${C.r}
  npx ts-node src/knowledge-evolution.ts scan benchmarks/nginx
  npx ts-node src/knowledge-evolution.ts propose benchmarks/nghttp2
  npx ts-node src/knowledge-evolution.ts changelog
    `);
  }
}
