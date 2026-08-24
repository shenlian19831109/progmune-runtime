# Progmune Runtime Architecture

## Four Levels of AI Code Governance Runtime

Progmune has crossed from a detection tool to a **Verification Runtime**. This document defines the four maturity levels of the runtime.

---

## Level 1: Detect

**Capability:** Find violations in generated code.

```
verify(code) → violations[]
```

**Status:** ✅ Production（27 协议命名空间 / protocols.json 148 条规则，4 repos benchmarked；盲测 795 gold Recall 98.5% / Precision 100%）

**KPI:** Precision, Recall, F1 (per-repo)

---

## Level 2: Explain

**Capability:** Explain WHY a violation occurred and WHAT the correct behavior should be.

```
explain(violation) → {
  reason: "File not closed",
  currentState: ["FILE_OPEN"],
  requiredState: [],
  fixPath: ["close_file"]
}
```

**Status:** ✅ Production (SSG state graph, counterfactual alternatives)

**KPI:** Explanation accuracy, developer comprehension rate

---

## Level 3: Repair

**Capability:** Automatically fix the violation and verify the fix.

```
repair(violation, code) → {
  success: true,
  fixedCode: "...",
  appliedFix: "close_file"
}
```

Internal pipeline:
```
Detect → Plan → Execute → Validate → Commit / Rollback
```

**Status:** ✅ Phase 1 complete (repair-executor.ts, 100% simulation success)

**KPI:** Repair success rate (per repo), Repair Failure Taxonomy

---

## Level 4: Guarantee

**Capability:** If repair fails, automatically rollback and report. If repair succeeds, commit with confidence score.

```
guarantee(repairResult) → {
  status: "COMMITTED" | "ROLLED_BACK",
  confidence: 0.85,
  auditTrail: [...]
}
```

**Status:** 🔨 In development (Phase 4: Verification Intelligence Program)

**KPI:** Commit rate, rollback rate, confidence calibration

---

## Runtime Pipeline

```
                    ┌──────────────┐
                    │    Source    │
                    │    Code      │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   Extract    │  IR extraction
                    │     IR       │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   Verify     │  SSG state machine
                    │  (Detect)    │  L1
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   Explain    │  Counterfactual engine
                    │              │  L2
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │    Plan      │  Strategy search
                    │   Repair     │  Candidate ranking
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   Execute    │  applyFix()
                    │   Repair     │  L3
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   Validate   │  verifyRepair()
                    │   Repair     │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  Commit /    │  Record trajectory
                    │  Rollback    │  L4
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │    Learn     │  Feedback → Knowledge
                    │  (Flywheel)  │  Acceptance rate
                    └──────────────┘
```

## Core Modules

| Module | Level | Purpose |
|--------|-------|---------|
| `ssg-validator.ts` | L1 | State machine validation |
| `counterfactual-engine.ts` | L2 | Repair alternatives (top-3) |
| `repair-strategies.ts` | L3 | Candidate search strategies |
| `repair-ranker.ts` | L3 | Feature extraction + ranking |
| **`repair-executor.ts`** | **L3+L4** | **applyFix + verifyRepair + rollback** |
| `repair-taxonomy.ts` | L4 | Failure classification |
| `knowledge-flywheel.ts` | L4 | Continuous learning loop |

## API Philosophy

**Old API (Detector):**
```typescript
find(path) → violations[]
suggest(violation) → alternatives[]
```

**New API (Runtime):**
```typescript
verify(code) → VerificationResult
repair(violation, code) → RepairOutcome
validate(fixedCode) → ValidationResult
commit(fix) → CommitResult
```

## Key Business Metrics

Instead of "Knowledge units" or "Protocol count":

| Metric | Current (2026-08，见 coverage-matrix / BASELINE_v6) | Target |
|--------|---------|--------|
| Detection F1 | TS 盲测 Recall 98.5%（有效 100%）/ Precision 100%；C 研究级 F1 16.5% | 70%+（C 不设投资目标） |
| **False Positive Rate** | **0 FP**（TS 795 gold / Python 729 gold / PyGoat） | **<40%** |
| Recall | TS 98.5% / Python 100% | Maintain |
| Repair Success (sim) | 100% | — |
| **Repair Success (real)** | **?** | **Measure** |
| **Human Acceptance Rate** | **?** | **>80%** |
| Knowledge Velocity | 0.29/scan | 1.0+/scan |
