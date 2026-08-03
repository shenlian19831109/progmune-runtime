# Contributing to Progmune

Thanks for your interest in contributing! Progmune is an AI software verification infrastructure that checks whether AI-generated code follows correct protocol lifecycles.

## Getting started

```bash
git clone https://github.com/shenlian19831109/progmune-runtime.git
cd progmune-runtime
npm install
npm run build
npm run test:unit          # verify everything works
```

## Development workflow

1. **Find something to work on.** Check open issues or the [development plan](docs/development-plan.md).
2. **Create a branch.** `git checkout -b feat/your-feature`
3. **Make your changes.** Follow the code conventions in [CLAUDE.md](CLAUDE.md).
4. **Run tests.** `npm run test:unit` — all tests must pass.
5. **Submit a PR.** Include a clear description of what changed and why.

## What to contribute

### High-impact areas
- **Framework adapters** (Express, Next.js, FastAPI, Django) — the #1 product gap
- **Python protocol rules** — extend verification beyond TypeScript
- **Bug fixes** for existing detectors and safeguards

### Areas to avoid
- **More TypeScript rules** — TS benchmark is already P=86.8%, marginal returns are negative
- **L4 C analysis (CFG/dataflow/pointer resolution)** — confirmed infeasible with current approach (see Two-Hump Report)
- **SaaS dashboard** — deferred until enterprise PoC validation

## Code conventions

See [CLAUDE.md](CLAUDE.md) for the full reference. Key points:

- **JSDoc on all public exports** with header docstrings
- **`import type` for types, named imports for values**
- **Lazy `require()` inside functions** for circular dependency avoidance
- **Tests colocated with source** (`src/*.test.ts`) using explicit vitest imports
- **No linting/formatting configs** — the project intentionally has none

## Reporting bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md). Include:
- Progmune version (`npm run sdk --version`)
- Node version (`node -v`)
- The code that triggered the issue
- Expected vs actual behavior

## Security

If you find a security vulnerability, **do not open a public issue.** Email the maintainer directly. Progmune's own `.env` file should never be committed — it is in `.gitignore`.

## License

MIT. By contributing, you agree that your contributions will be licensed under the same terms.
