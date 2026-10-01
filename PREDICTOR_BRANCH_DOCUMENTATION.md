# MomentoV6 Predictor Branch

## Overview

The `predictor` branch makes the full-intelligence forecast the single source of
truth for every prediction surface (Command Center, ETA board, cone, scheduled
multi-window predictions, Ask Momento) and calibrates it **out of sample**.

Version 2 of the branch replaces the first implementation's stack of hand-tuned
multipliers (ETA nudge, cone-spread nudge, confidence range scaling, agreement
shift, tail bias, candidate shift, collapse bias, ceiling bands, spread bands,
crash bias, mode blending, high-crash quantile switch). Those adjustments were
applied one after another to the point estimate and range *after* the
distribution was computed, so the published "p25–p75" range and "expected"
value no longer corresponded to any probability, and none of them were
validated. The walk-forward backtest below shows the effect: the v1 range held
~89% of rounds instead of 50%, and "expected" sat near the 70th percentile.

## Design principles

1. **One distribution, every number.** Expected (median), range (p25–p75),
   moonshot reach (p90), band, horizon probabilities, and scheduled window
   probabilities are all read from the same calibrated distribution, so they
   can never contradict each other. `band` is always the band of `expected`.
2. **Adjustments must be earned.** A recalibration layer only switches on after
   it beats the raw mixture on held-out rounds; otherwise the raw mixture is
   published unchanged.
3. **No leakage.** The recalibrator is fitted only on forecasts that resolved
   before the round being forecast, and the ledger stores the *raw* mixture so
   the layer is never fitted on its own output.
4. **Fail soft.** ETA board, cone and Ask Momento still answer if the forecast
   cannot be built; corrupt ledger rows are skipped; the fit falls back to
   identity on any error.

## Out-of-sample recalibration (`functions/calibration.ts`)

### Layer 1 — distribution (band level)

```
p'_i ∝ (p_i · r_i^γ)^τ
r_i = (observed_i + κ) / (expected_i + κ)     κ = 20, clamped to [0.25, 4]
γ ∈ {0, .25, .5, .75, 1}   τ ∈ {.6, .7, .8, .9, 1, 1.1, 1.25}
```

`r_i` is the shrunk per-band reliability ratio (fixes systematic bias such as an
under-forecast crash rate or an over-weighted 10–100x band); `τ` is a
temperature (fixes over/under-confidence).

**Validation:** rolling-origin (forward-chaining) cross-validation with five
folds (train on the first 50/60/70/80/90% of the window, score on the next
10%). The whole fitting procedure is re-run inside each fold. The layer
activates only when the mean held-out log-loss gain exceeds one standard error
of the paired difference. Parameters are then refitted on the whole window.

Measured on 40 seeds × 1000 rounds: activates on **40/40** miscalibrated ledgers
and on **1/40** well-calibrated ledgers (false-positive rate ≈ 2.5%).

### Layer 2 — quantile levels (PIT recalibration)

For each published level `q ∈ {0.25, 0.5, 0.75, 0.9}` the forecast reads
`F⁻¹(q')` with `q' = G⁻¹(q)`, where `G` is the empirical CDF of the PIT values
`u = F(actual)` (Kuleshov et al., 2018). The level map is shrunk toward identity
by `n / (n + 100)`, forced to be monotone, and accepted only when it reduces the
held-out quantile calibration error on the same folds.

### Continuous CDF

Within each band the CDF follows the crash-game law `S(x) ∝ 1/x` (Pareto α = 1):
`F(x | band) = (1/lo − 1/x) / (1/lo − 1/hi)`; the open top band uses
`1 − lo/x`. This is the same interpolation as `v65.quantileFromDist`, so PIT
values and quantiles agree. `survivalAt(dist, t)` gives `P(X ≥ t)` for **any**
threshold (scheduled predictions are no longer limited to 2/5/10/20/50/100).

### Legacy median rectification

The existing median log-bias correction (`intelCorrection`) is applied only
while neither recalibration layer is active; otherwise the median would be
corrected twice. When applied, it now shifts the whole central block so the
range still brackets the point estimate.

## Backend integration (`functions/core.ts`)

