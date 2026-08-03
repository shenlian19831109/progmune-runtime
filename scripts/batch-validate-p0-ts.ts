#!/usr/bin/env npx ts-node
/**
 * Batch validation: Run P0 payment/registration/session rules
 * across all TS projects with matching functions.
 * Measures: new P0 catches vs. existing v6/v7 catches.
 */

import * as fs from "fs";
import * as path from "path";
import { detectSafeguardViolations } from "../src/protocol-detector";

const GEN_DIR = path.join(__dirname, "..", "blind-benchmark", "generated");
const P0_CATEGORIES = ["payment", "registration", "session"];
const RESULTS: any[] = [];

function extractExportedFunctions(filePath: string): { name: string; calls: string[] }[] {
  const content = fs.readFileSync(filePath, "utf-8");
  // Extract function names
  const funcs: { name: string; calls: string[] }[] = [];
  const regex = /export\s+(async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/gs;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const name = match[2];
    const body = match[3];
    // Extract function calls from body
    const callRegex = /(\w+)\s*\(/g;
    const calls: string[] = [];
    let cm;
    while ((cm = callRegex.exec(body)) !== null) {
      const called = cm[1];
      if (!["if", "for", "while", "switch", "return", "throw", "new", "typeof", "console", "require"].includes(called)) {
        calls.push(called);
      }
    }
    funcs.push({ name, calls: [...new Set(calls)] });
  }
  return funcs;
}

// Process all project dirs
for (const projDir of fs.readdirSync(GEN_DIR)) {
  const projPath = path.join(GEN_DIR, projDir);
  if (!fs.statSync(projPath).isDirectory()) continue;
  const srcPath = path.join(projPath, "src");
  if (!fs.existsSync(srcPath)) continue;

  let totalFuncs = 0;
  let newP0Catches = 0;
  let existingCatches = 0;
  const details: string[] = [];

  for (const file of fs.readdirSync(srcPath)) {
    if (!file.endsWith(".ts")) continue;
    const funcs = extractExportedFunctions(path.join(srcPath, file));
    totalFuncs += funcs.length;

    for (const { name, calls } of funcs) {
      const violations = detectSafeguardViolations(calls, name, "typescript");
      const p0 = violations.filter(v => P0_CATEGORIES.includes(v.category));
      const existing = violations.filter(v => !P0_CATEGORIES.includes(v.category));

      if (p0.length > 0 || existing.length > 0) {
        newP0Catches += p0.length;
        existingCatches += existing.length;
        for (const v of p0) {
          details.push(`  🆕 [${v.category}] ${name}: ${v.rule}`);
        }
        for (const v of existing) {
          details.push(`  ✅ [${v.category}] ${name}: ${v.rule}`);
        }
      }
    }
  }

  if (newP0Catches > 0 || existingCatches > 0) {
    RESULTS.push({ project: projDir, totalFuncs, newP0Catches, existingCatches, details });
  }
}

// ── Report ──
console.log("\n═══ P0 Batch TS Validation ═══\n");

let totalNew = 0, totalExisting = 0, projectsWithNew = 0;

for (const r of RESULTS.sort((a, b) => (b.newP0Catches + b.existingCatches) - (a.newP0Catches + a.existingCatches))) {
  const total = r.newP0Catches + r.existingCatches;
  const pct = r.totalFuncs > 0 ? (total / r.totalFuncs * 100).toFixed(0) : "?";
  console.log(`${r.project.padEnd(22)} ${String(r.totalFuncs).padStart(3)} funcs  🆕 ${String(r.newP0Catches).padStart(2)}  ✅ ${String(r.existingCatches).padStart(2)}  (${pct}% violation rate)`);
  totalNew += r.newP0Catches;
  totalExisting += r.existingCatches;
  if (r.newP0Catches > 0) projectsWithNew++;
}

console.log(`\n─── Aggregate ───`);
console.log(`  Projects scanned: ${RESULTS.length}`);
console.log(`  Projects with P0 catches: ${projectsWithNew}`);
console.log(`  Total P0 violations (new): ${totalNew}`);
console.log(`  Total existing violations: ${totalExisting}`);
console.log(`  P0 increment: +${totalNew} violations beyond v6/v7 baseline`);

// Show top P0 detections
console.log(`\n─── Top P0 Detections ───`);
const p0Counts: Record<string, number> = {};
for (const r of RESULTS) {
  for (const d of r.details) {
    if (d.includes("🆕")) {
      const rule = d.split(": ")[2] || d;
      p0Counts[rule] = (p0Counts[rule] || 0) + 1;
    }
  }
}
for (const [rule, count] of Object.entries(p0Counts).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${count}x ${rule}`);
}

// Check specific gold-annotated projects
console.log(`\n─── Gold-Annotated Projects Detail ───`);
const goldProjects = ["blog", "chat", "crm", "ecommerce", "forum", "todo", "wiki", "issuetracker", "filestorage", "scheduler"];
for (const r of RESULTS) {
  if (goldProjects.includes(r.project)) {
    console.log(`\n  ${r.project} (${r.newP0Catches} new + ${r.existingCatches} existing):`);
    for (const d of r.details.slice(0, 8)) {
      console.log(d);
    }
    if (r.details.length > 8) console.log(`  ... and ${r.details.length - 8} more`);
  }
}
console.log();
