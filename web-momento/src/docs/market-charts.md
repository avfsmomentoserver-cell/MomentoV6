# Market & Charts

## Market (`/dashboard/market`)

Server-computed views over the stored series, filterable by source:

- **Candles** — OHLC aggregation at 1m / 5m / 15m / 1h / 1d timeframes (bucketed server-side from up to 4,000 recent rounds).
- **Points** — the raw multiplier series on a log scale.
- **Session phases** — every session with its phase classification: `compressed` (P(≥2×) low), `steady`, `expansion` (max ≥20×), `eruption` (max ≥100×).

## MomentoFX (`/dashboard/momento-fx`)

The forex-style research interface (v1): 5-minute close series as a line, indicator strip (P(≥2×), momentum, volatility proxy, trajectory), session state.

## MomentoFX v2.0 (`/dashboard/momento-fx-v2`)

The drawing workbench: crosshair, trendlines, rays, Fibonacci retracement, rectangles. Drawings persist for the session; the price readout follows the cursor. This is the port of the advanced drawing toolset from the archives' market page.

## Consumer Charts (`/app/charts`)

The simplified client surface over the same endpoints: candles, points, session phases, and the recent feed.

## Data flow

All chart data comes from `/api/v1/market/*` endpoints — nothing is computed client-side except rendering. React Query refetches keep live views current while live mode is on.
