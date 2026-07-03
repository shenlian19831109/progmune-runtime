# Progmune Quick Start

Verify AI-generated software in 5 minutes.

## 1. Install

```bash
npm install progmune-runtime
```

## 2. Scan Your Code

```bash
# Verify a single file
npx progmune-runtime verify src/server.ts

# With explanation
npx progmune-runtime verify src/server.ts --explain

# Generate a certificate
npx progmune-runtime certify src/server.ts
```

Output:
```
BLOCK — TLS handshake violation: missing tls_close_notify before socket close
  Evidence: RFC 8446, 3 repos (curl, nginx, openssl), 180 production days, 0 false escalations
  Fix: add tls_close_notify() before closing the connection
```

## 3. See What's Covered

```bash
npx progmune-runtime dashboard
```

Shows enterprise coverage — which protocols are BLOCK/WARN/INFO today.

## 4. Set Up CI Gate

```yaml
# .github/workflows/progmune.yml
name: Progmune Policy Check
on: [pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shenlian19831109/progmune-runtime@main
        with:
          project_path: .
          strict: false
```

## 5. Next Steps

- [Enterprise Dashboard](docs/RUNTIME_ARCHITECTURE.md) — full coverage + deployment runbook
- [API Reference](#) — `verify()`, `certify()`, `policy()`, `dashboard()`
- [Deployment Runbook](src/enterprise-dashboard.ts) — phased rollout plan
- [Asset Library](src/asset-quality.ts) — Production-ready verification assets

---

## What Progmune Checks

| Protocol | Status | Confidence |
|----------|--------|------------|
| TLS Handshake | ✅ BLOCK | 91% |
| Authentication | ✅ BLOCK | 85% |
| File Lifecycle | ⚠️ WARN | 74% |
| SSH Connection | ⚠️ WARN | 68% |
| HTTP Request | ⚠️ WARN | 62% |

Progmune does not trust what the model says — it verifies what the program actually does.
