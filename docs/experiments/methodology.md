# Progmune Research Methodology

> Frozen: 2026-07-16. Applies to all future detector development.

## The Loop

```
FN Discovery → Root Cause → Capability Layer → ROI → Experiment → Benchmark → Decision
```

Every detector change must pass through this loop. No exceptions.

## Step 1: FN Discovery

Benchmark identifies WHERE the detector is weak.

- Gold Benchmark (curl, libssh, nginx, redis): human-annotated labels
- Blind Benchmark (50 TS projects): auto-generated, no labels yet
- All benchmarks are frozen — same seeds, same metrics, same baselines

## Step 2: Root Cause Classification

Every FN is assigned ONE root cause:

| Root Cause | Definition |
|-----------|------------|
| rule_missing | No rule's trigger matches |
| rule_logic_flawed | Rule triggers but safeguard falsely matches |
| parser_failed | Parser/identifier loses information |
| context_insufficient | Safeguard exists but not visible in current context |
| ir_incomplete | Call sequence is truncated or missing |
| gold_mismatch | Gold label cares about something the rule can't express |

## Step 3: Capability Layer

Every FN is assigned to a capability layer:

| Layer | Name | What it Detects |
|-------|------|----------------|
| L1 | Lexical | Call presence/absence (regex) |
| L2 | Control Flow | Intra-function call ordering |
| L3 | Interprocedural | Cross-function call graph |
| L4 | Semantic | Protocol state machine, resource lifetime |

**Rule:** Do not invest L1 resources on L2/L3/L4 problems.

## Step 4: ROI Assessment

Before writing any code, answer:
- Which FN(s) will this fix?
- Which benchmark measures the gain?
- What is the expected P/R/F1 delta?
- What is the risk of new FP?

## Step 5: Single-Variable Experiment

- ONE independent variable per experiment
- All other rules frozen
- A/B against frozen benchmark
- Output: TP/FP/TN/FN delta + Migration Matrix

## Step 6: Decision Gate

| Result | Action |
|--------|--------|
| ≥30% recovery, 0 FP | Graduate to Production |
| ≥30% recovery, FP > 0 | Investigate FPs, refine |
| <30% recovery | Reject or mark as wrong layer |
| Regex saturated | Mark as needs higher layer, do not invest L1 |

## Frozen Assets

| Asset | Status | Location |
|-------|--------|----------|
| Gold Benchmark v1 | Frozen | `benchmarks/{curl,libssh,nginx,redis}-*.json` |
| Blind Benchmark Seeds | Frozen | `blind-benchmark/generated/` |
| Experiment Template | Frozen | `docs/experiments/README.md` |
| ROI Framework | Frozen | `docs/experiments/roi-framework.md` |
| Capability Layer Map | Frozen | `docs/experiments/capability-layer-map.md` |
| C Taxonomy v2 | Active | `blind-benchmark/taxonomy/c-categories.json` |
| Coverage Dashboard | Active | `npm run coverage` |

## What Changes vs. What's Frozen

- **Frozen:** Method, benchmark, metrics, experiment design, decision criteria
- **Active:** Rules, categories, coverage numbers, taxonomy entries
- **Reason:** Method outlives any single detector version. Good process survives bad rules.
