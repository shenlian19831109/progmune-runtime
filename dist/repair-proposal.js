"use strict";
/**
 * Phase 4: Repair Proposal Engine (P2)
 *
 * Suggests repairs for detected violations — but NEVER auto-writes to the Ledger.
 * Ledger = Evidence, not Cache.
 *
 * Three proposal strategies:
 *   insert  — missing step detected, insert function call before violation
 *   replace — transition has incorrect state data, replace it
 *   reorder — wrong call order, propose reordering
 *
 * The engine produces Proposal JSON. The caller (Planner, human, future Repair Planner)
 * decides whether to accept and create a Branch.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.suggestRepairs = suggestRepairs;
exports.suggestProtocolRepair = suggestProtocolRepair;
exports.suggestInvariantRepair = suggestInvariantRepair;
exports.applyProposalAsBranch = applyProposalAsBranch;
exports.validateProposal = validateProposal;
exports.generateRepairSummary = generateRepairSummary;
exports.getMinimalFixSet = getMinimalFixSet;
const ssg_validator_1 = require("./ssg-validator");
const runtime_invariants_1 = require("./runtime-invariants");
const protocol_registry_1 = require("./protocol-registry");
const branch_ledger_1 = require("./branch-ledger");
// ── Proposal Generation ──
/** Generate repair proposals for all detected violations in a ledger. */
/** Generate repair proposals for all detected violations. */
/** @requires VIOLATIONS @produces REPAIR_PROPOSALS */
function suggestRepairs(violations, ir, protocols) {
    const proposals = [];
    for (const v of violations) {
        if (v.violatedConstraint === "protocol") {
            const rejection = tryParseRejection(v);
            if (rejection) {
                proposals.push(...suggestProtocolRepair(rejection, ir));
                continue;
            }
        }
        // Generic violation: suggest based on SVL level
        proposals.push(suggestGenericRepair(v, ir));
    }
    return proposals;
}
/** Protocol violation repair: use SSG fixPath to suggest insertions. */
/** Generate repair proposals for SSG protocol violations. */
function suggestProtocolRepair(rejection, ir) {
    const proposals = [];
    if (rejection.fixPath && rejection.fixPath.length > 0) {
        // Each missing function in the fix path is a separate insert proposal
        for (let i = 0; i < rejection.fixPath.length; i++) {
            const fnName = rejection.fixPath[i];
            const def = ir.find((f) => f.name === fnName);
            const actions = [];
            if (def) {
                const args = (def.params || []).map((p, j) => ({
                    name: p.name || `p${j}`,
                    type: p.type || "any",
                    value: "",
                }));
                const action = {
                    kind: "call",
                    function: fnName,
                    args,
                };
                if (def.returnType && def.returnType !== "void" && def.returnType !== "undefined") {
                    action.assignTo = `${fnName}_result`;
                }
                actions.push(action);
            }
            proposals.push({
                id: `rp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
                violationIndex: 0, // protocol violations don't have a specific transition index
                reason: `Protocol violation: ${rejection.blocked} requires ${fnName}`,
                strategy: "insert",
                insertBefore: undefined, // caller decides exact position
                proposedActions: actions,
                confidence: 0.85 + (i * 0.05), // later steps in fixPath have higher confidence
                explanation: `Insert ${fnName} before ${rejection.blocked}. Missing states: [${(rejection.missingFunctions || []).join(", ")}]. Fix path: ${rejection.fixPath.join(" → ")}`,
            });
        }
    }
    // If no fixPath but missing functions are known, propose searching
    if (proposals.length === 0 && rejection.missingFunctions && rejection.missingFunctions.length > 0) {
        proposals.push({
            id: `rp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            violationIndex: 0,
            reason: `Protocol violation: ${rejection.blocked} blocked`,
            strategy: "insert",
            proposedActions: [],
            confidence: 0.5,
            explanation: `Cannot determine fix path. Blocked function: ${rejection.blocked}. Required states: [${(rejection.requiredState || []).join(", ")}]. Current states: [${(rejection.currentState || []).join(", ")}].`,
        });
    }
    return proposals;
}
/** Invariant violation repair: use rebuildState to compute correct transition data. */
/** Generate repair proposals for invariant consistency violations. */
function suggestInvariantRepair(violation, ledger, namespaceInitialStates = (0, protocol_registry_1.getNsInit)()) {
    const proposals = [];
    if (violation.invariant === "before-consistency") {
        // statesBefore is wrong — can be recomputed from rebuildState
        const correctStatesBefore = violation.expected;
        const t = ledger[violation.index];
        if (!t)
            return [];
        const correctedTransition = {
            ...t,
            statesBefore: correctStatesBefore,
        };
        // Ontology: verify corrected transition passes delta consistency
        try {
            (0, runtime_invariants_1.assertDeltaConsistency)(correctedTransition);
        }
        catch { }
        proposals.push({
            id: `rp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            violationIndex: violation.index,
            reason: `Invariant-0 (before-consistency): statesBefore mismatch at index ${violation.index}`,
            strategy: "replace",
            replacement: correctedTransition,
            proposedActions: [], // no new actions needed — just correct the record
            confidence: 0.95,
            explanation: `Transition[${violation.index}] "${t.function}" has incorrect statesBefore. Expected: ${JSON.stringify(correctStatesBefore[t.namespace] || [])}. This is likely a recording error, not a code error.`,
        });
    }
    if (violation.invariant === "delta-consistency") {
        // statesAfter doesn't match applyDelta(statesBefore, acquired, invalidated)
        const correctStatesAfter = violation.expected;
        const t = ledger[violation.index];
        if (!t)
            return [];
        const correctedTransition = {
            ...t,
            statesAfter: correctStatesAfter,
        };
        try {
            (0, runtime_invariants_1.assertDeltaConsistency)(correctedTransition);
        }
        catch { }
        proposals.push({
            id: `rp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            violationIndex: violation.index,
            reason: `Invariant-1 (delta-consistency): statesAfter mismatch at index ${violation.index}`,
            strategy: "replace",
            replacement: correctedTransition,
            proposedActions: [],
            confidence: 0.95,
            explanation: `Transition[${violation.index}] "${t.function}" statesAfter does not match applyDelta(statesBefore). Expected: ${JSON.stringify(correctStatesAfter[t.namespace] || [])}. The acquire/invalidate fields may also need recomputation.`,
        });
    }
    return proposals;
}
/** Generic repair for SVL-1/SVL-2/SVL-3 violations. */
function suggestGenericRepair(violation, ir) {
    const base = {
        id: `rp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        violationIndex: violation.actionIndex,
        proposedActions: [],
    };
    switch (violation.violatedConstraint) {
        case "symbol_existence": {
            // Find closest matching function in IR
            const missingName = violation.missingStates?.[0] || "unknown";
            let bestMatch = "";
            let bestScore = 0;
            for (const fn of ir) {
                const score = jaccardSimilarity(missingName.toLowerCase(), fn.name.toLowerCase());
                if (score > bestScore && score >= 0.3) {
                    bestScore = score;
                    bestMatch = fn.name;
                }
            }
            if (bestMatch) {
                const def = ir.find((f) => f.name === bestMatch);
                const args = (def?.params || []).map((p, j) => ({
                    name: p.name || `p${j}`,
                    type: p.type || "any",
                    value: "",
                }));
                return {
                    ...base,
                    reason: `SVL-1: function "${missingName}" does not exist`,
                    strategy: "replace",
                    proposedActions: [{ kind: "call", function: bestMatch, args }],
                    confidence: 0.7 + bestScore * 0.3,
                    explanation: `Replace "${missingName}" with the closest real function "${bestMatch}" (similarity: ${(bestScore * 100).toFixed(0)}%).`,
                };
            }
            return {
                ...base,
                reason: `SVL-1: function "${missingName}" does not exist`,
                strategy: "replace",
                confidence: 0.1,
                explanation: `Cannot find a matching function for "${missingName}" in the IR. Manual intervention required.`,
            };
        }
        case "type_mismatch":
            return {
                ...base,
                reason: `SVL-2: type/parameter mismatch`,
                strategy: "replace",
                confidence: 0.6,
                explanation: `Action[${violation.actionIndex}] has incorrect parameter types or count. Check the function signature in IR and adjust args accordingly.`,
            };
        case "dataflow":
            return {
                ...base,
                reason: `SVL-3: dataflow violation`,
                strategy: "reorder",
                confidence: 0.5,
                explanation: `Action[${violation.actionIndex}] uses a variable before it's defined, or creates a circular reference. Reorder actions or add an assignment.`,
            };
        default:
            return {
                ...base,
                reason: `Unknown violation: ${violation.violatedConstraint}`,
                strategy: "replace",
                confidence: 0.1,
                explanation: violation.description,
            };
    }
}
// ── Proposal → Branch Bridge ──
/** Convert an accepted repair proposal into a new Branch.
 *  Creates a child branch with the proposed fix applied.
 *  The original ledger is never modified. */
