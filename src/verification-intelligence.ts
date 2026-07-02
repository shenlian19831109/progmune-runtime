/**
 * P5: Verification Intelligence — the 5th paradigm shift.
 *
 * Moves Progmune from a Pattern Matcher to a Verification Decision Engine.
 *
 * The core question changes from:
 *   "Does this code violate protocol X?"
 * to:
 *   "Should I alert on this? Why? Why not? What did I learn?"
 *
 * Architecture:
 *
 *   Verification → Decision (alert? suppress?) → FP detected →
 *     Classify FP reason → Profile context → Adjust rule confidence →
 *       → Next time: better decision
 *
 * This closes the loop that turns every false positive into
 * Verification Intelligence.
 *
 * FP Taxonomy (why did we wrongly alert?):
 *   FP-1: RULE_TOO_BROAD     — Rule matches too many patterns (overfitting to clean seqs)
 *   FP-2: CONTEXT_MISMATCH   — Rule is valid but wrong context (e.g., internal/init code)
 *   FP-3: NAMESPACE_LEAK     — Rule from one namespace applied to another
 *   FP-4: ORDER_INSENSITIVE  — Rule requires strict ordering but code is order-flexible
 *   FP-5: INCOMPLETE_RULE    — Rule is too specific (missing valid alternative paths)
 *   FP-6: DOMAIN_IRRELEVANT  — Rule is technically correct but irrelevant to this domain
 *   FP-7: LEGACY_COMPAT      — Code follows legacy pattern that protocol doesn't cover
 */

import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

/** FP classification — WHY did we wrongly alert? */
export type FPReason =
  | "RULE_TOO_BROAD"
  | "CONTEXT_MISMATCH"
  | "NAMESPACE_LEAK"
  | "ORDER_INSENSITIVE"
  | "INCOMPLETE_RULE"
  | "DOMAIN_IRRELEVANT"
  | "LEGACY_COMPAT";

export const FP_REASON_LABELS: Record<FPReason, { label: string; fix: string }> = {
  RULE_TOO_BROAD: {
    label: "Rule too broad",
    fix: "Narrow the rule by adding more specific pre/post states",
  },
  CONTEXT_MISMATCH: {
    label: "Context mismatch",
    fix: "Add context filter — not all call sites require the same protocol",
  },
  NAMESPACE_LEAK: {
    label: "Namespace leak",
    fix: "Restrict rule to its namespace; don't cross-apply",
  },
  ORDER_INSENSITIVE: {
    label: "Order insensitive",
    fix: "Relax ordering constraint — this protocol allows flexible ordering",
  },
  INCOMPLETE_RULE: {
    label: "Incomplete rule",
    fix: "Add missing alternative paths to the rule definition",
  },
  DOMAIN_IRRELEVANT: {
    label: "Domain irrelevant",
    fix: "Exclude this domain/codebase from this rule",
  },
  LEGACY_COMPAT: {
    label: "Legacy compatibility",
    fix: "Add legacy pattern as an accepted alternative",
  },
};

/** A single FP learning record. */
export interface FPLearningRecord {
  id: string;
  timestamp: string;
  repo: string;
  protocol: string;
  /** The function sequence that triggered the FP. */
  sequence: string[];
  /** The rule(s) that caused the alert. */
  triggeredRules: string[];
  /** Why this was a false positive. */
  reason: FPReason;
  /** What context features were present. */
  context: {
    filePath?: string;
    isTestCode?: boolean;
    isInitCode?: boolean;
    isInternal?: boolean;
    nestingDepth?: number;
    functionCount?: number;
  };
  /** What action was taken. */
  action: "rule_adjusted" | "context_filter_added" | "namespace_restricted" | "exception_added" | "deferred";
  /** Human or auto label. */
  labeledBy: "human" | "auto";
  /** Confidence adjustment applied. */
  confidenceDelta: number;
}

/**
 * Per-rule confidence tracker.
 *
 * Each rule starts at confidence 1.0 (fully trusted).
 * Every FP reduces confidence. Every TP confirms it.
 */
