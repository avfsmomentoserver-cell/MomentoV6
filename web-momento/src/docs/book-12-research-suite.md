# 12 · Research & Investigation Suite

Momento's R&D engine decides which ideas get promoted into production engines. The repos already contain one of the most carefully built pieces of the platform: the **edge-falsification suite** on `momento-core@research/edge-falsification-suite`. This chapter:
- documents that suite's gates, its planted-signal power tests and its verdict rules;
- documents the InvestigationSuite ML pipeline and its decomputation branch, with one validation leak found in `train.py`;
- specifies the Experiment Registry that makes every idea, including every feature in Ch 18, pass through the same gates.

## 12.1 The edge-falsification suite
Location: `momento-core@research/edge-falsification-suite:backend/research/` (8 commits, from `2e59964` "Add distribution conformance and independence testing" to `5ea39cb` "Tune CI for the free tier"). The branch adds about 3,400 lines:

| Module | Lines | Functions |
|---|---|---|
| `stats.py` | 341 | Standard-library implementations: `gamma_q`, `chi_square_sf`, `normal_sf`, `ks_uniform` (Kolmogorov sf), `wilson_interval`, `autocorrelation` with `bartlett_bound`, `runs_test`, `bootstrap_ci`, `permutation_test` |
| `distribution.py` | 297 | `pareto_survival`, `estimate_house_edge`, `survival_table`, `band_goodness_of_fit`, `probability_integral_transform`, `tail_conformance` (Hill), `cashout_expected_values` |
| `independence.py` | 408 | `conditional_band_test`, `signal_lift`, `serial_structure` (max lag 20), `gap_independence`, `test_pressure_release` |
| `loader.py` | 291 | Validates exports against the semantic layer. `Points = 100 + 30·log₂ m` is checked on every row. `TruncatedExportError` if a tape looks filtered |
| `report.py` | 285 | `run_report` with verdicts `conforming_no_edge` / `anomaly_detected` / `inconclusive`, `format_text` |
| `strategies.py` | 600 | Strategy registry: `compute` (live metric) and `backtest` (evidence) on the same class, so they cannot drift |
| `tests/test_research_*.py` | 752 | Stats core, loader, distribution, independence |
| `api/routes/research.py` | 208 | `/research/tape`, `/research/report`, `/research/cashout-profile`, `/research/independence` |

### 12.1.1 The theory the suite tests
The README states it plainly. A provably fair crash curve draws P(X ≥ x) = p/x for x ≥ 1, with p = 1 − house_edge. Three consequences are each tested separately:
1. **1/X is uniform**: KS on the PIT (`probability_integral_transform`).
2. **The tail index is 1**: Hill estimator (`tail_conformance`).
3. **The expected value is p at every cash-out target**: `cashout_expected_values`, because x·P(X ≥ x) = p.

### 12.1.2 Five concrete "pressure" signals
`test_pressure_release` turns "pressure is building" into five testable signals:

| Signal | Reading |
|---|---|
| `drought_no_10x_in_lookback` | No 10× in 40 rounds |
| `variance_compression_shelf` | Recent range collapsed to a shelf |
| `repeated_ceiling_rejection` | Three or more rejections just under 10× |
| `ascending_floor_accumulation` | Rising median with no release |
| `cold_streak_ten_sub_2x` | Ten consecutive sub-2× rounds |

### 12.1.3 The gates in `signal_lift`
At decision index i, the signal sees `multipliers[i−lookback : i]` and the outcome is `max(multipliers[i : i+horizon]) ≥ threshold`. The windows abut but never overlap, so a signal cannot see its own outcome. A signal is **actionable** only if both conditions hold:
- the Wilson intervals of the *fired* and *idle* arms are **disjoint**;
- a **permutation test** of the flag-to-outcome pairing gives p < 0.01. It uses 2,000 shuffles (400 in CI; the smallest reportable p is 1/(iterations + 1)).

It also reports the next-round band test for the fired arm. `run_report` returns `anomaly_detected` only when deviations appear on **multiple axes**, because across this many tests a single low p-value is expected under the null.

