# 05 · MomentoLinguistics

> "Turns raw multipliers into a shared vocabulary (bands, energy, shapes, states) so every engine can talk about market behaviour instead of numbers."
> (`MomentoV5@v6:backend/momento/linguistics.py`, module docstring)

Linguistics is Momento's most distinctive idea: a controlled vocabulary between the raw tape and every engine, chart and sentence. This chapter documents all eight layers as implemented, the two band systems in use, the V5 vocabulary-learning pipeline and its main weakness, and a reference design for evidence-based vocabulary growth and sequence search.

## 5.1 The eight layers as implemented
The Python module (`linguistics.py`, 696 lines) labels Layers 1, 3, 4, 6 and 8 explicitly. Layers 2, 5 and 7 are reconstructed from how the module and `functions/intelligence.ts` are organised.

| Layer | Name | Implementation | Output |
|---|---|---|---|
| 1 | **Band** | `band_for` · 10 bands (`BANDS`) | dust 1–1.2 · floor 1.2–1.5 · low 1.5–2 · base 2–3 · mid 3–5 · high 5–10 · ignition 10–20 · moonshot 20–50 · mega 50–100 · cosmic 100+ |
| 2 | **Points / colour** | `to_points`, `from_points`, `color_for` | Points = 100 + 30·log₂(m): 1× = 100, and each doubling adds 30 |
| 3 | **Energy** | `energy_of` | snuffed < 1.3 · damp < 2 · steady < 3 · charged < 6 · surging < 15 · explosive < 50 · runaway ≥ 50 |
| 4 | **Shape** | `shape_of(window)` | seed · shelf · ramp · slide · edge-spike · arch |
| 5 | **Structure** | `detect_ladders`, `detect_resistance_ceilings`, `calculate_compression_energy`, `calculate_ladder_pressure`, `calculate_ladder_distances/distribution` | Ladders, ceilings, compression |
| 6 | **State** | `STATES`, `STATE_META` | Normal · Collapse · Ignition · Moonshot · Exhaustion · Shelf · Bait |
| 7 | **Sequence / DNA** | Band-index strings (`dnaWindow: 8`, `dnaTolerance: 0.85`) | The DNA alphabet used for analogue matching |
| 8 | **Sentence** | `sentence(state, window)` | A plain-language reading of the market |

### 5.1.1 Layer 4: the shape classifier, exactly
```python
points = [to_points(m) for m in window]
delta  = mean(second_half) - mean(first_half)
spread = max(points) - min(points)
if spread < 12:  return "shelf"      # < 12 points ≈ a 1.32× ratio between max and min
if delta > 10:   return "ramp"       # second half ~26% higher in multiplier terms
if delta < -10:  return "slide"
if peak_index in (0, len(points)-1): return "edge-spike"
return "arch"
```
The thresholds are in Points, so they are **ratio thresholds**. 12 points is \(2^{12/30} ≈ 1.32×\). This is why the Points scale matters: every shape rule reads the same at 1.5× and at 50×.

### 5.1.2 Layer 6: states and their meanings (`STATE_META`)
| State | Tone | Meaning |
|---|---|---|
| Normal | neutral | Balanced distribution, no dominant pressure |
| Collapse | bear | Descending ceilings, energy draining out of the curve |
| Ignition | bull | Compression released, upside energy building |
| Moonshot | bull | High band cleared, extended run in progress |
| Exhaustion | bear | Upside spent, mean reversion likely |
| Shelf | neutral | Flat variance shelf, market coiling |
| Bait | warn | Single spike inside weakness — false invitation |

### 5.1.3 Layer 8: the sentence template
```python
f"{state}: {meta['meaning'].lower()}. "
f"Last round settled {token.multiplier:.2f}x in the {token.band_label} band "
f"with {token.energy} energy, forming a {shape} across the last {len(window)} rounds."
```

### 5.1.4 Layer 5: structure detectors
- **`detect_ladders(min_length=4, base_window=20)`** computes a rolling 20-round mean as the "base". An **ascend ladder** is a run of ≥ 4 rounds at or above base. It is *pure* if strictly increasing, otherwise *weak*, and its slope is (end − start)/length. v6.3 ports this as `ladders(low=2, high=5, minLen=3)`, which uses fixed thresholds instead of a rolling base.
- **`detect_resistance_ceilings(window=50, upper=95, lower=5)`** tracks rolling 95th and 5th percentiles as ceilings and reports `ceiling_breach_frequency` and `ladder_containment_rate`. v6.3's `ceilings(window=400, minTouches=3, tol=0.05)` instead clusters touches within ±5%.
- **`calculate_compression_energy`** sums the gaps (ceiling − m) for rounds below the upper ceiling and reports a `release_pressure_threshold`.

