"use strict";
/**
 * P8.2: Topology Factory — programmatic protocol state machine generation
 *
 * Generates protocol rule sets for 10 distinct topology types,
 * enabling diverse benchmark construction without hand-writing
 * each protocol. Every topology is defined purely by its
 * state transition structure — function names are auto-generated.
 *
 * 10 topologies:
 *   T1  linear            A→B→C→D chain
 *   T2  star              hub with radial spokes
 *   T3  tree              branching decision tree
 *   T4  loop              self-transition cycle with exit
 *   T5  two_phase_commit  prepare → commit/rollback fork
 *   T6  auth_bridge       auth gate → multiple resources
 *   T7  nested            inner/outer resource dependency
 *   T8  rollback          reversible forward/backward edges
 *   T9  fan_out           fork-join parallelism
 *   T10 stateless         self-loop only, no state change
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_TOPOLOGIES = void 0;
exports.createProtocolForTopology = createProtocolForTopology;
exports.ALL_TOPOLOGIES = [
    "linear", "star", "tree", "loop", "two_phase_commit",
    "auth_bridge", "nested", "rollback", "fan_out", "stateless",
];
/**
 * Create protocol rules for a given topology type.
 * Returns SSG-compatible StateAnnotation map.
 */
function createProtocolForTopology(type, numStates) {
    const rules = buildRules(type, numStates);
    const map = new Map();
    // Convert ProtocolRule[] to Map<string, StateAnnotation>
    // Group by action (function name) — each function appears once
    const byAction = new Map();
    for (const r of rules) {
        if (!byAction.has(r.action)) {
            byAction.set(r.action, { from: new Set(), to: new Set() });
        }
        byAction.get(r.action).from.add(r.from);
        byAction.get(r.action).to.add(r.to);
    }
    for (const [action, { from, to }] of byAction) {
        const postStates = [...to];
        // Invalidation: states in "from" that are NOT in "to" for this action
        // and NOT in "from" for any subsequent action that depends on them
        const invalidate = [];
        for (const f of from) {
            // Check if any other action requires this state as a pre_state
            let stillNeeded = false;
            for (const [otherAction, otherEntry] of byAction) {
                if (otherAction === action)
                    continue; // skip self
                if (otherEntry.from.has(f)) {
                    stillNeeded = true;
                    break;
                }
            }
            if (!stillNeeded && !to.has(f)) {
                invalidate.push(f);
            }
        }
        map.set(action, {
            pre_states: [...from],
            post_states: postStates.length > 0 ? postStates : [],
            invalidate: invalidate.length > 0 ? invalidate : undefined,
            namespace: type,
        });
    }
    return map;
}
function buildRules(type, n) {
    switch (type) {
        case "linear": return buildLinear(n || 4);
        case "star": return buildStar();
        case "tree": return buildTree(2, 2);
        case "loop": return buildLoop();
        case "two_phase_commit": return buildTwoPhaseCommit();
        case "auth_bridge": return buildAuthBridge();
        case "nested": return buildNested();
        case "rollback": return buildRollback();
        case "fan_out": return buildFanOut();
        case "stateless": return buildStateless();
    }
}
function buildLinear(n) {
    const rules = [];
    for (let i = 0; i < n; i++) {
        const from = i === 0 ? "INIT" : `S${i - 1}`;
        const to = i < n - 1 ? `S${i}` : `S${n - 1}_DONE`;
        const action = i === 0 ? "open" : i === n - 1 ? "close" : `op${i}`;
        rules.push({ from, to, action });
    }
    return rules;
}
function buildStar() {
    return [
        { from: "INIT", to: "HUB", action: "acquire" },
        { from: "HUB", to: "LEAF1", action: "use_a" },
        { from: "LEAF1", to: "HUB", action: "release_a" },
        { from: "HUB", to: "LEAF2", action: "use_b" },
        { from: "LEAF2", to: "HUB", action: "release_b" },
        { from: "HUB", to: "LEAF3", action: "use_c" },
        { from: "LEAF3", to: "HUB", action: "release_c" },
        { from: "HUB", to: "DONE", action: "destroy" },
    ];
}
function buildTree(branchFactor, depth) {
    const rules = [];
    rules.push({ from: "INIT", to: "ROOT", action: "enter" });
    let nodeCount = 1;
    const id = (d, b) => `N${d}_${b}`;
    for (let d = 0; d < depth; d++) {
        const nodesAtLevel = Math.pow(branchFactor, d);
        for (let n = 0; n < nodesAtLevel; n++) {
            for (let b = 0; b < branchFactor; b++) {
                const child = nodeCount++;
                rules.push({
                    from: d === 0 && n === 0 ? "ROOT" : id(d, n),
                    to: id(d + 1, child),
                    action: `branch_d${d}_b${b}`,
                });
            }
        }
    }
    return rules;
}
function buildLoop() {
    return [
        { from: "INIT", to: "LOOP", action: "init_loop" },
        { from: "LOOP", to: "LOOP", action: "process" },
        { from: "LOOP", to: "LOOP", action: "poll" },
        { from: "LOOP", to: "EXIT", action: "exit_loop" },
        { from: "LOOP", to: "EXIT", action: "timeout" },
    ];
}
function buildTwoPhaseCommit() {
    return [
        { from: "INIT", to: "TX_ACTIVE", action: "begin_tx" },
        { from: "TX_ACTIVE", to: "TX_ACTIVE", action: "insert" },
        { from: "TX_ACTIVE", to: "TX_ACTIVE", action: "update" },
        { from: "TX_ACTIVE", to: "PREPARED", action: "prepare" },
        { from: "PREPARED", to: "COMMITTED", action: "commit" },
        { from: "PREPARED", to: "ABORTED", action: "rollback" },
    ];
}
function buildAuthBridge() {
    return [
        { from: "INIT", to: "AUTHED", action: "authenticate" },
        { from: "AUTHED", to: "FILE_OPEN", action: "open_file" },
        { from: "FILE_OPEN", to: "AUTHED", action: "close_file" },
        { from: "AUTHED", to: "DB_OPEN", action: "connect_db" },
        { from: "DB_OPEN", to: "AUTHED", action: "disconnect_db" },
        { from: "AUTHED", to: "INIT", action: "logout" },
    ];
}
function buildNested() {
    return [
        { from: "INIT", to: "OUTER_HELD", action: "acquire_outer" },
        { from: "OUTER_HELD", to: "INNER_HELD", action: "acquire_inner" },
        { from: "INNER_HELD", to: "OUTER_HELD", action: "release_inner" },
        { from: "OUTER_HELD", to: "DONE", action: "release_outer" },
    ];
}
function buildRollback() {
    return [
        { from: "INIT", to: "S1", action: "step1" },
        { from: "S1", to: "S2", action: "step2" },
        { from: "S2", to: "S3", action: "step3" },
        { from: "S3", to: "DONE", action: "commit_all" },
        { from: "S2", to: "S1", action: "undo_step2" },
        { from: "S3", to: "S2", action: "undo_step3" },
    ];
}
function buildFanOut() {
    return [
        { from: "INIT", to: "A", action: "fork_a" },
        { from: "INIT", to: "B", action: "fork_b" },
        { from: "INIT", to: "C", action: "fork_c" },
        { from: "A", to: "JOIN", action: "op_a" },
        { from: "B", to: "JOIN", action: "op_b" },
        { from: "C", to: "JOIN", action: "op_c" },
        { from: "JOIN", to: "DONE", action: "merge" },
    ];
}
function buildStateless() {
    return [
        { from: "IDLE", to: "IDLE", action: "compute_hash" },
        { from: "IDLE", to: "IDLE", action: "validate_input" },
        { from: "IDLE", to: "IDLE", action: "encode_payload" },
        { from: "IDLE", to: "IDLE", action: "decode_payload" },
    ];
}
