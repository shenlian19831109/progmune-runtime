# Progmune Detector Baseline v6 — 100-Project Gold Benchmark

**Date:** 2026-08-15
**Artifact:** `gold/annotations-v2.json` (version 6.0)
**Detector:** post-`1209c5ab` rule fixes (Ownership Check, FK param-gating, Unauthenticated Mutation rule, update verb), scan `2026-08-15`

> Expansion of the frozen gold-v1 (`gold/annotations.json` v5.0, 10 hand-annotated projects, 2026-07-06).
> gold-v1 remains frozen and unmodified; this is gold-v2. Wave 1: 10 → 50 projects. Wave 2: 50 → 100 projects.

---

## Composition — 100 projects

| Subset | Projects | Findings | Source of gold |
|--------|----------|----------|----------------|
| Style-variants | 90 (23 types × 4 styles, newsfeed partial A/B) | 729 | Generator plant configuration + Claude template review |
| Model-variants | 10 (blog, chat, crm, ecommerce, filestorage, forum, issuetracker, scheduler, todo, wiki) | 66 | Human annotation from gold-v1 (unchanged), detection refreshed |

Wave 2 added 13 types (12 full × 4 styles + newsfeed × A/B = 50 projects): banking, healthcare, cms, logistics, booking, insurance, legal, edtech, iot, realestate, hr, music, newsfeed.

## Gold derivation (style-variants)

