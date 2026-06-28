# Progmune Runtime v1.0 — Internal Technical Whitepaper

**Audience:** Engineering team, internal training, technical partners  
**Version:** 1.0 | June 2026  
**Status:** Production-ready

---

## 1. Architecture Overview

Progmune Runtime is a five-layer knowledge-driven governance system for AI-generated software.

```
Enterprise:  verify("./server.ts") → BLOCK/WARN/ALLOW
                ↑
Layer 5: Runtime API     verify() | explain() | fix()        [Stable public API]
                ↑
Layer 4: Governance      Policy Engine | Certificate | CI/CD   [Product]
                ↑
Layer 3: Verification    Resource | Protocol | State Machine   [Capability]
                ↑
Layer 2: Knowledge       Units | Ontology | Evolution          [Moat]
                ↑
Layer 1: Evidence        Repos | Sequences | Benchmarks | RFC  [Foundation]
```

### Data Flow

```
Source Code
    │
    ▼
IR Extraction (ts-morph / Python AST)
    │
    ▼
Protocol Detection
    ├── Resource Lifecycle Detector (acquire/release pairs, 5 categories)
    └── Protocol State Machine Detector (7 protocol definitions)
    │
    ▼
Risk Assessment (9 Detection Patterns, severity-weighted)
    │
    ▼
Knowledge Base Query (match against 10 Knowledge Units, 6 Domains)
    │
    ▼
Policy Evaluation (8 rules including risk-based, kb_coverage)
    │
    ▼
Decision → Certificate → CI Gate
```

---

## 2. Detection Engine

### 2.1 Resource Lifecycle Detector

**Module:** `src/resource-detector.ts` (222 lines)  
**Purpose:** Detect acquire/release mismatches using explicit resource pair patterns.

**5 Resource Categories:**

| Category | Acquire Patterns | Release Patterns |
|----------|-----------------|------------------|
| Memory | malloc, calloc, curlx_malloc, zmalloc, ngx_alloc | free, curlx_free, zfree, ngx_free |
| File | open, fopen, socket, curlx_open | close, fclose, shutdown |
| SSL/TLS | SSL_CTX_new, SSL_new, BIO_new, nghttp2_session_new | SSL_CTX_free, SSL_free, BIO_free, nghttp2_session_del |
| Connection | connect, Curl_connect, ngx_connect | disconnect, Curl_disconnect |
| Lifecycle | _init, _create, _setup, _open, _alloc | _free, _destroy, _cleanup, _close, _done |

**Detection Rules:**
1. acquire > release → potential resource leak
2. release > 0, acquire = 0 → possible double-free
3. release before acquire → use-after-release

**Exemptions:**
- Allocator functions (name contains create/alloc/new/init) — resource returned to caller
- Cleanup functions (name contains remove/cleanup/destroy/free) — expected to release
- Lifecycle category excluded from leak detection (too broad; only for double-free/UAF)

### 2.2 Protocol State Machine Detector

**Module:** `src/protocol-detector.ts` (170 lines)  
**Purpose:** Validate call sequences against expected protocol step ordering.

**7 Protocol Definitions (repo-agnostic patterns):**

| Protocol | Steps | Min Completeness |
|----------|-------|-----------------|
| TLS Handshake | init → connect → cleanup | 0.5 |
| SSH Connection | init → auth → done | 0.4 |
| HTTP Request | init → send → cleanup | 0.5 |
| Connection Lifecycle | init → transfer → done | 0.4 |
| Authentication | init → cleanup | 0.5 |
| HTTP/2 Session | init → send → close | 0.5 |
| QUIC Connection | init → transfer | 0.4 |

**Design:** All patterns use `\w*` prefix/suffix for repo-agnostic matching.  
A sequence must match ≥2 protocol steps to trigger detection (noise filter).

### 2.3 Risk Model

**Module:** `src/risk-model.ts` (248 lines)  
**Purpose:** Upgrade detection from boolean to structured risk assessment.

**9 Detection Patterns (evidence-backed, severity-weighted):**

