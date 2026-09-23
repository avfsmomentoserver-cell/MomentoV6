# Changelog

## v5.0.0 — coordinated professional platform (this release)

The full rebuild. One backend, one shell, every archived feature and link carried forward.

### Backend
- New Cloudflare Worker backend (`momento-core` v5.0.0): one Durable Object owning the relational SQLite database — rounds, sessions, sources, forecasts, plugins, autopilot ledger, backtest runs, vocabulary, users, tokens, settings, build steps, audit log, top rounds, releases, orchestrator log.
- Full REST API (~120 endpoints) with consistent response envelopes, operator auth (PBKDF2 + bearer tokens), CORS, validation and error handling.
- Analysis engine ported to pure TypeScript: ladders, ceilings, streaks/Markov, bands/χ², distribution, exceedance + Wilson CIs, gaps, house edge, mega pressure (power-law tail), moonshot, ShapeShifters anatomy (Pareto MLE + KS, dry zones, ETA bands, trajectory groups), linguistics (8 layers), walk-forward backtester.
- Provably-fair live round engine (SHA-256 seed:cursor hash chain) with verification endpoint.
- JSON export/import (rounds, forecasts, vocabulary, autopilot, sources, settings), ingest log, audit trail.
- Release registry: versioned bundles with SHA-256, `releases/latest` API.

### Data
- Seeded from the merged archive dataset: 177,905 rounds (avfs 150,410 / momento_prev 18,805 / momento_project 8,690), 33 sessions, sessionization rebuilt server-side.
- Calibration verified live vs reference: all constants match (P(≥2×) 50.4651%, tail b 1.006, post-high 49.4%…).

### Frontend
- Graphite Aurora theme, sidebar shell, ⌘K command palette, React Query everywhere.
- 34 routes — the full archived sitemap plus aliases, all backend-backed, zero dead links.
- Documentation Center: 17 markdown docs with browsable sidebar (also shipped in the bundle).
- Downloads page + Download Source button (top bar, dashboard, landing, build steps).
- Consumer app (Today / Pro / Charts / Premium) over the same honest engine.

### Inherited verdicts (unchanged, re-verified)
- No conditional methodology beats the measured baseline at 177,905 rounds — earned weight 0, Range Lab ships both tables.

## Historical (previous archives)

- **v4.x (momento-avfs-core)** — FastAPI + SQLite core, 20 screens, eight sub-projects, vocabulary system, honest accuracy ledger. Source carried in the original bundle.
- **web-live additions** — ShapeShifters darkboard, Range Lab, Calibration Lab, drift monitor, sessionize, merged-dataset recalibration.
