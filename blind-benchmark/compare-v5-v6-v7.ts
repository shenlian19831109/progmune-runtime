/**
 * Progmune Detector v5/v6/v7 Comparison Benchmark
 *
 * Compares three Context strategies on the blind benchmark projects:
 *   v5 (Global):   All project calls pooled together
 *   v6 (Per-File): Each function checked against its own file's calls
 *   v7 (Function+Callers): Function checked against its own body + transitive callers
 *
 * Usage: npx ts-node blind-benchmark/compare-v5-v6-v7.ts
 */

import * as fs from "fs";
import * as path from "path";
import { extractIRWithTypes, FunctionInfo } from "../src/extract-ir";
import {
  detectSafeguardViolations,
  detectSafeguardViolationsV7,
  buildCallerMap,
  SafeguardViolation,
} from "../src/protocol-detector";

const GEN_DIR = path.resolve(__dirname, "generated");

interface VersionResult {
  version: string;
  violations: number;
  perFuncViolations: Array<{ func: string; file: string; count: number; rules: string[] }>;
  /** Total functions with violations */
  flaggedFuncs: number;
}

interface ProjectComparison {
  project: string;
  files: number;
  functions: number;
  allCalls: string[];
  /** v5: global context */
  v5: VersionResult;
  /** v6: per-file context (each function + its same-file neighbors) */
  v6: VersionResult;
  /** v7: per-function + caller chain context */
  v7: VersionResult;
}

/**
 * v6 simulation: per-file context.
 * Groups functions by file, then checks each function against all calls IN THAT FILE.
 *
 * Key behavior: if verifySession() exists ANYWHERE in the same file,
 * the function is "protected" (v6 doesn't flag it).
 * But if it's in a DIFFERENT file (auth.ts vs notes.ts), v6 flags it as missing auth.
 */
function scanV6PerFile(funcs: FunctionInfo[]): VersionResult {
  // Group functions by file
  const fileGroups = new Map<string, FunctionInfo[]>();
  for (const f of funcs) {
    if (!fileGroups.has(f.file)) fileGroups.set(f.file, []);
    fileGroups.get(f.file)!.push(f);
  }

  const perFuncViolations: VersionResult["perFuncViolations"] = [];
  let totalViolations = 0;
  let flaggedFuncs = 0;

  for (const [file, fileFuncs] of fileGroups) {
    // All calls within this file — this is v6's "file context"
    const fileCalls = [...new Set(fileFuncs.flatMap(f => f.calls || []))];

    for (const f of fileFuncs) {
      // v6: merge function's own calls WITH file-level calls as safeguard context.
      // This simulates "只看当前文件" — if the safeguard is in the same file, it's satisfied.
      const mergedCalls = [...new Set([...fileCalls, ...(f.calls || [])])];
      const vios = detectSafeguardViolations(mergedCalls, f.name);

      if (vios.length > 0) {
        perFuncViolations.push({
          func: f.name,
          file: path.basename(file),
          count: vios.length,
          rules: vios.map(v => v.rule),
        });
        totalViolations += vios.length;
        flaggedFuncs++;
      }
    }
  }

  return { version: "v6 (per-file)", violations: totalViolations, perFuncViolations, flaggedFuncs };
}

/**
 * v7: per-function + caller chain context + file context.
 * Trigger: function's own body only.
 * Safeguard: own → same-file → caller chain.
 */
function scanV7FunctionContext(
  funcs: FunctionInfo[],
  callerMap: Map<string, string[]>,
  funcCalls: Map<string, Set<string>>,
  fileCalls: Map<string, Set<string>>,
  funcFile: Map<string, string>
): VersionResult {
  const perFuncViolations: VersionResult["perFuncViolations"] = [];
  let totalViolations = 0;
  let flaggedFuncs = 0;

  for (const f of funcs) {
    const vios = detectSafeguardViolationsV7(
      f.calls || [],
      f.name,
      callerMap,
      funcCalls,
      fileCalls,
      funcFile,
    );

    if (vios.length > 0) {
      perFuncViolations.push({
        func: f.name,
        file: path.basename(f.file),
        count: vios.length,
        rules: vios.map(v => v.rule),
      });
      totalViolations += vios.length;
      flaggedFuncs++;
    }
  }

  return { version: "v7 (func+callers)", violations: totalViolations, perFuncViolations, flaggedFuncs };
}

