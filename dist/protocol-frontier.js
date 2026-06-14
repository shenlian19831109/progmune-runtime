"use strict";
/**
 * P3.14-15: Protocol Frontier Explorer + Cross-Protocol Planner
 *
 * P3.14: BFS-based state→state search without template dependency.
 *   Given currentState and targetState, auto-discovers paths like
 *   SESSION_ACTIVE → logout → SESSION_CLOSED without needing
 *   a template for every goal variant.
 *
 * P3.15: Cross-protocol meta-graph for multi-protocol repair chains.
 *   Auth → File → DB → IR protocol composition.
 *   Enables repairs like "auth then file write then db insert".
 *
 * Target: reduce missing_candidate from 49% to <20%.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchFrontier = searchFrontier;
exports.searchFrontierMulti = searchFrontierMulti;
exports.exploreFrontier = exploreFrontier;
exports.planCrossProtocol = planCrossProtocol;
exports.getProtocolBridges = getProtocolBridges;
exports.expandCrossProtocolCandidates = expandCrossProtocolCandidates;
const protocol_coverage_1 = require("./protocol-coverage");
/**
 * BFS from currentState to find the shortest path reaching targetState.
 *
 * Unlike Goal Templates (which require manual patterns), this searches
 * the protocol state graph directly. It discovers paths like:
 *   - SESSION_ACTIVE → logout → UNAUTHENTICATED
 *   - FILE_OPEN → close_file → (FILE_OPEN invalidated)
 *   - DB_CONNECTED → disconnect_db → (DB_CONNECTED invalidated)
 *
 * Works for any state pair defined in the protocol rules.
 */
function searchFrontier(rules, currentStates, targetStates, maxDepth = 8) {
    if (currentStates.length === 0) {
        // If no current states, start from rules with no pre_states
        const startable = new Set();
        for (const [fn, rule] of rules) {
            if (rule.pre_states.length === 0) {
                for (const post of rule.post_states)
                    startable.add(post);
            }
        }
        if (startable.size > 0) {
            currentStates = [...startable];
        }
    }
    const currentSet = new Set(currentStates);
    const targetSet = new Set(targetStates);
    // BFS
    const visited = new Set();
    const queue = [
        { states: new Set(currentStates), actions: [], stateList: [...currentStates], cost: 0 },
    ];
    visited.add([...currentStates].sort().join(","));
    while (queue.length > 0) {
        const { states, actions, stateList, cost } = queue.shift();
        // Target reached?
        if (targetStates.length > 0 && targetStates.every(t => states.has(t))) {
            return { actions, states: stateList, cost, found: true };
        }
        // Resource cleanup: if target is empty, found when all current states are invalidated
        if (targetStates.length === 0 && actions.length > 0) {
            // Check if any state was successfully invalidated
            const remainingFileOpen = states.has("FILE_OPEN");
            const remainingDbConnected = states.has("DB_CONNECTED");
            if (!remainingFileOpen && !remainingDbConnected && actions.length > 0) {
                return { actions, states: stateList, cost, found: true };
            }
        }
        if (cost >= maxDepth)
            continue;
        for (const [fn, rule] of rules) {
            // Can we apply this rule from current states?
            const preStatesOk = rule.pre_states.length === 0 || rule.pre_states.every(p => states.has(p));
            if (!preStatesOk)
                continue;
            const nextStates = new Set(states);
            if (rule.invalidate)
                rule.invalidate.forEach(s => nextStates.delete(s));
            for (const post of rule.post_states)
                nextStates.add(post);
            const stateKey = [...nextStates].sort().join(",");
            if (visited.has(stateKey))
                continue;
            visited.add(stateKey);
            queue.push({
                states: nextStates,
                actions: [...actions, fn],
                stateList: [...stateList, ...rule.post_states],
                cost: cost + 1,
            });
        }
    }
    return { actions: [], states: [], cost: 0, found: false };
}
/**
 * Multi-start frontier search: tries multiple initial state combinations
 * to find the best path. Useful when currentState is ambiguous.
 */
function searchFrontierMulti(rules, currentStatesCandidates, targetStates, maxDepth = 8) {
    let best = { actions: [], states: [], cost: Infinity, found: false };
    for (const startStates of currentStatesCandidates) {
        const result = searchFrontier(rules, startStates, targetStates, maxDepth);
        if (result.found && result.cost < best.cost) {
            best = result;
        }
    }
    return best;
}
/**
 * Generate all reachable action sequences from a given state.
 * Used as a candidate generator for Monte-Carlo style planning (P3.16).
 */
