/**
 * FP Taxonomy Analyzer
 *
 * Classifies every false positive from a precision report into
 * root cause categories. This tells us WHY precision is low
 * before we attempt to fix anything.
 *
 * Usage:
 *   npx ts-node src/precision-analyze.ts benchmarks/curl
 */

import * as fs from "fs";
import * as path from "path";
import { detectResourceViolations } from "./resource-detector";

// ── FP Categories ──

type FPCategory =
  | "cross_function_cleanup"    // Resource released in another function
  | "allocator_return"           // Function allocates and returns to caller
  | "callback_ownership"         // Resource passed to callback, cleanup elsewhere
  | "state_inference_noise"      // Auto-discovered state rule overfits ordering
  | "noise_call"                 // Non-protocol call (logging, debug) in sequence
  | "protocol_extraction_error"  // Extracted wrong calls or wrong order
  | "unknown";

interface FPTaxonomy {
  category: FPCategory;
  count: number;
  pct: number;
  examples: string[];
  description: string;
}

// ── Classification Logic ──

function classifyFP(
  calls: string[],
  funcName: string,
  reason: string
): FPCategory {
  // 1. State inference noise: SSG auto-discovered rule rejected valid ordering
  //    Pattern: reason contains "requires [C0_S...] but state has [INIT,C0_S...]"
  if (reason.includes("requires [C") && reason.includes("but state has [")) {
    return "state_inference_noise";
  }

  // 2. Check if this is a resource lifecycle false positive
  const resourceVios = detectResourceViolations(calls);

  // 3. Allocator-return: function name suggests it's a factory/allocator
  const allocatorPatterns = /\b(create|alloc|new|init|open|dup|clone|copy|build|make)\w*\b/i;
  const isAllocator = allocatorPatterns.test(funcName);

  if (isAllocator && resourceVios.some(v => v.type === "missing_release")) {
    return "allocator_return";
  }

  // 4. Cross-function cleanup: resource acquired here, released elsewhere
  //    Pattern: has acquire calls + has no matching release in this function
  const hasAcquire = /\b(malloc|calloc|open|connect|SSL_new|BIO_new|Curl_open|ngx_.*_init|ngx_.*_create)\b/i;
  const hasRelease = /\b(free|close|disconnect|SSL_free|BIO_free|Curl_close|ngx_.*_free|ngx_.*_cleanup)\b/i;
  const callsStr = calls.join(" ");

  if (hasAcquire.test(callsStr) && !hasRelease.test(callsStr) && !isAllocator) {
    return "cross_function_cleanup";
  }

  // 5. Callback ownership: common async/event pattern
  const callbackPatterns = /\b(callback|cb_|_cb|handler|on_|_done|_complete|_finish)\b/i;
  if (callbackPatterns.test(funcName) || calls.some(c => callbackPatterns.test(c))) {
    return "callback_ownership";
  }

  // 6. Noise call: logging/debug/trace functions in the call list
  const noisePatterns = /\b(infof|failf|DEBUGF|DEBUGASSERT|log|trace|debug|print|dump|assert)\b/i;
  const noiseCount = calls.filter(c => noisePatterns.test(c)).length;
  if (noiseCount >= calls.length * 0.3) {
    return "noise_call";
  }

  // 7. Protocol extraction error: calls don't form a meaningful protocol sequence
  const protocolPatterns = /\b(init|open|connect|send|recv|read|write|close|free|cleanup|finish|done|stop|start)\b/i;
  const protocolCount = calls.filter(c => protocolPatterns.test(c)).length;
  if (protocolCount < calls.length * 0.3) {
    return "protocol_extraction_error";
  }

  return "unknown";
}

function classifyFN(
  calls: string[],
  funcName: string,
  reason: string
): FPCategory {
  // FN: human said violation, detector said clean
  // Why didn't the detector catch this?

  const callsStr = calls.join(" ");

  // State machine functions that are missing transitions
  const stateMachinePatterns = /\b(state|statemachine|_step|_phase)\w*\b/i;
  if (stateMachinePatterns.test(funcName)) {
    return "state_inference_noise"; // Detector didn't learn the state machine correctly
  }

  // Missing acquire before release
  const hasRelease = /\b(free|close|disconnect|SSL_free|BIO_free|cleanup|destroy)\b/i;
  const hasAcquire = /\b(malloc|open|connect|SSL_new|BIO_new|init|create)\b/i;
  if (hasRelease.test(callsStr) && !hasAcquire.test(callsStr)) {
    return "cross_function_cleanup"; // Release without acquire in same function
  }

  return "unknown";
}

// ── Main Analyzer ──

