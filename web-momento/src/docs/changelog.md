# Changelog

## v6.4.0 — full intelligence platform

- **TradingView-grade charts** (`TvChart`, lightweight-charts v5), used by Market, Momentum Lab, the consumer charts, MomentoFX and Chart Lab:
  - candles, Heikin-Ashi, bars, line and area; log scale; Aviator hue mode;
  - EMA 20/50, Bollinger Bands, volume and RSI;
  - trend, horizontal, rectangle and Fibonacci drawings that persist;
  - zoom, fit, reset, snapshot, fullscreen, and a projection fan.
- **Command Center:** the forecast is top-most, then the AI summary, then the other forecasts. A 100-round scrollable feed sits top right.
- **Realtime:** a 2.5 s pulse invalidates every view on each new round. The realtime tier computes on top of the scheduled deep tier.
- **Scheduler page:** deep jobs (DNA, linguistics, vocabulary, shape, reconstruct, AI) with editable parameters and intervals.
- **ShapeShifter Darkboard:** named, drawn shapes at five windows, the projected shape fan, and a shape atlas with follow-through lifts.
- **Chart Lab:** chart predictions decomputed into rounds with clock ETAs, a walk-forward backtest and a live ledger.
- **DNA Hunter and Pattern DNA:** four alphabets, k up to 12, any target range, range filters, multiple-testing verdicts and scheduled wide scans.
- **Linguistics and Vocabulary:** rewritten, with a sentence stream, grammar, tone and out-of-sample phrase discovery.
- **Eagle Eye:** V5 structure with the full history, Aviator colours, 12 filters, paging and CSV/JSON export.
- **Investigation Suite:** round forensics, range tests (KS and z), and gaps and reconstruction. Backtests are a tab.
- **Session-gap reconstruction:** cadence-fitted, labelled `reconstructed`, never scored, toggleable and clearable.
- **Seeding:** Spribe Top-rounds import (Day/Month/Year · X/Win/Rounds, timezone aware, anchors), a span seeder, and automatic priming after a .db import.
- **AI forecast summary** over every metric via Entrim (OpenAI-compatible). The key comes from `ENTRIM_API_KEY` or a masked setting.

## v6.3.0 — full-intelligence next-round forecast

- New `functions/intelligence.ts`: the V5.01-backtd forecast engine is back on the next-round hero, with Markov 7-state transitions, empirical percentiles, DNA analogues, V5 ladder release, band exhaustion, the logistic ML ensemble, V5 regime and gap/swing, and the V5 candidate tilts. It is fused with every v6 engine (band model, earned per-round ensemble, Mega Pressure, Moonshot scanner and research, ShapeShifters, FX lab, range momentum) as an 8-engine Bayesian mixture.
- Mixture weights are earned: every round is scored against the forecast that existed before it landed (`intel_calibrations` ledger, per-engine band log-loss). Confidence is capped at MEDIUM unless the mixture beats the measured baseline by at least 3%.
- `/api/v1/pipeline/next-round` now returns the full-intelligence forecast (a superset of the v6.2 payload). The v6.2 band model stays at `/api/v1/pipeline/next-round/band`. New endpoints: `/api/v1/intelligence/forecast`, `/api/v1/intelligence/calibrations`, and `POST /api/v1/intelligence/recalibrate`.
- New Full Intelligence page (`/dashboard/intelligence`): candidates, transition matrix, engine weights and distributions, h+5 outlook, DNA, ML, signal layer, exhaustion and ladders, and the calibration ledger. The Command Center hero now shows the top-3 candidates, the h+5 outlook, engine weights, and skill vs baseline.
- Fixes:
  - `percentileWait` had a sign error, so every p90 ETA returned 1.
  - `hitPoints` crashed on buckets that received only mega-hit spill-over energy.
  - The local dev SQL shim now reports `rowsWritten`, so calibration runs locally, and it debounces DB persistence (bulk ingest went from minutes to seconds).

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