/** Convert an accepted repair proposal into a new branch. */
function applyProposalAsBranch(proposal, parentBranch, currentLedger, ir) {
    const branch = (0, branch_ledger_1.createBranch)(parentBranch, "repair_attempt");
    switch (proposal.strategy) {
        case "insert": {
            if (proposal.insertBefore !== undefined && proposal.insertBefore < currentLedger.length) {
                // Insert proposed actions before the violation point
                const before = currentLedger.slice(0, proposal.insertBefore);
                const after = currentLedger.slice(proposal.insertBefore);
                // Create placeholder transitions for inserted actions
                const newTransitions = proposal.proposedActions.map((a, i) => ({
                    actionIndex: proposal.insertBefore + i,
                    function: a.kind === "call" ? a.function : a.kind,
                    namespace: "_global",
                    acquired: [],
                    invalidated: [],
                    statesBefore: {},
                    statesAfter: {},
                    valid: true,
                }));
                branch.transitions = [...before, ...newTransitions, ...after];
            }
            else {
                branch.transitions = [...currentLedger];
            }
            break;
        }
        case "replace": {
            if (proposal.replacement && proposal.violationIndex < currentLedger.length) {
                branch.transitions = currentLedger.map((t, i) => i === proposal.violationIndex ? proposal.replacement : t);
            }
            else {
                branch.transitions = [...currentLedger];
            }
            break;
        }
        case "reorder": {
            if (proposal.newOrder) {
                branch.transitions = proposal.newOrder.map(i => currentLedger[i]);
            }
            else {
                branch.transitions = [...currentLedger];
            }
            break;
        }
        default:
            branch.transitions = [...currentLedger];
    }
    return branch;
}
// ── Validation ──
/** Validate a repair proposal: does applying it fix the violation?
 *  Returns true if a re-check passes after applying the proposal. */