| Piece | Behaviour |
|---|---|
| `intelRecalibrator()` | Fits from the last `intel_recalibration_window` (default 1000, range 100–3000) resolved `intel_calibrations` rows. Refits every 10 new rows. Disable with setting `intel_recalibration = 0`. |
| `intelForecast()` | Memoised on (source, tape head, ledger stamp, registry, as_of, recal setting); max 8 entries; cleared by `invalidateCaches()`. Repeat calls went from ~130 ms to ~4 ms in the smoke test. |
| `calibrateIntel()` | Passes the walk-forward recalibrator; stores the **raw** mixture in `dist`, raw loss in `mix_loss`, published-distribution loss in new column `cal_loss` (idempotent `ALTER TABLE` migration). |
| `intelLedger()` | Mixture skill (confidence gate) uses `COALESCE(cal_loss, mix_loss)`, i.e. the loss of what is actually published. |
| `accuracyTick()` | Schedules the v6 `pipeline` (champion) **and** `full-intelligence` (challenger) per (model, window, threshold). Stored component probabilities are now window probabilities, so the baseline Brier compares like with like (it previously compared a per-round baseline to a window outcome). Nothing is scheduled with < 50 rounds of history. The rolling chart tracks the champion only. |
| `/api/v1/accuracy/overview` | New `byModel` block: n, Brier, baseline Brier, log-loss, hit rate and Brier skill % for pipeline vs full-intelligence. |
| `/api/v1/research/recalibration` | Recalibrator diagnostics plus a reliability table (predicted raw / calibrated vs observed frequency per band). Replaces the stub `candidate-bias-test` endpoint, which returned hard-coded "recommended" constants. |

## Routes (`functions/v65routes.ts`)

- **ETA board / cone**: attach a compact `intelligence` summary (state,
  confidence, expected, range, reach, band, P(≥2x), calibrated flag) instead of
  copying the full ~100 KB forecast onto the board and every ETA row.
  `etaBoard()` in `v65.ts` is back to its original signature. The ETA board no
  longer fails if the forecast fails.
- **Ask Momento** (`POST /api/v1/knowledge/ask`): answers are grounded again.
  Documentation claims must cite a passage id, live numbers must cite `[data]`,
  methodology answers from general knowledge must be prefixed `General:`.
  Anything else, or `NO_ANSWER`, is refused. The response carries
  `grounding: docs | data | general | none`. The extractive (no-key) fallback
  prints a readable live line instead of a raw JSON dump. HTTP errors from the
  provider are reported instead of being parsed as answers.

## Forecast payload

`FullIntelligenceForecast` gains:

- `rawDistribution: number[]` — the un-recalibrated mixture.
- `distribution` — now the **calibrated** distribution (identical to the raw
  mixture until recalibration is earned).
- `intelligence.calibration` — `distributionActive`, `quantileActive`, `gamma`,
  `tau`, the quantile `levels` actually used, held-out sample size, log-loss
  raw vs calibrated, improvement %, held-out p25–p75 coverage raw vs calibrated,
  `crash` (P(<2x) raw / calibrated / observed over the last 500 rounds),
  `legacyCorrection`, `modeBand`, and a plain-English `reason`.

The v1 fields (`rangeScale`, `agreementShift`, `tailBias`, `bandContext`,
`candidateBias`, `collapseBias`, `ceilingAdjustment`, `candidateSpread`,
`weightedCandidateExpected`, `empiricalCrashRate`, `baselineCrashRate`,
`crashTrend`, `crashBias`, `modeWeight`, `hardCrashRate`, `softCrashRate`) and
the `etaMedian` / `coneSpread` options are removed.

## Frontend (`web-momento`)

- Command Center: the eleven v1 tuning badges are replaced by three honest
  chips: calibration state (with held-out log-loss gain, or `calibrating n/60`
  / `raw mixture (recal not earned)`), P(<2x) forecast vs observed, and held-out
  p25–p75 hit rate. The range line shows the mode band. ETA 10× and cone
  coverage tiles are kept.
- Ask Momento: subtitle and verdict reflect the grounding (`n citation(s)`,
  `live data`, `general knowledge — verify`, `refused`).
- ETA board: reads the compact intelligence summary.
- `IntelCalibrationInfo` type added; v1 fields removed from `IntelligenceBlock`.

## Local development

`functions/local-dev.mjs` now actually loads `functions/.env` (the v1 docs said
it did, but it never did) using a dependency-free parser; real environment
variables take precedence. The unused `dotenv` dependency was removed.

## Verification

```bash
cd functions
npm test                                   # node:test suite (8 tests)
npm run predictor:backtest -- --scenario iid
npm run predictor:backtest -- --scenario drift --seed 11
```

