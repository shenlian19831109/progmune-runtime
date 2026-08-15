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

function scanRepo(repoName: string) {
  const dir = path.join(REPOS_DIR, repoName);
  const ir = extractIRPython(dir);
  const funcs = ir.filter(f => !f.external && f.exported);

  const violations: any[] = [];
  for (const f of funcs) {
    const safe = detectSafeguardViolations(f.calls || [], f.name, "python", (f.params || []).map(p => p.name));
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

const repos = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : fs.readdirSync(REPOS_DIR).filter(d => fs.statSync(path.join(REPOS_DIR, d)).isDirectory());

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