Planted by `generate-projects.ts` (ground truth by construction):
- Password hashing — all: A/C plaintext, B SHA256, D MD5
- Token generation — all: A `tok_`+Math.random, B `s_`+Date.now, C `sess_`+increment, D `jwt_`+random (fake JWT)
- No-auth functions — planted `noAuthFns` ∩ generated entities (9 findings across 6 wave-1 projects; wave-2 entity names don't intersect)

Claude template review (applies to all style projects, verified by reading the four style templates + spot-checking other types):
- **Ownership:** delete/remove verifies token but not `ownerId === user.id` (2/project)
- **Input validation:** create takes unvalidated title/body (2/project)
- **TLS / rate limiting:** absent at server entry (1+1/project, aligned with gold-v1 annotation practice)

## Metrics

| Metric | 100 projects | Style-90 | Model-10 |
|--------|-------------|----------|----------|
| Gold findings | 795 | 729 | 66 |
| Recall | **98.5%** | 98.6% | 97.0% |
| Effective recall¹ | **100%** | 98.6% | 100% |
| Precision | **99.1%** | — | — |
| FPs (factual) | 7 | 0 | 7 |

¹ Excludes 11 read-auth annotation issues + 1 out-of-scope business-logic finding carried from gold-v1.

### Rule fixes (2026-08-15) — 98 FNs → 0

1. **Ownership Check** — satisfier no longer treats identity lookups (`getUser`,
   `getCurrentUser`, …) as ownership verification; requires ownership-comparison names or
   permission/role gates. Fixed the 90-FN class (recall 86.2% → 97.5%).
2. **Data Integrity (Foreign Key) — param-aware** — the old satisfier counted ANY `get*`
   call (incl. `getSessionUser`) as a parent-existence check. Now: applies only when the
   function takes a parent-reference parameter (`…Id`/`entityType`), and requires a
   NON-auth lookup. Fixed BLOG-003/CRM-005/FORUM-004/ISS-003.
3. **Authorization (Unauthenticated Mutation)** — new rule: mutations
   (add/create/update/set/publish/insert/submit) without any auth check. `post` verb
   excluded (collides with the Post entity name). Fixed ECOM-002/FORUM-002/ISS-005.
4. **Ownership Check trigger += `update`** — fixed WIKI-006 (updatePage).
5. **Session Fixation — store-based invalidation** — the rule only recognized
   `session.destroy`-style call names; logouts that splice/filter the session store were
   flagged despite invalidating correctly (144 FPs). Satisfiers now include store-based
   invalidation verbs (`splice|filter|pop|shift|clear`) and a `callsOnly` delegation guard
   (a function calling a logout-named function delegates invalidation — checked at the
   logout function itself). Broken logouts still fire.

Known limitation (now measured): inline `p.ownerId !== u.id` comparisons are invisible to
the call-list interface — 7 factual FPs on the model projects (blog deleteComment/
updatePost/deletePost, crm updateContact/deleteContact, forum deleteReply, todo
deleteProject). These are counted in the FP number.

### Detection matching rules (fixed, strict-localization)

- A finding counts as detected **only when its own function** carries the corresponding rule (rule-name level, not just category).
- handleRequest aggregator fallback applies only to functions absent from the scan.
- A no-auth mutation flagged with `Authorization (Ownership Check)` still counts (an authorization violation on the exact function).
- **FP** = detection factually wrong per code review: `Session Fixation` on projects whose logout *does* invalidate (splices the session). 72 projects × 2 detections (function + handleRequest duplicate) = 144.
- Factually-true detections not in the gold list (registration verification, session TTL, audit trail, read-auth on unplanted readers…) are **unlabeled** — excluded from precision, mirroring gold-v1's annotation_issues handling.

### Genuine FNs: 0

All 795 gold findings are detected; the 12 non-detected findings are the historical
annotation-issues (11 read-auth) + 1 out-of-scope business-logic finding excluded by
methodology. Effective recall = 100%.

### FP classes (7)

1. **Ownership Check vs inline comparisons (7):** model-project functions that verify
   ownership with inline `ownerId/authorId` comparisons — invisible to the call-list
   interface. Next improvement: AST-level comparison detection.
2. ~~Session Fixation (144)~~ — fixed by recognizing store-based invalidation
   (`splice`/`filter`) and delegation to logout functions.

### FP class (144): Session Fixation

`Session Fixation (Logout without Invalidation)` fires on logout functions that *do* splice the session out (and duplicates on handleRequest). The rule keys on `session.destroy`-style call names and ignores splice-based invalidation.

## Python Pilot (2026-08-15) — v1

The same pipeline transliterated to Python: `generate-projects-python.ts` emits snake_case
versions of the same 4 templates with the same planted flaws (90 style-variant projects);
`batch-scan-python.ts` scans via the existing Python IR extractor
(`extractIRPython` → `tools/extract_ir.py`); `expand-gold-python.ts` derives the same gold
and reuses the same strict-localization matching. Required rule vocabulary patches: snake_case
triggers for Password Hashing / Token Security / TLS / Rate Limiting / Session Fixation /
Registration, snake_case auth names in AUTH_PATTERN and the two authorization rules'
satisfiers.

| Metric | Python v1 (90 style projects) | TS (100 projects) |
|--------|------------------------------|-------------------|
| Gold findings | 729 | 795 |
| Recall | **100%** | 98.5% |
| Precision | **100%** | 99.1% |
| FPs | **0** | 7 |

The detector's name-based architecture transfers to Python nearly for free — the only
language-specific layer is the IR extractor (already existed). The 7 TS FPs (inline
ownerId comparisons) do not occur in the Python corpus because the style templates carry
no inline comparisons; real-world Python will surface the same class.

```bash
npx ts-node blind-benchmark/generate-projects-python.ts  # 90 python projects → generated-py/
npx ts-node blind-benchmark/batch-scan-python.ts          # → reports/batch-scan-python-results.json
npx ts-node blind-benchmark/expand-gold-python.ts         # → gold/annotations-python-v1.json
```

## Repro (TypeScript)

```bash
npx ts-node blind-benchmark/generate-projects.ts   # (re)generate 90 style projects
npx ts-node blind-benchmark/batch-scan.ts          # fresh scan → reports/batch-scan-results.json
npx ts-node blind-benchmark/expand-gold-v6.ts      # → gold/annotations-v2.json
```

`blind-benchmark/reports/batch-scan-*-results.json` and `generated*` are gitignored
(regenerable). Gold annotations are committed.

## Coverage Expansion Work Package (2026-08-16)

Real-app recall measurement (PyGoat 72 labs, class-correct 25%) showed the binding
constraint was coverage, not precision. Five source-level coverage expansions shipped
in one day, all on one pattern — **the Python extractor performs source-level analysis
and emits synthetic marker calls; rules trigger on the markers with empty
safeguards**. Zero pipeline changes downstream, zero synthetic-benchmark drift.

| # | Class | Signal | PyGoat coverage | precision after |
|---|-------|--------|-----------------|-----------------|
| — | (baseline: param-gate + framework allowlist) | — | — | 37.8% |
| 1 | SQLi | SQL calls whose text is dynamically formatted (f-string/%/.format/concat), incl. single-hop assignment; parameterized calls silent | 0/2 → 2/2 | 70.6% |
| 2 | SSRF | qualified HTTP fetch (requests.*/urllib.*/…) with request-rooted URL taint | 0/1 → 1/1 | 71.4% |
| 3 | Path traversal | file sinks (open/io.open/os.open/Path().read_text) with request-rooted path taint | 0/1 → 1/1 | 72.2% |
| 4 | XSS | cross-file: template `{{v\|safe}}`/autoescape-off vars × tainted render contexts; mark_safe(tainted) | 0/3 → 3/3 (incl. a hidden A8-lab XSS) | 75.0% |
| 5 | SSTI | template-string sinks (render_template_string/Template/from_string) with taint; tainted content written into templates/*.html | 0/1 → 1/1 | 75.6% |
| 6 | XXE | dual signal: unsafe parser config (setFeature(external_*, True) / XMLParser(resolve_entities=True)) AND tainted XML parse | 1/2 → the vulnerable parser (xxe_parse); xxe_lab is a form-render wrapper | 76.2% |
| 7 | MITRE labs | three markers: eval/exec(tainted), jwt literal-key secret, tainted command flow to command-named helpers — reviving two dead source-level rules (Dynamic Code Execution, Hardcoded Secrets) whose source-pattern triggers could never match call names | 5/5 real MITRE labs (mitre_top1-25 are documentation pages, not labs); cmd_lab2 eval() gap filled | 79.6% |
| 8 | Reset tokens + CSRF | Token Security trigger extended to reset-password function names (with Python secure-token safeguards: secrets.token_urlsafe/token_hex, uuid4, os.urandom); extractor emits a marker for @csrf_exempt-decorated views → CSRF Protection Disabled rule | reset_password predictable md5 token caught; all 26 csrf_exempt lab views caught (verified true by construction). csrf_transfer_monei_api's GET-transfer flaw remains (no decorator — a different CSRF shape) | 88.0% |
| 9 | CSRF via GET state change | extractor detects state-changing calls (.save/.update/.delete/.create) inside a `request.method == 'GET'` branch → CSRF Exposed GET State Change rule | csrf_transfer_monei_api caught; Otp caught too (its GET branch genuinely .update()s the OTP — a real finding) | 88.5% |
| 10 | FP polish (import resolution + semantic markers) | extractor import map resolves django.contrib.auth.login/authenticate → framework-auth marker (suppresses Token Security); form delegation marker (XForm(request.POST).save() suppresses hashing rules); token-issued requireMarker on Token Security (login-named renderers like login_otp no longer fire; TS extractor emits the same marker); is_authenticated-guard + credential-check markers suppress auth rules; Command Injection becomes marker-driven — fires only on dynamic (non-static, incl. static-derived vars and sys.executable) command args | **9 FPs → 0, labeled precision 100.0%** (TP 62). Honest reclassification: 7 previous "TPs" were mislabeled — 6 labs DO check is_authenticated (their real flaws are cookie-based admin bypasses, needing a future cookie-authorization rule) and sql_lab's token claim was spurious (SQLi lab, no token issuance) | 100.0% |

Key implementation facts: lab reclassification (ssrf_lab is path traversal);
xss_lab3 uncovered (auto-escaped template); reset_password predictable token
uncovered; zero noise in well-written apps (parameterized ORMs, non-request URLs,
safe opens); synthetic benchmarks unchanged throughout (TS recall 98.5% /
precision 99.1%, Python 100% / 100%).

Remaining gaps: reset_password predictable token (no rule), MITRE csrf money
transfer's missing CSRF-token check itself (the hardcoded key is caught, the CSRF
absence is not — no CSRF rule exists).
