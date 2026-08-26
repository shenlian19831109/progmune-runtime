# C Language Coverage Status

> **Status: RESEARCH ONLY — NOT production-ready**
> Last updated: 2026-08-26

## Summary

C language verification in Progmune is a **research project**, not a product feature. After extensive investment (Two-Hump analysis, P0-P3 vocabulary injection, L3 cross-function experiment), the overall C F1 remains at 16.5%. The L3 experiment was terminated with data. L4 (CFG/dataflow/pointer resolution) is the real bottleneck and is a multi-year research problem.

**2026-08-26 new route**: the merged multi-language IR registry (3.7.x IR-first) now includes C — `src/extract-ir-c.ts` produces `FunctionInfo` from `.c`/`.h` sources and registers as the third language in `LANGUAGE_EXTRACTORS` (`src/extract-project-ir.ts`). C projects passing through execute()/MCP/agent loop now get an ir.json and flow into IR-first sequence validation + the SSG state machine, instead of the pure regex fallback. Function names in C IR also enter the word-segment matching gate (project functions only). **This is IR extraction, not L4** — the L3/L4 conclusions below are unchanged.

### 2026-08-26 benchmark results (new route)

**Scale extraction** (`blind-benchmark/scan-protocol-c.ts`): extractIRC over the six vendored C repos — curl 4,192 / libssh 3,689 / nginx 2,970 / openssl 14,394 / nghttp2 1,274 / redis 9,590 functions in 0.8–8.5s each; 81–99% of the 100 gold functions per repo recovered (file::function aligned).

