"use strict";
/**
 * P6.4: Auto Protocol Synthesizer
 *
 * Converts unsupervised protocol clusters into executable Protocol VM rules.
 * Zero human intervention: trajectories → clusters → state machines → patches.
 *
 * Pipeline:
 *   1. Take DiscoveredClusters from P6.3
 *   2. Extract prototype sequence per cluster (centroid by edit distance)
 *   3. Generate state machine: S0→a1→S1→a2→S2...→Sn→∅
 *   4. Infer pre/post/invalidation from state transitions
 *   5. Output as KnowledgePatch (compatible with KnowledgePatchStore)
 *   6. Conflict detection with existing protocol rules
 *
 * This is the bridge from "pattern discovery" to "self-extending knowledge."
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.findPrototype = findPrototype;
exports.synthesizeProtocols = synthesizeProtocols;
exports.synthesizeAllKnownProtocols = synthesizeAllKnownProtocols;
exports.detectConflicts = detectConflicts;
exports.runAutoSynthesis = runAutoSynthesis;
exports.printSynthesisReport = printSynthesisReport;
const unsupervised_physics_1 = require("./experimental/unsupervised-physics");
const protocol_coverage_1 = require("./protocol-coverage");
const protocol_foundation_1 = require("./protocol-foundation");
const function_synonyms_1 = require("./function-synonyms");
// ═══════════════════════════════════════════════════════════════
// Prototype Selection
// ═══════════════════════════════════════════════════════════════
/** Levenshtein edit distance between two string arrays. */
function editDistance(a, b) {
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
/**
 * Find the prototype (centroid) sequence in a cluster.
 * The prototype is the sequence with minimum average edit distance to all others.
 */
function findPrototype(sequences) {
    if (sequences.length <= 1)
        return sequences[0] || [];
    let bestSeq = sequences[0];
    let bestDist = Infinity;
    for (const seq of sequences) {
        const totalDist = sequences.reduce((s, other) => s + editDistance(seq, other), 0);
        const avgDist = totalDist / sequences.length;
        if (avgDist < bestDist) {
            bestDist = avgDist;
            bestSeq = seq;
        }
    }
    return bestSeq;
}
/**
 * Generate a state machine from a prototype action sequence.
 *
 * For a sequence [A, B, C]:
 *   S0 → A → S1 → B → S2 → C → S3
 *
 * Rules:
 *   A: pre=[S0], post=[S1]
 *   B: pre=[S1], post=[S2]
 *   C: pre=[S2], post=[S3], invalidate=[S0,S1,S2,S3] (cleanup)
 */
function generateStateMachine(prototype, clusterId) {
    if (prototype.length === 0)
        return [];
    const rules = [];
    const statePrefix = clusterId.replace(/[^a-zA-Z0-9]/g, "_");
    // Generate semantic state names from action functions
    const stateNames = [];
    for (let i = 0; i < prototype.length; i++) {
        const fn = prototype[i];
        // Use domain-aware naming: "open"→FILE_OPEN, "close"→FILE_CLOSED
        const role = i === 0 ? "post" : i === prototype.length - 1 ? "invalidate" : "post";
        const semanticName = (0, protocol_foundation_1.inferStateName)(fn, role);
        // Deduplicate: if same semantic name appears, add index
        let finalName = semanticName;
        let suffix = 1;
        while (stateNames.includes(finalName)) {
            finalName = `${semanticName}_${suffix++}`;
        }
        stateNames.push(finalName);
    }
    for (let i = 0; i < prototype.length; i++) {
        const fn = prototype[i];
        const preState = i === 0 ? "INIT" : stateNames[i - 1];
        const postState = i < prototype.length - 1 ? stateNames[i] : `${statePrefix}_DONE`;
        const rule = {
            function: fn,
            pre_states: [preState],
            post_states: [postState],
        };
        // Last action: invalidate all intermediate states (cleanup / release)
        if (i === prototype.length - 1) {
            rule.invalidate = [...stateNames, postState];
        }
        rules.push(rule);
    }
    return rules;
}
// ═══════════════════════════════════════════════════════════════
// Protocol Synthesis
// ═══════════════════════════════════════════════════════════════
/**
 * Synthesize protocol rules from unsupervised clusters.
 *
 * For each cluster with inferred pattern, generates a state machine
 * and exportable rule set.
 */
function synthesizeProtocols(sequences) {
    // P6.9: Normalize function names before clustering (DB_Open→open, createClient→create_client)
    const normalized = sequences.map(seq => seq.map(function_synonyms_1.normalizeFunctionName));
    const clusters = (0, unsupervised_physics_1.clusterByStructure)(normalized);
    const results = [];
    for (const c of clusters) {
        if (!c.inferredPattern || c.sequences.length < 2)
            continue;
        const prototype = findPrototype(c.sequences);
        // P9.2p: Use V2 state machine generation for richer rules
        const rules = generateStateMachineV2(c.sequences, c.id);
        results.push({
            clusterId: c.id,
            prototype,
            rules,
            stateCount: prototype.length + 1,
            inferredPattern: c.inferredPattern,
            confidence: c.closedLoopRate,
        });
    }
    return results;
}
// ═══════════════════════════════════════════════════════════════
// P9.2p: State Machine V2 — frequency-based, multi-path rules
// ═══════════════════════════════════════════════════════════════
/**
 * Generate richer protocol rules using ALL sequences in a cluster,
 * not just the centroid prototype.
 *
 * Improvements over V1 (linear chain only):
 *   1. Frequency-based pre_states: each function can have multiple
 *      valid pre_states based on what actually precedes it in the data.
 *   2. Self-transitions: functions that appear consecutively with
 *      themselves (e.g., process→process) get self-loops.
 *   3. Multiple exit paths: any function that appears as the last
 *      call in a sequence is allowed to invalidate states.
 *   4. Entry points: functions that appear as first call in sequences
 *      get empty pre_states (always callable).
 */
function generateStateMachineV2(sequences, clusterId) {
    if (sequences.length === 0)
        return [];
    // Collect frequency data
    const fnPositions = new Map();
    const transitions = new Map(); // from → {to → count}
    for (const seq of sequences) {
        if (seq.length === 0)
            continue;
        for (let i = 0; i < seq.length; i++) {
            const fn = seq[i];
            if (!fnPositions.has(fn))
                fnPositions.set(fn, { first: 0, last: 0, mid: 0, total: 0 });
            const pos = fnPositions.get(fn);
            pos.total++;
            if (i === 0)
                pos.first++;
            if (i === seq.length - 1)
                pos.last++;
            if (i > 0 && i < seq.length - 1)
                pos.mid++;
            // Track transitions
            if (i < seq.length - 1) {
                const from = fn;
                const to = seq[i + 1];
                if (!transitions.has(from))
                    transitions.set(from, new Map());
                const toMap = transitions.get(from);
                toMap.set(to, (toMap.get(to) || 0) + 1);
            }
        }
    }
    const totalSeqs = sequences.length;
    const rules = [];
    const statePrefix = clusterId.replace(/[^a-zA-Z0-9]/g, "_");
    let stateCounter = 0;
    const fnToState = new Map();
    // Assign states to functions
    for (const [fn, pos] of fnPositions) {
        const stateName = pos.first / pos.total > 0.5 ? "INIT"
            : pos.last / pos.total > 0.5 ? `${statePrefix}_EXIT`
                : `${statePrefix}_S${stateCounter++}`;
        fnToState.set(fn, stateName);
    }
    // Generate rules
    for (const [fn, pos] of fnPositions) {
        const preStates = new Set();
        const postStates = new Set();
        const invalidateStates = new Set();
        // PRE_STATES: collect all unique predecessors
        for (const seq of sequences) {
            for (let i = 0; i < seq.length; i++) {
                if (seq[i] === fn) {
                    if (i === 0) {
                        preStates.add("INIT");
                    }
                    else {
                        const predState = fnToState.get(seq[i - 1]);
                        if (predState)
                            preStates.add(predState);
                    }
                }
            }
        }
        // POST_STATES: from fnToState, and from successors
        postStates.add(fnToState.get(fn) || `${statePrefix}_S${stateCounter++}`);
        const toMap = transitions.get(fn);
        if (toMap) {
            for (const [toFn] of toMap) {
                const toState = fnToState.get(toFn);
                if (toState && toState !== fnToState.get(fn))
                    postStates.add(toState);
            }
        }
        // INVALIDATE: functions that frequently end sequences
        if (pos.last / Math.max(1, pos.total) > 0.3) {
            // This function often ends sequences — it should invalidate accumulated states
            for (const pred of findPredecessors(fn, sequences)) {
                const predState = fnToState.get(pred);
                if (predState && predState !== "INIT")
                    invalidateStates.add(predState);
            }
        }
        // ENTRY POINTS: functions that frequently start sequences
        const preStatesArr = pos.first / Math.max(1, pos.total) > 0.5 ? [] : [...preStates];
        rules.push({
            function: fn,
            pre_states: preStatesArr,
            post_states: [...postStates],
            invalidate: invalidateStates.size > 0 ? [...invalidateStates] : undefined,
        });
    }
    return rules;
}
function findPredecessors(fn, sequences) {
    const preds = new Set();
    for (const seq of sequences) {
        for (let i = 1; i < seq.length; i++) {
            if (seq[i] === fn)
                preds.add(seq[i - 1]);
        }
    }
    return [...preds];
}
/**
 * Synthesize protocols from all known cross-repo sequences.
 */
function synthesizeAllKnownProtocols() {
    const allSeqs = [];
    for (const seqs of Object.values(unsupervised_physics_1.CROSS_REPO_SEQUENCES)) {
        allSeqs.push(...seqs);
    }
    return synthesizeProtocols(allSeqs);
}
/**
 * Detect conflicts between synthesized rules and existing protocol rules.
 *
 * A conflict = same function name but different pre/post states.
 */
function detectConflicts(synthesized, existingRules) {
    const reports = [];
    for (const sp of synthesized) {
        const conflicts = [];
        for (const sr of sp.rules) {
            const existing = existingRules.get(sr.function);
            if (existing) {
                // Check if rules are consistent
                const preMatch = sr.pre_states.length === existing.pre_states.length &&
                    sr.pre_states.every(s => existing.pre_states.includes(s));
                const postMatch = sr.post_states.length === existing.post_states.length &&
                    sr.post_states.every(s => existing.post_states.includes(s));
                if (!preMatch || !postMatch) {
                    conflicts.push({ fn: sr.function, existingRule: existing, synthesizedRule: sr });
                }
            }
        }
        reports.push({
            synthesized: sp,
            conflicts,
            hasConflicts: conflicts.length > 0,
        });
    }
    return reports;
}
/**
 * Full auto-synthesis pipeline:
 *   Sequences → Clusters → State Machines → Conflict Detection → Governance-ready
 */
function runAutoSynthesis(existingRules) {
    const protocols = synthesizeAllKnownProtocols();
    const defs = (0, protocol_coverage_1.loadDefaultProtocolDefinitions)();
    const rules = existingRules || new Map();
    for (const p of defs)
        for (const [fn, rule] of p.rules)
            rules.set(fn, rule);
    const conflicts = detectConflicts(protocols, rules);
    const totalRules = protocols.reduce((s, p) => s + p.rules.length, 0);
    const newFunctions = protocols.reduce((s, p) => {
        const newFns = p.rules.filter(r => !rules.has(r.function));
        return s + newFns.length;
    }, 0);
    const conflictCount = conflicts.filter(c => c.hasConflicts).length;
    return {
        protocols,
        conflicts,
        totalRules,
        newFunctions,
        conflictCount,
        readyForGovernance: conflictCount === 0 && newFunctions > 0,
    };
}
function printSynthesisReport(report) {
    console.log("\n╔════════════════════════════════════════════════════╗");
    console.log("║   P6.4 Auto Protocol Synthesizer                   ║");
    console.log("╚════════════════════════════════════════════════════╝\n");
    console.log(`Protocols Synthesized: ${report.protocols.length}`);
    console.log(`Total Rules:           ${report.totalRules}`);
    console.log(`New Functions:         ${report.newFunctions}`);
    console.log(`Conflicts:             ${report.conflictCount}`);
    console.log(`Ready for Governance:  ${report.readyForGovernance ? "✅ YES" : "❌ NO"}`);
    console.log();
    for (const p of report.protocols) {
        console.log(`  ${p.clusterId}: ${p.prototype.join(" → ")}`);
        console.log(`    Pattern: ${p.inferredPattern}, States: ${p.stateCount}, Rules: ${p.rules.length}`);
        for (const r of p.rules) {
            const inv = r.invalidate ? ` [inv: ${r.invalidate.join(",")}]` : "";
            console.log(`    ${r.function}: [${r.pre_states.join(",")}] → [${r.post_states.join(",")}]${inv}`);
        }
    }
    console.log();
    if (report.conflictCount > 0) {
        console.log("─── Conflicts ───");
        for (const c of report.conflicts.filter(c => c.hasConflicts)) {
            console.log(`  ${c.synthesized.clusterId}:`);
            for (const cf of c.conflicts) {
                console.log(`    ${cf.fn}: existing≠synthesized — needs governance review`);
            }
        }
        console.log();
    }
}
