# 07 · Forecast Engines & Full Intelligence

This is the heart of Momento. The primary sources are:
- `MomentoV5@v6.3-full-intelligence:functions/intelligence.ts` (1,086 lines, 50 KB);
- `functions/pipeline.ts` (650 lines);
- `docs/markdown/full-intelligence.md`.

The V5 origin is `MomentoV5@v6:backend/momento/forecast.py`. This chapter covers the output contract, the eight engines and the state machine, then walks through the code of the earned mixture, confidence and scoring line by line. It records six findings and gives a reference implementation of the upgraded mixture (AdaHedge with fixed share and sleeping experts), window forecasts as intervals, and an engine plugin contract.

## 7.1 Output contract
`fullIntelligenceForecast(rounds, source, opts)` returns:
- a **distribution over 6 bands** (`<1.5 · 1.5–2 · 2–5 · 5–10 · 10–100 · 100+`);
- **Expected**: the mixture median, interpolated inside the band from empirical in-band quantiles, times the rectification factor;
- **Range**: p25 to p75, partially rectified;
- **Reach**: p90;
- the **state** (one of 7) with state scores;
- **Outlook h+5**: P(hit within 5 rounds) for 2/5/10/20/50/100×, with median and p90 ETAs;
- **confidence** (LOW/MEDIUM/HIGH) and its breakdown;
- per-engine distributions, weights and log-loss (for transparency);
- the 14 signal readings.

The module header states the design intent: "An engine with no demonstrated skill decays toward the floor; the measured baseline is always kept in the mix, so the forecast is honest when the tape carries no signal." It is a pure module: rounds in, forecast out, no I/O.

## 7.2 The eight engines
| Key | Prior | Engine | How it forms its distribution |
|---|---|---|---|
| `baseline` | 1.0 | Measured band shares, full history | Reference anchor |
| `percentile` | 0.8 | Last 500 rounds, Dirichlet-smoothed | Recency |
| `markov` | 0.9 | P(next band \| current V5 state), leaned by candidate tilts | State dynamics |
| `dna` | 0.7 | Band shares of rounds that followed every ≥85%-similar 8-round band signature | Analogues (Ch 05 §5.4) |
| `band` | 0.9 | v6.2 band-partition / tail-lift model | Tail structure |
| `ml` | 0.6 | V5 logistic ensemble P(≥2/5/10) (0.6 model + 0.4 empirical), reshaped onto bands | Learned features |
| `ensemble` | 0.8 | v6 per-round earned ensemble (baseline · markov · streak · recent) | Earned blend |
| `signals` | 0.6 | Recent distribution tilted by the mean of 14 readings in [−1, +1] | Directional composite |

The 14 readings:
1. Mega pressure
2. Moonshot scanner
3. Moonshot research readiness
4. V5 ladder release
5. V5 band exhaustion
6. ShapeShifters
7. V5 gap/swing
8. Streak
9. FX trend quality
10. FX mean reversion
11. FX volatility regime
12. FX breakout squeeze
13. 10×+ range momentum
14. V5 regime

## 7.3 The seven-state machine
`V5_SETTINGS`:

| Group | Settings |
|---|---|
| Ladders and collapse | `ladderMinLength 3`, `ladderTolerance 0.06`, `collapseMinLength 3` |
| Band thresholds | `lowBand 2`, `ignition 5`, `moonshot 10`, `megaMoonshot 50` |
| Shelf and bait | `shelfWindow 12`, `shelfVariance 0.35`, `baitSpikeRatio 2.2` |
| Windows | `volatilityWindow 30`, `dnaWindow 8`, `dnaTolerance 0.85` |
| Output | `confidenceFloor 0.05`, `horizon 5` |

Detectors run in point space (100 + 30·log₂ m):
- `ascendingLadder` walks back while each point stays within `tol` of the running floor. Its strength is `pressure·0.6 + clamp(slope/20)·0.4`.
- `collapseLadder`
- `nestedBands` (compression)
- `shelfSignal` (variance shelf over 12 rounds)
- `baitSignal` fires when the spike ratio is ≥ 2.2 and ≥ 60% of the other rounds are low.

`classifyState` scores all 7 states. Rolling 40-round labels then build a **Laplace-smoothed transition matrix**.

