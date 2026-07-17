# Detector Capability Layer Map

> Every FN belongs to a layer. The question is not "can we fix it?" but "what capability level does it require?"

## The Four Layers

```
L1: Lexical         Regex trigger + safeguard on call presence/absence
L2: Control Flow    Call ordering within a function (does A happen before B?)
L3: Interprocedural Cross-function call graph (does caller provide safeguard?)
L4: Semantic        Protocol state machine, resource lifetime, type safety
```

## FN Distribution by Required Capability Layer

```
19 Gold FNs mapped to minimum capability layer needed for detection:

L1 (Lexical):         7 FN  (37%)  ← Regex can solve these
L2 (Control Flow):    7 FN  (37%)  ← Need intra-function ordering
L3 (Interprocedural): 2 FN  (11%)  ← Need caller-chain analysis
L4 (Semantic):        3 FN  (16%)  ← Need protocol-level understanding
```

## Category → Layer Mapping

| Category | Required Layer | Why |
|----------|---------------|-----|
| Key Derivation Safety | L1 | Cleanup vs. no cleanup — binary signal |
| Certificate Pinning | L1 | Pin without verify — binary signal |
| Safeguard Logic | L1 | Fix false safeguard regex matches |
| Connection Lifecycle | L1→L2 | Some need CFG (failure path ordering) |
| Auth Message Lifecycle | L2 | Clean/violation have same calls; need ordering |
| TLS Configuration | L2 | Config ordering matters (verify before connect) |
| State Machine | L4 | Protocol state transitions (FALLTHROUGH, error states) |
| Macro Callbacks | L4 | Macro-defined callbacks — IR can't see them |

## Current Layer Coverage

```
Layer   FN Total   FN Recovered   Current Coverage   Status
────────────────────────────────────────────────────────────
L1       7           3              43%               Active (3 remaining)
L2       7           0               0%               Not yet invested
L3       2           0               0%               Context experiment (C: 0%)
L4       3           0               0%               Deferred
```

## Investment Logic

```
For each new FN or category:
  1. Classify: which layer does it belong to?
  2. Check: do we have that layer's capability built?
  3. If yes → write rule, run experiment
  4. If no  → decision: build the capability OR mark as deferred

This prevents wasting time writing regex rules for L4 problems.
```

## Why This Matters

Before the Capability Map:
- "FN exists → write a rule"
- No way to know if a rule CAN solve it
- Multi-week detours into dead ends

After the Capability Map:
- "FN exists → which layer? → can our current capability solve it?"
- Clear ROI before writing a single regex
- Auth took 1 experiment to prove L2 required, not weeks of rule tweaking
