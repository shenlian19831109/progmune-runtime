# Real-World Python Validation v1 — 2026-08-16

**Corpus:** flask, fastapi, redis-py, requests (shallow clones, production source only)
**Pipeline:** `extractIRPython` → `detectSafeguardViolations(language="python")`
**Tooling:** `blind-benchmark/scan-real-python.ts` → `reports/real-python-scan.json`

## Headline

The Python detector transfers perfectly to the synthetic benchmark (recall 100%,
precision 100%), but on real library/framework code it is **overwhelmingly noisy** —
nearly all detections are internal helpers, not vulnerabilities. The rules are
application-surface rules; libraries are the wrong corpus. This validation's value is
the infrastructure fixes it forced and the precise diagnosis of what must change next.

## Numbers

| Stage | Violating functions | Note |
|-------|--------------------|------|
| First scan | 7,335 | incl. tests (66%) — fastapi hung the extractor (O(n²)) |
| After fixes | 1,556 | tests/docs/scripts excluded, class-prefix + SQL trigger fixed |

Rule distribution after fixes (non-test): Unauthenticated Access 686, Unauthenticated
Mutation 611, Input Validation 216, No Input Sanitization 293, Audit Trail 178,
Ownership Check 128, Password Hashing 56, SQL Injection 34, Token Security 3.

**Sampled review verdict:** ~0 true positives among the dominant auth rules on this
corpus. Examples of what fires: `ConnectionPool.reset`, `Session.send`,
`SetCommands.srem`, `Blueprint.register_blueprint`, `Pipeline.execute`,
`FastAPI.add_api_route(path, endpoint)`, `CookieJar` mergers, ASGI plumbing.

## Fixes forced by this validation (all committed)

1. **Extractor O(n²) → O(n)** (`tools/extract_ir.py`): per-node full-tree walks for
   class detection hung on fastapi's big modules (5+ min CPU). Single-pass parent map.
2. **Non-production surface exclusion**: test files (`test_*`, `*_test.py`, `tests/`),
   plus `docs`/`docs_src`/`examples`/`benchmarks`/`scripts` dirs — 66% of detections
   were tests. Path checks are relative to project root (absolute-path bug caught in
   review: the repo parent dir named `benchmarks` excluded EVERYTHING).
3. **Class-name leakage in triggers** (`protocol-detector.ts`): identifier-parsed words
   from class-qualified names let `SetCommands.srem` fire the `set` mutation trigger via
   the CLASS word "Set". Triggers now see only the method name.
4. **SQL Injection trigger**: `triggerCallsOnly` — identifier parsing split
   `execute_command` into `execute`, firing SQL Injection on redis-py protocol calls.
   1,101 → 34 detections.

## Diagnosis — why library code breaks the rules

| Finding | Evidence |
|---------|----------|
| Trigger matches callee names | `save_session` fires Unauthenticated Access because it CALLS `get_cookie_name`; any function calling a getter but not calling auth is flagged |
| Getters are not endpoints | `get_protocol`, `get_cache_class`, `get_value` — data access without auth is the DESIGN of a library |
| **94% of auth-rule detections lack any identity parameter** | `FastAPI.add_api_route(path, endpoint)` — no token/session/user/request param; authentication isn't even expressible there |
| Verb collisions persist | `register_blueprint` → Password Hashing; `execute` (redis) → SQL Injection; `SetCommands` → mutation verb |
| Rule interface vs source | SQL parameterization (`%s`, f-strings) is invisible at call-name level — the SQL rule needs source-level matching |

## Recommendations (priority order)

1. **Validate on application repos, not libraries.** The rules target application
   surface (endpoints with auth). Correct corpus: Django/Flask/FastAPI apps with real
   auth (e.g., WrongSecrets, PyGoat, OWASP benchmark, real open-source apps).
2. **Param-gate the auth rules** (same mechanism as FK's `parentRefGated`): only flag
   Unauthenticated Access/Mutation/Ownership when the function takes an identity-ish
   parameter (token/session/user/auth/request/scope/cookie). Kills ~94% of library noise.
   Requires benchmark adjustment: planted no-auth functions should take-and-ignore a
   token param to model real endpoints (they currently take none — a benchmark blind
   spot this validation exposed).
3. **SQL rule needs source-level analysis** — move to AST-level or accept interface
   limitation and document.
4. Keep the name-based approach for the synthetic benchmark; real-world precision is a
   separate workstream with its own gold (human-annotated app findings).
