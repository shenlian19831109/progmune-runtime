/**
 * ═══════════════════════════════════════════════════════════════
 * ARCHIVED — L3 Cross-Function Resource Lifecycle Analysis
 * ═══════════════════════════════════════════════════════════════
 *
 * Status: TERMINATED (2026-08-03, Two-Hump Report)
 *
 * Same-file alloc/free pairing check via BFS call-graph traversal.
 * Analyzed full curl source (4,050 functions) and found only 5 actionable
 * violations out of 11 total. Mechanism is viable but yield is too low
 * to justify as a standalone feature.
 *
 * Root cause: C function pointer dispatch (ossl_close via cf->close_one())
 * makes most resource management patterns statically invisible without
 * L4-level pointer/CFG analysis.
 *
 * Decision: Do NOT invest further in L3 cross-function analysis.
 * Archived to src/experimental/ for reference. L4 is the real bottleneck
 * for C — and L4 is a multi-year research problem, not an engineering one.
 *
 * See: docs/two-hump-report.md §7
 *
 * Original header:
 * Phase 1: Experimental — curl openssl.c + redis server.c
 */

import * as fs from "fs";
import * as path from "path";

// ── Types ──

interface FuncInfo {
  name: string;
  file: string;
  calls: string[];
}

interface AllocSite {
  func: string;
  file: string;
  allocCall: string;
  allocType: string;
}

interface FreeSite {
  func: string;
  file: string;
  freeCall: string;
  allocType: string;
}

interface L3Violation {
  allocFunc: string;
  freeFunc: string | null;
  file: string;
  allocCall: string;
  allocType: string;
  reason: string;
  reachableFrees: string[];
}

// ── Known alloc/free pairs (C libraries) ──

interface AllocFreePair {
  type: string;
  allocPattern: RegExp;
  freePattern: RegExp;
}

const ALLOC_FREE_PAIRS: AllocFreePair[] = [
  // OpenSSL
  { type: "SSL_CTX", allocPattern: /\bSSL_CTX_new\b/, freePattern: /\bSSL_CTX_free\b/ },
  { type: "SSL", allocPattern: /\bSSL_new\b/, freePattern: /\bSSL_free\b/ },
  { type: "BIO", allocPattern: /\bBIO_new\b/, freePattern: /\bBIO_free\b/ },
  { type: "EVP_PKEY", allocPattern: /\bEVP_PKEY_new\b/, freePattern: /\bEVP_PKEY_free\b/ },
  // curl
  { type: "curl_easy", allocPattern: /\bcurl_easy_init\b/, freePattern: /\bcurl_easy_cleanup\b/ },
  { type: "curl_multi", allocPattern: /\bcurl_multi_init\b/, freePattern: /\bcurl_multi_cleanup\b/ },
  { type: "curl_slist", allocPattern: /\bcurl_slist_append\b/, freePattern: /\bcurl_slist_free_all\b/ },
  // nghttp2
  { type: "nghttp2_session", allocPattern: /\bnghttp2_session_(new|server_new|client_new)\b/, freePattern: /\bnghttp2_session_del\b/ },
  { type: "nghttp2_mem", allocPattern: /\bnghttp2_mem_(malloc|calloc|realloc)\b/, freePattern: /\bnghttp2_mem_free\b/ },
  // libssh
  { type: "ssh_session", allocPattern: /\bssh_(new|session_new)\b/, freePattern: /\bssh_free\b/ },
  { type: "ssh_string", allocPattern: /\bssh_string_(new|from_char)\b/, freePattern: /\bssh_string_(free|burn)\b/ },
  // redis
  { type: "sds", allocPattern: /\bsds(new|newlen|empty|dup)\b/, freePattern: /\bsds(free|clear)\b/ },
  { type: "zmalloc", allocPattern: /\bz(malloc|calloc|realloc|trymalloc)\b/, freePattern: /\bzfree\b/ },
  // nginx
  { type: "ngx_pool", allocPattern: /\bngx_(create_pool|palloc|pcalloc)\b/, freePattern: /\bngx_(destroy_pool|pfree)\b/ },
  { type: "ngx_array", allocPattern: /\bngx_(array_create|array_push)\b/, freePattern: /\bngx_array_destroy\b/ },
  // Apache
  { type: "apr_pool", allocPattern: /\bapr_p(alloc|calloc|create)\b/, freePattern: /\bapr_p(free|ool_destroy|ool_clear)\b/ },
  // Generic C
  { type: "malloc", allocPattern: /\b(malloc|calloc|realloc)\b/, freePattern: /\bfree\b/ },
];

