"use strict";
/**
 * Evidence Growth Pipeline — Auto-scan new repos, suggest evidence
 *
 * The flywheel: new repo → scan → evidence candidates → confidence → suggestion → review → update
 *
 * Usage:
 *   npx ts-node src/evidence-growth.ts scan benchmarks/nginx
 *   npx ts-node src/evidence-growth.ts suggest
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanForEvidence = scanForEvidence;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const protocol_detector_1 = require("./protocol-detector");
const protocol_knowledge_1 = require("./protocol-knowledge");
function scanForEvidence(repoPath) {
    const repoName = path.basename(repoPath);
    const seqFile = path.join(path.dirname(repoPath), `${repoName}-sequences.json`);
    if (!fs.existsSync(seqFile))
        throw new Error(`No sequences: ${seqFile}`);
    const sequences = JSON.parse(fs.readFileSync(seqFile, "utf-8"));
    const kb = (0, protocol_knowledge_1.buildKnowledgeBase)();
    const candidates = [];
    // Match protocols
    const matchCounts = {};
    for (const seq of sequences.slice(0, 50)) {
        const result = (0, protocol_detector_1.validateProtocolState)(seq.calls || []);
        for (const p of result.matchedProtocols) {
            matchCounts[p] = (matchCounts[p] || 0) + 1;
        }
    }
    for (const [proto, count] of Object.entries(matchCounts)) {
        const unit = kb.units.find(u => u.name === proto);
        if (!unit)
            continue;
        const alreadyEvidenced = (unit.evidence || []).some(e => e.repo === repoName);
        if (alreadyEvidenced)
            continue;
        let suggestion;
        let reason;
        if (count >= 10 && !unit.validatedRepos.includes(repoName)) {
            suggestion = "promote_to_stable";
            reason = `${count}/50 sequences matched — strong evidence. Adding this repo would make ${unit.name} eligible for stable promotion.`;
        }
        else if (count >= 3) {
            suggestion = "add_evidence";
            reason = `${count}/50 sequences matched — moderate evidence. Adding would increase confidence by ~5%.`;
        }
        else {
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
    }
    else if (args[0] === "suggest") {
        const benchmarkDir = "benchmarks";
        if (!fs.existsSync(benchmarkDir)) {
            console.log("No benchmarks directory");
            process.exit(0);
        }
        const allCandidates = [];
        for (const entry of fs.readdirSync(benchmarkDir)) {
            const seqFile = path.join(benchmarkDir, `${entry}-sequences.json`);
            if (fs.existsSync(seqFile)) {
                try {
                    allCandidates.push(...scanForEvidence(path.join(benchmarkDir, entry)));
                }
                catch { }
            }
        }
        const actionable = allCandidates.filter(c => c.suggestion !== "insufficient");
        console.log(`\nEvidence Growth Suggestions (${actionable.length} actionable):\n`);
        for (const c of actionable) {
            console.log(`  ${c.suggestion === "promote_to_stable" ? "⭐" : "✅"} ${c.repo} → ${c.protocol}: ${c.matchCount}/50 matches`);
        }
        if (actionable.length === 0)
            console.log("  No new evidence to suggest. All repos already covered.\n");
        else
            console.log(`\n  Run: npx ts-node src/knowledge-evolution.ts propose benchmarks/<repo>\n`);
    }
    else {
        console.log("Usage: scan <repoPath> | suggest");
    }
}
