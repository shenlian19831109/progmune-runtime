/**
 * Progmune Blind Benchmark — Python Batch Scanner v1
 *
 * Scans generated-py/ projects with the same safeguard/protocol detectors as the
 * TypeScript benchmark, via the Python IR extractor (tools/extract_ir.py).
 *
 * Usage: npx ts-node blind-benchmark/batch-scan-python.ts
 */

import * as fs from "fs";
import * as path from "path";
import { extractIRPython } from "../src/extract-ir-python";
import { detectProtocolViolations, detectSafeguardViolations, ProtocolViolation, SafeguardViolation } from "../src/protocol-detector";

const GEN_DIR = path.resolve(__dirname, "generated-py");

/** Shared with batch-scan.ts: functions called by a web handler are the
 *  request surface that authorization rules target. */
const WEB_HANDLER = /\b(handle_request|handleRequest|request_handler|requestHandler)\b/i;

function computeExposed(funcs: Array<{ name: string; calls?: string[] }>): Set<string> {
  const exposed = new Set<string>();
  for (const f of funcs) {
    if (WEB_HANDLER.test(f.name)) {
      for (const c of f.calls || []) exposed.add(c);
    }
  }
  return exposed;
}

function isExposed(name: string, exposed: Set<string>): boolean {
  return exposed.has(name) || exposed.has(name.split(".").pop() || name);
}

interface ProjectScanResult {
  project: string;
  files: number;
  functions: number;
  totalLines: number;
  allCalls: string[];
  protocolViolations: ProtocolViolation[];
  safeguardViolations: SafeguardViolation[];
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
      else if (entry.name.endsWith(".py")) {
        try { lines += fs.readFileSync(path.join(d, entry.name), "utf-8").split("\n").length; } catch {}
      }
    }
  };
  walk(dir);
  return lines;
}

function scanProject(projectId: string): ProjectScanResult {
  const dir = path.join(GEN_DIR, projectId);
  const ir = extractIRPython(dir);
  const funcs = ir.filter(f => !f.external);
  const allCalls = [...new Set(funcs.flatMap(f => f.calls || []))];
  const exposed = computeExposed(funcs);

  const protocolViolations = detectProtocolViolations(allCalls);
  const safeguardViolations = detectSafeguardViolations(allCalls, undefined, "python");

  const perFunction = funcs
    .filter(f => f.exported)
    .map(f => ({
      name: f.name, file: f.file, calls: f.calls || [],
      protocolViolations: detectProtocolViolations(f.calls || []),
      safeguardViolations: detectSafeguardViolations(f.calls || [], f.name, "python", (f.params || []).map(p => p.name), isExposed(f.name, exposed)),
    }));

  return { project: projectId, files: [...new Set(funcs.map(f => f.file))].length,
    functions: funcs.length, totalLines: countLines(dir), allCalls,
    protocolViolations, safeguardViolations, perFunction };
}

// ── Main ──
const projects = fs.readdirSync(GEN_DIR).filter(d => {
  const p = path.join(GEN_DIR, d);
  return fs.statSync(p).isDirectory() && !d.startsWith(".");
});

console.log(`\n  Progmune Blind Benchmark — Python Batch Scan (${projects.length} projects)\n`);

const results: ProjectScanResult[] = [];
for (const proj of projects) {
  process.stdout.write(`  Scanning ${proj}... `);
  const r = scanProject(proj);
  results.push(r);
  const totalV = r.protocolViolations.length + r.safeguardViolations.length;
  console.log(`${r.functions} funcs, ${totalV} violations (P:${r.protocolViolations.length} S:${r.safeguardViolations.length})`);
}

const report = {
  generated: new Date().toISOString(),
  projects: results.map(r => ({
    project: r.project, files: r.files, functions: r.functions, totalLines: r.totalLines, allCalls: r.allCalls,
    protocolViolations: r.protocolViolations.map(v => ({ protocol: v.protocol, category: v.category, type: v.type, missing: v.missing, detail: v.detail, conceptDetail: v.conceptDetail })),
    safeguardViolations: r.safeguardViolations.map(v => ({ rule: v.rule, category: v.category, type: v.type, detail: v.detail, conceptDetail: v.conceptDetail })),
    perFunction: r.perFunction.map(f => ({
      name: f.name, file: f.file, calls: f.calls,
      protocolViolations: f.protocolViolations.map(v => ({ protocol: v.protocol, category: v.category, type: v.type, missing: v.missing, detail: v.detail, conceptDetail: v.conceptDetail })),
      safeguardViolations: f.safeguardViolations.map(v => ({ rule: v.rule, category: v.category, type: v.type, detail: v.detail, conceptDetail: v.conceptDetail })),
    })),
  })),
  aggregate: {
    projects: results.length,
    totalFunctions: results.reduce((s, r) => s + r.functions, 0),
    totalLines: results.reduce((s, r) => s + r.totalLines, 0),
    protocolFindings: results.reduce((s, r) => s + r.protocolViolations.length, 0),
    safeguardFindings: results.reduce((s, r) => s + r.safeguardViolations.length, 0),
  },
};

const reportPath = path.join(__dirname, "reports", "batch-scan-python-results.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\n  Report: ${reportPath}\n`);