### 12.1.4 Power, not just size
The suite also tests itself against false negatives:
- `conftest.py::synthetic_dependent_tape` plants a real rule: after 15 rounds without a 10×, the next round is forced high. `TestDetectionPower` asserts the suite finds it.
- `TestCausality::test_future_peeking_signal_is_flagged` gives a signal the answer and asserts that it is flagged.
- `synthetic_fair_tape` inverts the fair CDF, and the suite must certify it as fair.

One refinement is worth adding. Decision points are consecutive, so neighbouring flags share 39 of 40 lookback rounds and neighbouring outcomes share horizon rounds. Both series are autocorrelated even under the null. An i.i.d. shuffle of the pairing destroys that autocorrelation, which makes the permutation null narrower than the true null. Add a **circular-shift permutation**: rotate the flag vector by a random offset ≥ lookback + horizon. This preserves both autocorrelations and breaks only the alignment. Report both p-values and gate on the larger.

This size-and-power pattern is what every Momento engine test should look like. Ch 05–10 reuse it: null calibration plus planted signal.

### 12.1.5 The honesty rules
The statistical-honesty skill on `@research/csv-suite` has 9 rules, including:
- a **Δt leakage firewall**: features may use only data strictly before the target round;
- derived columns defined once;
- **Benjamini–Hochberg** across tested hypotheses;
- a mandatory **shuffle baseline**;
- permutation tests.

## 12.2 Research modules and recorded results
### 12.2.1 Modules (`momento-core@main:backend/research/`)
`investigation_suite.py`, `run_investigation.py`, `demo_investigation.py`, `strategies.py`, `dynamic_strategies.py` and `profit_capping.py`, with tests.

### 12.2.2 Recorded results
These results are recorded in the repos. Full list in Appendix D.

| Study | Result | Where |
|---|---|---|
| DNA similarity matching | 49.32% vs 84.12% base rate | `momento-core MOMENTO_V6_SPECIFICATION.md §1.2`, `MomentoFX DNA_IMPLEMENTATION_PLAN.md` |
| Time-based patterns | skill −0.0044, precision/recall 0 | same |
| Pressure ≥ 70% | +3.53% edge, not significant | same |
| Mega plan (9 strategies) | none beat baseline at 10×/5 | `MomentoFX research/comprehensive_mega_plan_results.md` |
| Profit capping + dynamic confidence | 17.6% ROI, 74.7% cap utilisation (backtest) | `MomentoFX research/PROFIT_CAPPING_REPORT.md` |
| Band transitions χ² | 837.6 on 25 dof (177,905 rounds) | `MomentoV5 calibration-report.md` |

The χ² result is large. Ch 06 (N1, N2) explains why it needs the stratified re-test, which respects session and source boundaries, before being read as dependence.

## 12.3 InvestigationSuite: the ML pipeline
### 12.3.1 Pipeline
`sessionize → etl → features → train → serve`:
- `sessionize.py`: new round when the gap exceeds `gap_minutes = 30`. It is equivalent to a SQL window function with ORDER BY.
- `features.py`:
  - `gap_since_prev_seconds` (−1 sentinel for the first round);
  - `rolling_mean_gap`, an expanding mean with the sentinel clipped to NaN inside the transform;
  - expanding coefficient of variation;
  - `latest_gap_hours`, `max_gap_seen_hours`;
  - a `_risk_score` that compares the latest gap with the historical mean **excluding** the latest (correct).
- `train.py`: LightGBM regression (MAE), `TimeSeriesSplit(n_splits = min(5, max(2, n//2)))`, early stopping 50, up to 1,000 boosting rounds. It saves the last fold's model.
- `serve.py`, `api/sdk/python/forecast_sdk.py`, `src/agents/{agent_manager, data_ingest, monitor, retrain}.py`, Terraform/cloud-init and Docker.
- **4-layer dedup** with tests (`test_dedup_pipeline`), reused in Ch 03.

