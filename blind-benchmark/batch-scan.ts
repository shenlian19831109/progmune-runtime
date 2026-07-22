/**
 * Progmune Blind Benchmark — Batch Scanner v2
 * Scans all generated projects with protocol + safeguard + resource detectors.
 *
 * Usage: npx ts-node blind-benchmark/batch-scan.ts
 */

import * as fs from "fs";
import * as path from "path";
import { extractIRWithTypes, FunctionInfo } from "../src/extract-ir";
import { detectProtocolViolations, detectSafeguardViolations, validateProtocolState, ProtocolViolation, SafeguardViolation } from "../src/protocol-detector";
import { detectResourceViolations } from "../src/resource-detector";

const GEN_DIR = path.resolve(__dirname, "generated");

interface ProjectScanResult {
  project: string;
  files: number;
  functions: number;
  totalLines: number;
  allCalls: string[];
  protocolViolations: ProtocolViolation[];
  safeguardViolations: SafeguardViolation[];
  resourceViolations: any[];
  perFunction: Array<{
    name: string; file: string; calls: string[];
    protocolViolations: ProtocolViolation[];
    safeguardViolations: SafeguardViolation[];
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
  const allCalls = [...new Set(funcs.flatMap(f => f.calls || []))];

  const protocolViolations = detectProtocolViolations(allCalls);
  const safeguardViolations = detectSafeguardViolations(allCalls);
  const resourceViolations = detectResourceViolations(allCalls);

  const perFunction = funcs
    .filter(f => f.exported)
    .map(f => ({
      name: f.name, file: f.file, calls: f.calls || [],
      protocolViolations: detectProtocolViolations(f.calls || []),
      safeguardViolations: detectSafeguardViolations(f.calls || [], f.name),
    }));

  return { project: projectId, files: [...new Set(funcs.map(f => f.file))].length,
    functions: funcs.length, totalLines: countLines(dir), allCalls,
    protocolViolations, safeguardViolations, resourceViolations, perFunction };
}

// ── Main ──

const projects = fs.readdirSync(GEN_DIR).filter(d => {
  const p = path.join(GEN_DIR, d);
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
  const totalV = r.protocolViolations.length + r.safeguardViolations.length + r.resourceViolations.length;
  console.log(`${r.functions} funcs, ${totalV} violations (P:${r.protocolViolations.length} S:${r.safeguardViolations.length} R:${r.resourceViolations.length})`);
}

// ── Summary ──
console.log("\n── Summary ──\n");
for (const r of results) {
  const p = r.protocolViolations.length, s = r.safeguardViolations.length, rc = r.resourceViolations.length;
  const total = p + s + rc;
  console.log(`  ${total === 0 ? "✅" : "⚠️"} ${r.project.padEnd(12)} ${String(r.functions).padStart(3)} funcs  ${String(r.totalLines).padStart(4)} lines  P:${p} S:${s} R:${rc}  ${r.allCalls.length} calls`);
}

// ── Detailed Findings ──
console.log("\n── Detailed Findings ──\n");
let totalFindings = 0;
for (const r of results) {
  const allV = [...r.protocolViolations, ...r.safeguardViolations, ...r.resourceViolations];
  if (allV.length === 0) { console.log(`  ${r.project}: CLEAN\n`); continue; }
  console.log(`  ▸ ${r.project} (${allV.length} findings)`);

  for (const v of r.protocolViolations) {
    totalFindings++;
    console.log(`    [PROTO-${v.category}] ${v.protocol}`);
    console.log(`      ${v.type} | missing: ${v.missing.join(", ")}`);
    console.log(`      ${v.conceptDetail || v.detail}`);
  }
  for (const v of r.safeguardViolations) {
    totalFindings++;
    console.log(`    [SAFE-${v.category}] ${v.rule}`);
    console.log(`      missing_safeguard`);
    console.log(`      ${v.conceptDetail || v.detail}`);
  }
  for (const v of r.resourceViolations) {
    totalFindings++;
    console.log(`    [RES-${v.category}] ${v.type}`);
    console.log(`      ${v.detail}`);
  }
  console.log();
}

// ── Aggregate ──
console.log("── Aggregate Stats ──\n");
console.log(`  Projects scanned:    ${results.length}`);
console.log(`  Total functions:     ${results.reduce((s, r) => s + r.functions, 0)}`);
console.log(`  Total lines:         ${results.reduce((s, r) => s + r.totalLines, 0)}`);
console.log(`  Protocol findings:   ${results.reduce((s, r) => s + r.protocolViolations.length, 0)}`);
console.log(`  Safeguard findings:  ${results.reduce((s, r) => s + r.safeguardViolations.length, 0)}`);
console.log(`  Resource findings:   ${results.reduce((s, r) => s + r.resourceViolations.length, 0)}`);
console.log(`  Total findings:      ${totalFindings}`);
console.log(`  Avg findings/proj:   ${(totalFindings / results.length).toFixed(1)}`);

// ── Per-function safeguard violations ──
console.log("\n── Per-Function Safeguard Violations ──\n");
for (const r of results) {
  const violating = r.perFunction.filter(f => f.safeguardViolations.length > 0);
  if (violating.length === 0) continue;
  console.log(`  ${r.project}:`);
  for (const f of violating) {
    for (const v of f.safeguardViolations) {
      console.log(`    ${f.name} (${f.file}): [${v.category}] ${v.rule}`);
    }
  }
}

// ── Write Report ──
const report = {
  generated: new Date().toISOString(),
  projects: results.map(r => ({
    project: r.project, files: r.files, functions: r.functions, totalLines: r.totalLines, allCalls: r.allCalls,
    protocolViolations: r.protocolViolations.map(v => ({ protocol: v.protocol, category: v.category, type: v.type, missing: v.missing, detail: v.detail, conceptDetail: v.conceptDetail })),
    safeguardViolations: r.safeguardViolations.map(v => ({ rule: v.rule, category: v.category, type: v.type, detail: v.detail, conceptDetail: v.conceptDetail })),
    resourceViolations: r.resourceViolations,
  })),
  aggregate: {
    projects: results.length, totalFunctions: results.reduce((s, r) => s + r.functions, 0),
    totalLines: results.reduce((s, r) => s + r.totalLines, 0),
    protocolFindings: results.reduce((s, r) => s + r.protocolViolations.length, 0),
    safeguardFindings: results.reduce((s, r) => s + r.safeguardViolations.length, 0),
    resourceFindings: results.reduce((s, r) => s + r.resourceViolations.length, 0),
    totalFindings,
  },
};

const reportPath = path.join(__dirname, "reports", "batch-scan-results.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\n  Report: ${reportPath}\n`);
