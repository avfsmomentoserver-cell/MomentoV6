# ShapeShifters & Darkboard

The ShapeShifters math (from `shapeshifters-repo/backend/src/lib/math_models.py` and GROUPED_ETA_PREDICTOR.md, both in the original archives) is ported to TypeScript and computed server-side in `functions/analysis.ts`.

## Ported components

- **Curve anatomy** — log-slope, acceleration, skewness/kurtosis moments, shape classification (exponential / power_law / bimodal / uniform / clustered).
- **Pareto distribution** — MLE fit (α = n / Σ ln(x/x_m)), KS goodness-of-fit with asymptotic p-value, survival function.
- **Streak analysis** — 2×2 Markov transition matrix, continuation probability, expected duration (geometric).
- **Dry-zone predictor** — rolling mean (window 50) below threshold (2.0×), severity score.
- **ETA estimator** — conditional survival P(X > t | X > s) = (s/t)^α, 95% inverse-survival bands, ETA to target via geometric waiting time.
- **Trajectory groups** — six band groups with the GROUPED_ETA regime methodology.
- **House-edge correction** — 4% default, recomputed live from the observed mean.

## The Darkboard (`/dashboard/darkboard`)

Four research screens, exactly as in the web-live archive:

1. **Live Shape Feed** — the curve over the recent window with live anatomy annotations.
2. **Shape Atlas** — Pareto fit details and the ETA bands.
3. **Trajectory Groups** — the six regime groups with the live group highlighted.
4. **Build Plan & Library** — what shipped, what was verified, links to the labs.

## Verification (inherited, honest)

Every conditional predictor was evaluated walk-forward on the merged dataset with a 300-round warmup: weights fit on the train half only, scored on the held-out test half (88,803 rounds) against the constant baseline. Verdict: no conditional methodology beats the baseline at this sample size (ensemble mean lift −0.29%). All are shipped measured-but-down-weighted (earned weight 0). Calibration itself is verified — reliability bins match observed frequencies.
