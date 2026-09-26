# Momento Platform

v6.4.0 — full intelligence platform: TradingView-grade charts with drawings, realtime + scheduled deep computation, ShapeShifter Darkboard and Chart Lab (drawn shape predictions decomputed to rounds with ETAs), filterable DNA / linguistics / vocabulary, V5-style Eagle Eye, Investigation Suite, labelled session-gap reconstruction, Spribe Top-rounds and span seeding, and an Entrim AI forecast summary. See `docs/markdown/v6-4-full-intelligence.md`.

> Secrets: set the AI key with `wrangler secret put ENTRIM_API_KEY` (production) or `ENTRIM_API_KEY=… node functions/local-dev.mjs` (local). Never commit keys.

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