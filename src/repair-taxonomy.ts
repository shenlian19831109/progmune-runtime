/**
 * P4: Repair Failure Taxonomy — Production Failure Classification
 *
 * Every failed repair is classified into one of 7 root causes.
 * This taxonomy is the PRIMARY business metric for repair quality.
 *
 * It supersedes "repair success rate" as the key KPI because:
 *   - "57% success" tells you nothing about WHY it fails
 *   - "34% no_path, 31% not_applied" tells you EXACTLY what to fix
 *
 * Seven categories (ordered by severity):
 *   1. NO_PATH          — No fix path found by any strategy
 *   2. NOT_APPLIED      — Fix path exists but was never executed
 *   3. WRONG_STRATEGY   — Fix applied but direction was wrong (prepend vs append)
 *   4. VERIFY_FAILED    — Fix applied but re-verification still shows violations
 *   5. COMPILE_FAILED   — Fix compiles but produces wrong behavior
 *   6. SEMANTIC_CHANGED — Fix changed program semantics
 *   7. HUMAN_REJECTED   — Developer reviewed and rejected the fix
 *
 * Monthly Report tracks:
 *   - Distribution of failure reasons
 *   - Trend over time
 *   - Per-protocol breakdown
 *   - Actionable recommendations
 */

import { loadTrajectories } from "./failure-corpus";
import type { RepairOutcome, RepairFailureReason } from "./repair-executor";

// ═══════════════════════════════════════════════════════════════
// Taxonomy Types
// ═══════════════════════════════════════════════════════════════

export type FailureCategory =
  | "NO_PATH"
  | "NOT_APPLIED"
  | "WRONG_STRATEGY"
  | "VERIFY_FAILED"
  | "COMPILE_FAILED"
  | "SEMANTIC_CHANGED"
  | "HUMAN_REJECTED";

export interface FailureBucket {
  category: FailureCategory;
  label: string;
  description: string;
  count: number;
  percentage: number;
  trend: "↑" | "↓" | "→";
  examples: string[];
}

export interface RepairTaxonomyReport {
  generated: string;
  period: string;
  totalRepairs: number;
  successCount: number;
  successRate: number;
  failureCount: number;
  failureRate: number;
  buckets: FailureBucket[];
  byProtocol: Record<string, { total: number; success: number; failures: Record<string, number> }>;
  summary: string;
  recommendations: string[];
}

// ═══════════════════════════════════════════════════════════════
// Taxonomy Engine
// ═══════════════════════════════════════════════════════════════

const CATEGORY_LABELS: Record<FailureCategory, { label: string; description: string }> = {
  NO_PATH: {
    label: "No Fix Path",
    description: "No repair strategy produced any candidate. Protocol rules don't cover this scenario.",
  },
  NOT_APPLIED: {
    label: "Fix Not Applied",
    description: "A fix path was found but never executed. The repair pipeline stopped at suggestion.",
  },
  WRONG_STRATEGY: {
    label: "Wrong Strategy",
    description: "Fix was applied but the strategy was incorrect (e.g., prepended cleanup instead of appending).",
  },
  VERIFY_FAILED: {
    label: "Verification Failed",
    description: "Fix applied but re-verification still shows protocol violations.",
  },
  COMPILE_FAILED: {
    label: "Compile Failed",
    description: "Fix application produced code that fails to compile.",
  },
  SEMANTIC_CHANGED: {
    label: "Semantic Changed",
    description: "Fix passed verification but changed program behavior.",
  },
  HUMAN_REJECTED: {
    label: "Human Rejected",
    description: "Developer reviewed the fix and explicitly rejected it.",
  },
};

/**
 * Classify a failed repair trajectory into a taxonomy category.
 *
 * This is the core classification function. It analyzes trajectory data
 * to determine WHY a repair failed.
 */
