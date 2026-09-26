# Momento Platform

v6.3.0 — full-intelligence next-round forecast (V5.01-backtd engine × every v6 engine, earned mixture weights) + forex analysis + honest prediction pipeline + compounding accuracy engine.

## Quickstart

```bash
cd web-momento && bun install
bun run dev        # console at http://localhost:8080
```

Deploy `functions/` as a Cloudflare Worker (Durable Object `MomentoCore`, instance `global`).
Point the console's `EXPO_PUBLIC_RORK_FUNCTIONS_URL` at the worker URL.

Default operator: `operator@momento.local` / `momento` — change it immediately.

## Where to look first

- `BUILD_WALKTHROUGH.md` — every build step documented
- `docs/markdown/` — full documentation set (same files render in-app)
- `functions/fx.ts` — the nine FX engines
- `functions/pipeline.ts` — prediction pipeline + accuracy verification
- `functions/core.ts` — the backend: schema, scheduler, all routes

Generated 2026-09-21T16:55:31.063Z.