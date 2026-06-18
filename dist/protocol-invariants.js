"use strict";
/**
 * P9.1: Protocol Invariant Mining & Violation Detection
 *
 * Upgrades from "graph shape comparison" to "temporal logic reasoning."
 * Defects don't live in graph topology — they live in STATE CONSTRAINT
 * violations (resource leaks, auth bypasses, double-frees).
 *
 * Core insight:
 *   P8 learns:    Acquire → Use (a valid graph shape)
 *   P9.1 detects: Acquire → Use ... END (violates "Eventually Release")
 *
 * Three invariant types:
 *   1. MUST_RELEASE:   Acquire ⇒ Eventually Release
 *   2. MUST_COMMIT:    Begin ⇒ Eventually Commit | Rollback
 *   3. MUST_PRECEDE:   Verify ⇒ Before PrivilegedAction
 *
 * Pipeline:
 *   State Machine → mine invariants → check sequences → report violations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectStructuralViolations = detectStructuralViolations;
exports.mineInvariants = mineInvariants;
exports.checkInvariants = checkInvariants;
exports.suggestRepair = suggestRepair;
exports.printInvariants = printInvariants;
exports.printViolations = printViolations;
const state_inference_1 = require("./state-inference");
/** Compare a test state machine against a template and report structural violations. */
function detectStructuralViolations(testSM, templateSM) {
    const violations = [];
    // Compare state counts: fewer states in test → something is missing
    const templateExits = templateSM.states.filter(s => s.role === "exit");
    const testExits = testSM.states.filter(s => s.role === "exit");
    const templateBridges = templateSM.states.filter(s => s.role === "bridge");
    if (templateSM.stateCount > testSM.stateCount) {
        const stateDiff = templateSM.stateCount - testSM.stateCount;
        // The missing state is likely an exit or terminal state
        // (test SM truncated early, so the last state(s) of the template are absent)
        violations.push({
            invariant: {
                type: "MUST_RELEASE",
                triggerState: "entry",
                requiredState: templateExits.map(e => e.id).join("|"),
                description: "Resource acquired must eventually be released",
                confidence: 0.95,
            },
            sequence: [],
            triggerIndex: 0,
            description: `Missing release: template has ${templateSM.stateCount} states, test has ${testSM.stateCount}. ${stateDiff} state(s) missing — resource leak detected.`,
            violationSubtype: "missing_release",
        });
    }
    if (templateBridges.length > 0) {
        const testBridges = testSM.states.filter(s => s.role === "bridge");
        if (testBridges.length < templateBridges.length) {
            violations.push({
                invariant: {
                    type: "MUST_PRECEDE",
                    triggerState: "bridge",
                    requiredState: "exit",
                    description: "Verification bridge must precede privileged action",
                    confidence: 0.9,
                },
                sequence: [],
                triggerIndex: 0,
                description: `Missing prerequisite: template has ${templateBridges.length} bridge state(s), test has ${testBridges.length}. Verification step skipped.`,
                violationSubtype: "missing_prerequisite",
            });
        }
    }
    // Missing transition edges
    const templateEdges = new Set();
    const testEdges = new Set();
    for (let i = 0; i < templateSM.stateTransitions.length; i++)
        for (let j = 0; j < (templateSM.stateTransitions[i] || []).length; j++)
            if (templateSM.stateTransitions[i][j] > 0)
                templateEdges.add(`${i}→${j}`);
    if (testSM.stateTransitions.length > 0)
        for (let i = 0; i < testSM.stateTransitions.length; i++)
            for (let j = 0; j < (testSM.stateTransitions[i] || []).length; j++)
                if (testSM.stateTransitions[i][j] > 0)
                    testEdges.add(`${i}→${j}`);
    if (templateEdges.size > testEdges.size * 1.5) {
        violations.push({
            invariant: {
                type: "MUST_COMMIT",
                triggerState: "bridge",
                requiredState: "exit",
                description: "Transaction must be completed with commit or rollback",
                confidence: 0.85,
            },
            sequence: [],
            triggerIndex: 0,
            description: `Incomplete lifecycle: template has ${templateEdges.size} transitions, test has ${testEdges.size}. Missing commit/rollback step.`,
            violationSubtype: "missing_commit",
        });
    }
    return violations;
}
// ═══════════════════════════════════════════════════════════════
// Invariant Mining
// ═══════════════════════════════════════════════════════════════
/**
 * Mine protocol invariants from a state machine.
 *
 * Strategy:
 *   MUST_RELEASE:  entry state whose reachable exit states include ∅
 *                  → every path from entry must pass through exit
 *   MUST_COMMIT:   state with two distinct exit paths (commit/rollback)
 *                  → every path through that state must reach one exit
 *   MUST_PRECEDE:  bridge state that always precedes an exit state
 *                  → exit state requires bridge state to precede it
 */
