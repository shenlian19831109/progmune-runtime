"use strict";
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
exports.StateMachineValidator = exports.InvariantViolationError = void 0;
exports.rebuildState = rebuildState;
exports.applyTransitionDelta = applyTransitionDelta;
exports.findFixPathStatic = findFixPathStatic;
exports.validateTransition = validateTransition;
exports.checkLedgerConsistency = checkLedgerConsistency;
exports.hashRules = hashRules;
exports.hashLedger = hashLedger;
exports.diffLedgers = diffLedgers;
exports.findProducer = findProducer;
exports.findConsumer = findConsumer;
exports.findViolations = findViolations;
exports.findTransition = findTransition;
exports.listAllStates = listAllStates;
exports.explainRejection = explainRejection;
exports.rejectionToJSON = rejectionToJSON;
exports.parseProtocolsFromJSON = parseProtocolsFromJSON;
const crypto = __importStar(require("crypto"));
const DEFAULT_NAMESPACE = "_global";
class InvariantViolationError extends Error {
    constructor(message, detail) {
        super(message);
        this.name = "InvariantViolationError";
        this.detail = detail;
    }
}
exports.InvariantViolationError = InvariantViolationError;
// ═══════════════════════════════════════════════════════════════
// Phase 3: Pure Functions — Semantic Ledger Kernel
// ═══════════════════════════════════════════════════════════════
// ── Internal helpers ──
function toSnapshot(stateMap) {
    const snap = {};
    for (const [ns, states] of stateMap) {
        snap[ns] = [...states].sort();
    }
    return snap;
}
function fromSnapshot(snap) {
    const map = new Map();
    for (const [ns, states] of Object.entries(snap)) {
        map.set(ns, new Set(states));
    }
    return map;
}
function deepEqualSnapshots(a, b) {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length)
        return false;
    for (let i = 0; i < keysA.length; i++) {
        if (keysA[i] !== keysB[i])
            return false;
        const statesA = a[keysA[i]];
        const statesB = b[keysA[i]];
        if (statesA.length !== statesB.length)
            return false;
        for (let j = 0; j < statesA.length; j++) {
            if (statesA[j] !== statesB[j])
                return false;
        }
    }
    return true;
}
// ── rebuildState: pure fold over ledger → per-namespace state snapshot ──
/** @requires LEDGER_DATA @produces STATE_SNAPSHOT */
function rebuildState(ledger, namespaceInitialStates = new Map([["_global", "INIT"]])) {
    const stateMap = fromSnapshot({});
    for (const [ns, initState] of namespaceInitialStates) {
        stateMap.set(ns, new Set([initState]));
    }
    if (!stateMap.has("_global"))
        stateMap.set("_global", new Set(["INIT"]));
    for (const t of ledger) {
        if (!t.valid)
            continue;
        applyTransitionDelta(stateMap, t);
    }
    return toSnapshot(stateMap);
}
// ── applyTransitionDelta: incremental primitive for O(n) loops ──
function applyTransitionDelta(stateMap, transition) {
    const ns = transition.namespace || DEFAULT_NAMESPACE;
    const nsStates = stateMap.get(ns) || new Set();
    for (const s of transition.invalidated)
        nsStates.delete(s);
    for (const s of transition.acquired)
        nsStates.add(s);
    stateMap.set(ns, nsStates);
}
// ── computeDelta: derive acquired/invalidated from before/after for one namespace ──
function computeDelta(beforeSnap, afterSnap, namespace) {
    const before = beforeSnap[namespace] || [];
    const after = afterSnap[namespace] || [];
    const acquired = after.filter(s => !before.includes(s));
    const invalidated = before.filter(s => !after.includes(s));
    return { acquired, invalidated };
}
// ── findFixPathStatic: BFS state graph search (extracted from class) ──
/** @requires CURRENT_STATES @produces FIX_PATH */
function findFixPathStatic(rules, namespace, current, targetPreStates) {
    const nsFuncs = [];
    for (const [fn, rule] of rules) {
        if ((rule.namespace || DEFAULT_NAMESPACE) === namespace) {
            nsFuncs.push({ name: fn, rule });
        }
    }
    // BFS
    const startKey = [...new Set(current)].sort().join(",");
    const visited = new Set();
    const queue = [
        { states: new Set(current), path: [] }
    ];
    visited.add(startKey);
    while (queue.length > 0) {
        const { states, path } = queue.shift();
        if (targetPreStates.every(s => states.has(s)))
            return path;
        for (const { name, rule } of nsFuncs) {
            if (!rule.pre_states.every(p => states.has(p)))
                continue;
            const nextStates = new Set(states);
            if (rule.invalidate)
                rule.invalidate.forEach(s => nextStates.delete(s));
            rule.post_states.forEach(s => nextStates.add(s));
            const nextKey = [...nextStates].sort().join(",");
            if (visited.has(nextKey))
                continue;
            visited.add(nextKey);
            if (visited.size > 1000)
                break;
            queue.push({ states: nextStates, path: [...path, name] });
        }
    }
    // Fallback: single-hop greedy
    const path = [];
    const currentSet = new Set(current);
    for (const target of targetPreStates) {
        if (currentSet.has(target))
            continue;
        for (const { name, rule } of nsFuncs) {
            if (rule.post_states.includes(target)) {
                path.push(name);
                if (rule.invalidate)
                    rule.invalidate.forEach(s => currentSet.delete(s));
                rule.post_states.forEach(s => currentSet.add(s));
                break;
            }
        }
    }
    return path;
}
// ── validateTransition: pure function, stateless ──
/** @requires TRANSITION_CONTEXT @produces VALIDATION_RESULT */
function validateTransition(ctx, candidateFunctionName, actionIndex, rules, namespaceInitialStates, ruleHash) {
    const currentState = ctx.currentState;
    const rule = rules.get(candidateFunctionName);
    if (!rule) {
        const transition = {
            actionIndex,
            function: candidateFunctionName,
            namespace: DEFAULT_NAMESPACE,
            acquired: [],
            invalidated: [],
            statesBefore: currentState,
            statesAfter: currentState,
            valid: true,
            ruleHash,
        };
        // Invariant-1: delta consistency for no-rule transition (trivially satisfied)
        return { valid: true, transition };
    }
    const ns = rule.namespace || DEFAULT_NAMESPACE;
    const nsStates = new Set(currentState[ns] || []);
    // Check pre-states
    if (!rule.pre_states.every((s) => nsStates.has(s))) {
        const fixPath = findFixPathStatic(rules, ns, [...nsStates], rule.pre_states);
        const rejection = {
            blocked: candidateFunctionName,
            currentState: [...nsStates],
            requiredState: rule.pre_states,
            missingFunctions: fixPath,
            fixPath,
            namespace: ns,
        };
        const transition = {
            actionIndex,
            function: candidateFunctionName,
            namespace: ns,
            acquired: [],
            invalidated: [],
            statesBefore: currentState,
            statesAfter: currentState, // no state change on rejection
            valid: false,
            ruleHash,
        };
        return { valid: false, transition, rejection };
    }
    // Valid — compute state change
    const beforeNs = [...nsStates];
    if (rule.invalidate)
        rule.invalidate.forEach((s) => nsStates.delete(s));
    rule.post_states.forEach((s) => nsStates.add(s));
    // Build statesAfter: copy currentState, replace this namespace
    const statesAfter = {};
    for (const nsKey of Object.keys(currentState)) {
        statesAfter[nsKey] = nsKey === ns
            ? [...nsStates].sort()
            : [...(currentState[nsKey] || [])];
    }
    if (!statesAfter[ns]) {
        statesAfter[ns] = [...nsStates].sort();
    }
    const afterNs = statesAfter[ns] || [];
    const acquired = afterNs.filter((s) => !beforeNs.includes(s));
    const invalidated = beforeNs.filter((s) => !afterNs.includes(s));
    const transition = {
        actionIndex,
        function: candidateFunctionName,
        namespace: ns,
        acquired,
        invalidated,
        statesBefore: currentState,
        statesAfter,
        valid: true,
        ruleHash,
    };
    // Invariant-1: delta consistency (skip in fast mode for performance)
    if (process.env.PROGMUNE_FAST_VALIDATE !== "true") {
        const deltaMap = fromSnapshot(currentState);
        applyTransitionDelta(deltaMap, transition);
        const computedAfter = toSnapshot(deltaMap);
        if (!deepEqualSnapshots(computedAfter, statesAfter)) {
            const detail = `[Invariant-1] Delta consistency violation in validateTransition for "${candidateFunctionName}":\n` +
                `  acquired: [${acquired.join(", ")}]  invalidated: [${invalidated.join(", ")}]\n` +
                `  expected after: ${JSON.stringify(computedAfter)}\n` +
                `  actual after:   ${JSON.stringify(statesAfter)}`;
            // P0 Strict Mode: fail fast on kernel corruption
            if (process.env.PROGMUNE_STRICT !== "false") {
                throw new InvariantViolationError(detail, {
                    invariant: "delta-consistency",
                    namespace: ns,
                    function: candidateFunctionName,
                    expected: computedAfter,
                    actual: statesAfter,
                });
            }
            console.error(detail);
        }
    } // PROGMUNE_FAST_VALIDATE guard
    return { valid: true, transition };
}
// ── checkLedgerConsistency: Invariant-0 + Invariant-1 over full ledger ──
/** @requires LEDGER_DATA @produces CONSISTENCY_RESULT */
function checkLedgerConsistency(ledger, namespaceInitialStates = new Map([["_global", "INIT"]]), protocolRules) {
    const violations = [];
    const running = fromSnapshot({});
    // Pre-scan: collect all namespaces referenced in any transition
    const allNamespaces = new Set(namespaceInitialStates.keys());
    for (const t of ledger) {
        for (const ns of Object.keys(t.statesBefore))
            allNamespaces.add(ns);
        for (const ns of Object.keys(t.statesAfter))
            allNamespaces.add(ns);
        allNamespaces.add(t.namespace);
    }
    // Initialize running state: init from namespaceInitialStates, empty for others
    for (const ns of allNamespaces) {
        if (namespaceInitialStates.has(ns)) {
            running.set(ns, new Set([namespaceInitialStates.get(ns)]));
        }
        else {
            running.set(ns, new Set());
        }
    }
    // Normalize a snapshot: ensure all known namespaces are present
    function normalizeSnap(snap) {
        const out = {};
        for (const ns of allNamespaces) {
            out[ns] = [...(snap[ns] || [])].sort();
        }
        return out;
    }
    for (let i = 0; i < ledger.length; i++) {
        const t = ledger[i];
        // Invariant-0: statesBefore must equal rebuildState(ledger[0..i-1])
        const expectedBefore = normalizeSnap(toSnapshot(running));
        const actualBefore = normalizeSnap(t.statesBefore);
        if (!deepEqualSnapshots(expectedBefore, actualBefore)) {
            violations.push({
                index: i,
                invariant: "before-consistency",
                expected: expectedBefore,
                actual: actualBefore,
                detail: `Transition[${i}] "${t.function}": statesBefore does not match rebuilt state from previous ledger`,
            });
        }
        // Invariant-1: statesAfter must equal applyDelta(statesBefore, acquired, invalidated)
        if (t.valid) {
            const beforeMap = fromSnapshot(t.statesBefore);
            applyTransitionDelta(beforeMap, t);
            const expectedAfter = normalizeSnap(toSnapshot(beforeMap));
            const actualAfter = normalizeSnap(t.statesAfter);
            if (!deepEqualSnapshots(expectedAfter, actualAfter)) {
                violations.push({
                    index: i,
                    invariant: "delta-consistency",
                    expected: expectedAfter,
                    actual: actualAfter,
                    detail: `Transition[${i}] "${t.function}": statesAfter does not match applyDelta(statesBefore, acquired, invalidated)`,
                });
            }
        }
        // Invariant-2: delta legality — acquired/invalidated must match protocol rules
        if (t.valid && protocolRules && protocolRules.size > 0) {
            const rule = protocolRules.get(t.function);
            if (rule) {
                // Check acquired states are in the function's post_states
                const beforeStates = t.statesBefore[t.namespace] || [];
                for (const a of (t.acquired || [])) {
                    if (!rule.post_states.includes(a)) {
                        violations.push({
                            index: i,
                            invariant: "delta-legality",
                            detail: `Transition[${i}] "${t.function}": acquired state "${a}" is not in protocol post_states [${rule.post_states.join(", ")}]`,
                        });
                    }
                    // Reject acquiring a state that already exists in statesBefore
                    if (beforeStates.includes(a)) {
                        violations.push({
                            index: i,
                            invariant: "delta-legality",
                            detail: `Transition[${i}] "${t.function}": acquired state "${a}" already exists in statesBefore [${beforeStates.join(", ")}]`,
                        });
                    }
                }
                // Check invalidated states are in the function's invalidate list
                for (const inv of (t.invalidated || [])) {
                    if (!(rule.invalidate || []).includes(inv)) {
                        violations.push({
                            index: i,
                            invariant: "delta-legality",
                            detail: `Transition[${i}] "${t.function}": invalidated state "${inv}" is not in protocol invalidate [${(rule.invalidate || []).join(", ")}]`,
                        });
                    }
                }
                // Check no missing expected invalidations (unless the function has no invalidate rule)
                if (rule.invalidate && rule.invalidate.length > 0) {
                    for (const expectedInv of rule.invalidate) {
                        if (!(t.invalidated || []).includes(expectedInv)) {
                            violations.push({
                                index: i,
                                invariant: "delta-legality",
                                detail: `Transition[${i}] "${t.function}": expected invalidation of "${expectedInv}" per protocol, but not present in transition`,
                            });
                        }
                    }
                }
            }
        }
        // Advance running state
        if (t.valid) {
            applyTransitionDelta(running, t);
        }
    }
    return { consistent: violations.length === 0, violations };
}
// ── hashRules: stable hash of rule set for constraint snapshot (P1) ──
/** @requires RULES @produces RULE_HASH */
function hashRules(rules) {
    const sorted = [...rules.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, rule]) => ({
        function: name,
        pre_states: [...rule.pre_states].sort(),
        post_states: [...rule.post_states].sort(),
        invalidate: rule.invalidate ? [...rule.invalidate].sort() : undefined,
        namespace: rule.namespace || DEFAULT_NAMESPACE,
    }));
    return crypto.createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 16);
}
/** Compute a deterministic SHA256 hash of an entire ledger (P1: Tamper-evident integrity). */
/** @requires LEDGER_DATA @produces LEDGER_HASH */
function hashLedger(ledger) {
    const canonical = ledger.map(t => ({
        actionIndex: t.actionIndex,
        function: t.function,
        namespace: t.namespace,
        acquired: [...t.acquired].sort(),
        invalidated: [...t.invalidated].sort(),
        statesBefore: Object.fromEntries(Object.entries(t.statesBefore).map(([k, v]) => [k, [...v].sort()]).sort()),
        statesAfter: Object.fromEntries(Object.entries(t.statesAfter).map(([k, v]) => [k, [...v].sort()]).sort()),
        valid: t.valid,
        ruleHash: t.ruleHash || "",
    }));
    return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 16);
}
/** Compare two ledgers and identify structural differences. */
/** @requires TWO_LEDGERS @produces LEDGER_DIFF */
function diffLedgers(ledgerA, ledgerB) {
    const hash = (t) => crypto.createHash("sha256").update(JSON.stringify({
        i: t.actionIndex, f: t.function, n: t.namespace,
        a: [...t.acquired].sort(), x: [...t.invalidated].sort(),
        v: t.valid, r: t.ruleHash || "",
    })).digest("hex").slice(0, 12);
    const mapA = new Map();
    const mapB = new Map();
    for (const t of ledgerA)
        mapA.set(t.actionIndex, { t, h: hash(t) });
    for (const t of ledgerB)
        mapB.set(t.actionIndex, { t, h: hash(t) });
    const allIndices = new Set([...mapA.keys(), ...mapB.keys()]);
    const unchanged = [];
    const onlyInA = [];
    const onlyInB = [];
    const changed = [];
    for (const idx of [...allIndices].sort((a, b) => a - b)) {
        const a = mapA.get(idx);
        const b = mapB.get(idx);
        if (a && b) {
            if (a.h === b.h) {
                unchanged.push(idx);
            }
            else {
                changed.push({ index: idx, function: a.t.function, hashA: a.h, hashB: b.h });
            }
        }
        else if (a && !b) {
            onlyInA.push({ index: idx, function: a.t.function, hashA: a.h });
        }
        else if (!a && b) {
            onlyInB.push({ index: idx, function: b.t.function, hashB: b.h });
        }
    }
    return {
        unchanged: unchanged.length,
        onlyInA,
        onlyInB,
        changed,
        identical: onlyInA.length === 0 && onlyInB.length === 0 && changed.length === 0,
    };
}
/** Find all transitions that acquire (produce) a given state in the ledger. */
function findProducer(state, ledger) {
    return ledger
        .map((t, i) => ({ transition: t, index: i, namespace: t.namespace }))
        .filter(r => r.transition.acquired.includes(state));
}
/** Find all transitions that have a given state in their pre_states (consume it). */
function findConsumer(state, ledger) {
    return ledger
        .map((t, i) => ({ transition: t, index: i, namespace: t.namespace }))
        .filter(r => (r.transition.statesBefore[r.namespace] || []).includes(state));
}
/** Find all invalid transitions in a ledger. */
function findViolations(ledger) {
    return ledger
        .map((t, i) => ({ transition: t, index: i, namespace: t.namespace }))
        .filter(r => !r.transition.valid);
}
/** Find a transition by its action index. */
function findTransition(actionIndex, ledger) {
    const idx = ledger.findIndex(t => t.actionIndex === actionIndex);
    if (idx === -1)
        return null;
    return { transition: ledger[idx], index: idx, namespace: ledger[idx].namespace };
}
/** List all unique states present across all namespaces in a ledger. */
function listAllStates(ledger) {
    const seen = new Set();
    const result = [];
    for (const t of ledger) {
        const ns = t.namespace;
        for (const s of t.acquired) {
            const key = `${ns}:${s}`;
            if (!seen.has(key)) {
                seen.add(key);
                result.push({ namespace: ns, state: s });
            }
        }
        for (const s of t.invalidated) {
            const key = `${ns}:${s}`;
            if (!seen.has(key)) {
                seen.add(key);
                result.push({ namespace: ns, state: s });
            }
        }
        for (const states of Object.values(t.statesBefore)) {
            for (const s of states) {
                const key = `${ns}:${s}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    result.push({ namespace: ns, state: s });
                }
            }
        }
    }
    return result;
}
// ═══════════════════════════════════════════════════════════════
// StateMachineValidator — backward-compatible class wrapper
// Delegates to pure functions internally (Strangler Pattern)
// ═══════════════════════════════════════════════════════════════
class StateMachineValidator {
    constructor(rules, initialState = 'INIT', namespaceInitialStates) {
        /** Internal ledger — the truth source. State is derived from this. */
        this.ledger = [];
        this.rules = new Map();
        rules.forEach(r => {
            this.rules.set(r.function, r.protocol);
        });
        this.nsInitialStates = new Map(namespaceInitialStates);
        if (!this.nsInitialStates.has("_global")) {
            this.nsInitialStates.set("_global", initialState);
        }
        // Pre-compute rule hash for constraint snapshot determinism
        this._ruleHash = hashRules(this.rules);
        // Initialize ledger and context from namespace initial states
        this.ctx = {
            ledger: [],
            currentState: rebuildState([], this.nsInitialStates),
        };
    }
    /** @deprecated Use validateTransition(ctx, ...) for stateless validation */
    setNamespaceInitialState(namespace, state) {
        const ns = namespace || DEFAULT_NAMESPACE;
        this.nsInitialStates.set(ns, state);
        // Rebuild context to reflect new initial state
        this.ctx = {
            ledger: this.ledger,
            currentState: rebuildState(this.ledger, this.nsInitialStates),
        };
    }
    /**
     * Validate a function call against current protocol state.
     * Internally delegates to the pure validateTransition() function.
     * @deprecated Prefer validateTransition() directly for stateless validation.
     */
    apply(functionName, actionIndex) {
        const idx = actionIndex ?? this.ledger.length;
        const { valid, transition, rejection } = validateTransition(this.ctx, functionName, idx, this.rules, this.nsInitialStates, this._ruleHash);
        // Append to ledger (truth source)
        this.ledger.push(transition);
        // Update context incrementally (O(1) per step)
        if (transition.valid) {
            const stateMap = fromSnapshot(this.ctx.currentState);
            applyTransitionDelta(stateMap, transition);
            this.ctx = {
                ledger: this.ledger,
                currentState: toSnapshot(stateMap),
            };
        }
        else {
            this.ctx = {
                ledger: this.ledger,
                currentState: this.ctx.currentState, // unchanged on rejection
            };
        }
        return {
            valid,
            statesBefore: transition.statesBefore,
            statesAfter: transition.statesAfter,
            acquired: transition.acquired,
            invalidated: transition.invalidated,
            namespace: transition.namespace,
            rejection,
        };
    }
    applyWithTransition(functionName, actionIndex) {
        const result = this.apply(functionName, actionIndex);
        const transition = this.ledger[this.ledger.length - 1];
        return { result, transition };
    }
    getCurrentStates() {
        const effective = new Set();
        for (const states of Object.values(this.ctx.currentState)) {
            for (const s of states)
                effective.add(s);
        }
        return [...effective];
    }
    snapshotNamespaceStates() {
        return rebuildState(this.ledger, this.nsInitialStates);
    }
    getNamespaceStates(namespace) {
        const ns = namespace || DEFAULT_NAMESPACE;
        return [...(this.ctx.currentState[ns] || [])];
    }
    /** Returns trace reconstructed from the ledger (backward-compat) */
    getTrace() {
        // Replay the ledger to build trace nodes
        const trace = [];
        const runningState = fromSnapshot({});
        for (const [ns, initState] of this.nsInitialStates) {
            runningState.set(ns, new Set([initState]));
        }
        if (!runningState.has("_global"))
            runningState.set("_global", new Set(["INIT"]));
        for (const t of this.ledger) {
            const node = {
                function: t.function,
                valid: t.valid,
                statesBefore: t.statesBefore,
                statesAfter: t.statesAfter,
                acquired: t.acquired,
                invalidated: t.invalidated,
                namespace: t.namespace,
            };
            trace.push(node);
            if (t.valid) {
                applyTransitionDelta(runningState, t);
            }
        }
        return trace;
    }
    /** Returns the internal ledger (Phase 3 API) */
    getLedger() {
        return [...this.ledger];
    }
    /** Returns the current ValidationContext (Phase 3 API) */
    getContext() {
        return { ...this.ctx, ledger: [...this.ctx.ledger] };
    }
    /** Returns the pre-computed rule hash (Phase 3 API) */
    getRuleHash() {
        return this._ruleHash;
    }
    // ── Static utilities (delegate to standalone functions) ──
    static explainRejection(rejection) {
        return explainRejection(rejection);
    }
    static rejectionToJSON(rejection) {
        return rejectionToJSON(rejection);
    }
}
exports.StateMachineValidator = StateMachineValidator;
// ═══════════════════════════════════════════════════════════════
// Standalone presentation utilities (formerly static methods)
// ═══════════════════════════════════════════════════════════════
/** Format an SSG rejection as a human-readable multi-line string. */
/** @requires SSG_REJECTION @produces EXPLANATION */
function explainRejection(rejection) {
    const nsLabel = rejection.namespace && rejection.namespace !== DEFAULT_NAMESPACE
        ? ` [namespace: ${rejection.namespace}]` : '';
    const lines = [
        `🚫 SSG 协议拦截: ${rejection.blocked}${nsLabel}`,
        ``,
        `  当前状态: ${rejection.currentState.join(', ') || '(无)'}`,
        `  所需状态: ${rejection.requiredState.join(', ')}`,
        ``,
    ];
    if (rejection.missingFunctions.length > 0) {
        lines.push(`  缺失步骤: ${rejection.missingFunctions.join(' → ')}`);
    }
    if (rejection.fixPath.length > 0) {
        lines.push(`  修复路径: ${rejection.fixPath.join(' → ')}`);
    }
    return lines.join('\n');
}
/** Format an SSG rejection as a structured JSON object. */
function rejectionToJSON(rejection) {
    return {
        protocol_violation: {
            blocked_function: rejection.blocked,
            namespace: rejection.namespace,
            current_state: rejection.currentState,
            required_pre_states: rejection.requiredState,
        },
        diagnosis: {
            missing_functions: rejection.missingFunctions,
            fix_path: rejection.fixPath,
        },
    };
}
// ═══════════════════════════════════════════════════════════════
// parseProtocolsFromJSON (unchanged)
// ═══════════════════════════════════════════════════════════════
function parseProtocolsFromJSON(protocolDef) {
    const protocols = [];
    for (const [funcName, rule] of Object.entries(protocolDef.rules)) {
        protocols.push({
            function: funcName,
            protocol: {
                pre_states: rule.pre_states,
                post_states: rule.post_states,
                invalidate: rule.invalidate,
                namespace: rule.namespace,
            },
        });
    }
    return protocols;
}
