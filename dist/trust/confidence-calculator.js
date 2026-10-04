"use strict";
/**
 * Phase 1 D3/D4: Coverage-Based Confidence Calculator
 *
 * Replaces qualitative Confidence labels (HIGH/MEDIUM/LOW/UNCERTAIN) with
 * computed Confidence = Σ weight(ns) × Coverage(ns).
 *
 * Two-factor model: Coverage(ns) = has_vocabulary(ns) × density_factor(ns)
 *
 * Integrates with: trajectory corpus data, protocols.json transition space,
 * and project-level protocol usage analysis.
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
exports.computeCoverageConfidence = computeCoverageConfidence;
exports.clearConfidenceCache = clearConfidenceCache;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ── Constants (from Phase 1 empirical data) ──
/** Empirical saturation threshold: ~5 trajectories per transition */
const SATURATION_THRESHOLD = 5;
/** Confidence level thresholds */
const HIGH_THRESHOLD = 70;
const MEDIUM_THRESHOLD = 40;
let _cachedTransitionSpace = null;
function loadTransitionSpace(projectPath) {
    if (_cachedTransitionSpace)
        return _cachedTransitionSpace;
    const protoPath = path.join(projectPath, "protocols.json");
    if (!fs.existsSync(protoPath)) {
        _cachedTransitionSpace = { totalTransitions: 0, perNamespace: new Map() };
        return _cachedTransitionSpace;
    }
    const proto = JSON.parse(fs.readFileSync(protoPath, "utf-8"));
    const rules = proto.rules || {};
    const allTransitions = new Set();
    const perNamespaceTransitions = new Map();
    for (const [, rule] of Object.entries(rules)) {
        const ns = rule.namespace || "_global";
        if (!perNamespaceTransitions.has(ns)) {
            perNamespaceTransitions.set(ns, new Set());
        }
        const nsSet = perNamespaceTransitions.get(ns);
        for (const pre of rule.pre_states || []) {
            for (const post of rule.post_states || []) {
                const key = `${ns}::${pre}::${post}`;
                allTransitions.add(key);
                nsSet.add(key);
            }
        }
    }
    const perNamespace = new Map();
    for (const [ns, trans] of perNamespaceTransitions) {
        perNamespace.set(ns, trans.size);
    }
    _cachedTransitionSpace = {
        totalTransitions: allTransitions.size,
        perNamespace,
    };
    return _cachedTransitionSpace;
}
let _cachedCoverage = null;
function loadTrajectoryCoverage(projectPath) {
    if (_cachedCoverage)
        return _cachedCoverage;
    const protoPath = path.join(projectPath, "protocols.json");
    if (!fs.existsSync(protoPath)) {
        _cachedCoverage = { coveredTransitions: new Set(), trajectoryCounts: new Map() };
        return _cachedCoverage;
    }
    const proto = JSON.parse(fs.readFileSync(protoPath, "utf-8"));
    const rules = proto.rules || {};
    // Build rule → transitions map (consistent key format: ns::pre::post)
    const ruleTransitions = {};
    for (const [rname, rule] of Object.entries(rules)) {
        const ns = rule.namespace || "_global";
        ruleTransitions[rname] = [];
        for (const pre of rule.pre_states || []) {
            for (const post of rule.post_states || []) {
                ruleTransitions[rname].push({ ns, key: `${ns}::${pre}::${post}` });
            }
        }
    }
    const coveredTransitions = new Set();
    const trajectoryCounts = new Map();
    // Scan trajectory corpus
    const corpusDir = path.join(projectPath, ".progmune_corpus", "trajectories");
    if (!fs.existsSync(corpusDir)) {
        _cachedCoverage = { coveredTransitions, trajectoryCounts };
        return _cachedCoverage;
    }
    for (const dateDir of fs.readdirSync(corpusDir)) {
        const dpath = path.join(corpusDir, dateDir);
        if (!fs.statSync(dpath).isDirectory())
            continue;
        for (const f of fs.readdirSync(dpath)) {
            if (!f.endsWith(".json"))
                continue;
            try {
                const traj = JSON.parse(fs.readFileSync(path.join(dpath, f), "utf-8"));
                const trajNs = new Set();
                for (const step of traj.trajectory || []) {
                    if (step in ruleTransitions) {
                        for (const { ns, key } of ruleTransitions[step]) {
                            coveredTransitions.add(key);
                            trajNs.add(ns);
                        }
                    }
                }
                // One trajectory can count for multiple namespaces
                for (const ns of trajNs) {
                    trajectoryCounts.set(ns, (trajectoryCounts.get(ns) || 0) + 1);
                }
            }
            catch {
                // skip malformed files
            }
        }
    }
    _cachedCoverage = { coveredTransitions, trajectoryCounts };
    return _cachedCoverage;
}
// ── Per-Namespace Confidence ──
function computeNamespaceConfidence(ns, totalTransitions, coveredCount, trajectoryCount) {
    const hasVocab = coveredCount > 0;
    const densityFactor = totalTransitions > 0
        ? Math.min(1, trajectoryCount / (SATURATION_THRESHOLD * totalTransitions))
        : 0;
    const coverage = totalTransitions > 0 ? coveredCount / totalTransitions : 0;
    let status;
    if (!hasVocab) {
        status = "no_vocabulary";
    }
    else if (densityFactor >= 0.8) {
        status = "saturated";
    }
    else {
        status = "partial";
    }
    return {
        namespace: ns,
        coverage: Math.round(coverage * 1000) / 1000,
        transitionsCovered: coveredCount,
        transitionsTotal: totalTransitions,
        trajectoryDensity: Math.round(densityFactor * 100) / 100,
        status,
    };
}
// ── Project-Level Confidence ──
/**
 * Estimate namespace usage weights for a project.
 *
 * Currently uses a heuristic based on file extensions and directory structure.
 * Future: parse IR function calls to determine actual protocol usage.
 */
