# 18 · Feature Invention Catalogue

There are 38 features here. Each one is built from parts that already exist in the repos, uses the technique from its subsystem chapter, and ships with a measurement plan, so the platform's own ledger decides whether the feature works. Every feature has the same spec block:
- **problem:** what is wrong or missing today, with the finding it fixes where one exists;
- **mechanics;**
- **data** (tables in Appendix A);
- **API;**
- **UI** (workspaces from Ch 16);
- **measurement:** the number that says it works;
- **depends on.**

**Legend.** Effort: S (≤ 1 week), M (2–4 weeks), L (1–2 months). Priority: P1 = build first (foundation or highest leverage), P2 = next, P3 = later.

## 18.1 Summary index
| ID | Feature | Area | Builds on | Effort | Priority |
|---|---|---|---|---|---|
| F-01 | Tape Integrity Score | Data | watcher, ingest, `medianIntervalMs` | S | **P1** |
| F-02 | Multi-collector consensus | Data | collectors, dedupe | M | P2 |
| F-03 | Source fingerprinting | Data | randomness battery | M | P2 |
| F-04 | Time-travel queries (`as_of`) | Platform | event-sourced ledgers | M | **P1** |
| F-05 | Per-source DO sharding and federated view | Platform | core.ts DO | M | P2 |
| F-06 | Living Dictionary | Linguistics | `vocabulary` lifecycle | S | P2 |
| F-07 | Sequence search | Linguistics | DNA tokens | M | P2 |
| F-08 | Narrated replay | Linguistics | Layer-8 sentences | S | P3 |
| F-09 | Engine Workbench | Analysis | all engines, `backtest_runs` | M | P2 |
| F-10 | Cross-source comparator | Analysis | engines, Wilson | S | P3 |
| F-11 | Signal significance strip | Analysis | signals, BH | S | **P1** |
| F-12 | Engine Marketplace / registry | Forecast | `plugins`, earned mixture | M | **P1** |
| F-13 | Regime-aware weights | Forecast | state machine, HMM | M | P2 |
| F-14 | Forecast diff | Forecast | intel_calibrations | S | P2 |
| F-15 | Distribution explorer (fan chart) | Forecast | per-engine dists | S | P2 |
| F-16 | Counterfactual engine toggle | Forecast | ledger replay | M | P3 |
| F-17 | Reliability Studio | Accuracy | ledger + bin sums, PIT | M | **P1** |
| F-18 | Tamper-evident track record | Accuracy | hash chain | S | **P1** |
| F-19 | Accuracy gates per product tier | Accuracy | engine_weights | S | P2 |
| F-20 | Auto-demotion and alerts | Accuracy | ledger | S | P2 |
| F-21 | Forecast cone on chart | Terminal | Lightweight Charts | S | **P1** |
| F-22 | Drawn predictions (competitive predictor) | Terminal / Consumer | scheduled_predictions | L | **P1** |
| F-23 | Multi-source terminal | Terminal | F-05 | M | P3 |
| F-24 | Replay mode | Terminal | F-04 | M | P2 |
| F-25 | Anchor alerts | Terminal | momentum.ts anchors | S | P3 |
| F-26 | ETA Board | Survival | KM, hazard model | M | **P1** |
| F-27 | Hazard timeline | Survival | F-26 | S | P2 |
| F-28 | ETA alerts | Survival | F-26, F-38 | S | P2 |
| F-29 | In-round live ETA | Survival | Nelson–Aalen, growth law | M | P3 |
| F-30 | Decision Ledger and producer leaderboard | Decisions | autopilot_decisions | M | **P1** |
| F-31 | Auto-Tells v2 | Decisions | V6 AutoTellSignal, Kelly, guard | L | P2 |
| F-32 | Bankroll Simulator | Decisions | ev.py, bootstrap | M | P2 |
| F-33 | Session Coach | Decisions | Guard engine, Layer 8 | M | P2 |
| F-34 | Experiment Registry | Research | edge-falsification suite, MKI | L | **P1** |
| F-35 | Explain-this-forecast | Research | decomputation | M | **P1** |
| F-36 | Fairness Console | Fairness | fairness.py | M | P2 |
| F-37 | Ask Momento (MKI assistant) | Knowledge | MKI, ranked + vector search | M | P3 |
| F-38 | Alerts Center | UX | all engine outputs | M | P2 |

---

## 18.2 Data features

