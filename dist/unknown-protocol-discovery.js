"use strict";
/**
 * P8.2: Unknown Protocol Discovery — Zero-Shot Transfer
 *
 * The decisive test for protocol structure learning:
 *   1. Train on known repos (Redis, SQLite)
 *   2. Discover protocols in an UNSEEN repo (PostgreSQL)
 *   3. Repair defects using ONLY discovered knowledge
 *
 * Success = the system can understand code it has NEVER seen before.
 * This is the bridge from "protocol library" to "software world model."
 *
 * Pipeline:
 *   Known repos → state machine fingerprints → fingerprint library
 *   Unknown repo → extract sequences → cluster → synthesize → state machine
 *   Match unknown state machines against known library → transfer or infer
 *
 * North star metric: zero-shot repair success rate on unseen repos.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildKnownFingerprintLibrary = buildKnownFingerprintLibrary;
exports.extractUnknownRepoSequences = extractUnknownRepoSequences;
exports.discoverProtocolsFromSequences = discoverProtocolsFromSequences;
exports.evaluateZeroShotRepair = evaluateZeroShotRepair;
exports.runZeroShotDiscovery = runZeroShotDiscovery;
exports.printZeroShotResult = printZeroShotResult;
const state_machine_fingerprint_1 = require("./state-machine-fingerprint");
const unsupervised_physics_1 = require("./unsupervised-physics");
const auto_protocol_synthesizer_1 = require("./auto-protocol-synthesizer");
const protocol_frontier_1 = require("./protocol-frontier");
const protocol_coverage_1 = require("./protocol-coverage");
// ═══════════════════════════════════════════════════════════════
// Step 1: Build known fingerprint library
// ═══════════════════════════════════════════════════════════════
/**
 * Build a fingerprint library from known protocol groups.
 * Each entry maps a protocol name to its state machine fingerprint.
 */
function buildKnownFingerprintLibrary() {
    const defs = (0, protocol_coverage_1.loadDefaultProtocolDefinitions)();
    const library = new Map();
    for (const p of defs) {
        if (p.rules.size === 0)
            continue;
        library.set(p.name, (0, state_machine_fingerprint_1.extractStateMachine)(p.rules));
    }
    return library;
}
// ═══════════════════════════════════════════════════════════════
// Step 2: Extract call sequences from an unknown repo
// ═══════════════════════════════════════════════════════════════
/**
 * Extract raw call sequences from a repo by name.
 * Uses CROSS_REPO_SEQUENCES as the data source.
 */
function extractUnknownRepoSequences(repoName) {
    return unsupervised_physics_1.CROSS_REPO_SEQUENCES[repoName] || [];
}
// ═══════════════════════════════════════════════════════════════
// Step 3: Discover protocols from raw sequences
// ═══════════════════════════════════════════════════════════════
/**
 * Discover protocols from raw call sequences using P8.1 state machine fingerprints.
 *
 * Algorithm:
 *   1. Synthesize protocol rules from sequences via auto-protocol-synthesizer
 *   2. Build name-free state machine fingerprints from synthesized rules
 *   3. Match against known fingerprint library
 *   4. Return discovered protocols with transfer annotations
 */