function mineInvariants(sm) {
    const invariants = [];
    if (sm.states.length === 0)
        return invariants;
    const entryStates = sm.states.filter(s => s.role === "entry");
    const exitStates = sm.states.filter(s => s.role === "exit");
    const bridgeStates = sm.states.filter(s => s.role === "bridge");
    // MUST_RELEASE: every entry that has at least one path to an exit
    for (const entry of entryStates) {
        for (const exit of exitStates) {
            if (exit.outDegree === 0 && entry.outDegree > 0) {
                // Check reachability: is there a path from entry to exit?
                const path = findPath(sm, entry, exit);
                if (path) {
                    invariants.push({
                        type: "MUST_RELEASE",
                        triggerState: entry.id,
                        requiredState: exit.id,
                        description: `${entry.id} ⇒ Eventually ${exit.id} (resource acquired must be released)`,
                        confidence: 0.9,
                    });
                    break; // one exit per entry is enough
                }
            }
        }
    }
    // MUST_COMMIT: any bridge state that connects to two different exits
    for (const bridge of bridgeStates) {
        const reachableExits = exitStates.filter(exit => findPath(sm, bridge, exit) !== null);
        if (reachableExits.length >= 2) {
            invariants.push({
                type: "MUST_COMMIT",
                triggerState: bridge.id,
                requiredState: reachableExits.map(e => e.id).join(" | "),
                description: `${bridge.id} ⇒ Eventually ${reachableExits.map(e => e.id).join(" | ")}`,
                confidence: 0.85,
            });
        }
    }
    // MUST_PRECEDE: exit state requires at least one bridge to precede it
    for (const exit of exitStates) {
        const predecessors = bridgeStates.filter(bridge => findPath(sm, bridge, exit) !== null);
        if (predecessors.length > 0) {
            invariants.push({
                type: "MUST_PRECEDE",
                triggerState: predecessors.map(p => p.id).join(","),
                requiredState: exit.id,
                description: `${predecessors.map(p => p.id).join(" → ")} must precede ${exit.id}`,
                confidence: 0.8,
            });
        }
    }
    return invariants;
}
/** BFS from source to target. Returns path if reachable, null otherwise. */
function findPath(sm, from, to) {
    const S = sm.states.length;
    const fromIdx = sm.states.indexOf(from);
    const toIdx = sm.states.indexOf(to);
    if (fromIdx < 0 || toIdx < 0)
        return null;
    const visited = new Set();
    const parent = new Map();
    const queue = [fromIdx];
    visited.add(fromIdx);
    while (queue.length > 0) {
        const curr = queue.shift();
        if (curr === toIdx) {
            // Reconstruct path
            const path = [curr];
            let node = curr;
            while (parent.has(node)) {
                node = parent.get(node);
                path.unshift(node);
            }
            return path;
        }
        for (let j = 0; j < S; j++) {
            if (sm.stateTransitions[curr]?.[j] > 0 && !visited.has(j)) {
                visited.add(j);
                parent.set(j, curr);
                queue.push(j);
            }
        }
    }
    return null;
}
// ═══════════════════════════════════════════════════════════════
// Violation Detection
// ═══════════════════════════════════════════════════════════════
/**
 * Check a call sequence against mined invariants and report violations.
 *
 * For each invariant:
 *   MUST_RELEASE: look for trigger without required continuation
 *   MUST_COMMIT: look for trigger without commit/rollback continuation
 *   MUST_PRECEDE: look for required state without preceding trigger
 *
 * This uses STATE INFERENCE to map the call sequence to states,
 * then checks whether invariants hold in the inferred state machine.
 *
 * @param sequence   The call sequence to check
 * @param invariants Mined protocol invariants
 * @returns Violations found
 */
