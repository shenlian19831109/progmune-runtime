# Progmune Coverage Matrix

> Protocol × Language × Framework — real coverage status  
> Last updated: 2026-08-24  
> Purpose: answer the only question enterprises care about — "Can Progmune check my project?"

---

## 1. Legend

| Marker | Meaning |
|--------|---------|
| ✅ | Dedicated rules + test/benchmark data + measurable Precision/Recall |
| ⚠️ | Generic regex rules or partial adaptation; weak benchmark data, uncalibrated, or known high FP/FN |
| ❌ | No coverage |
| — | Combination does not exist (e.g., TLS is meaningless for an HTTP framework) |

---

## 2. Protocol × Language Matrix

```
Protocol           TS/JS        C            Go        Python      Java
──────────────────────────────────────────────────────────────────────────
Auth               ✅           ⚠️           ❌         ✅          ❌
TLS/SSL            ⚠️           ✅           ❌         ❌          ❌
SSH                ⚠️           ✅           ❌         ❌          ❌
HTTP/2             ⚠️           ✅           ❌         ❌          ❌
HTTP Request       ⚠️           ✅           ❌         ❌          ❌
Connection         ⚠️           ⚠️           ❌         ❌          ❌
QUIC               ❌           ⚠️           ❌         ❌          ❌
Resource Lifecycle ⚠️           ⚠️           ❌         ✅          ❌
Payment            ✅           ❌           ❌         ❌          ❌
Data Integrity     ✅           ❌           ❌         ❌          ❌
Ledger             ✅           ❌           ❌         ❌          ❌
──────────────────────────────────────────────────────────────────────────
Effective coverage TS (✅×4)    C (✅×4)     ❌         Python (✅×2) ❌
                    TS (⚠️×5)    C (⚠️×4)              + source-level
                                                      detection (§2.1,
                                                      production)
```

> Python's protocol rows ✅ (Auth / Resource Lifecycle) per protocol blind benchmark v1.2 (BASELINE_PROTOCOL_PYTHON_v1: 66 gold, Recall 97% / Precision 100% / 0 FP); source-level detection in §2.1.

### 2.1 Source-level defect detection (Python, production)

| Class | Coverage | Evidence |
|-------|----------|----------|
| Injection | ✅ | SQLi (f-string / `%` / `.format` / concatenation), command injection (dynamic subprocess args), SSRF (user-controlled URLs), SSTI (template-string sinks), XXE (external-entity parser config), eval/exec, unsafe deserialization |
| Web | ✅ | XSS (`{{var\|safe}}` / autoescape off), path traversal (user-controlled file paths), CSRF (@csrf_exempt / GET state changes), cookie-based authorization, hardcoded JWT secrets (incl. cross-module constants) |
| Detection architecture | — | Extractor-marker architecture: taint tracking, import resolution, qualified call chains, cross-file template analysis — synthetic markers consumed by rules, zero pipeline changes |

### Availability verdict

| Language | Verdict | Evidence |
|----------|---------|----------|
| TypeScript | ✅ Usable | Blind Benchmark v6 (100 projects / 795 gold): P=100% (0 FP), R=98.5% (effective 100%) |
| Python | ✅ Usable | Blind Benchmark v1 (90 projects / 729 gold): P=100%, R=100%; PyGoat real-world validation 67 TP / 0 FP; three well-written apps with 0 false-positive true findings (3 framework-internal boundary FPs documented) |
| C | ✅ Annotation-driven (Beta) | IR extraction + SSG state machine; **~2-3 annotated protocol primitives per protocol yield trusted verification** (real-module gold 5/5: redis ACL / libssh client / libssh server / libssh callback-dispatch / uftpd transfer-auth — 0 FP with precise violation localization; gold v2: P=91.7% / R=100% / F1=95.7%; unannotated auto-detection: 0 TP on real corpus — positioning decision in the C Language Status doc). TLS-level coverage still absent (old regex-route Gold Benchmark F1=16.5% is the historical baseline); L3/L4 conclusions unchanged |
| Go | ❌ | No rules, no benchmark, no tests — planned |
| Java | ❌ | No support — planned |

### IR layer (since v3.5.0)

Registry-based multi-language merged extraction (`src/extract-project-ir.ts`): TypeScript (ts-morph) + Python (AST) detectors/extractors merge into a single function IR shared by the agent loop, `execute()`, and the MCP server — the agent composes function-protocol chains across both languages. Adding a language = registering one extractor entry; callers don't change.

