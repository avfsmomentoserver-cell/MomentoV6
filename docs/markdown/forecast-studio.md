# Forecast Studio & Range Lab

## The honesty contract

1. Every forecast is **stored server-side before the round lands** (`POST /api/v1/forecasts/record`).
2. When the round arrives, open forecasts are scored against the recorded value: `actual = multiplier ≥ threshold`, `brier = (p − actual)²`.
3. Accuracy figures therefore describe real predictive performance — nothing can be back-dated, and unrecorded forecasts do not count.

Forecast Studio (`/dashboard/studio`) records forecasts, lists open ones, resolves them against the latest round, and shows per-model Brier scores. The consumer Pro Predictions page (`/app/pro`) uses the same endpoints.

## Walk-forward protocol (Range Lab)

- Dataset split: warmup 300 → train half → held-out test half (on the full merged dataset: 88,803 test rounds).
- Every conditional model (markov-1, markov-2, streak, gap, EWMA α=0.02, trigram, ensemble) is fit on the train half only.
- Scored on the test half with the Brier rule against the **constant baseline** (the train-half rate).
- A model is accepted only if it beats the baseline by more than 0.5%; otherwise its earned weight is zero.

## The verdict

On the merged 177,905-round dataset, **no conditional methodology beats the baseline**. Reference verdicts per threshold (from RANGE_LAB_REPORT.md, embedded in the API as `/api/v1/range-lab`):

| threshold | rate | Brier base | lift | verdict |
|---|---|---|---|---|
| 2× | 50.4651% | 0.25050 | −0.32% | rejected |
| 10× | 9.2167% | 0.08722 | −0.10% | rejected |
| 100× | 0.9410% | 0.00967 | −0.01% | rejected |

All twelve thresholds are listed on the Range Lab page alongside the live recomputation over the database. Calibration itself *is* verified: reliability bins match observed frequencies (when the engine says 50%, it clears ~50% of the time). Calibration ≠ clairvoyance — both facts ship on purpose.

## What is shipped

The live forecast is the **measured exceedance rate with its Wilson CI**. Conditional adjustments apply with earned weight only. Range Lab (`/dashboard/range-lab`) renders both the reference table and the live re-run; Investigation Suite (`/dashboard/investigation`) can launch ad-hoc walk-forward runs and keeps the history.
