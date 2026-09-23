# FX Analysis Lab

The v6 forex toolset. Nine engines run server-side over the stored series as pure functions (`functions/fx.ts`) — rounds in, metrics out. Every engine is surfaced on `/dashboard/fx-lab` and every signal feeds the prediction pipeline that powers the Accuracy Engine v2.

## The engines

| Engine | What it measures | Key outputs |
| --- | --- | --- |
| Correlation | Autocorrelation of the log series and the binary ≥2× stream, Ljung-Box Q | ACF per lag 1–20, significance flags |
| Volatility regime | Rolling realized vol of log returns, EWMA vol, vol-of-vol, hour-of-day profile | vol percentile, regime (compressed / normal / expanded) |
| Order flow | Buy/sell pressure proxy — ≥2× share per 20-round bucket, cumulative delta | current imbalance, z-score vs recent norm |
| Support density | Log-binned density of recent prints → clustered shelves | nearest support/resistance levels, bin histogram |
| Breakout lab | Range compression and the measured probability a squeeze resolves upward | squeeze percentile, post-compression break rate vs base rate |
| Mean reversion | Hurst exponent (rescaled range), variance ratios VR(2/4/8), AR(1) half-life, z-score | reversion / persistence / random-walk classification |
| Trend quality | Kaufman efficiency ratio + log-linear R² | trending vs ranging, direction, rolling ER series |
| Event risk | Rolling z-score anomalies vs the q99.5 extreme line | extreme threshold, rounds since last extreme, anomaly list |
| Divergence | Per-source exceedance vs the blended baseline | rate deltas per threshold, max divergence score |

## Pipeline integration

`GET /api/v1/pipeline/forecast` returns the live multi-window forecast. Per-round probabilities blend, in logit space:

- **baseline** — the measured exceedance rate (always keeps a 25% floor),
- **markov** — first-order state transition rate,
- **streak** — empirical rate conditioned on the current below-run length,
- **recent** — rate over the last 200 rounds.

Each non-baseline model carries an *earned weight* (see the Accuracy Engine doc). Window probabilities are `1 − (1 − p)^N` with `N` = expected rounds in the window, derived from the observed round cadence. The composite signal vector (`/api/v1/fx/signals`) exposes the directional tilts used by the dashboard.

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/fx?source` | Full payload — all nine engines + signals |
| GET | `/api/v1/fx/signals?source` | Composite signal vector only |
| GET | `/api/v1/fx/{engine}?source` | One engine (correlation, volatility, orderFlow, density, breakout, reversion, trend, events, divergence) |
| GET | `/api/v1/pipeline/forecast?source` | Live multi-window forecast with earned weights |

## Honesty rules

Nothing in the lab is fit on the future. Engines describe the current state of the series; conditional adjustments to the pipeline apply only with weight earned from resolved, out-of-sample predictions (Accuracy Engine v2). When no model has skill over the baseline, the measured rate governs and the UI says so.