/** Validate whether a repair proposal fixes the violation. */
function validateProposal(proposal, currentLedger, namespaceInitialStates = (0, protocol_registry_1.getNsInit)()) {
    let proposedLedger;
    switch (proposal.strategy) {
        case "replace":
            proposedLedger = currentLedger.map((t, i) => i === proposal.violationIndex && proposal.replacement ? proposal.replacement : t);
            break;
        case "reorder":
            proposedLedger = proposal.newOrder
                ? proposal.newOrder.map(i => currentLedger[i])
                : [...currentLedger];
            break;
        case "insert":
        default:
            proposedLedger = [...currentLedger];
    }
    const result = (0, ssg_validator_1.checkLedgerConsistency)(proposedLedger, namespaceInitialStates);
    return {
        valid: result.consistent,
        remainingViolations: result.violations,
    };
}
// ── Summary ──
/** Generate a comprehensive repair summary from a ledger and IR context. */
/** Generate a comprehensive repair summary with minimal fix set. */
/** @requires LEDGER_DATA @produces REPAIR_SUMMARY */
function generateRepairSummary(ledger, ir, protocols, namespaceInitialStates = (0, protocol_registry_1.getNsInit)()) {
    const consistency = (0, ssg_validator_1.checkLedgerConsistency)(ledger, namespaceInitialStates);
    const allProposals = [];
    // Generate invariant repair proposals
    for (const v of consistency.violations) {
        allProposals.push(...suggestInvariantRepair(v, ledger, namespaceInitialStates));
    }
    const minimalFixSet = getMinimalFixSet(allProposals);
    return {
        totalViolations: consistency.violations.length,
        proposals: allProposals,
        minimalFixSet,
    };
}
/**
 * Deduplicate repair proposals: pick the highest-confidence proposal per violation index.
 * Returns proposals sorted by violationIndex (ascending).
 *
 * This is the authoritative "minimal fix set" — applying these proposals in order
 * should resolve all detected violations without redundant fixes.
 */
/** Get the minimal set of repair proposals by deduplication. */
/** @requires REPAIR_PROPOSALS @produces MINIMAL_FIX_SET */
function getMinimalFixSet(proposals) {
    const seen = new Map();
    for (const p of proposals) {
        const existing = seen.get(p.violationIndex);
        if (!existing || p.confidence > existing.confidence) {
            seen.set(p.violationIndex, p);
        }
    }
    return [...seen.values()].sort((a, b) => a.violationIndex - b.violationIndex);
}
// ── Helpers ──
function tryParseRejection(v) {
    try {
        if (v.description) {
            const parsed = JSON.parse(v.description);
            if (parsed.protocol_violation) {
                return parsed.protocol_violation;
            }
        }
    }
    catch {
        // Not JSON — try to extract from description string
    }
    return null;
}
function jaccardSimilarity(a, b) {
    const setA = new Set(a.split(""));
    const setB = new Set(b.split(""));
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return union.size === 0 ? 0 : intersection.size / union.size;
}
