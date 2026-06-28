# Progmune Runtime — Positioning

## One sentence

> Progmune is a **Knowledge-driven Governance Runtime for AI-generated Software**.

## What we do

AI generates code. Progmune governs it.

Not "does the code look right" (SAST).
Not "is this a known CVE" (SCA).
**"Does this AI-generated code follow the protocol it's supposed to."**

## Three pillars

| Pillar | What | Why it matters |
|--------|------|---------------|
| **Knowledge** | Protocol Knowledge Base with versioned, evidence-backed Knowledge Units (TLS, SSH, HTTP) | Cannot be copied — years of accumulated evidence, decisions, and evolution |
| **Runtime** | `verify()` → `explain()` — one call, one decision | Stable API. Internal complexity hidden. |
| **Governance** | Decision Chain: Evidence → Knowledge → Policy → Certificate → Trust | Enterprises buy trust, not detection |

## Architecture

```
Enterprise:  verify("./server.ts") → BLOCK/WARN/ALLOW
                ↑
Runtime API:    verify() | explain() | fix()        ← Stable (never break)
                ↑
Governance:     Policy Engine | Certificate | CI/CD   ← Product
                ↑
Verification:   Resource | Protocol | State Machine   ← Capability
                ↑
Knowledge:      Units | Ontology | Evolution           ← Moat
                ↑
Evidence:       Repos | Sequences | Benchmarks | RFC   ← Foundation
```

## What we sell

Not a scanner. Not a rule set.

**Governance decisions backed by continuously evolving protocol knowledge.**

- **Developer**: `npm install @progmune/sdk` → `verify(file)` → done.
- **Security team**: Policy, Certificate, Audit Trail.
- **Platform team**: Knowledge Packages, SDK, CI gate.

## The moat

1. **Knowledge Evolution** (★★★★★) — TLS v0.1→v0.5→v0.9→v1.0. Why each version was approved/rejected. Cannot be replicated.
2. **Evidence Network** (★★★★★) — 7 repos, 700+ sequences. Grows with every new validation.
3. **Decision Chain** (★★★★★) — Evidence → Decision → Policy → Certificate. Full audit trail.
4. **Ontology** (★★★★) — Protocol Concepts with RFC references, relations, constraints.

## What we are NOT

- ❌ A CodeQL/Semgrep competitor — we detect protocol violations they cannot see
- ❌ An AI code generator — we govern AI-generated code, we don't generate it
- ❌ A static analysis tool — we analyze behavior sequences, not code patterns

## Version

Runtime v1.0.0 — stable public API.
Knowledge Base v3.0.0 — continuously evolving underneath.
