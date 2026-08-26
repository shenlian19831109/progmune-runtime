# CLAUDE.md — Progmune

> AI Software Verification Infrastructure. Protocol lifecycle verification for AI-generated code.

## One sentence

Progmune verifies that AI-generated code follows correct protocol lifecycles (TLS handshake, auth flow, payment integrity, resource management) — violations that SAST/SCA cannot see because they span function-call sequences.

## Build, Test, and Run

```bash
# Build (TypeScript → dist/)
npm run build          # tsc -p tsconfig.json && tsc -p tsconfig.mcp.json

# Tests
npm run test:unit      # vitest (excludes stress/soak/chaos)
npm run test:all       # all tests including stress/soak/chaos
npm run test:watch     # vitest watch mode
npm run test:coverage  # vitest with v8 coverage (floor: 8/7/8/8)

# Verify a file
npm run sdk src/server.ts --explain   # → BLOCK/WARN/ALLOW + evidence

# Governance
npm run governance     # full governance audit (terminal)
npm run governance:json # JSON output
npm run trust           # trust check
npm run dashboard       # governance dashboard

# Benchmarks
npm run precision:all   # full precision benchmark
npm run coverage        # coverage dashboard
```

**No linter or formatter is configured.** There is no `.eslintrc`, `.prettierrc`, or `eslint.config.*`. Do not add one unless asked.

## Architecture

```
SDK (src/sdk.ts)           verify() / fix() → BLOCK / WARN / ALLOW
  └─ Trust Engine (src/trust/)   4-dimension scoring → Decision
       ├─ SSG Bridge (src/trust/ssg-bridge.ts)   Alias matching + project aliases
       │    └─ SSG Validator (src/ssg-validator.ts)   Protocol state machine
       ├─ Framework Adapters (src/frameworks/)
       │    ├─ Express (express-detector.ts)   Routes + middleware + security
       │    └─ NestJS (nestjs-detector.ts)   Decorator-based route analysis
       ├─ Policy Engine (src/policy/)   Enterprise policy enforcement
       ├─ Protocol Detector (src/protocol-detector.ts)   Regex safeguard rules
       ├─ IR Extraction (src/extract-ir.ts)   ts-morph AST → function IR
       └─ Knowledge (src/knowledge-*.ts)   Units, ontology, evolution, flywheel
```

### Key modules

| Module | Path | Purpose |
|--------|------|---------|
| **SDK** | `src/sdk.ts` | One-call public API: `verify()`, `explain()`, `getCompatibility()`. |
| **SSG Bridge** | `src/trust/ssg-bridge.ts` | Connects SSG state machine to trust pipeline. Alias exact-match (O(1)) + wildcard prefix-match. Project-level aliases via `.progmune_aliases.json`. |
| **SSG Validator** | `src/ssg-validator.ts` | Protocol state machine. Consumes function annotations (`pre_states`/`post_states`/`aliases`) and validates call sequences against protocol definitions. |
| **Protocol Detector** | `src/protocol-detector.ts` | Regex-based protocol step detection — fallback path only (C 等无 IR 语言). ~22 detectors + 26 safeguards. All patterns use `\w*` prefix/suffix for language-agnostic matching. |
| **IR Extractor** | `src/extract-ir.ts` | TypeScript AST → Function IR using ts-morph. Extracts function signatures, JSDoc tags (`@purpose`, `@requires`, `@produces`, `@useWhen`), protocol annotations. |
| **Call Sequence Builder** | `src/call-sequence.ts` | P4.6 跨函数传播：入口函数调用链传递展开（深度 ≤4、环安全）+ helper 片段抑制 + 规则名/叶子原语不内联；`collectProjectFunctionNames` 供词段匹配门控。 |
| **IR Extraction (merged)** | `src/extract-project-ir.ts` | Language registry (detect + extract per language): TypeScript + Python merged into one FunctionInfo list. Shared by agent loop (`extractIRWithDelta`), `execute()`'s ir.json write, and MCP server. Adding a language = one registry entry. |
| **Trust Engine** | `src/trust/engine.ts` | 5-stage pipeline: Collect → Normalize → Score → Decide → Assemble. 4 dimensions: Policy Compliance (35%), Protocol Safety (30%), Verification Coverage (20%), Governance Integrity (15%). |
| **Policy Engine** | `src/policy/engine.ts` | Evaluates policy rules against certified files. Returns ALLOW/WARN/BLOCK. |
| **Repair Executor** | `src/repair-executor.ts` | applyFix → verifyRepair → commit/rollback pipeline. |
| **MCP Server** | `src/mcp-server.ts` | Exposes Progmune as MCP tools for Claude Code. Compiled separately (tsconfig.mcp.json) as ESM. |

