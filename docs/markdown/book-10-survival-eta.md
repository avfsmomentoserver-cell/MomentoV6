# 10 · Survival, ETA & Moonshot

"When will the next 10× / 50× / 100× arrive?" is the question users ask most. Momento answers it in at least seven places, with three different definitions of "pressure". This chapter:
- inventories them with their exact formulas;
- measures how the current "overdue / pressure" signals behave on a fair null tape;
- gives one survival engine that replaces them all. It separates the between-round clock from the in-round clock, handles censoring properly and has an explicit test for whether waiting changes anything.

## 10.1 What exists
| Component | Location | Method |
|---|---|---|
| Median/percentile wait | `analysis.ts: medianWait, percentileWait` | Geometric waiting time from rate p: median = ⌈ln 2 / −ln(1−p)⌉; q-quantile = ⌈ln(1−q)/ln(1−p)⌉ |
| Outlook h+5 | `intelligence.ts` | P(hit within 5) and median/p90 ETA at the mixture rate |
| Gaps | `analysis.ts: gaps` | Rounds since each `LIVE_THRESHOLD`, with etaMedian, etaP90 and a percentile |
| Band exhaustion ("overdue") | `intelligence.ts: bandExhaustion` | For 2/3/5/10/20/50/100×: expectedGap = 1/rate, overdueRatio = since/expectedGap, exhaustion = clamp(ratio/2.5). Status overdue > 1.25, due > 0.85, else fresh. Returns `mostOverdue` |
| Mega Pressure | `analysis.ts: pressure`, `V5 api/routes/mega_pressure.py` (42 KB) | Tail fit a·t^−b (Ch 06) for 100…100,000×. The rate is the measured rate if hits ≥ 5, else the modelled one. `pressurePct = min(99, round(run/median·50))` |
| Moonshot scanner | `analysis.ts: moonshot`, `backend/features/moonshot_scanner/*` | Scanner score, exhaustion |
| Moonshot readiness | `momentum.ts: moonshot` | Pre-condition profile → gauge (Ch 09 findings M3, M4) |
| Survival | `ShapeShifters@momento-terminal-replace:backend/momento/survival.py` | `empirical_survival` plus a **Hill/POT Pareto tail** (`hill_alpha`, k = max(10, n·tail_fraction)) beyond empirical support, smoothly blended. Also `curve`, `band_probability`, `diagnostics` |
| Nelson–Aalen | `ShapeShifters RESEARCH.md §5` | Ĥ(t) = Σ dᵢ/nᵢ over truncated rounds (in-round crash timing) |
| ETA estimator | `RESEARCH.md §6` | Growth law t(x) = 16.67·ln x seconds; time remaining T = ln(x̂/m₀)/g; Gaussian crash ladder |
| Grouped ETA predictor | `ShapeShifters@main` | 6 regimes, 5-model ensemble |
| Moonshot sequence predictor | `momento-avfs-core@latest-v1` | Sequence model, NaN fixes |
| **Moonshot ETA (Cox PH)** | `momento-core@momento-v6-spec` (missing feature) | Proposed proportional hazards |
| Mega pressure release | V6 spec (missing feature) | Proposed |

The survival module in the terminal has one documented lesson (App. D). An older exponential estimate claimed ≈ 94% for an outcome later measured at ≈ 48.5%. That lesson is the reason this chapter insists on empirical survival with censoring.

