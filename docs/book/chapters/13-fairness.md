# 13 · Fairness Verification

Fairness verification is the one area where Momento can give users an exact answer: whether a round was produced by the committed seed under the stated algorithm. This chapter:
- documents the verifier and randomness battery in the terminal branch, line by line;
- reports one test defect: the KS test **rejects a perfectly fair tape** once the tape is large;
- specifies the Fairness Console as a continuous audit that also feeds Tape Integrity and the accuracy ledger.

## 13.1 What exists
| Location | Content |
|---|---|
| `ShapeShifters@momento-terminal-replace:backend/momento/fairness.py` | `crash_point_stake`, `crash_point_bustabit`, `verify_round`, `verify_batch`, `verify_seed_chain`, `find_chain_depth`, `generate_provable_tape`, `solve_convention`. Routes: `/fair/hash`, `/fair/verify`, `/fair/verify-batch`, `/fair/chain`, `/fair/solve`, `/fair/conventions`, `/fair/audits`, `/fair/tape` |
| `ShapeShifters@…:backend/momento/randomness.py` | Battery: `estimate_house_edge`, `chi_square_fit`, `ks_test`, `runs_test` (threshold 2×), `autocorrelation` (max lag 20), `conditional_dependence`, `digit_uniformity`, `full_battery` |
| `momento-core@research/edge-falsification-suite:backend/research/` | PIT KS, Hill tail, cash-out EV, independence (Ch 12) |
| `MomentoV5@v6:backend/momento/feed.py` | Hash-chain demo feed: `SALT`, `CHAIN_LENGTH = 20000`, `multiplier_for_seed(seed, house_edge)`, `verify_round`; Worker `/feed/*` |
| `momento-core3@vibe/fairness-visualization-…`, `MomentoFX` fairness analytics | Drift and "rate of balance" visuals |

### 13.1.1 The two derivations (`fairness.py`)
**Stake-style (HMAC over a seed pair).** Operators agree on the primitive but not on how the message is assembled, so the module exposes seven `MESSAGE_TEMPLATES`:
- `client:nonce` (default);
- `client-nonce`;
- `nonce:client`;
- `clientnonce`;
- `server:client:nonce`;
- `nonce-only`;
- `client-only`.

HMAC-SHA256 and HMAC-SHA512 are both supported.
```
digest = HMAC(key=server_seed, msg=template(client, nonce))
i      = int(digest[:8], 16)                 # first 4 bytes, big-endian
raw    = (2**32 / (i + 1)) * (1 - house_edge)
crash  = floor(max(1.0, raw) * 100) / 100
```
**Bustabit-style (52-bit, instant-bust divisor).**
```
h = HMAC_SHA256(server_seed, client_seed)  or  sha256(server_seed)
if int(h, 16) % divisor == 0: crash = 1.00   # house edge = 1/divisor (e.g. 1/101)
X = int(h[:13], 16)                           # 52 bits
crash = floor((100 * 2**52 − X) / (2**52 − X)) / 100
```

### 13.1.2 Seed chains
Each revealed seed is the SHA-256 of the next. `verify_seed_chain(revealed, committed, iterations)` hashes forward. `find_chain_depth(revealed, committed, max_depth = 2000)` finds how many steps separate a revealed seed from the published commitment. Together they prove that a revealed seed belongs to the chain committed before play.

### 13.1.3 The convention solver
`solve_convention(server, client, nonce, observed)` searches 7 templates × 2 hashes × 6 edges (0–5%) = 84 combinations, plus the Bustabit derivation. It keeps every combination that reproduces the observed crash within 0.005. The docstring is careful: "A single match is weak evidence; confirm it across several rounds with verify_batch before trusting it."

How weak is one match? For a displayed value around 2.00×, a random combination reproduces it with probability about P(M ∈ [x, x+0.01)) ≈ 0.97·0.01/x² ≈ 0.24%. With 85 candidates, the chance of at least one spurious match on one round is ≈ 19%. On three independent rounds, a spurious candidate that matches all three has probability ≈ 85 × (0.0024)³ ≈ 10⁻⁶. **Require k ≥ 3 matching rounds** before recording a convention on a source.