export function classifyRepairFailure(trajectory: {
  violation?: { fixPath?: string[]; description?: string };
  successRate?: number;
  feedback?: { accepted?: boolean; rejected?: boolean };
  trajectory?: string[];
}): FailureCategory {
  const desc = (trajectory.violation?.description || "").toLowerCase();

  // Rule 1: No fix path at all
  if (!trajectory.violation?.fixPath || trajectory.violation.fixPath.length === 0) {
    return "NO_PATH";
  }

  // Rule 2: Fix was never applied (description indicates still-broken state)
  if (desc.includes("still leaking") || desc.includes("attempted fix but") ||
      desc.includes("fix didn't work") || desc.includes("attempted close but")) {
    return "NOT_APPLIED";
  }

  // Rule 3: Wrong strategy
  if (desc.includes("wrong order") || desc.includes("reversed") || desc.includes("wrong direction")) {
    return "WRONG_STRATEGY";
  }

  // Rule 4: Compile failure
  if (desc.includes("compile") || desc.includes("syntax") || desc.includes("type error")) {
    return "COMPILE_FAILED";
  }

  // Rule 5: Semantic change
  if (desc.includes("semantic") || desc.includes("behavior changed") || desc.includes("side effect")) {
    return "SEMANTIC_CHANGED";
  }

  // Rule 6: HUMAN_REJECTED — feedback says rejected AND reason is in description
  // This catches: developer reviewed, explicitly rejected with reason
  if (trajectory.feedback?.rejected) {
    return "HUMAN_REJECTED";
  }

  // Rule 7: Default — fix applied but verification still fails
  return "VERIFY_FAILED";
}

/**
 * Generate a full repair taxonomy report from trajectory data.
 */
export function generateRepairTaxonomyReport(period: string = "all-time"): RepairTaxonomyReport {
  const all = loadTrajectories().filter(t => t.result === "repair");
  const success = all.filter(t => (t.successRate || 0) >= 0.5);
  const fail = all.filter(t => (t.successRate || 0) < 0.5);

  // Classify all failures
  const categoryCounts: Record<string, { count: number; examples: string[] }> = {};
  for (const f of fail) {
    const cat = classifyRepairFailure(f as any);
    if (!categoryCounts[cat]) categoryCounts[cat] = { count: 0, examples: [] };
    categoryCounts[cat].count++;
    if (categoryCounts[cat].examples.length < 3) {
      categoryCounts[cat].examples.push(
        (f as any).violation?.description || (f as any).metadata?.intent || "unknown"
      );
    }
  }

  // Build buckets
  const buckets: FailureBucket[] = Object.entries(categoryCounts)
    .map(([cat, data]) => ({
      category: cat as FailureCategory,
      label: CATEGORY_LABELS[cat as FailureCategory]?.label || cat,
      description: CATEGORY_LABELS[cat as FailureCategory]?.description || "",
      count: data.count,
      percentage: fail.length > 0 ? data.count / fail.length : 0,
      trend: "→" as const, // Trend requires historical comparison
      examples: data.examples,
    }))
    .sort((a, b) => b.count - a.count);

  // By protocol
  const byProtocol: Record<string, { total: number; success: number; failures: Record<string, number> }> = {};
  for (const r of all) {
    const p = (r as any).protocol || "unknown";
    if (!byProtocol[p]) byProtocol[p] = { total: 0, success: 0, failures: {} };
    byProtocol[p].total++;
    if ((r.successRate || 0) >= 0.5) {
      byProtocol[p].success++;
    } else {
      const cat = classifyRepairFailure(r as any);
      byProtocol[p].failures[cat] = (byProtocol[p].failures[cat] || 0) + 1;
    }
  }

  // Recommendations
  const recommendations: string[] = [];
  const noPath = categoryCounts["NO_PATH"]?.count || 0;
  const notApplied = categoryCounts["NOT_APPLIED"]?.count || 0;
  const wrongStrategy = categoryCounts["WRONG_STRATEGY"]?.count || 0;
  const verifyFailed = categoryCounts["VERIFY_FAILED"]?.count || 0;

  if (noPath > 0.3 * fail.length) {
    recommendations.push(`CRITICAL: ${(noPath/fail.length*100).toFixed(0)}% of failures have no fix path — expand protocol rule coverage`);
  }
  if (notApplied > 0.2 * fail.length) {
    recommendations.push(`HIGH: ${(notApplied/fail.length*100).toFixed(0)}% of fixes never executed — ensure repair executor is integrated into all code paths`);
  }
  if (wrongStrategy > 0.1 * fail.length) {
    recommendations.push(`MEDIUM: ${(wrongStrategy/fail.length*100).toFixed(0)}% of fixes use wrong strategy — improve applyFix heuristics`);
  }
  if (verifyFailed > 0.3 * fail.length) {
    recommendations.push(`HIGH: ${(verifyFailed/fail.length*100).toFixed(0)}% of fixes fail verification — improve candidate ranking`);
  }
  if (recommendations.length === 0) {
    recommendations.push("Failure distribution is balanced — monitor trends monthly.");
  }

  return {
    generated: new Date().toISOString(),
    period,
    totalRepairs: all.length,
    successCount: success.length,
    successRate: all.length > 0 ? success.length / all.length : 0,
    failureCount: fail.length,
    failureRate: all.length > 0 ? fail.length / all.length : 0,
    buckets,
    byProtocol,
    summary: `${fail.length} failures classified into ${buckets.length} categories. Top: ${buckets[0]?.label || "N/A"} (${buckets[0]?.count || 0} cases).`,
    recommendations,
  };
}