## 10.2 Two different clocks
1. **Between-round clock** (discrete): the number of rounds until the next ≥ T round. This is a discrete-time survival problem. The discrete hazard is h(k) = P(event at k | no event before k) ([discrete hazard, UW STAT 425 notes](https://faculty.washington.edu/yenchic/26W_stat425/Lec5_survival.pdf); [survival analysis basics, PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC2394262/)).
2. **In-round clock** (continuous): seconds until the curve stops, given it is alive at m₀. This one is handled by Nelson–Aalen and the growth law t = 16.67·ln m.

Keep them separate in code (`eta/between.ts`, `eta/inround.ts`) and in the UI.

## 10.3 Findings on the current signals
Null simulation: 300,000 i.i.d. rounds from the fair law P(M ≥ m) = 0.97/m, sampled every 7th round after a 5,000-round warm-up.

| # | Finding | Measured on the null tape | Consequence |
|---|---|---|---|
| P1 | **`bandExhaustion` always finds something "overdue".** Seven bands, each with threshold 1.25 × expected gap | At a random moment, **70.9%** of the time at least one band is "overdue". The 10× band alone is overdue **26.1%** of the time | `mostOverdue` is almost always populated and not informative on its own |
| P2 | **`pressurePct` is linear in run/median.** It reaches 50 at the median gap and 99 at about 2× the median | For a geometric gap, P(gap > median) ≈ 0.5 and P(gap > 2·median) ≈ 0.25, so "pressure 99" is shown about a quarter of the time on a fair tape | The number reads like a probability but is not one |
| P3 | **Rate discontinuity at 5 hits.** `blended = hits ≥ 5 ? rate : modeled` | The ETA jumps when the 5th hit arrives | Shrink smoothly: p̂ = (hits + k·p_model)/(n + k) with k from the tail fit's standard error |
| P4 | **Memorylessness is untested.** Every "overdue" signal implies the remaining wait shrinks as the gap grows | For a geometric process, P(event in next k \| waited g) = 1 − (1−p)^k, independent of g | Test it on real data (§10.4.3). The UI should show the conditional ETA, which will equal the unconditional one when that holds |

None of these is a code bug in the narrow sense. They are definitional: the numbers are indices that sound like probabilities. The fix is to make each one an actual probability with a stated reference distribution.

## 10.4 Reference design: one survival engine
### 10.4.1 Kaplan–Meier on gaps, with the open gap censored
For threshold T, the gaps between consecutive ≥ T rounds are complete observations. The current open gap is **right-censored**: we know it is at least g. The first gap of every session is **left-truncated** by the session start, so either drop it or treat it as delayed entry ([Kaplan–Meier overview, MedCalc](https://www.medcalc.org/en/book/kaplan-meier.php)). Gaps must not straddle sessions or sources (the same issue as Ch 06 A2).

```ts
// eta/between.ts
export function kmGaps(gaps: number[], censored: number[]): { k: number; S: number }[] {
  const ev = new Map<number, number>(), cen = new Map<number, number>();
  for (const g of gaps) ev.set(g, (ev.get(g) ?? 0) + 1);
  for (const c of censored) cen.set(c, (cen.get(c) ?? 0) + 1);
  const times = [...new Set([...ev.keys(), ...cen.keys()])].sort((a, b) => a - b);
  let atRisk = gaps.length + censored.length, S = 1; const out = [{ k: 0, S: 1 }];
  for (const t of times) {
    const d = ev.get(t) ?? 0;
    if (d) { S *= 1 - d / atRisk; out.push({ k: t, S }); }
    atRisk -= d + (cen.get(t) ?? 0);
  }
  return out;
}
export function conditionalEta(S: (k: number) => number, g: number, q = 0.5) {
  const Sg = S(g); if (Sg <= 0) return null;
  for (let k = 1; k < 1e6; k++) if (S(g + k) / Sg <= 1 - q) return k;   // smallest k with P(wait > k | > g) ≤ 1 − q
  return null;
}
```
For thresholds where the empirical support runs out (≥ 100×, where P ≈ 0.94%), extend S with the geometric tail at the shrunk rate from P3. Blend over the last decile of support, as `survival.py` already does for the multiplier distribution.

### 10.4.2 Pressure, redefined
pressure(g) = 100 · (1 − S(g)) is the **KM percentile of the current gap**. "Pressure 90" then has an exact meaning: 90% of historical gaps ended before this point. By construction it is uniform over time on a stationary tape, so it is high 10% of the time, not 25%. Show it next to the thing users actually want, the **conditional hazard**:

\[ h(g) = \frac{S(g) - S(g+1)}{S(g)} \quad\text{vs}\quad \hat p \]

If h(g) ≈ p̂ at every g, the tape is memoryless at that threshold, and the pressure number, while exact, does not change the next-round probability. The UI states that directly: "Gap is in the 90th percentile; next-round chance 9.4% (unchanged by the gap)".

### 10.4.3 The memorylessness test
Build person-period rows (one row per round at risk, with the gap-so-far and an event flag) and fit a discrete logistic hazard:

\[ \operatorname{logit} h(k) = \beta_0 + \beta_1 \log k + \boldsymbol\beta^\top \mathbf x \]

```python
import numpy as np, statsmodels.api as sm
def person_period(m, T, session_ids):
    rows, k = [], 0
    for i in range(1, len(m)):
        if session_ids[i] != session_ids[i-1]: k = 0; continue      # no straddling
        k += 1; y = int(m[i] >= T); rows.append((np.log(k), y))
        if y: k = 0
    X, y = np.array([[1.0, r[0]] for r in rows]), np.array([r[1] for r in rows]); return X, y
X, y = person_period(mult, 10.0, sess)
fit = sm.GLM(y, X, family=sm.families.Binomial()).fit(cov_type="cluster", cov_kwds={"groups": sess_rows})
beta1, (lo, hi) = fit.params[1], fit.conf_int()[1]      # memoryless ⇔ β1 = 0
```
Report β₁ with a session-clustered CI for each threshold, BH-adjusted across thresholds. This is one table in the Fairness Console (F-36) and one chip on the ETA Board. It is the direct test of "overdue".

### 10.4.4 Covariates (the V6 "Moonshot ETA (Cox PH)")
Add x = {state, volatility regime, anchor phase, range-momentum z (Ch 09 §9.4.3), readiness} to the logistic hazard. This is a discrete-time Cox model. Fit on training sessions, then evaluate on **held-out sessions** against the KM baseline:
- held-out log-likelihood per person-period;
- integrated Brier score over k = 1…K ([IBS, Graf et al. via scikit-survival](https://scikit-survival.readthedocs.io/en/stable/api/generated/sksurv.metrics.integrated_brier_score.html)).

The covariate model is promoted to the ETA Board only if its held-out log-likelihood beats KM with a CI excluding 0 (the same gate as Ch 07's plugin contract). Each readiness condition then shows its fitted hazard ratio with CI. That completes the validation of the Ch 09 gauge.

### 10.4.5 ETA calibration
A median ETA is calibrated if 50% of events land at or before it. For the full distribution, compute the PIT of each realised wait under the forecast conditional survival at the moment the gap opened (and at checkpoints). The PIT must be uniform, and it uses the same machinery as Ch 08 §8.4.2. Store the checkpoints in `eta_forecasts(threshold, issued_at_round, g, median, p90, S_json, resolved_k)`.

### 10.4.6 In-round clock
During a live round alive at m₀ (and so at elapsed time t₀ = 16.67·ln m₀ seconds), the probability of reaching m is P(M ≥ m | M ≥ m₀) = S(m)/S(m₀). Under the fair law this is m₀/m. Nelson–Aalen on truncated observations estimates the same curve empirically, and the two are overlaid (F-29). The time to reach x̂ is 16.67·(ln x̂ − ln m₀) seconds, so the countdown is exact, not estimated. What is uncertain is whether the curve gets there, which is S(x̂)/S(m₀).

```ts
// eta/inround.ts
export const secondsAt = (m: number) => 16.67 * Math.log(m);
export function reachCurve(m0: number, S: (m: number) => number, targets = [2, 5, 10, 20, 50, 100]) {
  return targets.filter((t) => t > m0).map((t) => ({ target: t, pReach: S(t) / S(m0), inSeconds: secondsAt(t) - secondsAt(m0) }));
}
```

## 10.5 Data & API
| Table | Columns |
|---|---|
| `gap_state` | source_id, threshold, open_gap, last_hit_round_id, session_id |
| `km_cache` | source_id, threshold, as_of_round_id, S_json (run-length compressed), n_events, n_censored |
| `hazard_models` | threshold, version, beta_json, cov_json, train_range, heldout_ll, km_ll, promoted |
| `eta_forecasts` | as in §10.4.5 |

| Endpoint | Returns |
|---|---|
| `GET /eta/board?source=` | For each threshold: gap, KM percentile, conditional median/p90, hazard vs p̂, memorylessness β₁ ± CI, covariate ETA if promoted |
| `GET /eta/hazard?threshold=10&from=&to=` | Per-round conditional hazard series for charting (F-27) |
| `GET /eta/inround?m0=` | Reach curve (F-29) |

`gap_state` is updated in O(thresholds) per round. `km_cache` is rebuilt on alarm when `n_events` grows by 1%.

## 10.6 Tests
| Test | Assertion |
|---|---|
| `km_matches_geometric_null` | On a fair synthetic tape, KM S(k) lies within a 99% band of (1−p)^k |
| `censoring_included` | Dropping the open gap vs including it censored changes S at large k in the expected direction |
| `no_session_straddle` | Gaps never span session or source boundaries |
| `pressure_uniform_null` | On the null tape, pressure ≥ 90 occurs 10% ± 1% of the time (catches P2) |
| `memoryless_beta_null` | β₁ CI covers 0 on 95% ± 2% of 200 synthetic tapes |
| `planted_hazard_detected` | A synthetic tape with h(k) rising in k gives β₁ > 0 with q < 0.05 |
| `eta_median_calibrated` | 50% ± 2% of events land at or before the issued median on held-out data |
| `inround_reach_fair` | reachCurve under the fair law returns m₀/m exactly |

## 10.7 Measurement
For each threshold:
- integrated Brier score of the ETA distribution vs KM;
- calibration of the median ETA (50% of events should land before it);
- PIT KS distance;
- mean absolute error in rounds;
- memorylessness β₁ ± CI.

## 10.8 Features this chapter unlocks
- **F-26 ETA Board:** for each threshold (2, 5, 10, 20, 50, 100×), shows the current gap, KM percentile, conditional median/p90 ETA, hazard vs rate, and the covariate-adjusted ETA with its skill vs KM.
- **F-27 Hazard timeline:** a chart overlay of the per-round conditional hazard for 10×, with the p̂ reference line.
- **F-28 ETA alerts:** "10× conditional hazard in the top decile". The alert fires only when a promoted covariate model makes the hazard move; the gap alone does not trigger it.
- **F-29 In-round live ETA:** during a live round, the reach curve from the current m₀, empirical (Nelson–Aalen) vs fair.
