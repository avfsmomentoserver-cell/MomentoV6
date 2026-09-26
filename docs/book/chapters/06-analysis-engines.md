# 06 · Analysis Engines

Analysis engines **describe** the tape. Forecast engines (Ch 07) **predict** it. Everything below takes rounds in and returns a report out. The engines are pure functions, so they port easily between TS and Python. This chapter documents the v6.3 engine library function by function, with the exact maths. It records five implementation findings, describes the terminal's test battery (the best statistical code in the account), and sets out a reference design for one engine library with parity tests, intervals and multiple-testing control.

## 6.1 Core analysis: `MomentoV5@v6.3:functions/analysis.ts` (706 lines)
| Engine | Function | Method | Key parameters |
|---|---|---|---|
| Overview | `overview` | Counts, mean/median/max, recent stats | — |
| Exceedance | `exceedance` | P(≥t) with **Wilson CIs**; median/percentile geometric wait | `THRESHOLDS = [1.2, 1.5, 2, 3, 5, 10, 20, 50, 100, 250, 500, 1000]` |
| Streaks | `streaks(threshold=2)` | Run lengths, conditional rate by prior dry run (0–6), Markov continuation, post-≥10× rate | |
| Bands | `bands` | 6-band shares plus a **χ² test of band-to-band transitions** | `BAND_EDGES = [1.5, 2, 5, 10, 100]` |
| Ladders | `ladders(low=2, high=5, minLen=3)` | Descending runs inside [low, high); length histogram | |
| Ceilings | `ceilings(window=400, minTouches=3, tol=0.05)` | Levels touched ≥ 3 times within ±5% | |
| Tail / pressure | `tailFit(fitFrom=25)` + `pressure` | Power-law tail a·t^−b; "Mega Pressure" = current run vs median wait | targets 100 … 100,000 |
| Shape | `shape(window=60)` | Slope, acceleration, skew, kurtosis, dry zone, Pareto α with KS | |
| Moonshot | `moonshot` | Moonshot scanner score | |
| Linguistics | `linguistics(depth=200)` | 7-layer token stream (Ch 05) | |
| Gaps | `gaps` | Rounds since each live threshold, ETA median/p90, percentile | `LIVE_THRESHOLDS = [2, 5, 10, 50, 100]` |
| Walk-forward | `walkForward(warmup=300)` | Train/test split; base, markov1, streak, ewma, ensemble; Brier lift | |
| Candles | `candles(tfSeconds, limit=120)` | OHLC over the last 4,000 rounds | |
| Session phases | `sessionPhases` | Per session: eruption / expansion / steady / compressed | |
| House edge | `houseEdge` | EV table per target; edge estimate from the mean | |

V5 Python equivalents live in `MomentoV5@v6:backend/momento/analysis.py` (59 KB), `backend/features/band_analysis/relativity.py`, `moonshot_scanner/{scanner,exhaustion,linguistics}.py`, `pressure/{calculator,detector,metrics}.py` and `api/routes/mega_pressure.py` (42 KB).

## 6.2 The maths, exactly as coded
### 6.2.1 Wilson interval
```ts
export function wilson(p: number, n: number, z = 1.96): [number, number] {
  const denom = 1 + z*z/n;
  const centre = p + z*z/(2*n);
  const spread = z * Math.sqrt(p*(1-p)/n + z*z/(4*n*n));
  return [max(0,(centre-spread)/denom), min(1,(centre+spread)/denom)];
}
```
\[
\frac{\hat p + \frac{z^2}{2n} \pm z\sqrt{\frac{\hat p(1-\hat p)}{n} + \frac{z^2}{4n^2}}}{1 + \frac{z^2}{n}}
\]
This is the textbook Wilson score interval ([binomial proportion CI](https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval)). It behaves well near 0 and 1, which matters at 100×+, where hit rates are below 1%.

### 6.2.2 Geometric waits
If each round clears t independently with probability p, the wait until the first hit is geometric, and the q-quantile wait is
\[
k_q = \left\lceil \frac{\ln(1-q)}{\ln(1-p)} \right\rceil, \qquad k_{0.5} = \left\lceil \frac{\ln 2}{-\ln(1-p)} \right\rceil
\]
`medianWait(rate)` and `percentileWait(rate, q)` implement exactly this. At p = 0.5047 (P(≥2) on the canonical tape) the median wait is 1 round; at p = 0.00941 (≥100×) it is 74 rounds and the 90th percentile is 244.

