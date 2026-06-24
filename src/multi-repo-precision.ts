/**
 * P0: Multi-Repository SSG Precision Validation
 *
 * Runs SSG protocol extraction + precision measurement across
 * multiple real-world repositories. Generates a transparent,
 * reproducible precision report.
 *
 * Target repos: curl, nginx, redis, sqlite, libuv
 * (small → medium → large)
 *
 * Usage:
 *   npx ts-node src/multi-repo-precision.ts
 *   npx ts-node src/multi-repo-precision.ts --repos curl,redis
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";
import { extractIR } from "./extract-ir";
import { discoverRulesFromSequences } from "./ssg-precision";
import { validateSequenceWithSSG } from "./ssg-precision";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface RepoPrecisionResult {
  repo: string;
  size: "small" | "medium" | "large";
  linesOfCode: number;
  functionsExtracted: number;
  sequencesExtracted: number;
  rulesDiscovered: number;
  // Precision metrics (where ground truth available)
  precision?: {
    total: number;
    truePositive: number;
    falsePositive: number;
    trueNegative: number;
    falseNegative: number;
    precision: number;
    recall: number;
    f1: number;
  };
  // Protocol categories found
  protocolsFound: string[];
  // Known CVE patterns matched
  cvePatternsMatched: number;
  // Annotation status
  annotatedSamples: number;
  needsAnnotation: boolean;
  errors: string[];
}

export interface MultiRepoReport {
  generated: string;
  version: string;
  repos: RepoPrecisionResult[];
  summary: {
    totalRepos: number;
    reposWithPrecision: number;
    reposNeedingAnnotation: number;
    averageF1: number;
    totalFunctions: number;
    totalSequences: number;
    totalRules: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// Target Repos
// ═══════════════════════════════════════════════════════════════

interface RepoTarget {
  name: string;
  size: RepoPrecisionResult["size"];
  /** Path to local source. If not present, will attempt to extract from project-local test data */
  localPath?: string;
  /** Protocols we expect to find */
  expectedProtocols: string[];
}

// Default targets — local repos + external repos (auto-cloned)
const DEFAULT_TARGETS: RepoTarget[] = [
  {
    name: "progmune-self",
    size: "small",
    localPath: process.cwd(),
    expectedProtocols: ["extractIR", "validateAction", "emitCode", "recordSession", "checkLedgerConsistency"],
  },
  {
    name: "demo-xlike",
    size: "small",
    localPath: path.resolve(process.cwd(), "demo-xlike"),
    expectedProtocols: ["insertPost", "getRecentPosts", "deletePost", "validatePostContent", "initDatabase"],
  },
  // External precision-program repos (auto-cloned into benchmarks/)
  {
    name: "curl",
    size: "medium",
    localPath: path.resolve(process.cwd(), "benchmarks", "curl"),
    expectedProtocols: ["curl_easy_init", "curl_easy_perform", "curl_easy_cleanup", "curl_easy_setopt"],
  },
  {
    name: "nginx",
    size: "large",
    localPath: path.resolve(process.cwd(), "benchmarks", "nginx"),
    expectedProtocols: ["ngx_http_init_connection", "ngx_http_process_request", "ngx_http_finalize_request"],
  },
  {
    name: "redis",
    size: "medium",
    localPath: path.resolve(process.cwd(), "benchmarks", "redis"),
    expectedProtocols: ["createClient", "readQueryFromClient", "freeClient", "processCommand"],
  },
];

const EXTERNAL_REPOS: Record<string, { url: string; depth?: number }> = {
  curl: { url: "https://github.com/curl/curl.git", depth: 100 },
  nginx: { url: "https://github.com/nginx/nginx.git", depth: 100 },
  redis: { url: "https://github.com/redis/redis.git", depth: 100 },
};

/** Clone or pull an external repo into benchmarks/<name>/ */
function ensureRepo(name: string): string {
  const dir = path.resolve(process.cwd(), "benchmarks", name);
  if (fs.existsSync(path.join(dir, ".git"))) {
    console.error(`  ↻ Updating ${name}...`);
    try { execSync(`cd ${dir} && git pull --ff-only 2>/dev/null || true`, { stdio: "ignore", timeout: 30000 }); } catch { /* skip */ }
  } else {
    const cfg = EXTERNAL_REPOS[name];
    if (!cfg) throw new Error(`No clone URL for: ${name}`);
    console.error(`  ↓ Cloning ${name} (depth=${cfg.depth || 100})...`);
    const parent = path.dirname(dir);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    execSync(`git clone --depth=${cfg.depth || 100} ${cfg.url} ${dir}`, { stdio: "ignore", timeout: 120000 });
  }
  return dir;
}

