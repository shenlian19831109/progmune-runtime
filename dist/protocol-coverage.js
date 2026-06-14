"use strict";
/**
 * P3.6: Protocol Coverage Engine
 *
 * Analyzes Trajectory Corpus against Protocol Definitions to determine
 * which states and transitions have been observed in real execution data.
 *
 * Core question: "What does the system NOT know yet?"
 *
 * Coverage gaps drive:
 *   1. Benchmark generation (targeted test cases)
 *   2. Data acquisition priorities (where to collect more feedback)
 *   3. Risk assessment (which protocols are under-observed)
 *
 * Architecture:
 *   Protocol definitions → All possible states + transitions
 *   Trajectory records    → Observed states + transitions
 *   Coverage engine       → Gap analysis + risk ranking
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
exports.parseProtocolDefinition = parseProtocolDefinition;
exports.analyzeCoverage = analyzeCoverage;
exports.analyzeAllCoverage = analyzeAllCoverage;
exports.loadDefaultProtocolDefinitions = loadDefaultProtocolDefinitions;
// ═══════════════════════════════════════════════════════════════
// Protocol Parser
// ═══════════════════════════════════════════════════════════════
function parseTransitions(rules) {
    const transitions = [];
    for (const [fn, rule] of rules) {
        // Acquire transitions: pre_states (or INIT) → post_states
        const pres = rule.pre_states.length > 0 ? rule.pre_states : ["INIT"];
        for (const pre of pres) {
            for (const post of rule.post_states) {
                transitions.push({ from: pre, to: post, rule: fn, type: "acquire" });
            }
        }
        // Invalidation transitions: state → ∅
        if (rule.invalidate) {
            for (const inv of rule.invalidate) {
                transitions.push({ from: inv, to: "∅", rule: fn, type: "invalidate" });
            }
        }
    }
    return transitions;
}
function allStatesFromRules(rules, initialState) {
    const states = new Set();
    states.add(initialState);
    states.add("INIT");
    for (const rule of rules.values()) {
        for (const s of rule.pre_states)
            states.add(s);
        for (const s of rule.post_states)
            states.add(s);
        if (rule.invalidate)
            for (const s of rule.invalidate)
                states.add(s);
    }
    return [...states].sort();
}
/** Parse a protocol definition from its rules. */
function parseProtocolDefinition(name, rules, initialState) {
    return {
        name,
        states: allStatesFromRules(rules, initialState),
        initialState,
        transitions: parseTransitions(rules),
        rules,
    };
}
// ═══════════════════════════════════════════════════════════════
// Coverage Analyzer
// ═══════════════════════════════════════════════════════════════
/** Extract observed states from a trajectory. */
function extractVisitedStates(trajectory, rules, initial) {
    const visited = new Set();
    if (initial)
        visited.add(initial);
    let current = new Set();
    if (initial)
        current.add(initial);
    for (const fn of trajectory) {
        const rule = rules.get(fn);
        if (!rule)
            continue;
        for (const pre of rule.pre_states)
            visited.add(pre);
        for (const post of rule.post_states) {
            visited.add(post);
            current.add(post);
        }
        if (rule.invalidate)
            rule.invalidate.forEach(s => { visited.add(s); current.delete(s); });
    }
    return visited;
}
/** Extract observed transitions from a trajectory. */
function extractVisitedTransitions(trajectory, rules, initial) {
    const visited = new Set();
    let current = new Set();
    if (initial)
        current.add(initial);
    for (const fn of trajectory) {
        const rule = rules.get(fn);
        if (!rule)
            continue;
        for (const pre of rule.pre_states) {
            for (const post of rule.post_states) {
                visited.add(`${pre}→${post}`);
            }
        }
        if (rule.invalidate) {
            for (const inv of rule.invalidate) {
                visited.add(`${inv}→∅`);
            }
        }
        // Advance state
        if (rule.invalidate)
            rule.invalidate.forEach(s => current.delete(s));
        for (const post of rule.post_states)
            current.add(post);
    }
    return visited;
}
/**
 * Compute coverage for a single protocol from trajectory data.
 */
function analyzeCoverage(protocol, trajectories) {
    // Filter trajectories relevant to this protocol
    const relevant = trajectories.filter(t => t.protocol === protocol.name || t.protocol === "_global");
    // Aggregate visited states + transitions
    const visitedStates = new Set();
    const visitedTransitions = new Set();
    for (const t of relevant) {
        const initialState = t.initialState?.length > 0 ? t.initialState[0] : undefined;
        for (const s of extractVisitedStates(t.trajectory, protocol.rules, initialState))
            visitedStates.add(s);
        for (const tr of extractVisitedTransitions(t.trajectory, protocol.rules, initialState))
            visitedTransitions.add(tr);
    }
    const totalStates = protocol.states.length;
    const visitedStateCount = [...visitedStates].filter(s => protocol.states.includes(s)).length;
    const totalTransitions = protocol.transitions.length;
    const visitedTransitionKeys = new Set(protocol.transitions.filter(t => visitedTransitions.has(`${t.from}→${t.to}`)).map(t => `${t.from}→${t.to}`));
    const missingStates = protocol.states.filter(s => !visitedStates.has(s));
    const missingTransitions = protocol.transitions
        .filter(t => !visitedTransitions.has(`${t.from}→${t.to}`))
        .map(t => ({ from: t.from, to: t.to, rule: t.rule }));
    return {
        protocol: protocol.name,
        stateCoverage: {
            protocol: protocol.name,
            totalStates,
            visitedStates: visitedStateCount,
            stateCoverage: totalStates > 0 ? visitedStateCount / totalStates : 0,
            missingStates,
        },
        transitionCoverage: {
            protocol: protocol.name,
            totalTransitions,
            visitedTransitions: visitedTransitionKeys.size,
            transitionCoverage: totalTransitions > 0 ? visitedTransitionKeys.size / totalTransitions : 0,
            missingTransitions,
        },
        trajectoryCount: relevant.length,
    };
}
/**
 * Analyze coverage across all protocols.
 */
