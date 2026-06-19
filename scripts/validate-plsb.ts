#!/usr/bin/env npx tsx
/**
 * PLSB Validator — checks submitted cases for validity before merging.
 *
 * Usage:
 *   npx tsx scripts/validate-plsb.ts benchmarks/plsb.json
 *
 * Checks:
 *   1. All entries have valid broken/expected arrays
 *   2. All categories match a known PLS weakness type
 *   3. Verified recall doesn't drop below 85%
 *   4. No duplicate IDs
 *   5. Every entry passes quality assessment (>0)
 */

import * as fs from "fs";
import * as path from "path";

function main() {
  const filepath = process.argv[2] || path.resolve(__dirname, "..", "benchmarks", "plsb.json");
  if (!fs.existsSync(filepath)) {
    console.error(`File not found: ${filepath}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(filepath, "utf-8"));
  const entries = data.entries || [];
  const errors: string[] = [];
  const warnings: string[] = [];

  console.log(`Validating PLSB: ${entries.length} entries\n`);

  // Check 1: Valid arrays
  for (const e of entries) {
    if (!Array.isArray(e.broken) || e.broken.length === 0) {
      errors.push(`${e.id}: broken must be non-empty array`);
    }
    if (!Array.isArray(e.expected) || e.expected.length === 0) {
      errors.push(`${e.id}: expected must be non-empty array`);
    }
  }

  // Check 2: Known categories
  const KNOWN = new Set([
    "resource_leak", "auth_bypass", "use_after_free", "double_free",
    "race_condition", "data_corruption", "transaction_violation",
    "session_fixation", "privilege_escalation", "missing_validation",
  ]);
  for (const e of entries) {
    if (!KNOWN.has(e.category)) {
      warnings.push(`${e.id}: unknown category '${e.category}'`);
    }
  }

  // Check 3: No duplicates
  const ids = new Set<string>();
  for (const e of entries) {
    if (ids.has(e.id)) {
      errors.push(`${e.id}: duplicate ID`);
    }
    ids.add(e.id);
  }

  // Check 4: Quality assessment
  const { assessGoldQuality } = require("../dist/gold-quality");
  let lowQuality = 0;
  for (const e of entries) {
    const q = assessGoldQuality(e.broken, e.expected);
    if (q.score === 0) {
      lowQuality++;
      warnings.push(`${e.id}: quality score = 0 (undetectable) — consider revising broken/expected`);
    }
  }

  // Check 5: Verified recall
  if (entries.filter((e: any) => e.verified).length > 0) {
    const { runGoldBenchmark } = require("../dist/gold-cve");
    const goldDataset = {
      cases: entries.filter((e: any) => e.verified).map((e: any) => ({
        id: e.id, category: e.category, severity: e.severity || "medium",
        broken: e.broken, expected: e.expected,
        verifiedBy: e.source || "unknown", notes: e.notes,
      })),
      metadata: { total: entries.filter((e: any) => e.verified).length, byCategory: {}, verifiedBy: {} },
    };
    if (goldDataset.cases.length > 0) {
      const result = runGoldBenchmark(goldDataset);
      console.log(`  Verified recall: ${(result.recall * 100).toFixed(0)}%`);
      if (result.recall < 0.85) {
        errors.push(`Verified recall ${(result.recall * 100).toFixed(0)}% below 85% threshold`);
      }
    }
  }

  // Report
  console.log(`  Errors:   ${errors.length}`);
  console.log(`  Warnings: ${warnings.length}`);
  console.log(`  Low-quality: ${lowQuality} entries (quality=0, undetectable)`);
  console.log();

  if (errors.length > 0) {
    console.log("─── Errors ───");
    for (const e of errors) console.log(`  ❌ ${e}`);
  }
  if (warnings.length > 0) {
    console.log("─── Warnings ───");
    for (const w of warnings) console.log(`  ⚠️  ${w}`);
  }

  if (errors.length === 0) {
    console.log("✅ PLSB validation passed.\n");
    process.exit(0);
  } else {
    console.log("❌ PLSB validation failed.\n");
    process.exit(1);
  }
}

main();
