# Appendix A · Data Model Reference

This appendix lists the 25 tables of the v6.3 Durable Object store. Source: `MomentoV5@v6.3-full-intelligence:functions/core.ts`. Columns are copied from the `CREATE TABLE` statements. Proposed additions are listed at the end.


## `rounds`
| Column / constraint |
|---|
| `id INTEGER PRIMARY KEY AUTOINCREMENT` |
| `ts TEXT NOT NULL` |
| `ts_ms INTEGER NOT NULL` |
| `multiplier REAL NOT NULL` |
| `color TEXT` |
| `source TEXT NOT NULL` |
| `session_id INTEGER` |
| `ingest TEXT NOT NULL DEFAULT 'api'` |
| `created_ms INTEGER NOT NULL` |

## `sessions`
| Column / constraint |
|---|
| `id INTEGER PRIMARY KEY AUTOINCREMENT` |
| `source TEXT NOT NULL` |
| `started_ms INTEGER NOT NULL` |
| `ended_ms INTEGER NOT NULL` |
| `rounds INTEGER NOT NULL DEFAULT 0` |
| `max_multiplier REAL NOT NULL DEFAULT 0` |

## `sources`
| Column / constraint |
|---|
| `id INTEGER PRIMARY KEY AUTOINCREMENT` |
| `name TEXT UNIQUE NOT NULL` |
| `label TEXT NOT NULL` |
| `kind TEXT NOT NULL DEFAULT 'collector'` |
| `created_ms INTEGER NOT NULL` |

## `users`
| Column / constraint |
|---|
| `id INTEGER PRIMARY KEY AUTOINCREMENT` |
| `email TEXT UNIQUE NOT NULL` |
| `name TEXT NOT NULL` |
| `role TEXT NOT NULL DEFAULT 'operator'` |
| `password_hash TEXT NOT NULL` |
| `salt TEXT NOT NULL` |
| `created_ms INTEGER NOT NULL` |
| `disabled INTEGER NOT NULL DEFAULT 0` |

## `tokens`
| Column / constraint |
|---|
| `token TEXT PRIMARY KEY` |
| `user_id INTEGER NOT NULL` |
| `created_ms INTEGER NOT NULL` |
| `expires_ms INTEGER NOT NULL` |

## `forecasts`
| Column / constraint |
|---|
| `id INTEGER PRIMARY KEY AUTOINCREMENT` |
| `source TEXT NOT NULL` |
| `model TEXT NOT NULL` |
| `threshold REAL NOT NULL` |
| `probability REAL NOT NULL` |
| `note TEXT` |
| `created_ms INTEGER NOT NULL` |
| `resolved_ms INTEGER` |
| `resolved_round_id INTEGER` |
| `actual INTEGER` |
| `brier REAL` |

## `plugins`
| Column / constraint |
|---|
| `id INTEGER PRIMARY KEY AUTOINCREMENT` |
| `key TEXT UNIQUE NOT NULL` |
| `name TEXT NOT NULL` |
| `category TEXT NOT NULL DEFAULT 'analyzer'` |
| `description TEXT NOT NULL DEFAULT ''` |
| `weight REAL NOT NULL DEFAULT 1.0` |
| `enabled INTEGER NOT NULL DEFAULT 1` |
| `config TEXT NOT NULL DEFAULT '{}'` |
| `runs INTEGER NOT NULL DEFAULT 0` |
| `created_ms INTEGER NOT NULL` |

## `plugin_runs`
| Column / constraint |
|---|
| `id INTEGER PRIMARY KEY AUTOINCREMENT` |
| `plugin_id INTEGER NOT NULL` |
| `source TEXT NOT NULL` |
| `duration_ms REAL NOT NULL` |
| `output TEXT NOT NULL` |
| `created_ms INTEGER NOT NULL` |

## `autopilot_decisions`
| Column / constraint |
|---|
| `id INTEGER PRIMARY KEY AUTOINCREMENT` |
| `source TEXT NOT NULL` |
| `round_id INTEGER` |
| `decision TEXT NOT NULL` |
| `threshold REAL` |
| `confidence REAL` |
| `reason TEXT NOT NULL DEFAULT ''` |
| `stake REAL NOT NULL DEFAULT 0` |
| `pnl REAL NOT NULL DEFAULT 0` |
| `resolved INTEGER NOT NULL DEFAULT 0` |
| `created_ms INTEGER NOT NULL` |

