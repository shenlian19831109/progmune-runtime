# Progmune

## AI Trust Decision Engine for AI-generated software.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)
[![TS Benchmark](https://img.shields.io/badge/TS%20R98.5%25%20P100%25-22c55e)]()
[![Python Benchmark](https://img.shields.io/badge/Python%20R100%25%20P100%25-22c55e)]()

> [中文版](https://github.com/shenlian19831109/progmune-runtime/blob/main/README.zh-CN.md) · English Version

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
| **Injection (Python, source-level)** | SQL built with f-string/`%`/`.format`/concatenation, command injection via dynamic subprocess args, SSRF via user-controlled URL fetches, SSTI via template-string sinks, XXE via external-entity parser config, eval/exec on user input |
| **Web (Python, source-level)** | XSS via `{{ var\|safe }}`/autoescape-off templates, path traversal via user-controlled file paths, CSRF via `@csrf_exempt` or GET state changes, authorization by client cookies, hardcoded JWT secrets (incl. cross-module constants) |

Source-level detections use an extractor-marker architecture: the IR extractor performs taint tracking, import resolution, and cross-file analysis (templates, module constants), emitting synthetic markers that rules consume — zero pipeline changes, fully auditable.

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

→ [Trust Decision Model](https://github.com/shenlian19831109/progmune-runtime/blob/main/docs/ai-trust-decision-model-v1.md)

---

## Coverage

Progmune is honest about what it can and cannot verify.

| Language | Status | Evidence |
|----------|--------|----------|
| **TypeScript / JavaScript** | ✅ Production | Blind benchmark: **recall 98.5% / precision 100%** (795 gold findings, 100 projects) |
| **Python** | ✅ Production | Blind benchmark: **recall 100% / precision 100%** (729 gold findings, 90 projects); real-world validation: PyGoat (OWASP vulnerable-by-design Django app) **67 TP / 0 FP, 100% labeled precision**; three well-written apps (django/fastapi realworld, django-unicorn) with 0 false-positive true findings |
| **C** | ⚠️ Research-only | Gold benchmark F1=16.5%. L3 cross-function experiment terminated; L4 not planned. See [C Language Status](https://github.com/shenlian19831109/progmune-runtime/blob/main/docs/c-language-status.md). |
| **Go, Java** | ❌ None | Planned |

**Multi-language IR (registry-based).** TypeScript (ts-morph) and Python (AST) extractors are registered entries in one registry (`src/extract-project-ir.ts`); `extractProjectIR` merges every detected language into a single function IR shared by the agent loop, `execute()`, and the MCP server — the agent composes function-protocol chains across both languages. Adding a language (Go, Java, …) = register one extractor entry; callers don't change.

**Framework adapters: 2/13.** Express ✅ and tRPC ✅ have dedicated detectors; Next.js has version-aware governance; NestJS is partial. Django, FastAPI and 8 more remain — framework adaptation is the #1 product gap.

### What Progmune does NOT cover (honest boundaries)

- **TS-side taint-based injection flaws** — the source-level SQLi/XSS/SSRF detections ship for Python; the TypeScript extractor is name/call-based, so TS injection classes remain uncovered (documented, not hidden).
- **SCA / dependency vulnerabilities** — hallucinated package names, supply-chain issues. Separate tooling exists for this.
- **Runtime behavior** — Progmune is static analysis only; no DAST/sandbox execution.
- **Framework internals** — well-known framework dispatch/cache machinery (e.g. django-unicorn internals) can produce a small number of boundary false positives; they are documented per-corpus in the benchmark gold files.
- **Known failure boundaries are documented** rather than hidden: if Progmune cannot verify a language (e.g. Go), Confidence is lowered instead of pretending 100%.

→ [Full Coverage Matrix](https://github.com/shenlian19831109/progmune-runtime/blob/main/docs/coverage-matrix-en.md)

---

## Benchmarks

Public, reproducible precision data. All numbers measured against gold-annotated benchmarks.

### TypeScript (Blind Benchmark v6 — 100 projects)

| Metric | Value |
|--------|-------|
| Precision | **100%** (0 factual FPs) |
| Recall | **98.5%** (effective 100% — the 12 non-detected findings are excluded by methodology) |
| Gold findings | 795 across 100 projects (90 style-variants + 10 model-variants) |

### Python (Blind Benchmark v1 — 90 projects)

| Metric | Value |
|--------|-------|
| Precision | **100%** |
| Recall | **100%** |
| Gold findings | 729 across 90 style-variant projects |

### Real-world validation (PyGoat, OWASP vulnerable-by-design Django app)

| Metric | Value |
|--------|-------|
| Labeled precision | **100%** (67 true positives / 0 false positives, per-detection human review) |
| Classes covered | 14 vulnerability classes incl. SQLi, SSRF, path traversal, XSS, SSTI, XXE, command injection, deserialization, CSRF (both shapes), cookie authorization, hardcoded secrets |
| Well-written apps | django-realworld, fastapi-realworld, django-unicorn — 0 false-positive true findings; 3 documented framework-internal boundary FPs |

→ [Real-world validation report](https://github.com/shenlian19831109/progmune-runtime/blob/main/blind-benchmark/REALWORLD_APP_V1.md) · [Benchmark baseline](https://github.com/shenlian19831109/progmune-runtime/blob/main/blind-benchmark/BASELINE_v6.md)

### C (Gold Benchmark — research status)

C analysis is **research-only**: gold benchmark F1=16.5% across 4 repos (curl, libssh, nginx, openssl). The bottleneck is rule coverage, not context. L3 (cross-function) was terminated with data; L4 (pointer/CFG) is a multi-year research problem and not planned. See [C Language Status](https://github.com/shenlian19831109/progmune-runtime/blob/main/docs/c-language-status.md) for the full picture and reasoning.

### P0-P3 Rule Injection (2026-08)

- **+19 new detections** across 10 TS projects, **0 false positives** across 6 C repos + PostgreSQL
- Bootstrapping deadlock broken: all 21 protocol namespaces now have rule vocabulary
- `excludePatterns` + `languages` architecture for FP management

→ [P0-P3 Final Report](https://github.com/shenlian19831109/progmune-runtime/blob/main/docs/p0-p3-final-report.md)

---

## Architecture

```
SDK (src/sdk.ts)           verify() → APPROVED / NEEDS_REVIEW / BLOCKED
  └─ Trust Engine           4-dimension scoring → Decision
       ├─ Policy Engine     Enterprise policy enforcement (ALLOW/WARN/BLOCK)
       ├─ SSG Validator     Protocol state machine verification
       ├─ Protocol Detector  Regex-based protocol step detection (22 detectors)
       ├─ IR Extraction      Registry-based: TS (ts-morph) + Python (ast module)
       │                     merged into one function IR per project;
       │                     source-level markers: taint tracking, import resolution,
       │                     qualified call chains, cross-file template analysis
       ├─ Repair Executor   detect → plan → fix → validate → commit/rollback
       └─ Knowledge Base    31 domains, 148 rules, evidence chains
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

## Community & Feedback

<p align="center">
  <img src="https://github.com/shenlian19831109/progmune-runtime/blob/main/assets/wechat-group.png?raw=true" width="200" alt="WeChat group QR code" />
  &nbsp;&nbsp;&nbsp;
  <img src="https://github.com/shenlian19831109/progmune-runtime/blob/main/assets/whatsapp-group.jpg?raw=true" width="200" alt="WhatsApp group QR code" />
</p>

Your feedback shapes Progmune. Scan the QR code to join the user discussion group (WeChat / WhatsApp), or open a [GitHub Issue](https://github.com/shenlian19831109/progmune-runtime/issues) for bug reports, feature requests, and suggestions.

**Auto-reply bots are live on both official messaging channels** — keyword-based instant replies via the WeChat Official Account bot ([`wechat-bot/`](wechat-bot/README.md)) and the WhatsApp Business API bot ([`whatsapp-bot/`](whatsapp-bot/README.md)). Follow the official account / message the business number with "help" to see all commands.

---

## Scientific Foundation

Progmune is built on the premise that **LLM outputs are statistical performances, not reasoning** — a view developed by Subbarao Kambhampati et al. in the position paper ["Stop Anthropomorphizing Intermediate Tokens as Reasoning/Thinking Traces!"](https://arxiv.org/abs/2505.22285) (arXiv:2505.22285, 2025) and elaborated in his ICML 2026 talk "On the Role of Verifiers and Thinking Traces in Reasoning Models". Rather than trusting what the model says about code, Progmune verifies what the program actually does — using protocol state machines, IR extraction, and evidence-backed decision chains.

→ [Investor Whitepaper](https://github.com/shenlian19831109/progmune-runtime/blob/main/docs/Progmune_投资人白皮书_v2.0.html) · [Trust Decision Model](https://github.com/shenlian19831109/progmune-runtime/blob/main/docs/ai-trust-decision-model-v1.md)

---

## Contributing

See [CLAUDE.md](https://github.com/shenlian19831109/progmune-runtime/blob/main/CLAUDE.md) for architecture and code conventions, and [CONTRIBUTING.md](https://github.com/shenlian19831109/progmune-runtime/blob/main/CONTRIBUTING.md) for the development workflow.

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
- **Knowledge Base:** 31 domains, 148 protocol rules, 22 detectors, 26 safeguards, PLSB 13/13 categories — plus 15 source-level detection rules (Python)
- **Corpus:** 2,500+ trajectories across 6+ repositories; blind benchmarks 100 (TS) + 90 (Python) projects; real-world validation on 4 application repos
- **Current focus:** Enterprise PoC validation + remaining framework-internal boundary FPs

---

## License

MIT — [LICENSE](https://github.com/shenlian19831109/progmune-runtime/blob/main/LICENSE)