export interface RuleConfidence {
  ruleName: string;
  protocol: string;
  initialConfidence: number;
  currentConfidence: number;
  totalAlerts: number;
  truePositives: number;
  falsePositives: number;
  /** When confidence drops below this, suppress alerts. */
  suppressionThreshold: number;
  suppressed: boolean;
  fpHistory: string[]; // FP record IDs
  lastAdjusted: string;
}

/**
 * Verification Decision — the output of the decision engine.
 */
export interface VerificationDecision {
  /** Should we alert? */
  alert: boolean;
  /** If alerting, at what confidence level? */
  confidence: number;
  /** Why this decision was made. */
  reason: string;
  /** Which rules triggered. */
  triggeredRules: string[];
  /** Which rules were suppressed (would have triggered but confidence too low). */
  suppressedRules: string[];
  /** Recommendation for the developer. */
  recommendation: "BLOCK" | "WARN" | "INFO" | "SUPPRESS";
}

// ═══════════════════════════════════════════════════════════════
// Verification Decision Engine
// ═══════════════════════════════════════════════════════════════

const VI_DIR = ".progmune_corpus/verification-intelligence";

export class VerificationIntelligence {
  private ruleConfidences: Map<string, RuleConfidence> = new Map();
  private fpRecords: FPLearningRecord[] = [];
  private contextFilters: Map<string, Set<string>> = new Map(); // rule → excluded contexts

  constructor() {
    this.load();
  }

  /**
   * Make a verification decision: should we alert on this rule match?
   *
   * This REPLACES the binary valid/invalid with a calibrated decision.
   */
  decide(
    ruleName: string,
    protocol: string,
    context?: Partial<FPLearningRecord["context"]>
  ): VerificationDecision {
    const key = `${protocol}:${ruleName}`;
    let rc = this.ruleConfidences.get(key);

    if (!rc) {
      // New rule — start with high confidence
      rc = {
        ruleName,
        protocol,
        initialConfidence: 0.9,
        currentConfidence: 0.9,
        totalAlerts: 0,
        truePositives: 0,
        falsePositives: 0,
        suppressionThreshold: 0.3,
        suppressed: false,
        fpHistory: [],
        lastAdjusted: new Date().toISOString(),
      };
      this.ruleConfidences.set(key, rc);
    }

    // Check context filters
    if (this.isContextFiltered(ruleName, context)) {
      return {
        alert: false,
        confidence: 0,
        reason: `Rule ${ruleName} suppressed by context filter`,
        triggeredRules: [],
        suppressedRules: [ruleName],
        recommendation: "SUPPRESS",
      };
    }

    // Check if rule is suppressed (confidence too low)
    if (rc.suppressed || rc.currentConfidence < rc.suppressionThreshold) {
      return {
        alert: false,
        confidence: rc.currentConfidence,
        reason: `Rule ${ruleName} suppressed (confidence ${(rc.currentConfidence * 100).toFixed(0)}% < threshold ${(rc.suppressionThreshold * 100).toFixed(0)}%)`,
        triggeredRules: [],
        suppressedRules: [ruleName],
        recommendation: "SUPPRESS",
      };
    }

    // Determine recommendation level based on confidence
    let recommendation: VerificationDecision["recommendation"];
    if (rc.currentConfidence >= 0.8) recommendation = "BLOCK";
    else if (rc.currentConfidence >= 0.6) recommendation = "WARN";
    else if (rc.currentConfidence >= 0.4) recommendation = "INFO";
    else recommendation = "SUPPRESS";

    return {
      alert: true,
      confidence: rc.currentConfidence,
      reason: `Rule ${ruleName} triggered with ${(rc.currentConfidence * 100).toFixed(0)}% confidence (${rc.truePositives} TP, ${rc.falsePositives} FP)`,
      triggeredRules: [ruleName],
      suppressedRules: [],
      recommendation,
    };
  }

