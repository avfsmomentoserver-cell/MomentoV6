# Platform Overview

Momento v5 is a coordinated analytics and forecasting platform for crash-curve round data. It is a full rebuild that carries every feature and every navigation link from both previous archives (the merged web-live bundle and the momento-avfs-core source bundle) into one system with one real backend.

## The pipeline

```
Collector → Ingest API → Analysis → Forecast Engine → Database → Dashboard
```

- **Ingest** — REST push, file upload (JSON / CSV / plain numbers), bulk import, and a provably-fair live round engine (SHA-256 hash chain).
- **Analysis** — pure functions computed server-side over the stored series: ladders, resistance ceilings, streaks & Markov, band transitions, distribution & quantiles, gaps, house edge, mega pressure, ShapeShifters curve anatomy.
- **Forecast Engine** — measured exceedance with Wilson 95% CIs, forecasts stored *before* the round lands and scored with the Brier rule, honest walk-forward validation (Range Lab), earned-weight conditional models.
- **Database** — relational SQLite inside a Durable Object: rounds, sessions, sources, forecasts, plugins, autopilot ledger, backtest runs, vocabulary, settings, audit log, releases.
- **Dashboard** — the graphite-dark operator console you are looking at, plus the simplified consumer app.

## Four foundational principles (inherited from the archives)

1. **Observation before prediction** — understand the present before reasoning about the future.
2. **Immutable raw events** — raw rounds are never edited; corrections are recorded separately.
3. **Explainability is mandatory** — every prediction carries explanation metadata.
4. **Honest accuracy** — every forecast is stored before the round resolves and scored afterwards. Nothing can be back-dated.

## The dataset

The platform was seeded from the merged dataset carried in the archives: **177,905 unique rounds** across 33 recording sessions (2024-01-01 → 2026-08-02 UTC), merged from `avfs.db` (150,410), previous sessions (18,805) and the original project capture (8,690), deduped on (timestamp, multiplier) and sessionized at 30-minute gaps. The Calibration Lab verifies the live database against the reference constants on every load.

## Sub-projects → surfaces

| Sub-project | Surface |
| --- | --- |
| Collector & Ingest | `/dashboard/ingest` |
| Analysis Core | `/dashboard` (Command Center) |
| Market & Charts | `/dashboard/market`, `/dashboard/momento-fx`, `/dashboard/momento-fx-v2` |
| MomentoLinguistics | `/dashboard/linguistics`, `/dashboard/vocabulary` |
| Forecast Engine | `/dashboard/studio`, `/dashboard/range-lab`, `/dashboard/calibration` |
| ShapeShifters research | `/dashboard/darkboard` |
| Decision Orchestrator | `/orchestrator` |
| Autopilot Ledger | `/dashboard/autopilot` |
| Plugin Inventory | `/inventory` |
| Investigation Suite | `/dashboard/investigation`, `/dashboard/eagle-eye`, `/dashboard/birdeye` |
| Consumer App | `/app`, `/app/pro`, `/app/charts`, `/app/premium` |
| Platform & delivery | `/dashboard/build-steps`, `/dashboard/downloads`, `/dashboard/docs` |
