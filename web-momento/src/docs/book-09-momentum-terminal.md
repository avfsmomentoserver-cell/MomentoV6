# 09 · Momentum Lab & the Trading Terminal

This chapter covers the "market" view of the tape:
- v6.3's Momentum Lab (`MomentoV5@v6.3:functions/momentum.ts`, 646 lines; `docs/markdown/momentum-lab.md`);
- the terminals built across MomentoFX, momento-avfs-core and ShapeShifters.

It walks through each module's code and reports four measurable estimator defects, with null-simulation numbers. It then gives the reference design for a terminal in which every indicator is a scored engine and every drawing can be a scored prediction.

## 9.1 Momentum Lab: what exists
| Module | Function | Definition (code) |
|---|---|---|
| **Combined hit points** | `hitPoints(rounds, bucketMs=300_000)` | Rounds bucketed by end time into candles; OHLC from the multipliers in the bucket. **Mega splitting:** a round ≥ 10× (`MEGA_MIN`) spans `clamp(ceil(m/10), 1, 4)` buckets and contributes m/span to each, so a 15× over 5-min buckets gives 7.5 + 7.5. Spill-only buckets have `count = 0` and OHLC 0. Returns `rawEnergy` and split-adjusted `energy` |
| **Anchors** | `anchors(rounds)` | Peak i: `m[i] > m[i−1] && m[i] ≥ m[i+1]`. Trough: `m[i] < m[i−1] && m[i] ≤ m[i+1]`. The structure spans the troughs on either side (left, right, size). The **direction effect** is the mean of the next 10 rounds after the right trough vs the global mean, by size (small < 5, medium 5–15, large > 15). The live phase is `forming` (rising run ≥ 2), `released` (last peak after the last trough) or `idle` |
| **Range momentum** | `rangeMomentum` | For 2/5/10/50/100×+: `medianGap` (all history), `recentGap` = median of the last 3 gaps, momentum = clamp(medianGap/recentGap, 0, 3). Trend: ≥ 1.25 accelerating, ≤ 0.75 cooling, else steady |
| **Moonshot conditions** | `moonshot(rounds, 10)` | For each historical ≥ 10× hit, records five pre-state values: gap since the previous hit, sub-2× streak, prior-10 mean, anchor within 6, prior 5-min bucket energy. **Readiness** is a weighted blend (30/25/20/15/10) of the current state vs those medians, scaled to 0–100 |
| **Range-filtered prediction** | `rangeForecast` | Bands 2–5, 5–10 and 10+. The per-round rate is `0.5·rate + 0.5·(1/medianGap)`, then turned into window probabilities |
| **Inverted lens** | `invertedForecast` | Maps the last 20k rounds to `median/m`, **reverses** them, then runs `perRoundProbability` at `median/t` to get a "dip probability" |
| **Continuous assessment** | `assessLive` | Open predictions scored in real time (progress, max seen, on-pace); bucket "agreement" = share of 5-min buckets within ±50% of the trailing 6-bucket mean |

The readiness note in the code is honest: "Correlation, not causation — treat as a pressure gauge." The rest of this section gives that gauge a way to earn trust, or lose it.

## 9.2 Findings (measured with null simulations)
All four findings below come from simulating i.i.d. fair tapes (`/tmp` notebooks, seeds fixed) and running the same logic on them.

| # | Finding | Evidence | Fix |
|---|---|---|---|
| M1 | **Geometric estimator is biased by +44%.** `rangeForecast` uses `1/medianGap` as a per-round rate. For a geometric waiting time the median is ≈ ln 2 / p, so 1/median ≈ 1.44 p | Simulation: p = 0.10 → 1/median = 1.43 p; p = 0.01 → 1.45 p. The 50/50 blend therefore overstates every band's per-round rate by ≈ 22% | Use p̂ = ln 2 / medianGap (measured ratio 0.99–1.00), or better the MLE p̂ = hits/n, which is what `rate` already is |
| M2 | **Momentum labels fire under the null.** The median of 3 gaps is very noisy | Null tape: p = 0.10 → "accelerating" 36.6% of the time, "cooling" 33.2%; p = 0.5 → "accelerating" 50.1% | Replace with a sequential test: the Poisson-rate ratio of the last k hits vs the long run, with a p-value. Label only when q < 0.05 (BH over the 5 ranges) |
| M3 | **Anchors are a third of all rounds, and "upward drift" is below 50% by construction.** Under i.i.d. data, P(interior point is a 3-point local max) = 1/3. The mean of the next 10 rounds exceeds the heavy-tailed global mean only rarely | Null tape: 33.3% of rounds are peaks; P(next-10 mean > global mean) = 10.5% | Compare every anchor statistic against a **shuffled null** of the same tape (Ch 06 FX column), and use medians or log-means for "drift" |
| M4 | **`anchorNear` is almost always 0 historically.** `moonshot()` uses `anchors(rounds).recent`, which is sliced to the **last 40 anchors**. Historical moonshots rarely have an anchor from that list within 6 rounds | The median of `anchorNear` over samples is 0, so the "met" condition (`cur ≥ median`) is always true | Compute peaks over the full series (`points`, not `recent`), or compute the flag inline per sample |