- **Unit / property tests** (`test/predictor.test.mjs`): CDF↔quantile inverse
  and monotone; garbage input sanitised; identity below the minimum sample;
  well-calibrated ledgers left within TV 0.04; a miscalibrated mixture
  corrected on unseen rounds (lower log-loss, P(<2x) moves toward truth);
  quantile layer restores p25–p75 coverage to 50 ± 6%; forecast invariants
  (finite, `1 ≤ lo ≤ expected ≤ hi ≤ reach`, distribution sums to 1,
  band = band(expected), P(≥t) non-increasing) with and without a recalibrator;
  0/1/5/30-round and constant tapes do not crash.
- **Type check**: no new TypeScript errors vs `main` (backend); frontend clean.
- **Workers bundle**: `wrangler deploy --dry-run` builds (520 KiB).
- **End-to-end smoke test** (local server, 2400 synthetic rounds): ingest,
  recalibrate, forecast, next-round, ETA board, cone, recalibration research,
  accuracy tick (both models scheduled), overview and Ask all return 200.

### Walk-forward backtest

Synthetic provably-fair crash tape (seeded), 1500 warm-up rounds, 800 scored
rounds, every forecast built only from earlier rounds, recalibrator refitted
every 10 rounds on resolved forecasts only. Cells are `iid (3% edge) / drift
(edge 1–9% sinusoidal)`.

| Method | p25–p75 coverage (target 0.50) | share ≤ expected (target 0.50) | pinball loss ↓ | band log-loss ↓ | P(<2x) gap ↓ |
|---|---|---|---|---|---|
| main (raw mixture) | 0.536 / 0.568 | 0.496 / 0.512 | 3.5701 / 2.8320 | 1.5456 / 1.5107 | 0.0037 / 0.0130 |
| predictor v1 (multiplier stack) | 0.886 / 0.904 | 0.675 / 0.730 | 3.7249 / 3.0327 | 1.5456 / 1.5107 | 0.0037 / 0.0130 |
| predictor v2 (this rewrite) | 0.530 / 0.542 | 0.497 / 0.502 | 3.5668 / 2.8137 | 1.5468 / 1.5015 | 0.0022 / 0.0005 |

Reading: on the i.i.d. tape the raw mixture is already calibrated and v2
correctly leaves it alone. On the drifting tape v2 activates (γ 1, τ 1.1) and
improves log-loss, pinball loss, coverage and the crash-rate gap (1.3% → 0.05%).
v1 does not change the distribution (same log-loss as main) but its range and
point estimate are badly miscalibrated, so its pinball loss is the worst of the
three in both scenarios.

## Operator settings

| Setting | Default | Meaning |
|---|---|---|
| `intel_recalibration` | `1` | `0` disables both recalibration layers |
| `intel_recalibration_window` | `1000` | resolved forecasts used for the fit (100–3000) |
| `intel_backtest_rounds` | `150` | rounds scored on first boot (more = recalibration earns sooner, slower boot) |

## Configuration (unchanged)

- `ENTRIM_API_KEY` in `functions/.env` (git-ignored) or the environment;
  settings `entrim_api_key`, `entrim_base_url` (default
  `https://api.entrim.ai/v1`), `entrim_model` (default
  `deepseek-ai/DeepSeek-V4-Flash`).
- Systemd units `momento-backend.service` (port 8000), `momento-console.service`
  (port 8080), `momento-feed.service`.

## Limitations

- Recalibration needs evidence: with the default boot backtest (150 rounds) it
  stays in `calibrating` / `raw mixture` until the live ledger has a few hundred
  resolved rounds. Raise `intel_backtest_rounds` for a faster start.
- Rounds of a provably-fair crash game are close to independent draws. No
  calibration layer can create predictive edge; it makes the stated
  probabilities honest. Forecasts are not betting advice.

## Robust branch: locked-holdout evidence gate

`functions/robust-evaluation.ts` answers one question the recalibrator does not:
does the published forecast beat plain historical band frequencies on rounds it
has never seen?

- The resolved `intel_calibrations` ledger (raw distributions, oldest first) is
  split once: the oldest 80% train, the newest 20% is a locked holdout.
- The recalibrator and an unconditional baseline (Laplace-smoothed training band
  frequencies) are fitted on the training segment only.
- Raw, published and baseline distributions are scored on the same holdout
  rounds: band log loss, Brier per public threshold (2×–100×), p25–p75 coverage.
- `demonstrated-skill` requires the published log-loss gain over the baseline to
  exceed one standard error of the paired per-round gain **and** positive mean
  threshold Brier skill. Otherwise the status is `no-demonstrated-skill` or
  `insufficient-data` (fewer than 100 training / 50 holdout rounds).

Live integration (`core.ts`):

- Every full-intelligence forecast carries an `evidence` block (version, status,
  reason, data cutoff, sample counts, losses, threshold reliability).
