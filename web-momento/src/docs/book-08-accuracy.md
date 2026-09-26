# 08 · Accuracy & Verification

Momento's most valuable asset is its **accuracy ledger**. Every forecast is stored before its outcome is known, then scored for ever. This chapter covers:
- how the v6.3 scheduler, resolver and calibration ledgers work, line by line;
- four findings that affect the numbers the UI shows today, one of which inflates "skill vs baseline" on the window ledger;
- a reference design for verification: decomposed Brier scores, PIT, adaptive conformal ranges, significance tests on skill, void resolutions and a hash-chained record.

## 8.1 What exists
### 8.1.1 Accuracy Engine v2 (`MomentoV5@v6.3:docs/markdown/accuracy-engine.md`)
1. **Schedule.** For every window (15m · 1h · 4h · 1d · 7d) × threshold (2 · 5 · 10×), keep exactly one open prediction: P(at least one round in the window ≥ threshold). Store the components too.
2. **Resolve.** Count the actual rounds in the window and score Brier and log-loss.
3. **Accumulate.** Keep O(1) running sums per (model, window, threshold): n, brier_sum, base_sum, logloss_sum, hits. Nothing is pruned.
4. **Earn weight.** skill = baseline Brier − model Brier. Positive skill earns normalised weight.
5. **Verify at scale.** Walk forward over non-overlapping blocks of full history, at O(n) per threshold.

The scheduler has **two drivers**: a Durable Object *alarm* at the next due time (Ch 04 §4.2.3), and `/accuracy/tick` from the dashboard. An `accuracyBusy` flag prevents overlapping ticks.

### 8.1.2 The tick, as coded (`core.ts: accuracyTick`)
```ts
// 1. resolve matured predictions
matured = SELECT * FROM scheduled_predictions WHERE resolved_ms IS NULL AND due_ms <= now;
for f of matured:
  n = SELECT COUNT(*) FROM rounds WHERE ts_ms > f.created_ms AND ts_ms <= f.due_ms AND multiplier >= f.threshold;
  actual  = n > 0 ? 1 : 0;
  brier   = (p - actual)^2;
  baseP   = components.find(c => c.model === "baseline")?.p ?? 0.5;     // ← per-round rate
  baseBrier = (baseP - actual)^2;
  logloss = -(y ln p + (1-y) ln(1-p));
  upsertLedger("pipeline", window, threshold, {n:1, brierSum, baseSum: baseBrier, loglossSum, hits: (p>=0.5)===(actual===1)});
  appendAccuracyHistory(window, threshold);                              // pruned to last 400 points
// 2. recomputeWeights()  — skill = (Σbase − Σbrier)/n per model, positive skills normalised
// 3. schedule one open prediction per (window, threshold) using perRoundProbability + windowProbability
```

### 8.1.3 Per-round calibration ledgers
`round_calibrations` (band model) and `intel_calibrations` (full intelligence) store, for each round, the forecast for it. The fields are expected, range, reach, confidence, dist, weights, per-engine loss (`comp_loss`), mix vs base loss, actual, **verdict**, band error and log error. `calibrateNewRounds()` runs after every ingest:
- For each new round r, it rebuilds the forecast from `history = rounds with ts < r.ts` and scores it.
- Rectification is measured against the **raw** (uncorrected) estimate, so that "rectification measures drift, not itself".
- On bulk imports, catch-up is capped at the most recent 300 rounds (`intel_backtest_rounds`, default 150 on first boot).

### 8.1.4 Other verification code
| Location | What |
|---|---|
| `analysis.ts: walkForward(warmup 300)` | Threshold verdicts and leaderboard (Ch 06 findings N3, N4) |
| `pipeline.ts: verifyAgainstHistory`, `skillsFromRuns` | Block walk-forward; `/accuracy/verify` writes per-model ledger rows |
| `ShapeShifters@…:strategies.py` | Strictly causal backtest, `calibration()`, `strategy_grid` |
| `ShapeShifters@…:tests/test_predictor_arming.py`, `test_reality_checks.py` | Predictor arming and reality checks |
| `ShapeShifters RESEARCH.md §10` | **κ calibration**: κ = clamp(0.6 + h, 0.6, 1.4); displayed conf = clamp(raw·κ, 5, 97); ≥ 30 resolved before trusting κ |
| `MomentoV5@v6:backend/tests/test_prediction_accuracy.py` | V5 accuracy tests |
| `momento-core@research/csv-suite` | Causality, scoring and significance tests |