### F-01 · Tape Integrity Score (P1, S)
- **Problem.** The canonical tape shows P(≥ 2)·2 ≈ 1.009 (Ch 01). That points to missed low rounds, which bias every probability. Today, gaps, collector errors and duplicates are invisible to the forecast layer.
- **Mechanics.** Per session:
  - (a) **completeness** = observed / (observed + est_missing), where a gap is Δt > 2.5 × the session's median interval, and est_missing = Σ round(Δt/median) − 1 over gaps;
  - (b) **low-share z**: the observed share of rounds below 1.2× vs the long-run reference, with a Wilson CI;
  - (c) the **fairness recompute match rate**, where seeds exist (Ch 13);
  - (d) **collector agreement** (F-02).

  Integrity = weighted geometric mean of the four components in [0, 1]. A missing component gets weight 0 and is not scored as 1.
- **Data.** `tape_gaps(source_id, session_id, from_ts, to_ts, est_missing)`, `session_quality(session_id, completeness, low_share_z, fair_match, agreement, integrity)`, `ingest_quarantine` for rejected rows with `reject_reasons`.
- **API.** `GET /api/v1/integrity?source=&session=` → per-session components. `GET /api/v1/integrity/summary?source=&days=`.
- **UI.** Ops › Tape Integrity: a session heat-strip coloured by integrity, with a click-through to gaps. An integrity chip sits on every chart and forecast card.
- **Void rule.** Ledger windows overlapping a gap with est_missing ≥ 1 are **void** and are not scored as misses (Ch 08 finding V3).
- **Measurement.** Train the mixture with sessions filtered to integrity ≥ 0.95, and compare held-out log-score skill with and without the filter (Ch 07). Also: the share of voided windows per day.
- **Depends on.** Ingest validation (Ch 03).

### F-02 · Multi-collector consensus (P2, M)
- **Problem.** One collector means one point of failure. A DOM collector that misreads 1.00 as 1.0 or misses a round silently corrupts the tape.
- **Mechanics.**
  - Run two independent collectors per source (WebSocket and DOM), each signed with its own key (Ch 17).
  - Reconcile within a 1 s window by (source, ts ± 1 s, value).
  - Agreement → consensus row. Single-collector rows → provisional. Value disagreement → quarantine plus fairness recompute (Ch 13) as tie-breaker.
  - The consensus tape wins, and each row stores `collector` and `batch_id`.
- **Data.** `rounds.collector`, `rounds.batch_id`, `round_links(round_id, collector, raw_value, raw_ts)`, `ingest_quarantine`.
- **API.** `GET /api/v1/collectors?source=` returns uptime, lag and agreement. `GET /api/v1/collectors/disagreements?source=`.
- **UI.** Ops › Sources shows the collector card per source.
- **Measurement.** Disagreement rate < 0.1% of rounds, and the share of rounds confirmed by ≥ 2 collectors.
- **Depends on.** F-01, signed ingest (Ch 17 S-1).

### F-03 · Source fingerprinting (P2, M)
- **Problem.** A source can change its algorithm, house edge or collector format without notice. Every engine then silently trains on a mixture of two regimes.
- **Mechanics.** Run the nightly corrected randomness battery (Ch 13 §13.3.4, discrete-law PIT) plus band shares and the house-edge estimate per source. Run a two-sided CUSUM on each statistic, with thresholds set to give an average run length of about 1 year under the null. An alert fires on a sustained shift. When the operator confirms the shift, a new fingerprint epoch starts and engines use the epoch as a covariate or a restart.
- **Data.** `fairness_runs(source_id, date, test, statistic, p, n)`, `source_epochs(source_id, epoch, from_ts, reason)`.
- **API.** `GET /api/v1/fingerprint?source=`.
- **UI.** Proof › Fairness Console shows the fingerprint tab with CUSUM charts.
- **Measurement.** Median detection delay on injected synthetic shifts (for example a house edge moving from 3% to 4%), and the false-alarm rate on shuffled tapes.
- **Depends on.** Ch 13 battery fixes.

### F-04 · Time-travel queries, `as_of` (P1, M)
- **Problem.** Analyses always run on "now", so no one can see what the platform said at a past moment, and `calibrateIntel` reconstructs past forecasts after the fact (Ch 08 finding V4).
- **Mechanics.**
  - Every analysis endpoint accepts `as_of=ts_ms` and computes on `rounds WHERE ts_ms < as_of AND ingested_ms < as_of`. The second condition excludes late-arriving rows.
  - Forecasts are read from stored rows with `created_ms ≤ as_of`, never recomputed.
  - `analysis_snapshots` are cached per 100 rounds for speed.
