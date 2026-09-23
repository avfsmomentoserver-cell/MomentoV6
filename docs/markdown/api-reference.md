# API Reference

Base URL: `https://prosync-backend.rork.app` (the project's functions URL). All responses share one envelope:

```json
{ "ok": true, "data": { ... } }
{ "ok": false, "error": "message" }
```

Auth: `Authorization: Bearer <token>` from `POST /api/v1/auth/login`. Endpoints marked **[op]** require the operator role.

## System

| Method | Path | Description |
| --- | --- | --- |
| GET | `/ping` | Liveness + version |
| GET | `/api/v1/health` | Health, service, version, round count |

## Auth

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/v1/auth/login` | `{email, password}` → `{token, user, expiresMs}` |
| POST | `/api/v1/auth/register` | **[op]** create user `{email, name, password, role}` |
| GET | `/api/v1/auth/me` | Current user or `null` |

## Rounds & sessions

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/rounds?source&limit&order` | Round history (order `asc`/`desc`) |
| GET | `/api/v1/rounds/latest?source&limit` | Newest rounds |
| DELETE | `/api/v1/rounds?source&from` | **[op]** delete rounds of a source from a timestamp |
| GET | `/api/v1/sessions?source` | Session table (30-min gap rule) |
| POST | `/api/v1/sessions/rebuild` | **[op]** full sessionization rebuild |
| GET | `/api/v1/sources` | Sources with round counts + last round |
| POST | `/api/v1/sources` | **[op]** register source `{name, label, kind}` |
| DELETE | `/api/v1/sources/{name}` | **[op]** delete source + its rounds |
| GET | `/api/v1/statistics?source` | Overview stats + exceedance |
| GET | `/api/v1/top-rounds?scope=all\|day\|session&source` | Leaderboard rounds |

## Ingest & data lifecycle

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/v1/ingest` | `{source, method, rounds:[{multiplier, timestamp?, color?}]}` — dedupes |
| POST | `/api/v1/import` | **[op]** `{entity: rounds\|vocabulary, rows}` bulk import |
| GET | `/api/v1/export?entity&limit` | JSON export (rounds, forecasts, vocabulary, autopilot, sources, settings, or `all`) |

## Analysis

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/analysis?source` | Full payload: overview, exceedance, streaks, bands, pressure, shape, moonshot, gaps, houseEdge, ladders, ceilings |
| GET | `/api/v1/analysis/ceiling` · `/resistance` | Clustered resistance ceilings |
| GET | `/api/v1/analysis/streaks` | Streaks, conditionals, Markov, post-high |
| GET | `/api/v1/analysis/distribution` | Quantiles + band counts |
| GET | `/api/v1/analysis/moonshot` | Moonshot factors + confidence |
| GET | `/api/v1/analysis/signals` | Combined signal layer |
| GET | `/api/v1/analysis/dna` | Band-triplet DNA with forward stats |
| GET | `/api/v1/analysis/gap-swing` · `/house-edge` · `/plugins` · `/ml` | Supporting surfaces |
| GET | `/api/v1/eta` · `/baseline` · `/bands` · `/brier-score` | Thin aliases |

## Forecasts

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/forecasts?status=open\|resolved&source&limit` | List forecasts |
| POST | `/api/v1/forecasts/record` | `{source, model, threshold, probability, note}` — stored before landing |
| POST | `/api/v1/forecasts/resolve` | Resolve open forecasts vs latest round |
| GET | `/api/v1/forecasts/accuracy?source` | Brier, per-model, counts |
| GET | `/api/v1/forecasts/history` · `/transitions` | Resolved history · band matrix |

## Market

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/market/candles?tf&source&limit` | OHLC candles (tf in seconds) |
| GET | `/api/v1/market/points?source&limit` | Raw points series |
| GET | `/api/v1/market/live?source` | Latest + previous + feed state |
| GET | `/api/v1/market/session-phases?source` | Session phase classification |
| GET | `/api/v1/market/signals?source` | Combined market signals |

## Mega pressure · Linguistics

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/mega-pressure?source` | Power-law tail targets 100×–100,000× |
| GET | `/api/v1/linguistics?depth&source` | Eight-layer token stream + frequencies |
| GET | `/api/v1/linguistics/explain?token` | Token layer breakdown |

## Vocabulary

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/vocabulary?status` | List tokens + status counts |
| POST | `/api/v1/vocabulary` | **[op]** create token |
| PUT | `/api/v1/vocabulary/{id}` | **[op]** update |
| DELETE | `/api/v1/vocabulary/{id}` | **[op]** delete |
| POST | `/api/v1/vocabulary/discover` | Derive candidate tokens from the live series |
| POST | `/api/v1/vocabulary/{id}/evaluate` | Score update `{hits, misses, uses}` |
| POST | `/api/v1/vocabulary/{id}/formalize` | Promote to formalized |
| POST | `/api/v1/vocabulary/{id}/deprecate` | Deprecate |
| GET | `/api/v1/vocabulary/discoveries` · `/learning/status` · `/learning/progress` | Learning system views |

## Orchestrator & Autopilot

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/orchestrator` | Settings + live state + guidance |
| PUT | `/api/v1/orchestrator/settings` | **[op]** `{patience, speed, risk, minConfidence}` |
| POST | `/api/v1/orchestrator/evaluate` | Run decision logic now |
| GET | `/api/v1/autopilot/decisions?source&limit` | Ledger + paper P&L |
| GET/PUT | `/api/v1/autopilot/config` | Stake + threshold |
| GET | `/api/v1/autopilot/status` | Running state |
| POST | `/api/v1/autopilot/start` · `/stop` · `/evaluate` · `/reset` | **[op]** controls |

## Inventory · Backtest · Labs

| Method | Path | Description |
| --- | --- | --- |
| GET/POST | `/api/v1/inventory` | Plugin registry |
| PUT | `/api/v1/inventory/{id}/enabled` · `/config` | **[op]** toggle / weight |
| DELETE | `/api/v1/inventory/{id}` | **[op]** remove |
| GET | `/api/v1/backtest/runs` · `/status` | Backtest history |
| POST | `/api/v1/backtest/run` | `{kind, source}` walk-forward run (≥600 rounds) |
| GET/DELETE | `/api/v1/backtest/run/{id}` | Fetch / delete a run |
| GET | `/api/v1/range-lab?source` | Live walk-forward verdicts + embedded reference |
| GET | `/api/v1/calibration` | Live constants vs reference + match checks |

## Feed engine

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/feed/status` | Enabled, cursor, seed fingerprint, rounds |
| POST | `/api/v1/feed/start` · `/stop` | Toggle |
| POST | `/api/v1/feed/step` | Generate `{count}` provably-fair rounds |
| GET | `/api/v1/feed/verify` | Verification sample + algorithm note |

## Settings · Users · Audit

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/settings` | All settings |
| PUT | `/api/v1/settings` | **[op]** `{values:{...}}` |
| GET/POST | `/api/v1/users` | **[op]** list / create |
| DELETE | `/api/v1/users/{id}` | **[op]** disable |
| GET | `/api/v1/audit?limit` | **[op]** activity log |

## Platform · Releases

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/platform/overview` | Suite overview |
| GET | `/api/v1/platform/docs` · `/doc/{slug}` | Docs manifest |
| GET | `/api/v1/platform/build-steps` · POST `/sync` | Build steps |
| GET | `/api/v1/releases` · `/releases/latest` · POST `/releases` | Release registry |
| GET | `/api/v1/platform/download/{filename}` | Release metadata by filename |