### Subdirectories (module pattern)

Each subdirectory follows the same convention: `index.ts` barrel + `types.ts` + `cli.ts` + `formatters/`:

| Dir | Phase | Purpose |
|-----|-------|---------|
| `src/audit/` | Phase 9 | AI Code Governance audit reports (terminal, JSON, markdown, HTML) |
| `src/badge/` | — | SVG badge server (port 3500) |
| `src/ledger/` | Phase 9-10 | Provenance tracking, accountability, signatures |
| `src/plsb/` | Phase 9 | PLSB v1.0 artifact and leaderboard |
| `src/policy/` | Phase 11 | Policy enforcement engine |
| `src/trust/` | Phase 1 | Trust Decision Engine (public API) |

## Code Conventions

### TypeScript

- **`import type` for types, named imports for values.** Node builtins first (`crypto`, `fs`, `path`), then external packages, then internal relative imports.
- **String-literal unions** for enumerated values: `"BLOCK" | "WARN" | "ALLOW"`, `"critical" | "high" | "medium" | "low"`, `"APPROVED" | "NEEDS_REVIEW" | "BLOCKED"`.
- **JSDoc on every public export.** Top-of-file JSDoc explains the module's role and sometimes includes ASCII architecture diagrams. Example:
  ```typescript
  /**
   * Progmune SDK — Simple one-call API for AI Code Governance.
   *
   * Usage:
   *   import { verify } from "@progmune/sdk";
   *   const result = verify("./server.ts");
   */
  ```
- **Section dividers**: `// ── Section Name ──` for internal sections, `// ═══════ Major Section ═══════` for file-level divisions.
- **Phase numbering in headers**: `/** Phase N: Module Name — description */`. Phases don't imply sequential dependency — they're feature area labels.

### Circular dependency handling

**Lazy `require()` inside function bodies** with try/catch graceful degradation. This is an intentional pattern, not an anti-pattern. Example from `src/trust/engine.ts`:
```typescript
function collectViolations() {
  const { certify } = require("../certify");
  // ...
}
```
When adding cross-module imports, prefer lazy require() if the dependency graph is complex.

### Tests

- **Colocated with source**: `src/*.test.ts` (not a separate `__tests__/` directory).
- **Explicit vitest imports**: `import { describe, it, expect } from "vitest"` (no globals).
- **`describe("module", () => { it("does X", () => {...}) })`** — descriptive strings.
- **Tests avoid filesystem I/O** where possible (documented in test file headers).
- **Coverage floor is intentionally low** (8/7/8/8) — these are regression floors, not targets. Do not be alarmed by low coverage numbers.

### Mixed-language comments

Some modules (especially `extract-ir.ts`) contain Chinese comments. This is acceptable. Do not translate existing comments without asking.

## Three TsConfigs

1. **`tsconfig.json`** — main source (`src/**/*.ts`), targets CommonJS, **excludes** `src/mcp-server.ts` and root `*.ts` files.
2. **`tsconfig.mcp.json`** — MCP server only (`src/mcp-server.ts`), targets ESM, separate build step.
3. Build concatenates: `tsc -p tsconfig.json && tsc -p tsconfig.mcp.json && mv dist-mcp/mcp-server.js dist/mcp-server.mjs`

## Benchmark and Corpus Data

### What's vendored (gitignored — generate via scripts)

- `benchmarks/curl/`, `benchmarks/libssh/`, `benchmarks/nginx/`, `benchmarks/openssl/`, `benchmarks/redis/`, `benchmarks/nghttp2/`, `benchmarks/apache/` — C repo clones for gold benchmarking
- `benchmark-pilot/`, `blind-benchmark/generated/`
- `.progmune_corpus/`, `.progmune_generated/`, `.progmune_keys/`, `.progmune_memory/`

### What's checked in (do not gitignore)

- `benchmarks/postgresql/` — PostgreSQL auth module benchmark source
- `benchmarks/*-labels.json` — Gold labels for precision/recall measurement
- `blind-benchmark/gold-benchmark-v5-v6-v7.ts` — Benchmark harness
- `blind-benchmark/reports/` — Benchmark result reports

### Key benchmark commands
```bash
npm run precision:all      # Full cross-repo precision benchmark
npm run precision:repo     # Per-repo breakdown
npm run corpus:stats       # Trajectory corpus statistics
npm run corpus:mine        # Rule mining from corpus
```

## Important Context (read before making changes)

### What Progmune IS
- A protocol lifecycle verification tool for AI-generated code
- Focused on behavior sequences (function call chains violating protocol state machines)
- TS + Python production, C research, Go/Java planned
- Output: Trust Score (0–100) + Decision (APPROVED/NEEDS_REVIEW/BLOCKED) + Evidence

