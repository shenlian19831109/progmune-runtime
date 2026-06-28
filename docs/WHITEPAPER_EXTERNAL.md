# Progmune Runtime — AI-generated Software Governance

**Audience:** CISO, Compliance Officers, Engineering VPs, Security Teams  
**Version:** 1.0 | June 2026

---

## Executive Summary

AI code generators (Claude, GPT, Copilot, Cursor) produce syntactically correct code at unprecedented speed. But syntax is not safety.

Progmune Runtime answers the question no other tool addresses: **"Does this AI-generated code follow the security protocols it's supposed to?"**

It's not a code scanner. It's not a linter. It's a governance runtime — a system that verifies, certifies, and enforces protocol-level security for AI-generated software, backed by continuously evolving protocol knowledge.

---

## 1. The Problem

### AI writes code. Who checks the protocol?

Traditional security tools (SAST, SCA) analyze code structure — syntax, data flow, known vulnerabilities. They cannot see **protocol lifecycle violations**: missing authentication steps, unreleased resources, session fixation, use-after-free patterns that emerge across a sequence of function calls.

When an AI generates code, it may:
- Skip the authentication step before accessing sensitive data
- Allocate a resource and never release it
- Close a connection without properly invalidating the session
- Commit a transaction without first checking authorization

These are not bugs in the code. They are violations of the protocol the code is supposed to follow. And they are invisible to every existing security tool.

### The compliance gap

As AI-generated code enters production, enterprises face a new question from regulators, auditors, and customers:

> "Can you prove this AI-generated code was properly validated?"

Without a governance system, the answer is no.

---

## 2. What Progmune Does

Progmune Runtime provides three capabilities in one system:

### Verify

```bash
npx progmune-runtime verify ./src/server.ts
```

One command checks whether AI-generated code follows the required security protocols. The result is a clear decision: **ALLOW**, **WARN**, or **BLOCK**.

### Explain

Every decision comes with a human-readable explanation:

```
Decision: BLOCK
Risk: Missing Finished (Critical, 91% confidence, RFC 8446)
Protocol: TLS Handshake v1.0.0
Verified against: curl, nginx, libssh (135 validated sequences)
Action: The TLS handshake was initiated but never completed.
        This connection may remain open or unverified.
```

### Certify

Progmune issues an AI Code Certificate — a signed, timestamped document proving that a specific file passed protocol security verification. Certificates reference the Knowledge Base version, RFC standards, and validation evidence. Audit-ready.

---

## 3. How It Works

Progmune is built on a continuously evolving **Protocol Knowledge Base** — a curated, versioned collection of protocol definitions (TLS, SSH, HTTP, HTTP/2) validated across real-world codebases (curl, nginx, Apache, libssh, OpenSSL, nghttp2).

When you run `verify()`, the system:
1. Extracts the call sequence from the target code
2. Matches it against the Knowledge Base to identify which protocol is in use
3. Checks for violations: missing steps, wrong ordering, incomplete lifecycles
4. Evaluates against your organization's governance policy
5. Returns a decision with full explainability

The Knowledge Base grows with every validation. Currently:
- **10 Knowledge Units** across **6 Protocol Domains**
- **3 Stable** assets (TLS, SSH, HTTP) validated on 2+ repositories each
- **700+ validated sequences** from **7 repositories**
- **RFC-referenced** (RFC 8446, RFC 4253, RFC 9110, RFC 7301, RFC 9000)

---

## 4. Who It's For

### Security Teams (AppSec)

**Problem:** AI-generated code bypasses protocol requirements in ways SAST tools cannot detect.  
**Solution:** Progmune catches protocol violations at the CI gate — before they reach production.  
**Result:** Protocol-level security coverage where existing tools are blind.

### Compliance & Audit Teams

**Problem:** "Can we prove this AI-generated code was checked?" — regulators, auditors, customers.  
**Solution:** AI Code Certificate + full provenance chain + RFC-referenced decisions.  
**Result:** Audit-ready evidence that governance was performed.

### Engineering Leadership

**Problem:** AI accelerates code production, but quality and security risk scale with volume.  
**Solution:** Automated governance gate in CI/CD — every AI-generated file verified before merge.  
**Result:** Velocity without vulnerability.

---

## 5. Deployment

### Option 1: GitHub Action (CI/CD Gate)

```yaml
- uses: shenlian19831109/progmune-runtime@main
  with:
    project_path: .
```

Every PR with AI-generated code is automatically verified. BLOCK verdicts prevent merge.

### Option 2: SDK Integration

```typescript
import { verify } from "@progmune/sdk"
const result = verify("./src/server.ts")
// → { decision: "BLOCK" | "WARN" | "ALLOW", ... }
```

Embed governance directly into your build pipeline, IDE plugin, or custom toolchain.

### Option 3: CLI

```bash
npm install progmune-runtime
npm run status              # System health
npm run dashboard           # Governance dashboard (localhost:3200)
```

---

## 6. Governance Dashboard

A live web dashboard showing real-time AI code governance health:
- **AI Assets tracked** — total files under governance
- **Verification rate** — percentage validated
- **Risk level** — PASS / WARN / FAIL
- **Protocol coverage** — which protocols are verified
- **Evidence repository** — which repos back the knowledge

---

## 7. Comparison

| Capability | Progmune | SAST (CodeQL, Semgrep) | AI Code Review |
|-----------|----------|------------------------|----------------|
| Protocol lifecycle detection | ✅ Core | ❌ | ⚠️ Probabilistic |
| Cross-function sequence analysis | ✅ | ❌ | ❌ |
| RFC-referenced decisions | ✅ | ❌ | ❌ |
| Audit-ready certificate | ✅ | ❌ | ❌ |
| CI/CD deploy gate | ✅ | ✅ | ❌ |
| Knowledge evolution (versioned) | ✅ | ❌ | ❌ |

Progmune does not replace SAST. It covers the gap SAST cannot see — **protocol-level violations in AI-generated code sequences.**

---

## 8. Enterprise Readiness

- **Open Source** (MIT License)
- **On-premises deployment** — no data leaves your infrastructure
- **Configurable policy** — define your own governance rules per project
- **Knowledge Packages** — deploy only the protocol domains you need
- **Compatibility** — Policy Engine, Certificate, CI Gate, Dashboard, API all version-locked for stability

---

## 9. Getting Started

```bash
# Install
npm install progmune-runtime

# Verify a file
npm run sdk src/server.ts --explain

# View governance dashboard
npm run dashboard

# CI integration
# Add .github/workflows/progmune-policy.yml to your repo
```

Full documentation: [github.com/shenlian19831109/progmune-runtime](https://github.com/shenlian19831109/progmune-runtime)

---

## 10. The Trust Layer for AI-Generated Code

AI code generation is here. The question is no longer "can AI write code" — it's "can we trust what AI wrote."

Progmune Runtime provides the trust layer: verify every AI-generated file against continuously evolving protocol knowledge, explain every decision, and certify every verification. Not a scanner. Not a linter. A governance runtime.

> **"Govern AI-generated software with continuously evolving protocol knowledge."**

---

**Progmune Runtime v1.0 — Knowledge-driven Governance for AI-generated Software.**  
*June 2026*