function discoverProtocolsFromSequences(sequences, repoName, knownLibrary) {
    if (sequences.length === 0)
        return [];
    // 1. Synthesize protocol rules from sequences (P6.4)
    const synthesized = (0, auto_protocol_synthesizer_1.synthesizeProtocols)(sequences);
    if (synthesized.length === 0) {
        // Fallback: create a simple linear chain synthesization
        return [buildFallbackProtocol(sequences, repoName, knownLibrary)];
    }
    const discovered = [];
    for (const synth of synthesized) {
        // 2. Convert synthesized rules to StateAnnotation map for fingerprint extraction
        const ruleMap = new Map();
        for (const r of synth.rules) {
            ruleMap.set(r.function, {
                pre_states: r.pre_states,
                post_states: r.post_states,
                invalidate: r.invalidate,
            });
        }
        // 3. Extract name-free state machine fingerprint
        const fingerprint = (0, state_machine_fingerprint_1.extractStateMachine)(ruleMap);
        // 4. Match against known library
        let closestKnown;
        let matchConfidence = 0;
        if (knownLibrary && knownLibrary.size > 0) {
            for (const [name, knownFp] of knownLibrary) {
                const comp = (0, state_machine_fingerprint_1.compareStateMachines)(fingerprint, knownFp);
                if (comp.similarity > matchConfidence) {
                    matchConfidence = comp.similarity;
                    closestKnown = name;
                }
            }
        }
        discovered.push({
            name: `${repoName}_${synth.clusterId}`,
            fingerprint,
            rules: synth.rules,
            prototype: synth.prototype,
            closestKnown,
            matchConfidence: Math.round(matchConfidence * 10000) / 10000,
        });
    }
    return discovered;
}
/** Fallback: build a simple protocol from sequences when synthesizer fails. */
function buildFallbackProtocol(sequences, repoName, knownLibrary) {
    // Find the most common pattern: longest common subsequence
    const prototype = sequences.reduce((a, b) => a.length >= b.length ? a : b, sequences[0] || []);
    const rules = prototype.map((fn, i) => ({
        function: fn,
        pre_states: i === 0 ? [] : [`STATE_${i - 1}`],
        post_states: i < prototype.length - 1 ? [`STATE_${i}`] : [],
        invalidate: i === prototype.length - 1 ? [`STATE_${i - 1}`] : undefined,
    }));
    const ruleMap = new Map();
    for (const r of rules) {
        ruleMap.set(r.function, {
            pre_states: r.pre_states,
            post_states: r.post_states,
            invalidate: r.invalidate,
        });
    }
    const fingerprint = (0, state_machine_fingerprint_1.extractStateMachine)(ruleMap);
    let closestKnown;
    let matchConfidence = 0;
    if (knownLibrary) {
        for (const [name, knownFp] of knownLibrary) {
            const comp = (0, state_machine_fingerprint_1.compareStateMachines)(fingerprint, knownFp);
            if (comp.similarity > matchConfidence) {
                matchConfidence = comp.similarity;
                closestKnown = name;
            }
        }
    }
    return {
        name: `${repoName}_fallback`,
        fingerprint,
        rules,
        prototype,
        closestKnown,
        matchConfidence: Math.round(matchConfidence * 10000) / 10000,
    };
}
/**
 * Attempt zero-shot repair using discovered protocol knowledge.
 *
 * For each defect case:
 *   1. Build a state machine from the discovered protocol's rules
 *   2. Use frontier exploration to find a path from the broken state to the expected completion
 *   3. Check if any discovered fix path covers the missing steps
 *
 * @returns { success, total } counts for repair rate calculation
 */
function evaluateZeroShotRepair(discovered, defectCases) {
    let success = 0;
    const details = [];
    for (const defect of defectCases) {
        let repaired = false;
        for (const proto of discovered) {
            // Build rule map from discovered protocol
            const rules = new Map();
            for (const r of proto.rules) {
                rules.set(r.function, {
                    pre_states: r.pre_states,
                    post_states: r.post_states,
                    invalidate: r.invalidate,
                });
            }
            if (rules.size === 0)
                continue;
            // Build reverse index: for each function in the discovered rules,
            // find the closest matching function in the defect by edit distance.
            // This bridges the name gap between original names and normalized names.
            const ruleFns = [...rules.keys()];
            const defectFns = new Set([...defect.broken, ...defect.expected]);
            const nameMap = new Map(); // defect name → rule name
            for (const dfn of defectFns) {
                let bestFn = "";
                let bestDist = Infinity;
                const lower = dfn.toLowerCase();
                for (const rfn of ruleFns) {
                    // Simple substring match first, then edit distance
                    if (lower.includes(rfn) || rfn.includes(lower)) {
                        bestFn = rfn;
                        break;
                    }
                    const dist = levenshtein(lower, rfn);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestFn = rfn;
                    }
                }
                if (bestFn)
                    nameMap.set(dfn, bestFn);
            }
            // Map broken sequence through the name map
            const mappedBroken = defect.broken.map(fn => nameMap.get(fn) || fn);
            const mappedExpected = defect.expected.map(fn => nameMap.get(fn) || fn);
            // Simulate state machine with mapped sequence
            // Initialize with namespace initial states (INIT is the universal default)
            const currentStates = new Set(["INIT"]);
            for (const fn of mappedBroken) {
                const rule = rules.get(fn);
                if (!rule)
                    continue;
                if (!rule.pre_states.every(s => currentStates.has(s)) && rule.pre_states.length > 0)
                    continue;
                if (rule.invalidate)
                    rule.invalidate.forEach(s => currentStates.delete(s));
                for (const s of rule.post_states)
                    currentStates.add(s);
            }
            // Frontier exploration for completion paths
            const paths = (0, protocol_frontier_1.exploreFrontier)(rules, [...currentStates], 20, 8);
            // Check if any path + broken covers the expected (using mapped names)
            for (const path of paths) {
                const full = [...mappedBroken, ...path];
                const allExpected = mappedExpected.every(fn => full.includes(fn));
                if (allExpected && path.length > 0) {
                    repaired = true;
                    details.push(`${defect.description}: ✅ via ${proto.name} (${path.join(" → ")})`);
                    break;
                }
            }
            if (repaired)
                break;
        }
        if (!repaired) {
            details.push(`${defect.description}: ❌`);
        }
        if (repaired)
            success++;
    }
    return { success, total: defectCases.length, details };
}
/** Levenshtein edit distance between two strings. */
function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++)
        dp[i][0] = i;
    for (let j = 0; j <= n; j++)
        dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[m][n];
}
// ═══════════════════════════════════════════════════════════════
// Full Pipeline
// ═══════════════════════════════════════════════════════════════
/**
 * Run the full zero-shot discovery pipeline:
 *   1. Build known library from TRAIN repos
 *   2. Discover protocols in TEST repo
 *   3. Evaluate zero-shot repair
 *
 * @param trainRepos  Repos used to build the known fingerprint library
 * @param testRepo    Unseen repo for zero-shot discovery
 * @param defectCases Defect cases to test repair on
 */
