# Progmune Detector Baseline v5

**Status: FROZEN. Do not modify.**

This benchmark is the stable evaluation framework for all future detector versions.
The detector evolves. The benchmark stays fixed.

---

## Frozen Assets

### 1. Gold Annotations — `gold/annotations.json` (gold-v1)

First gold annotation version. 66 findings across 10 hand-annotated projects.
Future corrections go to `gold-v2`, not by modifying gold-v1.

### 2. Metric Definitions

**Recall** = TP / (TP + FN) — how many real violations does the detector find?

Scope includes:
- Protocol violations (missing prerequisites, auth bypass, data integrity)
- Resource leaks (missing cleanup)
- Input validation gaps
- Password/token security issues
- TLS enforcement

Scope EXCLUDES:
- Business logic errors (hardcoded prices, semantic bugs)
- Read-operation auth (get/list on resources — context-dependent, prompt didn't specify)
- Rate limiting (infrastructure concern, not protocol violation)

**Precision** = TP / (TP + FP) — how many reported violations are real?

**F1** = 2 × P × R / (P + R)

**Category Recall** = Per-category TP / per-category total findings

**Generalization Score**:
- Known Vocabulary Recall: recall on entities in the training whitelist (Post, Task, Comment, etc.)
- Unknown Vocabulary Recall: recall on entities NOT in the training whitelist (Contact, Issue, Deal, etc.)
- Generalization Gap = Known - Unknown (lower is better — measures how much the detector depends on memorized entity names)

### 3. Project Seeds — `prompts/templates.json`

20 project types, 5 LLM models, uniform temperature (0.7), no security hints.
All prompts preserved for reproducibility.

---

## Detector Versions (evaluated on this baseline)

| Version | Date | Key Change | Recall | Precision | F1 | Gen Gap |
|---------|------|-----------|--------|-----------|-----|---------|
| v4 (Det A) | Jul 4 | Entity whitelist | 74.2% | 98.0% | 84.5% | ~25pp |
| v5 (Det B) | Jul 7 | Verb generalization | 83.3% | 98.2% | 90.2% | ~13pp |
| v6 (Det C) | Jul 7 | +Identifier Parser | 83.3% | 98.2% | 90.2% | ~13pp |

---

## Category Recall (Detector B / v5)

| Category | TP | Total | Recall |
|----------|-----|-------|--------|
| Password Hashing | 5 | 5 | 100% |
| Input Validation | 8 | 8 | 100% |
| Token Security | 5 | 5 | 100% |
| TLS Enforcement | 3 | 3 | 100% |
| Rate Limiting | 5 | 5 | 100% |
| Authorization | 12 | 14 | 86% |
| Data Integrity | 4 | 5 | 80% |
| Missing Prerequisite | 2 | 4 | 50% |

---

## Generalization Score (Detector B / v5)

| Vocabulary | Recall |
|-----------|--------|
| Known entities (Post, Task, Comment, Order, Product) | 96% |
| Unknown entities (Contact, Issue, Deal, Note, Attachment) | 83% |
| **Generalization Gap** | **13pp** |

Target: reduce gap to <5pp by improving identifier parsing and verb extraction.

---

## Principles

1. **Benchmark frozen. Detector evolves.** Never change the benchmark to make numbers look better.
2. **Gold-v1 is immutable.** Corrections go to gold-v2 as a new file.
3. **Metrics defined once.** Same formula for all future detector versions.
4. **Seeds preserved.** Any researcher can reproduce the exact same projects.
5. **Category + Generalization > Overall Recall.** Understanding what improved matters more than a single number.