function exploreFrontier(rules, currentStates, maxPaths = 20, maxDepth = 6) {
    const paths = [];
    const visited = new Set();
    const queue = [
        { states: new Set(currentStates), actions: [], cost: 0 },
    ];
    while (queue.length > 0 && paths.length < maxPaths) {
        const { states, actions, cost } = queue.shift();
        if (cost >= maxDepth)
            continue;
        for (const [fn, rule] of rules) {
            const preOk = rule.pre_states.length === 0 || rule.pre_states.every(p => states.has(p));
            if (!preOk)
                continue;
            const next = new Set(states);
            if (rule.invalidate)
                rule.invalidate.forEach(s => next.delete(s));
            for (const post of rule.post_states)
                next.add(post);
            const key = [...next].sort().join(",");
            if (visited.has(key))
                continue;
            visited.add(key);
            const newActions = [...actions, fn];
            if (newActions.length >= 1)
                paths.push(newActions);
            queue.push({ states: next, actions: newActions, cost: cost + 1 });
        }
    }
    return paths;
}
/** Known bridges between protocols. */
const PROTOCOL_BRIDGES = [
    // Original bridges
    { from: "AuthProtocol", to: "FileProtocol", outputState: "SESSION_ACTIVE", inputState: "INIT" },
    { from: "AuthProtocol", to: "DBProtocol", outputState: "SESSION_ACTIVE", inputState: "INIT" },
    { from: "FileProtocol", to: "DBProtocol", outputState: "FILE_OPEN", inputState: "INIT" },
    { from: "DBProtocol", to: "IRProtocol", outputState: "DB_CONNECTED", inputState: "IR_STALE" },
    { from: "IRProtocol", to: "FileProtocol", outputState: "CODE_EMITTED", inputState: "INIT" },
    // P7.3: New protocol bridges
    { from: "AuthProtocol", to: "TransactionProtocol", outputState: "SESSION_ACTIVE", inputState: "TX_IDLE" },
    { from: "AuthProtocol", to: "ConditionalProtocol", outputState: "SESSION_ACTIVE", inputState: "COND_IDLE" },
    { from: "AuthProtocol", to: "LoopProtocol", outputState: "SESSION_ACTIVE", inputState: "LOOP_IDLE" },
    { from: "AuthProtocol", to: "CrossProtocol", outputState: "SESSION_ACTIVE", inputState: "UNAUTHENTICATED" },
    { from: "TransactionProtocol", to: "DBProtocol", outputState: "TX_IDLE", inputState: "INIT" },
    { from: "ConditionalProtocol", to: "FileProtocol", outputState: "COND_ACCEPTED", inputState: "INIT" },
    { from: "ConditionalProtocol", to: "DBProtocol", outputState: "COND_ACCEPTED", inputState: "INIT" },
    { from: "LoopProtocol", to: "FileProtocol", outputState: "LOOP_DONE", inputState: "INIT" },
    { from: "LoopProtocol", to: "DBProtocol", outputState: "LOOP_DONE", inputState: "INIT" },
    { from: "FileProtocol", to: "CrossProtocol", outputState: "FILE_OPEN", inputState: "AUTH_FILE_GATE" },
    { from: "DBProtocol", to: "CrossProtocol", outputState: "DB_CONNECTED", inputState: "AUTH_DB_GATE" },
    { from: "StatelessProtocol", to: "FileProtocol", outputState: "IDLE", inputState: "INIT" },
    { from: "StatelessProtocol", to: "DBProtocol", outputState: "IDLE", inputState: "INIT" },
    { from: "StatelessProtocol", to: "TransactionProtocol", outputState: "IDLE", inputState: "TX_IDLE" },
];
/**
 * Find a cross-protocol action chain for a multi-protocol goal.
 *
 * Decomposes the goal into protocol segments, plans each segment
 * using the frontier explorer, and stitches them together via bridges.
 */
function planCrossProtocol(goal, protocols, targetProtocols, initialStates = {}) {
    const bridges = [];
    const allActions = [];
    const orderedProtocols = [];
    // Order protocols by bridge connectivity
    if (targetProtocols.length <= 1) {
        // Single protocol: just use frontier
        const proto = protocols.find(p => p.name === targetProtocols[0]);
        if (proto) {
            const path = searchFrontier(proto.rules, initialStates[proto.name] || [], [], 8);
            return { protocols: [proto.name], bridges: [], actions: path.actions };
        }
    }
    // Multi-protocol: chain through bridges
    for (let i = 0; i < targetProtocols.length; i++) {
        const current = targetProtocols[i];
        orderedProtocols.push(current);
        if (i < targetProtocols.length - 1) {
            const next = targetProtocols[i + 1];
            const bridge = PROTOCOL_BRIDGES.find(b => b.from === current && b.to === next);
            if (bridge)
                bridges.push(bridge);
        }
    }
    // Plan each protocol segment
    for (const protoName of orderedProtocols) {
        const proto = protocols.find(p => p.name === protoName);
        if (!proto)
            continue;
        const init = initialStates[protoName] || [];
        const path = searchFrontier(proto.rules, init, [], 8);
        if (path.found)
            allActions.push(...path.actions);
    }
    return { protocols: orderedProtocols, bridges, actions: allActions };
}
/** Get protocol bridges for visualization. */
function getProtocolBridges() {
    return [...PROTOCOL_BRIDGES];
}
/**
 * Generate cross-protocol candidate actions for a multi-protocol goal.
 * Used by ProtocolStrategy to expand candidates beyond single-protocol BFS.
 */
function expandCrossProtocolCandidates(goal, targetProtocols) {
    const allDefs = (0, protocol_coverage_1.loadDefaultProtocolDefinitions)();
    const protoMap = new Map(allDefs.map(p => [p.name, p]));
    const candidates = [];
    // For each target protocol, generate frontier paths
    for (const tp of targetProtocols) {
        const proto = protoMap.get(tp);
        if (!proto)
            continue;
        const frontierPaths = exploreFrontier(proto.rules, [], 10, 6);
        for (const path of frontierPaths) {
            if (path.length > 0)
                candidates.push(path);
        }
    }
    // For multi-protocol: stitch via bridges
    if (targetProtocols.length > 1) {
        const plan = planCrossProtocol(goal, allDefs, targetProtocols);
        if (plan.actions.length > 0)
            candidates.push(plan.actions);
    }
    return candidates;
}
