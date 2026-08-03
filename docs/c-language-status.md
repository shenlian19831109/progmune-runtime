# C Language Coverage Status

> **Status: RESEARCH ONLY — NOT production-ready**
> Last updated: 2026-08-03

## Summary

C language verification in Progmune is a **research project**, not a product feature. After extensive investment (Two-Hump analysis, P0-P3 vocabulary injection, L3 cross-function experiment), the overall C F1 remains at 16.5%. The L3 experiment was terminated with data. L4 (CFG/dataflow/pointer resolution) is the real bottleneck and is a multi-year research problem.

## What works in C

| Capability | Status | Evidence |
|-----------|--------|----------|
| Regex-based protocol detection | ✅ Working | Matches C library function names (SSL_*, curl_*, nghttp2_*, etc.) |
| Precision measurement | ✅ Working | Gold benchmarks for curl, libssh, nginx, redis |
| FP elimination (safeguard rules) | ✅ Working | excludePatterns + languages architecture |
| L1 (lexical/regex) detection | ✅ 82.7% of findings | 6,398 C functions detected |

## What does NOT work in C

| Capability | Status | Root cause |
|-----------|--------|-----------|
| Overall F1 | ❌ 16.5% | P=15.2%, R=50.0% on gold benchmark |
| L2 (control flow) | ❌ ~0% | Missing C identifier parser (macros, typedefs, function pointers) |
| L3 (cross-function) | ❌ Terminated | Function pointer dispatch (cf->close_one()) makes analysis statically invisible |
| L4 (semantic/state machine) | ❌ 0% | Requires CFG + dataflow + pointer analysis (compiler-level work) |
| Business logic rules | ❌ N/A | C network libraries don't contain payment/registration/session logic |

## C-specific modules in the codebase

These modules are C-specific or C-heavy. They should NOT be modified without understanding the Two-Hump Report and L3 experiment conclusions.

| Module | Purpose | Status |
|--------|---------|--------|
| `src/precision-label-c.ts` | C precision labeling | Research tool |
| `src/precision-report-c.ts` | C precision reporting | Research tool |
| `src/multi-repo-precision.ts` | Cross-repo precision (includes C) | Benchmark tool |
| `src/cross-repo-precision.ts` | Per-repo precision (includes C) | Benchmark tool |
| `src/experimental/l3-cross-function.ts` | L3 cross-function analysis | **ARCHIVED** |
| `benchmarks/{curl,libssh,nginx,openssl,nghttp2,apache,redis}/` | Vendored C repos for benchmarking | Gitignored, generate via scripts |
| `src/protocol-detector.ts` (PROTOCOLS) | Regex patterns include C function names | Active, but patterns are \w*-based (language-agnostic) |

## What to do (and NOT do) with C

### Do
- Use C benchmarks to **validate that TS changes don't regress** (C repos as canary)
- Maintain `excludePatterns` to prevent C false positives from polluting TS results
- Use the `languages` field on safeguard rules to exclude C where appropriate

### Do NOT
- Invest in L4 C analysis (CFG, dataflow, pointer resolution)
- Add more C-specific protocol rules (P0-P3 already broke the bootstrapping deadlock)
- Expect C F1 to improve without L4 capabilities
- List C as a "supported" language in product materials

## Decision record

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-08-03 | L3 experiment terminated | curl analysis: 4,050 functions → 5 actionable violations. Function pointer dispatch blocks further progress. |
| 2026-08-03 | C downgraded to "research" | Overall F1=16.5% after P0-P3 injection. L4 is multi-year research. |
| 2026-07-24 | C F1 target set to 55% | Development plan Phase 2. Now deferred indefinitely. |

## Related documents

- [Two-Hump Report](two-hump-report.md) — Gukov framework analysis of C detection distribution
- [P0-P3 Final Report](p0-p3-final-report.md) — Rule vocabulary injection results
- [Coverage Matrix](coverage-matrix.md) — Protocol × Language × Framework coverage
- [Development Plan](development-plan.md) — 3-phase roadmap