- **Data.** `rounds.ingested_ms`, `round_corrections` (append-only edits), `analysis_snapshots(source_id, round_id, state_json)`.
- **API.** `?as_of=` on `/analysis`, `/intelligence/forecast`, `/eta/board`, `/accuracy/*`.
- **UI.** A global time control in the TopBar ("viewing as of …"), with a banner while it is active.
- **Measurement.** Property test: `f(as_of = t)` equals the forecast stored at t for 1,000 random t, with 0 mismatches.
- **Depends on.** Ingest timestamps, stored forecasts (Ch 08).

### F-05 · Per-source DO sharding and federated view (P2, M)
- **Problem.** v6.3 keeps every source in one DO, so throughput, storage and failure domains are shared.
- **Mechanics.**
  - Use `idFromName(source)`: one DO per source.
  - A Directory DO holds the source list and routing.
  - Federated queries (all sources) fan out with `Promise.all`, merge, and cache for 5 s.
  - Cross-source features (F-10, F-23) read the federated view.
- **Data.** Per-DO schema unchanged; `_schema` version table per DO; `source_aggregates` in the Directory.
- **API.** Unchanged paths. `source=all` triggers fan-out.
- **UI.** None directly. It enables F-23.
- **Measurement.** p95 latency stays flat as sources grow from 1 to 20 (synthetic), and one source's failure leaves the others healthy.
- **Depends on.** Ch 03 DO design.

## 18.3 Linguistics features

### F-06 · Living Dictionary (P2, S)
- **Problem.** Vocabulary tokens exist in a table, but their evidence (lift, CI, lifecycle history) is not visible, so users cannot tell a proven token from a candidate.
- **Mechanics.** Each token gets a page showing:
  - definition and layer;
  - lifecycle state (candidate → validated → formalised → deprecated), synced to MKI `glossary_term` (Ch 14);
  - forward outcome lift vs base rate with a Wilson CI and BH q-value;
  - n and a timeline of state changes;
  - example occurrences.

  Formalisation requires q < 0.05 on a held-out block (Ch 05).
- **Data.** `vocabulary` + `vocabulary_evidence(token_id, block, n, hits, lift, lo, hi, q)`.
- **API.** `GET /api/v1/vocabulary/{id}/page`.
- **UI.** Lab › Dictionary.
- **Measurement.** Vocabulary precision: the share of formalised tokens whose lift CI still excludes 1 on the next block.
- **Depends on.** Ch 05 lifecycle, F-34.

### F-07 · Sequence search (P2, M)
- **Problem.** Users ask "what happened after this pattern before?". DNA matching answers with a single band triplet and no base rate (49.32% vs 84.12% base, Appendix D).
- **Mechanics.**
  - Index band-token n-grams (n ≤ 8) using a suffix array over the token string, per source.
  - A query returns the occurrence count and the next-k outcome distribution against the unconditional base rate, with Wilson CIs.
  - Every result shows "no different from base rate" when the CI overlaps.
- **Data.** `token_index` (suffix array blob per source, rebuilt nightly plus an incremental tail).
- **API.** `GET /api/v1/sequence/search?pattern=&k=&source=`.
- **UI.** Lab › DNA: a pattern builder, occurrences on a timeline, and an outcome bar vs base.
- **Measurement.** Query p95 < 200 ms on 250k rounds, plus the share of queries with a significant result (expected to be about α on a fair tape).
- **Depends on.** Ch 05 tokens.

### F-08 · Narrated replay (P3, S)
- **Problem.** Replay (F-24) shows bars, but newcomers need the story.
- **Mechanics.** Show the Layer-8 sentence for each bar during replay. The Narrator (Ch 15) may rephrase, but every number must come from the input (numbers checker).
- **Data.** None new; it reads `linguistics` output per `as_of`.
- **API.** `GET /api/v1/linguistics?as_of=`.
- **UI.** A caption track in Terminal › Replay.
- **Measurement.** Qualitative (user rating), plus Narrator rejection rate < 1%.
- **Depends on.** F-24, Ch 05.

## 18.4 Analysis and forecast features

### F-09 · Engine Workbench (P2, M)
- **Problem.** Engine parameters are hard-coded. Trying a variant means editing code.
- **Mechanics.**
  - A parameter form per engine, generated from a JSON schema in the registry.
  - Run on a chosen slice (source, dates, sessions) with the causal runner.
  - Save to `backtest_runs` and compare runs side by side (log-score skill with CI, reliability).
  - SHAP shown only for engines with positive skill (Ch 15).
  - Every run counts toward the family for BH (Ch 12).