### 13.1.4 Randomness battery
`theoretical_survival(m, h) = (1 − h)/m`. `full_battery` combines:
- a χ² fit against it;
- KS on the continuous part;
- runs and autocorrelation;
- conditional dependence;
- digit uniformity.

## 13.2 Finding F1: the KS test rejects fair tapes at scale
`ks_test` keeps rounds with m > 1.001 and compares them with the **continuous** CDF F(m) = 1 − 1/m. Two things are wrong for a crash tape:
1. **Conditioning.** Given M ≥ 1.01 (the smallest non-instant display), P(M ≥ m | M ≥ 1.01) = 1.01/m, so the conditional CDF is 1 − 1.01/m, not 1 − 1/m. The gap at the bottom of the support is ≈ 0.0099.
2. **Discretisation.** Displayed values are floored to 0.01, so the empirical CDF is a step function on a 0.01 grid. At n = 177,905 the KS 5% critical value is 1.36/√n ≈ 0.0032, much smaller than the ≈ 0.005–0.01 discretisation offset.

Measured on simulated **fair** tapes (h = 3%, floored to 0.01):

| n | CDF used | D | p |
|---|---|---|---|
| 5,000 | 1 − 1/m | 0.0181 | 0.085 |
| 50,000 | 1 − 1/m | 0.0134 | < 10⁻⁴ |
| 177,905 | 1 − 1/m | 0.0099 | < 10⁻⁴ |
| 177,905 | 1 − 1.01/m | 0.0097 | < 10⁻⁴ |
| 177,905 | 1 − 1.01/(m + 0.005) (mid-cell) | 0.0052 | 0.0002 |

The continuous test **always rejects** a fair tape the size of the Momento evidence set. Fix it with a **randomised PIT on the discrete law**: for an observation x, draw u uniformly between F(x) and F(x + 0.01), with F(m) = 1 − 1.01/m, and test the u's for uniformity. On 40 simulated fair tapes of 177,905 rounds, this gives a rejection rate of 2.5% at α = 0.05 (median p = 0.48), which is correctly sized.

```python
def discrete_pit_ks(mults, h=0.03, tick=0.01, rng=np.random.default_rng(0)):
    x = np.asarray(mults); x = x[x >= 1.0 + tick]
    F = lambda v: 1.0 - (1.0 + tick) / v                  # CDF of display value given M ≥ 1.01
    u = F(x) + rng.random(len(x)) * (F(x + tick) - F(x))
    return stats.kstest(u, "uniform")
```
The same care applies to `research/distribution.py::probability_integral_transform` (1/X uniform) and to `chi_square_fit`. The χ² bins must be built from the discrete law, with expected counts from P(x ≤ M < x + tick) aggregated into bands. Do not use a continuous density.

## 13.3 Reference design
### 13.3.1 Convention solver as onboarding
When a new source is added:
1. Collect ≥ 3 rounds with revealed seeds.
2. Run `solve_convention` on each and intersect the candidate sets.
3. Confirm with `verify_batch` on ≥ 20 rounds.
4. Record `sources.fair_convention = {template, algorithm, house_edge, derivation}` with the evidence round ids.

A source that yields no convention is labelled "unverifiable". That is useful product information too.

### 13.3.2 Continuous audit
For every round with revealed seed data, recompute the multiplier and store `fair_verified ∈ {pass, fail, n/a}` in a `round_fairness` table.

```sql
CREATE TABLE round_fairness (
  round_id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, server_seed_hash TEXT, server_seed TEXT,
  client_seed TEXT, nonce INTEGER, convention TEXT, recomputed REAL, captured REAL,
  verdict TEXT NOT NULL CHECK (verdict IN ('pass','fail','n/a')), chain_depth INTEGER, checked_ms INTEGER NOT NULL);
```
- **fail, recomputed ≠ captured:** either the collector captured the wrong value or the operator's number is not the committed one. Look at whether other collectors (F-02) captured the same value. If they agree with each other but not with the recomputation, it is an **operator-level** failure (critical alert). If they disagree with each other, it is a **collector** error, which feeds F-01 Tape Integrity.
- A failed or unverifiable window is **void** in the accuracy ledger (Ch 08 §8.4.5).