| Pattern | Protocol | Severity | Confidence | Evidence |
|---------|----------|----------|------------|----------|
| Missing Finished | TLS | Critical | 91% | 135 seqs |
| TLS Double Free | TLS | Critical | 88% | 135 seqs |
| TLS Without Init | TLS | High | 85% | 135 seqs |
| SSH Without Auth | SSH | Critical | 78% | 135 seqs |
| SSH Missing Cleanup | SSH | High | 78% | 135 seqs |
| HTTP No Response | HTTP | Medium | 80% | 150 seqs |
| Resource Acquire No Release | Resource | Critical | 98% | 250 seqs |

**Risk → Decision Mapping:**
- Critical → BLOCK
- High → WARN
- Medium/Low → ALLOW

---

## 3. Knowledge Base

### 3.1 Knowledge Unit (core object model)

A Knowledge Unit is a versioned, evidence-backed, auditable protocol knowledge asset.

**Fields:**
```typescript
interface KnowledgeUnit {
  id, name, domain, category, maturity, lifecycle
  currentVersion, confidence, rfcReference
  validatedRepos[], validatedSequences, crossRepoMatrix
  concepts[]        // ProtocolConcept: ClientHello, ServerHello, etc.
  relations[]       // KnowledgeUnitRelation: depends_on, extends, etc.
  consumers[]       // KnowledgeConsumer: policies, certs, CI gates
  evidence[]        // Per-repo validation records
  versionHistory[]  // VersionSnapshot with DecisionRecord
  fpHistory[], fnHistory[]  // FP/FN per version
}
```

### 3.2 Knowledge Base Inventory (10 units, 6 domains)

**Stable (3):**
- TLS Handshake v1.0.0 — curl+nginx, RFC 8446, 85% confidence, 135 seqs
- SSH Connection v1.0.0 — curl+libssh, RFC 4253, 78% confidence, 135 seqs
- HTTP Request v1.0.0 — nginx+apache, RFC 9110, 80% confidence, 150 seqs

**Validated (1):**
- HTTP/2 Session v0.8.0 — nghttp2, RFC 9113, 68% confidence, 100 seqs

**Experimental (6):**
- TLS Certificate v0.2.0, TLS Session v0.1.0, TLS ALPN v0.1.0
- Connection Lifecycle v0.5.0, Authentication v0.4.0, QUIC Connection v0.2.0

### 3.3 Maturity Model

| Level | Criteria | Repos | Sequences | Confidence |
|-------|----------|-------|-----------|------------|
| experimental | Rule defined, not validated | 0 | 0 | 0% |
| validated | 1+ repo, 10+ seqs | ≥1 | ≥10 | ≥40% |
| stable | 2+ repos, 100+ seqs | ≥2 | ≥100 | ≥70% |
| certified | 3+ repos, 500+ seqs | ≥3 | ≥500 | ≥90% |

### 3.4 Knowledge Evolution (TLS example)

```
v0.1.0  ❌ REJECTED  (2026-06-25)  SSG auto-discovery, 27 FP, P=34%
         → Decision by: benchmark
         → Reason: Precision too low for governance

v0.5.0  ✅ APPROVED  (2026-06-26)  Resource Lifecycle Detector, FP -74%
         → Decision by: benchmark
         → Reason: P=58%, acceptable for dev environments

v0.9.0  ✅ APPROVED  (2026-06-26)  Cross-project validated (nginx)
         → Decision by: cross_repo_validation
         → Reason: 2-repo validation achieved, ready for stable

v1.0.0  ✅ APPROVED  (2026-06-28)  STABLE — 7 SSL backends, RFC 8446
         → Decision by: cross_repo_validation
         → Reason: OpenSSL source verified, production governance ready
```

---

## 4. Governance Layer

### 4.1 Policy Engine

**Module:** `src/policy/engine.ts`  
**8 Rules:**

| Rule | Severity | Threshold | Description |
|------|----------|-----------|-------------|
| confidence | block | ≥medium | Certificate confidence requirement |
| provenance | block | intact | Provenance chain integrity |
| violations | block | ≤0 | SSG ledger violations |
| human_review | block | ≥1 | Human in accountability chain |
| plsb_coverage | warn | ≥5 categories | PLSB benchmark coverage |
| fingerprint | warn | registered | Fingerprint verification |
| kb_coverage | warn | ≥3 stable | Knowledge Base maturity |
| risk | block | ≥High, ≥70% conf | Risk-based (protocol-agnostic) |

