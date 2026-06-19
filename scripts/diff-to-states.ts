#!/usr/bin/env npx tsx
/**
 * P9.2d: Diff-to-State-Machine — build gold CVE data from real git diffs
 *
 * Takes a git diff (unified format) and extracts the function call
 * sequences before and after the fix. This bypasses the heuristic
 * parser entirely — the diff IS the ground truth.
 *
 * Input format (JSON per CVE):
 *   {
 *     "cve": "CVE-2022-41850",
 *     "project": "linux",
 *     "before": ["hdev_open", "alloc_report", "register_handler"],
 *     "after":  ["hdev_open", "alloc_report", "register_handler", "hdev_close"],
 *     "category": "resource_leak",
 *     "notes": "Missing hdev_close() in roccat driver error path"
 *   }
 *
 * Usage:
 *   echo '[{...}]' | npx tsx scripts/diff-to-states.ts
 *   npx tsx scripts/diff-to-states.ts --input benchmarks/gold-cves.json
 *
 * Output: benchmarks/gold-cves.json (annotated gold dataset)
 */

import * as fs from "fs";
import * as path from "path";

interface GoldCVEInput {
  cve: string;
  project: string;
  before: string[];
  after: string[];
  category: string;
  severity?: string;
  notes?: string;
}

function main() {
  const args = process.argv.slice(2);
  const inputFlag = args.indexOf("--input");
  const inputPath = inputFlag >= 0 ? args[inputFlag + 1] : null;

  let raw: string;
  if (inputPath) {
    raw = fs.readFileSync(inputPath, "utf-8");
  } else {
    // Read from stdin
    raw = fs.readFileSync(0, "utf-8"); // stdin
  }

  const inputs: GoldCVEInput[] = JSON.parse(raw);

  const goldCases = inputs.map((c, i) => ({
    id: `GOLD-${String(i + 1).padStart(3, "0")}`,
    cve: c.cve,
    title: c.notes?.slice(0, 80) || c.cve,
    category: c.category,
    severity: c.severity || "high",
    broken: c.before,
    expected: c.after,
    project: c.project,
    verifiedBy: "git_diff",
    notes: c.notes,
  }));

  const outputPath = inputPath || path.resolve(__dirname, "..", "benchmarks", "gold-cves.json");
  fs.writeFileSync(outputPath, JSON.stringify({ cases: goldCases, metadata: { total: goldCases.length } }, null, 2));
  console.log(`Wrote ${goldCases.length} gold CVE cases to ${outputPath}`);
  console.log("Next: npx vitest run src/gold-cve.test.ts");
}

main();
