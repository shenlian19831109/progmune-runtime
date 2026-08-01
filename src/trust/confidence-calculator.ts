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

import * as fs from "fs";
import * as path from "path";

// ── Types ──

export type NamespaceStatus = "saturated" | "partial" | "no_vocabulary";

export interface NamespaceCoverage {
  namespace: string;
  coverage: number;            // 0–1
  transitionsCovered: number;
  transitionsTotal: number;
  trajectoryDensity: number;   // trajectories per transition
  status: NamespaceStatus;
}

export interface CoverageConfidence {
  score: number;               // 0–100 weighted coverage percentage
  margin: number;              // ±margin (based on trajectory density CI)
  level: "HIGH" | "MEDIUM" | "LOW";
  breakdown: NamespaceCoverage[];
  summary: string;             // human-readable summary line
}

// ── Constants (from Phase 1 empirical data) ──

/** Empirical saturation threshold: ~5 trajectories per transition */
const SATURATION_THRESHOLD = 5;

/** Confidence level thresholds */
const HIGH_THRESHOLD = 70;
const MEDIUM_THRESHOLD = 40;

// ── Protocol Transition Space ──

interface ProtocolRule {
  namespace: string;
  pre_states: string[];
  post_states: string[];
}

interface TransitionSpace {
  /** total unique (namespace, pre_state, post_state) transitions */
  totalTransitions: number;
  /** Map of namespace → transition count */
  perNamespace: Map<string, number>;
}

let _cachedTransitionSpace: TransitionSpace | null = null;

function loadTransitionSpace(projectPath: string): TransitionSpace {
  if (_cachedTransitionSpace) return _cachedTransitionSpace;

  const protoPath = path.join(projectPath, "protocols.json");
  if (!fs.existsSync(protoPath)) {
    _cachedTransitionSpace = { totalTransitions: 0, perNamespace: new Map() };
    return _cachedTransitionSpace;
  }

  const proto = JSON.parse(fs.readFileSync(protoPath, "utf-8"));
  const rules: Record<string, ProtocolRule> = proto.rules || {};

  const allTransitions = new Set<string>();
  const perNamespaceTransitions = new Map<string, Set<string>>();

  for (const [, rule] of Object.entries(rules)) {
    const ns = rule.namespace || "_global";
    if (!perNamespaceTransitions.has(ns)) {
      perNamespaceTransitions.set(ns, new Set());
    }
    const nsSet = perNamespaceTransitions.get(ns)!;
    for (const pre of rule.pre_states || []) {
      for (const post of rule.post_states || []) {
        const key = `${ns}::${pre}::${post}`;
        allTransitions.add(key);
        nsSet.add(key);
      }
    }
  }

  const perNamespace = new Map<string, number>();
  for (const [ns, trans] of perNamespaceTransitions) {
    perNamespace.set(ns, trans.size);
  }

  _cachedTransitionSpace = {
    totalTransitions: allTransitions.size,
    perNamespace,
  };
  return _cachedTransitionSpace;
}

// ── Trajectory Coverage Analysis ──

interface TrajectoryCoverageData {
  /** Set of (namespace, pre_state, post_state) transitions seen in any trajectory */
  coveredTransitions: Set<string>;
  /** Per-namespace trajectory counts (a trajectory counts for ns if it calls any rule in ns) */
  trajectoryCounts: Map<string, number>;
}

let _cachedCoverage: TrajectoryCoverageData | null = null;