## 8.2 Four findings
| # | Finding | Effect on displayed numbers | Fix |
|---|---|---|---|
| V1 | **Baseline mismatch in the window ledger.** `baseBrier` uses the baseline's **per-round** probability (e.g. 0.50 for 2×), but the outcome is "any hit in the window". In a 1h window at 2× the outcome is almost always 1. The model's window probability is ≈ 1 (Brier ≈ 0); the baseline's 0.50 gives Brier 0.25 | **Window "skill vs baseline" is strongly inflated**. The comparison is between a window forecast and a per-round rate, not between two window forecasts | Baseline window probability = `windowProbability(baseRate, nR)`; store it on the row (`base_p`) and score against it |
| V2 | **Live tick writes only `model = 'pipeline'`.** Components (markov, streak, recent) get ledger rows only from `/accuracy/verify` block backtests (with fixed 0.25 weights) | Live `engine_weights` for components come from backtests, not from live forecasts; `pipeline` itself also receives a weight | Store each component's window probability at schedule time and resolve all of them; exclude `pipeline` from weight normalisation |
| V3 | **Collector downtime scores as a miss.** Resolution counts rounds in (created, due]; if no rounds were captured, `actual = 0` | Outages create false "no hit" outcomes, which make low forecasts look good | Resolve as `void` when window completeness < 95% (F-01) |
| V4 | **Per-round ledgers are reconstructed, not committed.** `calibrateIntel` recomputes the forecast for round i from `rounds[0..i)` *after* round i arrives, and stamps `created_ms = target.tsMs` | The computation is causal (no look-ahead), but the record is not a commitment: a code change or re-ingest changes history, and bulk imports score only the last 300 rounds | Commit the forecast for round i+1 **at ingest of round i** (the forecast the user actually saw), hash-chained (§8.4.5). Keep reconstruction as an explicitly labelled *backtest* |

V1 is the most important. Until it is fixed, window-level skill should not be shown as evidence of skill. The per-round mixture skill (`intel_calibrations`, mix vs base log-loss) is not affected, because there the baseline is a per-round band distribution compared with a per-round outcome.

Also note that `hits = (p ≥ 0.5) === actual` is accuracy at a 0.5 cut. For rare targets that cut makes "always predict no" look excellent. Show it only next to the base rate.

## 8.3 Target design: what the ledger must answer
| Question | Metric | Needs |
|---|---|---|
| Is the forecast better than the measured rate? | Log-score and Brier skill vs a **like-for-like** baseline, with CI | V1 fix, bootstrap |
| Are the probabilities honest? | Reliability diagram, reliability term, PIT uniformity | Binned sums |
| Does the model discriminate? | Resolution term, AUC for binary targets | Binned sums |
| Do the ranges cover? | Empirical coverage of p25–p75 and p10–p90 | Coverage counters, ACI |
| Is the record trustworthy? | Hash chain, void rate, commitment time before outcome | F-18 |