/**
 * Diffs two version results: which violations did v6 flag but v7 suppressed?
 */
function diffVersions(vOld: VersionResult, vNew: VersionResult): Array<{ func: string; file: string; rules: string[]; reason: string }> {
  const oldMap = new Map(vOld.perFuncViolations.map(f => [f.func, f]));
  const newMap = new Map(vNew.perFuncViolations.map(f => [f.func, f]));

  const suppressed: Array<{ func: string; file: string; rules: string[]; reason: string }> = [];

  for (const [funcName, oldV] of oldMap) {
    const newV = newMap.get(funcName);
    if (!newV || newV.count < oldV.count) {
      const suppressedRules = newV
        ? oldV.rules.filter(r => !newV.rules.includes(r))
        : oldV.rules;
      suppressed.push({
        func: funcName,
        file: oldV.file,
        rules: suppressedRules,
        reason: "Caller chain provides safeguard",
      });
    }
  }

  return suppressed;
}

// ── Main ──

const projects = fs.readdirSync(GEN_DIR).filter(d => {
  const p = path.join(GEN_DIR, d);
  return fs.statSync(p).isDirectory() && !d.startsWith(".") && fs.existsSync(path.join(p, "tsconfig.json"));
});

console.log("╔══════════════════════════════════════════════════════════════════════╗");
console.log("║   Detector v5/v6/v7 Comparison — Context Strategy Benchmark          ║");
console.log("╚══════════════════════════════════════════════════════════════════════╝\n");

const comparisons: ProjectComparison[] = [];

for (const proj of projects) {
  process.stdout.write(`  Scanning ${proj}... `);
  const dir = path.join(GEN_DIR, proj);
  const ir = extractIRWithTypes(dir);
  const funcs = ir.functions.filter(f => !f.external);
  const allCalls = [...new Set(funcs.flatMap(f => f.calls || []))];

  // Build caller map + func calls for v7
  const callerMap = buildCallerMap(funcs);
  const funcCalls = new Map<string, Set<string>>();
  const funcFile = new Map<string, string>();
  for (const f of funcs) {
    funcCalls.set(f.name, new Set(f.calls || []));
    funcFile.set(f.name, f.file);
  }

  // Build file-level call sets for v7's file context
  const fileCallsMap = new Map<string, Set<string>>();
  for (const f of funcs) {
    if (!fileCallsMap.has(f.file)) fileCallsMap.set(f.file, new Set());
    const fc = fileCallsMap.get(f.file)!;
    for (const c of (f.calls || [])) fc.add(c);
  }

  // v5: Global context
  const v5Vios = detectSafeguardViolations(allCalls);
  const v5: VersionResult = {
    version: "v5 (global)",
    violations: v5Vios.length,
    perFuncViolations: v5Vios.map(v => ({ func: "(global)", file: "-", count: 1, rules: [v.rule] })),
    flaggedFuncs: v5Vios.length > 0 ? 1 : 0,
  };

  // v6: Per-file context
  const v6 = scanV6PerFile(funcs);

  // v7: Per-function + caller chain + file context
  const v7 = scanV7FunctionContext(funcs, callerMap, funcCalls, fileCallsMap, funcFile);

  // Diff: v6→v7 suppressions
  const suppressed = diffVersions(v6, v7);

  const comp: ProjectComparison = {
    project: proj, files: [...new Set(funcs.map(f => f.file))].length,
    functions: funcs.length, allCalls, v5, v6, v7,
  };
  comparisons.push(comp);

  const v5Count = v5.violations;
  const v6Count = v6.violations;
  const v7Count = v7.violations;
  const arrow = v7Count < v6Count ? `↓${v6Count - v7Count}` : v7Count > v6Count ? `↑${v7Count - v6Count}` : "=";
  console.log(`${funcs.length}f ${allCalls.length}calls | v5:${v5Count} v6:${v6Count} v7:${v7Count} (${arrow}) ${suppressed.length > 0 ? `suppressed ${suppressed.length} funcs` : ""}`);
}

