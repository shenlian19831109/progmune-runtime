/**
 * Progmune Blind Benchmark — Batch Scanner
 * Scans all generated projects and produces a combined report.
 *
 * Usage: npx ts-node blind-benchmark/batch-scan.ts
 */

import * as fs from "fs";
import * as path from "path";
import { extractIRWithTypes, FunctionInfo } from "../src/extract-ir";
import { detectProtocolViolations, validateProtocolState, ProtocolViolation } from "../src/protocol-detector";
import { detectResourceViolations } from "../src/resource-detector";

const GEN_DIR = path.resolve(__dirname, "generated");

interface ProjectScanResult {
  project: string;
  files: number;
  functions: number;
  totalLines: number;
  allCalls: string[];
  protocolViolations: ProtocolViolation[];
  resourceViolations: any[];
  perFunction: Array<{
    name: string;
    file: string;
    calls: string[];
    violations: ProtocolViolation[];
  }>;
}

function countLines(dir: string): number {
  let lines = 0;
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) walk(path.join(d, entry.name));
      else if (entry.name.endsWith(".ts")) {
        try { lines += fs.readFileSync(path.join(d, entry.name), "utf-8").split("\n").length; } catch {}
      }
    }
  };
  walk(dir);
  return lines;
}

function scanProject(projectId: string): ProjectScanResult {
  const dir = path.join(GEN_DIR, projectId);
  const ir = extractIRWithTypes(dir);
  const funcs = ir.functions.filter(f => !f.external);

  // Collect all unique calls
  const allCalls = [...new Set(funcs.flatMap(f => f.calls || []))];

  // Protocol detection on all calls
  const protocolViolations = detectProtocolViolations(allCalls);

  // Resource violations on all calls
  const resourceViolations = detectResourceViolations(allCalls);

  // Per-function analysis
  const perFunction = funcs
    .filter(f => f.exported && f.calls && f.calls.length > 0)
    .map(f => ({
      name: f.name,
      file: f.file,
      calls: f.calls!,
      violations: detectProtocolViolations(f.calls!),
    }));

  return {
    project: projectId,
    files: [...new Set(funcs.map(f => f.file))].length,
    functions: funcs.length,
    totalLines: countLines(dir),
    allCalls,
    protocolViolations,
    resourceViolations,
    perFunction,
  };
}

// ── Main ──

const projects = fs.readdirSync(GEN_DIR).filter(d => {
  const p = path.join(GEN_DIR, d);
  // Only scan directories that have a tsconfig.json (skip empty model dirs)
  return fs.statSync(p).isDirectory() && !d.startsWith(".") && fs.existsSync(path.join(p, "tsconfig.json"));
});

console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║   Progmune Blind Benchmark — Batch Scan (5 Projects)         ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

const results: ProjectScanResult[] = [];

for (const proj of projects) {
  process.stdout.write(`  Scanning ${proj}... `);
  const r = scanProject(proj);
  results.push(r);
  console.log(`${r.functions} funcs, ${r.protocolViolations.length} protocol violations, ${r.resourceViolations.length} resource violations`);
}

// ── Summary ──
console.log("\n── Summary ──\n");

for (const r of results) {
  const pCount = r.protocolViolations.length;
  const rCount = r.resourceViolations.length;
  const icon = pCount === 0 && rCount === 0 ? "✅" : pCount > 0 ? "⚠️" : "🔍";
  console.log(`  ${icon} ${r.project.padEnd(12)} ${String(r.functions).padStart(3)} funcs  ${String(r.totalLines).padStart(4)} lines  ${String(pCount).padStart(2)} protocol  ${String(rCount).padStart(2)} resource  ${r.allCalls.length} unique calls`);
}

// ── Detailed Findings ──
console.log("\n── Detailed Protocol Findings ──\n");

let totalFindings = 0;
for (const r of results) {
  if (r.protocolViolations.length === 0 && r.resourceViolations.length === 0) {
    console.log(`  ${r.project}: CLEAN\n`);
    continue;
  }

  console.log(`  ▸ ${r.project} (${r.protocolViolations.length + r.resourceViolations.length} findings)`);

  for (const v of r.protocolViolations) {
    totalFindings++;
    console.log(`    [${v.category.toUpperCase()}] ${v.protocol}`);
    console.log(`      Type: ${v.type}  |  Missing: ${v.missing.join(", ")}`);
    console.log(`      ${v.conceptDetail || v.detail}`);
  }

  for (const v of r.resourceViolations) {
    totalFindings++;
    console.log(`    [${v.category.toUpperCase()}] RESOURCE`);
    console.log(`      Type: ${v.type}  |  ${v.detail}`);
  }
  console.log();
}

// ── Aggregate ──
console.log("── Aggregate Stats ──\n");
console.log(`  Projects scanned:   ${results.length}`);
console.log(`  Total functions:    ${results.reduce((s, r) => s + r.functions, 0)}`);
console.log(`  Total lines:        ${results.reduce((s, r) => s + r.totalLines, 0)}`);
console.log(`  Protocol findings:  ${results.reduce((s, r) => s + r.protocolViolations.length, 0)}`);
console.log(`  Resource findings:  ${results.reduce((s, r) => s + r.resourceViolations.length, 0)}`);
console.log(`  Total findings:     ${totalFindings}`);
console.log(`  Avg findings/proj:  ${(totalFindings / results.length).toFixed(1)}`);

// ── Per-function violations ──
console.log("\n── Per-Function Protocol Violations ──\n");

for (const r of results) {
  const violating = r.perFunction.filter(f => f.violations.length > 0);
  if (violating.length === 0) continue;
  console.log(`  ${r.project}:`);
  for (const f of violating) {
    console.log(`    ${f.name} (${f.file}): ${f.violations.map(v => v.protocol).join(", ")}`);
  }
}

// ── Write Report ──
const report = {
  generated: new Date().toISOString(),
  projects: results.map(r => ({
    project: r.project,
    files: r.files,
    functions: r.functions,
    totalLines: r.totalLines,
    allCalls: r.allCalls,
    protocolViolations: r.protocolViolations.map(v => ({
      protocol: v.protocol,
      category: v.category,
      type: v.type,
      missing: v.missing,
      detail: v.detail,
      conceptDetail: v.conceptDetail,
    })),
    resourceViolations: r.resourceViolations,
  })),
  aggregate: {
    projects: results.length,
    totalFunctions: results.reduce((s, r) => s + r.functions, 0),
    totalLines: results.reduce((s, r) => s + r.totalLines, 0),
    protocolFindings: results.reduce((s, r) => s + r.protocolViolations.length, 0),
    resourceFindings: results.reduce((s, r) => s + r.resourceViolations.length, 0),
    totalFindings,
  },
};

const reportPath = path.join(__dirname, "reports", "batch-scan-results.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\n  Report: ${reportPath}\n`);