// ═══════════════════════════════════════════════════════════════
// Engine
// ═══════════════════════════════════════════════════════════════

function countLinesOfCode(dir: string): number {
  let count = 0;
  try {
    const files = walkFiles(dir, [".ts", ".js", ".c", ".h", ".py"]);
    for (const f of files) {
      try { count += fs.readFileSync(f, "utf-8").split("\n").length; } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return count;
}

function walkFiles(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkFiles(full, exts));
      } else if (exts.some(e => entry.name.endsWith(e))) {
        results.push(full);
      }
    }
  } catch { /* skip */ }
  return results;
}

/** Extract call sequences from IR: group functions by file, build adjacency pairs */
function extractCallSequences(ir: any[]): string[][] {
  const sequences: string[][] = [];
  const funcNames = ir.map((f: any) => f.name);

  // Build sequences from IR: each protocol chain is a sequence
  // For functions with protocol annotations, extract the implied sequence
  for (const fn of ir) {
    if (fn.protocol) {
      const seq: string[] = [];
      if (fn.protocol.pre_states) seq.push(...fn.protocol.pre_states);
      seq.push(fn.name);
      if (fn.protocol.post_states) seq.push(...fn.protocol.post_states);
      if (seq.length >= 2) sequences.push(seq);
    }
  }

  // If no protocol annotations, build adjacency pairs from function names
  if (sequences.length === 0 && funcNames.length >= 2) {
    // Group by common prefixes (e.g., "open_", "close_", "read_", "write_")
    const groups = groupByPrefix(funcNames);
    for (const [, fns] of Object.entries(groups)) {
      if (fns.length >= 2) {
        sequences.push(fns);
      }
    }
  }

  // Fallback: create sequences from all function pairs in same file
  if (sequences.length === 0) {
    sequences.push(funcNames.slice(0, 10));
  }

  return sequences;
}

function groupByPrefix(names: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const name of names) {
    // Extract prefix: everything before the last underscore or verb
    const parts = name.split("_");
    const prefix = parts.length >= 2 ? parts.slice(0, -1).join("_") : name;
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push(name);
  }
  // Only keep groups with >= 2 members
  const result: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(groups)) {
    if (v.length >= 2) result[k] = v;
  }
  return result;
}

