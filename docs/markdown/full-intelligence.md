# Full Intelligence Forecast (v6.3)

The next-round forecast on the Command Center and the Full Intelligence page (`/dashboard/intelligence`) is the **V5.01-backtd forecast engine rebuilt on top of every v6 engine**. V5 blended Markov states, empirical percentiles and DNA analogues into one state / expected / range headline. v6.2 replaced that with a band-partition model only ("no markov/percentile/dna"). v6.3 brings the full V5 stack back and fuses it with the v6 engines through a **Bayesian mixture whose weights are earned on a calibration ledger**.

Module: `functions/intelligence.ts` (pure, rounds in / forecast out).

## Engines

Every engine emits a full next-round distribution over the six v6 bands (`<1.5 · 1.5–2 · 2–5 · 5–10 · 10–100 · 100+`).

| key | engine | source |
|---|---|---|
| `baseline` | measured band shares, full history | v6 honesty anchor |
| `percentile` | band shares of the last 500 rounds (Dirichlet-smoothed) | V5 `percentile` |
| `markov` | P(next round \| current V5 state), leaned by the V5 candidate tilts | V5 `markov` |
| `dna` | band shares of the rounds that followed every ≥85%-similar 8-round band signature | V5 `dna_report` |
| `band` | v6.2 band-partition / tail-lift model | v6 `nextRoundForecast` |
| `ml` | V5 logistic ensemble P(≥2/5/10) (0.6 model + 0.4 empirical), reshaped onto bands | V5 `ml.predict` |
| `ensemble` | v6 earned-weight per-round ensemble (baseline · markov · streak · recent) | v6 `perRoundProbability` |
| `signals` | recent distribution tilted by a composite of 14 directional readings | see below |

### V5 state machine

The seven V5 states (Normal, Collapse, Ignition, Moonshot, Exhaustion, Shelf, Bait) use the V5 detectors unchanged: ascending/collapse ladders in Momento point space (`100 + log2(m)·30`), nested-band compression, variance shelf, bait spike, and V5 `classify_state` scoring. Rolling 40-round labels build the Laplace-smoothed transition matrix. The **candidates** are the V5 Markov row plus V5 tilts, now driven by v6 engines:

- DNA tilt: up to 35%, from analogue over-5×/under-2× shares.
- Overdue tilt: up to 0.2 × the V5 band-exhaustion score.
- Pressure tilt: from v6 Mega Pressure above 70.
- Moonshot tilt: from the v6 Moonshot scanner above 0.7.
- Ladder tilt: from V5 release conditions when the moonshot probability is above 0.6.
- Collapse and gap-swing momentum tilts.

The Markov value channel uses P(next | current state) directly. Mixing each candidate's own value distribution would be circular, because labels are partly defined by the round's own value.

### Signal layer

Each reading is scored from −1 to +1: Mega pressure, Moonshot scanner, Moonshot research readiness, V5 ladder release, V5 band exhaustion, ShapeShifters, V5 gap/swing, streak, FX trend quality, FX mean reversion, FX volatility regime, FX breakout squeeze, 10×+ range momentum, and V5 regime. The mean (×2, clamped) tilts the recent distribution along the band axis.

## Earned mixture

Every round is scored against the full-intelligence forecast that existed **before** it landed (`intel_calibrations`). Each engine's distribution is log-scored on the band that landed. Weights are

    w_c ∝ prior_c · exp(−n_eff · (L_c − L_best)),   n_eff = min(60, ledger size)

with floors (baseline ≥ 8%, every engine ≥ 2% so it can recover). With fewer than 15 scored rounds the priors are used.

The headline:

- **Expected**: the mixture median, interpolated inside the band from empirical in-band quantiles.
- **Range**: the mixture p25–p75.
- **Reach**: the mixture p90.
- **Rectification**: the median log error over the trailing window, clamped to ±1.5. It is the median, not the mean, because on a heavy-tailed payout the mean log error is positive even for a perfectly calibrated median.
- **Outlook h+5**: P(hit within 5 rounds) for 2/5/10/20/50/100×, with median and p90 ETAs at the mixture rate.

## Confidence is earned

    confidence = 0.35·stateConviction + 0.25·agreement + 0.40·hitRate      (ledger ≥ 15)
    confidence = 0.6 · (0.6·stateConviction + 0.4·agreement)               (no ledger)

`stateConviction` is the V5 formula (score lead, sample size, regime, candidate lead, DNA confidence). `agreement` is 1 − the weighted Jensen–Shannon divergence of the engines from the mixture. The value is capped at 0.60 (MEDIUM) unless the mixture beats the measured baseline's log-score by at least 3% on the ledger. **HIGH requires demonstrated out-of-sample skill.**

## Honesty

Provably-fair rounds are independent draws. When the band chi-square test says transitions are independent, the page says so, and engines can only gain weight by out-scoring the baseline. The **skill vs baseline** tile is the one number to watch. Near 0% means the engines add no information, and the mixture collapses toward the measured rates.

## API

| method | path | notes |
|---|---|---|
| GET | `/api/v1/pipeline/next-round?source=` | full-intelligence forecast (superset of the v6.2 payload) |
| GET | `/api/v1/intelligence/forecast?source=` | same |
| GET | `/api/v1/pipeline/next-round/band?source=` | legacy v6.2 band model |
| GET | `/api/v1/intelligence/calibrations?limit=` | ledger rows, verdicts, per-engine log-loss, correction |
| POST | `/api/v1/intelligence/recalibrate` | operator: wipe and re-run the backtest |

Settings: `intel_backtest_rounds` (default 150). Calibration shares `calibration_enabled`, `calibration_window` and `calibration_min_sample` with the v6.2 round calibration. Incremental scoring is capped at the latest 300 rounds per ingest.