### 13.3.3 Chain monitoring
When operators publish a terminating hash for a chain of N games (for example 10M), each revealed seed's `find_chain_depth` must be exactly 1 step from the previous revealed seed. A jump or a repeat is a chain break and an alert. Track depth progress on a chart: it doubles as a completeness check, because missed rounds appear as depth gaps.

### 13.3.4 Nightly battery with correct tests
Run the corrected battery per source every night, using the discrete-law PIT, discrete χ², Hill tail, runs, autocorrelation with the Bartlett bound, gap independence and cash-out EV.
- Store every p-value in `fairness_runs(source_id, date, test, statistic, p, n)`.
- Apply BH across the day's tests.
- Plot each test's p-values over time. Under the null they are uniform, so a histogram is part of the display.
- Two consecutive nights with q < 0.05 on the same test, or a p-value trend (KS of the p-values themselves against uniform over 30 nights), marks a **source fingerprint change** (F-03). This could be a new algorithm version, a new house edge or a collector change.

### 13.3.5 House edge estimation
Report the measured house edge with a CI next to the declared one. The MLE under the Stake-style law is simple: P(M = 1.00) and the survival above any x both scale with (1 − h). Two estimators are useful and should agree:
- **from the instant-bust share**: for Stake-style, P(crash = 1.00) = P(raw < 1.01) = 1 − (1 − h)/1.01;
- **from survival at mid-range**: ĥ = 1 − x·S(x), averaged over x ∈ [2, 10] with a bootstrap CI.

Disagreement between the two points to a derivation difference, for example a Bustabit-style instant-bust divisor.

## 13.4 API and UI
| Endpoint | Purpose |
|---|---|
| `POST /fair/verify` | Verify one round (user-supplied or stored) under the source's convention |
| `POST /fair/solve` | Convention search for a set of rounds |
| `GET /fair/audit?source=&from=&to=` | Verified share, fail list, chain depth series |
| `GET /fair/battery?source=&days=30` | Nightly p-values and verdicts |
| `GET /fair/edge?source=` | Measured edge with CI, both estimators |

The **Fairness Console** (F-36) shows:
- the per-source convention card with its evidence rounds;
- the verified share (for example "99.97% of 41,220 rounds verified; 12 fails, all collector-side");
- the chain depth chart;
- the nightly battery with a p-value histogram;
- the measured vs declared house edge;
- a "verify any round" box. Paste the seeds and see the digest, the intermediate integer and the result, step by step.

## 13.5 Tests
| Test | Assertion |
|---|---|
| `stake_vectors` | Published Stake/Bustabit example vectors reproduce exactly |
| `template_matrix` | Every template × algorithm × edge round-trips through `solve_convention` |
| `solver_k3` | A random wrong convention never survives 3-round intersection in 10⁴ trials |
| `ks_discrete_sized` | The discrete PIT KS rejects 5% ± 1.5% of fair simulated tapes at n = 177,905 (F1) |
| `ks_detects_edge_shift` | A tape at h = 5% declared as 3% is rejected at n = 50,000 |
| `chain_break` | A skipped seed in the chain is detected as a depth jump |
| `void_on_fail` | A failed verification voids the overlapping ledger windows |

## 13.6 Measurement
- Verified share per source;
- time from round to verification;
- fails by class (collector vs operator);
- battery false-alarm rate on a shuffled copy (should equal α);
- the house-edge CI width.

## 13.7 Features this chapter unlocks
- **F-36 Fairness Console:** per-source convention, verified-round share, chain depth, audit history, nightly battery trend, measured edge and a "verify any round" box for users.
- It also feeds **F-01** (collector errors), **F-03** (fingerprint changes) and **F-18** (void windows in the public track record).
