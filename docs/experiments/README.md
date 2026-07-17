# Experiments

> "数字决定方向" — every investment must answer: "投入一周工程，Recall 能提升多少？"

## Research Pipeline

```
Benchmark → Capability Gap → ROI → Experiment → Benchmark (closed loop)
```

1. **Benchmark identifies WHERE** the detector is weak
2. **Capability Gap classifies WHY** (rule_missing, parser, context, IR, ...)
3. **ROI quantifies** the potential gain per category → Current ROI, not permanent
4. **Experiment tests ONE variable** against the benchmark
5. **Benchmark measures** the actual gain → updates the ROI map → constraint may shift

## Experiment Template

Every experiment must declare:

```
Experiment: [ID]
Question:   [one sentence — what are we trying to learn?]
Hypothesis: [what specific bottleneck does this address?]
Independent Variable: [the ONE thing changed — no multi-variable experiments]
Dependent Variables: [TP, FP, TN, FN, P, R, F1]
Benchmark:  [which benchmark measures the gain?]
Baseline:   [before metrics]
Result:     [after metrics + delta]
Verdict:    [Supported / Rejected / Mixed]
Current ROI: [measured gain / engineering cost]
```

## Experiment Index

| ID | Question | Independent Variable | Result | Verdict | Date |
|----|----------|-------------------|--------|---------|------|
| — | Is Context the C bottleneck? | Trigger+safeguard scope (global/file/callers) | C: 0% impact, TS: change observed | Rejected for C | 2026-07-16 |
| 017 | Does snake_case normalization help? | `[A-Z]` → `(?:[A-Z]\|_)` in trigger regex | +1 FN, +3 FP | Rejected (ROI negative) | 2026-07-16 |
| 018 | Does Key Derivation Safety deserve a category? | One new rule (ecdh/curve25519/dh/kex triggers) | +3 TP, 0 FP, P↑3.2pp, R↑7.9pp | **Supported** ✅ | 2026-07-16 |

### Evidence Chain (closed loop)

```
Context hypothesis:  Rejected (0% impact on C)
Parser hypothesis:   Rejected (ROI negative)
Taxonomy hypothesis: Supported (3/6 FN, 0 FP → Category confirmed)
→ Next: Auth/Negotiate category (5 FN)
```

## Key Documents

- [ROI Framework](roi-framework.md) — Investment evaluation matrix, Current ROI map
- [Context Optimization Experiment](context-optimization-2026-07-16.md) — v5/v6/v7 comparison
- [Experiment-017: Snake Case](experiment-017-snake-case.md) — Trigger lexical normalization
- [Experiment-018: Crypto Taxonomy](experiment-018-crypto-taxonomy.md) — Key Derivation Safety category
- [C Rule Coverage Taxonomy](c-rule-coverage-taxonomy.md) — FN distribution by protocol category
- [FN Root Cause Analysis (P0)](../blind-benchmark/reports/fn-root-cause-analysis-2026-07-16.json) — Raw data

## Category Graduation Criteria

A protocol category graduates to Production when:
1. **≥30% Recovery** of target FNs in its category
2. **FP ≈ 0** (no measurable Precision regression)
3. **Cross-repo validation** (not single-project overfit)

After graduation → **Coverage Expansion** phase (broaden trigger/safeguard, same FP constraint).

## Principles

1. **One variable per experiment.** No multi-variable changes.
2. **Current ROI ≠ Never invest.** Constraint shifts as earlier bottlenecks resolve.
3. **Negative results are results.** Knowing what DOESN'T work is as valuable as knowing what does.
4. **Benchmark before code.** Hypothesis before implementation.
5. **Migration Matrix required.** Every change must show exactly what moved (FP→TN, TN→FP, TP→FN, FN→TP).