## 8.4 Reference design
### 8.4.1 Score decomposition
The Brier score decomposes into **reliability − resolution + uncertainty** ([NOAA SWPC verification primer](https://www.spaceweather.gov/sites/default/files/images/u30/Ensemble%20Forecast%20Verification.pdf); [ECMWF ensemble verification](https://www.ecmwf.int/sites/default/files/elibrary/2005/15865-verification-ensembles.pdf)):
\[
BS = \underbrace{\tfrac1N\textstyle\sum_k n_k(\bar p_k - \bar o_k)^2}_{\text{reliability}} - \underbrace{\tfrac1N\textstyle\sum_k n_k(\bar o_k - \bar o)^2}_{\text{resolution}} + \underbrace{\bar o(1-\bar o)}_{\text{uncertainty}}
\]
Add three running sums per forecast-probability bin (10 bins): `n_k`, `sum_p_k` and `sum_y_k`. That is enough to produce:
- a **reliability diagram** (mean forecast vs observed frequency per bin);
- the **Brier skill score** BSS = 1 − BS/BS_ref;
- the **reliability and resolution** terms separately. Resolution is the "does the model discriminate" number.

The update stays O(1) per resolution and never needs pruning. Proposed table:
```sql
CREATE TABLE reliability_bins (
  model TEXT, target TEXT, window TEXT, bin INTEGER,          -- bin = floor(p*10)
  n INTEGER NOT NULL DEFAULT 0, sum_p REAL NOT NULL DEFAULT 0, sum_y REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (model, target, window, bin));
```
```ts
export function decompose(bins: { n: number; sum_p: number; sum_y: number }[]) {
  const N = bins.reduce((a, b) => a + b.n, 0); const obar = bins.reduce((a, b) => a + b.sum_y, 0) / N;
  let rel = 0, res = 0;
  for (const b of bins) if (b.n) { const pk = b.sum_p / b.n, ok = b.sum_y / b.n; rel += b.n * (pk - ok) ** 2; res += b.n * (ok - obar) ** 2; }
  return { reliability: rel / N, resolution: res / N, uncertainty: obar * (1 - obar) };
}
```
The decomposition is exact only if forecasts within a bin are equal. With 10 bins there is a small within-bin term, so report it as "≈" or use 20 bins.

### 8.4.2 Distribution calibration: PIT
For the full band distribution, compute the **probability integral transform** of each outcome. For discrete bands, use a **randomised PIT**: if the outcome lands in band j, draw \(u \sim U(F(j-1), F(j))\). A calibrated forecaster yields uniform PIT values ([Dawid 1984 via Czado et al., Biometrics](https://academic.oup.com/biometrics/article/65/4/1254/7333505); [PIT miscalibration diagnosis, ESANN 2024](https://www.esann.org/sites/default/files/proceedings/2024/ES2024-15.pdf)). Store a 10-bin PIT histogram per engine. Its shape tells you whether the engine is:
- over-confident (U-shape);
- under-confident (hump);
- biased (slope).

A deterministic seed per round id (for example `hash(round_id)`) makes the randomised PIT reproducible.

### 8.4.3 Coverage-guaranteed ranges: adaptive conformal
"Range p25–p75" should *actually* contain the outcome 50% of the time. Use **Adaptive Conformal Inference (ACI)**. After each round:
- update α_t ← α_t + γ(α − err_t);
- widen or narrow the quantile level used for the range accordingly.

ACI gives long-run coverage guarantees even under distribution shift ([Adaptive conformal predictions for time series](https://www.alphaxiv.org/abs/2202.07282); [ACI multi-step, arXiv:2409.14792](https://arxiv.org/html/2409.14792v1); [conformal time-series survey](https://www.alphaxiv.org/abs/2511.13608)).
```ts
export function aciStep(s: { alphaT: number }, alpha: number, covered: boolean, gamma = 0.005) {
  const err = covered ? 0 : 1;
  s.alphaT = Math.min(0.99, Math.max(0.01, s.alphaT + gamma * (alpha - err)));
  return s;                       // next range = [q(alphaT/2), q(1 - alphaT/2)] of the mixture
}
```
Store α_t in `conformal_state` (App. A). Then show "Range (50% nominal · 49.7% observed over the last 2,000)". This replaces the fixed 0.6/0.4 rectification multipliers on the range (Ch 07 E2).

### 8.4.4 Is the skill real? Significance on the ledger
Skill is a mean of per-round score differences \(d_t = L^{base}_t - L^{mix}_t\). These are autocorrelated (the forecasts share history), so a naive t-test overstates significance. Use either of these:
- a **Diebold–Mariano test** with a HAC (Newey–West) variance estimate;
- a **moving-block bootstrap** on \(d_t\) with block length ≈ n^{1/3}.

```python
def block_bootstrap_ci(d, B=2000, block=None, alpha=0.05, rng=np.random.default_rng(7)):
    n = len(d); block = block or max(5, int(round(n ** (1/3))))
    starts = np.arange(n - block + 1); means = []
    for _ in range(B):
        idx = np.concatenate([np.arange(s, s + block) for s in rng.choice(starts, n // block + 1)])[:n]
        means.append(d[idx].mean())
    lo, hi = np.quantile(means, [alpha/2, 1 - alpha/2]); return d.mean(), lo, hi
```
The UI shows skill as "+0.4% (95% CI −0.3% to +1.1%)". The confidence gate in Ch 07 (HIGH requires skill ≥ 3%) should use the **lower CI bound**, not the point estimate.

### 8.4.5 Resolution integrity and the hash chain
- **Commit before outcome.** A prediction row must have `created_ms <` the first `ts_ms` of its window. Enforce it at insert (reject otherwise). Per-round forecasts are committed at ingest of the previous round (fixes V4).
- **Void, don't guess.** Resolution uses `rounds WHERE ts_ms BETWEEN window` **plus the Tape Integrity of that window** (F-01). Windows below 95% completeness resolve as `void`, not as a miss or hit (fixes V3).
- **Hash chain.** `hash_i = sha256(hash_{i−1} ‖ canonical_json(row_i))`, covering the prediction fields at commit and, separately, the resolution fields at resolve. Publish the head hash daily (for example, as a signed commit to a public repo). The record then becomes tamper-evident, which is a product feature in its own right (F-18).

```ts
async function commit(sql: SqlStorage, row: PredictionRow) {
  const prev = (sql.exec("SELECT hash FROM ledger_chain ORDER BY seq DESC LIMIT 1").toArray()[0]?.hash as string) ?? "GENESIS";
  const body = canonical(row);                                   // sorted keys, fixed float formatting
  const hash = await sha256hex(prev + body);
  sql.exec("INSERT INTO ledger_chain (seq, kind, ref_id, body, prev, hash, created_ms) VALUES (NULL,'commit',?,?,?,?,?)",
           row.id, body, prev, hash, Date.now());
}
```
A public `/verify` page recomputes the chain from exported NDJSON in the browser and compares it with the published head. Nobody has to trust the server to check it.

### 8.4.6 Like-for-like baselines
| Target | Baseline |
|---|---|
| Next-round band | Full-history band shares (as now), plus a **fair-curve** baseline from (1−h)/t |
| P(≥t next round) | Trailing-N measured rate |
| P(any ≥ t in window) | `1 − (1 − rate)^nR` using the **same** nR as the model |
| ETA to ≥ t | Geometric waiting time at the measured rate |

Two baselines, measured and fair, answer two different questions: "is the model better than the tape's own history?" and "is the model better than the published game maths?"

## 8.5 Implementation plan
1. **Fix V1** (1 day): add `base_p` to `scheduled_predictions`, compute it with the same nR, and backfill the resolved rows from stored components where possible. Otherwise mark them `legacy_baseline = 1` and exclude them from skill.
2. **Fix V2** (2 days): component rows per scheduled prediction (`scheduled_components(pred_id, model, p)`) and ledger rows per model.
3. **Void resolutions** (1 day, needs F-01 completeness).
4. **Committed per-round forecasts plus hash chain** (3 days).
5. **Reliability bins, PIT and ACI** (4 days).
6. **Bootstrap CI job on alarm**, nightly (2 days).
7. **Reliability Studio UI** (F-17, 5 days).

## 8.6 Tests
| Test | Assertion |
|---|---|
| `baseline_like_for_like` | On a synthetic fair tape, window skill vs baseline has CI covering 0 at every window × threshold (catches V1) |
| `component_ledgers_live` | After 100 ticks, each component has live ledger rows |
| `void_on_outage` | Deleting all rounds in a window resolves it as `void` |
| `commit_before_outcome` | Inserting a prediction whose window started earlier throws |
| `chain_verify` | Tampering with any stored field breaks chain verification at that row |
| `pit_uniform_fair` | A forecaster that outputs the true fair distribution on synthetic data has PIT KS p > 0.01 |
| `aci_coverage` | Empirical coverage converges to 50% ± 2% within 5,000 rounds on a drifting synthetic tape |
| `decomposition_identity` | reliability − resolution + uncertainty equals Brier within the within-bin term |

## 8.7 Measurement
| Number | Definition | Show where |
|---|---|---|
| Log-score skill (with CI) | 1 − L_mix/L_base, block-bootstrap CI | Command Center tile |
| BSS | 1 − BS/BS_base per window × threshold (like-for-like) | Accuracy page |
| Reliability / resolution | Decomposition terms | Reliability Studio |
| Coverage error | observed − nominal coverage of Range | Forecast Studio |
| PIT KS distance | sup \|F_PIT − U\| | Reliability Studio |
| Void rate | void resolutions / total | Ingest page |
| Commit lead time | median (outcome_ts − created_ms) | Ledger page |

## 8.8 Features this chapter unlocks
- **F-17 Reliability Studio:** reliability diagram, BSS, resolution, PIT histograms and coverage by engine, window and state.
- **F-18 Tamper-evident track record:** a hash-chained public ledger with a browser-side verification page.
- **F-19 Accuracy gates per product tier:** consumer screens show only forecasts whose engine clears a skill gate on the CI lower bound.
- **F-20 Auto-demotion:** an engine with negative BSS (CI upper bound < 0) over the trailing N resolutions drops to its floor weight and raises an alert.