### 6.2.3 Tail fit
`tailFit` counts hits at fixed thresholds [25, 50, 100, 250, 500, 1000, 2500, 5000]. It fits \(\ln \hat P(\ge t) = \ln a - b \ln t\) by ordinary least squares, and falls back to a = 0.9497, b = 1.006 (the canonical fit) with fewer than two points. The fair-game model \(P(\ge t) = (1-h)/t\) predicts **b = 1 and a = 1 − h**. The canonical fit matches it closely: b = 1.006, a = 0.9497, which implies h ≈ 5%. That edge estimate is inflated by the low-end capture bias (Ch 03).

### 6.2.4 Pressure
For each target t: `rate` = the empirical rate if there are ≥ 5 hits, else the modelled rate. Then `pressurePct = min(99, round(currentRun / medianWait · 50))`. Overall pressure is the mean over targets, labelled calm < 40 ≤ building < 65 ≤ loaded < 85 ≤ critical.

**Model note.** Pressure is a *descriptive* ratio: how long this drought is compared with a typical one. Under the geometric model the conditional probability of a hit does not depend on the current run. So pressure is a forecasting feature only if the data show it is. App. D records the test: pressure ≥ 70 gives +3.53% lift, not significant. The UI should present pressure as "how unusual is this drought" (a percentile of the run-length distribution) and pair it with the measured conditional hit rate at that pressure level (F-11).

### 6.2.5 Band transitions χ²
`bands()` builds a 6×6 transition count matrix over consecutive rounds and computes Pearson's χ² for independence. It flags `independent: chi < 37.65`.

## 6.3 Five implementation findings
| # | Finding | Location | Consequence | Fix |
|---|---|---|---|---|
| N1 | **χ² cut-off comment is wrong.** 37.65 is the 0.95 quantile of χ²(25), not the 0.999 quantile (52.62) | `bands()` | The flag is a 5% test, not a 0.1% test | Report the p-value from the χ² survival function instead of a boolean |
| N2 | **Transitions straddle session and source boundaries.** `bands(rounds)` iterates the whole merged tape; the last round of one session pairs with the first of the next, and with `source = all`, rounds from different sources interleave by time | `bands`, `streaks`, `walkForward` | A mixture of sources or sessions with different distributions creates **apparent dependence** even when each source is independent. This is one candidate explanation for the canonical χ² = 837.6 on 25 dof | Count pairs within (source, session) only; §6.6 |
| N3 | **Walk-forward "streak" model is a no-op.** The loop computes `s` and discards it (`void s; return baseRate`) | `walkForward` | The leaderboard's "streak" row is the base rate under another name | Implement it or remove the row |
| N4 | **Walk-forward uses one split.** Train is `[warmup, split)`, test is `[split, n)`, verdict "accepted" if the ensemble Brier ≤ 0.995 × base | `walkForward` | One split is noisy; 0.5% of Brier is within sampling noise at small n | Rolling origin with a Diebold–Mariano-style test (Ch 08 §8.6) |
| N5 | **Quadratic loops.** `streaks` rescans back for each round's dry run; `gaps`, `pressure` and `houseEdge` filter the full array per threshold | several | Fine at 10k rounds, slow at 178k inside a DO request | One pass with running counters (Ch 04 §4.6) |

Also: `houseEdge.estimatedEdge = 1 − 1/mean(m)`. That relation holds only if E[m] = 1/(1 − h). For the fair model the **mean is infinite**, since \(\int (1-h)/m\,dm\) diverges, so the sample mean never settles (App. D reports 10.604 on 178k rounds). Use the terminal's two estimators instead (§6.5).

## 6.4 FX engines: `functions/fx.ts` (517 lines)
These are trading-desk analytics applied to the Points series (Ch 09).

