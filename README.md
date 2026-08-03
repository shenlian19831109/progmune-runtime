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
| **C** | ⚠️ Research | Gold benchmark: curl F1=45.7%, libssh F1=46.2%. L3 cross-function experiment terminated — L4 (pointer/CFG) needed. |
| **Python** | 🔨 IR only | IR extractor exists (`extract-ir-python.ts`), no verification rules yet |
| **Go, Java** | ❌ None | Planned |

**Framework adapters: 0/13.** Express, Next.js, NestJS, Fastify, Django, FastAPI — none have dedicated adapters yet. Rules use generic `\w*` prefix patterns. Framework adaptation is the #1 product gap.

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

### C (Gold Benchmark v7)

| Repo | Precision | Recall | F1 | Samples |
|------|-----------|--------|-----|---------|
| curl | 30.9% | 87.5% | 45.7% | 85 |
| libssh | 36.0% | 64.3% | 46.2% | 47 |
| nginx | — | — | 0 FP | 50 |
| redis | — | — | 0 FP | 50 |

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

Progmune is built on the premise that **LLM outputs are statistical performances, not reasoning** (Kambhampati et al., ICML 2026). Rather than trusting what the model says about code, Progmune verifies what the program actually does — using protocol state machines, IR extraction, and evidence-backed decision chains.

Recent work applies Sergei Gukov's "Two-Hump Problem" framework to understand and systematically close detection capability gaps.

→ [Whitepaper](WHITEPAPER.md) · [Positioning](POSITIONING.md)

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
- **Tests:** 92 passing
- **Knowledge Base:** 31 domains, 140 protocol rules, 22 detectors, 26 safeguards
- **Corpus:** 2,500+ trajectories across 6+ repositories
- **Current focus:** Framework adaptation + enterprise PoC validation

---

## License

MIT — [LICENSE](LICENSE)
