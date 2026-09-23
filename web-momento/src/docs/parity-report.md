# Parity & Verification Report

The audit extracted the FULL navigation sitemap of both previous archives (web-live merged bundle + momento-avfs-core source bundle). The union became the acceptance contract: every link must route to a live, backend-backed page. This is the verified matrix.

## Operator console

| Route (archive contract) | Status | Backend backing |
| --- | --- | --- |
| `/dashboard` Command Center | ✅ upgraded | `/api/v1/analysis`, `/rounds/latest`, `/feed/*` |
| `/dashboard/market` Market | ✅ upgraded | `/market/candles`, `/points`, `/session-phases` |
| `/dashboard/ladder` Ladder Telemetry | ✅ | `/api/v1/analysis` (ladders engine) |
| `/dashboard/resistance` Resistance | ✅ | `/analysis/ceiling` |
| `/dashboard/moonshot` Moonshot Finder | ✅ | `/analysis/moonshot`, `/mega-pressure` |
| `/dashboard/dna` DNA Hunter | ✅ | `/analysis/dna`, shape anatomy |
| `/dashboard/mega-pressure` Mega Pressure v2.0 | ✅ | `/api/v1/mega-pressure` (100×–100,000×) |
| `/dashboard/pattern-dna` Pattern DNA Tracker | ✅ | `/api/v1/bands` (transition matrix, χ²) |
| `/dashboard/studio` Forecast Studio | ✅ upgraded | `/forecasts/*` honesty ledger |
| `/dashboard/crash-studio` (alias) | ✅ redirects | → `/dashboard/studio` |
| `/dashboard/linguistics` | ✅ | `/api/v1/linguistics` |
| `/dashboard/vocabulary` | ✅ | `/vocabulary/*` learning lifecycle |
| `/dashboard/investigation` | ✅ | `/backtest/*` walk-forward |
| `/dashboard/eagle-eye` | ✅ | exceedance grid + custom gates |
| `/dashboard/birdeye` | ✅ | cross-source overview |
| `/dashboard/darkboard` | ✅ | 4 ShapeShifters screens |
| `/dashboard/range-lab` | ✅ | `/api/v1/range-lab` live + reference |
| `/dashboard/calibration` | ✅ | `/api/v1/calibration` live-vs-reference |
| `/dashboard/ingest` | ✅ | `/ingest`, `/feed/*`, `/sessions/rebuild` |
| `/dashboard/sources` | ✅ | `/sources` CRUD |
| `/dashboard/autopilot` | ✅ | `/autopilot/*` ledger + P&L |
| `/dashboard/momento-fx` | ✅ | market + analysis |
| `/dashboard/momento-fx-v2` | ✅ | drawing workbench |
| `/dashboard/build-steps` | ✅ | `/platform/build-steps` |
| `/dashboard/settings` | ✅ | `/settings`, `/audit`, `/export` |
| `/dashboard/users` | ✅ | `/users` CRUD |
| `/dashboard/testing` | ✅ | `/feed/verify`, `/feed/step` |
| `/dashboard/charts` (alias) | ✅ redirects | → `/dashboard/market` |
| `/dashboard/source` (alias) | ✅ redirects | → `/dashboard/downloads` |
| `/orchestrator` | ✅ | `/orchestrator/*` |
| `/inventory` | ✅ | `/inventory/*` |

## Consumer app & public

| Route | Status | Backend backing |
| --- | --- | --- |
| `/` Landing | ✅ new | `/platform/overview` |
| `/login` | ✅ | `/auth/login` (operator bootstrap) |
| `/app` Today | ✅ | analysis baseline |
| `/app/pro` Pro Predictions | ✅ | `/forecasts/*` |
| `/app/charts` | ✅ | `/market/*` |
| `/app/premium` | ✅ | — |
| `/app/auth` (alias) | ✅ redirects | → `/login` |

## New in v5

| Route | Purpose |
| --- | --- |
| `/dashboard/docs` + `/dashboard/docs/{slug}` | Documentation Center (17 docs, markdown, browsable) |
| `/dashboard/downloads` | Releases page: versioned bundles + checksums |
| `/dashboard/darkboard` | promoted from web-live addition, fully wired |
| Command palette (⌘K) | every destination + docs |
| Download Source button | top bar + dashboard + landing + Build Steps |

## Backend parity

The original FastAPI surface (~120 routes) is implemented 1:1 over the same SQLite schema (rounds, forecasts, metrics, sessions, users, sources, plugins, plugin_runs, autopilot_decisions, backtest_runs, ingest_log, settings, build_steps, audit_log, top_rounds, + vocabulary/releases/orchestrator_log). See the API Reference doc for the full list.

## Data parity

Seeded from the merged dataset: 177,905 rounds, 33 sessions, provenance preserved (avfs 150,410 / momento_prev 18,805 / momento_project 8,690). Calibration Lab verifies live constants against the reference constants recorded in the archives — all checks match within 1% (exact on the exceedance set).
