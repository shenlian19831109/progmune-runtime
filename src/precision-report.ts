/**
 * Precision Report Generator
 *
 * Takes hand-labeled ground truth + SSG validation results,
 * generates TP/FP/TN/FN matrix with precision/recall/F1.
 *
 * Usage:
 *   npx ts-node src/precision-report.ts <repoPath>
 *   npx ts-node src/precision-report.ts . --output precision.md
 */

import * as fs from "fs";
import * as path from "path";
import { extractIR } from "./extract-ir";
import { discoverRulesFromSequences, validateSequenceWithSSG } from "./ssg-precision";

interface PrecisionMatrix {
  repo: string;
  total: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  precision: number;
  recall: number;
  f1: number;
  details: Array<{
    index: number;
    calls: string[];
    expected: string;
    detected: string;
    correct: boolean;
  }>;
}

function loadLabels(repoPath: string): { labels: Record<number, string>; sequences: Record<number, string[]> } {
  const labelPath = path.join(repoPath, ".progmune_labels.json");
  if (!fs.existsSync(labelPath)) {
    throw new Error(`No labels found. Run 'npx ts-node src/precision-label.ts ${repoPath}' first.`);
  }
  const data = JSON.parse(fs.readFileSync(labelPath, "utf-8"));
  return { labels: data.labels || {}, sequences: data.sequences || {} };
}

export function runPrecision(repoPath: string): PrecisionMatrix {
  const { labels, sequences } = loadLabels(repoPath);

  // Get all labeled sequences
  const labeledIndices = Object.keys(labels).map(Number);
  if (labeledIndices.length === 0) {
    throw new Error("No labeled sequences found.");
  }

  // Build clean-labeled sequences for rule discovery
  const cleanSeqs: string[][] = [];
  for (const idx of labeledIndices) {
    if (labels[idx] === "clean" && sequences[idx]) {
      cleanSeqs.push(sequences[idx]);
    }
  }

  // Discover rules from clean sequences
  const { rules, nsInit } = discoverRulesFromSequences(cleanSeqs);

  // Validate all labeled sequences against discovered rules
  const matrix: PrecisionMatrix = {
    repo: path.basename(repoPath),
    total: labeledIndices.length,
    truePositive: 0,
    falsePositive: 0,
    trueNegative: 0,
    falseNegative: 0,
    precision: 0,
    recall: 0,
    f1: 0,
    details: [],
  };

  for (const idx of labeledIndices) {
    const expected = labels[idx];
    const calls = sequences[idx] || [];

    if (rules.size === 0) {
      // No rules discovered — all sequences pass (can't detect anything)
      const detected = "clean";
      matrix.details.push({ index: idx, calls, expected, detected, correct: expected === detected });
      if (expected === "clean" && detected === "clean") matrix.trueNegative++;
      else if (expected === "violation" && detected === "clean") matrix.falseNegative++;
      continue;
    }

    const result = validateSequenceWithSSG(calls, rules, nsInit);
    const detected = result.valid ? "clean" : "violation";

    matrix.details.push({ index: idx, calls, expected, detected, correct: expected === detected });

    if (expected === "violation" && detected === "violation") matrix.truePositive++;
    else if (expected === "clean" && detected === "violation") matrix.falsePositive++;
    else if (expected === "clean" && detected === "clean") matrix.trueNegative++;
    else if (expected === "violation" && detected === "clean") matrix.falseNegative++;
  }

  // Compute metrics
  const tp = matrix.truePositive;
  const fp = matrix.falsePositive;
  const fn = matrix.falseNegative;
  matrix.precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  matrix.recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  matrix.f1 = matrix.precision + matrix.recall > 0
    ? 2 * (matrix.precision * matrix.recall) / (matrix.precision + matrix.recall)
    : 0;

  return matrix;
}

// ═══════════════════════════════════════════════════════════════
// Formatters
// ═══════════════════════════════════════════════════════════════

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};

