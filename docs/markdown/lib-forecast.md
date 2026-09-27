# Momento Lib — probabilistic next-event forecaster

`functions/lib/forecast.ts` is a pure, dependency-free forecaster built for the best achievable score on proper metrics (log loss, Brier). It does not issue a single "prediction". It gives a full probability distribution for the next round and next-event probabilities derived from it.

## What it outputs

| Field | Meaning |
|---|---|
| `bins` | P(next round lands in each of 11 fine bins: <1.01, 1.01–1.2, 1.2–1.5, 1.5–2, 2–3, 3–5, 5–10, 10–20, 20–50, 50–100, 100+) |
| `survival` | P(next ≥ x) for x = 1.2, 1.5, 2, 3, 5, 10, 20, 50, 100, next to the base rate |
| `v6Bands` | The same distribution on the platform's six v6 bands (drop-in for `bandLogLoss`) |
| `quantiles` | p10 / p25 / median / p75 / p90 of the next multiplier |
| `nextEvents` | For 2×, 3×, 5×, 10×, 20×, 50×, 100×: P(next), lift vs base, P(at least one within 1/3/5/10/25/50 rounds), expected and median wait, rounds since last |
| `weights` | Earned ensemble weight and rolling log loss of each component |
| `skill` | Rolling 2,000-round log-loss skill of the blend vs the base rate (nats/round, with SE) |

## Models (all online and strictly causal)

1. Empirical base rate (Dirichlet prior on the fair law)
2. Two-edge fair law, fitted by MLE: a point mass h0 below 1.01× plus S(x) = c/x above (MV6-6)
3. Recency-weighted empirical at half-lives 300, 2,000 and 10,000 rounds
4. Markov order 1 and order 2 on coarse bands
5. Streak state (run length above/below 2×)
6. Drought state (rounds since the last 10×)
7. Session and timing state (new session, previous interval)
8. Online multinomial logistic model (20 features: last values, streaks, rolling shares, droughts, interval, session start, hour of day)

The blend is a fixed-share Bayesian mixture on log loss: `w_k ← w_k · p_k(y)`, then a 0.01% share back to uniform. It tracks the best component, costs at most about log 11 ≈ 2.4 nats in total over any tape, and switches weight within a few hundred rounds if a component starts to earn skill.

## API

- `GET /api/v1/lib/forecast?source=aviator[&history=30000]` — the next-round forecast
- `GET /api/v1/lib/backtest?source=aviator[&last=5000]` — walk-forward backtest on the newest rounds

## Tests and backtest

```bash
cd functions
npm test                                     # 8 unit tests + 1 real-tape test when MOMENTO_TAPE is set
MOMENTO_TAPE=/path/master_aviator.csv npm test
npm run lib:backtest -- /path/master_aviator.csv [--last 3000] [--shuffle] [--out report.json]
```

The unit tests check coherence (bins sum to 1, survival falls with x, quantiles rise with q), fair-law recovery, causality (a future round can never change a past forecast), calibration on a fair tape, and detection of a planted signal (after a <1.2× round, P(≥2×) = 0.70). On that planted tape the forecaster reaches more than 0.01 nats/round of skill and an AUC above 0.55 at 2×.

## Results on the master Aviator tape (88,472 rounds, walk-forward, 83,472 scored)

| Metric | Lib | Base rate | Shuffled tape (Lib) |
|---|---|---|---|
| Log loss, 11 bins (nats) | 2.12536 | 2.12543 | 2.12510 vs 2.12513 |
| Skill vs base | +0.00007 ± 0.00005 | 0 | +0.00003 ± 0.00005 |
| v6 six-band log loss | 1.50440 | 1.50442 | — |
| AUC at 2× / 10× / 100× | 0.500 / 0.497 / 0.501 | 0.5 | 0.500 / 0.498 / 0.481 |
| Calibration at 2× (mean p vs hit rate) | 0.4853 vs 0.4850 | — | — |

Newest 3,000 rounds, v6 band log loss: Lib 1.5417, compared with 1.5493 for the v6.3 headline and 1.5415 for the constant forecaster (sub-book A2.9).

Every conditional component (Markov, streak, drought, session, logistic) scores worse than the base rate on its own, on both the real tape and a shuffled copy, by the same amount. The mixture drops them and settles on the fitted fair law. On this tape the best achievable forecast is the fitted law. The Lib forecaster reaches it and stays calibrated, and it would pick up a real dependence if one appeared (planted-signal test).
