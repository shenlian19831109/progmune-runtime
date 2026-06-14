"use strict";
/**
 * Scale Trajectory Collector
 *
 * Generates 500+ validated trajectories from repo signatures
 * using AST extraction + augmentation + Protocol VM validation.
 *
 * Pipeline:
 *   Repo Signatures → AST extraction → Synonym normalization
 *   → Random walks → Mutations → Validation → Dedup → Corpus
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectTrajectoriesAtScale = collectTrajectoriesAtScale;
exports.printCollectionReport = printCollectionReport;
const protocol_mining_1 = require("./protocol-mining");
const trajectory_corpus_1 = require("./trajectory-corpus");
const unsupervised_physics_1 = require("./unsupervised-physics");
const trajectory_augmentation_1 = require("./trajectory-augmentation");
const function_synonyms_1 = require("./function-synonyms");
const software_physics_1 = require("./software-physics");
const protocol_coverage_1 = require("./protocol-coverage");
const auto_protocol_synthesizer_1 = require("./auto-protocol-synthesizer");
/**
 * Collect trajectories at scale from all available sources.
 *
 * Combines:
 *   1. Mining signatures (21 repos, 64 sequences)
 *   2. Expanded trajectories (10 libraries, 50 sequences)
 *   3. Cross-repo sequences (5 repos, 15 sequences)
 *   4. Random walks from protocol rules
 *   5. Mutations of existing trajectories
 *
 * All sequences are normalized, validated, and deduplicated.
 */
function collectTrajectoriesAtScale() {
    // Collect all source sequences
    const sourceSeqs = [];
    // Source 1: Mining signatures
    for (const sig of protocol_mining_1.MINING_SIGNATURES) {
        for (const p of sig.patterns) {
            if (p.length >= 2)
                sourceSeqs.push(p);
        }
    }
    // Source 2: Expanded trajectories
    for (const lib of trajectory_corpus_1.EXPANDED_TRAJECTORIES) {
        for (const seq of lib.sequences) {
            if (seq.length >= 2)
                sourceSeqs.push(seq);
        }
    }
    // Source 3: Cross-repo sequences
    for (const seqs of Object.values(unsupervised_physics_1.CROSS_REPO_SEQUENCES)) {
        for (const seq of seqs) {
            if (seq.length >= 2)
                sourceSeqs.push(seq);
        }
    }
    const sourceCount = sourceSeqs.length;
    const uniqueSources = new Set(sourceSeqs.map(s => s.join("→")));
    // Normalize all sequences
    const normalized = sourceSeqs.map(seq => seq.map(function_synonyms_1.normalizeFunctionName));
    // Build protocol rules for validation
    const defs = (0, protocol_coverage_1.loadDefaultProtocolDefinitions)();
    const rules = new Map();
    const nsInit = new Map();
    for (const p of defs) {
        nsInit.set(p.name, p.initialState);
        for (const [fn, rule] of p.rules)
            rules.set(fn, rule);
    }
    const synthesized = (0, auto_protocol_synthesizer_1.synthesizeAllKnownProtocols)();
    for (const sp of synthesized) {
        for (const sr of sp.rules) {
            rules.set(sr.function, {
                pre_states: sr.pre_states,
                post_states: sr.post_states,
                invalidate: sr.invalidate,
            });
        }
    }
    // Generate random walks from all rules + synthesized (push to 200+)
    const walks = (0, trajectory_augmentation_1.generateRandomWalks)(rules, 5000, 2, 10, nsInit);
    const normalizedWalks = walks.map(seq => seq.map(function_synonyms_1.normalizeFunctionName));
    // Generate mutations at scale
    const seedForMutations = [...normalized, ...normalizedWalks];
    const mutations = (0, trajectory_augmentation_1.mutateTrajectories)(seedForMutations.slice(0, 800), rules, 3000);
    const normalizedMutations = mutations.map(seq => seq.map(function_synonyms_1.normalizeFunctionName));
    // Combine all
    const allSequences = [...normalized, ...normalizedWalks, ...normalizedMutations];
    // Validate: only keep valid physics sequences
    let valid = allSequences.filter(seq => (0, software_physics_1.isValidPhysicsSequence)(seq).valid);
    // Deduplicate
    const seen = new Set();
    const unique = [];
    for (const seq of valid) {
        const key = seq.join("→");
        if (!seen.has(key) && seq.length >= 2) {
            seen.add(key);
            unique.push(seq);
        }
    }
    return {
        sequences: unique,
        report: {
            sourceRepos: protocol_mining_1.MINING_SIGNATURES.length + trajectory_corpus_1.EXPANDED_TRAJECTORIES.length,
            sourceSequences: sourceCount,
            randomWalks: walks.length,
            mutations: mutations.length,
            totalCollected: allSequences.length,
            validSequences: valid.length,
            duplicateRemoved: valid.length - unique.length,
            finalCorpusSize: unique.length,
        },
    };
}
function printCollectionReport(report) {
    console.log("\n─── Scale Trajectory Collection Report ───");
    console.log(`  Source Repos:        ${report.sourceRepos}`);
    console.log(`  Source Sequences:    ${report.sourceSequences}`);
    console.log(`  Random Walks:        ${report.randomWalks}`);
    console.log(`  Mutations:           ${report.mutations}`);
    console.log(`  Total Collected:     ${report.totalCollected}`);
    console.log(`  Valid Sequences:     ${report.validSequences}`);
    console.log(`  Duplicates Removed:  ${report.duplicateRemoved}`);
    console.log(`  Final Corpus Size:   ${report.finalCorpusSize}`);
    console.log();
}
