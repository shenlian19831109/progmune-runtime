# Progmune API Reference

## Core API

### `verify(filePath, options?)`

Verify AI-generated code against protocol rules.

```typescript
import { verify } from "progmune-runtime";

const result = await verify("src/server.ts", { explain: true });
// → { verdict: "BLOCK", violations: [...], alternatives: [...] }
```

**Options:**
| Option | Type | Description |
|--------|------|-------------|
| `explain` | boolean | Include human-readable explanation |
| `protocol` | string | Filter by protocol (TLS, Auth, File) |
| `strict` | boolean | Block on WARN as well as BLOCK |

**Returns:** `VerificationResult`
```typescript
{
  verdict: "BLOCK" | "WARN" | "ALLOW";
  violations: Violation[];
  alternatives?: RepairAlternative[];
  trace?: DecisionTrace;
}
```

---

### `certify(filePath, options?)`

Generate an AI Code Certificate.

```typescript
import { certify } from "progmune-runtime";

const cert = await certify("src/server.ts");
// → { certificateId: "CERT-...", status: "VALID", ... }
```

**Returns:** `Certificate`
```typescript
{
  certificateId: string;
  status: "VALID" | "WARNING" | "INVALID";
  verifiedAt: string;
  protocols: string[];
  evidence: EvidenceChain;
}
```

---

### `policy(filePath, options?)`

Check code against governance policy. Used in CI/CD gates.

```typescript
import { policy } from "progmune-runtime";

const result = await policy("src/server.ts", { level: "BLOCK" });
// → { pass: false, violations: [...] }
```

---

### `dashboard()`

Generate enterprise coverage dashboard.

```typescript
import { dashboard } from "progmune-runtime";

const report = await dashboard();
// → Enterprise coverage, Asset Library, Deployment Runbook
```

---

### `repair(violation, code)`

Auto-repair a detected violation.

```typescript
import { repair } from "progmune-runtime";

const outcome = await repair(violation, code);
// → { success: true, fixedCode: "...", appliedFix: "tls_close_notify" }
```

---

### `promotion(assetId)`

View or trigger Asset promotion.

```typescript
import { promotion } from "progmune-runtime";

const status = await promotion("TLS Handshake");
// → { tier: "Production Ready", score: 18/20, readyForPromotion: false }
```

---

### `trace(decisionId)`

Get full decision trace for any verification decision.

```typescript
import { trace } from "progmune-runtime";

const why = await trace("DEC-...");
// → { decision: "BLOCK", confidence: 91%, evidence: [...], provenance: [...] }
```

---

## CLI Commands

```bash
# Verify
npx progmune-runtime verify src/server.ts --explain

# Certify
npx progmune-runtime certify src/server.ts

# Policy check
npx progmune-runtime policy check src/server.ts

# Dashboard
npx progmune-runtime dashboard

# Status
npx progmune-runtime status

# Precision benchmark
npx progmune-runtime precision --all
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PROGMUNE_RANKER` | Ranker mode (`heuristic` or `learning`) | `heuristic` |
| `PROGMUNE_MODEL_WEIGHT` | Learning ranker weight | `0.3` |
| `PROGMUNE_ENFORCE` | Enforcement level (`warn` or `block`) | `warn` |
| `PROGMUNE_PROJECT_DIR` | Project directory for corpus storage | `.` |
