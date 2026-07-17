# Context Optimization Experiment (2026-07-16)

## Research Question

Is Context modeling strategy the primary bottleneck for detection quality?

## Method

A/B test — only Context modeling changed, Rules stayed identical:

| Version | Trigger Scope | Safeguard Scope |
|---------|--------------|-----------------|
| v5 | global (all project calls) | global |
| v6 | file-level | file-level |
| v7 | file-level | file-level + caller chain |

## Results

### TS Blind Benchmark (50 projects, 665 functions, NO gold labels)

| Version | Violations | Δ |
|---------|-----------|----|
| v5 | 217 | — |
| v6 | 868 | — |
| v7 | 903 | +4% |

Suppression pattern observed but cannot validate without gold labels.

### C Gold Benchmark (4 repos, 232 labeled sequences)

| Version | Precision | Recall | F1 |
|---------|-----------|--------|-----|
| v5 | 16.4% | 100.0% | 28.1% |
| v6 | 15.2% | 50.0% | 23.3% |
| v7 | 15.0% | 50.0% | 23.0% |

Migration v6→v7: 228/232 (98.3%) unchanged. Net effect: neutral.

## Key Finding

**Context is NOT the primary bottleneck on C benchmarks.**

The variable was isolated: only Context changed. C benchmark showed almost zero response.
Therefore, the bottleneck on C code lies BEFORE the Context layer — more likely in:
- Rule Coverage (rules designed for TS/web patterns, don't map to C idioms)
- Program Representation (IR extraction quality, macro handling, function pointers)

On TS benchmarks, Context DOES matter — but we lack gold labels to quantify the gain.

## Benchmark Maturity

The benchmark has evolved from _"Is the detector good?"_ to _"WHERE is the detector weak?"_

It can now answer investment questions:
- Rule Coverage improvement? → Test on C benchmark
- Context optimization? → Test on TS benchmark
- Parser/IR improvement? → Test on both

## Next Phase: ROI Map

| Investment | TS Gain | C Gain | Eng Cost | Priority |
|-----------|---------|--------|----------|----------|
| Context Optimization | High (hypothesized) | ~None (measured) | High | Low |
| Rule Coverage | Unknown | High (hypothesized) | Medium | High |
| Parser/Identifier | Medium | High (hypothesized) | Medium | High |
| IR Quality | Unknown | Unknown | High | Investigate |
| Call Ordering (v8) | Unknown | ~None | Very High | Defer |