> Since 3.7.1: merged-shape ir.json (`{ typeMap, functions }`) restored to IR-first sequence validation (fixing the silent regex-fallback regression since 3.5.0), with word-segment matching gated to project functions — external library calls (e.g. Node's `readFileSync`) no longer collide with protocol rules.

---

## 3. Protocol Details

### 3.1 Auth

| Property | Value |
|----------|-------|
| Detection | Regex auth-init + cleanup pairing (TS); `@progmune` annotated protocol state machine (Python) |
| TS coverage | ✅ Complete (incl. Ownership Check: ownerId/authorId comparison + permission gates) |
| Python coverage | ✅ Annotation-based protocol extraction + SSG validation (pre/invalidate/endState + P4.6 cross-function propagation); **protocol blind benchmark v1.2 (2026-08-23): 66 gold, Recall 97% / Precision 100% / 0 FP** (BASELINE_PROTOCOL_PYTHON_v1, incl. S5 arbitrary-naming variants; 2 misses are annotation-dependent preconditions, listed honestly) |
| C coverage | ⚠️ Only `auth_*` functions; OAuth2.0/OIDC flows uncovered |
| Not covered | OAuth2.0 authorization-code flow, OIDC, SAML, JWT signature verification, API key management, session fixation attacks |

### 3.2 TLS/SSL

| Property | Value |
|----------|-------|
| Detection | Regex init → handshake → free 3-step state machine |
| C coverage | ✅ curl/nginx/OpenSSL SSL function families |
| TS coverage | ⚠️ Regex only; TS TLS is usually handled inside Node.js |
| Not covered | Certificate verification chains, hostname verification, TLS version negotiation, cipher-suite strength |

### 3.3 SSH

| Property | Value |
|----------|-------|
| Detection | Regex init → auth → close 3-step |
| Benchmark data | libssh (C) |
| Not covered | Key type validation, known-host checks, channel management |

### 3.4 HTTP Request

| Property | Value |
|----------|-------|
| Detection | init → send → cleanup 3-step |
| Coverage | curl, nginx, Apache-style naming |
| Not covered | Any TS web framework (Express/Fastify/NestJS, etc.) |

### 3.5 HTTP/2

| Property | Value |
|----------|-------|
| Detection | init → send → close 3-step, nghttp2 library support |
| Benchmark data | nghttp2 (C) |
| Not covered | Stream prioritization, HPACK compression, Server Push |

### 3.6 Connection Lifecycle

| Property | Value |
|----------|-------|
| Detection | connect → transfer → disconnect generic pattern |
| Coverage | Generic — `connect/send/recv/close` functions in any language |
| Risk | Very high FP rate — `\b(\w*connect\b)` matches any function name containing "connect" |

### 3.7 QUIC

| Property | Value |
|----------|-------|
| Detection | init → transfer 2-step |
| Coverage | quiche library (C) |
| Not covered | TS/Go QUIC implementations |

### 3.8 Resource Lifecycle

| Property | Value |
|----------|-------|
| Detection | 8 alloc/free pattern pairs |
| C coverage | ⚠️ malloc/free, fopen/fclose, SSL alloc/free, socket/bind/close |
| TS coverage | ⚠️ Regex only; TS resource leaks under GC follow completely different patterns |
| Python coverage | ✅ Annotation-based file namespace (open/read/close protocol); use_after_close, missing_cleanup (endState), and cross_function_cleanup (P4.6) all detected in benchmark v1.2 (see §3.1) |
| Not covered | DB connection pools, file-handle leaks, unhandled Promises, unremoved event listeners |

### 3.9 Payment

| Property | Value |
|----------|-------|
| Detection | Payment-flow state machine |
| TS coverage | ✅ Rules exist |
| Benchmark data | No independent benchmark |
| Not covered | Stripe/PayPal/Adyen SDK adaptation, refund flows, idempotency checks |

### 3.10 Data Integrity

| Property | Value |
|----------|-------|
| Detection | Data read/write protection, input validation |
| TS coverage | ✅ |
| Python coverage | ⚠️ Hardcoded-secrets etc. source-level detection lives in §2.1; no protocol-namespace coverage |
| Not covered | SQL injection (requires schema awareness), XSS, command injection |

### 3.11 Ledger

| Property | Value |
|----------|-------|
| Detection | SSG ledger consistency: before-consistency, delta-consistency, delta-legality |
| TS coverage | ✅ |
| Benchmark data | 2,500+ trajectories in `.progmune_corpus/`; `npm run check` 1,315/1,315 ledger records pass |

---

## 4. Framework Coverage

| Framework | Language | Adaptation | Notes |
|-----------|----------|-----------|-------|
| Express | TS/JS | ✅ Dedicated detector | Route extraction + middleware classification + security checks |
| tRPC | TS/JS | ✅ Dedicated detector | API contract rules (3), cross-corrected with the Express detector |
| NestJS | TS/JS | ✅ Structural (3.7.11) | Decorator route parsing + global APP_GUARD recognition + @Public exemption + guard auth-classification (ThrottlerGuard≠auth) (synthetic gold P=R=100%) |
| Next.js | TS/JS | ✅ Structural (3.7.9) | App Router route.ts mutation-export auth checks + auth middleware; version-aware governance also exists |
| Fastify | TS/JS | ✅ Structural (3.7.9) | Route preHandler/hook auth analysis (code-string level) |
| Other TS frameworks | TS/JS | ⚠️ Basic aliases | Library alias coverage, no structural analysis |
| Django | Python | ✅ Structural (3.7.8) | urlconf/CBV/DRF structural adapter: unprotected mutation views and AllowAny write endpoints flagged (synthetic gold P=R=100%; django-realworld 0 FP) |
| FastAPI | Python | ✅ Structural (3.7.8) | Route/auth-dependency structural adapter: mutation-route auth checks + dead auth schemes (synthetic gold P=R=100%; fastapi-realworld 0 FP) |
| Flask | Python | ✅ Structural (3.7.9) | Route/before_request auth-guard analysis (synthetic gold P=R=100%) |
| Gin / Fiber | Go | ❌ | No Go support |
| Spring Boot | Java | ❌ | No Java support |
| curl / nginx / libssh / OpenSSL | C | ✅ Benchmarked | C gold benchmark (old regex-route F1=16.5% is the TLS-level historical baseline; since 3.7.4 IR extraction + app-level protocol verification, gold v2 F1=95.7%; annotation-driven Beta since 3.7.6 — real-module gold 5/5) |

```
Dedicated detectors    8 / 13 (Express ✅, tRPC ✅, FastAPI ✅, Django ✅, Flask ✅, Fastify ✅, Next.js ✅)
Partial                0 (Next.js additionally version-aware)
Basic alias coverage   5 / 13 (no structural analysis)
```

> Framework adaptation is the #1 product gap: FastAPI and Django are structurally adapted (3.7.8, route-level auth checks); Next.js/Fastify/Flask and 5 more remain. Adapted frameworks have dedicated structural detectors; the remaining rules still use `\w*` generic prefix patterns (e.g. `\b(\w*ssl\w*init)\b`).

---

## 5. CVE/CWE Coverage

| Metric | Value |
|--------|-------|
| Annotated samples | 34 CVEs (subset of the `benchmarks/cve-100.json` corpus; benchmark harness: `npm run test:cve`) |
| Detection rate | **88%** (30/34) |
| Category match | 63% (19/34) |
| By severity | critical 13/13 (100%), high 13/15 (87%), medium 4/6 (67%) |
| Goal | Cover the OWASP Top 10 + CWE Top 25 categories relevant to AI-generated code |

---

## 6. Known Coverage Gaps (prioritized)

### P0 — Framework adaptation (#1 product gap)

| Gap | Impact |
|-----|--------|
| Django / FastAPI structural analysis | ✅ Adapted (3.7.8) — route-level auth checks live; ORM query safety, DI chains, serializer validation still source-level only |
| Structural analysis for TS frameworks beyond Express | ✅ Next.js/Fastify/NestJS all structurally adapted (3.7.9/3.7.11) — all four major TS frameworks covered; niche frameworks (Koa etc.) remain alias-level |

### P1 — Language extension

| Language | Priority | Rationale |
|----------|----------|-----------|
| Go | High | Mainstream language for cloud-native infrastructure (commercialization strategy: Go before Java) |
| Java | Medium | Enterprise legacy systems + Spring Boot ecosystem |

### P2 — TS-side source-level injection detection

Python already has source-level SQLi/XSS/SSRF detection (§2.1); the TypeScript extractor is name/call-based — equivalent TS injection classes remain uncovered (documented boundary).

### P3 — Protocol extension

| Protocol | Why it matters |
|----------|----------------|
| OAuth2.0 / OIDC | Used by nearly every SaaS application |
| gRPC | Mainstream microservice communication protocol |
| GraphQL | Query injection, depth limits, permission boundaries |
| WebSocket | Real-time apps with special authn/authz patterns |
| DB Transaction | Transaction boundaries, isolation levels, rollback handling |

### Not invested in

C-language L4 (pointer/CFG/dataflow) — the L3 experiment was terminated with data; a multi-year research problem, not planned (research status archived in `docs/c-language-status.md`).

---

## 7. Version Targets

```
                v1 (current, 2026-08)      v2 (target)
───────────────────────────────────────────────────────────
Protocols        21 namespaces, all with    + OAuth2.0/OIDC, gRPC,
                 rule vocabulary             GraphQL, WebSocket
Languages        2 ✅ (TS, Python)          + Go ✅
                 C ✅ Annotation (Beta)     Java (further out)
Frameworks       8/13 dedicated detectors   Spring Boot/Go structural
                                            adaptation
TS P/R           100%/98.5%                 stable
Python P/R       100%/100%                  stable
CVE              34 (88% detection)         100 (calibrated rate)
```

---

## 8. What Progmune Does NOT Do

Explicitly out of scope:

- ❌ No code copyright / license compliance checks
- ❌ No third-party dependency vulnerability scanning (Snyk/Dependabot's domain)
- ❌ No infrastructure config security (Terraform/K8s — unless AI-generated)
- ❌ No runtime behavior monitoring (APM/RASP's domain)
- ❌ No replacement for human code review (Trust Score supports decisions, doesn't make them)

---

## 9. Maintenance Notes

Update this document when:

- A new Protocol is supported
- A new Language is supported (backed by benchmark data)
- A new Framework is adapted
- Benchmark results change significantly (P/R shift > 5%)
- The number of annotated CVE samples changes

Do **not** update this document for rule-count changes — rule count is not a product metric.