function analyzeAllCoverage(protocols, trajectories) {
    return protocols.map(p => analyzeCoverage(p, trajectories));
}
// ═══════════════════════════════════════════════════════════════
// Default protocol definitions (from protocols.json)
// ═══════════════════════════════════════════════════════════════
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ssg_validator_1 = require("./ssg-validator");
let _cachedProtocols = null;
function loadDefaultProtocolDefinitions() {
    if (_cachedProtocols)
        return _cachedProtocols;
    const protoDef = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "protocols.json"), "utf-8"));
    const fns = (0, ssg_validator_1.parseProtocolsFromJSON)(protoDef);
    const rules = new Map();
    for (const p of fns)
        rules.set(p.function, p.protocol);
    // Split rules into logical protocol groups by state namespace
    const protocolGroups = [
        {
            name: "FileProtocol",
            ruleFilter: (_fn, rule) => rule.pre_states.some(s => s.includes("FILE")) || rule.post_states.some(s => s.includes("FILE")) || (rule.invalidate || []).some(s => s.includes("FILE")),
            initialState: "INIT",
        },
        {
            name: "AuthProtocol",
            ruleFilter: (_fn, rule) => rule.pre_states.some(s => ["UNAUTHENTICATED", "PASSWORD_VERIFIED", "TOKEN_ISSUED", "SESSION_ACTIVE"].includes(s)) ||
                rule.post_states.some(s => ["UNAUTHENTICATED", "PASSWORD_VERIFIED", "TOKEN_ISSUED", "SESSION_ACTIVE"].includes(s)),
            initialState: "UNAUTHENTICATED",
        },
        {
            name: "DBProtocol",
            ruleFilter: (_fn, rule) => rule.pre_states.some(s => s.includes("DB")) || rule.post_states.some(s => s.includes("DB")) || (rule.invalidate || []).some(s => s.includes("DB")),
            initialState: "INIT",
        },
        {
            name: "IRProtocol",
            ruleFilter: (_fn, rule) => rule.pre_states.some(s => s.includes("IR_") || s.includes("ACTION_") || s.includes("SEQUENCE_") || s.includes("CODE_") || s.includes("SESSION_")) ||
                rule.post_states.some(s => s.includes("IR_") || s.includes("ACTION_") || s.includes("SEQUENCE_") || s.includes("CODE_") || s.includes("SESSION_")),
            initialState: "IR_STALE",
        },
        {
            name: "StatelessProtocol",
            ruleFilter: (_fn, rule) => rule.namespace === "stateless" ||
                (rule.pre_states.length === 0 && rule.post_states.length === 0),
            initialState: "IDLE",
        },
        {
            name: "TransactionProtocol",
            ruleFilter: (_fn, rule) => rule.namespace === "transaction" ||
                rule.pre_states.some(s => s.startsWith("TX_") || s === "SAVEPOINT_HELD") ||
                rule.post_states.some(s => s.startsWith("TX_") || s === "SAVEPOINT_HELD") ||
                (rule.invalidate || []).some(s => s.startsWith("TX_") || s === "SAVEPOINT_HELD"),
            initialState: "TX_IDLE",
        },
        {
            name: "ConditionalProtocol",
            ruleFilter: (_fn, rule) => rule.namespace === "conditional" ||
                rule.pre_states.some(s => s.startsWith("COND_")) ||
                rule.post_states.some(s => s.startsWith("COND_")) ||
                (rule.invalidate || []).some(s => s.startsWith("COND_")),
            initialState: "COND_IDLE",
        },
        {
            name: "LoopProtocol",
            ruleFilter: (_fn, rule) => rule.namespace === "loop" ||
                rule.pre_states.some(s => s.startsWith("LOOP_") || s === "FETCHING" || s === "BATCH_READY" || s === "ITERATING") ||
                rule.post_states.some(s => s.startsWith("LOOP_") || s === "FETCHING" || s === "BATCH_READY" || s === "ITERATING") ||
                (rule.invalidate || []).some(s => s.startsWith("LOOP_") || s === "FETCHING" || s === "BATCH_READY" || s === "ITERATING"),
            initialState: "LOOP_IDLE",
        },
        {
            name: "CrossProtocol",
            ruleFilter: (_fn, rule) => rule.namespace === "cross" ||
                rule.pre_states.some(s => s.includes("AUTH_FILE_GATE") || s.includes("AUTH_DB_GATE")) ||
                rule.post_states.some(s => s.includes("AUTH_FILE_GATE") || s.includes("AUTH_DB_GATE")),
            initialState: "UNAUTHENTICATED",
        },
    ];
    _cachedProtocols = protocolGroups.map(g => {
        const groupRules = new Map();
        for (const [fn, rule] of rules) {
            if (g.ruleFilter(fn, rule))
                groupRules.set(fn, rule);
        }
        return parseProtocolDefinition(g.name, groupRules, g.initialState);
    });
    return _cachedProtocols;
}