| Engine | Default | Reading | Validation needed |
|---|---|---|---|
| `correlationEngine` | threshold 2, maxLag 20 | Autocorrelation of hit indicators by lag | Bartlett band ±1.96/√n; Ljung–Box across lags |
| `volatilityProfile` | window 50 | Rolling σ of Points; regime calm / normal / storm | Regime persistence vs shuffled tape |
| `orderFlow` | bucket 20 | Up/down "flow" imbalance | Lift of next-bucket hit rate |
| `supportDensity` | window 800, 36 bins | Histogram of where rounds cluster (support/resistance zones) | Compare with the fair-curve histogram |
| `breakout` | window 30, horizon 10 | Squeeze and breakout detection | Hit rate within horizon vs 1−(1−p)^10 |
| `meanReversion` | — | Half-life of deviations | AR(1) coefficient CI |
| `trendQuality` | window 60 | R² of the local trend | R² under the null is not 0; report against shuffles |
| `eventRisk` | window 200, scan 4000 | Probability of a tail event in the window | Calibration curve |
| `divergence` | thresholds 2, 5, 10 | Short vs long rate divergence | Two-proportion test |
| `fxSignals` | — | Composite signals feeding the `signals` forecast component | Via Reliability Studio |

The "validation needed" column is this book's addition. Each engine gets a matching **null baseline**: the same statistic computed on 200 shuffled copies of the tape. The UI then shows where the real value falls in the shuffle distribution. That is the cheapest way to make every FX tile honest without changing its maths.

## 6.5 Terminal additions: `ShapeShifters@momento-terminal-replace`
### 6.5.1 `windows.py`
Exceedance grid, droughts, hour phases and window odds. **Every rate carries a Wilson 95% interval**, and window probabilities are reported as intervals by propagating the Wilson bounds through 1−(1−p)ⁿ. This is exact because the map is monotone in p.

### 6.5.2 `randomness.py`: the test battery
Its docstring states the null model precisely:

> P(M ≥ m) = (1 − h)/m for m ≥ 1, a point mass h at exactly 1.00×, rounds i.i.d. "If these tests do not reject the null, no pattern engine can have an edge and the app says so out loud. That is a feature, not a caveat."

| Test | Function | What it measures |
|---|---|---|
| House edge ×2 + tail α | `estimate_house_edge` | (a) instant-crash share; (b) implied RTP = mean over t of t·P̂(≥t); (c) tail MLE \(\hat\alpha = n/\sum \ln m\) with SE \(\hat\alpha/\sqrt n\), fair α = 1 |
| χ² goodness of fit | `chi_square_fit(h=0.03)` | Binned counts vs the fair curve |
| KS | `ks_test` | Whole-distribution distance |
| Runs | `runs_test(threshold=2)` | Wald–Wolfowitz runs above/below 2× |
| Autocorrelation | `autocorrelation(max_lag=20)` | Lagged correlation |
| Conditional dependence | `conditional_dependence(threshold=2)` | 5-band × {hit, miss} contingency χ²: "the decisive test for every pattern engine" |
| Digit uniformity | `digit_uniformity` | Last-digit distribution (rounding and encoding artefacts) |
| All of it | `full_battery(h)` | One report |

**Adopt `full_battery` as a first-class v6 engine** (`/api/v1/analysis/fairness`, Ch 13). It is the only place in the account where the null model is written down and tested directly.

## 6.6 Re-running the transition test correctly
The canonical χ² of 837.6 on 25 dof (App. D) is the strongest structural result in the account. Before any engine builds on it, reproduce it under three controls:
1. **Per source.** Compute the matrix for `avfs`, `momento_prev` and `momento_project` separately.
2. **Within session only.** Skip pairs that cross a 30-minute gap.
3. **Gap-free sessions only.** Restrict to sessions with capture completeness ≥ 99.5% (Ch 03 §3.6), because missing low rounds create spurious band-to-band structure.

Then combine the per-stratum tables. Either sum the per-stratum χ² values and their dof, or use a Cochran–Mantel–Haenszel-style stratified test. Report the result next to the pooled one.

```python
def stratified_transition_chi2(df, edges=(1.5, 2, 5, 10, 100)):
    import numpy as np
    from scipy.stats import chi2_contingency, chi2
    total, dof, rows = 0.0, 0, []
    for (src, sess), g in df.sort_values("ts_ms").groupby(["source", "session_id"]):
        b = np.digitize(g.multiplier.values, edges)
        if len(b) < 200: continue
        M = np.zeros((6, 6)); np.add.at(M, (b[:-1], b[1:]), 1)
        M = M[M.sum(1) > 0][:, M.sum(0) > 0]
        stat, p, d, _ = chi2_contingency(M, correction=False)
        total += stat; dof += d; rows.append((src, sess, len(b), stat, d, p))
    return dict(chi2=total, dof=dof, p=chi2.sf(total, dof), strata=rows)
```
Interpretation:
- If the stratified statistic stays far above its dof, there is genuine within-session dependence to model. Engines such as Markov (Ch 07) then have a measurable foundation, and F-13 (regime-aware weights) becomes a priority.
- If it collapses toward its dof, the pooled result came from mixing, and the engines should treat rounds as independent within a session.

