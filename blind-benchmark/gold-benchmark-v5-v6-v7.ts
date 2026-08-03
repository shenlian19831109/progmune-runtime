/**
 * Gold Benchmark: v5/v6/v7 Comparison on 6 Repos
 *
 * Measures Precision, Recall, F1 for each Context strategy on
 * curl, libssh, nginx, redis, nghttp2, openssl — with human-annotated gold labels.
 *
 * nghttp2 + openssl are "all-clean" precision benchmarks:
 * these well-maintained C libraries should produce 0 violations.
 * Any FP detected = rule needs refinement.
 *
 * Usage: npx ts-node blind-benchmark/gold-benchmark-v5-v6-v7.ts
 */

import * as fs from "fs";
import * as path from "path";
import {
  detectSafeguardViolations,
  detectSafeguardViolationsV7,
  buildCallerMap,
  SafeguardViolation,
} from "../src/protocol-detector";

// ═══════════════════════════════════════════════════════
// Data Loading
// ═══════════════════════════════════════════════════════

interface Sequence {
  function: string;
  file: string;
  calls: string[];
}

function loadRepo(repoName: string): { sequences: Sequence[]; labels: Map<number, string> } {
  const benchDir = path.resolve(__dirname, "..", "benchmarks");
  const seqPath = path.join(benchDir, `${repoName}-sequences.json`);
  const labPath = path.join(benchDir, `${repoName}-labels.json`);

  if (!fs.existsSync(seqPath) || !fs.existsSync(labPath)) {
    console.error(`  ⚠️  ${repoName}: missing data files`);
    return { sequences: [], labels: new Map() };
  }

  const seqData = JSON.parse(fs.readFileSync(seqPath, "utf-8"));
  const labData = JSON.parse(fs.readFileSync(labPath, "utf-8"));

  const sequences: Sequence[] = (seqData.sequences || seqData).map((s: any) => ({
    function: s.function || "",
    file: s.file || "",
    calls: s.calls || [],
  }));

  const labels = new Map<number, string>();
  const labSource = labData.labels || labData;
  for (const [key, val] of Object.entries(labSource)) {
    const idx = parseInt(key);
    if (!isNaN(idx) && (val === "clean" || val === "violation")) {
      labels.set(idx, val as string);
    }
  }

  return { sequences, labels };
}

// ═══════════════════════════════════════════════════════
// Detector Versions
// ═══════════════════════════════════════════════════════

type Verdict = "clean" | "violation";

interface FuncInfo {
  name: string;
  file: string;
  calls: string[];
}

function buildContextMaps(sequences: Sequence[]) {
  const funcs: FuncInfo[] = sequences.map(s => ({
    name: s.function,
    file: s.file,
    calls: s.calls,
  }));

  const callerMap = buildCallerMap(funcs);

  const funcCalls = new Map<string, Set<string>>();
  const funcFile = new Map<string, string>();
  const fileCallsMap = new Map<string, Set<string>>();

  for (const f of funcs) {
    funcCalls.set(f.name, new Set(f.calls));
    funcFile.set(f.name, f.file);
    if (!fileCallsMap.has(f.file)) fileCallsMap.set(f.file, new Set());
    for (const c of f.calls) fileCallsMap.get(f.file)!.add(c);
  }

  return { funcs, callerMap, funcCalls, funcFile, fileCallsMap };
}

function evalV5(seq: Sequence, allCalls: string[]): Verdict {
  const vios = detectSafeguardViolations(allCalls, seq.function);
  return vios.length === 0 ? "clean" : "violation";
}

function evalV6(seq: Sequence, fileCallsMap: Map<string, Set<string>>): Verdict {
  const fileCalls = fileCallsMap.get(seq.file) || new Set();
  const mergedCalls = [...new Set([...fileCalls, ...seq.calls])];
  const vios = detectSafeguardViolations(mergedCalls, seq.function);
  return vios.length === 0 ? "clean" : "violation";
}

function evalV7(
  seq: Sequence,
  callerMap: Map<string, string[]>,
  funcCalls: Map<string, Set<string>>,
  fileCallsMap: Map<string, Set<string>>,
  funcFile: Map<string, string>
): Verdict {
  const vios = detectSafeguardViolationsV7(
    seq.calls,
    seq.function,
    callerMap,
    funcCalls,
    fileCallsMap,
    funcFile,
  );
  return vios.length === 0 ? "clean" : "violation";
}

// ═══════════════════════════════════════════════════════
// Metrics
// ═══════════════════════════════════════════════════════

