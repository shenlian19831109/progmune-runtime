/**
 * Evidence Growth Pipeline — Auto-scan new repos, suggest evidence
 *
 * The flywheel: new repo → scan → evidence candidates → confidence → suggestion → review → update
 *
 * Usage:
 *   npx ts-node src/evidence-growth.ts scan benchmarks/nginx
 *   npx ts-node src/evidence-growth.ts suggest
 */

import * as fs from "fs";
import * as path from "path";
import { validateProtocolState } from "./protocol-detector";
import { buildKnowledgeBase } from "./protocol-knowledge";

interface EvidenceCandidate {
  repo: string;
  protocol: string;
  unitId: string;
  matchCount: number;
  confidence: number;
  suggestion: "add_evidence" | "promote_to_stable" | "insufficient";
  reason: string;
}

export function scanForEvidence(repoPath: string): EvidenceCandidate[] {
  const repoName = path.basename(repoPath);
  const seqFile = path.join(path.dirname(repoPath), `${repoName}-sequences.json`);
  if (!fs.existsSync(seqFile)) throw new Error(`No sequences: ${seqFile}`);

  const sequences = JSON.parse(fs.readFileSync(seqFile, "utf-8"));
  const kb = buildKnowledgeBase();
  const candidates: EvidenceCandidate[] = [];

  // Match protocols
  const matchCounts: Record<string, number> = {};
  for (const seq of sequences.slice(0, 50)) {
    const result = validateProtocolState(seq.calls || []);
    for (const p of result.matchedProtocols) {
      matchCounts[p] = (matchCounts[p] || 0) + 1;
    }
  }

  for (const [proto, count] of Object.entries(matchCounts)) {
    const unit = kb.units.find(u => u.name === proto);
    if (!unit) continue;

    const alreadyEvidenced = (unit.evidence || []).some(e => e.repo === repoName);
    if (alreadyEvidenced) continue;

    let suggestion: EvidenceCandidate["suggestion"];
    let reason: string;

    if (count >= 10 && !unit.validatedRepos.includes(repoName)) {
      suggestion = "promote_to_stable";
      reason = `${count}/50 sequences matched — strong evidence. Adding this repo would make ${unit.name} eligible for stable promotion.`;
    } else if (count >= 3) {
      suggestion = "add_evidence";
      reason = `${count}/50 sequences matched — moderate evidence. Adding would increase confidence by ~5%.`;
    } else {
      suggestion = "insufficient";
      reason = `Only ${count}/50 matched — insufficient for evidence. Need ≥3 matches.`;
    }

    candidates.push({
      repo: repoName,
      protocol: proto,
      unitId: unit.id,
      matchCount: count,
      confidence: Math.min(90, unit.confidence + (suggestion === "add_evidence" ? 5 : suggestion === "promote_to_stable" ? 10 : 0)),
      suggestion,
      reason,
    });
  }

  return candidates.sort((a, b) => b.matchCount - a.matchCount);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === "scan" && args[1]) {
    const candidates = scanForEvidence(args[1]);
    console.log(`\nEvidence Candidates: ${args[1]}\n`);
    for (const c of candidates) {
      const icon = c.suggestion === "promote_to_stable" ? "⭐" : c.suggestion === "add_evidence" ? "✅" : "—";
      console.log(`  ${icon} ${c.protocol}: ${c.matchCount}/50 matched (${c.confidence}% conf)`);
      console.log(`     ${c.reason}`);
    }
    if (candidates.filter(c => c.suggestion !== "insufficient").length === 0) {
      console.log("  No evidence candidates found. Need ≥3 protocol matches.");
    }
    console.log("");
  } else if (args[0] === "suggest") {
    const benchmarkDir = "benchmarks";
    if (!fs.existsSync(benchmarkDir)) { console.log("No benchmarks directory"); process.exit(0); }
    const allCandidates: EvidenceCandidate[] = [];
    for (const entry of fs.readdirSync(benchmarkDir)) {
      const seqFile = path.join(benchmarkDir, `${entry}-sequences.json`);
      if (fs.existsSync(seqFile)) {
        try { allCandidates.push(...scanForEvidence(path.join(benchmarkDir, entry))); } catch {}
      }
    }
    const actionable = allCandidates.filter(c => c.suggestion !== "insufficient");
    console.log(`\nEvidence Growth Suggestions (${actionable.length} actionable):\n`);
    for (const c of actionable) {
      console.log(`  ${c.suggestion === "promote_to_stable" ? "⭐" : "✅"} ${c.repo} → ${c.protocol}: ${c.matchCount}/50 matches`);
    }
    if (actionable.length === 0) console.log("  No new evidence to suggest. All repos already covered.\n");
    else console.log(`\n  Run: npx ts-node src/knowledge-evolution.ts propose benchmarks/<repo>\n`);
  } else {
    console.log("Usage: scan <repoPath> | suggest");
  }
}