- **Data.** `backtest_runs(id, engine, params_json, slice_json, metrics_json, created_ms, created_by)`.
- **API.** `POST /api/v1/workbench/run`, `GET /api/v1/workbench/runs`.
- **UI.** Lab › Engine Workbench.
- **Measurement.** Runs per week, and the share of runs that are later registered as experiments.
- **Depends on.** F-12, F-34.

### F-10 · Cross-source comparator (P3, S)
- **Problem.** "Is source A different from source B?" is asked often and answered by eye.
- **Mechanics.** The same statistic on two sources (band share, house edge, gap distribution, engine skill), compared with a two-proportion z-test or a log-rank test for gaps, with a CI on the difference.
- **Data.** Reads `source_aggregates`.
- **API.** `GET /api/v1/compare?a=&b=&metric=`.
- **UI.** Lab › Compare.
- **Measurement.** On a pair of simulated identical sources, the false-difference rate ≈ α.
- **Depends on.** F-05.

### F-11 · Signal significance strip (P1, S)
- **Problem.** 14 signals are shown as if they were meaningful. None has a displayed CI, and pressure ≥ 70 gives +3.53% (not significant; Appendix D).
- **Mechanics.** For each signal reading, compute its trailing conditional lift on the target band, a Wilson CI and a BH q-value across all 14. Render a compact strip: bar = lift, whisker = CI, colour only when q < 0.05. Otherwise the bar is grey and marked "no evidence".
- **Data.** `signal_stats(source_id, signal, state, n, hits, lift, lo, hi, q, updated_ms)`.
- **API.** `GET /api/v1/signals/significance?source=`.
- **UI.** Now › Command Center, directly under the signal list.
- **Measurement.** The share of "significant" signals that stay significant on the next block (target ≥ 80%), and the displayed-significant rate on a shuffled tape (target ≈ 5%).
- **Depends on.** Ch 06 signals, Ch 12 BH.

### F-12 · Engine Marketplace / registry (P1, M)
- **Problem.** Engines are wired into code, weights come from backtests with fixed blocks (Ch 08 V2), and stub engines can look real (Ch 15 A1).
- **Contract.**
  ```ts
  interface Engine { key: string; version: string; predict(rounds: Round[], ctx: Ctx): number[] /* 6 bands */;
                     abstain?(rounds: Round[]): boolean; prior: number; owner: string; paramsSchema?: object }
  ```
- **Mechanics.**
  - Registered engines join the earned mixture (Ch 07) at their prior. Abstaining engines are **sleeping experts**.
  - A leaderboard ranks engines by trailing log-score skill with a block-bootstrap CI.
  - **Admission:** passes causality, null-tape and determinism tests (`no_stub_engines`).
  - **Lifecycle:** shadow → live → demoted (F-20).
  - Candidates include TSFM (Chronos-2), HMM-regime, hazard, user-submitted and STRIDE (after fixes).
- **Data.** `engines(key, version, owner, state, prior, created_ms)`, `engine_weights`, per-engine dists stored with each forecast.
- **API.** `GET /api/v1/engines`, `POST /api/v1/engines` (register), `POST /api/v1/engines/{key}/state`.
- **UI.** Lab › Engines, with a ledger card per engine.
- **Measurement.** Mixture skill before vs after each engine joins, as an A/B on alternating rounds.
- **Depends on.** Ch 07, Ch 08.

### F-13 · Regime-aware weights (P2, M)
- **Problem.** One set of weights for all conditions may hide engines that are good only in some regimes.
- **Mechanics.**
  - Weights W[c | state], where state is the momentum state machine (Ch 09) or the filtered HMM regime (Ch 15).
  - Each cell earns separately and shrinks to the global weight with strength ∝ 1/n_cell.
  - Regimes count as "real" only if they beat global weights out of sample.
- **Data.** `mix_state(source_id, regime, engine, weight, n)`.
- **API.** `GET /api/v1/mixture?source=&by=regime`.
- **UI.** Lab › Engines › Regimes tab.
- **Measurement.** Held-out mixture skill Δ vs global weights, with CI.
- **Depends on.** F-12, Ch 15 HMM.