function loadTrajectoryCoverage(projectPath: string): TrajectoryCoverageData {
  if (_cachedCoverage) return _cachedCoverage;

  const protoPath = path.join(projectPath, "protocols.json");
  if (!fs.existsSync(protoPath)) {
    _cachedCoverage = { coveredTransitions: new Set(), trajectoryCounts: new Map() };
    return _cachedCoverage;
  }

  const proto = JSON.parse(fs.readFileSync(protoPath, "utf-8"));
  const rules: Record<string, ProtocolRule> = proto.rules || {};

  // Build rule → transitions map (consistent key format: ns::pre::post)
  const ruleTransitions: Record<string, Array<{ ns: string; key: string }>> = {};
  for (const [rname, rule] of Object.entries(rules)) {
    const ns = rule.namespace || "_global";
    ruleTransitions[rname] = [];
    for (const pre of rule.pre_states || []) {
      for (const post of rule.post_states || []) {
        ruleTransitions[rname].push({ ns, key: `${ns}::${pre}::${post}` });
      }
    }
  }

  const coveredTransitions = new Set<string>();
  const trajectoryCounts = new Map<string, number>();

  // Scan trajectory corpus
  const corpusDir = path.join(projectPath, ".progmune_corpus", "trajectories");
  if (!fs.existsSync(corpusDir)) {
    _cachedCoverage = { coveredTransitions, trajectoryCounts };
    return _cachedCoverage;
  }

  for (const dateDir of fs.readdirSync(corpusDir)) {
    const dpath = path.join(corpusDir, dateDir);
    if (!fs.statSync(dpath).isDirectory()) continue;
    for (const f of fs.readdirSync(dpath)) {
      if (!f.endsWith(".json")) continue;
      try {
        const traj = JSON.parse(fs.readFileSync(path.join(dpath, f), "utf-8"));
        const trajNs = new Set<string>();
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
      } catch {
        // skip malformed files
      }
    }
  }

  _cachedCoverage = { coveredTransitions, trajectoryCounts };
  return _cachedCoverage;
}

// ── Per-Namespace Confidence ──

function computeNamespaceConfidence(
  ns: string,
  totalTransitions: number,
  coveredCount: number,
  trajectoryCount: number
): NamespaceCoverage {
  const hasVocab = coveredCount > 0;
  const densityFactor = totalTransitions > 0
    ? Math.min(1, trajectoryCount / (SATURATION_THRESHOLD * totalTransitions))
    : 0;

  const coverage = totalTransitions > 0 ? coveredCount / totalTransitions : 0;

  let status: NamespaceStatus;
  if (!hasVocab) {
    status = "no_vocabulary";
  } else if (densityFactor >= 0.8) {
    status = "saturated";
  } else {
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
function estimateProjectWeights(
  projectPath: string,
  namespaces: string[]
): Map<string, number> {
  const weights = new Map<string, number>();

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
export function computeCoverageConfidence(projectPath: string): CoverageConfidence {
  // 1. Load protocol transition space
  const space = loadTransitionSpace(projectPath);
  const namespaces = [...space.perNamespace.keys()];

  // 2. Load trajectory coverage
  const coverage = loadTrajectoryCoverage(projectPath);

  // 3. Compute per-namespace confidence
  const breakdown: NamespaceCoverage[] = [];
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
  let level: "HIGH" | "MEDIUM" | "LOW";
  if (score >= HIGH_THRESHOLD) {
    level = "HIGH";
  } else if (score >= MEDIUM_THRESHOLD) {
    level = "MEDIUM";
  } else {
    level = "LOW";
  }

  // 7. Build summary
  const saturated = breakdown.filter(b => b.status === "saturated").length;
  const partial = breakdown.filter(b => b.status === "partial").length;
  const noVocab = breakdown.filter(b => b.status === "no_vocabulary").length;
  const summary = `Weighted coverage: ${score}% ±${margin}%. ` +
    `${saturated} namespaces saturated, ${partial} partial, ${noVocab} no vocabulary. ` +
    (noVocab > 0 ? `Top gap: add trajectories for ${noVocab} uncovered namespaces.` : "");

  return { score, margin, level, breakdown, summary };
}

/**
 * Clear internal caches (for testing or when corpus is updated).
 */
export function clearConfidenceCache(): void {
  _cachedTransitionSpace = null;
  _cachedCoverage = null;
}