The platform needs this answer more than any single feature. It belongs in the Experiment Registry (F-34) as experiment #1.

## 6.7 Reference design: one engine library
### 6.7.1 Structure
```
packages/engines/
  src/core/        wilson.ts, waits.ts, bands.ts (fine+coarse), points.ts
  src/describe/    exceedance.ts, streaks.ts, bands.ts, ladders.ts, ceilings.ts, tail.ts, pressure.ts, shape.ts
  src/fx/          correlation.ts, volatility.ts, ... (one file per engine)
  src/fairness/    battery.ts (port of randomness.py)
  src/null/        shuffle.ts (seeded Fisher–Yates), nullDistribution.ts
  fixtures/        tape-10k.json, tape-synthetic-fair-50k.json, golden/*.json
research/momento_research/engines/   Python mirror, checked against golden files
```

### 6.7.2 Engine contract
```ts
export interface Engine<P, R> {
  id: string;                 // "describe.exceedance"
  version: string;            // semver; bump on any output change
  params: z.ZodType<P>;       // validated, with defaults
  run(tape: Tape, p: P): R;   // pure, deterministic, causal
  nullable?: boolean;         // supports shuffle baselines
  outputs: OutputSpec[];      // each numeric output declares {name, kind: "rate"|"count"|"stat", ciMethod?}
}
```
- **Causal:** the output at index i depends only on rounds ≤ i. A test appends random rounds and asserts that earlier outputs do not change.
- **Versioned:** results cached in `analysis_snapshots` (Ch 04) carry `engine_version`, so an upgrade invalidates the right entries.
- **Declared outputs:** the UI uses `ciMethod` to show intervals automatically.

### 6.7.3 Parity CI
`MomentoV5` already has a `PARITY_REPORT.md` for the V5 → v6 port. Turn it into CI: `engines-parity.yml` runs TS and Python on the fixtures and diffs the JSON with tolerances (1e-9 for counts and rates, 1e-6 for fitted parameters). The build fails on any unexplained difference.