### F-14 · Forecast diff (P2, S)
- **Problem.** Users see the forecast change without knowing why.
- **Mechanics.** A diff of the current vs the previous forecast: headline Δ (expected, range, reach) and the top 3 engines by Δ contribution (w_c·Δdist_c projected onto the headline), plus weight changes.
- **Data.** Stored forecasts with per-engine dists.
- **API.** `GET /api/v1/forecast/diff?source=&from=&to=`.
- **UI.** A "what changed" link on the forecast card.
- **Measurement.** Usage, and a reduction in "why did it change" questions.
- **Depends on.** F-04.

### F-15 · Distribution explorer (P2, S)
- **Problem.** A headline hides the distribution. Users need to see the tail.
- **Mechanics.** A fan chart of the mixture's 6-band (or 20-band) distribution with each engine's line, a log x-axis and the base-rate line.
- **Data.** Per-engine dists.
- **API.** `GET /api/v1/intelligence/distribution?source=`.
- **UI.** Now › Full Intelligence.
- **Measurement.** Engagement.
- **Depends on.** Ch 07.

### F-16 · Counterfactual engine toggle (P3, M)
- **Problem.** An engine's marginal value is unknown.
- **Mechanics.** Recompute the ledger's log-score without engine c, renormalising the remaining weights on stored per-engine dists. No rerun is needed.
- **Data.** Stored per-engine dists.
- **API.** `GET /api/v1/accuracy/counterfactual?without=`.
- **UI.** Lab › Engines: a toggle per engine.
- **Measurement.** It shows each engine's marginal value, with CI.
- **Depends on.** F-12.

## 18.5 Accuracy features

### F-17 · Reliability Studio (P1, M)
- **Problem.** Accuracy is shown as one Brier number, with an inflated window baseline (Ch 08 V1) and no reliability view.
- **Mechanics.**
  - 10-bin running sums per (model, window, threshold) in `reliability_bins`.
  - Randomised PIT histogram per engine.
  - Brier skill with the Murphy decomposition (reliability, resolution, uncertainty).
  - ACI coverage tracking for the Range (Ch 08).
  - A block-bootstrap CI on every skill number.
- **Data.** `reliability_bins`, `conformal_state`.
- **API.** `GET /api/v1/accuracy/reliability?model=&threshold=`, `/pit`, `/coverage`.
- **UI.** Proof › Reliability Studio.
- **Measurement.** Coverage error |observed − 50%| for the p25–p75 range ≤ 2 pp after ACI is switched on.
- **Depends on.** Ch 08 fixes V1–V4.

### F-18 · Tamper-evident track record (P1, S)
- **Problem.** Without proof, a forecast history can be suspected of being edited.
- **Mechanics.**
  - hash_i = sha256(hash_{i−1} ‖ canonical_json(prediction_row_at_creation)).
  - The head hash is published daily (public page and an optional commit to a `momento-ledger` repo).
  - The verifier page recomputes the chain from exported rows.
  - Outcomes are chained as separate resolution rows.
- **Data.** `ledger_chain(seq, forecast_id, row_hash, prev_hash, created_ms)`.
- **API.** `GET /api/v1/ledger/head`, `GET /api/v1/ledger/export?from=`.
- **UI.** Proof › Track record, with a "verify" button.
- **Measurement.** Chain verification passes nightly in CI, and after every restore (Ch 17).
- **Depends on.** Ch 08 §8.4.6.

### F-19 · Accuracy gates per product tier (P2, S)
- **Problem.** Consumer cards can show producers with no proven skill.
- **Mechanics.** Consumer and Premium cards show only producers whose skill CI lower bound > 0 at n ≥ 300. Otherwise the baseline card is shown, clearly labelled "base rate".
- **Data.** `engine_weights` + skill CI.
- **API.** Server-side filter in `/app/*`.
- **UI.** The consumer app.
- **Measurement.** The share of consumer cards backed by skill > 0, and the realised skill of displayed producers.
- **Depends on.** F-17.

### F-20 · Auto-demotion and alerts (P2, S)
- **Problem.** An engine that degrades keeps its weight until someone notices.
- **Mechanics.** If trailing-N Brier skill < 0 with 95% confidence (upper CI bound < 0), the engine's weight is set to the floor, an alert is raised and an MKI `decision` is recorded (Ch 14). Re-promotion goes through shadow mode.
- **Data.** `engines.state`, `alerts`.
- **API.** Internal job. `GET /api/v1/engines/{key}/history`.
- **UI.** A notification, and history on the engine card.
- **Measurement.** Time to demote an injected bad engine.
- **Depends on.** F-12, F-17.

## 18.6 Terminal features