function runRepoPrecision(target: RepoTarget): RepoPrecisionResult {
  const errors: string[] = [];

  // Auto-clone external repos
  let dir = target.localPath || process.cwd();
  if (EXTERNAL_REPOS[target.name] && !fs.existsSync(path.join(dir, ".git"))) {
    try {
      dir = ensureRepo(target.name);
    } catch (e: any) {
      errors.push(`Clone failed: ${e.message}`);
    }
  }

  // 1. Count lines of code
  const loc = countLinesOfCode(dir);

  // 2. Extract IR
  let ir: any[] = [];
  try {
    ir = extractIR(dir);
  } catch (e: any) {
    errors.push(`IR extraction: ${e.message}`);
  }

  // 3. Extract call sequences
  const sequences = extractCallSequences(ir);

  // 4. Discover protocol rules
  let rulesDiscovered = 0;
  let protocolsFound: string[] = [];
  let cveMatched = 0;
  try {
    const cleanSeqs = sequences.filter(s => s.length >= 2);
    if (cleanSeqs.length > 0) {
      const { rules, nsInit } = discoverRulesFromSequences(cleanSeqs);
      rulesDiscovered = rules.size;
      protocolsFound = [...rules.keys()];

      // Check PLSB coverage: which known CVE patterns appear?
      const { PROTOCOL_WEAKNESS_TAXONOMY } = require("./plsb-benchmark");
      for (const t of PROTOCOL_WEAKNESS_TAXONOMY) {
        for (const seq of sequences) {
          const hasMatch = t.example_broken.some((step: string) =>
            seq.some((s: string) => s.toLowerCase().includes(step.toLowerCase()))
          );
          if (hasMatch) { cveMatched++; break; }
        }
      }
    }
  } catch (e: any) {
    errors.push(`Rule discovery: ${e.message}`);
  }

  // 5. Run precision (if we have both clean and violation-labeled sequences)
  let precision: RepoPrecisionResult["precision"] | undefined;
  let annotatedSamples = 0;
  let needsAnnotation = true;

  try {
    // Check for hand-labeled data
    const labelPath = path.join(dir, ".progmune_labels.json");
    if (fs.existsSync(labelPath)) {
      const labels = JSON.parse(fs.readFileSync(labelPath, "utf-8"));
      annotatedSamples = Object.keys(labels).length;

      // Run SSG precision with labels
      const { runSSGPrecisionBenchmark, discoverRulesFromSequences } = require("./ssg-precision");
      const labeledSeqs = sequences.map((calls, i) => ({ index: i, calls, functionName: calls[0] || `seq_${i}` }));
      const result = runSSGPrecisionBenchmark(labeledSeqs, labels);
      precision = {
        total: result.total,
        truePositive: result.truePositive,
        falsePositive: result.falsePositive,
        trueNegative: result.trueNegative,
        falseNegative: result.falseNegative,
        precision: result.precision,
        recall: result.recall,
        f1: result.f1,
      };
      needsAnnotation = result.total === 0;
    }
  } catch (e: any) {
    errors.push(`Precision benchmark: ${e.message}`);
  }

  return {
    repo: target.name,
    size: target.size,
    linesOfCode: loc,
    functionsExtracted: ir.length,
    sequencesExtracted: sequences.length,
    rulesDiscovered,
    precision,
    protocolsFound: protocolsFound.slice(0, 20),
    cvePatternsMatched: cveMatched,
    annotatedSamples,
    needsAnnotation,
    errors,
  };
}

// ═══════════════════════════════════════════════════════════════
// Report Generator
// ═══════════════════════════════════════════════════════════════