## 5.2 Two band systems
| System | Where | Edges | Use |
|---|---|---|---|
| V5 10-band | `linguistics.py`, `intelligence.ts: V5_BANDS` | 1.2, 1.5, 2, 3, 5, 10, 20, 50, 100 | DNA alphabet, states, sentences |
| v6.3 6-band | `analysis.ts: BAND_EDGES` | 1.5, 2, 5, 10, 100 | Band histogram, transition matrix, calibration band error |

**Why it matters.** A "band error of 1" in `scoreRoundForecast` (Ch 08) means something different from a DNA band distance of 1. Pick the 10-band alphabet as canonical, and define the 6-band set as an explicit **coarsening map**, `coarse = [0,0,1,2,3,3,4,4,4,5][fine]`. Every consumer then declares which resolution it uses.

## 5.3 The v6.3 linguistic stream (`analysis.ts: linguistics(depth=200)`)
For each of the last 200 rounds v6.3 builds a 7-layer token: `band, chroma, streak, transition, momentum, pressure, shape`. The first four are joined as the token key (e.g. `low·unrecorded·dry3·base→low`), and the 40 most frequent keys are returned.

Two implementation notes for the port:
1. **Pressure and shape are global, not per-round.** `pressure(rounds)` and `shape(rounds, 80)` are computed once, from the whole tape at the time of the request, and the result is written into *every* historical token. Historical tokens therefore show today's pressure, which is a look-ahead leak for any learning built on them. Compute both layers causally: from rounds ≤ i for token i, using incremental state (Ch 04 §4.6).
2. **`belowRunAt` is O(run) per token.** Keep a running counter instead.

## 5.4 DNA analogue matching (Layer 7)
`intelligence.ts: dnaReport(m, scan = 6000)`:
```ts
const sig = m.slice(-W).map(v5BandIndex);                  // W = 8 band indices
for (let s = start0; s < limit; s++) {
  let d = 0; for (let k = 0; k < W; k++) d += Math.abs(keys[s + k] - sig[k]);
  const sim = 1 - d / (W * 9);                              // L1 over ordinal bands
  if (sim >= 0.85) matches.push({ index: s, similarity: sim, next: m[s + W] });
}
confidence = clamp(matches.length / 25)
```
The followers' outcomes (median, p75, p90, over2/5/10) blend into the state probabilities with weight `min(0.35, confidence·0.35)`.

**Measured result (App. D):** DNA hit rate 49.32% against an 84.12% base rate on the evaluation used. As built, it does not add skill. Three causes are visible in the code:
- **Overlapping matches.** Windows starting at s and s+1 share 7 of 8 symbols, so one historical episode produces several "matches". Deduplicate by requiring |s_i − s_j| ≥ W.
- **Similarity 0.85 is loose.** A total L1 distance ≤ 10.8 over 8 symbols allows about one band of disagreement on every position.
- **Confidence counts matches, not information.** 25 correlated matches are not 25 independent observations. Use an effective sample size, and shrink the follower distribution to the unconditional one: \(\hat p = \frac{k + \alpha p_0}{n_{eff} + \alpha}\).

These are fixable, and the fixes should be tested (§5.8). §5.7 measures the current behaviour. The honest expectation, given the other evidence in App. D, is that the shrunk estimate will sit close to the base rate. The feature is still valuable as explanation and sequence search (F-07). It should not be presented as an edge unless the Reliability Studio (F-17) shows skill.

## 5.5 Vocabulary learning (V5)
`backend/momento/vocabulary_*.py` and `docs/VOCABULARY_SYSTEM_IMPLEMENTATION_SUMMARY.md`:
- **Tables:**
  - `vocabulary_entries` (status tracking);
  - `vocabulary_usage` (usage events with confidence);
  - `vocabulary_relationships` (semantic links);
  - `pattern_discoveries`.
- **Discovery sources:**
  - `DnaPatternDiscovery` (signatures, large gaps, repeating sequences);
  - `PressurePatternDiscovery` (ceilings, touch counts, archetypes);
  - `MoonshotPatternDiscovery` (pre-moonshot factors);
  - `PatternDiscoveryCoordinator`, which runs the cycle.
- **Learning engine (`VocabularyLearningEngine`):** a candidate is formalised when
  - usage ≥ 10,
  - consistency ≥ 80% (low dispersion of confidence),
  - it has lasted a 7-day time window,
  - mean confidence ≥ 70%,
  - and a semantic-overlap check passes.