// ── Call Graph ──

function buildCallGraph(funcs: FuncInfo[]): {
  callers: Map<string, string[]>;    // func → who calls it
  callees: Map<string, string[]>;    // func → who it calls
  funcFiles: Map<string, string>;    // func → file
} {
  const callers = new Map<string, string[]>();
  const callees = new Map<string, string[]>();
  const funcFiles = new Map<string, string>();

  for (const f of funcs) {
    funcFiles.set(f.name, f.file);
    if (!callees.has(f.name)) callees.set(f.name, []);
    callees.get(f.name)!.push(...f.calls);

    for (const c of f.calls) {
      if (!callers.has(c)) callers.set(c, []);
      callers.get(c)!.push(f.name);
    }
  }

  return { callers, callees, funcFiles };
}

// ── Path Finding (BFS from alloc function to any free function) ──

function canReach(
  start: string,
  targets: string[],
  callees: Map<string, string[]>,
  maxDepth: number = 5
): { reachable: boolean; path: string[] } {
  if (targets.includes(start)) return { reachable: true, path: [start] };

  const visited = new Set<string>();
  const queue: Array<{ func: string; path: string[] }> = [{ func: start, path: [start] }];
  visited.add(start);

  while (queue.length > 0) {
    const { func, path: currentPath } = queue.shift()!;
    if (currentPath.length > maxDepth) continue;

    const called = callees.get(func) || [];
    for (const c of called) {
      if (targets.includes(c)) {
        return { reachable: true, path: [...currentPath, c] };
      }
      if (!visited.has(c)) {
        visited.add(c);
        queue.push({ func: c, path: [...currentPath, c] });
      }
    }
  }

  return { reachable: false, path: [] };
}

// ── Main Analysis ──

export interface L3AnalysisResult {
  repo: string;
  totalFuncs: number;
  allocSites: number;
  freeSites: number;
  sameFilePairs: number;
  violations: L3Violation[];
}

export function analyzeL3(repo: string, sequences: FuncInfo[]): L3AnalysisResult {
  const { callees, funcFiles } = buildCallGraph(sequences);

  // Find alloc/free sites
  const allocSites: AllocSite[] = [];
  const freeSites: FreeSite[] = [];

  for (const func of sequences) {
    for (const call of func.calls) {
      for (const pair of ALLOC_FREE_PAIRS) {
        if (pair.allocPattern.test(call)) {
          allocSites.push({
            func: func.name,
            file: func.file,
            allocCall: call,
            allocType: pair.type,
          });
        }
        if (pair.freePattern.test(call)) {
          freeSites.push({
            func: func.name,
            file: func.file,
            freeCall: call,
            allocType: pair.type,
          });
        }
      }
    }
  }

  // Group by file
  const fileAllocs = new Map<string, AllocSite[]>();
  const fileFrees = new Map<string, FreeSite[]>();
  for (const a of allocSites) {
    if (!fileAllocs.has(a.file)) fileAllocs.set(a.file, []);
    fileAllocs.get(a.file)!.push(a);
  }
  for (const f of freeSites) {
    if (!fileFrees.has(f.file)) fileFrees.set(f.file, []);
    fileFrees.get(f.file)!.push(f);
  }

  // For each same-file alloc/free pair, check reachability
  const violations: L3Violation[] = [];
  let sameFilePairs = 0;

  for (const [file, allocs] of fileAllocs) {
    const frees = fileFrees.get(file) || [];
    if (frees.length === 0) continue;

    for (const alloc of allocs) {
      // Find matching free functions (same type)
      const matchingFrees = frees.filter(f => f.allocType === alloc.allocType);
      if (matchingFrees.length === 0) continue;

      sameFilePairs++;

      const matchingFreeFuncs = matchingFrees.map(f => f.func);
      const { reachable, path: foundPath } = canReach(alloc.func, matchingFreeFuncs, callees);

      if (!reachable) {
        violations.push({
          allocFunc: alloc.func,
          freeFunc: matchingFreeFuncs[0] || null,
          file,
          allocCall: alloc.allocCall,
          allocType: alloc.allocType,
          reason: foundPath.length > 0
            ? `path too deep (${foundPath.length} > 5)`
            : `no path from ${alloc.func} to any of [${matchingFreeFuncs.join(", ")}]`,
          reachableFrees: matchingFreeFuncs,
        });
      }
    }
  }

  return {
    repo,
    totalFuncs: sequences.length,
    allocSites: allocSites.length,
    freeSites: freeSites.length,
    sameFilePairs,
    violations,
  };
}

