"use strict";
/**
 * Planner Constraints — mined rules injected into the search space.
 *
 * Bridges Rule Miner → Planner: MinedRule patterns directly influence
 * function scoring, filtering, and prioritization in the capability graph.
 *
 * Three levels of constraint:
 *   L1 (soft): Adjust function scores based on rule confidence
 *   L2 (medium): Deprioritize functions matching high-risk patterns
 *   L3 (hard): Blacklist functions that consistently cause violations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveConstraints = deriveConstraints;
exports.applyConstraints = applyConstraints;
exports.formatConstraints = formatConstraints;
exports.getConstraints = getConstraints;
exports.clearConstraintsCache = clearConstraintsCache;
const rule_miner_1 = require("./rule-miner");
/**
 * Derive planner constraints from mined rules.
 * Each mined rule becomes a scoring constraint that modifies
 * how functions are weighted during capability graph construction.
 */
function deriveConstraints() {
    const rules = (0, rule_miner_1.mineRules)();
    const constraints = [];
    for (const rule of rules) {
        // High-confidence rules → stronger penalties
        const normalizedConf = Math.min(1, rule.confidence / 50); // 50+ occurrences = max confidence
        // Pattern-based constraints
        if (rule.function === "symbol_existence") {
            constraints.push({
                pattern: "symbol_existence",
                penalty: Math.max(0.3, 1 - normalizedConf * 0.5), // 0.3-1.0
                reason: rule.reason,
                confidence: rule.confidence,
            });
        }
        if (rule.function === "protocol") {
            constraints.push({
                pattern: "protocol",
                penalty: Math.max(0.4, 1 - normalizedConf * 0.4),
                reason: rule.reason,
                confidence: rule.confidence,
            });
        }
        if (rule.function === "type_mismatch") {
            constraints.push({
                pattern: "type_mismatch",
                penalty: Math.max(0.5, 1 - normalizedConf * 0.3),
                reason: rule.reason,
                confidence: rule.confidence,
            });
        }
        if (rule.function === "dataflow") {
            constraints.push({
                pattern: "dataflow",
                penalty: Math.max(0.5, 1 - normalizedConf * 0.3),
                reason: rule.reason,
                confidence: rule.confidence,
            });
        }
    }
    return constraints;
}
/**
 * Apply constraints to adjust a function's score.
 * Returns a multiplier in [0, 1] — multiply the raw score by this.
 */
function applyConstraints(funcName, funcPurpose, constraints) {
    let multiplier = 1.0;
    const matched = [];
    const searchText = (funcName + " " + funcPurpose).toLowerCase();
    for (const c of constraints) {
        // Match: function name/purpose contains the pattern
        if (searchText.includes(c.pattern.toLowerCase())) {
            multiplier *= c.penalty;
            matched.push(`${c.pattern}(${(c.confidence)}x)`);
        }
    }
    return { multiplier: Math.max(0.2, multiplier), matchedRules: matched };
}
/**
 * Get a human-readable summary of active constraints.
 */
function formatConstraints(constraints) {
    if (constraints.length === 0)
        return "";
    const lines = ["\n📋 规则约束 (Rule → Planner):"];
    for (const c of constraints.slice(0, 5)) {
        const level = c.penalty < 0.4 ? "🔴" : c.penalty < 0.7 ? "🟡" : "🟢";
        lines.push(`  ${level} ${c.pattern}: ×${c.penalty.toFixed(2)} (${c.reason.slice(0, 40)})`);
    }
    return lines.join("\n");
}
// Cache constraints (derived once per session)
let _constraints = null;
function getConstraints() {
    if (!_constraints)
        _constraints = deriveConstraints();
    return _constraints;
}
function clearConstraintsCache() { _constraints = null; }