## `backtest_runs`
| Column / constraint |
|---|
| `id INTEGER PRIMARY KEY AUTOINCREMENT` |
| `source TEXT NOT NULL` |
| `kind TEXT NOT NULL` |
| `params TEXT NOT NULL` |
| `result TEXT NOT NULL` |
| `created_ms INTEGER NOT NULL` |

## `ingest_log`
| Column / constraint |
|---|
| `id INTEGER PRIMARY KEY AUTOINCREMENT` |
| `source TEXT NOT NULL` |
| `method TEXT NOT NULL` |
| `count INTEGER NOT NULL` |
| `rejected INTEGER NOT NULL DEFAULT 0` |
| `created_ms INTEGER NOT NULL` |

## `settings`
| Column / constraint |
|---|
| `key TEXT PRIMARY KEY` |
| `value TEXT NOT NULL` |

## `build_steps`
| Column / constraint |
|---|
| `step INTEGER PRIMARY KEY` |
| `title TEXT NOT NULL` |
| `status TEXT NOT NULL DEFAULT 'done'` |
| `updated_ms INTEGER NOT NULL` |

## `audit_log`
| Column / constraint |
|---|
| `id INTEGER PRIMARY KEY AUTOINCREMENT` |
| `actor TEXT NOT NULL` |
| `action TEXT NOT NULL` |
| `target TEXT` |
| `meta TEXT` |
| `created_ms INTEGER NOT NULL` |

## `top_rounds`
| Column / constraint |
|---|
| `id INTEGER PRIMARY KEY AUTOINCREMENT` |
| `source TEXT NOT NULL` |
| `scope TEXT NOT NULL` |
| `scope_key TEXT NOT NULL` |
| `round_id INTEGER` |
| `ts TEXT NOT NULL` |
| `multiplier REAL NOT NULL` |
| `color TEXT` |

## `vocabulary`
| Column / constraint |
|---|
| `id INTEGER PRIMARY KEY AUTOINCREMENT` |
| `token TEXT UNIQUE NOT NULL` |
| `layer TEXT NOT NULL DEFAULT 'band'` |
| `layers TEXT NOT NULL DEFAULT '[]'` |
| `definition TEXT NOT NULL DEFAULT ''` |
| `status TEXT NOT NULL DEFAULT 'candidate'` |
| `uses INTEGER NOT NULL DEFAULT 0` |
| `hits INTEGER NOT NULL DEFAULT 0` |
| `misses INTEGER NOT NULL DEFAULT 0` |
| `score REAL NOT NULL DEFAULT 0.5` |
| `created_ms INTEGER NOT NULL` |
| `updated_ms INTEGER NOT NULL` |

## `releases`
| Column / constraint |
|---|
| `id INTEGER PRIMARY KEY AUTOINCREMENT` |
| `version TEXT NOT NULL` |
| `filename TEXT NOT NULL` |
| `url TEXT NOT NULL` |
| `sha256 TEXT` |
| `notes TEXT` |
| `manifest TEXT` |
| `created_ms INTEGER NOT NULL` |

## `orchestrator_log`
| Column / constraint |
|---|
| `id INTEGER PRIMARY KEY AUTOINCREMENT` |
| `source TEXT NOT NULL` |
| `kind TEXT NOT NULL` |
| `detail TEXT NOT NULL` |
| `created_ms INTEGER NOT NULL` |

## `scheduled_predictions`
| Column / constraint |
|---|
| `id INTEGER PRIMARY KEY AUTOINCREMENT` |
| `source TEXT NOT NULL DEFAULT 'all'` |
| `window TEXT NOT NULL` |
| `threshold REAL NOT NULL` |
| `model TEXT NOT NULL DEFAULT 'pipeline'` |
| `probability REAL NOT NULL` |
| `per_round REAL NOT NULL DEFAULT 0` |
| `expected_rounds INTEGER NOT NULL` |
| `components TEXT` |
| `created_ms INTEGER NOT NULL` |
| `due_ms INTEGER NOT NULL` |
| `resolved_ms INTEGER` |
| `resolved_round_id INTEGER` |
| `actual INTEGER` |
| `outcome_rounds INTEGER` |
| `brier REAL` |
| `logloss REAL` |

## `accuracy_ledger`
| Column / constraint |
|---|
| `model TEXT NOT NULL` |
| `window TEXT NOT NULL` |
| `threshold REAL NOT NULL` |
| `n INTEGER NOT NULL DEFAULT 0` |
| `brier_sum REAL NOT NULL DEFAULT 0` |
| `base_sum REAL NOT NULL DEFAULT 0` |
| `logloss_sum REAL NOT NULL DEFAULT 0` |
| `hits INTEGER NOT NULL DEFAULT 0` |
| `rounds_scanned INTEGER NOT NULL DEFAULT 0` |
| `updated_ms INTEGER NOT NULL` |
| `PRIMARY KEY (model, window, threshold)` |

