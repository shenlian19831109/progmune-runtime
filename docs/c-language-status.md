# C Language Coverage Status

> **Status: RESEARCH ONLY — NOT production-ready**
> Last updated: 2026-08-26

## Summary

C language verification in Progmune is **annotation-driven protocol verification (Beta, since 3.7.6)**. After extensive investment (Two-Hump analysis, P0-P3 vocabulary injection, L3 cross-function experiment), unannotated auto-detection stayed at 0 TP on real code and the L3 experiment was terminated with data — but the annotation-driven route (IR extraction + `@progmune` comments + SSG state machine) reached production-path completion: gold 5/5 on real modules + 1 adoption case, ~2-3 annotations per protocol, 0 FP with precise violation localization. Unannotated auto-detection is out of scope; TLS-level misuse detection is still absent (old regex-route F1=16.5% historical baseline). L4 (CFG/dataflow/pointer resolution) remains a multi-year research problem and is not planned.

**2026-08-26 new route**: the merged multi-language IR registry (3.7.x IR-first) now includes C — `src/extract-ir-c.ts` produces `FunctionInfo` from `.c`/`.h` sources and registers as the third language in `LANGUAGE_EXTRACTORS` (`src/extract-project-ir.ts`). C projects passing through execute()/MCP/agent loop now get an ir.json and flow into IR-first sequence validation + the SSG state machine, instead of the pure regex fallback. Function names in C IR also enter the word-segment matching gate (project functions only). **This is IR extraction, not L4** — the L3/L4 conclusions below are unchanged.

### 2026-08-26 benchmark results (new route)

**Scale extraction** (`blind-benchmark/scan-protocol-c.ts`): extractIRC over the six vendored C repos — curl 4,229 / libssh 2,129 / nginx 3,199 / openssl 15,539 / nghttp2 992 / redis 5,723 functions in 0.3–5s each（**提取耗时**；函数数随 vendored 完整度/提取器版本/非生产表面过滤器变化——稳定指标是黄金函数恢复率）。**全扫描耗时**（含序列构建 + SSG 验证，cap 修复后）：libssh 21s / nginx 40s / redis 79s / openssl 222s（cap 前 openssl 15–25 分钟——P4.6 展开宽度爆炸产生单序列百万级调用，`buildCallSequences` 2,000 调用预算截断；截断是诚实的召回边界：超大序列尾部的违规不可见）。Gold-function recovery 97–100% (file::function aligned).

