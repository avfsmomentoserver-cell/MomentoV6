# Data Model

All tables live in the `MomentoCore` Durable Object's SQLite database — the same relational schema as the original core, lifted 1:1.

## rounds
| column | type | notes |
| --- | --- | --- |
| id | INTEGER PK | autoincrement |
| ts | TEXT | ISO-8601 timestamp |
| ts_ms | INTEGER | epoch ms (indexed with source) |
| multiplier | REAL | the crash point, immutable |
| color | TEXT | normalized chroma (blue/purple/pink/…) |
| source | TEXT | provenance: avfs · momento_prev · momento_project · aviator · live-engine |
| session_id | INTEGER | 30-min-gap session |
| ingest | TEXT | api · import · live-feed |
| created_ms | INTEGER | ingest time |

Unique index `(source, ts_ms, multiplier)` = dedupe guarantee. Index `(source, ts_ms DESC)` = fast history.

## sessions
`id, source, started_ms, ended_ms, rounds, max_multiplier` — rebuilt at 30-minute gaps (investigationsuite methodology).

## sources
`id, name (unique), label, kind, created_ms`.

## forecasts
`id, source, model, threshold, probability, note, created_ms, resolved_ms, resolved_round_id, actual (0/1), brier` — the honesty ledger: stored before landing, scored after.

## plugins · plugin_runs
Registry of analyzers with `key, name, category, description, weight, enabled, config, runs`; `plugin_runs` records executions.

## autopilot_decisions
`id, source, round_id, decision, threshold, confidence, reason, stake, pnl, resolved, created_ms` — the paper-P&L ledger.

## backtest_runs
`id, source, kind, params, result (JSON), created_ms` — walk-forward history.

## vocabulary
`id, token (unique), layer, layers (JSON), definition, status (candidate/validated/formalized/deprecated), uses, hits, misses, score, created_ms, updated_ms`.

## users · tokens
`users: id, email (unique), name, role, password_hash (PBKDF2-SHA256, 100k iterations), salt, created_ms, disabled`. `tokens: token, user_id, created_ms, expires_ms` (30-day sessions).

## settings
Key/value store: session gap, feed seed/cursor/interval, orchestrator and autopilot parameters. Env vars override at boot; the UI edits persist here.

## build_steps · audit_log · ingest_log · top_rounds · orchestrator_log
Operational tables: the 13-step build record, the queryable activity timeline, per-ingest statistics, leaderboard caches, and orchestrator evaluations.

## indexes

- `idx_rounds_source_ts (source, ts_ms DESC)`
- `idx_rounds_dedupe (source, ts_ms, multiplier) UNIQUE`
- `idx_forecasts_source (source, created_ms DESC)`
- `idx_autopilot_source (source, created_ms DESC)`
- `idx_audit_created (created_ms DESC)`
- `idx_top_rounds (source, scope, multiplier DESC)`
