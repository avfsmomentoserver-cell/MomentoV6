# Accuracy Engine v2

The Accuracy Engine makes accuracy itself a measured, compounding asset. Multi-window predictions are scheduled, stored before they land, resolved against the actual rounds history, and accumulated into a ledger that never resets — so accuracy figures stay exact from the first prediction to the millionth.

## The loop

1. **Schedule** — for every enabled window (15m · 1h · 4h · 1d · 7d) and threshold (2× · 5× · 10×), the engine keeps exactly one open prediction: the pipeline's probability that at least one round in the window clears the threshold. The full component breakdown (baseline / markov / streak / recent) is stored with the prediction.
2. **Resolve** — when the window matures, the engine counts the actual rounds in that window (`count(rounds WHERE ts IN window AND multiplier ≥ t)`), scores Brier and log-loss, and closes the prediction.
3. **Accumulate** — every resolution adds to the `accuracy_ledger` via O(1) running sums: n, Brier sum, baseline sum, log-loss sum, hits. Nothing is ever pruned — the accumulators scale to unlimited history.
4. **Earn weight** — per model, skill = baseline Brier − model Brier (weighted by blocks, aggregated across all windows and thresholds). Positive skill earns normalized weight in the pipeline; zero or negative skill earns nothing and the measured baseline governs.
5. **Verify at scale** — *Verify against full history* replays the entire dataset in honest, non-overlapping walk-forward blocks (each model sees only data strictly before its block), scores all models per window × threshold, and folds the blocks into the same ledger. This is O(n) per threshold, so it verifies at any scale.

## Scheduling

The scheduler runs twice over: a Durable Object alarm fires at the next due prediction (server-side, even with no browser open), and the dashboard's tick button / polling posts `/api/v1/accuracy/tick` as a second driver. Both paths feed the same single ledger. While the engine is on, the live round generator is kept fed so short windows always resolve on schedule.

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/accuracy/overview` | Totals, per-window scorecard, ledger, weights, history, open/recent predictions |
| POST | `/api/v1/accuracy/tick` | Run one scheduler tick now |
| POST | `/api/v1/accuracy/verify` | Walk-forward verification over full history; folds results into the ledger |
| GET/PUT | `/api/v1/accuracy/config` | Enabled windows + thresholds |
| GET | `/api/v1/accuracy/predictions?status&window&limit` | Scheduled prediction ledger |

## Tables

- `scheduled_predictions` — window, threshold, probability, components, created/due ms, resolution (actual, outcome rounds, Brier, log-loss).
- `accuracy_ledger` — accumulative running sums per (model, window, threshold). The unlimited-scale core.
- `engine_weights` — current earned skill + weight per model, recomputed on every resolution.
- `accuracy_history` — decimated cumulative accuracy points per window × threshold for the rolling chart (capped at 600 points; the ledger keeps full precision regardless).

## Reading it honestly

- A Brier **equal to baseline** is the expected outcome on a provably-fair series — the engine's job is to *prove* it continuously, not to manufacture lift.
- Positive lift, when it appears, is backed by resolved out-of-sample blocks only; the Range Lab reference verdicts from the 177,905-round archive dataset remain the prior.
- Hit rate is directional (predictions ≥50% that landed). It is a sanity check, not the skill metric — Brier is.