// ═══════════════════════════════════════════════════════════════
// Formatter
// ═══════════════════════════════════════════════════════════════

export function formatRepairTaxonomy(report: RepairTaxonomyReport): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("╔══════════════════════════════════════════════════════════════╗");
  lines.push("║        Repair Failure Taxonomy Report                        ║");
  lines.push("╠══════════════════════════════════════════════════════════════╣");
  lines.push(`║  Period: ${report.period.padEnd(52)}║`);
  lines.push(`║  Generated: ${report.generated.padEnd(49)}║`);
  lines.push("╚══════════════════════════════════════════════════════════════╝");
  lines.push("");

  lines.push(`Total Repairs: ${report.totalRepairs}  |  Success: ${report.successCount} (${(report.successRate * 100).toFixed(1)}%)  |  Failed: ${report.failureCount} (${(report.failureRate * 100).toFixed(1)}%)`);
  lines.push("");

  // Failure distribution
  lines.push("── Failure Distribution ──");
  lines.push("┌──────────────────────────┬───────┬────────┬──────────────────────────────────────────────┐");
  lines.push("│ Category                 │ Count │   Pct  │ Description                                  │");
  lines.push("├──────────────────────────┼───────┼────────┼──────────────────────────────────────────────┤");

  for (const bucket of report.buckets) {
    const pct = (bucket.percentage * 100).toFixed(1);
    const bar = "█".repeat(Math.min(20, Math.round(bucket.percentage * 20)));
    lines.push(`│ ${bucket.label.padEnd(24)} │ ${String(bucket.count).padStart(4)}  │ ${(pct + "%").padStart(5)} │ ${bar.padEnd(20)} ${bucket.description.slice(0, 24).padEnd(24)} │`);
  }

  lines.push("└──────────────────────────┴───────┴────────┴──────────────────────────────────────────────┘");
  lines.push("");

  // By protocol
  lines.push("── By Protocol ──");
  for (const [proto, stats] of Object.entries(report.byProtocol)) {
    const rate = (stats.success / stats.total * 100).toFixed(1);
    const failureBreakdown = Object.entries(stats.failures)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => `${cat}:${count}`)
      .join(", ");
    lines.push(`  ${proto}: ${stats.total} repairs, ${rate}% success${failureBreakdown ? ` | Failures: ${failureBreakdown}` : ""}`);
  }
  lines.push("");

  // Recommendations
  lines.push("── Recommendations ──");
  for (const r of report.recommendations) {
    lines.push(`  • ${r}`);
  }
  lines.push("");

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

if (require.main === module) {
  const report = generateRepairTaxonomyReport();
  console.log(formatRepairTaxonomy(report));
}
