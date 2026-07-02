/**
 * P1: Cross-Repository Precision Runner
 *
 * Runs the full SSG precision pipeline (discover → validate → measure)
 * on every benchmark repo that has labeled sequences.
 *
 * Produces:
 *   benchmarks/reports/cross-repo-precision-<date>.json
 *   benchmarks/reports/cross-repo-precision-latest.json
 *
 * Usage:
 *   npx ts-node --transpile-only src/cross-repo-precision.ts
 *   npx ts-node --transpile-only src/cross-repo-precision.ts --repos curl,libssh
 */

import * as fs from "fs";
import * as path from "path";

// Dynamic imports to avoid ts-node strict compilation issues
// eslint-disable-next-line @typescript-eslint/no-var-requires

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface RepoPrecisionResult {
  repo: string;
  status: "measured" | "no_labels" | "error";
  error?: string;
  total: number;
  cleanLabels: number;
  violationLabels: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
  rulesDiscovered: number;
  mismatches: Array<{ index: number; expected: string; got: string; calls: string[] }>;
}

interface CrossRepoReport {
  generated: string;
  version: string;
  repos: RepoPrecisionResult[];
  overall: {
    reposMeasured: number;
    totalSamples: number;
    totalTP: number;
    totalFP: number;
    totalFN: number;
    macroF1: number;
    microPrecision: number;
    microRecall: number;
    microF1: number;
    bestRepo: string;
    worstRepo: string;
    assessment: string;
    avgFPRate: number;
    avgFNRate: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// Per-Repo Precision Runner
// ═══════════════════════════════════════════════════════════════

function runPrecisionForRepo(repoName: string): RepoPrecisionResult {
  const benchmarksDir = path.resolve(process.cwd(), "benchmarks");
  const labelFile = path.join(benchmarksDir, `${repoName}-labels.json`);

  const empty: RepoPrecisionResult = {
    repo: repoName,
    status: "no_labels",
    total: 0,
    cleanLabels: 0,
    violationLabels: 0,
    tp: 0, fp: 0, tn: 0, fn: 0,
    precision: 0, recall: 0, f1: 0,
    falsePositiveRate: 0, falseNegativeRate: 0,
    rulesDiscovered: 0,
    mismatches: [],
  };

  if (!fs.existsSync(labelFile)) {
    empty.error = `No labels file: ${labelFile}`;
    return empty;
  }

  let data: any;
  try {
    data = JSON.parse(fs.readFileSync(labelFile, "utf-8"));
  } catch (e) {
    empty.status = "error";
    empty.error = `Parse error: ${e}`;
    return empty;
  }

  const labels: Record<string, string> = data.labels || {};
  const sequences: Record<string, string[]> = data.sequences || {};
  const labeledIndices = Object.keys(labels).map(Number);

  if (labeledIndices.length === 0) {
    empty.error = "No labeled sequences";
    return empty;
  }

  // Count label distribution
  let cleanLabels = 0;
  let violationLabels = 0;
  const cleanSeqs: string[][] = [];

  for (const idx of labeledIndices) {
    if (labels[idx] === "clean") {
      cleanLabels++;
      if (sequences[idx]) cleanSeqs.push(sequences[idx]);
    } else if (labels[idx] === "violation") {
      violationLabels++;
    }
  }

  // Discover SSG rules from clean sequences
  let rules: Map<string, any>;
  let nsInit: Map<string, string>;

  try {
    const { discoverRulesFromSequences, validateSequenceWithSSG } = require("./ssg-precision");
    const result = discoverRulesFromSequences(cleanSeqs);
    rules = result.rules;
    nsInit = result.nsInit;
  } catch (e) {
    empty.status = "error";
    empty.error = `Rule discovery failed: ${e}`;
    return empty;
  }

  // Validate all labeled sequences
  let tp = 0, fp = 0, tn = 0, fn = 0;
  const mismatches: RepoPrecisionResult["mismatches"] = [];

  for (const idx of labeledIndices) {
    const expected = labels[idx];
    const calls = sequences[idx] || [];

    let detected: string;
    try {
      const { validateSequenceWithSSG } = require("./ssg-precision");
      const result = validateSequenceWithSSG(calls, rules, nsInit);
      detected = result.valid ? "clean" : "violation";
    } catch {
      detected = "clean"; // Can't validate → assume clean (conservative)
    }

    if (expected === "violation" && detected === "violation") tp++;
    else if (expected === "clean" && detected === "violation") fp++;
    else if (expected === "clean" && detected === "clean") tn++;
    else if (expected === "violation" && detected === "clean") fn++;

    if (expected !== detected) {
      mismatches.push({ index: idx, expected, got: detected, calls });
    }
  }

  const total = labeledIndices.length;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0
    ? 2 * precision * recall / (precision + recall)
    : 0;
  const fpr = fp + tn > 0 ? fp / (fp + tn) : 0;
  const fnr = fn + tp > 0 ? fn / (fn + tp) : 0;

  return {
    repo: repoName,
    status: "measured",
    total,
    cleanLabels,
    violationLabels,
    tp, fp, tn, fn,
    precision, recall, f1,
    falsePositiveRate: fpr,
    falseNegativeRate: fnr,
    rulesDiscovered: rules.size,
    mismatches,
  };
}

// ═══════════════════════════════════════════════════════════════
// Report Generator
// ═══════════════════════════════════════════════════════════════

function generateReport(repoNames: string[]): CrossRepoReport {
  const repos = repoNames.map(runPrecisionForRepo);
  const measured = repos.filter(r => r.status === "measured");

  let totalTP = 0, totalFP = 0, totalFN = 0, totalSamples = 0;
  for (const r of measured) {
    totalTP += r.tp;
    totalFP += r.fp;
    totalFN += r.fn;
    totalSamples += r.total;
  }

  const macroF1 = measured.length > 0
    ? measured.reduce((s, r) => s + r.f1, 0) / measured.length
    : 0;
  const microPrecision = totalTP + totalFP > 0
    ? totalTP / (totalTP + totalFP)
    : 0;
  const microRecall = totalTP + totalFN > 0
    ? totalTP / (totalTP + totalFN)
    : 0;
  const microF1 = microPrecision + microRecall > 0
    ? 2 * microPrecision * microRecall / (microPrecision + microRecall)
    : 0;

  const sortedByF1 = [...measured].sort((a, b) => b.f1 - a.f1);
  const bestRepo = sortedByF1.length > 0 ? sortedByF1[0].repo : "N/A";
  const worstRepo = sortedByF1.length > 1
    ? sortedByF1[sortedByF1.length - 1].repo
    : "N/A";

  const avgFPR = measured.length > 0
    ? measured.reduce((s, r) => s + r.falsePositiveRate, 0) / measured.length
    : 0;
  const avgFNR = measured.length > 0
    ? measured.reduce((s, r) => s + r.falseNegativeRate, 0) / measured.length
    : 0;

  let assessment = "INSUFFICIENT DATA";
  if (measured.length >= 3) {
    if (microF1 >= 0.80) assessment = "PRODUCTION READY";
    else if (microF1 >= 0.65) assessment = "BETA QUALITY";
    else if (microF1 >= 0.50) assessment = "ALPHA — NEEDS MORE DATA";
    else assessment = "EARLY STAGE";
  } else if (measured.length >= 1) {
    assessment = "PILOT — EXPAND LABELING";
  }

  return {
    generated: new Date().toISOString(),
    version: "3.2.0",
    repos,
    overall: {
      reposMeasured: measured.length,
      totalSamples,
      totalTP,
      totalFP,
      totalFN,
      macroF1,
      microPrecision,
      microRecall,
      microF1,
      bestRepo,
      worstRepo,
      assessment,
      avgFPRate: avgFPR,
      avgFNRate: avgFNR,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// Formatting
// ═══════════════════════════════════════════════════════════════

function formatReport(report: CrossRepoReport): string {
  const lines: string[] = [];
  const C = { bold: "", dim: "", green: "", red: "", yellow: "", cyan: "", reset: "" };

  lines.push("");
  lines.push("╔══════════════════════════════════════════════════════════════╗");
  lines.push("║     Progmune Cross-Repository Precision Benchmark            ║");
  lines.push("╠══════════════════════════════════════════════════════════════╣");
  lines.push(`║  Generated: ${report.generated}  ║`);
  lines.push(`║  Version:   v${report.version}                                              ║`);
  lines.push("╚══════════════════════════════════════════════════════════════╝");
  lines.push("");

  // Per-repo table
  const header = "┌─────────────────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┐";
  const sep    = "├─────────────────┼───────┼───────┼───────┼───────┼───────┼───────┼───────┤";
  const footer = "└─────────────────┴───────┴───────┴───────┴───────┴───────┴───────┴───────┘";

  lines.push(header);
  lines.push("│ Repo            │    P  │    R  │   F1  │   FP% │   FN% │   N   │ Rules │");
  lines.push(sep);

  for (const repo of report.repos) {
    if (repo.status !== "measured") {
      const status = repo.status === "no_labels" ? "no labels" : "error";
      lines.push(`│ ${repo.repo.padEnd(15)} │   ${"-".padStart(3)}  │   ${"-".padStart(3)}  │   ${"-".padStart(3)}  │   ${"-".padStart(3)}  │   ${"-".padStart(3)}  │ ${String(repo.total || 0).padStart(4)}  │   ${"-".padStart(3)}  │`);
      continue;
    }
    const p = (repo.precision * 100).toFixed(0);
    const r = (repo.recall * 100).toFixed(0);
    const f = (repo.f1 * 100).toFixed(0);
    const fpr = (repo.falsePositiveRate * 100).toFixed(0);
    const fnr = (repo.falseNegativeRate * 100).toFixed(0);

    // Color-code F1
    let fDisplay = `${f}%`;
    if (repo.f1 >= 0.7) fDisplay = `${f}% ★`;
    else if (repo.f1 >= 0.5) fDisplay = `${f}%`;

    lines.push(`│ ${repo.repo.padEnd(15)} │ ${p.padStart(3)}% │ ${r.padStart(3)}% │ ${fDisplay.padStart(5)} │ ${fpr.padStart(3)}% │ ${fnr.padStart(3)}% │ ${String(repo.total).padStart(4)}  │ ${String(repo.rulesDiscovered).padStart(4)}  │`);
  }

  lines.push(sep);
  const o = report.overall;
  const op = (o.microPrecision * 100).toFixed(0);
  const or_ = (o.microRecall * 100).toFixed(0);
  const of1 = (o.microF1 * 100).toFixed(0);
  const maF1 = (o.macroF1 * 100).toFixed(0);
  lines.push(`│ OVERALL (micro)  │ ${op.padStart(3)}% │ ${or_.padStart(3)}% │ ${of1.padStart(3)}% │ ${(o.avgFPRate*100).toFixed(0).padStart(3)}% │ ${(o.avgFNRate*100).toFixed(0).padStart(3)}% │ ${String(o.totalSamples).padStart(4)}  │       │`);
  lines.push(`│ OVERALL (macro)  │       │       │ ${maF1.padStart(3)}% │       │       │       │       │`);
  lines.push(footer);
  lines.push("");

  // Summary
  lines.push(`Repos measured: ${o.reposMeasured}/${report.repos.length}`);
  lines.push(`Best repo:      ${o.bestRepo}`);
  lines.push(`Worst repo:     ${o.worstRepo}`);
  lines.push(`Avg FP Rate:    ${(o.avgFPRate * 100).toFixed(1)}%`);
  lines.push(`Avg FN Rate:    ${(o.avgFNRate * 100).toFixed(1)}%`);
  lines.push(`Assessment:     ${o.assessment}`);
  lines.push("");

  // Mismatches detail
  const reposWithMismatches = report.repos.filter(r => r.mismatches.length > 0);
  if (reposWithMismatches.length > 0) {
    lines.push("── Mismatch Details ──");
    for (const repo of reposWithMismatches) {
      lines.push(`  ${repo.repo}: ${repo.mismatches.length} mismatches`);
      for (const m of repo.mismatches.slice(0, 5)) {
        const tag = m.expected === "clean" ? "FP" : "FN";
        lines.push(`    [${tag}] #${m.index}: expected ${m.expected}, got ${m.got}`);
        lines.push(`           ${m.calls.join(" → ")}`);
      }
      if (repo.mismatches.length > 5) {
        lines.push(`    ... and ${repo.mismatches.length - 5} more`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// Save
// ═══════════════════════════════════════════════════════════════

function saveReport(report: CrossRepoReport): void {
  const reportsDir = path.resolve(process.cwd(), "benchmarks", "reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const filePath = path.join(reportsDir, `cross-repo-precision-${date}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));

  const latestPath = path.join(reportsDir, "cross-repo-precision-latest.json");
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));

  console.log(`Reports saved:`);
  console.log(`  ${filePath}`);
  console.log(`  ${latestPath}`);
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

function main() {
  const args = process.argv.slice(2);
  const repoArg = args.find(a => a.startsWith("--repos="));
  const repoNames = repoArg
    ? repoArg.replace("--repos=", "").split(",")
    : [
        "curl",
        "libssh",
        "nginx",
        "redis",
        // Future: add "nghttp2", "apache", "openssl" when labels are available
      ];

  console.log(`Running precision measurement on ${repoNames.length} repos...`);

  const report = generateReport(repoNames);
  console.log(formatReport(report));
  saveReport(report);
}

main();