### 12.3.2 Finding R1: early stopping on the test fold
In each fold, `lgb.train(..., valid_sets=[dval], callbacks=[early_stopping(50)])` uses **the test fold** as the early-stopping set. The number of boosting rounds is chosen on the data the fold is scored on, so `cv_mae_mean` is optimistic. Fix: split each training fold into train and validation portions (the last 15% of the training indices), early-stop on validation, and score on test.

```python
for tr, te in TimeSeriesSplit(n_splits=k).split(X):
    cut = int(len(tr) * 0.85); tr_fit, tr_val = tr[:cut], tr[cut:]
    m = lgb.train(params, lgb.Dataset(X.iloc[tr_fit], y.iloc[tr_fit]),
                  valid_sets=[lgb.Dataset(X.iloc[tr_val], y.iloc[tr_val])],
                  callbacks=[lgb.early_stopping(50), lgb.log_evaluation(0)], num_boost_round=1000)
    scores.append(mean_absolute_error(y.iloc[te], m.predict(X.iloc[te], num_iteration=m.best_iteration)))
```
Two smaller issues:
- The saved model is the **last fold's** model, which is trained on less data than a final refit on all data with the median best iteration.
- `n_splits = min(5, max(2, n//2))` allows two folds on 4 samples. Require a minimum per fold, for example ≥ 50 test rows, or return `inconclusive`.

### 12.3.3 Decomputation (`InvestigationSuite@decomputation`, commit `d132acc`, 73 tests)
Predictions are expanded into **8 human-readable dimensions**, each with a plain-English label in `metadata.prediction_labels`:

| Key | Label |
|---|---|
| `event_count_predicted` | Things That Will Happen Next |
| `gap_hours_until_next` | When They Come Back Next |
| `trend_direction` | Busier or Quieter? |
| `session_consistency` | Do Bursts Vary? |
| `top_event_type` | Most Likely Activity Type |
| `growth_ratio` | Are Sessions Growing? |
| `stay_home_risk` | Chance They Stop Coming |
| `confidence_range` | How Sure Are We? |

The branch also contains:
- `docs/newbie-glossary.md` (491 lines, "no math required");
- `REPRODUCIBLE_STRUCTURE.md`;
- the round-eye-view example;
- tests `test_new_dimensions` and `test_dynamic_decomp_stress`.

The top commit is `f2b229c` "Delete .venv directory". The branch still carries `data/avfs.db.*` backups and a Drive zip; see the Ch 17 hygiene list.

## 12.4 Reference design: the Experiment Registry
Every idea goes through one pipeline and gets one record.

```
hypothesis (MKI object) ──▶ experiment spec (YAML) ──▶ runner (causal, Δt firewall)
     ──▶ metrics vs baseline + shuffle baseline ──▶ p-value ──▶ BH q-value across the batch
     ──▶ power check on a planted version ──▶ verdict: promote | lab | reject
     ──▶ MKI lifecycle update + engine registry
```

### 12.4.1 Spec format
```yaml
id: EXP-2026-041
hypothesis: anchor-released(large) raises P(>=5x in next 10)
producer: momentum.anchors@1.3.0
data: {sources: [all], sessions: integrity>=0.95, split: walk_forward(blocks=10), as_of: 2026-09-26}
signal: {lookback: 40}
target: {kind: window_hit, threshold: 5, horizon_rounds: 10}
baseline: [base_rate, shuffle(400)]
metric: log_score_skill
gates: {wilson_disjoint: true, permutation_p: 0.01, bh_q: 0.05, holdout_blocks: 2}
power: {planted_effect: +3pp, min_power: 0.8}
alpha: 0.05
```

### 12.4.2 Runner
The runner wraps `signal_lift` (for binary signals) and a log-score comparison (for probabilistic engines). Both use the Δt firewall, and the same code runs in CI and on the Worker's research endpoint. It always runs the **planted** version too: it injects the stated effect size into a copy of the tape and checks that the gates detect it. An experiment whose planted version is not detected is reported as **underpowered**, not as "no effect".