**Old gold (TLS-level misuse labels, regex-detector口径)**: direct-mode SSG validation flags 0/38 violation labels (R=0%) — the old labels are TLS/SSH/HTTP2/资源级误用; SSG has no TLS state machines (rule surface is app-level auth/db/file/payment). This is口径 difference, not capability loss. All-clean repos: openssl/nghttp2/redis 0 FP ✓; **nginx 3 FP** — `ngx_read_file` word-segment-mapped to `read_file` (C library-prefix wrappers like `ngx_*` collide with Strategy 2). Mitigation options: C prefix stripping (identifier-parser's C_PROJECT_PREFIXES) or stricter segment matching — engine-level change, deferred to avoid TS/Python drift.

**New app-level C gold** (`blind-benchmark/scan-protocol-c-app.ts`, mirrors Python blind v1 methodology): v2 = 11 clean (real fixtures + built-in file rules + annotated pay namespace) × 11 seeded violations (incl. helper-mediated style + per-namespace breakdown). **TP 11/11, FP 1, FN 0 → Precision 91.7% / Recall 100% / F1 95.7%**. The 1 FP is `do_logout` (logout on a caller-created session — cross-function window limitation, same class as Python blind T2×S5). Contrast: old regex route F1=16.5% on its own task — the new route makes C verifiable for app-level protocol lifecycles for the first time.

**Regression fixed during benchmarking**: the v2-style signature regex's return-type token loop backtracked exponentially on `name = ssh_userauth_kbdint_getname(...)`-style lines (44-char buffer → ~11s). Replaced with a candidate-iteration regex (skip keyword/type-name candidates; return type derived from the buffer prefix). libssh extraction: >15min (pathological) → 1.8s. Regression test in `src/extract-ir-c.test.ts`.

### Known systematic risk: C prefix wrappers vs word-segment matching

The 3.7.1 word-segment gate (Strategy 2 in `ssg-bridge.ts`) opens for **project functions**. C library-style prefix naming (`ngx_read_file`, `Curl_*`, `SSL_*`) is pervasive in real repos, and segment matching ("every rule word appears as a call word") maps e.g. `ngx_read_file` → `read_file` — producing FPs when the wrapper's sequence window doesn't include the open step (nginx: 3 FP on 50 gold sequences; openssl/nghttp2/redis clean). This is NOT nginx-specific — it is a systematic collision between C's prefix-naming convention and the segment-matching heuristic.

**Proposed mitigations (engine-level, deferred — any change here risks TS/Python gold drift and needs blind re-runs):**
1. Strip known C library prefixes (`ngx_`, `Curl_`, `curl_`, `SSL_`, `ossl_`, `mbedtls_`, `EVP_` — cf. `src/identifier-parser.ts` `C_PROJECT_PREFIXES`) from the call name before segment matching, C-scoped (gate already receives project functions; prefix-stripped names would be matched but require the stripped form to still contain all rule words).
2. Require the rule words to appear as a **contiguous** run of segments (ngx_read_file: read+file contiguous → still matches; needs (1) to actually fix this case).
3. C-scoped gate exclusion: don't include C names whose file is a library/prefix-heavy file — too coarse.

**Decision**: leave as-is for 3.7.4 (recorded FPs), schedule mitigation for the next C iteration with mandatory Python blind v1.2 + TS blind re-runs.

### Review fixes (2026-08-27, user review round)

- **detect/extract 口径一致**: `hasSourceFiles` SKIP_DIRS += `"benchmarks"` (repo self-host no longer mis-detects C via vendored benchmark repos; test added).
- **`#if 0` dead-block stripping**: `stripDeadConditionalBlocks` runs before all passes — dead regions (unbalanced braces) no longer corrupt body counting or spawn phantom functions (openssl-scale real risk). Only bare `#if 0` enters a dead region; `#if 0 || X` treated as active (not evaluated). Tests added.
- **`#`-line swallow fix**: a top-level `#endif\nvoid f() {...}` buffer previously swallowed the following function (the `#` buffer was skipped whole) — now only the directive line is skipped. This recovered hundreds of functions per repo (e.g. openssl 14,394 → 15,896) and lifted gold-function recovery to 89–100%.
- **Same-TU (file) call binding**: `buildCallSequences` resolves calls to same-file definitions first (cross-file same-name `static` functions no longer last-wins mis-bind; entry detection is file-scoped). Python blind v1.2 re-run: zero drift (64 violations, report byte-identical modulo timestamp). Unit tests in `src/call-sequence.test.ts`.
- **Duplicate calls preserved**: extractor dedup removed — repeated calls are semantically significant for state machines (double close / repeated logout); aligns C with TS/Python extractors. Enabled the `double_close` gold case.
- **`isCProject` removed** (dead code — production path uses `hasSourceFiles`).
- **App-level gold v2** (`scan-protocol-c-app.ts`): 11 clean × 11 violations (helper-mediated style + per-namespace breakdown). **TP 11/11, FP 1, FN 0 → P=91.7% / R=100% / F1=95.7%** (the 1 FP = `do_logout` cross-function window limitation).

## What works in C

| Capability | Status | Evidence |
|-----------|--------|----------|
| IR extraction (L1 → structured IR) | ✅ New (2026-08-26) | `src/extract-ir-c.ts`: signatures (multi-line, static/inline/`__attribute__`, pointer/array/function-pointer params), call lists (member calls yield the token before `(`: `cf->close_one()` → `close_one`; `goto_<label>` synthesis), `@progmune`/`@protocol` annotations + doc tags from comment blocks, exported = non-static, `external: false`, tags `["c"]` |
| Regex-based protocol detection | ✅ Working | Matches C library function names (SSL_*, curl_*, nghttp2_*, etc.) |
| Precision measurement | ✅ Working | Gold benchmarks for curl, libssh, nginx, redis |
| FP elimination (safeguard rules) | ✅ Working | excludePatterns + languages architecture |
| L1 (lexical/regex) detection | ✅ 82.7% of findings | 6,398 C functions detected |

## What does NOT work in C

| Capability | Status | Root cause |
|-----------|--------|-----------|
| Overall F1 | ❌ 16.5% | P=15.2%, R=50.0% on gold benchmark (historical baseline, unchanged by IR extraction) |
| L2 (control flow) | ❌ ~0% | Missing C identifier parser (macros, typedefs, function pointers) |
| L3 (cross-function) | ❌ Terminated | Function pointer dispatch (cf->close_one()) makes analysis statically invisible |
| L4 (semantic/state machine) | ❌ 0% | Requires CFG + dataflow + pointer analysis (compiler-level work) |
| Business logic rules | ❌ N/A | C network libraries don't contain payment/registration/session logic |

## IR extractor limitations (new route, as extracted)

- **Function-pointer dispatch is statically invisible**: `cf->close_one()` yields the call name `close_one`, but the callee is not resolvable — the L3 bottleneck is unchanged.
- **Macros and K&R definitions are not parsed**; C++ constructs out of scope.
- **Annotations come from comment blocks** (C has no decorators): `/* @progmune(namespace="auth", pre=["A"], post=["B"]) */` or `// @progmune(...)` above the definition, plus `@purpose`/`@tags`/`@requires`/`@produces`/`@useWhen`/`@inputs`/`@outputs` doc tags — mirror of the Python decorator syntax.
- **No dataflow / pointer / CFG analysis** — the extractor is lexical; L4 conclusions unchanged.
- Vendored `benchmarks/` is skipped by the extractor's walk (self-host guard).

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
| 2026-08-26 | C IR extraction merged via registry (`src/extract-ir-c.ts`) | 3.7.x IR-first route: C enters the merged FunctionInfo list + sequence validation. IR extraction ≠ L4 — L3/L4 conclusions unchanged. |
| 2026-08-26 | App-level C gold: P=87.5% / R=100% / F1=93.3% | New route makes C verifiable for app-level protocols (auth/db/file/pay); old TLS-level gold R=0% is口径差异 (SSG has no TLS rules). nginx word-segment FPs deferred. |
| 2026-08-03 | L3 experiment terminated | curl analysis: 4,050 functions → 5 actionable violations. Function pointer dispatch blocks further progress. |
| 2026-08-03 | C downgraded to "research" | Overall F1=16.5% after P0-P3 injection. L4 is multi-year research. |
| 2026-07-24 | C F1 target set to 55% | Development plan Phase 2. Now deferred indefinitely. |

## Related documents

- [Two-Hump Report](two-hump-report.md) — Gukov framework analysis of C detection distribution
- [P0-P3 Final Report](p0-p3-final-report.md) — Rule vocabulary injection results
- [Coverage Matrix](coverage-matrix-en.md) — Protocol × Language × Framework coverage
- [Development Plan](development-plan.md) — 3-phase roadmap