### What Progmune is NOT
- ❌ NOT a CodeQL/Semgrep competitor (doesn't do pattern-based SAST)
- ❌ NOT a dependency scanner (doesn't check CVE databases)
- ❌ NOT a code generator (governs, doesn't generate)
- ❌ NOT a runtime monitor (no APM/RASP — static analysis only)

### Current coverage reality (as of 2026-08-24)

| Language | Status | Evidence |
|----------|--------|----------|
| TypeScript | ✅ Production | Blind benchmark 795 gold: Recall 98.5% (effective 100%) / Precision 100% / 0 FP; protocol rows ✅×4 (Auth/Payment/Data Integrity/Ledger) |
| Python | ✅ Production | Protocol rows ✅×2 (Auth/Resource Lifecycle): blind v1.2 66 gold 97%/100%/0 FP; source-level detection 729 gold Recall 100% |
| C | ⚠️ Research | 3.7.4: IR extraction merged via registry (`extract-ir-c.ts`) — app-level protocol lifecycles (auth/db/file/payment) verifiable via SSG state machine (app-level gold v2: P=91.7% / R=100% / F1=95.7%); TLS-level coverage still absent (old regex-route F1=16.5% historical baseline). L3/L4 conclusions unchanged. |
| Go, Java | ❌ None | No support |

**Framework adapters: 2/13 with structural analysis** (Express + NestJS), 5/13 with library aliases. Express detector does route extraction + middleware classification + security checks. NestJS detector parses decorators (@Controller, @UseGuards, @UsePipes) via ts-morph. Both feed into the trust engine pipeline. Remaining frameworks (Next.js, Fastify, Django, FastAPI, etc.) have basic alias coverage but no structural analysis. (Note: README's framework line also mentions a tRPC detector — `src/frameworks/trpc-detector.ts` exists with 3 rules; treat Express + NestJS as the structural adapters.)

### P0-P3 Rule Injection (2026-08-03, historical phase)

This work broke the "bootstrapping deadlock" — 16/21 protocol namespaces had zero rule vocabulary. By injecting +31 rules, +86 synthetic trajectories, +13 detectors, and +11 safeguards, all namespaces gained coverage. Key files:
- `src/inject-p0-vocabulary.ts` — Round 1 injection
- `scripts/inject-round2.js`, `scripts/inject-round3.js` — Rounds 2-3
- `scripts/verify-coverage-delta.ts` — Coverage measurement
- `docs/two-hump-report.md` — Full methodology (Gukov Two-Hump framework)

### Decision > Score

The product philosophy: **enterprises care about "can I deploy?" not "is my score 58 or 61."** The Trust Engine outputs a Decision first, with Score as supporting evidence. Critical violations → hard BLOCK regardless of score.

### Knowledge network thesis (validated with limits, 2026-08-12)

The core thesis — "every new codebase makes every verification stronger" — was tested via a controlled cross-project experiment (3 Express projects: clean, broken-flow, OAuth). Results:

**Confirmed — library-level alias transfer:**
`bcrypt.compare → verify_hash`, `jwt.sign → generate_jwt`, `app.listen → http_create_server` work identically in ANY project using the same library. Library aliases are inherently cross-project.

**Not confirmed — project-specific wrapper functions:**
`createSessionToken`, `sendOrderStatusNotification` etc. do NOT transfer. They require per-project `.progmune_aliases.json` configuration.

**Verdict:** The thesis holds at the library level. Adding a new project that uses new libraries (e.g., Prisma, Knex) enriches the global alias table for all projects. But internal wrapper functions always need project-level mapping. The narrative should be: "every new library makes every verification stronger" — not "every new codebase."

### What NOT to do

- **Don't add TypeScript rules casually** — TS blind benchmark is at Precision 100% / 0 FP (795 gold); any new TS rule must pass the gold-benchmark zero-drift check before landing.
- **Don't invest in L4 C analysis** (CFG/dataflow/pointer) — L3 experiment was terminated with data. This is a multi-year research problem.
- **Don't build a SaaS dashboard** — no enterprise PoC exists yet. Phase 1 of development plan explicitly defers this.
- **Don't trust the immunology metaphor for external communication** — keep it internal. External narrative is "protocol lifecycle verification."
- **Don't add linting/formatting configs** without asking — the project intentionally has none.

### Engineering hygiene notes

- Package manager: **npm** (package-lock.json is the canonical lock file)
- `pnpm-lock.yaml` is in .gitignore — do not reintroduce it
- Shell scripts live in `scripts/`, not root
- `test-real-requests/` is a vendored test fixture (gitignored, has its own .git)
- Working tree should stay clean — the 2026-08-03 cleanup committed all pending P0-P3 work