Candidate tilts:
- DNA ≤ 35%;
- overdue ≤ 0.2 × band exhaustion;
- pressure, when Mega Pressure > 70;
- moonshot, when the scanner is > 0.7;
- ladder `min(0.25, (p − 0.6)·0.5)` when the moonshot probability is > 0.6;
- collapse and gap-swing momentum.

The ladder engine's moonshot probability is a **hand-set rule**: `cur.length ≥ 10 ? min(0.95, 0.6 + 0.02·length) : 0.3`, and 0.2 with no ladder. It is a prior, not a measured rate. It should be replaced by the measured conditional rate for that ladder length, with its Wilson CI (F-11).

Design note from the doc: the Markov value channel uses P(next | state) directly. Mixing candidates' own value distributions would be circular.

## 7.4 The earned mixture: code walkthrough
### 7.4.1 Weights
```ts
export function earnWeights(ledger) {
  const nEff = Math.min(60, n);
  const best = min(logLoss over known components);
  for (c of COMPONENTS)
    out[c] = (n >= 15 && typeof ll[c] === "number") ? PRIOR[c] * Math.exp(-nEff * (ll[c] - best)) : PRIOR[c];
  normalise; out.baseline = max(out.baseline, 0.08); out[c] = max(out[c], 0.02); normalise; round to 4 dp
}
```
\[
w_c \propto \pi_c \cdot \exp\big(-n_{\text{eff}}\,(\bar L_c - \bar L_{\text{best}})\big),\qquad n_{\text{eff}} = \min(60, N)
\]
Here \(\bar L_c\) is the engine's **mean** log-loss over the trailing window. \(n_{\text{eff}}\cdot \bar L_c\) is therefore its total log-loss over the last 60 rounds, and the weights are a Bayesian posterior over "which engine generated the data", with the evidence truncated to 60 rounds. That truncation acts as a forgetting factor.

Floors: baseline ≥ 8%, every engine ≥ 2%. With fewer than 15 scored rounds, the priors are used.

### 7.4.2 Mixture, agreement, rectification
```ts
const mixture   = normalize(bands.map(i => Σ_c w[c]·dist[c][i]));             // linear opinion pool
const agreement = clamp(1 - Σ_c w[c]·JS(dist[c], mixture) / ln2 * 4);          // 1 − 4·(weighted JS in bits)
const factor    = corr ? clamp(exp(corr), 0.5, 2) : 1;                         // rectification
expected = max(1, q50(mixture) * factor);
rangeLo  = max(1, q25(mixture) * (0.6 + 0.4*factor));
rangeHi  = q75(mixture) * (0.8 + 0.2*factor);
reach    = q90(mixture);                                                        // not rectified
```
- **Rectification** is the median log error over the trailing window, clamped to ±1.5 and applied as a multiplicative factor clamped to [0.5, 2]. The median is used, not the mean, because the tail makes mean log error positive even for a calibrated median.

### 7.4.3 Confidence
```ts
confidence = calSample >= 15 && hitRate !== null
  ? stateConviction*0.35 + agreement*0.25 + hitRate*0.40
  : (stateConviction*0.6 + agreement*0.4) * 0.6;
if (calSample < 15 || skillRaw === null || skillRaw < 0.03) confidence = min(confidence, 0.6);
label = ≥0.66 HIGH · ≥0.38 MEDIUM · else LOW
```
Here `skillRaw = (baseLogLoss − mixLogLoss)/baseLogLoss`. **HIGH requires the mixture to beat the baseline log-score by ≥ 3% on the ledger.** This gate is the most important honesty mechanism in the code.

### 7.4.4 Scoring the headline (`scoreIntelForecast`)
| Verdict | Rule |
|---|---|
| hit | actual in [p25, p75] **and** \|band error\| ≤ 1 |
| adjacent | \|band error\| ≤ 1 and inside [p25/1.5, p75·1.5] |
| miss-high / miss-low | band error > 1 / < −1 |
| near | anything else |