- **Feature integration:** `VocabularyFeatureConverter` turns formalised words into `BaseFeature` classes, and `VocabularyAutoImport` registers them in the `FeatureRegistry`.
- **API:**
  - `/vocabulary`, `/vocabulary/{id}/formalize|evaluate|deprecate`, `/vocabulary/discover`;
  - `/discoveries`, `/learning/status|progress`, `/learning/auto-formalize`;
  - `/features/import`, `/features/mapping`.
- **UI:** `VocabularyDashboard`, `VocabularyCandidates`, `pages/dashboard/Vocabulary.tsx`.

**The gap.** None of the formalisation criteria looks at *outcomes*. Usage count, confidence consistency and age measure whether a word is used steadily, not whether it predicts anything. A word can be formalised, imported as a feature, and influence forecasts without ever being shown to change the next-round distribution. The v6.3 `vocabulary` table keeps `uses / hits / misses / score`, which is the right raw material. The promotion rule has to use it.

## 5.6 Reference design: evidence-based vocabulary
### 5.6.1 What a word is
A word is a **causal predicate** over rounds ≤ i, for example:
- `band[i-2..i] == [floor, floor, base]`;
- `dry_run ≥ 7 and shape == shelf`;
- `state == Bait`.

It is evaluated against one or more **outcome targets** on round i+1 (or the next k rounds): P(m ≥ 2), P(m ≥ 10), E[log m].