## `engine_weights`
| Column / constraint |
|---|
| `model TEXT PRIMARY KEY` |
| `skill REAL NOT NULL DEFAULT 0` |
| `weight REAL NOT NULL DEFAULT 0` |
| `updated_ms INTEGER NOT NULL` |

## `accuracy_history`
| Column / constraint |
|---|
| `id INTEGER PRIMARY KEY AUTOINCREMENT` |
| `window TEXT NOT NULL` |
| `threshold REAL NOT NULL` |
| `ts INTEGER NOT NULL` |
| `cumulative_n INTEGER NOT NULL` |
| `cumulative_brier REAL NOT NULL` |
| `cumulative_base REAL NOT NULL` |
| `hit_rate REAL NOT NULL` |

## `round_calibrations`
| Column / constraint |
|---|
| `id INTEGER PRIMARY KEY AUTOINCREMENT` |
| `source TEXT NOT NULL DEFAULT 'all'` |
| `state TEXT NOT NULL` |
| `expected REAL NOT NULL` |
| `range_lo REAL NOT NULL` |
| `range_hi REAL NOT NULL` |
| `reach REAL NOT NULL` |
| `tail_lift REAL NOT NULL` |
| `correction REAL NOT NULL DEFAULT 0` |
| `dist TEXT` |
| `actual REAL` |
| `verdict TEXT` |
| `reason TEXT` |
| `band_err INTEGER` |
| `log_err REAL` |
| `created_ms INTEGER NOT NULL` |
| `resolved_ms INTEGER` |

## `intel_calibrations`
| Column / constraint |
|---|
| `id INTEGER PRIMARY KEY AUTOINCREMENT` |
| `source TEXT NOT NULL DEFAULT 'all'` |
| `round_id INTEGER` |
| `state TEXT NOT NULL` |
| `expected REAL NOT NULL` |
| `range_lo REAL NOT NULL` |
| `range_hi REAL NOT NULL` |
| `reach REAL NOT NULL` |
| `confidence REAL NOT NULL` |
| `correction REAL NOT NULL DEFAULT 0` |
| `dist TEXT` |
| `weights TEXT` |
| `comp_loss TEXT` |
| `mix_loss REAL` |
| `base_loss REAL` |
| `actual REAL` |
| `verdict TEXT` |
| `reason TEXT` |
| `band_err INTEGER` |
| `log_err REAL` |
| `created_ms INTEGER NOT NULL` |
| `resolved_ms INTEGER` |


## Proposed additions (this book)
All additions are append-only unless noted. Every table has `source_id` where it is per-source. With per-source DOs (F-05), `source_id` is implicit inside each DO and explicit in the Directory and in exports.

### A.P1 Tape and ingest (Ch 03, F-01, F-02, F-04)
| Table / column | Definition | Chapter / feature |
|---|---|---|
| `rounds.round_id` | `INTEGER PRIMARY KEY`, stable id used by all ledgers | 03 |
| `rounds.ingested_ms` | Server receive time. `as_of` filters on both `ts_ms` and `ingested_ms` | F-04 |
| `rounds.ts_synthetic` | 1 if the timestamp was inferred (for example CSV without times) | 03 |
| `rounds.collector`, `rounds.batch_id` | Signing collector id, batch id | F-02, Ch 17 |
| `ingest_quarantine(id, source_id, raw_json, reject_reasons, collector, batch_id, received_ms)` | Rejected or disputed rows, with reasons (JSON array) | 03, F-01 |
| `round_corrections(id, round_id, field, old, new, reason, actor, created_ms)` | Append-only corrections. The tape is never edited in place | 03, F-04 |
| `round_links(round_id, collector, raw_value, raw_ts)` | Per-collector observations of a consensus round | F-02 |
| `round_session(round_id, session_id)` | Session membership (30-min gap rule), rebuilt deterministically | 03 |
| `tape_gaps(source_id, session_id, from_ts, to_ts, est_missing)` | Detected gaps (Δt > 2.5 × median) | F-01 |
| `session_quality(session_id, completeness, low_share_z, fair_match, agreement, integrity)` | Integrity components and score | F-01 |
| `analysis_snapshots(source_id, round_id, state_json, created_ms)` | Incremental analysis state every 100 rounds, for `as_of` and replay | F-04, F-24 |
| `source_aggregates(source_id, day, n, band_counts_json, edge_est, edge_lo, edge_hi)` | Directory-level daily aggregates | F-05, F-10 |
| `source_epochs(source_id, epoch, from_ts, reason)` | Fingerprint epochs after a confirmed shift | F-03 |
| `_schema(version, applied_ms)` | Migration version per DO | F-05 |

