# Progmune Detector Baseline v6 — 100-Project Gold Benchmark

**Date:** 2026-08-15
**Artifact:** `gold/annotations-v2.json` (version 6.0)
**Detector:** commit `513d53cb` (post tRPC detector / SSG FP-fix era), scan `2026-08-15T12:22Z` (wave-1) / `2026-08-15` (wave-2)

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
| Recall | **86.2%** | 87.7% | 69.7% (85.2% effective) |
| Effective recall¹ | **87.5%** | 87.7% | 85.2% |
| Precision | **82.6%** | — | — |
| FPs (factual) | 144 | 134 | 10 |

¹ Excludes 11 read-auth annotation issues + 1 out-of-scope business-logic finding carried from gold-v1.

### Detection matching rules (fixed, strict-localization)

- A finding counts as detected **only when its own function** carries the corresponding rule (rule-name level, not just category).
- handleRequest aggregator fallback applies only to functions absent from the scan.
- A no-auth mutation flagged with `Authorization (Ownership Check)` still counts (an authorization violation on the exact function).
- **FP** = detection factually wrong per code review: `Session Fixation` on projects whose logout *does* invalidate (splices the session). 72 projects × 2 detections (function + handleRequest duplicate) = 144.
- Factually-true detections not in the gold list (registration verification, session TTL, audit trail, read-auth on unplanted readers…) are **unlabeled** — excluded from precision, mirroring gold-v1's annotation_issues handling.

### What the 98 genuine FNs tell us (detector improvement roadmap)

1. **Delete-ownership localization gap (90 FNs — the dominant class):** styles A/D only. The Ownership Check rule treats a call to `getUser`/`getCurrentUser` as satisfying the ownership verification — but the code never compares `ownerId`. Styles B/C (`validateSession`/`verifyToken`) are caught. → Rule needs ownerId-comparison awareness, not auth-fn-name presence.
2. **Existence/foreign-key class (4 FNs):** addComment/addNote/createReply without verifying the referenced entity exists — FK rule doesn't fire on these functions.
3. **No-auth mutations (3 FNs):** addProduct (ecommerce), addCategory (forum), setMilestone (issuetracker) carry no authorization flag.
4. **Ownership on update (1 FN):** updatePage checks auth but not page ownership (gold-v1 WIKI-006).

### FP class (144): Session Fixation

`Session Fixation (Logout without Invalidation)` fires on logout functions that *do* splice the session out (and duplicates on handleRequest). The rule keys on `session.destroy`-style call names and ignores splice-based invalidation.

## Repro

```bash
npx ts-node blind-benchmark/generate-projects.ts   # (re)generate 90 style projects
npx ts-node blind-benchmark/batch-scan.ts          # fresh scan → reports/batch-scan-results.json
npx ts-node blind-benchmark/expand-gold-v6.ts      # → gold/annotations-v2.json
```

`blind-benchmark/reports/batch-scan-results.json` is gitignored (regenerable). `gold/annotations-v2.json` is committed.