Two further structural notes:
- **Readiness has no base rate.** Every condition compares the current state with the distribution *before moonshots*, but never with the distribution *before non-moonshots*. A condition is informative only if P(hit | condition) ≠ P(hit). The gap condition carries 30% of the weight and rewards long gaps, which is the "overdue" reading. Under independence the measured-then-shuffled comparison will show whether it has any lift. Ch 06's survival tests found none at the scale of the evidence ledger (App. D).
- **The inverted lens reverses the series.** `perRoundProbability` looks at the *recent* end of its input (tails, Markov last band). After `.reverse()`, the recent end is the oldest part of the 20k window, so the recency engines read the wrong end. The quantity also has a direct form: P(round < t) = 1 − P(≥ t), measured per round. The dip probability for any window at t = 2 is ≈ 1.

## 9.3 Terminals: what exists
| Terminal | Location | Highlights |
|---|---|---|
| **MomentoFX Professional** | `MomentoFX@main:invent/MomentoFX/` | "MT5-level" crash-trading interface spec: TradingView Lightweight Charts, indicators, drawing tools, multi-timeframe, GPU intelligence |
| Deriv TradingView integration | `momento-avfs-core@fix/prediction-auto-refresh` | Full trading-interface layout |
| Momento TradingView dashboard | `MomentoFX@momento-core3` | Dashboard UI |
| **Momento terminal** | `ShapeShifters@momento-terminal-replace` | Pages: Accuracy, Bankroll, EV, Exceedance, Fairness, Phases, Randomness, Responsible, Skill, Strategy, Windows, BacktestLab, FullForecast. **EMA headline (half-life 50)** re-commits on every dropped round |
| **ChartLab** | `ShapeShifters@momento-terminal-replace:frontend/components/chartlab/` | A custom Canvas engine with six views: `tape`, `candles`, `dist`, `survival`, `returnmap`, `equity`. Each view declares domain, limits, draw, probe and y-extent. Fair overlays come from P(M ≥ m) = (1 − h)/m. The file says "adding a seventh view means adding one object here" |
| FX state machine | `momento-avfs-core@fx` | 13 market states, point conversion, "market physics", global state architecture |
| v6.3 FX lab | `MomentoV5@v6.3:functions/fx.ts` (517 lines) | Points candles, validation column against shuffles (Ch 06) |

ChartLab's view contract is the best terminal abstraction in the repos. Its fair-value overlays make the "measured vs fair" comparison visual on every chart. The target design keeps that contract and runs it on Lightweight Charts, so the terminal inherits financial-chart ergonomics.