### F-21 · Forecast cone on chart (P1, S)
- **Problem.** Forecasts live in panels, separate from the chart the user watches.
- **Mechanics.** Extend the points chart with whitespace bars for h+1…h+5. Draw p25–p75 as a filled band and p90 as a dashed line using a custom series (Lightweight Charts). ETA markers for 10× and 50× sit at their KM conditional medians (F-26).
- **Data.** Forecast quantiles per horizon.
- **API.** `GET /api/v1/intelligence/cone?source=&h=5`.
- **UI.** Terminal › Charts.
- **Measurement.** Visual coverage (the share of the next 5 rounds inside the cone matches the stated quantiles), plus engagement.
- **Depends on.** Ch 07 quantiles, Ch 16 charts.

### F-22 · Drawn predictions and the competitive predictor (P1, L)
- **Problem.** Users form their own views but have nowhere to record or score them. The V6 spec's "Competitive Predictor App" (§3.5) was never built.
- **Mechanics.**
  - A user draws a level (for example 5×) and a window (for example 30 min) or a round count.
  - That creates a `scheduled_predictions` row with `model = user:<id>` and a user-entered probability (a slider, default = engine mixture).
  - It resolves exactly like engine predictions.
  - Users are scored by **log-score skill vs the mixture**, so beating the platform is the achievement.
  - Leaderboards: daily, weekly and all-time, with a minimum of n = 30 to rank.
- **Data.** `scheduled_predictions`, `user_scores(user_id, period, n, skill, lo, hi)`.
- **API.** `POST /api/v1/predictions` (from a drawing), `GET /api/v1/leaderboard?period=`.
- **UI.** A drawing tool in Terminal and in the consumer Charts tab. A profile page shows each user's own reliability diagram.
- **Measurement.** DAU and retention. Report the number of users with positive skill next to the number expected by chance (simulated users who copy the mixture with noise).
- **Depends on.** F-18, F-21, Ch 09 `drawingToPrediction`.

### F-23 · Multi-source terminal (P3, M)
- **Problem.** Users who follow several sources switch tabs.
- **Mechanics.** A grid of 2–4 synced charts with a shared crosshair and time axis, plus a per-source forecast card.
- **Data.** Federated view (F-05).
- **API.** `source=all` fan-out.
- **UI.** Terminal › Multi.
- **Measurement.** Usage, and render p95 with 4 sources.
- **Depends on.** F-05.

### F-24 · Replay mode (P2, M)
- **Problem.** No way to study what the platform showed during a past session.
- **Mechanics.** Bar-by-bar scrub (play, pause, 1–50× speed) using `as_of` (F-04), with the forecasts stored at each point rather than recomputed.
- **Data.** `analysis_snapshots`, stored forecasts.
- **API.** `GET /api/v1/replay?source=&from=&to=` (streamed).
- **UI.** Terminal › Replay.
- **Measurement.** Replay equals the stored history (property test).
- **Depends on.** F-04.

### F-25 · Anchor alerts (P3, S)
- **Problem.** Anchors (Ch 09) are shown, but only for users who happen to be watching.
- **Mechanics.** A push notification when an anchor forms or is released, filtered by size. The alert text states the measured base rate of the following outcome. Anchors make up 33.3% of rounds on a null tape (Ch 09 M3), so the text must not imply an edge.
- **Data.** `alerts`.
- **API.** Via F-38.
- **UI.** Alert rule presets.
- **Measurement.** Alert open rate, and user-rated usefulness.
- **Depends on.** F-38, Ch 09 fixes.

## 18.7 Survival features

### F-26 · ETA Board (P1, M)
- **Problem.** "Overdue" labels fire 70.9% of the time on a null tape, and pressure reads 99 about 25% of the time (Ch 10 findings P1, P2).
- **Mechanics.** For each threshold T in {2, 5, 10, 20, 50, 100}×:
  - current gap g, and the KM percentile of g (the redefined "pressure");
  - conditional median and p90 ETA from S(g + k)/S(g);
  - a covariate-adjusted ETA from the discrete logistic hazard, shown only while its held-out log-likelihood beats KM;
  - the memorylessness test result (β₁ with CI) as a badge.
- **Data.** `gap_state`, `km_cache`, `hazard_models`, `eta_forecasts`.
- **API.** `GET /eta/board?source=`, `GET /eta/hazard?source=&T=`.
- **UI.** Now › ETA Board.
- **Measurement.** Median-ETA calibration (share of events before the stated median ≈ 50%) and integrated Brier vs KM.
- **Depends on.** Ch 10.

