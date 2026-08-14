# Progmune

## AI Trust Decision Engine for AI-generated software.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)
[![TS Benchmark](https://img.shields.io/badge/TS%20F1-85.2%25-22c55e)]()
[![Tests](https://img.shields.io/badge/Tests-92%20passing-22c55e)]()

**Verify AI-generated code before it reaches production.** Progmune checks whether your AI-generated code follows correct protocol lifecycles — TLS handshakes, auth flows, payment integrity, resource management — violations that SAST and SCA tools cannot see because they span sequences of function calls, not single statements.

Progmune doesn't trust what the model says. It verifies what the program actually does.

---

## One Command

```bash
npm run sdk src/server.ts --explain
```

Output: `APPROVED` / `NEEDS_REVIEW` / `BLOCKED` — with Trust Score, evidence, and repair suggestions.

---

## Two Paths: Intercept or Verify

Progmune covers **two code sources** with two complementary mechanisms:

| | **Generate path** (agent-time interception) | **Verify path** (post-hoc checking) |
|---|---|---|
| **Covers** | Code generated *through Progmune* (`progmune_generate` / `progmune_execute`) | Code written anywhere — Copilot, Cursor, humans (`progmune_trust_check` / SDK / CI) |
| **Mechanism** | 8 validation gates inside the generation loop: JSON parse → schema → SVL-1 symbol → SVL-2 types → SVL-3 dataflow → SVL-4 protocol state machine → BFS deterministic repair → semantic contract. Violating code is **never written to disk** — it is corrected or retried before emission. | Trust Engine: 4-dimension weighted scoring (policy 35% / protocol 30% / coverage 20% / governance 15%) → Decision + evidence trail |
| **When errors are handled** | At creation time — the error never exists | After the fact — the file already exists |
| **Cost curve** | Zero — the violation never landed | Higher the later it's found |

This is the core product thesis: **verify at generation time, not after the fact.** LLM outputs are proposals; the state machine is the referee. LLMs can be persuaded — state machines cannot.

---

## What Progmune Detects

AI code generators produce syntactically valid code that often violates **protocol lifecycles** — the correct sequence of operations like open→read→close or auth→validate→respond. These violations are invisible to traditional static analysis.

| Category | Example violations detected |
|----------|---------------------------|
| **TLS / SSL** | Handshake without certificate verification, missing hostname validation |
| **Auth** | Token without expiry, session without timeout, missing rate limiting |
| **Payment** | Order without verification, refund without authorization, webhook without signature check |
| **Resource** | File opened but not closed, connection without cleanup, malloc without free |
| **Data Integrity** | Mutation without audit trail, missing input validation |

---

## Quick Start

```bash
npm install progmune-runtime

# Verify a file — get a Trust Decision
npm run sdk src/server.ts

# Full explanation with evidence and repair suggestions
npm run sdk src/server.ts --explain

# Trust check (CI-ready JSON output)
npm run trust -- --project . --json

# Run benchmark suite
npm run precision:all
```

---

## The Trust Decision

Progmune's output is a **decision** backed by evidence, not a raw list of findings:

| Output | Meaning |
|--------|---------|
| **Trust Score** (0–100) | Quantified trust level across 4 dimensions |
| **Decision** | `APPROVED` / `NEEDS_REVIEW` / `BLOCKED` |
| **Confidence** | `HIGH` / `MEDIUM` / `LOW` / `UNCERTAIN` |
| **Evidence** | Each violation traced to code location + RFC reference + fix suggestion |

**Critical violations → hard BLOCK regardless of score.** Enterprises care about "can I deploy?" not "is my score 58 or 61."

→ [Trust Decision Model](docs/ai-trust-decision-model-v1.md)

---

## Coverage

Progmune is honest about what it can and cannot verify.

| Language | Status | Evidence |
|----------|--------|----------|
| **TypeScript / JavaScript** | ✅ Production | Blind benchmark: P=86.8%, R=83.6%, F1=85.2% (432 sequences, 10 projects) |
| **C** | ⚠️ Research-only | Gold benchmark F1=16.5%. L3 cross-function experiment terminated; L4 not planned. See [C Language Status](docs/c-language-status.md). |
| **Python** | 🔨 IR only | IR extractor exists (`extract-ir-python.ts`), no verification rules yet |
| **Go, Java** | ❌ None | Planned |

**Framework adapters: 2/13.** Express ✅ and tRPC ✅ have dedicated detectors; Next.js has version-aware governance; NestJS is partial. Django, FastAPI and 8 more remain — framework adaptation is the #1 product gap.

### What Progmune does NOT cover (honest boundaries)

- **Taint-based injection flaws** — SQL injection, XSS, command injection. These require dataflow/taint tracking, which is deliberately out of scope in Phase 1 (adding it would make Progmune a generic SAST competitor; protocol-sequence verification is the differentiator).
- **SCA / dependency vulnerabilities** — hallucinated package names, supply-chain issues. Separate tooling exists for this.
- **Runtime behavior** — Progmune is static analysis only; no DAST/sandbox execution.
- **Obfuscated or dynamic code** — `eval`, `Function` constructor, and heavily obfuscated flows degrade regex/IR detection recall.
- **Known failure boundaries are documented** rather than hidden: if Progmune cannot verify a language (e.g. Go), Confidence is lowered instead of pretending 100%.

→ [Full Coverage Matrix](docs/coverage-matrix.md)

---

## Benchmarks

Public, reproducible precision data. All numbers measured against gold-annotated benchmarks.

### TypeScript (Blind Benchmark v6)

| Metric | Value |
|--------|-------|
| Precision | 86.8% |
| Recall | 83.6% |
| F1 | 85.2% |
| Projects | 10 (ecommerce, blog, chat, crm, forum, wiki, issuetracker, filestorage, todo, scheduler) |

### C (Gold Benchmark — research status)

C analysis is **research-only**: gold benchmark F1=16.5% across 4 repos (curl, libssh, nginx, openssl). The bottleneck is rule coverage, not context. L3 (cross-function) was terminated with data; L4 (pointer/CFG) is a multi-year research problem and not planned. See [C Language Status](docs/c-language-status.md) for the full picture and reasoning.

### P0-P3 Rule Injection (2026-08)

- **+19 new detections** across 10 TS projects, **0 false positives** across 6 C repos + PostgreSQL
- Bootstrapping deadlock broken: all 21 protocol namespaces now have rule vocabulary
- `excludePatterns` + `languages` architecture for FP management

→ [Two-Hump Report](docs/two-hump-report.md) · [P0-P3 Final Report](docs/p0-p3-final-report.md)

---

## Architecture

```
SDK (src/sdk.ts)           verify() → APPROVED / NEEDS_REVIEW / BLOCKED
  └─ Trust Engine           4-dimension scoring → Decision
       ├─ Policy Engine     Enterprise policy enforcement (ALLOW/WARN/BLOCK)
       ├─ SSG Validator     Protocol state machine verification
       ├─ Protocol Detector  Regex-based protocol step detection (22 detectors)
       ├─ IR Extractor      TypeScript AST → function IR (ts-morph)
       ├─ Repair Executor   detect → plan → fix → validate → commit/rollback
       └─ Knowledge Base    31 domains, 140 rules, evidence chains
```

### Interfaces

| Interface | Purpose |
|-----------|---------|
| **SDK** (`verify()`) | One-call API for developers |
| **CLI** (`npm run trust`) | Command-line trust checks |
| **MCP Server** | Claude Code integration (`progmune_check`, `progmune_trust_check`) |
| **GitHub Action** | CI/CD gate — blocks unverified AI code at PR |
| **Trust API** | `POST /trust/check` — machine-to-machine |

---

## Scientific Foundation

Progmune is built on the premise that **LLM outputs are statistical performances, not reasoning** — a view developed by Subbarao Kambhampati et al. in the position paper ["Stop Anthropomorphizing Intermediate Tokens as Reasoning/Thinking Traces!"](https://arxiv.org/abs/2505.22285) (arXiv:2505.22285, 2025) and elaborated in his ICML 2026 talk "On the Role of Verifiers and Thinking Traces in Reasoning Models". Rather than trusting what the model says about code, Progmune verifies what the program actually does — using protocol state machines, IR extraction, and evidence-backed decision chains.

Coverage-gap analysis borrows the "two-hump problem" terminology **as a cross-domain analogy** from Sergei Gukov's work in mathematical physics (the Andrews-Curtis conjecture in group theory, 2026) — it describes a bimodal coverage distribution, not a collaboration. See [Two-Hump Report](docs/two-hump-report.md) for the full methodology.

→ [Investor Whitepaper](docs/Progmune_投资人白皮书_v2.0.html) · [Trust Decision Model](docs/ai-trust-decision-model-v1.md)

---

## Contributing

See [CLAUDE.md](CLAUDE.md) for architecture and code conventions, and [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow.

High-impact contribution areas:
- **Framework adapters** (Express, Next.js, FastAPI) — the #1 product gap
- **Python verification rules** — extend beyond TypeScript
- **Bug fixes** for existing detectors and safeguards

---

## Status

- **Runtime Pipeline:** Detect → Explain → Repair → Validate (L1–L4)
- **Trust Engine:** 4-dimension scoring with binary explainability gate
- **MCP Tools:** 19 — `progmune_trust_check`, `progmune_score`, `progmune_policy_check`, `progmune_certify`, and more
- **Framework Adapters:** Express ✅, tRPC ✅, NestJS partial (2/13)
- **Knowledge Base:** 31 domains, 148 protocol rules, 22 detectors, 26 safeguards, PLSB 13/13 categories
- **Corpus:** 2,500+ trajectories across 6+ repositories
- **Current focus:** Framework adaptation + enterprise PoC validation

---

## License

MIT — [LICENSE](LICENSE)
