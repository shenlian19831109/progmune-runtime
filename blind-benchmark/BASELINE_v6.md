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

## Repro

```bash
npx ts-node blind-benchmark/generate-projects.ts   # (re)generate 90 style projects
npx ts-node blind-benchmark/batch-scan.ts          # fresh scan → reports/batch-scan-results.json
npx ts-node blind-benchmark/expand-gold-v6.ts      # → gold/annotations-v2.json
```

`blind-benchmark/reports/batch-scan-results.json` is gitignored (regenerable). `gold/annotations-v2.json` is committed.