// ── Aggregate Summary ──
console.log("\n╔══════════════════════════════════════════════════════════════════════╗");
console.log("║   Aggregate Comparison                                                ║");
console.log("╚══════════════════════════════════════════════════════════════════════╝\n");

const totalV5 = comparisons.reduce((s, c) => s + c.v5.violations, 0);
const totalV6 = comparisons.reduce((s, c) => s + c.v6.violations, 0);
const totalV7 = comparisons.reduce((s, c) => s + c.v7.violations, 0);
const totalFuncs = comparisons.reduce((s, c) => s + c.functions, 0);

console.log(`  Total functions: ${totalFuncs}`);
console.log(`  Total projects:  ${comparisons.length}`);
console.log("");
console.log("  ┌─────────────────────────────────────────────────────┐");
console.log("  │ Version   │ Context           │ Violations  │ Δv6   │");
console.log("  ├─────────────────────────────────────────────────────┤");
console.log(`  │ v5        │ global (project)  │ ${String(totalV5).padStart(9)}  │       │`);
console.log(`  │ v6        │ per-file          │ ${String(totalV6).padStart(9)}  │  --   │`);
console.log(`  │ v7        │ func + callers    │ ${String(totalV7).padStart(9)}  │ ${String(totalV7 - totalV6).padStart(4)}  │`);
console.log("  └─────────────────────────────────────────────────────┘");

const fpReduction = totalV6 > 0 ? ((totalV6 - totalV7) / totalV6 * 100).toFixed(1) : "0";
console.log(`\n  v6→v7 FP reduction: ${fpReduction}% (${totalV6 - totalV7} suppressions)`);
console.log(`  v7/v6 ratio:        ${totalV6 > 0 ? (totalV7 / totalV6 * 100).toFixed(1) : "N/A"}%`);

// ── Suppression Details ──
console.log("\n── Suppression Details (v6 flagged but v7 suppressed) ──\n");

let totalSuppressed = 0;
for (const c of comparisons) {
  const suppressed = diffVersions(c.v6, c.v7);
  if (suppressed.length === 0) continue;
  totalSuppressed += suppressed.length;
  console.log(`  ▸ ${c.project} (${suppressed.length} functions suppressed):`);
  for (const s of suppressed.slice(0, 5)) {
    console.log(`      ${s.func} (${s.file}): ${s.rules.join(", ")}`);
    console.log(`        → ${s.reason}`);
  }
  if (suppressed.length > 5) console.log(`      ... and ${suppressed.length - 5} more`);
}

console.log(`\n  Total functions with suppressed violations: ${totalSuppressed}`);

// ── Per-Project Table ──
console.log("\n── Per-Project Breakdown ──\n");
console.log("  Project          Funcs   v5      v6      v7      Δ(v6→v7)");
console.log("  ───────          ─────   ──      ──      ──      ────────");
for (const c of comparisons) {
  const delta = c.v6.violations - c.v7.violations;
  const deltaStr = delta > 0 ? `-${delta}` : delta < 0 ? `+${Math.abs(delta)}` : "0";
  console.log(`  ${c.project.padEnd(16)} ${String(c.functions).padStart(5)}   ${String(c.v5.violations).padStart(5)}   ${String(c.v6.violations).padStart(5)}   ${String(c.v7.violations).padStart(5)}   ${deltaStr.padStart(7)}`);
}

// ── Save Report ──
const report = {
  generated: new Date().toISOString(),
  description: "v5/v6/v7 Context Strategy Comparison — Detector v7 uses per-function + caller chain context",
  summary: { totalFunctions: totalFuncs, totalProjects: comparisons.length, v5Violations: totalV5, v6Violations: totalV6, v7Violations: totalV7, fpReductionPct: parseFloat(fpReduction), suppressedFunctions: totalSuppressed },
  projects: comparisons,
};

const reportPath = path.join(__dirname, "reports", "v5-v6-v7-comparison.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\n  Report saved: ${reportPath}\n`);
