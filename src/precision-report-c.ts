/**
 * Precision Report Generator for C/C++ projects
 *
 * Reads labeled data and runs SSG precision measurement.
 *
 * Usage:
 *   npx ts-node src/precision-report-c.ts benchmarks/curl
 */

import * as fs from "fs";
import * as path from "path";
import { discoverRulesFromSequences, validateSequenceWithSSG } from "./ssg-precision";

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};

function main() {
  const args = process.argv.slice(2);
  const repoPath = path.resolve(args.find(a => !a.startsWith("--")) || ".");

  // Labels stored in benchmarks/ directory, not inside the repo
  const labelFile = path.join(path.dirname(repoPath), `${path.basename(repoPath)}-labels.json`);
  if (!fs.existsSync(labelFile)) {
    // Fallback: try inside the repo directory
    const altFile = path.join(repoPath, `${path.basename(repoPath)}-labels.json`);
    if (fs.existsSync(altFile)) return altFile;
  }
  if (!fs.existsSync(labelFile)) {
    console.error(`❌ Labels not found: ${labelFile}`);
    console.error(`   Run: npx ts-node src/precision-label-c.ts ${repoPath}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(labelFile, "utf-8"));
  const labels = data.labels || {};
  const sequences = data.sequences || {};
  const labeledIndices = Object.keys(labels).map(Number);

  if (labeledIndices.length === 0) {
    console.error("❌ No labeled sequences found.");
    process.exit(1);
  }

  // Build clean sequences for rule discovery
  const cleanSeqs: string[][] = [];
  for (const idx of labeledIndices) {
    if (labels[idx] === "clean" && sequences[idx]) {
      cleanSeqs.push(sequences[idx]);
    }
  }

  if (cleanSeqs.length === 0) {
    console.error("❌ No clean sequences for rule discovery. Label some sequences as 'clean' first.");
    process.exit(1);
  }

  // Discover SSG rules
  const { rules, nsInit } = discoverRulesFromSequences(cleanSeqs);

  // Validate all labeled sequences
  let tp = 0, fp = 0, tn = 0, fn = 0;
  const details: any[] = [];

  for (const idx of labeledIndices) {
    const expected = labels[idx];
    const calls = sequences[idx] || [];

    const result = validateSequenceWithSSG(calls, rules, nsInit);
    const detected = result.valid ? "clean" : "violation";

    if (expected === "violation" && detected === "violation") tp++;
    else if (expected === "clean" && detected === "violation") fp++;
    else if (expected === "clean" && detected === "clean") tn++;
    else if (expected === "violation" && detected === "clean") fn++;

    if (expected !== detected) {
      details.push({
        index: idx,
        expected, detected,
        reason: result.reason || "",
        calls: calls.slice(0, 6),
      });
    }
  }

  const total = tp + fp + tn + fn;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  // Print report
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  const color = (v: number) => v >= 0.7 ? C.green : v >= 0.5 ? C.yellow : C.red;

  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║${C.reset}  ${C.bold}SSG Precision Report — curl${C.reset}                          ${C.bold}${C.cyan}║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════╝${C.reset}`);
  console.log("");
  console.log(`  Samples:    ${total}`);
  console.log(`  Rules:      ${rules.size} discovered from ${cleanSeqs.length} clean sequences`);
  console.log(`  TP: ${C.green}${tp}${C.reset}  FP: ${C.red}${fp}${C.reset}  TN: ${C.green}${tn}${C.reset}  FN: ${C.red}${fn}${C.reset}`);
  console.log("");
  console.log(`  Precision:  ${color(precision)}${pct(precision)}${C.reset}`);
  console.log(`  Recall:     ${color(recall)}${pct(recall)}${C.reset}`);
  console.log(`  F1:         ${color(f1)}${pct(f1)}${C.reset}`);
  console.log("");

  if (details.length > 0) {
    console.log(`  ${C.yellow}Mismatches (${details.length}):${C.reset}`);
    for (const d of details.slice(0, 10)) {
      const icon = d.expected === "violation" ? `${C.red}FN${C.reset}` : `${C.yellow}FP${C.reset}`;
      console.log(`    ${icon} [${d.index}] expected ${d.expected}, got ${d.detected}`);
      console.log(`       ${C.dim}${d.calls.join(" → ")}${C.reset}`);
    }
    console.log("");
  }

  const rating = f1 >= 0.85 ? `${C.green}EXCELLENT${C.reset}` : f1 >= 0.7 ? `${C.yellow}GOOD${C.reset}` : f1 >= 0.5 ? `${C.yellow}FAIR${C.reset}` : `${C.red}NEEDS IMPROVEMENT${C.reset}`;
  console.log(`  Rating: ${rating}`);

  // Save
  const report = { repo: "curl", total, tp, fp, tn, fn, precision, recall, f1, rulesDiscovered: rules.size, timestamp: new Date().toISOString(), details };
  const reportPath = path.join(path.dirname(repoPath), `${path.basename(repoPath)}-precision.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📁 Saved: ${reportPath}\n`);
}

main();
