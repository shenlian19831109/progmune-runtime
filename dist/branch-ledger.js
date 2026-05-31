"use strict";
/**
 * Phase 4: Branch Ledger (P1)
 *
 * Upgrades the semantic ledger from linear to tree-structured.
 * Supports fork/merge for future Repair Planner, alternative plans,
 * and counterfactual replay.
 *
 * A Branch is a named sequence of state transitions with a parent reference.
 * The full execution is a tree of branches rooted at a single "root" branch.
 *
 * Backward compatible: existing linear ledgers auto-wrap as single-branch root.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateBranchId = generateBranchId;
exports.createRootBranch = createRootBranch;
exports.createBranch = createBranch;
exports.forkBranch = forkBranch;
exports.mergeBranches = mergeBranches;
exports.flattenBranch = flattenBranch;
exports.getBranchPath = getBranchPath;
exports.replayBranch = replayBranch;
exports.buildBranchMap = buildBranchMap;
exports.findRootBranch = findRootBranch;
exports.findChildBranches = findChildBranches;
exports.describeBranchTree = describeBranchTree;
exports.wrapAsBranch = wrapAsBranch;
exports.unwrapBranchTree = unwrapBranchTree;
const ssg_validator_1 = require("./ssg-validator");
const runtime_invariants_1 = require("./runtime-invariants");
// ── Pure Functions ──
/** Generate a unique branch ID. */
function generateBranchId() {
    return `br_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
/** Create the root branch of a new execution tree. */
function createRootBranch(transitions = []) {
    const id = generateBranchId();
    return {
        id,
        rootId: id,
        transitions,
        reason: "root",
        createdAt: Date.now(),
    };
}
/**
 * Create a CHILD branch (parent → child relationship).
 *
 * Tree structure:
 *   root
 *   └── child (parentId = root.id)
 *
 * The child starts with an independent transition sequence. It does NOT
 * inherit any transitions from the parent — it begins empty or with
 * the given initialTransitions. The parent's state at creation time is
 * the child's implicit starting state; use forkBranch() if you need to
 * share a prefix of transitions.
 *
 * Use createBranch when:
 * - Creating an alternative implementation from scratch
 * - The child has no shared history with the parent beyond the parent's
 *   final state
 */
function createBranch(parent, reason = "alternative", initialTransitions = []) {
    const id = generateBranchId();
    return {
        id,
        parentId: parent.id,
        rootId: parent.rootId,
        transitions: initialTransitions,
        reason,
        createdAt: Date.now(),
    };
}
/**
 * Fork a branch at a specific transition index, creating a SIBLING branch.
 *
 * Sibling semantics (NOT child):
 *   parent
 *   ├── original (branch, truncated at splitIndex, marked "abandoned")
 *   └── forked  (NEW sibling — same parentId as original, NOT a child of original)
 *
 * Tree structure BEFORE fork:
 *   ... → parent → branch
 *
 * Tree structure AFTER fork:
 *   ... → parent
 *         ├── original (abandoned — only transitions[0..splitIndex])
 *         └── forked  (repair_attempt — transitions[splitIndex+1..end])
 *
 * Both share the same parent. The forked branch inherits the COMMON PREFIX
 * (transitions 0..splitIndex) implicitly through the tree path — flattenBranch()
 * will walk parent → forked and include parent's + forked's transitions.
 *
 * Use forkBranch when:
 * - A violation is detected at splitIndex and you want to try a fix
 * - The prefix up to splitIndex is valid and should be preserved
 * - You want to keep the original as evidence (abandoned, not deleted)
 *
 * Use createBranch when:
 * - Starting a completely fresh alternative from the parent's final state
 */
function forkBranch(branch, splitIndex, reason = "repair_attempt") {
    const sharedTransitions = branch.transitions.slice(0, splitIndex + 1);
    const remainingTransitions = branch.transitions.slice(splitIndex + 1);
    const original = {
        ...branch,
        transitions: sharedTransitions,
        outcome: "abandoned",
    };
    const forked = {
        id: generateBranchId(),
        parentId: branch.parentId, // sibling — same parent
        rootId: branch.rootId,
        transitions: remainingTransitions,
        reason,
        createdAt: Date.now(),
    };
    // Ontology: verify all split transitions are internally consistent
    for (const t of [...sharedTransitions, ...remainingTransitions]) {
        if (t.valid)
            try {
                (0, runtime_invariants_1.assertDeltaConsistency)(t);
            }
            catch { }
    }
    return { original, forked };
}
/** Merge multiple branches into one.
 *  Takes the successful path: concatenates transitions from each branch
 *  in the order they appear in the tree path.
 *  Returns null if no branches have transitions. */
function mergeBranches(branches) {
    const validBranches = branches.filter(b => b.transitions.length > 0);
    if (validBranches.length === 0)
        return null;
    // Sort by creation time to preserve causal order
    const sorted = [...validBranches].sort((a, b) => a.createdAt - b.createdAt);
    const first = sorted[0];
    const merged = {
        id: generateBranchId(),
        rootId: first.rootId,
        transitions: [],
        reason: "merge",
        createdAt: Date.now(),
    };
    // Deduplicate transitions by index (keep first occurrence)
    const seenIndices = new Set();
    for (const branch of sorted) {
        for (const t of branch.transitions) {
            if (!seenIndices.has(t.actionIndex)) {
                seenIndices.add(t.actionIndex);
                merged.transitions.push(t);
            }
        }
    }
    // Sort by actionIndex
    merged.transitions.sort((a, b) => a.actionIndex - b.actionIndex);
    return merged;
}
/** Flatten a branch and all its ancestors into a single linear transition sequence.
 *  This is the bridge between the tree model and existing linear-only consumers
 *  (checkLedgerConsistency, hashLedger, etc.). */
function flattenBranch(branch, allBranches) {
    const path = getBranchPath(branch, allBranches);
    const allTransitions = [];
    const seenIndices = new Set();
    for (const b of path) {
        for (const t of b.transitions) {
            // In case of index collision (forked branches), keep the later branch's version
            if (seenIndices.has(t.actionIndex)) {
                // Replace the earlier transition with this one
                const existingIdx = allTransitions.findIndex(existing => existing.actionIndex === t.actionIndex);
                if (existingIdx >= 0) {
                    allTransitions[existingIdx] = t;
                }
            }
            else {
                seenIndices.add(t.actionIndex);
                allTransitions.push(t);
            }
        }
    }
    return allTransitions.sort((a, b) => a.actionIndex - b.actionIndex);
}
/** Get the path from root to a given branch (inclusive). */
function getBranchPath(branch, allBranches) {
    const path = [];
    let current = branch;
    while (current) {
        path.unshift(current);
        if (current.parentId) {
            current = allBranches.get(current.parentId);
        }
        else {
            current = undefined;
        }
    }
    return path;
}
/** Replay a branch tree: rebuild state across all ancestor branches
 *  and verify every transition is valid. */
function replayBranch(branch, allBranches, namespaceInitialStates = new Map([["_global", "INIT"]])) {
    const path = getBranchPath(branch, allBranches);
    const pathIds = path.map(b => b.id);
    // Collect all transitions in tree order
    const allTransitions = flattenBranch(branch, allBranches);
    // Check validity
    let valid = true;
    let violationIndex;
    let violationBranch;
    for (const t of allTransitions) {
        if (!t.valid) {
            valid = false;
            violationIndex = t.actionIndex;
            // Find which branch contains this transition
            for (const b of path) {
                if (b.transitions.some(bt => bt.actionIndex === t.actionIndex)) {
                    violationBranch = b.id;
                    break;
                }
            }
            break;
        }
    }
    const finalState = allTransitions.length > 0
        ? (0, ssg_validator_1.rebuildState)(allTransitions, namespaceInitialStates)
        : {};
    return {
        branchId: branch.id,
        path: pathIds,
        finalState,
        totalTransitions: allTransitions.length,
        valid,
        violationIndex,
        violationBranch,
    };
}
/** Build a branch lookup map from an array of branches. */
function buildBranchMap(branches) {
    const map = new Map();
    for (const b of branches) {
        map.set(b.id, b);
    }
    return map;
}
/** Find the root branch of a tree. */
function findRootBranch(branches) {
    return branches.find(b => !b.parentId);
}
/** Find all child branches of a given parent. */
function findChildBranches(parent, allBranches) {
    const children = [];
    for (const b of allBranches.values()) {
        if (b.parentId === parent.id) {
            children.push(b);
        }
    }
    return children;
}
/** Get the full branch tree as a human-readable structure. */
function describeBranchTree(root, allBranches, indent = 0) {
    const prefix = "  ".repeat(indent);
    let result = `${prefix}${root.id.slice(0, 12)} [${root.reason}] (${root.transitions.length} tx, outcome: ${root.outcome || "open"})\n`;
    const children = findChildBranches(root, allBranches);
    for (const child of children) {
        result += describeBranchTree(child, allBranches, indent + 1);
    }
    return result;
}
/** Wrap a linear transition array as a single root branch (backward compat). */
function wrapAsBranch(transitions) {
    const b = createRootBranch(transitions);
    b.outcome = transitions.length > 0
        ? (transitions.every(t => t.valid) ? "success" : "violation")
        : "success";
    return b;
}
/** Unwrap a branch tree to the linear transition list.
 *  For backward compatibility: flattens the "winning" path (first successful leaf). */
function unwrapBranchTree(branches) {
    if (branches.length === 0)
        return [];
    const map = buildBranchMap(branches);
    const root = findRootBranch(branches);
    if (!root)
        return [];
    // Find the first successful leaf
    const successfulLeaf = findSuccessfulLeaf(root, map);
    if (successfulLeaf) {
        return flattenBranch(successfulLeaf, map);
    }
    // Fallback: flatten the root
    return flattenBranch(root, map);
}
function findSuccessfulLeaf(branch, allBranches) {
    if (branch.outcome === "success") {
        // Check if any children are also successful (prefer children)
        const children = findChildBranches(branch, allBranches);
        for (const child of children) {
            const leaf = findSuccessfulLeaf(child, allBranches);
            if (leaf)
                return leaf;
        }
        return branch;
    }
    return undefined;
}