export function runMultiRepoPrecision(
  targets: RepoTarget[] = DEFAULT_TARGETS
): MultiRepoReport {
  const repos: RepoPrecisionResult[] = [];

  for (const target of targets) {
    console.error(`\n🔍 ${target.name} (${target.size})...`);
    const result = runRepoPrecision(target);
    repos.push(result);

    console.error(`  IR: ${result.functionsExtracted} functions`);
    console.error(`  Sequences: ${result.sequencesExtracted}`);
    console.error(`  Rules: ${result.rulesDiscovered}`);
    if (result.precision) {
      console.error(`  Precision: F1=${(result.precision.f1 * 100).toFixed(0)}% (P=${(result.precision.precision * 100).toFixed(0)}%, R=${(result.precision.recall * 100).toFixed(0)}%)`);
    }
    if (result.needsAnnotation) {
      console.error(`  ⚠️  Needs hand-labeling (${result.annotatedSamples} samples)`);
    }
    if (result.errors.length) {
      for (const e of result.errors) console.error(`  ❌ ${e}`);
    }
  }

  // Summary
  const reposWithPrecision = repos.filter(r => r.precision && r.precision.total > 0);
  const avgF1 = reposWithPrecision.length > 0
    ? reposWithPrecision.reduce((s, r) => s + (r.precision?.f1 || 0), 0) / reposWithPrecision.length
    : 0;

  return {
    generated: new Date().toISOString(),
    version: "1.0.0",
    repos,
    summary: {
      totalRepos: repos.length,
      reposWithPrecision: reposWithPrecision.length,
      reposNeedingAnnotation: repos.filter(r => r.needsAnnotation).length,
      averageF1: avgF1,
      totalFunctions: repos.reduce((s, r) => s + r.functionsExtracted, 0),
      totalSequences: repos.reduce((s, r) => s + r.sequencesExtracted, 0),
      totalRules: repos.reduce((s, r) => s + r.rulesDiscovered, 0),
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// Formatters
// ═══════════════════════════════════════════════════════════════

export function formatMultiRepoReportTerminal(report: MultiRepoReport): string {
  const lines: string[] = [];
  const C = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m" };

  lines.push("");
  lines.push(`${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
  lines.push(`${C.bold}${C.cyan}║${C.reset}  ${C.bold}Multi-Repo SSG Precision Report${C.reset}                                ${C.bold}${C.cyan}║${C.reset}`);
  lines.push(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════════╝${C.reset}`);
  lines.push("");
  lines.push(`  Generated: ${report.generated}`);
  lines.push(`  Repos:     ${report.summary.totalRepos} (${report.summary.reposWithPrecision} with precision data)`);
  lines.push(`  Functions: ${report.summary.totalFunctions}  |  Sequences: ${report.summary.totalSequences}  |  Rules: ${report.summary.totalRules}`);
  lines.push(`  Avg F1:    ${(report.summary.averageF1 * 100).toFixed(0)}%`);
  lines.push("");

  lines.push(`  ${C.dim}Repo             Size    LOC     Funcs   Seqs    Rules   F1      Precision  Recall  Status${C.reset}`);
  lines.push(`  ${C.dim}───────────────  ──────  ──────  ──────  ──────  ──────  ──────  ────────   ──────  ──────────${C.reset}`);

  for (const r of report.repos) {
    const f1Str = r.precision ? `${(r.precision.f1 * 100).toFixed(0)}%`.padStart(5) : "  N/A ";
    const pStr = r.precision ? `${(r.precision.precision * 100).toFixed(0)}%`.padStart(6) : "  N/A ";
    const rStr = r.precision ? `${(r.precision.recall * 100).toFixed(0)}%`.padStart(6) : "  N/A ";
    const status = r.precision ? `${C.green}MEASURED${C.reset}`
      : r.needsAnnotation ? `${C.yellow}NEEDS LABELS${C.reset}` : `${C.dim}NO DATA${C.reset}`;

    lines.push(`  ${r.repo.padEnd(15)}  ${r.size.padEnd(6)}  ${String(r.linesOfCode).padEnd(6)}  ${String(r.functionsExtracted).padEnd(6)}  ${String(r.sequencesExtracted).padEnd(6)}  ${String(r.rulesDiscovered).padEnd(6)}  ${f1Str}   ${pStr}    ${rStr}  ${status}`);
  }

  lines.push("");
  lines.push(`  ${C.yellow}⚠️  Repos marked "NEEDS LABELS" require hand-annotated ground truth for precision measurement.${C.reset}`);
  lines.push(`  ${C.dim}→ Create .progmune_labels.json in the repo root with format: {"0":"clean","1":"violation",...}${C.reset}`);
  lines.push("");

  if (report.summary.reposNeedingAnnotation > 0) {
    lines.push(`  ${C.bold}Next Steps:${C.reset}`);
    lines.push(`  1. Hand-label 20-50 call sequences per repo as "clean" or "violation"`);
    lines.push(`  2. Re-run this benchmark for full precision metrics`);
    lines.push(`  3. Add external repos: curl, nginx, redis, sqlite`);
    lines.push("");
  }

  return lines.join("\n");
}

export function exportMultiRepoReportJSON(report: MultiRepoReport, outputPath?: string): string {
  const json = JSON.stringify(report, null, 2);
  if (outputPath) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, json, "utf-8");
  }
  return json;
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

if (require.main === module) {
  const args = process.argv.slice(2);
  const reposArg = args.includes("--repos") ? args[args.indexOf("--repos") + 1] : null;
  const all = args.includes("--all");
  const localOnly = args.includes("--local");

  let targets = DEFAULT_TARGETS;
  if (reposArg) {
    const names = new Set(reposArg.split(","));
    targets = DEFAULT_TARGETS.filter(t => names.has(t.name));
  } else if (localOnly) {
    targets = DEFAULT_TARGETS.filter(t => !EXTERNAL_REPOS[t.name]);
  } else if (all) {
    // all targets including external
  } else {
    // default: local only (fast)
    targets = DEFAULT_TARGETS.filter(t => !EXTERNAL_REPOS[t.name]);
  }

  const report = runMultiRepoPrecision(targets);
  console.log(formatMultiRepoReportTerminal(report));

  // Write JSON report
  const outPath = "benchmarks/multi-repo-precision.json";
  exportMultiRepoReportJSON(report, outPath);
  console.error(`\n📁 Report saved: ${outPath}`);
}
