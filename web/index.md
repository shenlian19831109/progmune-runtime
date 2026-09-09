# Progmune — AI Trust Decision Engine for AI-generated software

Progmune verifies that code — written by AI or humans — follows correct **protocol lifecycles**: TLS handshakes, auth flows, payment integrity, resource management. These violations span sequences of function calls, making them invisible to pattern-based SAST and dependency-level SCA.

**Output:** Trust Score + Decision (`APPROVED` / `NEEDS_REVIEW` / `BLOCKED`) + auditable evidence chain. Verdicts come from a deterministic protocol state machine — an LLM never judges.

## Install

```bash
npm install progmune-runtime
npm run sdk src/server.ts --explain
```

## Two paths

- **Generate path (interception):** code generated through Progmune is validated before it lands on disk — violations are corrected or retried, never written.
- **Verify path (post-hoc):** any codebase — Copilot, Cursor, or human-written — checked via CLI / SDK / MCP / CI.

## Coverage

- **TypeScript / Python:** production. Blind test 795 gold: Recall 98.5% (effective 100%) / Precision 100% / 0 FP (TS); 729 gold 100% / 0 FP (Python).
- **C / Go:** annotation-driven Beta (~2–3 annotations per protocol; unannotated code is not checked).
- **Java:** in progress.
- **Frameworks:** 12 adapters real-world validated — Express, tRPC, FastAPI, Django, Flask, Fastify, Next.js, NestJS, Koa, Hapi, Gin, Fiber.

## Positioning (honest boundaries)

- Auxiliary checker, not a deployment gate.
- Fully local static analysis — code never leaves your machine. Masked violation fingerprints (hashed function names, no source) upload anonymously by default; opt out with `PROGMUNE_HUB=off`.
- Open source (MIT). Three independent third-party audits (2026-09) completed; response published.

## Links

- GitHub: https://github.com/shenlian19831109/progmune-runtime
- npm: https://www.npmjs.com/package/progmune-runtime
- Docs: https://progmune.top/docs.html
- llms.txt: https://progmune.top/llms.txt
- Contact: shenlian1983@qq.com