// ── CLI ──

export function runL3Experiment(): void {
  const BENCH_DIR = path.resolve(__dirname, "..", "benchmarks");

  // Try full IR first, fall back to sequence data
  for (const repo of ["curl"]) {
    const irFile = path.join(BENCH_DIR, repo, "ir.json");
    const seqFile = path.join(BENCH_DIR, `${repo}-sequences.json`);

    let seqs: FuncInfo[] = [];

    if (fs.existsSync(irFile)) {
      const data = JSON.parse(fs.readFileSync(irFile, "utf-8"));
      seqs = (data.functions || []).map((f: any) => ({
        name: f.name || "",
        file: f.file || "",
        calls: f.calls || [],
      }));
      console.error(`Loaded ${seqs.length} functions from ir.json`);
    } else if (fs.existsSync(seqFile)) {
      const data = JSON.parse(fs.readFileSync(seqFile, "utf-8"));
      seqs = (data.sequences || data).map((s: any) => ({
        name: s.function || "",
        file: s.file || "",
        calls: s.calls || [],
      }));
      console.error(`Loaded ${seqs.length} functions from sequences (no ir.json)`);
    } else {
      console.log(`${repo}: no data`);
      continue;
    }

    const result = analyzeL3(repo, seqs);

    console.log(`\n═══ L3 Analysis: ${repo} (FULL IR) ═══`);
    console.log(`  Functions: ${result.totalFuncs}`);
    console.log(`  Alloc sites: ${result.allocSites}`);
    console.log(`  Free sites: ${result.freeSites}`);
    console.log(`  Same-file pairs: ${result.sameFilePairs}`);
    console.log(`  Unreachable (violations): ${result.violations.length}`);

    // Show top files with violations
    const byFile = new Map<string, L3Violation[]>();
    for (const v of result.violations) {
      if (!byFile.has(v.file)) byFile.set(v.file, []);
      byFile.get(v.file)!.push(v);
    }
    const sortedFiles = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);

    console.log(`\n  Top files with L3 violations:`);
    for (const [file, viols] of sortedFiles.slice(0, 10)) {
      console.log(`    ${file}: ${viols.length} violations`);
      // Show most common alloc types
      const types = new Map<string, number>();
      for (const v of viols) {
        types.set(v.allocType, (types.get(v.allocType) || 0) + 1);
      }
      const topTypes = [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      console.log(`      types: ${topTypes.map(([t, c]) => `${t}(${c})`).join(", ")}`);
    }

    // Sample violations from top file
    if (sortedFiles.length > 0) {
      const [topFile, topViols] = sortedFiles[0];
      console.log(`\n  Sample violations (${topFile}):`);
      for (const v of topViols.slice(0, 5)) {
        const isKnownFP = /return|caller|library/i.test(v.reason);
        const verdict = isKnownFP ? "FP" : "?";
        console.log(`    [${verdict}] ${v.allocFunc} → ${v.allocCall} (${v.allocType})`);
        console.log(`           free: [${v.reachableFrees.slice(0, 3).join(", ")}] | ${v.reason}`);
      }
    }

    // Summary: potential TPs vs known FPs
    const potentialTPs = result.violations.filter(v => {
      // Heuristic: functions that allocate and return (not library constructors)
      return !/new$|init$|create$/.test(v.allocFunc) && v.reachableFrees.length <= 3;
    });

    console.log(`\n  Summary:`);
    console.log(`    Total violations: ${result.violations.length}`);
    console.log(`    Potential TPs (narrow free targets): ${potentialTPs.length}`);
    console.log(`    FP rate estimate: ${result.violations.length > 0 ? ((1 - potentialTPs.length / result.violations.length) * 100).toFixed(0) : 0}%`);
    console.log();
  }
}

// Run if called directly
if (require.main === module) {
  runL3Experiment();
}
