# Progmune — AI Software Verification Infrastructure

## One sentence

> Progmune is a **self-evolving verification knowledge network for AI-generated software**.
> Every new codebase makes every verification stronger.

*每新增一个代码库，所有验证都变得更强。*

## What we are

**AI Software Verification Infrastructure** — not "Global AI Governance" (too broad).
We verify one thing deeply: protocol lifecycle compliance in AI-generated code.
The network effect: every verified repo strengthens every Knowledge Unit.

## What we are NOT

❌ Global AI Governance Infrastructure (covers model, data, agent, prompt, identity — we don't)
❌ A CodeQL/Semgrep competitor (we detect what they cannot see)
❌ An AI code generator (we govern, we don't generate)

## Scope

We focus on **protocol lifecycle verification** — the gap SAST cannot see.
Our Knowledge Network covers TLS, SSH, HTTP, HTTP/2 today.
Future: Filesystem, Database, Container, Workflow, MCP, Identity, Agent, GPU.
The network grows. The verification deepens. The evidence accumulates.

```
Evidence → Knowledge → Verification → Governance → Observation → Knowledge
    ↑                                                                     │
    └────────────────── Every new repo strengthens all ────────────────────┘
```

## Academic foundation

Kambhampati et al., *Stop Anthropomorphizing Intermediate Tokens as Reasoning/Thinking Traces!* (arXiv:2504.09762, 2025) — and Kambhampati's ICML 2026 invited talk "On the Role of Verifiers and Thinking Traces in Reasoning Models". The quote below summarizes his position; it is not a verbatim paper citation.

> LLM 输出的"逐步推理"是统计表演。中间 token 与真实推理之间没有可靠因果对应。

Progmune 从第一天就建立在这个前提上：LLM 是提案者，程序真相是裁决者。

| CoT approach | Progmune approach |
|-------------|-------------------|
| Trust the model's self-explanation | Trust program semantics (IR, CFG, Call Graph) |
| "Let's think step by step" | "Let's verify against protocol knowledge" |
| Intermediate tokens = presumed reasoning | External verification = ground truth |
| CoT is slow, expensive, hallucinated | Verification is deterministic, evidence-backed |

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

Runtime v3.2.0 — AI Trust Decision Engine.
Knowledge Base v3.0.0 — continuously evolving underneath.