## 7.5 Six findings
| # | Finding | Why it matters | Fix |
|---|---|---|---|
| E1 | **Two pooling rules.** `intelligence.ts` mixes linearly (probabilities); `pipeline.ts: perRoundProbability` pools in **logit space**, `sigmoid(Σ w·logit(p))`, which is a log-opinion pool | The same engines give different answers on different screens; log pools are sharper than linear pools | Choose per target and document it. Use linear pooling for band distributions (it preserves calibration of well-calibrated members); logit pooling only if it wins on the ledger |
| E2 | **Rectification changes the headline but not the distribution.** `expected` and the range are scaled; `mixture` is not | Log-score (on the distribution) and verdict (on the headline) evaluate two different forecasts | Apply correction as a shift of the distribution in log-space, then derive all quantiles from the shifted distribution |
| E3 | **`hitRate` in confidence uses loose verdicts.** A "hit" is \|band error\| ≤ 1 plus IQR; with 6 bands, off-by-one covers most outcomes | 40% of the confidence weight rests on a quantity near its ceiling for any reasonable forecaster | Replace `hitRate` with calibrated skill: `clamp(skillRaw/0.10)` plus the PIT uniformity score (Ch 08) |
| E4 | **Floors applied after normalisation, then renormalised**, so the baseline can end below 8% (e.g. 0.08/1.12 ≈ 7.1%) | Documentation and behaviour disagree | Solve for floors exactly: allocate floors first, distribute the remainder proportionally |
| E5 | **Candidate tilts and hand rules** (ladder p = 0.6 + 0.02·len; pressure > 70; scanner > 0.7) inject fixed opinions | If the tape carries no signal, these tilts can only add noise; the earned weight reduces but does not remove them | Every tilt becomes a component whose own ledger earns its weight, or it is removed |
| E6 | **n_eff = 60 fixed** | Too short to separate engines whose log-loss differs by 0.5%; too long to react to regime changes | AdaHedge learning rate plus fixed share (§7.6) |