**Configurable:** `.progmune-policy.json` per project.

### 4.2 Certificate

**Module:** `src/certify.ts`  
Issues AI Code Certificate with:
- Session tracing, ledger consistency check, fingerprint verification
- Knowledge Base version + stable asset references
- Confidence level (high/medium/low)
- HTML certificate for audit/PDF export

### 4.3 CI/CD Gate

**Module:** `bin/progmune-ci.ts` + `.github/workflows/progmune-policy.yml`  
PR trigger → certify → policy check → BLOCK on violation → exit 1.

---

## 5. Runtime API (Public)

**Module:** `src/sdk.ts`

```typescript
import { verify, explain, fix, RUNTIME_VERSION } from "@progmune/sdk"

// Machine-consumable
const result = verify("./src/server.ts")
// → { runtimeVersion, decision, certificate, knowledge, evidence, risk }

// Human-readable
console.log(explain(result))
// → Runtime v1.0 | Decision: BLOCK
// → Missing Finished (Critical, 91%, RFC 8446)

// Future AI repair
const patch = fix(result)
```

**Stable:** `verify()`, `explain()`, `VerificationResult`, `RUNTIME_VERSION`  
**Internal (can change):** Everything else.

---

## 6. Evidence Repository

**Module:** `src/evidence-repository.ts`

Centralized store of all validation evidence across 7 repositories:
- curl (application, 100 seqs, 85 labeled)
- nginx (application, 100 seqs, 50 labeled)
- redis (application, 100 seqs, 50 labeled)
- apache (application, 100 seqs)
- openssl (protocol_library, 100 seqs)
- libssh (library, 100 seqs)
- nghttp2 (library, 100 seqs)

**Top Protocols by Evidence:** HTTP Request (3 repos), TLS Handshake (3 repos), SSH Connection (2 repos)

---

## 7. Benchmarks & Precision

### curl (C codebase, 85 labeled sequences)

| Detector | Precision | Recall | F1 | FP |
|----------|-----------|--------|-----|-----|
| SSG Auto-Discovery | 34% | 70% | 46% | 27 |
| Resource Lifecycle | 58% | 46% | 51% | 8 |
| Combined (Resource+Protocol) | 54% | 58% | 56% | 12 |

**FP Taxonomy:** 100% State Inference Noise (SSG overfitting on 29 training sequences).  
**Root cause fixed:** Switched to explicit resource pairs + protocol state machines.

---

## 8. Deployment

### Quick Start
```bash
npm install progmune-runtime
npm run status              # Full system health check
npm run precision           # Multi-repo precision benchmark
npm run dashboard           # Governance dashboard (port 3200)
npm run knowledge-api       # Knowledge API (port 3400)
npm run badge               # SVG badges (port 3500)
```

### CI/CD Integration
```yaml
- uses: shenlian19831109/progmune-runtime@main
  with:
    project_path: .
    author: ${{ github.actor }}@users.noreply.github.com
```

### SDK Integration
```typescript
import { verify } from "@progmune/sdk"
const r = verify("./src/server.ts")
if (r.decision === "BLOCK") process.exit(1)
```

---

## 9. Key Files Reference

| Category | Files |
|----------|-------|
| Detection | `src/resource-detector.ts`, `src/protocol-detector.ts`, `src/risk-model.ts` |
| Knowledge | `src/protocol-knowledge.ts`, `src/knowledge-evolution.ts`, `src/knowledge-api.ts` |
| Evidence | `src/evidence-repository.ts`, `src/evidence-growth.ts` |
| Governance | `src/certify.ts`, `src/policy/engine.ts`, `src/ledger/` |
| Runtime | `src/sdk.ts`, `src/progmune-status.ts` |
| CLI/Tools | `bin/progmune-ci.ts`, `src/multi-repo-precision.ts`, `src/precision-label.ts` |
| Infrastructure | `src/failure-corpus.ts`, `src/llm.ts`, `src/extract-ir.ts` |

---

*Internal document. Progmune Runtime v1.0. June 2026.*