function checkInvariants(sequence, invariants) {
    if (sequence.length < 2 || invariants.length === 0)
        return [];
    // Infer state machine from the sequence
    const sm = (0, state_inference_1.inferStateMachine)([sequence]);
    const violations = [];
    for (const inv of invariants) {
        switch (inv.type) {
            case "MUST_RELEASE": {
                // Look for entry state without matching exit in the sequence's state machine
                const hasEntry = sm.states.some(s => s.role === "entry");
                const hasExit = sm.states.some(s => s.role === "exit");
                if (hasEntry && !hasExit) {
                    violations.push({
                        invariant: inv,
                        sequence,
                        triggerIndex: 0,
                        description: `Missing release: sequence starts with acquire but never releases (violates: ${inv.description})`,
                        violationSubtype: "missing_release",
                    });
                }
                break;
            }
            case "MUST_COMMIT": {
                // Look for bridge state with self-loops but no exit
                const bridges = sm.states.filter(s => s.role === "bridge" && s.outDegree > 0);
                const exits = sm.states.filter(s => s.role === "exit");
                if (bridges.length > 0 && exits.length === 0) {
                    violations.push({
                        invariant: inv,
                        sequence,
                        triggerIndex: sequence.length - 1,
                        description: `Missing commit/rollback: transaction started but not terminated (violates: ${inv.description})`,
                        violationSubtype: "missing_commit",
                    });
                }
                break;
            }
            case "MUST_PRECEDE": {
                // Look for exit state without preceding bridge
                const hasBridge = sm.states.some(s => s.role === "bridge");
                const hasExit = sm.states.some(s => s.role === "exit");
                if (hasExit && !hasBridge) {
                    violations.push({
                        invariant: inv,
                        sequence,
                        triggerIndex: 0,
                        description: `Missing prerequisite: privileged action without prior verification (violates: ${inv.description})`,
                        violationSubtype: "missing_prerequisite",
                    });
                }
                break;
            }
        }
    }
    return violations;
}
/**
 * Suggest repairs for detected invariant violations.
 *
 * @param violation The detected violation
 * @param sm Full state machine (from training/protocol definition)
 */
function suggestRepair(violation, sm) {
    const inv = violation.invariant;
    switch (inv.type) {
        case "MUST_RELEASE": {
            // Find the exit state and suggest its associated function
            const exitState = sm.states.find(s => s.role === "exit" && inv.requiredState.includes(s.id));
            if (exitState) {
                return {
                    violation,
                    suggestedFix: [`release_${exitState.id}`],
                    description: `Add release step to satisfy: ${inv.description}`,
                };
            }
            break;
        }
        case "MUST_COMMIT": {
            const exitStates = sm.states.filter(s => s.role === "exit" && inv.requiredState.includes(s.id));
            if (exitStates.length > 0) {
                return {
                    violation,
                    suggestedFix: [`commit_${exitStates[0].id}`],
                    description: `Add commit/rollback to satisfy: ${inv.description}`,
                };
            }
            break;
        }
        case "MUST_PRECEDE": {
            const bridgeStates = sm.states.filter(s => s.role === "bridge" && inv.triggerState.includes(s.id));
            if (bridgeStates.length > 0) {
                return {
                    violation,
                    suggestedFix: [`verify_${bridgeStates[0].id}`],
                    description: `Add verification step before privileged action: ${inv.description}`,
                };
            }
            break;
        }
    }
    return null;
}
// ═══════════════════════════════════════════════════════════════
// Reporting
// ═══════════════════════════════════════════════════════════════
function printInvariants(invariants) {
    console.log(`\n─── Mined Protocol Invariants (${invariants.length}) ───`);
    for (const inv of invariants) {
        const icon = inv.type === "MUST_RELEASE" ? "🔒" : inv.type === "MUST_COMMIT" ? "🔐" : "🔑";
        console.log(`  ${icon} [${inv.confidence.toFixed(0)}] ${inv.description}`);
    }
}
function printViolations(violations) {
    if (violations.length === 0) {
        console.log(`  ✅ No invariant violations detected.`);
        return;
    }
    console.log(`\n─── Invariant Violations (${violations.length}) ───`);
    for (const v of violations) {
        console.log(`  ❌ ${v.description}`);
        console.log(`     Sequence: ${v.sequence.join(" → ")}`);
    }
}
