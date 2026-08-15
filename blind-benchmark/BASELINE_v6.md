# Progmune Detector Baseline v6 — 50-Project Gold Benchmark

**Date:** 2026-08-15
**Artifact:** `gold/annotations-v2.json` (version 6.0)
**Detector:** commit `513d53cb` (post tRPC detector / SSG FP-fix era), scan `2026-08-15T12:22Z`

> Expansion of the frozen gold-v1 (`gold/annotations.json` v5.0, 10 hand-annotated projects, 2026-07-06).
> gold-v1 remains frozen and unmodified; this is gold-v2.

---

## Composition — 50 projects

| Subset | Projects | Findings | Source of gold |
|--------|----------|----------|----------------|
| Style-variants | 40 (`<type>_<style>`, 10 types × 4 styles) | 329 | Generator plant configuration + Claude template review |
| Model-variants | 10 (blog, chat, crm, ecommerce, filestorage, forum, issuetracker, scheduler, todo, wiki) | 66 | Human annotation from gold-v1 (unchanged), detection refreshed |

## Gold derivation (style-variants)

Planted by `generate-projects.ts` (ground truth by construction):
- Password hashing — all 40: A/C plaintext, B SHA256, D MD5
- Token generation — all 40: A `tok_`+Math.random, B `s_`+Date.now, C `sess_`+increment, D `jwt_`+random (fake JWT)
- No-auth functions — planted `noAuthFns` ∩ generated entities (9 findings across 6 projects: analytics_A 2, messaging_B 2, inventory_C 1, notifications_C 1, githost_D 1, workflow_D 2)

Claude template review (applies to all 40, verified by reading the four style templates + spot-checking other types):
- **Ownership:** delete/remove verifies token but not `ownerId === user.id` (2/project, high-value catch — same class as gold-v1 WIKI-006)
- **Input validation:** create takes unvalidated title/body (2/project)
- **TLS / rate limiting:** absent at server entry (1+1/project, aligned with gold-v1 annotation practice)

## Metrics

| Metric | 50 projects | Style-40 | Model-10 | gold-v1 (10 projects, 2026-07) |
|--------|------------|----------|----------|-------------------------------|
| Gold findings | 395 | 329 | 66 | 66 |
| Recall | **84.8%** | 87.8% | 69.7% (85.2% effective) | 74.2% (90.7% effective) |
| Effective recall¹ | **87.5%** | 87.8% | 85.2% | 90.7% |
| Precision | **82.7%** | — | — | 98.2% |
| FPs (factual) | 70 | 60 | 10 | ~0 |

¹ Excludes 11 read-auth annotation issues + 1 out-of-scope business-logic finding carried from gold-v1.

### Detection matching rules (fixed, strict-localization)

- A finding counts as detected **only when its own function** carries the corresponding rule (rule-name level, not just category).
- handleRequest aggregator fallback applies only to functions absent from the scan.
- A no-auth mutation flagged with `Authorization (Ownership Check)` still counts (an authorization violation on the exact function).
- **FP** = detection factually wrong per code review: `Session Fixation` on projects whose logout *does* invalidate (splices the session). 35 projects × 2 detections (function + handleRequest duplicate) = 70.
- Factually-true detections not in the gold list (registration verification, session TTL, audit trail, read-auth on unplanted readers…) are **unlabeled** — excluded from precision, mirroring gold-v1's annotation_issues handling.

### What the 48 genuine FNs tell us (detector improvement roadmap)

1. **Delete-ownership localization gap (40 FNs):** styles A/D only. The Ownership Check rule treats a call to `getUser`/`getCurrentUser` as satisfying the ownership verification — but the code never compares `ownerId`. Styles B/C (`validateSession`/`verifyToken`) are caught. → Rule needs ownerId-comparison awareness, not auth-fn-name presence.
2. **Existence/foreign-key class (4 FNs):** addComment/addNote/createReply without verifying the referenced entity exists — FK rule doesn't fire on these functions.
3. **No-auth mutations (2 FNs):** addProduct (ecommerce), addCategory (forum) carry no Unauthenticated Access flag.
4. **Ownership on update (1 FN):** updatePage checks auth but not page ownership (gold-v1 WIKI-006).
5. **setMilestone (1 FN):** no-auth mutation, zero rules fired.

### FP class (70): Session Fixation

`Session Fixation (Logout without Invalidation)` fires on logout functions that *do* splice the session out (and duplicates on handleRequest). The rule keys on `session.destroy`-style call names and ignores splice-based invalidation.

## Repro

```bash
npx ts-node blind-benchmark/batch-scan.ts          # fresh scan → reports/batch-scan-results.json
npx ts-node blind-benchmark/expand-gold-v6.ts      # → gold/annotations-v2.json
```

`blind-benchmark/reports/batch-scan-results.json` is gitignored (regenerable). `gold/annotations-v2.json` is committed.