  /**
   * Record a false positive and adjust rule confidence DOWN.
   *
   * This is the core learning mechanism: every FP reduces confidence,
   * eventually suppressing the rule if it's too noisy.
   */
  recordFP(params: {
    ruleName: string;
    protocol: string;
    repo: string;
    sequence: string[];
    reason: FPReason;
    context?: FPLearningRecord["context"];
    labeledBy?: "human" | "auto";
  }): FPLearningRecord {
    const key = `${params.protocol}:${params.ruleName}`;
    let rc = this.ruleConfidences.get(key);

    const record: FPLearningRecord = {
      id: `FP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      repo: params.repo,
      protocol: params.protocol,
      sequence: params.sequence,
      triggeredRules: [params.ruleName],
      reason: params.reason,
      context: params.context || {},
      action: this.determineAction(params.reason),
      labeledBy: params.labeledBy || "auto",
      confidenceDelta: 0,
    };

    // Create rule if it doesn't exist yet
    if (!rc) {
      rc = {
        ruleName: params.ruleName,
        protocol: params.protocol,
        initialConfidence: 0.9,
        currentConfidence: 0.9,
        totalAlerts: 0,
        truePositives: 0,
        falsePositives: 0,
        suppressionThreshold: 0.3,
        suppressed: false,
        fpHistory: [],
        lastAdjusted: new Date().toISOString(),
      };
      this.ruleConfidences.set(key, rc);
    }

    // Adjust confidence
    rc.falsePositives++;
    rc.totalAlerts++;

    // Confidence decay: each FP reduces confidence by a factor
    // New confidence = TP / (TP + FP) with Laplace smoothing
    const effectiveTP = rc.truePositives + 1; // Laplace prior
    const effectiveFP = rc.falsePositives + 1;
    const oldConf = rc.currentConfidence;
    rc.currentConfidence = effectiveTP / (effectiveTP + effectiveFP);

    record.confidenceDelta = rc.currentConfidence - oldConf;

    // Suppress if too noisy
    if (rc.currentConfidence < rc.suppressionThreshold && rc.falsePositives >= 5) {
      rc.suppressed = true;
    }

    rc.fpHistory.push(record.id);
    rc.lastAdjusted = record.timestamp;
    this.ruleConfidences.set(key, rc);

    this.fpRecords.push(record);
    this.save();

    return record;
  }

  /**
   * Record a true positive — confirms the rule is working.
   */
  recordTP(ruleName: string, protocol: string): void {
    const key = `${protocol}:${ruleName}`;
    let rc = this.ruleConfidences.get(key);

    if (!rc) {
      rc = {
        ruleName, protocol,
        initialConfidence: 0.9, currentConfidence: 0.9,
        totalAlerts: 0, truePositives: 0, falsePositives: 0,
        suppressionThreshold: 0.3, suppressed: false,
        fpHistory: [], lastAdjusted: new Date().toISOString(),
      };
    }

    rc.truePositives++;
    rc.totalAlerts++;

    // Confidence boost from TP
    const effectiveTP = rc.truePositives;
    const effectiveFP = rc.falsePositives + 1; // Laplace
    rc.currentConfidence = effectiveTP / (effectiveTP + effectiveFP);

    // Un-suppress if confidence recovers
    if (rc.suppressed && rc.currentConfidence >= rc.suppressionThreshold + 0.1) {
      rc.suppressed = false;
    }

    rc.lastAdjusted = new Date().toISOString();
    this.ruleConfidences.set(key, rc);
    this.save();
  }

  /**
   * Auto-classify a false positive based on sequence and rule characteristics.
   */
  autoClassifyFP(params: {
    ruleName: string;
    sequence: string[];
    context?: FPLearningRecord["context"];
  }): FPReason {
    const { ruleName, sequence, context } = params;

    // Heuristic 1: Context mismatch (test/init code) — most common FP source
    if (context?.isTestCode || context?.isInitCode) {
      return "CONTEXT_MISMATCH";
    }

    // Heuristic 2: Legacy/deprecated patterns — check BEFORE short-sequence heuristic
    if (sequence.some(fn => /legacy|deprecated|old_|_v1|_compat/i.test(fn))) {
      return "LEGACY_COMPAT";
    }

    // Heuristic 3: Internal/private functions (start with _ or contain "internal")
    if (sequence.some(fn => fn.startsWith("_") || fn.includes("internal"))) {
      return "DOMAIN_IRRELEVANT";
    }

    // Heuristic 4: Very long sequences (10+) → RULE_TOO_BROAD
    if (sequence.length >= 10) {
      return "RULE_TOO_BROAD";
    }

    // Heuristic 5: Short sequence with no resource management → RULE_TOO_BROAD
    if (sequence.length <= 3 && !sequence.some(fn => /init|open|close|free|alloc|create|destroy/i.test(fn))) {
      return "RULE_TOO_BROAD";
    }

    return "RULE_TOO_BROAD"; // Default
  }

  /**
   * Get all rules that should currently be suppressed.
   */
  getSuppressedRules(): RuleConfidence[] {
    return [...this.ruleConfidences.values()]
      .filter(rc => rc.suppressed || rc.currentConfidence < rc.suppressionThreshold)
      .sort((a, b) => a.currentConfidence - b.currentConfidence);
  }

  /**
   * Get the FP learning report — what have we learned?
   */
  getFPLearningReport(): {
    totalFPs: number;
    byReason: Record<string, number>;
    byRule: Record<string, number>;
    suppressedRules: number;
    avgConfidence: number;
    topFPRules: Array<{ rule: string; fps: number; confidence: number }>;
  } {
    const byReason: Record<string, number> = {};
    const byRule: Record<string, number> = {};

    for (const fp of this.fpRecords) {
      byReason[fp.reason] = (byReason[fp.reason] || 0) + 1;
      const ruleKey = `${fp.protocol}:${fp.triggeredRules[0]}`;
      byRule[ruleKey] = (byRule[ruleKey] || 0) + 1;
    }

    const allConfidences = [...this.ruleConfidences.values()];
    const avgConfidence = allConfidences.length > 0
      ? allConfidences.reduce((s, rc) => s + rc.currentConfidence, 0) / allConfidences.length
      : 0;

    const topFPRules = Object.entries(byRule)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([rule, fps]) => {
        const rc = this.ruleConfidences.get(rule);
        return { rule, fps, confidence: rc?.currentConfidence || 0 };
      });

    return {
      totalFPs: this.fpRecords.length,
      byReason,
      byRule,
      suppressedRules: this.getSuppressedRules().length,
      avgConfidence,
      topFPRules,
    };
  }

  // ═════════════════════════════════════════════════════════════
  // Context Filters
  // ═════════════════════════════════════════════════════════════

  private isContextFiltered(
    ruleName: string,
    context?: Partial<FPLearningRecord["context"]>
  ): boolean {
    if (!context) return false;
    const filter = this.contextFilters.get(ruleName);
    if (!filter) return false;

    if (context.isTestCode && filter.has("test")) return true;
    if (context.isInitCode && filter.has("init")) return true;
    if (context.isInternal && filter.has("internal")) return true;

    return false;
  }

  addContextFilter(ruleName: string, filterType: "test" | "init" | "internal"): void {
    if (!this.contextFilters.has(ruleName)) {
      this.contextFilters.set(ruleName, new Set());
    }
    this.contextFilters.get(ruleName)!.add(filterType);
    this.save();
  }

  // ═════════════════════════════════════════════════════════════
  // Helpers
  // ═════════════════════════════════════════════════════════════

  private determineAction(reason: FPReason): FPLearningRecord["action"] {
    switch (reason) {
      case "CONTEXT_MISMATCH": return "context_filter_added";
      case "NAMESPACE_LEAK": return "namespace_restricted";
      case "RULE_TOO_BROAD":
      case "INCOMPLETE_RULE": return "rule_adjusted";
      case "DOMAIN_IRRELEVANT":
      case "LEGACY_COMPAT": return "exception_added";
      default: return "deferred";
    }
  }

  // ═════════════════════════════════════════════════════════════
  // Persistence
  // ═════════════════════════════════════════════════════════════

  private load(): void {
    const dir = path.resolve(process.cwd(), VI_DIR);
    if (!fs.existsSync(dir)) return;

    try {
      const confFile = path.join(dir, "rule-confidences.json");
      if (fs.existsSync(confFile)) {
        const data = JSON.parse(fs.readFileSync(confFile, "utf-8"));
        for (const [key, val] of Object.entries(data)) {
          this.ruleConfidences.set(key, val as RuleConfidence);
        }
      }

      const fpFile = path.join(dir, "fp-records.json");
      if (fs.existsSync(fpFile)) {
        this.fpRecords = JSON.parse(fs.readFileSync(fpFile, "utf-8"));
      }

      const filterFile = path.join(dir, "context-filters.json");
      if (fs.existsSync(filterFile)) {
        const data = JSON.parse(fs.readFileSync(filterFile, "utf-8"));
        for (const [key, val] of Object.entries(data)) {
          this.contextFilters.set(key, new Set(val as string[]));
        }
      }
    } catch { /* start fresh */ }
  }

  private save(): void {
    const dir = path.resolve(process.cwd(), VI_DIR);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const confObj: Record<string, RuleConfidence> = {};
    for (const [key, val] of this.ruleConfidences) {
      confObj[key] = val;
    }
    fs.writeFileSync(path.join(dir, "rule-confidences.json"), JSON.stringify(confObj, null, 2));

    // Only save last 1000 FP records to avoid file bloat
    const recent = this.fpRecords.slice(-1000);
    fs.writeFileSync(path.join(dir, "fp-records.json"), JSON.stringify(recent, null, 2));

    const filterObj: Record<string, string[]> = {};
    for (const [key, val] of this.contextFilters) {
      filterObj[key] = [...val];
    }
    fs.writeFileSync(path.join(dir, "context-filters.json"), JSON.stringify(filterObj, null, 2));
  }
}

// ═══════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════

let _vi: VerificationIntelligence | null = null;

export function getVerificationIntelligence(): VerificationIntelligence {
  if (!_vi) _vi = new VerificationIntelligence();
  return _vi;
}

// ═══════════════════════════════════════════════════════════════
// Report Formatter
// ═══════════════════════════════════════════════════════════════

export function formatVILearningReport(): string {
  const vi = getVerificationIntelligence();
  const report = vi.getFPLearningReport();
  const suppressed = vi.getSuppressedRules();

  const lines: string[] = [];
  lines.push("");
  lines.push("╔══════════════════════════════════════════════════════════════╗");
  lines.push("║     Verification Intelligence — Learning Report              ║");
  lines.push("╠══════════════════════════════════════════════════════════════╣");
  lines.push(`║  FP Records: ${String(report.totalFPs).padStart(5)}  |  Suppressed Rules: ${String(report.suppressedRules).padStart(3)}  |  Avg Confidence: ${(report.avgConfidence * 100).toFixed(0)}%           ║`);
  lines.push("╚══════════════════════════════════════════════════════════════╝");
  lines.push("");

  if (report.totalFPs === 0) {
    lines.push("  No false positives recorded yet.");
    lines.push("  The engine will learn as verification runs across repos.");
    lines.push("");
    return lines.join("\n");
  }

  // FP by reason
  lines.push("── FP by Reason ──");
  for (const [reason, count] of Object.entries(report.byReason).sort((a, b) => b[1] - a[1])) {
    const label = FP_REASON_LABELS[reason as FPReason]?.label || reason;
    const bar = "█".repeat(Math.min(30, count));
    lines.push(`  ${label.padEnd(25)} ${String(count).padStart(4)} ${bar}`);
  }
  lines.push("");

  // Top noisy rules
  if (report.topFPRules.length > 0) {
    lines.push("── Top Noisy Rules ──");
    for (const r of report.topFPRules.slice(0, 5)) {
      const conf = (r.confidence * 100).toFixed(0);
      const status = r.confidence < 0.3 ? "🔇 SUPPRESSED" : r.confidence < 0.6 ? "⚠️ LOW" : "✓ OK";
      lines.push(`  ${r.rule.padEnd(35)} ${String(r.fps).padStart(3)} FPs  conf=${conf}%  ${status}`);
    }
    lines.push("");
  }

  // Suppressed rules
  if (suppressed.length > 0) {
    lines.push("── Suppressed Rules ──");
    for (const rc of suppressed) {
      lines.push(`  🔇 ${rc.protocol}:${rc.ruleName} — ${rc.falsePositives} FPs, confidence ${(rc.currentConfidence * 100).toFixed(0)}%`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