### 5.6.2 Lifecycle with statistical gates
| Stage | Gate | Data used |
|---|---|---|
| candidate | support ≥ 30 in the mining window | mining segment (e.g. first 60%) |
| validated | two-proportion z-test vs base rate, p < 0.05; Wilson 95% CIs ([Wilson score interval](https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval)) | **held-out** segment (next 20%) |
| formalized | survives **Benjamini–Hochberg** at q < 0.10 across *all* candidates tested in the cycle ([False discovery rate](https://en.wikipedia.org/wiki/False_discovery_rate)); same sign of lift on the final 20% | held-out + final segment |
| deprecated | rolling 30-day lift CI contains 0 for 2 consecutive periods | live |

Words that never pass stay **descriptive**. They can be shown and searched, but no engine may consume them as a feature. That one rule closes the gap in §5.5.

### 5.6.3 Reference implementation (Python, research suite)
```python
import numpy as np
from statsmodels.stats.proportion import proportions_ztest, proportion_confint
from statsmodels.stats.multitest import multipletests

def evaluate_words(tape, words, target=lambda m: m >= 2.0, split=(0.6, 0.8)):
    n = len(tape); a, b = int(n*split[0]), int(n*split[1])
    y = np.array([target(m) for m in tape[1:]] + [False])     # outcome of round i+1
    rows = []
    for w in words:
        mask = w.evaluate(tape)                               # causal boolean vector
        mine = mask[:a].sum()
        if mine < 30: continue
        hold = mask[a:b]; k, nn = y[a:b][hold].sum(), hold.sum()
        base_k, base_n = y[a:b].sum(), b - a
        if nn < 30: continue
        z, p = proportions_ztest([k, base_k], [nn, base_n])
        lo, hi = proportion_confint(k, nn, method="wilson")
        rows.append(dict(word=w.name, support=int(mine), n=int(nn), rate=k/nn,
                         base=base_k/base_n, lift=k/nn - base_k/base_n, p=p, ci=(lo, hi)))
    if rows:
        _, q, _, _ = multipletests([r["p"] for r in rows], method="fdr_bh")
        for r, qq in zip(rows, q): r["q"] = qq
    return rows
```
Store `support, n, rate, base, lift, p, q, ci_lo, ci_hi, segment_results, target, tested_ms` on the `vocabulary` row. The Living Dictionary (F-06) renders them.

### 5.6.4 Sequence search (F-07)
Every round has a fine band index 0–9, so the tape is a string over a 10-letter alphabet (`'0'..'9'`, one character per round). Sequence search over it is plain string matching:
- **Exact patterns** ("floor floor bait"): build a suffix array once per snapshot, O(n log n), and query in O(p log n). At 178k rounds a plain `indexOf` loop over a JS string is already under 10 ms, so start there.
- **Fuzzy patterns** (≤ k band errors): use a bit-parallel approximate matcher (Myers/Wu–Manber) or the existing L1 scan with de-duplicated matches.
- **Results carry outcomes.** Each hit returns the next-round multiplier and the k-round window. The page shows the follower distribution against the unconditional one, with the Wilson CI and the number of *non-overlapping* hits.

```ts
export function searchSequence(tape: string, pattern: string, maxHits = 5000) {
  const hits: number[] = []; let i = tape.indexOf(pattern);
  while (i !== -1 && hits.length < maxHits) { hits.push(i); i = tape.indexOf(pattern, i + pattern.length); } // non-overlapping
  return hits;
}
```

### 5.6.5 Points as the universal axis
The Points transform turns a multiplicative series into an additive one. Keep it as the **single y-axis** for every chart (Ch 09). MomentoFresh adds an **equal-baseline symmetric** variant (`backend/features/equal_baseline/converter.py`) that centres the scale on the baseline. Offer both as chart modes.

### 5.6.6 Sentences that cannot lie
Layer 8 is template-based today. Keep the templates as the source of truth and let an LLM **rephrase only**. Its input is the structured reading (state, energy, shape, formalised words that fired, confidence). A validator then rejects any output that contains a number not present in the input. Every word shown in a sentence links to its Dictionary entry and evidence (Ch 15 §15.4).

## 5.7 Measuring the linguistic layers on a fair tape
**Setup.**
- `shape_of` and `to_points` were run exactly as written in `MomentoV5@v6:backend/momento/linguistics.py` (lines 89–163).
- The tape is 200,000 fair rounds, \(m = \max(1, \lfloor 0.97/(1-r)\cdot100\rfloor/100)\), in non-overlapping windows.
- On this law a single round has a mean of 141.9 points and an SD of 43.4.

| Window W | shelf | ramp | slide | edge-spike | arch |
|---|---|---|---|---|---|
| 8 | 0.0% | 35.9% | 36.2% | 7.0% | 21.0% |
| 12 | 0.0% | 32.9% | 34.1% | 5.2% | 27.7% |
| 20 | 0.0% | 29.3% | 29.6% | 3.8% | 37.3% |
| 40 | 0.0% | 22.2% | 22.6% | 2.6% | 52.7% |

What follows each shape, on rolling windows with W = 12:

| Shape | Windows | P(next round ≥ 2×) |
|---|---|---|
| ramp | 66,882 | 48.62% |
| slide | 66,988 | 48.35% |
| arch | 55,084 | 48.85% |
| edge-spike | 11,033 | 49.41% |
| (base rate) | 200,000 | 48.63% |

DNA confidence, measured by drawing 300 random 8-round signatures and scanning 6,000 historical windows at similarity ≥ 0.85, as in `dnaReport`:
- The median number of matches is **237** (mean 262).
- **94.3%** of signatures reach `confidence = clamp(matches/25) = 1`.
- Enforcing a spacing of at least W between matches still leaves a median of 186.

### 5.7.1 Findings
| # | Finding | Why | Fix |
|---|---|---|---|
| L1 | **"shelf" cannot occur on a fair tape** at W ≥ 8 | spread < 12 points means max/min < 1.32× across the whole window; with 21% of rounds below 1.2× and 48% above 2×, that almost never happens | Define shelf relative to the null: spread below the 5th percentile of the null spread for this W |
| L2 | **ramp and slide fire on noise** (72% of windows at W = 8) | The threshold of 10 points is fixed, but the SD of the half-difference is \(43.4\sqrt{4/W}\): 30.7 at W = 8, 25.1 at W = 12. So 10 points is only 0.3–0.4 SD | Threshold \(= z\cdot 43.4\sqrt{4/W}\) with z = 1.96; measured fire rate 5.3% at W = 12 (§5.7.2) |
| L3 | **Shapes carry no information about the next round** on fair data (48.35–49.41% vs 48.63%) | Expected under independence. This is the null the product must beat | Shapes stay descriptive until a word passes the gates in §5.6.2 on real tapes |
| L4 | **DNA confidence saturates** (94.3% at maximum) | Similarity 0.85 on a 10-symbol ordinal alphabet is loose, and overlapping matches are counted | Tighter similarity, spacing ≥ W, effective sample size and shrinkage (§5.7.3) |

These are not claims about any real tape. They show what the labels do when nothing is there. A label that fires 72% of the time on noise cannot tell the user anything, whatever the real tape does.

### 5.7.2 Reference implementation: null-calibrated shapes (Python)
```python
import math
MU, SD = 141.9, 43.4          # points mean and SD of the source's law; re-estimate per source epoch

def null_spread_q05(W, sims=20000, rng=None):
    """5th percentile of max-min points spread under the null; cache per (source_epoch, W)."""
    import numpy as np
    rng = rng or np.random.default_rng(0)
    u = rng.random((sims, W)); m = np.maximum(np.floor(0.97 / (1 - u) * 100) / 100, 1.0)
    p = 100 + 30 * np.log2(m); return float(np.quantile(p.max(1) - p.min(1), 0.05))

def shape_v2(window, q05_spread, z=1.96):
    W = len(window)
    if W < 6: return "seed"
    p = [100 + 30 * math.log2(max(1.0, m)) for m in window]
    h = W // 2
    delta = sum(p[h:]) / (W - h) - sum(p[:h]) / h
    thr = z * SD * math.sqrt(1 / h + 1 / (W - h))
    if max(p) - min(p) <= q05_spread: return "shelf"
    if delta > thr: return "ramp"
    if delta < -thr: return "slide"
    k = p.index(max(p))
    return "edge-spike" if k in (0, W - 1) else "arch"
```
On a fair tape, `shape_v2` returns ramp, slide or shelf together about 10% of the time by construction (5.3% for ramp and slide measured at W = 12, and about 5% shelf). Anything above that rate on a real tape is information worth surfacing, and the significance strip (F-11) can test it directly.

### 5.7.3 Reference implementation: honest DNA
```ts
export function dnaV2(bands: number[], m: number[], W = 8, simMin = 0.95, scan = 6000, alpha = 50) {
  const sig = bands.slice(-W); const end = bands.length - W - 1; const start = Math.max(0, end - scan);
  const hits: number[] = []; let last = -Infinity;
  for (let s = start; s < end; s++) {
    let d = 0; for (let k = 0; k < W; k++) d += Math.abs(bands[s + k] - sig[k]);
    if (1 - d / (W * 9) >= simMin && s - last >= W) { hits.push(s); last = s; }  // non-overlapping
  }
  const y = hits.map(s => (m[s + W] >= 2 ? 1 : 0));
  const k = y.reduce((a, b) => a + b, 0), n = y.length;
  const p0 = baseRate(m, 2);                                   // unconditional P(≥2) from the ledger window
  const pHat = (k + alpha * p0) / (n + alpha);                 // shrink toward base
  return { n, pHat, p0, lift: pHat - p0, weight: n / (n + alpha) };
}
```
The blend weight is `n/(n + α)`, not `clamp(n/25)`. With α = 50, even the 186 non-overlapping matches found at similarity 0.85 would earn a weight of about 0.79 on a shrunk estimate that stays close to p0 unless the followers really differ. The Reliability Studio then decides whether the DNA component earns any mixture weight at all (Ch 07).

### 5.7.4 Additional tests
| Test | Assertion |
|---|---|
| `shape_null_rate` | On 200k fair rounds, P(ramp ∪ slide) ∈ [3%, 8%] at W ∈ {8, 12, 20} |
| `shelf_reachable` | On a tape with m ∈ [1.9, 2.1] only, shelf ≥ 90% |
| `dna_confidence_not_saturated` | On a fair tape, median `weight` < 0.9 and |median lift| < 1 pp |
| `v5_v6_token_parity` | For 10⁵ random rounds, the TS and Python band, points and energy agree exactly |

## 5.8 Tests
| Test | Assertion |
|---|---|
| `points_roundtrip` | `from_points(to_points(m)) == m` within 1e-9 for m ∈ [1, 10⁶] |
| `band_coarsening` | Fine → coarse map agrees with `BAND_EDGES` for 10⁵ random m |
| `causal_tokens` | A token at index i is unchanged when rounds > i are appended (catches the §5.3 leak) |
| `dna_nonoverlap` | Reported matches are ≥ W apart |
| `word_null_calibration` | On a synthetic i.i.d. tape (m = 0.97/U), about 5% of words are "validated" at p < 0.05 and ≤ 10% of formalised words are false at q < 0.10 |
| `sentence_numbers` | Every number in a rephrased sentence appears in the structured input |

The null-calibration test is the important one. The same pipeline run on a tape with no structure *by construction* must find almost nothing. If it does find words, the gates are leaking.

## 5.9 Measurement
- **Vocabulary precision:** the share of formalised words whose lift is still significant in the next 30 days. Track it monthly.
- **Descriptive-to-formal ratio:** expect most words to remain descriptive.
- **Search usage:** queries per active user and hits per query.
- **Sentence validator rejection rate** (target < 1%).

## 5.10 Features this chapter unlocks
- **F-06 Living Dictionary:** every word with its lifecycle, evidence, CI, q-value and timeline.
- **F-07 Sequence search:** "find every time the tape said *floor floor bait*", with outcomes against the base rate.
- **F-08 Narrated replay:** Layer-8 sentences over a replayed session (F-24), computed causally.
