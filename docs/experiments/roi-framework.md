# Detection Quality ROI Framework

> "投入一周工程，Recall 能提升多少？" — every investment must answer this before committing.

## Diagnostic Dashboard

When Recall is insufficient, the benchmark can now tell you WHY:

```
Recall = 50% (C Gold Benchmark)
  │
  ├─ Rule Coverage:  ?%  ← how many violations have NO matching rule?
  ├─ Context:       ~0%  ← measured: v5→v6→v7 shows almost no gain on C
  ├─ Parser:         ?%  ← does identifierParse lose information on C names?
  ├─ IR Quality:     ?%  ← do we even extract the right call sequences?
  └─ Other:          ?%  ← macros, function pointers, inline asm, ...
```

## Investment Evaluation Matrix (Current, not Permanent)

> "Current ROI" ≠ "Never invest." Constraint shifts when earlier bottlenecks are resolved.

Before starting any improvement, fill out this template:

```
Experiment: [ID]
Hypothesis: [what specific bottleneck does this address?]
Benchmark:  [which benchmark measures the gain?]
Baseline:   [current metric on that benchmark]
Target:     [expected metric after experiment]
Independent Variable: [the ONE thing changed]
Dependent Variables: [TP, FP, TN, FN, P, R, F1]
Result:     [Supported / Rejected / Mixed]
Current ROI: [measured gain per engineering cost]
```

## Prioritized Opportunities (per 2026-07-16 data)

### P0: C Rule Coverage Taxonomy (2-3 days)
- **Question:** What categories of C protocol violations exist, and how are the 19 FNs distributed?
- **Method:** Classify each FN into protocol categories (TLS, SSH, Memory, Socket, Crypto, ...). Map missing rule patterns per category.
- **Current evidence:** 84% of C FNs are rule_missing (verified by Exp-017).
- **Risk:** Low. Pure taxonomy work, no code changes.
- **Output:** Coverage map → prioritized rule development order.

### P1: Safeguard De-noising (2-3 days)
- **Question:** Can the 2 false safeguard matches be fixed without introducing regression?
- **Current evidence:** 11% of FNs are rule_logic_flawed (false safeguard matches).
- **Risk:** Low. Targeted fix for identified cases.

### P2: TS Gold Labels (3-5 days)
- **Question:** Does Context optimization actually improve TS Precision?
- **Current evidence:** Blind benchmark shows suppression patterns but cannot quantify without gold labels.

### Context Optimization (v7/v8)
- **Current ROI on C Gold Benchmark:** 0 (measured: v5→v6→v7, 98.3% unchanged)
- **Current ROI on TS Blind Benchmark:** Unknown (no gold labels)
- **Constraint shift trigger:** After Rule Coverage improves C Recall to ~80%, Context may become the bottleneck again.
- **Status:** Monitor. Do not invest now. Re-evaluate when C Recall passes 70%.

### Parser Normalization (snake_case triggers)
- **Current ROI on C Gold Benchmark:** Negative (Exp-017: +1 FN recovered, +3 FP introduced)
- **Status:** Do not invest. Re-evaluate if new evidence emerges.

## How to Use

Every detector change MUST follow this pipeline:

```
Benchmark → Capability Gap → ROI → Experiment → Benchmark (closed loop)
```

1. **Benchmark identifies WHERE** the detector is weak
2. **Capability Gap classifies WHY** (rule_missing, parser_failed, context, IR, ...)
3. **ROI quantifies** the potential gain per category
4. **Experiment tests ONE variable** against the benchmark
5. **Benchmark measures** the actual gain → updates the ROI map

No more "we improved Recall but don't know why."