```python
def run(spec, tape):
    real = evaluate(spec, tape)                           # lift, CI, permutation p, skill
    planted = evaluate(spec, plant(tape, spec.power.planted_effect, seed=spec.seed))
    power_ok = planted["actionable"]
    return {"real": real, "power_ok": power_ok,
            "verdict": ("promote" if real["actionable"] and real["holdout_ok"] else
                        "reject" if power_ok else "underpowered")}
```

### 12.4.3 Multiple testing
Control the FDR over every experiment in a batch with BH: sort the p-values and reject all p₍ᵢ₎ ≤ (i/m)·q ([FDR, Wikipedia](https://en.wikipedia.org/wiki/False_discovery_rate); [Genovese tutorial](https://www.stat.cmu.edu/~genovese/talks/hannover1-04.pdf)). The "batch" is **every experiment ever run on the same target family**, not just today's, so repeated attempts at the same idea are penalised.

### 12.4.4 Reproducibility
Store these in `experiments`:
- the data snapshot hash (event-log head, Ch 04);
- the `as_of`;
- the code commit;
- the seed;
- the planted seed;
- the full spec.

Anyone can rerun an experiment by id, and the result must match to the last digit.

```sql
CREATE TABLE experiments (
  id TEXT PRIMARY KEY, spec_yaml TEXT NOT NULL, code_commit TEXT NOT NULL, data_head TEXT NOT NULL,
  as_of_ms INTEGER NOT NULL, seed INTEGER NOT NULL, status TEXT NOT NULL,       -- queued|running|done|error
  result_json TEXT, p_value REAL, q_value REAL, power_ok INTEGER, verdict TEXT,
  created_by TEXT, created_ms INTEGER NOT NULL, finished_ms INTEGER);
```

### 12.4.5 Promotion
An experiment with q < 0.05, power confirmed, and skill that holds on the next unseen block gets its engine registered at the prior weight in **shadow mode** (Ch 07 §7.6, 500 rounds). From then on the live ledger takes over. The experiment record links to the engine's live skill, so "promotion precision" can be measured.

## 12.5 Decomputation for Momento forecasts
Port the 8-dimension idea to crash-round forecasts. Every headline forecast carries readable dimensions, stored in `forecast_explanations`:

| Dimension | Momento meaning | Source engine |
|---|---|---|
| Next value | Expected (median) and range | mixture |
| Next big one | Conditional ETA for 10× | survival (Ch 10) |
| Hotter or cooler? | Range-momentum test result | momentum (Ch 09 §9.4.3) |
| Steady or wild? | Volatility regime | fx.ts |
| Most likely band | Argmax band and its probability | mixture |
| Building or fading? | Anchor forming/released, with measured lift | momentum.ts |
| Session risk | Guard state | Ch 11 |
| How sure are we? | Coverage-calibrated range and earned confidence | Ch 08 |

Each dimension has a label, a value, the engine that produced it, and **that engine's measured skill** for the dimension's target. The explanation is therefore honest about which dimensions carry information.

## 12.6 Tests
| Test | Assertion |
|---|---|
| `firewall` | Any feature reading index ≥ i at decision i fails the runner |
| `fair_tape_certified` | `run_report` on `synthetic_fair_tape` returns `conforming_no_edge` in ≥ 95% of seeds |
| `planted_detected` | `synthetic_dependent_tape` is detected in ≥ 80% of seeds |
| `bh_family` | Adding 20 null experiments to a family does not create any q < 0.05 in 95% of runs |
| `rerun_identical` | Rerunning an experiment id reproduces result_json byte-for-byte |
| `cv_no_test_early_stop` | `train.py` never passes the test fold to `valid_sets` (R1) |

## 12.7 Measurement
- **Promotion precision:** the share of promoted engines that keep positive skill (CI lower bound > 0) 30 days after promotion. Aim for ≥ 80%.
- **Power coverage:** the share of experiments with `power_ok`.
- **Median time from hypothesis to verdict.**

## 12.8 Features this chapter unlocks
- **F-34 Experiment Registry UI:** submit a hypothesis in plain English. It is translated into a spec and run, and the verdict, q-value, power and charts come back.
- **F-35 Explain-this-forecast panel:** the decomputation dimensions, plus each engine's contribution (weight × shift from baseline) and measured skill.