function runZeroShotDiscovery(trainRepos, testRepo, defectCases) {
    // 1. Build known fingerprint library from train repos
    const knownLibrary = new Map();
    for (const repo of trainRepos) {
        const seqs = extractUnknownRepoSequences(repo);
        if (seqs.length === 0)
            continue;
        // Discover protocols in training repos
        const trainDiscovered = discoverProtocolsFromSequences(seqs, repo, undefined);
        for (const proto of trainDiscovered) {
            knownLibrary.set(proto.name, proto.fingerprint);
        }
    }
    // Add hand-written protocol fingerprints to the library
    const handWritten = buildKnownFingerprintLibrary();
    for (const [name, fp] of handWritten) {
        knownLibrary.set(name, fp);
    }
    // 2. Discover protocols in test repo (zero-shot)
    const testSeqs = extractUnknownRepoSequences(testRepo);
    const discovered = discoverProtocolsFromSequences(testSeqs, testRepo, knownLibrary);
    // 3. Evaluate zero-shot repair
    const repairResult = evaluateZeroShotRepair(discovered, defectCases);
    return {
        discoveredCount: discovered.length,
        discovered,
        repairSuccess: repairResult.success,
        repairTotal: repairResult.total,
        repairRate: repairResult.total > 0 ? repairResult.success / repairResult.total : 0,
    };
}
// ═══════════════════════════════════════════════════════════════
// Reporting
// ═══════════════════════════════════════════════════════════════
function printZeroShotResult(result) {
    console.log("\n╔════════════════════════════════════════════════════╗");
    console.log("║   P8.2 Unknown Protocol Discovery — Zero-Shot      ║");
    console.log("╚════════════════════════════════════════════════════╝\n");
    console.log(`  Discovered: ${result.discoveredCount} protocol(s)`);
    for (const proto of result.discovered) {
        console.log(`\n  ── ${proto.name} ──`);
        console.log(`    Prototype:      ${proto.prototype.join(" → ")}`);
        console.log(`    States:         ${proto.fingerprint.stateCount}`);
        console.log(`    Transitions:    ${proto.fingerprint.transitions.length}`);
        console.log(`    Entry points:   ${proto.fingerprint.entryStates.length}`);
        console.log(`    Exit points:    ${proto.fingerprint.exitStates.length}`);
        console.log(`    Branch states:  ${proto.fingerprint.branchStates.length}`);
        console.log(`    DAG:            ${proto.fingerprint.isDAG}`);
        if (proto.closestKnown) {
            console.log(`    Closest known:  ${proto.closestKnown} (${(proto.matchConfidence * 100).toFixed(0)}%)`);
        }
        else {
            console.log(`    Closest known:  none (novel protocol)`);
        }
    }
    console.log(`\n  ── Zero-Shot Repair ──`);
    console.log(`    Success: ${result.repairSuccess}/${result.repairTotal}`);
    console.log(`    Rate:    ${(result.repairRate * 100).toFixed(0)}%`);
    const verdict = result.repairRate > 0.5
        ? "✅ ZERO-SHOT TRANSFER ACHIEVED"
        : result.repairRate > 0
            ? "⚠️  PARTIAL — structure signal present but repair gap remains"
            : "❌ No transfer — protocol structure not yet generalizing";
    console.log(`    Verdict: ${verdict}\n`);
}
