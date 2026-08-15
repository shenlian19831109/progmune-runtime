/**
 * Real-Python Project Scanner — validation harness for the Python detector.
 *
 * Scans real-world repos under benchmarks/python-repos/ with the Python IR
 * extractor + safeguard/protocol detectors, and writes per-function violations
 * to reports/real-python-scan.json for human review.
 *
 * Usage: npx ts-node blind-benchmark/scan-real-python.ts [repo1 repo2 ...]
 */

import * as fs from "fs";
import * as path from "path";
import { extractIRPython } from "../src/extract-ir-python";
import { detectProtocolViolations, detectSafeguardViolations } from "../src/protocol-detector";

const REPOS_DIR = path.resolve(__dirname, "..", "benchmarks", "python-repos");

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

function scanRepo(repoName: string) {
  const dir = path.join(reposDir, repoName);
  const ir = extractIRPython(dir);
  const funcs = ir.filter(f => !f.external && f.exported);
  const exposed = computeExposed(funcs);

  const violations: any[] = [];
  for (const f of funcs) {
    const safe = detectSafeguardViolations(f.calls || [], f.name, "python", (f.params || []).map(p => p.name), isExposed(f.name, exposed));
    const proto = detectProtocolViolations(f.calls || []);
    if (safe.length === 0 && proto.length === 0) continue;
    violations.push({
      name: f.name,
      file: f.file,
      calls: f.calls || [],
      params: (f.params || []).map(p => p.name),
      safeguard: safe.map(v => ({ rule: v.rule, category: v.category, detail: v.detail })),
      protocol: proto.map(v => ({ protocol: v.protocol, category: v.category, detail: v.detail })),
    });
  }
  return {
    repo: repoName,
    totalFunctions: funcs.length,
    functionsWithViolations: violations.length,
    violations,
  };
}

const args = process.argv.slice(2);
// --dir <path> scans an alternate repos directory (e.g. benchmarks/python-apps)
const dirFlag = args.indexOf("--dir");
const reposDir = dirFlag >= 0 ? path.resolve(args[dirFlag + 1]) : REPOS_DIR;
const repos = args.filter((a, i) => a !== "--dir" && (dirFlag < 0 || i !== dirFlag + 1)).length > 0
  ? args.filter((a, i) => a !== "--dir" && (dirFlag < 0 || i !== dirFlag + 1))
  : fs.readdirSync(reposDir).filter(d => fs.statSync(path.join(reposDir, d)).isDirectory());

const results = [];
for (const repo of repos) {
  process.stdout.write(`  Scanning ${repo}... `);
  const r = scanRepo(repo);
  results.push(r);
  console.log(`${r.totalFunctions} funcs, ${r.functionsWithViolations} with violations`);
}

const outPath = path.join(__dirname, "reports", "real-python-scan.json");
fs.writeFileSync(outPath, JSON.stringify({ generated: new Date().toISOString(), results }, null, 2));
console.log(`\n  Report: ${outPath}\n`);