**Old gold (TLS-level misuse labels, regex-detector口径)**: direct-mode SSG validation flags 0/38 violation labels (R=0%) — the old labels are TLS/SSH/HTTP2/资源级误用; SSG has no TLS state machines (rule surface is app-level auth/db/file/payment). This is口径 difference, not capability loss. All-clean repos: openssl/nghttp2/redis 0 FP ✓; **nginx 3 FP** — `ngx_read_file` word-segment-mapped to `read_file` (C library-prefix wrappers like `ngx_*` collide with Strategy 2). Mitigation options: C prefix stripping (identifier-parser's C_PROJECT_PREFIXES) or stricter segment matching — engine-level change, deferred to avoid TS/Python drift.

**New app-level C gold** (`blind-benchmark/scan-protocol-c-app.ts`, mirrors Python blind v1 methodology): v2 = 11 clean (real fixtures + built-in file rules + annotated pay namespace) × 11 seeded violations (incl. helper-mediated style + per-namespace breakdown). **TP 11/11, FP 1, FN 0 → Precision 91.7% / Recall 100% / F1 95.7%**. The 1 FP is `do_logout` (logout on a caller-created session — cross-function window limitation, same class as Python blind T2×S5). Contrast: old regex route F1=16.5% on its own task — the new route makes C verifiable for app-level protocol lifecycles for the first time.

**Regression fixed during benchmarking**: the v2-style signature regex's return-type token loop backtracked exponentially on `name = ssh_userauth_kbdint_getname(...)`-style lines (44-char buffer → ~11s). Replaced with a candidate-iteration regex (skip keyword/type-name candidates; return type derived from the buffer prefix). libssh extraction: >15min (pathological) → 1.8s. Regression test in `src/extract-ir-c.test.ts`.

### 2026-08-27 precision fixes（真实语料 24 FP → 3 FP）

Two engine-level precision fixes, both evidence-driven from the real-world corpus:

1. **Strategy 1 normalized-form gating**: `ReadFile`/`WriteFile`/`DeleteFile` (Windows API) were matching `read_file`/`write_file`/`delete_file` via the NORMALIZED branch of the exact-name strategy (CamelCase → snake_case = rule name — 11/24 FPs). The normalized branch now requires the projectFunctions gate (same as the 3.7.1 word-segment gate): external API calls no longer bridge via name normalization; annotation bridging (ACLCheckAllPerm → acl_check_all_perm) is unaffected — annotated primitives are project functions by definition. Raw-name exact matching stays ungated.
2. **endState direct-call provenance**: 12/24 FPs were endState flags on nginx handlers where the file open comes from inlined helpers and the close lives in registered callbacks (pointer assignments — L3-invisible). `validateSequenceWithSSG` now takes `entryDirectCalls` (the entry's own calls, recorded by `buildCallSequences` as `CallSequence.directCalls`) and reports endState only when the acquiring call is a direct call of the entry. Helper-mediated acquisition is not attributed to the entry.

**Result**: real-world corpus 24 flags → **3 flags** (nginx 14→0, redis 0, libssh 1, openssl 2 — the 3 residual are word-segment matches on real project functions, i.e. the renamed-primitive bridging working as designed). Regression gates: Python blind v1.2 unchanged (64, timestamp-only diff); app-level C gold unchanged (**TP 11/FP 1/FN 0, F1=95.7%** — the `leak_file` endState TP survives since its open is a direct call); engine-related suites 120/120.

### 2026-08-27 annotation-driven demo v2 (`blind-benchmark/REALWORLD_C_V2.md`, `demo-real-c-redis/`)

Real redis 7.x ACL code (verbatim) + 3 `@progmune` annotations: **good flow APPROVED 85 / 0 FP; seeded missing-auth-check precisely flagged** (ACLCheckAllPerm in [UNAUTHENTICATED], required [AUTHENTICATED]). Annotation cost: ~3 per protocol. The demo forced out two engine fixes (zero-drift verified): (1) CamelCase annotation rules were unreachable by any matching strategy → merge now also registers the normalized snake_case form (additive); (2) annotation merge ran AFTER sequence building → annotated primitives with bodies were inlined away, their post states never applied → merge moved BEFORE `extractCallSequencesFromProject` (aligning the production engine with the blind harness semantics). Honest boundary notes: establish-as-assignment (`c->authenticated = 1`) invisible to the state machine (annotation defines inter-function ordering only); fixPath shows rule names, not real function names; single medium violation does not flip APPROVED under current `DECISION_THRESHOLDS` (separate threshold-layer topic).

### 2026-08-27 real-world validation v1 (`blind-benchmark/REALWORLD_C_V1.md`)

Production pipeline on 3 real repos (libssh/redis/nginx, vendored): **16 flags after surface filtering, all manually labeled FP — real-world labeled precision 0%**. Key findings: (1) exact-name matching fires 0 times on real C (library-specific naming — the "命名鸿沟" between synthetic gold and real code); (2) the 95.7% app-level gold F1 comes entirely from exact-name + annotations, so the viable production shape for C is **annotation-driven** (`/* @progmune(...) */`), not heuristic auto-detection; (3) FP sources: callback lifecycle endState (12), OS API keyword bridging (3), cross-function window (1); (4) extractor now skips non-production surface dirs (tests/examples/docs/scripts/deps/vendor/third_party + test_* filenames — Python extract_ir.py precedent), removing 65/79 pre-filter flags; C gold recovery zero drift (97/97/89/98/100/99). **Research label stays**; next steps: annotation-driven end-to-end demo, endState callback-awareness + keyword whitelist tightening (engine-level, gated on blind re-runs).

### 2026-08-28 gold 5/5 + regex-layer cleanup (`REALWORLD_C_V6.md`)

Production path complete: gold 4/5 = libssh callback dispatch (`demo-real-c-libssh-cb/` — real `samplesshd-cb.c` verbatim, `ssh_server_callbacks_struct` auth dispatch: 2 annotations, APPROVED 82, 0 FP, seeded missing-auth precisely caught); gold 5/5 = uftpd transfer authorization (real `do_RETR`/`do_STOR` + 2 annotations, second protocol on the adoption project: real code 0 SSG FP, `ftp_transfer_no_login` precisely caught, fixPath → `establish_login`). Annotation cost converges at ~2-3/protocol (6 independent measurements). **New gap G5**: the SSG state machine is per-namespace — built-in `check_resource_ownership` (data_integrity, pre=[AUTHENTICATED]) can never be satisfied because AUTHENTICATED lives in the auth namespace (rule dead in practice, zero references in src/tests). **Regex-layer noise cleaned**: `PLAINTEXT_AUTH_WITHOUT_TLS` language-gated away from C (evidence: 3 FP / 0 TP on libssh + uftpd — FTP/SSH are by-design plaintext at the app layer); SSH host-key rules stay language-agnostic (1 TP retained). Verification: 5 new regression tests, engine suites 83/83, Python blind v1.2 zero drift, C app gold F1=95.7% unchanged. Upgrade evaluation drafted — awaiting user decision.

### 2026-08-28 adoption case (`REALWORLD_C_V5.md`, `adoption-uftpd/`)

First independent adoption data point: **uftpd** (real small FTP/TFTP daemon, 3,176 lines — not a benchmark, not a demo). Baseline: 3 regex-layer FPs (PLAINTEXT_AUTH_WITHOUT_TLS on FTP — Web-rule mis-mapping, known class), SSG silent. Annotated (2 annotations): real code 0 SSG FP, seeded missing-auth precisely caught, cost 2/protocol. Real-world frictions logged: login primitives dispatched via function-pointer tables (L3 boundary — wrapper functions are the realistic annotation shape there); regex-layer noise is the dominant residual adoption friction (FTP getting Web-TLS FPs). Production-path status: gold 3/5 ✓, incubator milestone ✓, adoption 1/1 ✓ — upgrade review pending gold 5/5 + regex-layer cleanup decision.

### 2026-08-28 production-path progress (`REALWORLD_C_V4.md`)

Gold accumulation 3/5 (redis ACL / libssh client / libssh server — all precise catches + 0 FP); incubator milestone 1: first shared alias confirmed + migration proven at the matching layer (matchedCalls 2/2 on a second libssh project with no local aliases; violation-driving needs rules with invalidated pre-states — verify_password's pre UNAUTHENTICATED persists, see G4). Rule-surface gaps logged (G1 signature-verify vocabulary missing; G2 bare-POSIX lifecycle unbridgeable; G3 long-lived resources vs function-window model; G4 state-accumulation semantics — verify is reentrant and cannot drive violations; establish primitives can express invalidate explicitly). V3 finding #1 corrected (retry loops do NOT FP — empirically 0 violations). Adoption case (path step 3) awaits a real user C project.

### 2026-08-27 library-boundary demo v3 + mechanism (`REALWORLD_C_V3.md`, `demo-real-c-libssh/`)

Real libssh `authentication.c` verbatim + 1 alias (`ssh_userauth_password → verify_password`) + 1 annotation (`start_channel_session`): SSG layer 0 FP, seeded missing-auth precisely flagged; cost = 2 items/protocol. Two-layer mechanism per the positioning decision: project annotations (not transferable) + **library-boundary aliases** (transferable — the incubator fuel). Tooling: `scripts/c-annotate.js` (annotation scaffold), `scripts/c-alias-propose.js` (write-back proposal with human-confirm gate), shared registry `c-aliases.json` (confirmed entries loaded engine-wide, ships in the npm package). Findings: multi-mechanism auth retry loops need reentrant pre-states (state-machine semantic gap); fixPath reverse-mapping candidate. **Trap fix (DSH-flagged)**: `evaluateTrust` now auto-extracts IR for C (and Python) when ir.json is missing — previously annotations silently failed without a manual `extractProjectIR` write (TS/JS-only auto-extract); regression test locks it.

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
- Position C as **annotation-driven protocol verification (Beta)** — annotations (`/* @progmune(...) */`) + library-boundary aliases; unannotated auto-detection stays out of scope

### Do NOT
- Invest in L4 C analysis (CFG, dataflow, pointer resolution)
- Add more C-specific protocol rules (P0-P3 already broke the bootstrapping deadlock)
- Expect unannotated C auto-detection to find true positives (0 TP on real corpus)
- Position C as a fully supported language without the annotation-driven + Beta qualifiers

## Decision record

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-08-28 | **C 标签升级：研究 → 注解驱动协议验证（Beta）** | 生产级路径收官：金标 5/5（redis ACL / libssh 客户端/服务端/回调分发 / uftpd 传送授权）+ 采纳案例 1/1（uftpd）+ 标注成本收敛 ~2-3/协议 + 正则层噪声治理（3 FP → 0）。未注解自动检测仍不在范围（0 TP）；TLS 级覆盖仍无——能力边界如实标注。 |
| 2026-08-28 | 正则层 PLAINTEXT_AUTH_WITHOUT_TLS 对 C 语言门控 | 真实语料 3 FP / 0 TP（libssh 1 + uftpd 2——FTP/SSH 应用层本就明文）；SSH 主机密钥规则保留全语言（1 TP）。双零漂移验证（Python 盲测 v1.2 / C 金标 F1=95.7%）。 |
| 2026-08-27 | **C 产品定位：注解驱动协议验证（已拍板）** | 数据逼出来的决策：未注解真实代码自动检测 0 TP（精度修复后 3 FP 仍全 FP）；注解路径正确决策、~3 注解/协议。自动检测的两条桥（C 库别名注册表、方言解析器）均「投入不可控」，不排期。**孵化器前提（精化）**：只有**库边界别名**跨项目迁移（知识网络实验结论：库级别名迁移 ✓、项目包装函数不迁移）——注解驱动 = 把别名注册表变成用户顺手做的免费标注；孵化机制必须显式化（注解/别名落地即尝试回写共享 C 别名表 + 人工确认），不能等自然发生。注解体验是采纳生死线（脚手架：注释块模板生成 + 违规报告内联建议加注解）。金标扩量按库边界选模块（libssh userauth 回调分发最优）。季度对冲指标：C 库别名条目数增长（领先）+ 未注解检出率（滞后）。 |
| 2026-08-27 | 精度修复：Strategy 1 normalized 门控 + endState 直接调用溯源 | 真实语料 24 FP → 3 FP（-87.5%）；双回归门（Python 盲测 64 / C 金标 F1=95.7%）零漂移 |
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
