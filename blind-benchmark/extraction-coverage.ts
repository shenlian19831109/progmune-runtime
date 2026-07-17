/**
 * Phase 3A: Extraction Coverage Dashboard
 *
 * Measures how well the C extractor covers each repo.
 * Only repos with ≥80% coverage enter layer distribution statistics.
 *
 * Usage: npx ts-node blind-benchmark/extraction-coverage.ts
 */

import * as fs from "fs";
import * as path from "path";
import { extractSequences } from "../src/sequence-extractor";

const BENCH_DIR = path.resolve(__dirname, "..", "benchmarks");
const C: Record<string, string> = { r: "\x1b[0m", b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[32m", r2: "\x1b[31m", y: "\x1b[33m", c: "\x1b[36m", m: "\x1b[35m" };

interface RepoCoverage {
  repo: string;
  cFiles: number;
  hFiles: number;
  cLines: number;
  parsedFunctions: number;
  /** Functions per 1000 lines of C code */
  funcPerKLOC: number;
  /** Whether extraction density is healthy (≥10/KLOC) */
  qualified: boolean;
}

// ═══════════════════════════════════════════════════
// Coverage metric: functions extracted per 1000 lines of C code.
// Normalizes across repo sizes. Healthy C projects typically yield
// 15-40 functions per 1000 lines (excluding tests).
// Below 10/KLOC suggests extraction gap.
// ═══════════════════════════════════════════════════

const HEALTHY_MIN = 10; // functions per 1000 lines — below this is under-extraction
const HEALTHY_TYPICAL = 20; // typical well-extracted C project

// ═══════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════

console.log(`${C.b}${C.c}╔══════════════════════════════════════════════════════════════════════════╗${C.r}`);
console.log(`${C.b}${C.c}║${C.r}   ${C.b}Phase 3A: Extraction Coverage Dashboard${C.r}                              ${C.b}${C.c}║${C.r}`);
console.log(`${C.b}${C.c}║${C.r}   ${C.d}Only repos with ≥80% coverage qualify for layer distribution${C.r}        ${C.b}${C.c}║${C.r}`);
console.log(`${C.b}${C.c}╚══════════════════════════════════════════════════════════════════════════╝${C.r}\n`);

const repos = fs.readdirSync(BENCH_DIR).filter(d => {
  const p = path.join(BENCH_DIR, d);
  if (!fs.statSync(p).isDirectory()) return false;
  if (d.startsWith(".") || d === "reports" || d === "generated" || d === "synthesized") return false;
  return findFiles(p, /\.c$/, /(test|tests|\.git)/).length > 0;
});

console.log(`${C.b}Extracting...${C.r}\n`);

const coverages: RepoCoverage[] = [];

for (const repo of repos) {
  const repoPath = path.join(BENCH_DIR, repo);
  process.stdout.write(`  ${repo.padEnd(15)} `);

  // Count C files and lines (source only, no headers)
  const cFiles = findFiles(repoPath, /\.c$/, /(test|tests|\.git|doc)/);
  let cLines = 0;
  for (const f of cFiles) {
    try { cLines += fs.readFileSync(f, "utf-8").split("\n").length; } catch {}
  }

  // Parse
  const sequences = extractSequences(repoPath, {
    include: /\.(c|h)$/,
    exclude: /(test|tests|vendor|build|dist|\.git|__pycache__|examples|demo|doc)/,
    maxBodyLines: 200,
  });
  const parsed = sequences.length;
  const funcPerKLOC = cLines > 0 ? parsed / (cLines / 1000) : 0;
  const qualified = funcPerKLOC >= HEALTHY_MIN;

  coverages.push({ repo, cFiles: cFiles.length, hFiles: 0, cLines, parsedFunctions: parsed, funcPerKLOC, qualified });

  const qualIcon = qualified ? `${C.g}✅${C.r}` : funcPerKLOC >= 5 ? `${C.y}⚠️${C.r}` : `${C.r2}❌${C.r}`;
  console.log(`${parsed}f ${(funcPerKLOC).toFixed(1)}/KLOC ${qualIcon}${C.r}`);
}

// ═══════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════

console.log(`\n${C.b}${C.m}╔══════════════════════════════════════════════════════════════════════════╗${C.r}`);
console.log(`${C.b}${C.m}║${C.r}   ${C.b}Extraction Coverage Dashboard${C.r}                                        ${C.b}${C.m}║${C.r}`);
console.log(`${C.b}${C.m}║${C.r}   ${C.d}Metric: functions per 1000 lines of C code (≥${HEALTHY_MIN}/KLOC = qualified)${C.r}        ${C.b}${C.m}║${C.r}`);
console.log(`${C.b}${C.m}╚══════════════════════════════════════════════════════════════════════════╝${C.r}\n`);

console.log(`  ${C.b}Repo             .c     C Lines   Funcs   /KLOC   Status${C.r}`);
console.log(`  ${C.d}──────────────  ────  ────────  ──────  ──────  ──────${C.r}`);

for (const cov of coverages) {
  const bar = "█".repeat(Math.max(0, Math.round(cov.funcPerKLOC / HEALTHY_TYPICAL * 15)));
  const qual = cov.qualified ? `${C.g}✅ qualified${C.r}`
    : cov.funcPerKLOC >= 5 ? `${C.y}⚠️ marginal${C.r}`
    : `${C.r2}❌ under-extracted${C.r}`;
  const color = cov.funcPerKLOC >= HEALTHY_MIN ? C.g : cov.funcPerKLOC >= 5 ? C.y : C.r2;
  console.log(`  ${cov.repo.padEnd(15)} ${String(cov.cFiles).padStart(4)}  ${String(cov.cLines).padStart(8)}  ${String(cov.parsedFunctions).padStart(5)}  ${color}${String(cov.funcPerKLOC.toFixed(1)).padStart(5)}${C.r}  ${bar}  ${qual}`);
}

// ═══════════════════════════════════════════════════
// Qualification Summary
// ═══════════════════════════════════════════════════

const qualified = coverages.filter(c => c.qualified);
const marginal = coverages.filter(c => !c.qualified && c.funcPerKLOC >= 5);
const excluded = coverages.filter(c => c.funcPerKLOC < 5);

console.log(`\n${C.b}── Qualification Summary ──${C.r}\n`);
console.log(`  ${C.g}✅ Qualified (≥${HEALTHY_MIN}/KLOC):${C.r} ${qualified.length}/${coverages.length} repos${qualified.length > 0 ? ": " + qualified.map(c => c.repo).join(", ") : " none"}`);
console.log(`  ${C.y}⚠️  Marginal (5-${HEALTHY_MIN}/KLOC):${C.r} ${marginal.length}/${coverages.length} repos${marginal.length > 0 ? ": " + marginal.map(c => c.repo).join(", ") : " none"}`);
console.log(`  ${C.r2}❌ Under-extracted (<5/KLOC):${C.r} ${excluded.length}/${coverages.length} repos${excluded.length > 0 ? ": " + excluded.map(c => c.repo).join(", ") : " none"}`);
console.log(`\n  ${C.b}Rule:${C.r} Only qualified + marginal repos (≥5/KLOC) enter layer distribution.`);
console.log(`  ${C.d}Under-extracted repos are excluded to prevent Sampling Bias.${C.r}\n`);

// Save
const outPath = path.join(__dirname, "reports", "extraction-coverage.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({
  generated: new Date().toISOString(),
  metric: "functions per 1000 lines of C code",
  qualifiedThreshold: HEALTHY_MIN,
  qualifiedRepos: qualified.map(c => c.repo),
  marginalRepos: marginal.map(c => c.repo),
  excludedRepos: excluded.map(c => c.repo),
  coverages,
}, null, 2));
console.log(`  ${C.d}Report: ${outPath}${C.r}\n`);

// Helper
function findFiles(dir: string, include: RegExp, exclude: RegExp): string[] {
  const results: string[] = [];
  function walk(d: string) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory() && !exclude.test(full)) walk(full);
      else if (entry.isFile() && include.test(entry.name) && !exclude.test(full)) results.push(full);
    }
  }
  walk(dir);
  return results;
}