export function formatPrecisionTerminal(m: PrecisionMatrix): string {
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  const color = (v: number, threshold = 0.7) => v >= threshold ? C.green : v >= 0.5 ? C.yellow : C.red;

  const lines: string[] = [];
  lines.push("");
  lines.push(`${C.bold}${C.cyan}╔══════════════════════════════════════════════╗${C.reset}`);
  lines.push(`${C.bold}${C.cyan}║${C.reset}  ${C.bold}SSG Precision Report — ${m.repo}${C.reset}${" ".repeat(Math.max(0, 25 - m.repo.length))}${C.bold}${C.cyan}║${C.reset}`);
  lines.push(`${C.bold}${C.cyan}╚══════════════════════════════════════════════╝${C.reset}`);
  lines.push("");
  lines.push(`  Samples:   ${m.total}`);
  lines.push(`  TP: ${C.green}${m.truePositive}${C.reset}  FP: ${C.red}${m.falsePositive}${C.reset}  TN: ${C.green}${m.trueNegative}${C.reset}  FN: ${C.red}${m.falseNegative}${C.reset}`);
  lines.push("");
  lines.push(`  Precision: ${color(m.precision)}${pct(m.precision)}${C.reset}`);
  lines.push(`  Recall:    ${color(m.recall)}${pct(m.recall)}${C.reset}`);
  lines.push(`  F1:        ${color(m.f1)}${pct(m.f1)}${C.reset}`);
  lines.push("");

  // Mismatches
  const mismatches = m.details.filter(d => !d.correct);
  if (mismatches.length > 0) {
    lines.push(`  ${C.yellow}Mismatches (${mismatches.length}):${C.reset}`);
    for (const d of mismatches.slice(0, 10)) {
      const icon = d.expected === "violation" ? `${C.red}FN${C.reset}` : `${C.yellow}FP${C.reset}`;
      lines.push(`    ${icon} [${d.index}] expected ${d.expected}, got ${d.detected}`);
      lines.push(`       ${C.dim}${d.calls.join(" → ")}${C.reset}`);
    }
    lines.push("");
  }

  // Rating
  const rating = m.f1 >= 0.85 ? `${C.green}EXCELLENT${C.reset}`
    : m.f1 >= 0.7 ? `${C.yellow}GOOD${C.reset}`
    : m.f1 >= 0.5 ? `${C.yellow}FAIR${C.reset}`
    : `${C.red}NEEDS IMPROVEMENT${C.reset}`;
  lines.push(`  Rating: ${rating}`);
  lines.push("");

  return lines.join("\n");
}

export function formatPrecisionMarkdown(m: PrecisionMatrix): string {
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  const lines: string[] = [];

  lines.push(`# SSG Precision Report — ${m.repo}`);
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Samples | ${m.total} |`);
  lines.push(`| True Positive | ${m.truePositive} |`);
  lines.push(`| False Positive | ${m.falsePositive} |`);
  lines.push(`| True Negative | ${m.trueNegative} |`);
  lines.push(`| False Negative | ${m.falseNegative} |`);
  lines.push(`| **Precision** | **${pct(m.precision)}** |`);
  lines.push(`| **Recall** | **${pct(m.recall)}** |`);
  lines.push(`| **F1** | **${pct(m.f1)}** |`);
  lines.push("");

  const mismatches = m.details.filter(d => !d.correct);
  if (mismatches.length > 0) {
    lines.push("## Mismatches");
    lines.push("");
    lines.push(`| # | Expected | Detected | Sequence |`);
    lines.push(`|---|----------|----------|----------|`);
    for (const d of mismatches) {
      lines.push(`| ${d.index} | ${d.expected} | ${d.detected} | \`${d.calls.join(" → ")}\` |`);
    }
    lines.push("");
  }

  const rating = m.f1 >= 0.85 ? "🟢 EXCELLENT"
    : m.f1 >= 0.7 ? "🟡 GOOD"
    : m.f1 >= 0.5 ? "🟠 FAIR"
    : "🔴 NEEDS IMPROVEMENT";
  lines.push(`**Rating:** ${rating}`);
  lines.push("");

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// Multi-Repo Aggregation
// ═══════════════════════════════════════════════════════════════

export function formatMultiRepoTable(matrices: PrecisionMatrix[]): string {
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  const lines: string[] = [];

  lines.push("");
  lines.push(`${C.bold}${C.cyan}Multi-Repo Precision Summary${C.reset}`);
  lines.push("");
  lines.push(`  ${C.dim}Repo          Samples  TP   FP   TN   FN   Precision  Recall  F1     Rating${C.reset}`);
  lines.push(`  ${C.dim}────────────  ───────  ───  ───  ───  ───  ─────────  ──────  ─────  ──────${C.reset}`);

  for (const m of matrices) {
    const rating = m.f1 >= 0.85 ? `${C.green}★★★★${C.reset}`
      : m.f1 >= 0.7 ? `${C.yellow}★★★${C.reset}`
      : m.f1 >= 0.5 ? `${C.yellow}★★${C.reset}`
      : `${C.red}★${C.reset}`;
    lines.push(`  ${m.repo.padEnd(12)}  ${String(m.total).padEnd(7)}  ${String(m.truePositive).padEnd(3)}  ${String(m.falsePositive).padEnd(3)}  ${String(m.trueNegative).padEnd(3)}  ${String(m.falseNegative).padEnd(3)}  ${pct(m.precision).padEnd(9)}  ${pct(m.recall).padEnd(6)}  ${pct(m.f1).padEnd(5)}  ${rating}`);
  }

  lines.push("");
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

if (require.main === module) {
  const args = process.argv.slice(2);
  const repoPath = path.resolve(args.find(a => !a.startsWith("--")) || ".");
  const outputIdx = args.indexOf("--output");
  const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : undefined;

  try {
    const matrix = runPrecision(repoPath);
    console.log(formatPrecisionTerminal(matrix));

    if (outputPath) {
      const md = formatPrecisionMarkdown(matrix);
      fs.writeFileSync(outputPath, md, "utf-8");
      console.error(`📁 Report: ${outputPath}`);
    }
  } catch (e: any) {
    console.error(`\n${C.red}❌ ${e.message}${C.reset}\n`);
    process.exit(1);
  }
}
