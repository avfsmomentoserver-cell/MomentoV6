# Build Walkthrough — Momento Platform

Version **6.2.0** · generated **2026-09-21T16:55:31.063Z**

This document is produced automatically on every build (`scripts/build-source-bundle.mjs`).
Each step lists what it delivers, the exact files involved, and how to verify it —
the same step list backs the in-app Build Steps tracker (`GET /api/v1/platform/build-steps`).

## Run it

```bash
bun install          # web console dependencies
bun run build        # docs + source bundle + production console build
bun run dev          # local console on :8080
# deploy functions/ as a Cloudflare Worker with the MomentoCore Durable Object
```

Default operator login (change immediately): `operator@momento.local` / `momento`.

## Steps

### Step 1 — Architecture & configuration

Cloudflare Worker entrypoint dispatching into the MomentoCore Durable Object; Vite + React + Tailwind (Graphite Aurora) console configuration.

**Files**

- `functions/index.ts`
- `web-momento/vite.config.ts`
- `web-momento/tailwind.config.ts`
- `web-momento/tsconfig.json`
- `web-momento/package.json`

**Verify:** bun install && bun run dev serves the console; the worker deploys as-is.

### Step 2 — Database & persistence

Relational SQLite inside the Durable Object: rounds, sessions, sources, users, tokens, forecasts, plugins, autopilot, backtests, vocabulary, releases, settings, audit log — plus the v6 accuracy tables (scheduled_predictions, accuracy_ledger, engine_weights, accuracy_history).

**Files**

- `functions/core.ts`

**Verify:** GET /api/v1/health reports the round count.

### Step 3 — Linguistics layer

Eight-layer semantic tokens (band · chroma · streak · transition · momentum · pressure · shape) and the vocabulary learning lifecycle endpoints.

**Files**

- `functions/analysis.ts`

**Verify:** GET /api/v1/linguistics returns the live token stream.

### Step 4 — Analysis engine

Pure ported engines: exceedance + Wilson CIs, streaks/Markov, bands + χ², ladders, ceilings, power-law pressure, ShapeShifters anatomy, moonshot, gaps, house edge, candles, session phases.

**Files**

- `functions/analysis.ts`

**Verify:** GET /api/v1/analysis returns the full payload.

### Step 5 — Forecast engine & prediction pipeline

Honest walk-forward evaluation plus the v6 pipeline: per-round ensemble (baseline/markov/streak/recent, earned weights) and multi-window probabilities P = 1−(1−p)^N over observed cadence.

**Files**

- `functions/analysis.ts`
- `functions/pipeline.ts`

**Verify:** GET /api/v1/pipeline/forecast returns live window forecasts.

### Step 6 — Ingest & live engine

REST push, bulk import, dedupe on (source, ts_ms, multiplier), 30-min sessionization, and the provably-fair SHA-256(seed:cursor) round generator.

**Files**

- `functions/core.ts`

**Verify:** POST /api/v1/feed/step generates a verifiable round; GET /api/v1/feed/verify replays it.

### Step 7 — FX analysis engines (v6)

Nine new forex engines — correlation/Ljung-Box, volatility regime, order-flow imbalance, support density, breakout lab, mean reversion (Hurst/VR/AR1), trend quality (ER/R²), event risk, cross-source divergence — all cached per (source, maxId) and wired into the pipeline.

**Files**

- `functions/fx.ts`
- `web-momento/src/pages/dashboard/AnalysisLab.tsx`

**Verify:** GET /api/v1/fx returns every engine; /dashboard/fx-lab renders them.

### Step 8 — Accuracy Engine v2 + scheduling

Multi-window scheduled predictions (15m/1h/4h/1d/7d × thresholds) stored before landing, resolved against history, accumulated into an O(1) ledger that never resets; earned Brier-skill weights feed back into the pipeline; DO alarm + dashboard tick double-drive the scheduler; walk-forward full-history verification at any scale.

**Files**

- `functions/pipeline.ts`
- `functions/core.ts`
- `web-momento/src/pages/dashboard/AccuracyEngine.tsx`

**Verify:** GET /api/v1/accuracy/overview; POST /api/v1/accuracy/verify replays all history.

### Step 9 — Orchestrator & autopilot

Decision logic with mistake prevention and the paper-P&L autopilot ledger.

**Files**

- `functions/core.ts`

**Verify:** GET /api/v1/orchestrator returns live guidance.

### Step 10 — Frontend foundation

React Query as top-level provider, router with all 36+ routes and legacy aliases, Graphite Aurora theme tokens, typed API client.

**Files**

- `web-momento/src/App.tsx`
- `web-momento/src/main.tsx`
- `web-momento/src/index.css`
- `web-momento/src/lib/api.ts`

**Verify:** Every route renders against the live API.

### Step 11 — Operator console

Command Center (with the one-click Source Bundle button + accuracy strip), Market, Ladders, Resistance, Moonshot, FX Lab, DNA, Mega Pressure, Pattern DNA, Forecast Studio, Linguistics, Vocabulary, Investigation, Eagle Eye, Bird's Eye, Darkboard, Range Lab, Calibration, Ingest, Sources, Autopilot, Accuracy Engine, Settings, Users, Testing, Docs, Downloads, Build Steps.

**Files**

- `web-momento/src/pages/dashboard/`
- `web-momento/src/components/layout/`

**Verify:** Sidebar sitemap + ⌘K palette reach every page.

### Step 12 — Consumer app

Today, Pro Predictions, Charts, Premium over the same honest engines.

**Files**

- `web-momento/src/pages/app/`

**Verify:** /app surfaces render live data.

### Step 13 — Documentation system

Markdown docs render in-app (Documentation Center) and ship in the bundle — docs can never drift from the download.

**Files**

- `docs/markdown/`
- `web-momento/src/docs/`
- `web-momento/scripts/generate-docs.mjs`

**Verify:** bun run docs:gen regenerates src/docs/generated.ts.

### Step 14 — Source bundle & step-doc pipeline

This very step: on every build the walkthrough is generated, MANIFEST refreshed with per-file SHA-256s, the full platform zipped into public/downloads, stats emitted, and the release registered so the dashboard button always serves the running version.

**Files**

- `web-momento/scripts/build-source-bundle.mjs`
- `web-momento/public/downloads/`

**Verify:** Check bundle-stats.json + the Command Center button.

### Step 15 — Auth, users & audit

PBKDF2-SHA256 (100k iterations) auth, 30-day bearer tokens, operator roles, full audit trail.

**Files**

- `functions/core.ts`

**Verify:** POST /api/v1/auth/login with operator@momento.local / momento.

### Step 16 — Deployment & handover

Worker + DO deploy via Rork functions URL; console builds to dist/; this bundle is the complete handover artifact.

**Files**

- `functions/`
- `web-momento/dist/`
- `README.md`
- `MANIFEST.md`
- `PARITY_REPORT.md`

**Verify:** sha256 of the zip matches bundle-stats.json and the release registry.

## Integrity

- Zip SHA-256 and file count are recorded in `public/downloads/bundle-stats.json`.
- `MANIFEST.md` (in this bundle) carries the per-file SHA-256 inventory.
- The backend release registry (`GET /api/v1/releases/latest`) lets scripts verify the running version against the downloaded one.
