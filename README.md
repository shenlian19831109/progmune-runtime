# Progmune Runtime

## AI Software Verification Infrastructure

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)
[![KB](https://img.shields.io/badge/KB-10_units_·_3_stable-22d3ee)]()
[![Precision](https://img.shields.io/badge/Precision-58%25_(curl)-fbbf24)]()

*Knowledge-driven governance for AI-generated software. Every new codebase makes every verification stronger.*

**Progmune does not trust what the model says — it verifies what the program actually does.**
It checks whether AI-generated code follows the security protocols it's supposed to follow, backed by a continuously evolving protocol knowledge base.

---

## Quick Start

```bash
npm install progmune-runtime

# One-command verification
npm run sdk src/server.ts --explain

# Full system demo (30 seconds)
bash demo/demo.sh

# Governance dashboard
npm run dashboard
```

---

## What It Does

| Capability | Command | Description |
|-----------|---------|-------------|
| **Verify** | `npm run sdk <file>` | One-call AI code governance (→ BLOCK/WARN/ALLOW) |
| **Explain** | `npm run sdk <file> --explain` | Human-readable governance report with RFC refs |
| **Certify** | `npm run certify <file>` | AI Code Certificate (ontology-backed, audit-ready) |
| **Policy** | `npm run policy check <file>` | Deploy gate — blocks unverified AI code |
| **Status** | `npm run status` | Full system health (5 layers, debt, velocity) |
| **Dashboard** | `npm run dashboard` | Governance dashboard (localhost:3200) |

---

## Architecture

```
Enterprise:  verify("./server.ts") → BLOCK / WARN / ALLOW
                ↑
Runtime API:     verify() | explain() | fix()          [Stable]
                ↑
Governance:      Policy Engine | Certificate | CI/CD    [Product]
                ↑
Verification:    Resource | Protocol | Risk Model       [Capability]
                ↑
Knowledge:       Units | Ontology | Evolution           [Moat]
                ↑
Evidence:        Repos | Sequences | Benchmarks | RFC   [Foundation]
```

---

## Knowledge Base

| Domain | Asset | Maturity | Confidence | Validated On | RFC |
|--------|-------|----------|------------|-------------|-----|
| TLS | Handshake v1.0.0 | Stable ★ | 85% | curl, nginx | 8446 |
| SSH | Connection v1.0.0 | Stable ★ | 78% | curl, libssh | 4253 |
| HTTP | Request v1.0.0 | Stable ★ | 80% | nginx, Apache | 9110 |
| HTTP/2 | Session v0.8.0 | Validated ◉ | 68% | nghttp2 | 9113 |

**10 Knowledge Units · 6 Protocol Domains · 7 Repos · 605 Evidence Sequences**

---

## Detection Engine

**7 Risk Patterns** — evidence-backed, severity-weighted, RFC-referenced.

| Pattern | Severity | Confidence |
|---------|----------|------------|
| Missing Finished (TLS) | Critical | 91% |
| Resource Acquire No Release | Critical | 98% |
| SSH Without Auth | Critical | 78% |
| TLS Without Init | High | 85% |

**Precision** (curl, 85 labeled seqs): P=58% R=46% F1=51% (Resource Lifecycle) · [Full Report](docs/precision-report.html)

---

## Demo

```bash
bash demo/demo.sh
```

Shows 6 steps: verify → certify → policy → knowledge → network → explain.  
Also: `demo-auth/` — Express JWT + Refresh Token microservice with deliberate protocol violations (all caught).

---

## Documentation

| Document | Audience |
|----------|----------|
| [POSITIONING.md](POSITIONING.md) | Product strategy |
| [docs/WHITEPAPER_V6.html](docs/WHITEPAPER_V6.html) | Comprehensive (bilingual) |
| [docs/WHITEPAPER_EXTERNAL.html](docs/WHITEPAPER_EXTERNAL.html) | CISO, VP, Compliance |
| [docs/WHITEPAPER_INTERNAL.html](docs/WHITEPAPER_INTERNAL.html) | Engineering training |
| [docs/precision-report.html](docs/precision-report.html) | Public benchmark data |
| [docs/knowledge-index.html](docs/knowledge-index.html) | KB ecosystem page |

---

## CI/CD Integration

```yaml
- uses: shenlian19831109/progmune-runtime@main
  with:
    project_path: .
```

---

## License

MIT · [github.com/shenlian19831109/progmune-runtime](https://github.com/shenlian19831109/progmune-runtime)