### A.P2 Forecasting and accuracy (Ch 07, Ch 08, F-12 to F-20)
| Table / column | Definition | Chapter / feature |
|---|---|---|
| `engines(key, version, owner, state, prior, params_schema, created_ms)` | Registry. State ∈ {shadow, live, demoted, retired} | F-12 |
| `mix_state(source_id, regime, engine, weight, loss_sum, n, updated_ms)` | Earned-mixture state per regime (regime = 'all' for global) | 07, F-13 |
| `calibration_state(source_id, engine, threshold, a, b, n, updated_ms)` | Online calibration parameters per engine and threshold | 08 |
| `scheduled_components(forecast_id, engine, dist_json, weight)` | Per-engine distributions stored with each forecast (enables F-14, F-16) | 07, 08 |
| `predictions.base_p`, `predictions.base_brier` | Like-for-like baseline probability and Brier for the **same** target and window (fixes V1) | 08 |
| `reliability_bins(model, window, threshold, bin, n, sum_p, sum_y)` | 10-bin running sums | F-17 |
| `conformal_state(model, target, alpha, alpha_t, updated_ms)` | ACI state | 08, F-17 |
| `ledger_chain(seq, forecast_id, kind, row_hash, prev_hash, created_ms)` | Hash chain. kind ∈ {forecast, resolution, void} | F-18 |
| `forecast_explanations(forecast_id, json, created_ms)` | Decomputation dimensions, contributions, narration | F-35 |
| `signal_stats(source_id, signal, state, n, hits, lift, lo, hi, q, updated_ms)` | Significance strip | F-11 |
| `backtest_runs(id, engine, params_json, slice_json, metrics_json, created_ms, created_by)` | Workbench runs | F-09 |

### A.P3 Survival (Ch 10, F-26 to F-29)
| Table | Definition |
|---|---|
| `gap_state(source_id, threshold, current_gap, last_hit_round, updated_ms)` | Current gap per threshold |
| `km_cache(source_id, threshold, k, S, n_at_risk, events, built_ms)` | KM curve with censoring, rebuilt nightly plus an incremental tail |
| `hazard_models(id, source_id, threshold, coef_json, heldout_ll, km_ll, ibs, active, fitted_ms)` | Covariate hazard. Active only while heldout_ll > km_ll |
| `eta_forecasts(id, source_id, threshold, gap, km_pct, eta_p50, eta_p90, model, created_ms, resolved_round, resolved_ms)` | Scored ETAs |

### A.P4 Decisions, research, fairness, UX (Ch 11 to Ch 16)
| Table | Definition | Feature |
|---|---|---|
| `decisions(id, producer, source_id, target, horizon, p, p_lo, stake, reasons_json, guard_json, created_ms, outcome, pnl, resolved_ms)` | Unified Decision record | F-30, F-31 |
| `experiments(id, spec_yaml, hypothesis_id, metric, test, power_ok, p, q, verdict, result_json, created_ms)` | Experiment Registry | F-34 |
| `round_fairness(round_id, source_id, server_seed_hash, server_seed, client_seed, nonce, convention, recomputed, captured, verdict, chain_depth, checked_ms)` | Continuous verification | F-36 |
| `fairness_runs(source_id, date, test, statistic, p, q, n)` | Nightly battery | F-03, F-36 |
| `scheduled_predictions(id, user_id, model, source_id, level, window_rounds, window_ms, p, created_ms, outcome, score)` | Drawn predictions | F-22 |
| `user_scores(user_id, period, n, skill, lo, hi)` | Leaderboards | F-22 |
| `alert_rules(id, user_id, rule_json, channel, debounce_s, quiet_json, enabled)` and `alerts(id, rule_id, forecast_id, payload_json, fired_ms, delivered_ms)` | Alerts Center | F-38 |
| `knowledge_links(object_id, table, row_id)` | Ties MKI objects to data rows | Ch 14 |
| `tokens.token_hash` | SHA-256 of the bearer token (replaces plaintext, S-5) | Ch 17 |
| `users.pbkdf2_iter` | Per-user iteration count for upgrades (S-6) | Ch 17 |