- Unless skill is demonstrated, `confidenceLabel` is capped at `LOW`; the
  model's own label is kept in `evidence.confidenceLabelUngated`. Forecast
  numbers are never changed by the gate. Setting `evidence_gate = 0` disables
  the cap.
- `GET /api/v1/research/evidence` returns the summary plus full detail;
  `GET /api/v1/research/recalibration` also includes the summary.
- The Full Intelligence dashboard shows a "Locked-holdout evidence" panel.
- Evaluation failure falls back to an `insufficient-data` block and never breaks
  the forecast. Evidence is refreshed on the recalibrator cadence (every 10
  ledger rows).

Backtest (`npm run predictor:backtest`) now prints a `lockedHoldout` block. On
the synthetic i.i.d. tape it reports `no-demonstrated-skill`, as it should.

## Robust branch: loose headline range

The headline range is now a **loose** central interval by default:

| Profile (`range_profile` setting) | rangeLo – rangeHi | reach | built to hold |
|---|---|---|---|
| `tight` (old behaviour) | p25 – p75 | p90 | 50% of rounds |
| `loose` (default) | p15 – p85 | p95 | 70% of rounds |
| `wide` | p10 – p90 | p95 | 80% of rounds |

- `expectedMultiplier` stays the median (p50) under every profile.
- Every forecast also publishes exact `quantiles` (p05, p10, p15, p25, p50, p75,
  p85, p90, p95) from the same calibrated distribution, forced monotone, plus a
  `rangeProfile` block (name, levels, nominal coverage, label such as "p15–p85").
- The quantile (PIT) recalibration layer now fits and validates all nine
  levels, so every profile is out-of-sample calibrated, not only p25/p75/p90.
- Locked-holdout evidence reports `rangeCoverage` against the profile's
  `rangeNominal` (and still `coverage50` for p25–p75).
- `GET /api/v1/accuracy/coverage` uses the profile's nominal share as its
  default ACI target (`?target=` overrides). Ledger rows written before this
  change carry p25–p75 ranges; `POST /api/v1/intelligence/recalibrate`
  rebuilds the ledger with the current profile.
- A wider range lands more rounds, so the ledger hit rate (and the raw
  confidence score that uses it) rises. That is not added skill; the evidence
  gate still caps the label at LOW unless the locked holdout shows skill.
- Backtest: `npm run predictor:backtest -- --profile tight|loose|wide`
  (`covRange` = share inside the headline range).

## Robust branch: earned point estimate and range method

`functions/point-range.ts` chooses how `expectedMultiplier` and the headline
range are read off the calibrated distribution, on resolved ledger rows only.

Point estimate candidates (default `point_method = auto`):

| Method | Definition | Best for |
|---|---|---|
| `median` | Q(0.5) | absolute log error; moves only when the middle moves |
| `geomean` | exp E[log X] (top 0.5% cut) | squared log error; uses the whole shape |
| `trimmed` | exp mean log Q(u), u in [0.1, 0.9] | robust middle ground |

Range candidates (default `range_method = auto`): equal-tailed `central`, or
`shortest` (narrowest log-space window with the same coverage), compared by
the interval (Winkler) score at the profile's nominal coverage.

Adaptive coverage (`range_adaptive = 1`, ACI): the level is nudged by recent
misses (bounded to nominal ± 15 points). It is kept only if it brings
realised coverage closer to nominal at no more than one SE of interval-score
cost.

Rule for every choice: an alternative replaces the default (median, central,
fixed level) only if it beats it by more than one standard error of the paired
per-round difference over the last 600 resolved rounds. Below 100 resolved
rounds the defaults are kept. Refreshed every 10 ledger rows.

- The forecast carries `pointRange` (method, interval, coverage, sample, the
  median for reference, reason); `quantiles.p50` is always the median.
- `GET /api/v1/research/point-range` lists every candidate's held-out score.
- `band` is the band of the published expected value, so it can differ from
  the band of the median.

Backtest (`--point`, `--range`, `--adaptive` flags; 500 scored rounds, loose):

| Scenario | Method | sq. log error | abs. log error | interval score | expected SD (log) |
|---|---|---|---|---|---|
| iid | median (before) | 1.190 | 0.738 | 3.000 | 0.028 |
| iid | earned (geomean) | 1.087 | 0.786 | 2.993 | 0.177 |
| drift | median (before) | 1.018 | 0.680 | 2.825 | 0.035 |
| drift | earned (geomean) | 0.955 | 0.716 | 2.831 | 0.106 |