### 6.7.4 Tail estimation
Replace OLS on cumulative log-counts with maximum likelihood:
- **Hill estimator** above a threshold u: \(\hat\alpha_u = \left(\frac1k\sum_{i=1}^k \ln\frac{m_{(i)}}{u}\right)^{-1}\), the standard estimator for a regularly varying tail index ([heavy-tailed distributions](https://en.wikipedia.org/wiki/Heavy-tailed_distribution); [tail-index estimation, INRIA](https://inria.hal.science/hal-03235031v1/file/slides_RESIM_2021.pdf));
- show a **Hill plot** of α̂ against k to choose u;
- report α̂ ± 1.96·α̂/√k and test α = 1.

The terminal's `survival.py` (`hill_alpha`) and `estimate_house_edge` already do this. Cumulative counts at nested thresholds are strongly correlated, so OLS on them understates uncertainty. That is why the MLE is preferred.

### 6.7.5 Multiple-testing hygiene
The dashboard shows dozens of "signals" at once. Tag each with a Benjamini–Hochberg q-value computed over **everything on the screen** ([FDR](https://en.wikipedia.org/wiki/False_discovery_rate)). The procedure is only a few lines:
```ts
export function bhQ(p: number[]): number[] {
  const m = p.length, idx = p.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const q = new Array(m); let min = 1;
  for (let r = m; r >= 1; r--) { const [pv, i] = idx[r - 1]; min = Math.min(min, pv * m / r); q[i] = min; }
  return q;
}
```

### 6.7.6 Incremental computation
V5 has `incremental_features.py` and `parallel_features.py`. Move the descriptive engines onto rolling accumulators: counters for rates, Welford for mean/variance, ring buffers for windows, and log-bucket histograms for quantiles. A new round then updates the reports in O(1) instead of recomputing 5,000+ rounds (Ch 04 §4.6).

## 6.8 Where the dependence comes from: the research tapes, measured
The canonical χ² of 837.6 on 25 dof (D-4) is the single strongest piece of "structure" in the evidence base. N2 names pooling as a candidate cause. This section tests that directly, first on synthetic tapes and then on the two research tapes committed in the account:
- `InvestigationSuite@decomputation:data/avfs.db`: 150,416 rounds;
- `MomentoFX:clean_data.csv`: 60,215 rounds, the mega-plan set in D-9.

The canonical 177,905-round tape is not committed in any branch, so it could not be re-tested directly.

### 6.8.1 What can inflate χ² on a fair tape (simulation)
All tapes are fair and i.i.d. at h = 3% with 177,905 rounds, using the v6.3 6-band edges. The median of 5–20 runs is reported. The χ²(25) 95% cut-off is 37.65 and the 99.9% cut-off is 52.62.

| Mechanism | χ² |
|---|---|
| None (homogeneous) | 25.4 |
| 33 sessions, each losing 0–40% of its sub-1.5× rounds (pooled) | 28.7 (26.1 stratified) |
| Two sources (h = 1% and 10%) alternating in blocks of 500 | 34.4 |
| Timestamp-less batches of 10 / 20 / 50 with repeats collapsed (I1) | 27.5 / 27.9 / 35.3 |
| 1% of rounds recorded twice in a row | 103.8 |
| **3% of rounds recorded twice in a row** | **712.2** |
| 5% recorded twice | 2,221.7 |

Pooling and capture loss barely move the statistic. **Duplicated rounds** do: a 3% duplicate rate is enough to produce a χ² of the canonical size. A duplicate is the same round stored twice with two different timestamps, so the `(source, ts_ms, multiplier)` unique index does not catch it.

### 6.8.2 `clean_data.csv` (60,215 aviator rounds, 24–28 July 2026)
| Statistic | Value |
|---|---|
| t·P(≥t) at 2 / 10 / 100 | 0.968 / 0.962 / 0.973 (fair law at h ≈ 3% fits) |
| Consecutive equal values | 1.56%, against 0.46% expected from the marginal |
| Equal consecutive pairs < 50 ms apart | 484 |
| χ² as stored | 54.5 |
| **χ² after removing the 484 near-simultaneous repeats** | **26.1** |

The whole excess dependence in this tape is explained by one mechanism: the collector wrote some rounds twice, a few milliseconds apart.

### 6.8.3 `avfs.db` (150,416 rows, `rounds` table)
The rows have a `source_file` and a `timestamp` string. Grouped by provenance:

| Subset | Rows | t·P(≥2) | t·P(≥10) | χ² |
|---|---|---|---|---|
| All rows | 150,416 | 1.017 | 0.916 | **869.2** |
| aviator | 72,570 | 1.061 | 0.850 | 1,472.5 |
| skyward | 31,925 | 0.973 | 0.987 | 28.5 |
| skyward_deluxe | 45,912 | 0.979 | 0.972 | 35.4 |
| aviator rows with **microsecond timestamps** (`…36.334144+00:00`), all written on 2026-07-03, all within milliseconds of each other | 7,696 | **1.827** | **0.012** | 2,436.3 |
| aviator rows with ordinary millisecond timestamps | 57,025 | 0.970 | 0.951 | **25.7** |
| **Clean set:** all capture rows minus the microsecond batch, test files, a 2024 fixture and `jetx` | 142,680 | 0.973 | 0.965 | **27.5** |
| Clean set, table pooled within source | 142,680 | — | — | 26.8 |

**Reading.**
1. **One batch explains the result.** 7,696 rows (5.1% of the database) written in one burst on 3 July account for essentially all of the dependence and all of the departure from the fair curve. P(≥2) is 91% inside that batch and P(≥10) is 0.1%. A normal round history does not look like that. Where the batch came from is not recorded: there is no `ingest` method, no `ts_synthetic` flag and no batch id. The only safe choice is to treat it as non-capture data.
2. **Without that batch the tape matches the fair law.** At h ≈ 3% the three thresholds give 0.973, 0.965 and 0.988, and χ² = 27.5 on 25 dof. The per-source subsets agree.
3. **The database also holds non-round rows:**
   - 5 hand-written fixture rows dated 2024-01-01 at one-minute spacing (values 1.5, 3.2, 12.7, …);
   - 30 rows from `*_test_*` files;
   - 4 rows whose source is the literal string `${src}`, an unexpanded template placeholder from a collector.

**Consequence for the canonical numbers.** D-1 to D-4 come from a different, larger tape that is not in the repos. Its signature matches this batch-contaminated pattern: t·P(≥2) > 1 while t·P(≥10) < 0.97, plus a large χ². The first Phase 1 task is therefore to rerun D-1 to D-4 per ingest batch and per timestamp format, before any feature is built on "structure" in the tape. The code to do it is below.

### 6.8.4 Reproduce
```python
import sqlite3, numpy as np, pandas as pd
EDGES = [1.5, 2, 5, 10, 100]
def chi2_transitions(m):
    b = np.searchsorted(EDGES, m, side="right"); C = np.zeros((6, 6))
    np.add.at(C, (b[:-1], b[1:]), 1); E = np.outer(C.sum(1), C.sum(0)) / C.sum()
    return ((C - E) ** 2 / E)[E > 0].sum()
a = pd.read_sql("SELECT * FROM rounds", sqlite3.connect("avfs.db"))
a["t"] = pd.to_datetime(a.timestamp, format="ISO8601", utc=True)
a = a.sort_values(["t", "id"])
micro = a.timestamp.str.len() == 32                       # '2026-07-03T00:38:36.334144+00:00'
junk = a.source_file.str.contains("test") | (a.t.dt.year < 2026) | ~a.source.isin(["aviator", "skyward", "skyward_deluxe"])
for name, x in [("all", a), ("micro batch", a[micro]), ("clean", a[~micro & ~junk])]:
    m = x.multiplier.to_numpy()
    print(name, len(m), [round(t * (m >= t).mean(), 3) for t in (2, 10, 100)], round(chi2_transitions(m), 1))
```

### 6.8.5 Findings
| # | Finding | Fix |
|---|---|---|
| N6 | **Duplicates and burst-inserted rows, not game dynamics, produce the transition structure** in both committed research tapes | A duplicate detector at ingest: same m within Δt below half the minimum round time goes to quarantine. A burst detector: more than 20 rows within 1 s goes to quarantine as `burst`. Both feed F-01 |
| N7 | **Research databases mix fixtures, tests and placeholder sources** (`${src}`) with capture data | A `kind` column (capture, import, fixture, test), with `kind = 'capture'` as the default filter for every statistic |

### 6.8.6 Walk-forward false acceptance (N4, measured)
`walkForward` accepts a model if its test-half Brier ≤ 0.995 × the baseline's. The test: 400 fair tapes, with the "model" a 50/50 blend of the train base rate and a trailing-100 frequency. The blend has no skill by construction.

| Tape length | False acceptance |
|---|---|
| 1,000 | 12.3% |
| 2,000 | 4.0% |
| 5,000 | 0.5% |
| 20,000 | 0.0% |

On short tapes, one split plus a 0.5% margin accepts a no-skill model up to one time in eight. Replace it with the rolling-origin test and block-bootstrap CI from Ch 08, and require the lower CI bound above zero.

## 6.9 Tests
| Test | Assertion |
|---|---|
| `wilson_reference` | Matches `statsmodels.proportion_confint(method="wilson")` on a 1,000-case grid |
| `geometric_wait` | Monte-Carlo median wait at p ∈ {0.5, 0.1, 0.01} equals `medianWait` ± 1 |
| `hill_fair` | On a synthetic fair tape (m = 0.97/U, floored at 1), α̂ covers 1 in ≈ 95% of 1,000 seeds |
| `chi2_null` | On a synthetic fair tape, the transition χ² p-value is uniform (KS p > 0.01 over 500 seeds) |
| `chi2_mixture` | Interleaving two fair tapes with different h yields pooled rejection but stratified non-rejection (demonstrates N2) |
| `causality` | Appending rounds never changes outputs at earlier indices |
| `parity` | TS == Python on fixtures |

## 6.10 Measurement
- Engine p95 latency on a 5k window < 20 ms; full refresh < 500 ms at 250k rounds.
- Parity drift: 0 unexplained differences.
- The share of UI signals with q < 0.10, tracked over time. On a tape close to the null this should stay near 10% of the signals shown.

## 6.11 Features this chapter unlocks
- **F-09 Engine Workbench:** run any engine with custom parameters on any slice (source, session, date), with the null-shuffle band, and save it as a `backtest_runs` row.
- **F-10 Cross-source comparator:** the same engine on two sources side by side, with a two-sample test on the difference (two-proportion z, KS, or a permutation test).
- **F-11 Signal significance strip:** every signal tile shows lift, CI and a BH q-value.
- **F-36 Fairness Console:** `full_battery` per source and session (Ch 13).