interface ConfusionMatrix {
  tp: number; fp: number; tn: number; fn: number;
}

function computeMatrix(results: Array<{ expected: string; detected: Verdict }>): ConfusionMatrix {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const r of results) {
    if (r.expected === "violation" && r.detected === "violation") tp++;
    else if (r.expected === "clean" && r.detected === "violation") fp++;
    else if (r.expected === "clean" && r.detected === "clean") tn++;
    else if (r.expected === "violation" && r.detected === "clean") fn++;
  }
  return { tp, fp, tn, fn };
}

function computeMetrics(m: ConfusionMatrix) {
  const total = m.tp + m.fp + m.tn + m.fn;
  const precision = m.tp + m.fp > 0 ? m.tp / (m.tp + m.fp) : 0;
  const recall = m.tp + m.fn > 0 ? m.tp / (m.tp + m.fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
  return { total, precision, recall, f1 };
}

// ═══════════════════════════════════════════════════════
// Migration Matrix
// ═══════════════════════════════════════════════════════

interface MigrationCell {
  count: number;
  examples: string[];
}

interface MigrationMatrix {
  v5_to_v6: {
    "FP→TN (fixed)": MigrationCell;
    "TN→FP (regression)": MigrationCell;
    "TP→FN (broken)": MigrationCell;
    "FN→TP (new catch)": MigrationCell;
    unchanged: number;
  };
  v6_to_v7: {
    "FP→TN (fixed)": MigrationCell;
    "TN→FP (regression)": MigrationCell;
    "TP→FN (broken)": MigrationCell;
    "FN→TP (new catch)": MigrationCell;
    unchanged: number;
  };
}

function buildMigrationMatrix(
  results: Array<{ idx: number; seq: Sequence; expected: string; v5: Verdict; v6: Verdict; v7: Verdict }>
): MigrationMatrix {
  const mm: MigrationMatrix = {
    v5_to_v6: {
      "FP→TN (fixed)": { count: 0, examples: [] },
      "TN→FP (regression)": { count: 0, examples: [] },
      "TP→FN (broken)": { count: 0, examples: [] },
      "FN→TP (new catch)": { count: 0, examples: [] },
      unchanged: 0,
    },
    v6_to_v7: {
      "FP→TN (fixed)": { count: 0, examples: [] },
      "TN→FP (regression)": { count: 0, examples: [] },
      "TP→FN (broken)": { count: 0, examples: [] },
      "FN→TP (new catch)": { count: 0, examples: [] },
      unchanged: 0,
    },
  };

  const classify = (expected: string, oldV: Verdict, newV: Verdict): string | null => {
    if (oldV === newV) return null;
    if (expected === "clean" && oldV === "violation" && newV === "clean") return "FP→TN (fixed)";
    if (expected === "clean" && oldV === "clean" && newV === "violation") return "TN→FP (regression)";
    if (expected === "violation" && oldV === "violation" && newV === "clean") return "TP→FN (broken)";
    if (expected === "violation" && oldV === "clean" && newV === "violation") return "FN→TP (new catch)";
    return null;
  };

  for (const r of results) {
    // v5 → v6
    const c56 = classify(r.expected, r.v5, r.v6);
    if (c56) {
      const cell = mm.v5_to_v6[c56 as keyof typeof mm.v5_to_v6] as MigrationCell;
      cell.count++;
      if (cell.examples.length < 3) cell.examples.push(`[${r.idx}] ${r.seq.function} (${r.seq.file.split("/").pop()})`);
    } else {
      mm.v5_to_v6.unchanged++;
    }

    // v6 → v7
    const c67 = classify(r.expected, r.v6, r.v7);
    if (c67) {
      const cell = mm.v6_to_v7[c67 as keyof typeof mm.v6_to_v7] as MigrationCell;
      cell.count++;
      if (cell.examples.length < 3) cell.examples.push(`[${r.idx}] ${r.seq.function} (${r.seq.file.split("/").pop()})`);
    } else {
      mm.v6_to_v7.unchanged++;
    }
  }

  return mm;
}

// ═══════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════

const REPOS = ["curl", "libssh", "nginx", "redis", "nghttp2", "openssl"];

const C = { r: "\x1b[0m", b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[32m", r2: "\x1b[31m", y: "\x1b[33m", c: "\x1b[36m", m: "\x1b[35m" };

console.log(`${C.b}${C.c}╔══════════════════════════════════════════════════════════════════════════╗${C.r}`);
console.log(`${C.b}${C.c}║${C.r}   ${C.b}Gold Benchmark: v5/v6/v7 — Context Strategy Comparison${C.r}              ${C.b}${C.c}║${C.r}`);
console.log(`${C.b}${C.c}║${C.r}   ${C.d}curl · libssh · nginx · redis · nghttp2 · openssl${C.r}   ${C.b}${C.c}║${C.r}`);
console.log(`${C.b}${C.c}╚══════════════════════════════════════════════════════════════════════════╝${C.r}\n`);

// Per-repo results
interface RepoResult {
  repo: string;
  totalLabeled: number;
  cleanCount: number; violationCount: number;
  v5: ConfusionMatrix;
  v6: ConfusionMatrix;
  v7: ConfusionMatrix;
  migration: MigrationMatrix;
  detailResults: Array<{ idx: number; seq: Sequence; expected: string; v5: Verdict; v6: Verdict; v7: Verdict }>;
}

const repoResults: RepoResult[] = [];

for (const repo of REPOS) {
  process.stdout.write(`${C.b}▸ ${repo}${C.r} `);
  const { sequences, labels } = loadRepo(repo);
  if (sequences.length === 0 || labels.size === 0) {
    console.log(`${C.y}SKIPPED (no data)${C.r}`);
    continue;
  }

  // Build context maps
  const allCalls = [...new Set(sequences.flatMap(s => s.calls))];
  const { funcs, callerMap, funcCalls, funcFile, fileCallsMap } = buildContextMaps(sequences);

  // Evaluate each labeled sequence
  const detailResults: RepoResult["detailResults"] = [];
  let cleanCount = 0, violationCount = 0;

  for (const [idx, expected] of labels) {
    if (idx >= sequences.length) continue;
    const seq = sequences[idx];
    if (!seq.function || seq.calls.length === 0) continue;

    if (expected === "clean") cleanCount++;
    else violationCount++;

    const v5 = evalV5(seq, allCalls);
    const v6 = evalV6(seq, fileCallsMap);
    const v7 = evalV7(seq, callerMap, funcCalls, fileCallsMap, funcFile);

    detailResults.push({ idx, seq, expected, v5, v6, v7 });
  }

  // Compute confusion matrices
  const v5matrix = computeMatrix(detailResults.map(r => ({ expected: r.expected, detected: r.v5 })));
  const v6matrix = computeMatrix(detailResults.map(r => ({ expected: r.expected, detected: r.v6 })));
  const v7matrix = computeMatrix(detailResults.map(r => ({ expected: r.expected, detected: r.v7 })));

  // Migration matrix
  const migration = buildMigrationMatrix(detailResults);

  const result: RepoResult = {
    repo, totalLabeled: labels.size, cleanCount, violationCount,
    v5: v5matrix, v6: v6matrix, v7: v7matrix,
    migration, detailResults,
  };
  repoResults.push(result);

  // Quick summary
  const v5m = computeMetrics(v5matrix);
  const v6m = computeMetrics(v6matrix);
  const v7m = computeMetrics(v7matrix);
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  console.log(`${labels.size} labels | v5 P=${pct(v5m.precision)} R=${pct(v5m.recall)} | v6 P=${pct(v6m.precision)} R=${pct(v6m.recall)} | v7 P=${pct(v7m.precision)} R=${pct(v7m.recall)}`);
}

// ═══════════════════════════════════════════════════════
// Aggregate Report
// ═══════════════════════════════════════════════════════

console.log(`\n${C.b}${C.c}╔══════════════════════════════════════════════════════════════════════════╗${C.r}`);
console.log(`${C.b}${C.c}║${C.r}   ${C.b}Aggregate Comparison — All 4 Repos${C.r}                                    ${C.b}${C.c}║${C.r}`);
console.log(`${C.b}${C.c}╚══════════════════════════════════════════════════════════════════════════╝${C.r}\n`);

// Pool all results for aggregate metrics
const allResults = repoResults.flatMap(r => r.detailResults);
const allV5 = computeMatrix(allResults.map(r => ({ expected: r.expected, detected: r.v5 })));
const allV6 = computeMatrix(allResults.map(r => ({ expected: r.expected, detected: r.v6 })));
const allV7 = computeMatrix(allResults.map(r => ({ expected: r.expected, detected: r.v7 })));

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmt = (v: number) => String(v).padStart(4);

console.log(`  Total labeled sequences: ${allResults.length}`);
console.log(`  Clean: ${allResults.filter(r => r.expected === "clean").length}  Violation: ${allResults.filter(r => r.expected === "violation").length}`);
console.log("");

// Confusion Matrix Table
console.log(`  ${C.b}┌──────────┬──────────────────────────────────┬──────────────────────────┐${C.r}`);
console.log(`  ${C.b}│ Version  │ Confusion Matrix                 │ Precision  Recall   F1   │${C.r}`);
console.log(`  ${C.b}├──────────┼──────────────────────────────────┼──────────────────────────┤${C.r}`);

for (const [label, m] of [["v5 (global)", allV5], ["v6 (per-file)", allV6], ["v7 (func+callers)", allV7]] as [string, ConfusionMatrix][]) {
  const metrics = computeMetrics(m);
  const pBar = (v: number, w: number) => "█".repeat(Math.round(v * w)).padEnd(w, "░");
  console.log(`  ${C.b}│${C.r} ${label.padEnd(9)} ${C.b}│${C.r} TP:${fmt(m.tp)} FP:${fmt(m.fp)} TN:${fmt(m.tn)} FN:${fmt(m.fn)}  ${C.b}│${C.r} ${pct(metrics.precision)} ${pBar(metrics.precision,6)} ${pct(metrics.recall)} ${pBar(metrics.recall,6)} ${pct(metrics.f1)} ${C.b}│${C.r}`);
}

console.log(`  ${C.b}└──────────┴──────────────────────────────────┴──────────────────────────┘${C.r}`);

// ═══════════════════════════════════════════════════════
// Per-Repo Detail
// ═══════════════════════════════════════════════════════

console.log(`\n${C.b}── Per-Repo Precision/Recall ──${C.r}\n`);

console.log(`  ${C.b}Repo       Labels   v5 P/R/F1         v6 P/R/F1         v7 P/R/F1          Δ(v6→v7)${C.r}`);
console.log(`  ${C.d}──────     ──────   ───────────────   ───────────────   ───────────────   ──────────${C.r}`);

for (const r of repoResults) {
  const v5m = computeMetrics(r.v5);
  const v6m = computeMetrics(r.v6);
  const v7m = computeMetrics(r.v7);
  const deltaF1 = v7m.f1 - v6m.f1;
  const deltaSign = deltaF1 >= 0 ? "+" : "";
  const deltaColor = deltaF1 > 0.005 ? C.g : deltaF1 < -0.005 ? C.r2 : C.y;

  console.log(`  ${r.repo.padEnd(10)} ${String(r.totalLabeled).padStart(5)}   ${pct(v5m.precision)}/${pct(v5m.recall)}/${pct(v5m.f1)}   ${pct(v6m.precision)}/${pct(v6m.recall)}/${pct(v6m.f1)}   ${pct(v7m.precision)}/${pct(v7m.recall)}/${pct(v7m.f1)}   ${deltaColor}${deltaSign}${(deltaF1*100).toFixed(2)}pp${C.r}`);
}

// ═══════════════════════════════════════════════════════
// Migration Matrix
// ═══════════════════════════════════════════════════════

console.log(`\n${C.b}${C.m}╔══════════════════════════════════════════════════════════════════════════╗${C.r}`);
console.log(`${C.b}${C.m}║${C.r}   ${C.b}Migration Matrix — Which violations changed between versions?${C.r}          ${C.b}${C.m}║${C.r}`);
console.log(`${C.b}${C.m}╚══════════════════════════════════════════════════════════════════════════╝${C.r}\n`);

// Aggregate migration
const aggMigration = buildMigrationMatrix(allResults);

function printMigration(title: string, mm: MigrationMatrix["v5_to_v6"]) {
  console.log(`  ${C.b}${title}${C.r}`);
  console.log(`  ${C.d}──────────────────────────────────────────────${C.r}`);
  const entries = Object.entries(mm).filter(([k]) => k !== "unchanged");
  let totalChanges = 0;
  for (const [label, cell] of entries) {
    if (typeof cell === "number") continue;
    const icon = label.includes("fixed") ? C.g + "✅" : label.includes("regression") ? C.r2 + "⚠️" : label.includes("broken") ? C.r2 + "❌" : C.y + "🔍";
    console.log(`  ${icon}${C.r} ${label.padEnd(22)} ${String(cell.count).padStart(4)}  ${C.d}${cell.examples.join(", ")}${C.r}`);
    totalChanges += cell.count;
  }
  console.log(`     ${C.d}Unchanged:${C.r} ${mm.unchanged}`);
  console.log(`     ${C.d}Total changes:${C.r} ${totalChanges}/${mm.unchanged + totalChanges} (${(totalChanges / (mm.unchanged + totalChanges) * 100).toFixed(1)}%)\n`);
}

printMigration("v5 → v6", aggMigration.v5_to_v6);
printMigration("v6 → v7", aggMigration.v6_to_v7);

// ═══════════════════════════════════════════════════════
// Decision Gate
// ═══════════════════════════════════════════════════════

const v6Agg = computeMetrics(allV6);
const v7Agg = computeMetrics(allV7);

console.log(`${C.b}${C.c}╔══════════════════════════════════════════════════════════════════════════╗${C.r}`);
console.log(`${C.b}${C.c}║${C.r}   ${C.b}Decision Gate: Should v7 become the new baseline?${C.r}                       ${C.b}${C.c}║${C.r}`);
console.log(`${C.b}${C.c}╚══════════════════════════════════════════════════════════════════════════╝${C.r}\n`);

const deltaP = v7Agg.precision - v6Agg.precision;
const deltaR = v7Agg.recall - v6Agg.recall;
const deltaF1 = v7Agg.f1 - v6Agg.f1;

console.log(`  Precision: ${pct(v6Agg.precision)} → ${pct(v7Agg.precision)} (${deltaP >= 0 ? "+" : ""}${(deltaP * 100).toFixed(2)}pp)`);
console.log(`  Recall:    ${pct(v6Agg.recall)} → ${pct(v7Agg.recall)} (${deltaR >= 0 ? "+" : ""}${(deltaR * 100).toFixed(2)}pp)`);
console.log(`  F1:        ${pct(v6Agg.f1)} → ${pct(v7Agg.f1)} (${deltaF1 >= 0 ? "+" : ""}${(deltaF1 * 100).toFixed(2)}pp)`);
console.log("");

// Thresholds
const v67 = aggMigration.v6_to_v7;
const fixed = v67["FP→TN (fixed)"].count;
const regressed = v67["TN→FP (regression)"].count;
const broken = v67["TP→FN (broken)"].count;
const newCatch = v67["FN→TP (new catch)"].count;

console.log(`  Net effect: ${fixed} FPs fixed, ${regressed} new FPs, ${broken} TPs broken, ${newCatch} new TPs`);

const netFP = fixed - regressed;
const netTP = newCatch - broken;

let verdict: string;
if (deltaF1 > 0.01) {
  verdict = `${C.g}✅ FREEZE v7 as baseline${C.r} — F1 improved by ${(deltaF1*100).toFixed(2)}pp`;
} else if (Math.abs(deltaF1) <= 0.01 && deltaP >= -0.02 && deltaR >= -0.01) {
  verdict = `${C.y}⚠️  CONDITIONAL: v7 is within tolerance${C.r} — review migration matrix before deciding`;
} else if (broken > 0 && newCatch === 0) {
  verdict = `${C.r2}❌ REJECT: v7 breaks ${broken} TP without catching new violations${C.r}`;
} else {
  verdict = `${C.r2}❌ REJECT: v7 regresses on key metrics${C.r} — needs refinement before baseline`;
}

console.log(`\n  ${verdict}\n`);

// ═══════════════════════════════════════════════════════
// Save Report
// ═══════════════════════════════════════════════════════

const reportPath = path.join(__dirname, "reports", "gold-benchmark-v5-v6-v7.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify({
  generated: new Date().toISOString(),
  summary: {
    totalSequences: allResults.length,
    v5: { ...allV5, ...computeMetrics(allV5) },
    v6: { ...allV6, ...computeMetrics(allV6) },
    v7: { ...allV7, ...computeMetrics(allV7) },
    delta_v6_to_v7: { deltaPrecision: deltaP, deltaRecall: deltaR, deltaF1: deltaF1, netFPFixed: netFP, netTPNew: netTP },
  },
  migration: aggMigration,
  repos: repoResults.map(r => ({
    repo: r.repo,
    totalLabeled: r.totalLabeled,
    cleanCount: r.cleanCount,
    violationCount: r.violationCount,
    v5: { ...r.v5, ...computeMetrics(r.v5) },
    v6: { ...r.v6, ...computeMetrics(r.v6) },
    v7: { ...r.v7, ...computeMetrics(r.v7) },
    migration: r.migration,
  })),
}, null, 2));
console.log(`  ${C.d}Report saved: ${reportPath}${C.r}\n`);