## 7.6 Reference design: the upgraded mixture
The current weighting is an exponentially weighted forecaster. That places it in the **Hedge / online expert aggregation** family, which has known regret guarantees and extensions for *shifting* experts and a *growing* number of experts ([AdaHedge / specialized experts, arXiv:1808.00741](https://arxiv.org/pdf/1808.00741); [GrowingHedge, PMLR v76](https://proceedings.mlr.press/v76/mourtada17a/mourtada17a.pdf); [online ensembles for time series](https://magittan.github.io/static/Online_Ensembles/Implementing_Online_Ensemble_Learning.pdf)).

### 7.6.1 Components of the upgrade
1. **Adaptive learning rate (AdaHedge).** Replace the fixed n_eff cap of 60 with a learning rate η tuned from the cumulative mixability gap. That removes a hand-tuned constant.
2. **Fixed share / shifting experts.** Mix a small α (≈ 0.01) of uniform weight back in at each step, so engines that were good in one regime can recover quickly. Today's 2% floor is a crude version of this.
3. **Sleeping experts.** Some engines only have an opinion sometimes: DNA needs a match and Ladder needs a ladder. Treat them as *specialists* who abstain, so they are not punished for silence.
4. **Stacking by band.** Learn weights per *target band* (a matrix W[c, band]) rather than one weight per engine, because an engine may be good at the tail and poor at the body. Do this only once each band has enough resolved outcomes (≥ 500 hits for the 10–100 band).
5. **Stay strictly proper.** Keep log-score as the training loss and report Brier alongside it. Both are strictly proper scoring rules, so a forecaster cannot improve its expected score by misreporting ([Gneiting-style lecture notes, Berkeley](https://www.stat.berkeley.edu/~ryantibs/statlearn-s23/lectures/calibration.pdf); [proper scoring rules survey](https://arxiv.org/html/2504.01781v3)).

### 7.6.2 Reference implementation (TypeScript)
```ts
// packages/engines/src/mix/adahedge.ts
export interface MixState { logW: Record<string, number>; delta: number; L: Record<string, number>; t: number }

export function initMix(prior: Record<string, number>): MixState {
  const logW: Record<string, number> = {};
  for (const [k, v] of Object.entries(prior)) logW[k] = Math.log(v);
  return { logW, delta: 0, L: Object.fromEntries(Object.keys(prior).map(k => [k, 0])), t: 0 };
}

export function weights(s: MixState, awake: Set<string>, alpha = 0.01): Record<string, number> {
  const keys = [...awake]; const m = Math.max(...keys.map(k => s.logW[k]));
  const raw = keys.map(k => Math.exp(s.logW[k] - m)); const Z = raw.reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  keys.forEach((k, i) => (out[k] = (1 - alpha) * raw[i] / Z + alpha / keys.length));   // fixed share
  return out;
}

/** losses: log-loss per awake expert on the band that landed; mixLoss: log-loss of the pooled forecast. */
export function update(s: MixState, losses: Record<string, number>, w: Record<string, number>, mixLoss: number) {
  const eta = s.delta > 0 ? Math.log(Object.keys(s.logW).length) / s.delta : Infinity;  // AdaHedge
  // mixability gap: mixLoss − (−1/η · ln Σ w e^{−η ℓ})
  const mixable = isFinite(eta)
    ? -Math.log(Object.entries(losses).reduce((a, [k, l]) => a + w[k] * Math.exp(-eta * l), 0)) / eta
    : Math.min(...Object.values(losses));
  s.delta += Math.max(0, mixLoss - mixable);
  for (const [k, l] of Object.entries(losses)) { s.L[k] += l; }
  // sleeping experts: sleepers are credited with the mixture's loss, so abstaining is neutral
  for (const k of Object.keys(s.logW)) s.L[k] += losses[k] === undefined ? mixLoss : 0;
  const etaNew = s.delta > 0 ? Math.log(Object.keys(s.logW).length) / s.delta : 1;
  for (const k of Object.keys(s.logW)) s.logW[k] = -etaNew * s.L[k];
  s.t++;
}
```
Persist `MixState` per source in a `mix_state(source, target, state_json, updated_ms)` table. The update runs inside `calibrateNewRounds()`, where v6.3 already scores every component against the landed round.

### 7.6.3 Why log-loss on bands is the right target
The band that lands is a categorical outcome, and log-loss on it is strictly proper. v6.3 already floors probabilities at 1e-6 in `bandLogLoss`. Keep that floor, but also report the **share of rounds where the landed band had p < 1%**. An engine that is often confidently wrong at the tail shows up there first.

## 7.7 Pipeline windows: `pipeline.ts`
- `WINDOWS`: 15m / 1h / 4h / 1d / 7d.
- `perRoundProbability(rounds, threshold, weights, recent=200)`: four components.
  - baseline = full-history rate;
  - markov-1 = P(hit | previous hit/miss);
  - streak = P(hit | current dry run s), used only with ≥ 10 samples;
  - recent = the rate over the last 200.
  - Weights: baseline 0.25 plus 0.75 split by positive skill. If no model has positive skill, the baseline takes 1.0, and the note reads "No model has earned skill over baseline yet — measured rate governs."
- `windowProbability(p, n) = 1 − (1 − p)^n`, with n = `expectedRounds(window)` from `medianIntervalMs(span=200)`.
- `verifyAgainstHistory(thresholds=[2,5,10], warmup ≥ 300)`: non-overlapping walk-forward blocks sized `window.ms / cadence`, with prefix sums for O(1) block counts.
- `skillsFromRuns`.

### 7.7.1 Window probabilities as intervals
A point-p hides both the uncertainty in p and the uncertainty in n (cadence varies). Put a Beta posterior on p and a distribution on n, then integrate:
\[
P(\text{hit in window}) = 1 - E_{p\sim\text{Beta}(a,b)}\,E_{n}\big[(1-p)^n\big], \qquad E_p[(1-p)^n] = \frac{B(a, b+n)}{B(a,b)}
\]
The inner expectation has a closed form, so there is no Monte Carlo on the hot path:
```ts
const lbeta = (a: number, b: number) => lgamma(a) + lgamma(b) - lgamma(a + b);
export function windowProbBeta(hits: number, n: number, rounds: number, prior = [1, 1]) {
  const a = prior[0] + hits, b = prior[1] + n - hits;
  return 1 - Math.exp(lbeta(a, b + rounds) - lbeta(a, b));
}
export function windowInterval(hits: number, n: number, roundsLo: number, roundsHi: number) {
  const [pl, ph] = wilson(hits / n, n);
  return { lo: 1 - Math.pow(1 - pl, roundsLo), mid: windowProbBeta(hits, n, Math.round((roundsLo + roundsHi) / 2)),
           hi: 1 - Math.pow(1 - ph, roundsHi) };
}
```
`roundsLo` and `roundsHi` come from the 10th and 90th percentile of the interval distribution over the window (Ch 10).

## 7.8 Engine plugin contract
Engines are plugins (`plugins` table). Adding an engine means implementing this interface:
```ts
export interface ForecastEngine {
  id: string; version: string; prior: number;
  targets: ("band6" | "exceed:2" | "exceed:10" | "logm")[];
  awake(tape: Tape): boolean;                  // sleeping-expert support
  predict(tape: Tape): { band6?: number[]; exceed?: Record<number, number> };
  explain?(tape: Tape): { feature: string; value: number; contribution: number }[];  // Ch 12, F-35
}
```
Onboarding flow:
1. The engine registers with its prior.
2. It runs in **shadow mode**: it is scored but its weight is forced to 0 for ≥ 500 resolved rounds.
3. It is promoted to live at its earned weight only if its log-loss CI overlaps or beats the baseline's.
4. It is auto-demoted (F-20) if its skill CI falls below −1% for 2 consecutive windows.

## 7.9 Measuring the earned mixture on a fair tape
**Setup.**
- A fair tape of 60,000 rounds at h = 3%, using the 6 v6.3 bands. Rounds 0–19,999 are for training; the mixture is scored on rounds 20,000–59,999.
- Four components:
  - `baseline`: training band shares;
  - `recent100` and `recent30`: trailing band frequencies with add-½ smoothing;
  - `markov`: a first-order transition matrix fitted on the training rounds.
- Priors 0.4 / 0.2 / 0.2 / 0.2.

Three weighting rules were compared:
1. **v6.3 exactly** (§7.4.1): n_eff = min(60, N), a 15-round warm-up, floors of 8% for the baseline and 2% for everyone else.
2. **Exponential weights with η = 1 on cumulative log-loss** (the Bayes posterior).
3. **The same with fixed share α = 10⁻³.**

| Component alone | Skill vs baseline (log-score) |
|---|---|
| markov | −0.063% |
| recent100 | −1.614% |
| recent30 | −4.718% |

| Mixture rule | Skill vs baseline | Share of 60-round windows with skill ≥ 3% (HIGH gate) | Mean weight change per round (L1) | Mean baseline weight |
|---|---|---|---|---|
| v6.3 (n_eff = 60, floors) | **−0.214%** | 0.1% | 0.0534 | 0.568 |
| Hedge + fixed share 10⁻² | −0.174% | — | — | — |
| Hedge + fixed share 10⁻³ | −0.031% | 0.0% | 0.0167 | 0.768 |
| Hedge (Bayes) | −0.002% | 0.0% | 0.0012 | 0.961 |

More measurements:
- Across trailing 60-round windows, the v6.3 mixture's skill has an SD of 0.48 pp, with a 5–95% range of −0.87 to +0.31 pp.
- `recent100`, which has no skill by construction, beats the baseline in **14.0%** of 60-round windows.

### 7.9.1 Findings
| # | Finding | Why it matters | Fix |
|---|---|---|---|
| E7 | **The 60-round evidence window costs log-score when nothing is there.** Truncating the evidence keeps re-promoting noisy engines: the baseline gets only 57% of the weight on average, and weights move 5% per round | −0.214% is small, but it is paid on every forecast. It is also the wrong direction for a system whose honest state is "no edge" | Cumulative log-loss with AdaHedge's adaptive η plus fixed share (§7.6), which is −0.03% here and still adapts |
| E8 | **Short-window leaderboards reward luck.** A no-skill engine wins one window in seven | Any UI that ranks engines on trailing 60 rounds will show changing "winners" with nothing behind them | Rank on cumulative skill with a block-bootstrap CI; show ties when the CIs overlap (F-17, F-12) |

**A positive result:** the HIGH gate (skill ≥ 3% on the ledger) almost never trips on fair data, 0.1% of windows under v6.3. That gate works as intended. Keep it, and apply it to the CI's lower bound rather than the point estimate (Ch 08).

### 7.9.2 Reproduce
```python
import numpy as np
rng = np.random.default_rng(6); EDGES = [1.5, 2, 5, 10, 100]; N = 60_000
m = np.maximum(np.floor(0.97 / (1 - rng.random(N)) * 100) / 100, 1.0)
y = np.searchsorted(EDGES, m, side="right"); T = np.arange(20_000, N)
cs = np.vstack([np.zeros(6), np.cumsum(np.eye(6)[y], 0)])
base = np.bincount(y[:20_000], minlength=6) / 20_000
recent = lambda i, w: (cs[i] - cs[i - w] + .5) / (w + 3)
M = np.ones((6, 6)); np.add.at(M, (y[:19_999], y[1:20_000]), 1); M /= M.sum(1, keepdims=True)
P = np.stack([np.tile(base, (len(T), 1)), np.array([recent(i, 100) for i in T]),
              np.array([recent(i, 30) for i in T]), M[y[T - 1]]], 1)
L = -np.log(P[np.arange(len(T)), :, y[T]])
prior = np.array([.4, .2, .2, .2])
def v63(k):
    if k < 15: w = prior.copy()
    else:
        mean = L[max(0, k - 60):k].mean(0); w = prior * np.exp(-min(k, 60) * (mean - mean.min()))
    w /= w.sum(); w[0] = max(w[0], .08); w = np.maximum(w, .02); return w / w.sum()
ll = np.array([-np.log((v63(k)[:, None] * P[k]).sum(0)[y[T[k]]]) for k in range(len(T))])
print("skill", 1 - ll.mean() / L[:, 0].mean())
```

### 7.9.3 What to change in §7.6.2
The reference AdaHedge in §7.6.2 is the right shape. The measurement adds three settings:
- **Fixed share α.** 10⁻³ cost 0.031 pp on fair data; α = 0.01 (the value suggested in §7.6.1) cost 0.174 pp, nearly as much as the v6.3 rule. Start at 10⁻³ and raise it only if regime tests (F-13) show slow recovery.
- **Floors.** Remove the 8% and 2% floors once fixed share is in: fixed share keeps every component alive at weight ≥ α/K.
- **The HIGH gate.** Keep it. Compute it from the skill CI's lower bound over the ledger, never over 60 rounds.

### 7.9.4 Additional tests
| Test | Assertion |
|---|---|
| `mixture_null_cost` | On 40k fair rounds, mixture skill ≥ −0.05% (v6.3 rule: −0.21%) |
| `mixture_finds_signal` | With a planted engine that knows the true next-band probabilities 10% of the time, its weight exceeds 0.5 within 5,000 rounds |
| `weights_replayable` | Rebuilding `mix_state` from the ledger gives identical weights to 1e-12 |
| `gate_on_lower_bound` | HIGH requires the lower 95% bound of skill ≥ 3%, not the point estimate |

## 7.10 Tests
| Test | Assertion |
|---|---|
| `mixture_null` | On a synthetic i.i.d. fair tape, after 5,000 rounds the baseline holds ≥ 60% weight and skill CI covers 0 |
| `mixture_planted` | Plant a 5% lift in P(≥2) after dry runs ≥ 3; the streak engine earns weight within 2,000 rounds |
| `adahedge_regret` | Cumulative regret vs best expert ≤ 2·√(T ln K) + const on adversarial sequences |
| `floors_exact` | After `earnWeights`, baseline ≥ 0.08 and every engine ≥ 0.02 exactly (E4) |
| `rectify_consistent` | The headline median equals the median of the scored distribution (E2) |
| `window_beta` | `windowProbBeta` matches Monte-Carlo within 1e-3 |
| `shadow_mode` | A new engine's weight is 0 until 500 resolutions |

The planted-signal test is the counterpart of the null test. It proves the mixture *can* find a real effect of realistic size. Without it, a flat result on real data could mean either "no signal" or "the machinery is broken".

## 7.11 Measurement
**Log-score skill vs baseline** = 1 − L_mix / L_base on resolved, out-of-sample rounds. This is the headline number, and it already exists as the "skill vs baseline" tile. Every change in this chapter ships behind a flag and is judged on the difference in that number, with a block-bootstrap CI (Ch 08 §8.6). Secondary numbers:
- baseline weight share over time;
- the share of rounds where the landed band had p < 1%;
- PIT histogram uniformity;
- the number of engines with positive skill CIs.

## 7.12 Features this chapter unlocks
- **F-12 Engine Marketplace:** drop-in engines with shadow mode, automatic ledger onboarding and a public leaderboard.
- **F-13 Regime-aware weights:** weights conditioned on the current state (W[c | state]), justified only if §6.6 finds within-session dependence.
- **F-14 Forecast diff:** "what changed since the last round", showing which engine moved the headline and by how much.
- **F-15 Distribution explorer:** the full 6-band (or 20-band) mixture as a fan chart, with each engine as a thin line.
- **F-16 Counterfactual toggle:** switch any engine off and see the headline and its historical log-score without it (replayed from the ledger with that weight set to 0).
- **F-20 Auto-demotion** of engines whose skill CI falls below zero.
