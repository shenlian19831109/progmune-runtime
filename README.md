# Progmune

## The Verification Runtime for AI-generated software.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)
[![Precision](https://img.shields.io/badge/Precision-curl%2036%25%20F1-fbbf24)]()
[![Tests](https://img.shields.io/badge/Tests-92%20passing-22c55e)]()

**Verify AI-generated software before production.** Detect protocol violations. Certify AI code. Enforce governance. Every new codebase makes every verification stronger.

Progmune does not trust what the model says — it verifies what the program actually does.

---

## One Command

```bash
npm run sdk src/server.ts --explain
```

Output: `BLOCK` / `WARN` / `ALLOW` — with evidence, RFC references, and repair suggestions.

---

## The Runtime Pipeline

```
Source Code → Extract IR → Verify → Explain → Repair → Validate → BLOCK/WARN/ALLOW
```

Progmune is not a scanner. It is a **Runtime** — it answers not just "what's wrong?" but "what should we do about it?"

| Capability | What it does |
|-----------|-------------|
| **Verify** | Protocol state machine validation against RFCs |
| **Explain** | Human-readable violation report with evidence chains |
| **Repair** | Automatic fix generation + verification + rollback |
| **Certify** | Ontology-backed AI Code Certificate (audit-ready) |
| **Govern** | CI/CD deploy gate — blocks unverified AI code |

---

## Quick Start

```bash
npm install progmune-runtime

# Verify a file
npm run sdk src/server.ts

# Full explanation with repair suggestions
npm run sdk src/server.ts --explain

# Governance dashboard
npm run dashboard

# Run benchmark suite
npm run precision:all
```

---

## Architecture

```
SDK:         verify("./server.ts") → BLOCK / WARN / ALLOW
               ↑
Runtime:       verify() | explain() | repair() | validate()
               ↑
Governance:    Policy Engine | Certificate | CI/CD Gate
               ↑
Verification:  SSG State Machine | Protocol Rules | Risk Model
               ↑
Knowledge:     Units | Ontology | Evolution | Evidence
               ↑
Intelligence:  FP Learning | Confidence Calibration | Decision Engine
```

---

## Benchmarks

Public, reproducible precision data across repositories:

| Repo | Precision | Recall | F1 | Samples |
|------|-----------|--------|-----|---------|
| curl | 23% | 75% | 36% | 85 |
| libssh | 27% | 86% | 41% | 47 |
| nginx | — | — | — | 50 |
| redis | — | — | — | 50 |

**[Full Benchmark Report →](benchmarks/reports/cross-repo-precision-latest.json)**

---

## Knowledge Base

Deep, not broad. Each knowledge unit is RFC-backed, multi-repo validated, and continuously evolving.

| Domain | Unit | Confidence | Validated On | RFC |
|--------|------|------------|-------------|-----|
| TLS | Handshake v1.0.0 | 85% | curl, nginx | 8446 |
| SSH | Connection v1.0.0 | 78% | curl, libssh | 4253 |
| HTTP | Request v1.0.0 | 80% | nginx, Apache | 9110 |
| HTTP/2 | Session v0.8.0 | 68% | nghttp2 | 9113 |

---

## Verification Intelligence

The engine learns from every false positive. Rules that produce too many false alarms are automatically suppressed. Confidence is calibrated by evidence, not hardcoded.

```
Alert → FP detected → Classify reason → Adjust confidence → Better decisions
```

**Real impact on benchmark data:**

| Repo | Before F1 | After VI | FP Reduction | Rules Suppressed |
|------|-----------|----------|-------------|-----------------|
| curl | 36% | **49%** | 47% (28/59) | 9 |
| libssh | 41% | **53%** | 41% (13/32) | 5 |
| **Combined** | **38%** | **51%** | **45%** | **14** |

**Why this matters:** Without VI, 77% of alerts are false positives. With VI, this drops to 63% — and improves with every deployment. The engine learns what NOT to alert on.

---

## Why "Progmune"?

The verification engine draws inspiration from program immunology — distinguishing "self" (correct code) from "non-self" (protocol violations) — but the product is a **verification runtime**, not an immunology metaphor.

For the academic foundation, see the [Whitepaper →](WHITEPAPER.md).

---

## Status

- **Runtime Pipeline:** Detect → Explain → Repair → Validate (L1–L4)
- **Tests:** 92 passing
- **Repair simulation:** 100% (standard violations)
- **Cross-repo benchmark:** 4 repos measured
- **Knowledge:** 10 units, 3 stable, 7 repos validated
- **Current focus:** FP reduction (97% → 40%) via Verification Intelligence

---

## License

MIT — [LICENSE](LICENSE)