The geometric mean is closer on average in ratio terms and much more
responsive, at the cost of absolute log error, and it sits above the median
(about 61% of rounds land below it). On the i.i.d. tape the extra movement
follows noise in the mixture, not information about the next round; the
locked-holdout evidence still reports no demonstrated skill.

## Forecast tuning settings, Chart Lab precision test and blend gate

### Tuning settings (Master Settings → Forecast tuning)

All values live in the `settings` table, are clamped server-side, and are shown with their effective value (`GET /api/v1/research/forecast-tuning`).

| Key | Default | Range | Effect |
|---|---|---|---|
| `point_method` | auto | auto/median/geomean/trimmed | Expected value; auto = earned on resolved rounds |
| `range_method` | auto | auto/central/shortest | Range construction |
| `range_profile` | loose | tight/loose/wide | p25–p75 / p15–p85 / p10–p90 |
| `range_adaptive` | 1 | 0/1 | Allow adaptive coverage (ACI) when earned |
| `point_range_window` | 600 | 100–3000 | Resolved rounds the methods are compared on |
| `point_range_min_sample` | 100 | 30–2000 | Below this the median / equal-tailed range are kept |
| `point_range_se` | 1 | 0–5 | SE margin an alternative must beat the default by |
| `aci_gamma` | 0.01 | 0.001–0.1 | ACI step size |
| `aci_max_shift` | 0.15 | 0–0.3 | Max coverage shift from nominal |
| `blend_gate` | candidates | candidates/all/off | Which engines must earn a place in the blend |
| `blend_gate_se` | 2 | 0–5 | Required log-loss gain in SE |
| `blend_gate_window` | 600 | 100–3000 | Ledger rows used by the gate |
| `blend_gate_min_sample` | 100 | 30–2000 | No admission before this many scored rounds |
| `chartlab_engine` | 1 | 0/1 | Score Chart Lab as a candidate engine |
| `chartlab_window`, `chartlab_k` | 30, 40 | 8–120, 5–400 | Chart Lab analogue window / count |

### Chart Lab precision (`functions/analogue.ts`, `GET /api/v1/research/chartlab-precision`)

Chart Lab's own backtest compares its median path with a flat path. That is not like-for-like: on skewed rounds the median of a cumulative sum drifts below the flat path, so a median path can win without any information. The precision test therefore adds a fair baseline (the same median over K random past windows) and a next-round log-loss test against base band frequencies, each with a paired SE. Verdict `more-precise` requires both gains > 1 SE.

Synthetic results (120 walk-forward anchors, W 30, H 20, K 40), from `node test/chartlab-precision.mjs`:

| Tape | Skill vs flat | Skill vs random windows | Next-round gain (log loss) | Verdict |
|---|---|---|---|---|
| iid | −6.5% | −3.2% | −0.036 ± 0.026 | not more precise |
| drift | −3.8% | −3.6% | −0.028 ± 0.022 | not more precise |
| planted pattern | −1.1% | −2.2% | −0.001 ± 0.026 | not more precise |

On these tapes Chart Lab was not more precise. On real data the same test runs from the Chart Lab page.

### Blend gate (`functions/engine-gate.ts`, `GET /api/v1/research/blend-gate`)

The ledger keeps each engine's −log p at the band that landed plus the weights used. Because the blend is a linear pool, the blend's probability with and without any engine is recomputed exactly per row. An engine is admitted only if the mean gain exceeds `blend_gate_se` SE over the window. Engines that are not admitted are set to shadow: still scored every round, so they can earn their way in, but weight 0. Operator shadow/demote/retire always wins, and the baseline is always kept.

- **Default `candidates`:** only new engines (Chart Lab, custom registry engines) are gated. Built-in engines keep their earned weights.
- **`all`:** re-tests every engine. In the iid backtest this was worse (log loss 1.5794 vs 1.5758). Testing 8 engines at 1 SE admitted some by chance, and dropping the rest lost diversification. So it is not the default.

Walk-forward backtest (`node test/predictor-backtest.mjs --scored 400`, candidates mode, 2 SE):

| Scenario | Chart Lab gain / SE | Gate | Log loss: dynamic / Chart Lab always on / gated |
|---|---|---|---|
| iid | +0.0012 ± 0.0049 | excluded | 1.5758 / 1.5755 / 1.5758 |
| drift | +0.0075 ± 0.0040 | excluded (1.8 SE) | 1.5284 / 1.5277 / 1.5284 |

The forecast payload carries `blendGate {mode, admitted, excluded, reason}`.

Also fixed: `intelLedger` averaged each engine's loss over all rows, including rows where that engine was not scored. That understated losses for newly added engines and inflated their weights. It now averages per engine.