function analyze(repoPath: string) {
  const precFile = path.join(path.dirname(repoPath), `${path.basename(repoPath)}-precision.json`);
  if (!fs.existsSync(precFile)) {
    console.error(`❌ Precision report not found: ${precFile}`);
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(precFile, "utf-8"));
  const details = report.details || [];

  const fpCases = details.filter((d: any) => d.expected === "clean" && d.detected === "violation");
  const fnCases = details.filter((d: any) => d.expected === "violation" && d.detected === "clean");

  console.error(`\nAnalyzing ${report.total} samples: ${report.fp} FP, ${report.fn} FN`);

  // Classify FPs
  const fpByCategory = new Map<FPCategory, any[]>();
  for (const d of fpCases) {
    const cat = classifyFP(d.calls || [], d.calls?.[0] || "", d.reason || "");
    if (!fpByCategory.has(cat)) fpByCategory.set(cat, []);
    fpByCategory.get(cat)!.push(d);
  }

  // Classify FNs
  const fnByCategory = new Map<FPCategory, any[]>();
  for (const d of fnCases) {
    const cat = classifyFN(d.calls || [], d.calls?.[0] || "", d.reason || "");
    if (!fnByCategory.has(cat)) fnByCategory.set(cat, []);
    fnByCategory.get(cat)!.push(d);
  }

  // ═══ FP Taxonomy Report ═══

  const C = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m",
  };

  const CATEGORY_LABELS: Record<FPCategory, { label: string; desc: string; fix: string }> = {
    state_inference_noise: {
      label: "State inference noise",
      desc: "Auto-discovered SSG rules overfit to call order. Valid protocol sequences flagged because they don't match the learned adjacency pattern.",
      fix: "Replace auto-discovered rules with hand-written protocol definitions. Increase clean training sequences from 29 to 100+.",
    },
    cross_function_cleanup: {
      label: "Cross-function cleanup",
      desc: "Resource acquired in this function but released elsewhere (caller, callback, cleanup phase). Detector assumes acquire+release must be in same scope.",
      fix: "Model protocol lifecycle across function boundaries. Recognize that acquire in step1() may be released in cleanup().",
    },
    allocator_return: {
      label: "Allocator-return pattern",
      desc: "Function allocates resource and returns it to caller. Detector sees malloc without free and flags as leak — but the caller is responsible for cleanup.",
      fix: "Identify factory/allocator functions by name pattern. Exclude them from acquire-without-release checks.",
    },
    callback_ownership: {
      label: "Callback ownership",
      desc: "Resource passed to async callback. Ownership transfers — cleanup responsibility moves to callback or event handler.",
      fix: "Track resource ownership across callback boundaries. Recognize event-driven cleanup patterns.",
    },
    noise_call: {
      label: "Noise call in sequence",
      desc: "Logging, debug, or trace calls mixed into protocol sequences. These create false adjacency patterns in SSG rule discovery.",
      fix: "Filter noise calls (infof, failf, DEBUGF, etc.) before rule discovery.",
    },
    protocol_extraction_error: {
      label: "Protocol extraction error",
      desc: "Extracted calls don't form a real protocol sequence. C function call extraction picked up utility calls rather than protocol steps.",
      fix: "Improve C call extraction: filter utility functions, focus on named protocol operations.",
    },
    unknown: {
      label: "Unknown / Other",
      desc: "Doesn't match any known FP pattern. Requires manual inspection.",
      fix: "Manual review of individual cases.",
    },
  };

  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║${C.reset}  ${C.bold}FP Taxonomy Report — curl${C.reset}                                     ${C.bold}${C.cyan}║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log("");

  // FP Breakdown
  console.log(`${C.bold}False Positives (${fpCases.length}):${C.reset}\n`);

  const fpSorted = [...fpByCategory.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [cat, cases] of fpSorted) {
    const pct = ((cases.length / fpCases.length) * 100).toFixed(0);
    const bar = "█".repeat(Math.round(cases.length / fpCases.length * 30));
    const info = CATEGORY_LABELS[cat];
    console.log(`  ${C.red}${bar}${C.reset} ${pct}%  ${C.bold}${info.label}${C.reset} (${cases.length} cases)`);
    console.log(`  ${C.dim}${info.desc}${C.reset}`);
    // Show 2 examples
    for (const ex of cases.slice(0, 2)) {
      console.log(`  ${C.dim}  ex: ${(ex.calls || []).slice(0, 4).join(" → ")}${C.reset}`);
    }
    console.log("");
  }

  // FN Breakdown
  console.log(`${C.bold}False Negatives (${fnCases.length}):${C.reset}\n`);
  const fnSorted = [...fnByCategory.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [cat, cases] of fnSorted) {
    const pct = ((cases.length / fnCases.length) * 100).toFixed(0);
    const bar = "█".repeat(Math.round(cases.length / Math.max(1, fnCases.length) * 30));
    const info = CATEGORY_LABELS[cat];
    console.log(`  ${C.yellow}${bar}${C.reset} ${pct}%  ${C.bold}${info.label}${C.reset} (${cases.length} cases)`);
    for (const ex of cases.slice(0, 2)) {
      console.log(`  ${C.dim}  ex: ${(ex.calls || []).slice(0, 4).join(" → ")}${C.reset}`);
    }
    console.log("");
  }

  // Fix priority
  console.log(`${C.bold}Fix Priority:${C.reset}`);
  const topFP = fpSorted[0];
  if (topFP) {
    const info = CATEGORY_LABELS[topFP[0]];
    console.log(`  1. ${C.red}${info.label}${C.reset} — ${topFP[1].length} cases (${((topFP[1].length/fpCases.length)*100).toFixed(0)}% of FP)`);
    console.log(`     ${C.dim}→ ${info.fix}${C.reset}`);
  }
  if (fpSorted[1]) {
    const info = CATEGORY_LABELS[fpSorted[1][0]];
    console.log(`  2. ${info.label} — ${fpSorted[1][1].length} cases`);
  }
  console.log(`  3. Expand curl labels from ${report.total} to 100-150 samples`);
  console.log(`  4. Re-measure Precision after fixing top category`);
  console.log("");
}

// CLI
const args = process.argv.slice(2);
const repoPath = path.resolve(args.find(a => !a.startsWith("--")) || ".");
analyze(repoPath);