### F-27 · Hazard timeline (P2, S)
- **Problem.** Users want to see how the conditional chance evolves, not just a number.
- **Mechanics.** A per-round conditional hazard h_T(g) for T = 10× as a chart overlay, with the unconditional rate as a reference line. On a memoryless tape the line is flat.
- **Data.** `eta_forecasts`.
- **API.** `GET /eta/hazard?source=&T=10&series=1`.
- **UI.** Terminal overlay.
- **Measurement.** Calibration of the hazard line (reliability of the per-round probability).
- **Depends on.** F-26.

### F-28 · ETA alerts (P2, S)
- **Problem.** Users watch the board waiting for a condition.
- **Mechanics.** Alert when a KM percentile or hazard crosses a user rule, with debounce. The alert carries the calibrated probability, not a directive.
- **Data.** `alerts`.
- **API.** Via F-38.
- **UI.** A rule preset on the ETA Board.
- **Measurement.** Alert precision (user-rated), and calibration of the probabilities in alerts.
- **Depends on.** F-26, F-38.

### F-29 · In-round live ETA (P3, M)
- **Problem.** While a round is running, users want P(reach x | now at m₀).
- **Mechanics.** Live in-round survival from m₀: under the multiplier law, P(M ≥ x | M ≥ m₀) = m₀/x, and the time to reach x is t(x) ≈ 16.67·ln x seconds (Ch 10 `reachCurve`). Refine with Nelson–Aalen on the observed exits if the source deviates from the law.
- **Data.** `inround_state` (transient).
- **API.** `GET /eta/inround?source=&m0=` (or push over the socket).
- **UI.** A live gauge on the Now workspace.
- **Measurement.** Calibration on in-round exits.
- **Depends on.** Ch 10, real-time push (Ch 16).

## 18.8 Decision features

### F-30 · Decision Ledger and producer leaderboard (P1, M)
- **Problem.** Autopilot decisions depend on polling frequency, ignore horizon and use self-reported confidence (Ch 11 findings D2–D5). No unified record exists.
- **Mechanics.**
  - Every decision producer (autopilot, Auto-Tells, users) writes the unified `Decision` record (Ch 11).
  - The ledger shows per producer: n, hit rate vs target base rate (Δ with CI), P&L per 100 decisions with CI, drawdown and guard vetoes.
  - Only producers with n ≥ 30 are ranked.
- **Data.** `decisions`.
- **API.** `GET /api/v1/decisions?producer=`, `GET /api/v1/decisions/leaderboard`.
- **UI.** Proof › Decision Ledger.
- **Measurement.** Ledger counts reconcile against `autopilot_decisions` with 0 mismatches.
- **Depends on.** Ch 11, F-18.

### F-31 · Auto-Tells v2 (P2, L)
- **Problem.** The V6 AutoTellSignal sized from self-reported confidence.
- **Mechanics.** AutoTellSignal with:
  - p from the ledger (Wilson lower bound at n ≥ 100);
  - fractional Kelly f = κ·(p·x − 1)/(x − 1), with κ ≤ 0.25, and f = 0 whenever p·x ≤ 1;
  - a tier cap;
  - a Guard veto;
  - reasons attached.

  Each tell is a Decision row.
- **Data.** `decisions`.
- **API.** `GET /api/v1/tells?source=`.
- **UI.** Now panel.
- **Measurement.** Its producer row in F-30.
- **Depends on.** F-30, Ch 11 `stakeFor`.

### F-32 · Bankroll Simulator (P2, M)
- **Problem.** Users cannot see what a strategy does over many sessions.
- **Mechanics.** Block-bootstrap real sessions × strategy → equity fan (p5, p50, p95), probability of ruin, drawdown distribution and cap hits. Closed forms from `ev.py` serve as a check.
- **Data.** Reads the tape.
- **API.** `POST /api/v1/simulate {strategy, sessions, bankroll}`.
- **UI.** Lab › Simulator.
- **Measurement.** Matches `ev.py` closed forms on a synthetic check (mean within MC error).
- **Depends on.** Ch 11 simulator.

### F-33 · Session Coach (P2, M)
- **Problem.** Limits exist in settings but are not surfaced during a session.
- **Mechanics.** Guard engine state plus cap utilisation become live guidance sentences (Layer 8 style). Examples: "cap 74% used", "session length 2.1× your usual".
- **Data.** `decisions`, user settings.
- **API.** Socket message `coach`.
- **UI.** A side panel.
- **Measurement.** The share of sessions ending by guard vs by stop-loss, and user-set limit adherence.
- **Depends on.** F-30.