function estimateProjectWeights(projectPath, namespaces) {
    const weights = new Map();
    // Default: equal weight for all namespaces
    // In production, this would analyze the project's function calls
    // to determine which protocols are actually used.
    const defaultWeight = 1.0 / namespaces.length;
    for (const ns of namespaces) {
        weights.set(ns, defaultWeight);
    }
    return weights;
}
// ── Main API ──
/**
 * Compute coverage-based confidence for a project.
 *
 * @param projectPath - Absolute path to the project root (contains protocols.json + .progmune_corpus/)
 * @returns CoverageConfidence with computed score, margin, level, and breakdown
 */
function computeCoverageConfidence(projectPath) {
    // 1. Load protocol transition space
    const space = loadTransitionSpace(projectPath);
    const namespaces = [...space.perNamespace.keys()];
    // §53：协议定义不存在 ⇒ 本指标不可测（0 分是「没得测」，不是「测得低」）
    const applicable = fs.existsSync(path.join(projectPath, "protocols.json"));
    // 2. Load trajectory coverage
    const coverage = loadTrajectoryCoverage(projectPath);
    // 3. Compute per-namespace confidence
    const breakdown = [];
    let weightedSum = 0;
    let totalWeight = 0;
    const weights = estimateProjectWeights(projectPath, namespaces);
    for (const ns of namespaces) {
        const totalTrans = space.perNamespace.get(ns) || 0;
        const coveredCount = [...coverage.coveredTransitions]
            .filter(t => t.startsWith(`${ns}::`)).length;
        const trajCount = coverage.trajectoryCounts.get(ns) || 0;
        const nsCov = computeNamespaceConfidence(ns, totalTrans, coveredCount, trajCount);
        breakdown.push(nsCov);
        const w = weights.get(ns) || 0;
        weightedSum += w * nsCov.coverage;
        totalWeight += w;
    }
    // 4. Normalize score
    const score = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : 0;
    // 5. Compute margin (simplified: based on proportion of namespaces with trajectory data)
    const nsWithVocab = breakdown.filter(b => b.status !== "no_vocabulary").length;
    const vocabRatio = namespaces.length > 0 ? nsWithVocab / namespaces.length : 0;
    // Margin decreases as more namespaces have vocabulary
    const margin = Math.round((1 - vocabRatio) * 20 + 5); // 5-25% margin
    // 6. Determine level
    let level;
    if (score >= HIGH_THRESHOLD) {
        level = "HIGH";
    }
    else if (score >= MEDIUM_THRESHOLD) {
        level = "MEDIUM";
    }
    else {
        level = "LOW";
    }
    // 7. Build summary
    const saturated = breakdown.filter(b => b.status === "saturated").length;
    const partial = breakdown.filter(b => b.status === "partial").length;
    const noVocab = breakdown.filter(b => b.status === "no_vocabulary").length;
    const summary = `Weighted coverage: ${score}% ±${margin}%. ` +
        `${saturated} namespaces saturated, ${partial} partial, ${noVocab} no vocabulary. ` +
        (noVocab > 0 ? `Top gap: add trajectories for ${noVocab} uncovered namespaces.` : "");
    return { score, margin, level, breakdown, summary, applicable };
}
/**
 * Clear internal caches (for testing or when corpus is updated).
 */
function clearConfidenceCache() {
    _cachedTransitionSpace = null;
    _cachedCoverage = null;
}