## 9.4 Reference design
### 9.4.1 Charting stack
Use **TradingView Lightweight Charts**. It is one of the smallest and fastest HTML5 financial charts, open source and client-side only ([GitHub](https://github.com/tradingview/lightweight-charts); [docs](https://tradingview.github.io/lightweight-charts/docs)). Recommended panes:
- **Pane 1:** points candles from `/market/candles?tf=`, with anchors as markers and ceilings as price lines.
- **Pane 2:** hit-point energy histogram, with mega-split chips as markers.
- **Pane 3:** forecast band as a baseline or area series. Draw p25–p75 and p90 beyond the last bar as the "forecast cone", using whitespace data points.
- **Custom-series plugins** for the fan chart (F-15) and the fair-curve overlay (ChartLab's `survival` view).

Stream updates with `series.update(bar)` over WebSocket (Ch 17). Never call `setData` on every tick. Candle maths is incremental: a new round only touches the current bucket (and up to 3 spill buckets).

```ts
export function applyRound(state: CandleState, r: Round, bucketMs: number) {
  const b = Math.floor(r.tsMs / bucketMs) * bucketMs;
  const c = state.get(b) ?? { t: b, open: r.multiplier, high: r.multiplier, low: r.multiplier, close: r.multiplier, count: 0, energy: 0 };
  c.high = Math.max(c.high, r.multiplier); c.low = Math.min(c.low, r.multiplier); c.close = r.multiplier; c.count++;
  const span = r.multiplier >= 10 ? Math.min(4, Math.ceil(r.multiplier / 10)) : 1;
  c.energy += r.multiplier / span; state.set(b, c);
  const touched = [c];
  for (let k = 1; k < span; k++) { const s = state.get(b + k * bucketMs) ?? blank(b + k * bucketMs); s.energy += r.multiplier / span; state.set(s.t, s); touched.push(s); }
  return touched;                        // each → series.update(...)
}
```

### 9.4.2 Indicators as engines
Every indicator (EMA headline, momentum, readiness, anchor phase, volatility) is an engine in the registry (Ch 07 §7.6). Its output is a probability for a named target, for example "P(≥10× in next 20 rounds)". That way it can be charted, alerted on, scored and weighted. An indicator that is only drawn and never scored becomes decoration. The mapping from a gauge to a probability is itself learned. For readiness, use isotonic regression of the outcome on the readiness value, fitted on the training split only:

```python
from sklearn.isotonic import IsotonicRegression
def readiness_engine(train_ready, train_hit):         # hit = any ≥10× in next 20 rounds
    iso = IsotonicRegression(out_of_bounds="clip", y_min=1e-4, y_max=1-1e-4).fit(train_ready, train_hit)
    return lambda r: float(iso.predict([r])[0])
```
If readiness carries no information, the fitted curve is flat at the base rate. The engine then scores exactly like the baseline, and the UI says so on the gauge ("readiness lift: 0.0% ± 0.4%").

### 9.4.3 Momentum done as a test
Replace the median-of-3 ratio with a rate test. Over the last k hits at threshold t, spanning w rounds, the count of hits is binomial(w, p₀) under the long-run rate p₀:

```ts
export function momentumTest(recentWindow: number, recentHits: number, p0: number) {
  const exp = recentWindow * p0;
  const z = (recentHits - exp) / Math.sqrt(exp * (1 - p0));
  const p = 2 * (1 - normCdf(Math.abs(z)));
  return { ratio: recentHits / Math.max(1e-9, exp), z, p };      // label only if BH q < 0.05 across ranges
}
```
The chip shows "5×+: 1.18× long-run rate, not significant" in the default state. It changes colour only when the evidence clears the bar.

### 9.4.4 Drawing tools that become predictions
In the MomentoFX spec, drawing tools are purely visual. The better design: a user draws a horizontal line at 5× and a 30-minute time box. That creates a **user prediction** ("≥5× within 30m"), stored in `scheduled_predictions` with `model = user:<id>` and scored exactly like an engine (Ch 08). The user is asked for their probability with a slider, defaulting to the engine's. Log-score then compares the user with the engine mixture. This leads straight to F-22.

```ts
type Drawing = { kind: "hline" | "box"; level: number; t0: number; t1: number };
function drawingToPrediction(d: Drawing, userP: number, userId: string) {
  return { model: `user:${userId}`, target: `P(any>=${d.level})`, window_ms: d.t1 - d.t0,
           created_ms: Date.now(), due_ms: d.t1, probability: userP };   // must satisfy created < first ts in window
}
```

### 9.4.5 Replay and time-travel
Replay (F-24) uses the `as_of` queries of F-04. At each bar it shows the forecast *as it was committed* (Ch 08 §8.4.5), not a recomputation. Replay then doubles as an audit tool: any disagreement between replayed and committed forecasts is a bug.

### 9.4.6 Performance budget
| Item | Budget |
|---|---|
| Initial load of 50k bars | ≤ 400 ms to first paint (binary transfer: Float64Array via `/market/candles.bin`) |
| Per-round update | ≤ 4 ms main-thread (`series.update` on ≤ 4 series) |
| FPS during pan/zoom | ≥ 55 at 50k bars |
| Memory | ≤ 150 MB for 3 panes × 50k bars |

## 9.5 Tests
| Test | Assertion |
|---|---|
| `geom_estimator_unbiased` | On a synthetic p = 0.05 tape, the band per-round estimate lies within ±3% of p (catches M1) |
| `momentum_null_rate` | On a null tape, the share of ranges labelled non-steady is ≤ 5% (catches M2) |
| `anchor_null_parity` | Anchor direction statistics on the tape vs its shuffle: the difference CI covers 0 on synthetic fair data (M3) |
| `anchor_near_full_series` | `anchorNear` has non-zero share on historical samples when peaks exist (M4) |
| `inverted_recency` | The inverted lens uses the most recent rounds (no reversal of the recency window) |
| `candle_incremental_parity` | Incremental `applyRound` equals batch `hitPoints` on 10k random rounds |
| `drawing_commit_rule` | A drawing whose window has already started is rejected as a prediction |

## 9.6 Measurement
- Readiness lift = log-score skill of the readiness engine vs baseline, with CI (Ch 08 §8.4.4).
- Momentum false-label rate on a daily shuffled copy of the tape (should be ≤ 5%).
- Drawn-prediction count and user-vs-mixture log-score on the leaderboard.
- Chart FPS ≥ 55 at 50k bars; update latency p95 ≤ 4 ms.

## 9.7 Features this chapter unlocks
- **F-21 Forecast cone on the chart:** p25/p75/p90 projected forward, with the h+5 ETA markers and the ACI coverage number (Ch 08).
- **F-22 Drawn predictions:** chart annotations that are scored, with a personal accuracy ledger and leaderboard. This is the core of the V6 spec's "competitive predictor app".
- **F-23 Multi-source terminal:** sources side by side, with a synced crosshair.
- **F-24 Replay mode:** scrub any session bar by bar, with the forecast as it *was* at each bar (F-04).
- **F-25 Anchor alerts:** "anchor forming, size medium" pushed to the user, with the anchor engine's measured lift shown in the alert.