## 18.9 Research, fairness, knowledge and UX features

### F-34 · Experiment Registry (P1, L)
- **Problem.** Research results live in branches and markdown. `train.py` early-stops on the test fold (Ch 12 R1).
- **Mechanics.**
  1. YAML spec.
  2. Causal runner (Δt firewall) with a **planted power check**.
  3. Metrics vs base rate and a shuffle baseline.
  4. p → BH q across the family → verdict.
  5. MKI lifecycle update (automatic up to `validating`) and engine registration into shadow mode.

  The UI accepts a plain-English hypothesis. The Researcher agent drafts the spec, which a person approves.
- **Data.** `experiments`, MKI objects.
- **API.** `POST /api/v1/experiments`, `GET /api/v1/experiments/{id}`.
- **UI.** Lab › Experiments.
- **Measurement.** Promotion precision ≥ 80% (promoted engines keep skill > 0 in shadow).
- **Depends on.** Ch 12, Ch 14.

### F-35 · Explain-this-forecast (P1, M)
- **Problem.** Forecasts are opaque. The decomputation branch has the dimensions, but no UI.
- **Mechanics.** For the current forecast, show:
  - the 8 decomputation dimensions (Ch 12);
  - an engine contribution waterfall, where engine c's contribution is w_c·(dist_c − dist_baseline) projected onto the headline median;
  - "what would change it": the signals closest to flipping state.

  The Narrator writes a sentence, checked by the numbers checker.
- **Data.** `forecast_explanations(forecast_id, json)`.
- **API.** `GET /api/v1/forecast/{id}/explain`.
- **UI.** The "why" chip on every forecast card.
- **Measurement.** "Why" is opened on ≥ 20% of forecasts viewed, and support questions go down.
- **Depends on.** F-12, Ch 12 decomputation.

### F-36 · Fairness Console (P2, M)
- **Problem.** The verifier exists, but runs only on demand. The KS test rejects fair tapes at scale (Ch 13 F1).
- **Mechanics.**
  - A convention solver with k ≥ 3 intersection at onboarding.
  - Continuous per-round verification, chain-depth monitoring and the nightly corrected battery with BH.
  - House edge measured with a CI.
  - A "verify any round" box.
- **Data.** `round_fairness`, `fairness_runs`.
- **API.** `/fair/*` (Ch 13 §13.4).
- **UI.** Proof › Fairness.
- **Measurement.** Verified share per source (> 99.9% where seeds are revealed), and the battery false-alarm rate ≈ α.
- **Depends on.** Ch 13.

### F-37 · Ask Momento (P3, M)
- **Problem.** Knowledge about why things are the way they are lives in commits and chats.
- **Mechanics.** RAG over MKI. Retrieval is ranked full-text plus pgvector, fused with RRF (Ch 14). Answers must cite MKI object ids, and each object cites a commit. Answers that cite nothing are refused.
- **Data.** MKI.
- **API.** `GET /knowledge/ask?q=`.
- **UI.** A ⌘K "Ask" mode.
- **Measurement.** Citation validity 100%, and MRR on the scripted query set.
- **Depends on.** MKI backlog 2.2.

### F-38 · Alerts Center (P2, M)
- **Problem.** Every feature invents its own notification.
- **Mechanics.**
  - A rule builder on any engine output: field, operator, value, source and horizon.
  - Channels: push, email and Telegram.
  - Debounce, quiet hours and a per-user daily cap.
  - Every alert links to the forecast card that triggered it and carries its calibrated probability.
- **Data.** `alert_rules`, `alerts`.
- **API.** `POST /api/v1/alerts/rules`, `GET /api/v1/alerts`.
- **UI.** Ops › Alerts, plus a bell in the TopBar.
- **Measurement.** Alert precision (user-rated), and the unsubscribe rate.
- **Depends on.** Socket push (Ch 16).

## 18.10 Dependency order
```
F-01 → F-02 → F-03          F-04 → F-24 → F-08 ; F-04 → F-14
F-12 → F-13, F-16, F-20, F-09 ; F-17 → F-19, F-20 ; F-18 → F-22, F-30
F-26 → F-27, F-28, F-29 ; F-30 → F-31, F-33 ; F-34 → F-06 ; F-38 → F-25, F-28
F-05 → F-10, F-23
```
Ch 19 schedules these by phase. The P1 set (F-01, 04, 11, 12, 17, 18, 21, 22, 26, 30, 34, 35) can be built in Phases 1–3, because it only depends on itself and on the Phase 0 fixes.
