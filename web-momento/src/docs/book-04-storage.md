# 04 · Storage & Data Model

> Storage decides three things: whether a forecast can be audited after the fact, whether an analysis can be replayed "as it was", and whether the platform can grow past one operator. This chapter covers what the v6.3 Durable Object actually does, four scaling and integrity issues in it, lessons from the terminal's migrations, and a reference layout for the next platform.

## 4.1 What exists
| Generation | Store | Notes |
|---|---|---|
| V5 | SQLite in **WAL mode** (`backend/momento/db.py`, `store.py`) | Single process; FastAPI routes read it; `export_db_to_csv.py` |
| v6 / v6.3 | **Cloudflare Durable Object with SQLite storage** (`functions/core.ts`) | One single-writer object holds all 25 tables (Appendix A); the Worker routes to it |
| Terminal | SQLite (`ShapeShifters@…:backend/momento/db.py`, 37 KB) via SQLAlchemy, WAL + `synchronous=NORMAL`, **tested migrations** (`test_migrations.py`) | Simulator rounds tagged and purgeable; `visitor_id` column for multi-visitor isolation |
| MKI | **Postgres + pgvector** | Knowledge objects, embeddings, provenance (Ch 14) |
| momentocore2 | Kafka + Weaviate + K8s (design only) | Scale-out concept |
| avfs-backend | Express + SQLite | Legacy |

### 4.1.1 Table families (v6.3)
- **Tape:** `rounds`, `sessions`, `sources`, `top_rounds`, `ingest_log`
- **Forecasting:** `forecasts` (the original honesty ledger), `scheduled_predictions`, `accuracy_ledger`, `accuracy_history`, `engine_weights`, `round_calibrations`, `intel_calibrations`
- **Language:** `vocabulary` (candidate → validated → formalized → deprecated)
- **Decisions:** `autopilot_decisions`, `orchestrator_log`, `backtest_runs`
- **Platform:** `plugins`, `plugin_runs`, `settings`, `build_steps`, `releases`, `audit_log`, `users`, `tokens`

## 4.2 How the v6.3 Durable Object works
### 4.2.1 One global object
`functions/index.ts` forwards **every** request to a single instance:
```ts
wrapped.headers.set("X-Rork-DO-Class", "MomentoCore");
wrapped.headers.set("X-Rork-DO-Id", "global");
const response = await env.DO.fetch(wrapped);
```
The Worker also adds permissive CORS headers (`Access-Control-Allow-Origin: *`) to every response. Ch 17 covers why that should be narrowed once auth tokens exist.

### 4.2.2 Boot sequence
```ts
constructor(ctx, env) {
  super(ctx, env);
  this.ctx.blockConcurrencyWhile(async () => {
    this.initSchema();     // 25 × CREATE TABLE IF NOT EXISTS + indexes
    await this.bootstrap();// seed sources, default settings, first alarm, calibration backfill
    this.booted = true;
  });
}
```
`blockConcurrencyWhile` holds all incoming requests until the schema exists. This is the correct Durable Object pattern: without it, a request could reach a half-initialised object. Bootstrap also sets the **first alarm** 20 s after boot, so the multi-window accuracy engine starts accumulating even before anyone opens the dashboard.

### 4.2.3 Alarms as the scheduler
```ts
private async scheduleAccuracyAlarm() {
  const due = SELECT MIN(due_ms) FROM scheduled_predictions WHERE resolved_ms IS NULL;
  const next = due ? Math.min(due + 1_000, Date.now() + 15 * 60_000) : Date.now() + 60_000;
  await this.ctx.storage.setAlarm(Math.max(Date.now() + 5_000, next));
}
override async alarm() { try { await this.accuracyTick(); } catch (e) {...}
                         await this.scheduleAccuracyAlarm(); }
```
There is a single alarm per object. It wakes 1 s after the earliest due prediction, at most 15 minutes out and at least 5 s out. It always re-arms in `finally` style, even if the tick failed. Cloudflare guarantees at-least-once delivery for alarms, with automatic retries on failure ([Durable Objects alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)). That means `accuracyTick` has to be idempotent. Resolution is keyed on `resolved_ms IS NULL`, so it is.

### 4.2.4 The read path and its caches
```ts
private roundsFor(source) {
  const stats = this.tableStats();           // SELECT MAX(id), COUNT(*) FROM rounds
  const hit = this.roundsCache.get(key);
  if (hit && hit.maxId === stats.maxId && hit.count === stats.count) return hit.rounds;
  rows = SELECT id, ts, ts_ms, multiplier, color, source, session_id
         FROM rounds [WHERE source = ?] ORDER BY ts_ms ASC;   // entire tape
  ...
}
private analysisPayload(source) {
  const key = `${source ?? "all"}:${maxId}`;
  if (hit) return hit.payload;
  // overview, exceedance, streaks, bands, pressure, shape, moonshot, gaps, houseEdge, ladders, ceilings
}
```
Four in-memory maps (`analysisCache`, `fxCache`, `momentumCache`, `roundsCache`) are keyed by `(source, maxId)` and cleared by `invalidateCaches()` on every ingest.

## 4.3 Four issues to address
| # | Issue | Effect | Fix |
|---|---|---|---|
| T1 | **Whole-tape load**: `roundsFor` materialises every round of a source as JS objects on every cache miss | At 178k rounds that is roughly 20–30 MB of heap per source. DO memory is limited (128 MB per isolate, shared by the objects in it, per [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/)) and the "all" key doubles it | Window reads (`LIMIT N` by `ts_ms DESC`) for live views; incremental aggregates (§4.6) for long-run statistics |
| T2 | **Global invalidation**: one ingest into any source clears every cache, and `tableStats()` is global | A busy source makes every other source recompute from scratch | Per-source `max_id` held in memory and updated on insert (a `SELECT MAX(id) … WHERE source = ?` needs a `(source, id)` index, §4.11), per-source invalidation |
| T3 | **Single global object** | Every source shares one write queue and one memory budget, and a slow analysis blocks ingestion | One DO per source plus a directory (§4.5) |
| T4 | **Sentinel row `id = -1` in `round_calibrations`** stores the running correction | Mixes state with events and complicates every "all rows" query (`WHERE id <> -1` everywhere) | Move to `settings` or a `calibration_state` table |

Also watch for:
- **`AUTOINCREMENT` everywhere** is correct for ledgers. The terminal's migration notes explain why: "A plain INTEGER PRIMARY KEY is the rowid, and SQLite hands a freed rowid back out. Replacing an unresolved forecast therefore produced a new commitment carrying the dead one's id — two different claims sharing an identity inside a ledger whose whole purpose is that a forecast cannot be quietly swapped." v6.3 already uses AUTOINCREMENT on all of its ledgers. Keep it.
- **No schema versioning.** `initSchema` only runs `CREATE … IF NOT EXISTS`. The terminal's `_migrate()` docstring states the consequence exactly: "create_all() only creates tables that are absent, so a schema change to an existing table is invisible to it. Anything that alters an existing table has to be written here or it ships to nobody."

## 4.4 Migrations done right
Adopt a numbered migration runner inside the DO, with the applied version stored in the object:
```ts
const MIGRATIONS: { v: number; up: (sql: SqlStorage) => void }[] = [
  { v: 1, up: s => s.exec(BASE_SCHEMA) },
  { v: 2, up: s => { s.exec("ALTER TABLE rounds ADD COLUMN round_id TEXT");
                     s.exec("ALTER TABLE rounds ADD COLUMN ts_synthetic INTEGER NOT NULL DEFAULT 0");
                     s.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_rounds_rid ON rounds(source, round_id) WHERE round_id IS NOT NULL"); } },
  { v: 3, up: s => s.exec(`CREATE TABLE calibration_state (model TEXT PRIMARY KEY, correction REAL, n INTEGER, updated_ms INTEGER);
                           INSERT INTO calibration_state SELECT 'band', correction, 0, strftime('%s','now')*1000 FROM round_calibrations WHERE id=-1;
                           DELETE FROM round_calibrations WHERE id=-1;`) },
];
function migrate(ctx: DurableObjectState) {
  const sql = ctx.storage.sql;
  sql.exec("CREATE TABLE IF NOT EXISTS _schema (v INTEGER NOT NULL)");
  const cur = (sql.exec("SELECT COALESCE(MAX(v),0) v FROM _schema").one() as any).v;
  for (const m of MIGRATIONS.filter(m => m.v > cur))
    ctx.storage.transactionSync(() => { m.up(sql); sql.exec("INSERT INTO _schema VALUES (?)", m.v); });
}
```
Rules:
- Each migration runs in `transactionSync`, so it applies fully or not at all.
- Migrations are **forward-only**. A rollback is a new migration.
- Every migration gets a test that starts from a **snapshot of the previous version's database** and checks row counts and invariants afterwards. That is what `test_migrations.py` in the terminal does, including the predictions-table rebuild ("rename, recreate, copy, drop").
- A migration that rebuilds a table must copy ids verbatim, so ledger identities survive.

## 4.5 Reference layout: sharded Durable Objects plus a cold tier
Cloudflare recommends SQLite as the backend for all new Durable Object namespaces ([SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)). Each object has a per-object storage cap and there are account-level limits ([DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/)). Cloudflare's own rules stress that state must be persisted before responding, because an object can be evicted at any time ([Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)).

```
Worker (router, auth, CORS)
 ├── DirectoryDO  ("directory")          sources, users, tokens, plugins, releases, settings(global)
 ├── SourceDO     (idFromName(source))   rounds, sessions, ingest_log, tape_gaps, forecasts,
 │                                        scheduled_predictions, calibrations, ledgers(source-scoped)
 ├── LedgerDO     ("ledger")             cross-source leaderboard, hash chain (F-18)
 └── R2 bucket    momento-archive/       rounds/<source>/<yyyy>/<mm>/<dd>.parquet, ledgers/*.ndjson
```
| Decision | Rationale |
|---|---|
| One `SourceDO` per operator/source | Isolates write load and memory; each source gets its own consistency domain and alarm |
| Cross-source views are fan-out reads from the Worker | "All sources" is rare and read-only; a federated view (F-05) merges per-source aggregates, not raw rounds |
| Hot window in DO SQLite (~250k rounds per source, open predictions, ledgers) | Keeps live analysis within memory |
| Nightly export to **R2 as Parquet** | The Python research suite (Ch 12) reads Parquet directly; the DO stays small |
| Ledgers are never pruned from the DO | They are small (one row per resolved forecast) and they are the product's credibility |

### 4.5.1 Routing
```ts
export default {
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    const source = url.searchParams.get("source") ?? (await bodySource(req)) ?? "aviator";
    const stub = source === "all"
      ? env.DIRECTORY.get(env.DIRECTORY.idFromName("directory"))
      : env.SOURCE.get(env.SOURCE.idFromName(source));
    return withCors(await stub.fetch(req), req);
  },
};
```

## 4.6 Incremental aggregates instead of whole-tape recomputation
Most dashboard statistics can be updated in O(1) per round. Keep them in a `source_aggregates` table updated inside the ingest transaction:

| Statistic | State per source | Update per round m |
|---|---|---|
| Count, mean, log-mean | n, Σm, Σln m | add |
| Exceedance P(≥t) for the 12 `THRESHOLDS` | counts c_t | c_t += [m ≥ t] |
| Band histogram (6 bands) | counts | +1 |
| Current streak below 2× / above 2× | run length, type | extend or reset |
| Rounds since last ≥ t (the "wait" in ETAs) | last index per t | set when m ≥ t |
| Max | max | max(max, m) |
| Median | P² quantile estimator ([Jain & Chlamtac](https://www.cse.wustl.edu/~jain/papers/ftp/psqr.pdf)) or a fixed log-bucket histogram | O(1) |

The long-run views (tail fit, walk-forward, linguistics) stay batch jobs. They run on alarm, write their results to `analysis_snapshots(source, kind, max_round_id, payload, computed_ms)`, and the API serves the latest snapshot. Snapshots are also the backbone of **F-04 time-travel**: `?as_of=` returns the latest snapshot with `max_round_id ≤` the round at that time. Anything not snapshotted is recomputed from the rounds up to that id.

```ts
function applyRound(a: Agg, m: number, idx: number) {
  a.n++; a.sum += m; a.sumLog += Math.log(m); a.max = Math.max(a.max, m);
  for (let i = 0; i < THRESHOLDS.length; i++) if (m >= THRESHOLDS[i]) { a.exc[i]++; a.lastHit[i] = idx; }
  a.band[bandIndex(m)]++;
  const low = m < 2;
  a.streak = (a.streakLow === low) ? a.streak + 1 : 1; a.streakLow = low;
  a.logHist[Math.min(63, Math.floor(Math.log2(m) * 4))]++;   // quarter-octave buckets → median/quantiles
}
```

## 4.7 Event-sourced ledgers
`accuracy_ledger` stores running sums (`n, brier_sum, base_sum, logloss_sum, hits`), which is O(1) and never pruned. Keep that. Also treat `scheduled_predictions`, `round_calibrations` and `intel_calibrations` as the **immutable event log**. After a scoring bug is fixed, every ledger can then be rebuilt from its events:
```sql
-- rebuild accuracy_ledger from resolved predictions
DELETE FROM accuracy_ledger;
INSERT INTO accuracy_ledger (model, window, threshold, n, brier_sum, base_sum, logloss_sum, hits, rounds_scanned, updated_ms)
SELECT model, window, threshold, COUNT(*), SUM(brier), SUM(base_brier), SUM(logloss), SUM(actual), SUM(outcome_rounds),
       MAX(resolved_ms)
FROM scheduled_predictions WHERE resolved_ms IS NOT NULL GROUP BY model, window, threshold;
```
That needs one column v6.3 does not store: `base_brier`, the baseline's Brier score for the same prediction. Add it at resolution time; without it the skill score cannot be rebuilt. Expose the rebuild as `POST /api/v1/accuracy/rebuild` (admin). The acceptance test is that the rebuilt sums equal the running sums to floating-point tolerance.

**Corrections, not edits.** Rounds are never updated. If a round turns out to be wrong (a decode error, say), write a `round_corrections(round_id, field, old, new, reason, actor, created_ms)` row. Readers apply corrections when they read. Forecasts already scored against the wrong value keep their original score *and* gain a corrected score, so the ledger shows both (App. A).

## 4.8 Indexes that matter
Existing (v6.3): `idx_rounds_source_ts (source, ts_ms DESC)`, `idx_rounds_dedupe UNIQUE (source, ts_ms, multiplier)`, `idx_forecasts_source`, `idx_autopilot_source`, `idx_audit_created`, `idx_top_rounds (source, scope, multiplier DESC)`, `idx_sched_due (resolved_ms, due_ms)`, `idx_acc_hist`, `idx_round_cal`, `idx_intel_cal (created_ms)`.

Add:
```sql
CREATE UNIQUE INDEX ux_rounds_rid ON rounds(source, round_id) WHERE round_id IS NOT NULL; -- operator round ids
CREATE INDEX ix_rounds_session ON rounds(session_id);                                     -- per-session stats
CREATE INDEX ix_intel_open ON intel_calibrations(source, resolved_ms);                    -- open forecasts per source
CREATE INDEX ix_ingest_log_src ON ingest_log(source, created_ms DESC);                    -- ingest console
```
`idx_sched_due` has `resolved_ms` first. The resolver asks `WHERE resolved_ms IS NULL AND due_ms <= ?`, so `resolved_ms` first is the right order: SQLite seeks to the NULL range, then range-scans `due_ms`.

## 4.9 Shared types across TS and Python
`Round` is defined in `functions/analysis.ts`, in the V5 Python and in the terminal, each slightly differently: v6.3 uses `tsMs`, the terminal uses `m` in its JSON, V5 uses `multiplier`. Generate all of them from one JSON Schema, `schemas/round.schema.json`, with `quicktype` (TS) and `datamodel-code-generator` (Pydantic). CI fails if the generated files differ from those committed.

```json
{ "$id": "round", "type": "object", "required": ["source", "ts_ms", "multiplier"],
  "properties": { "id": {"type": "integer"}, "source": {"type": "string"}, "round_id": {"type": ["string","null"]},
    "ts_ms": {"type": "integer"}, "ts_synthetic": {"type": "boolean"}, "multiplier": {"type": "number", "minimum": 1},
    "session_id": {"type": ["integer","null"]}, "collector": {"type": ["string","null"]} } }
```

## 4.10 Backups, retention and portability
| Asset | Policy |
|---|---|
| Rounds | Hot window in DO; full history in R2 Parquet; never deleted |
| Ledgers and forecasts | Never deleted; nightly NDJSON to R2; hash-chained (F-18) |
| `audit_log` | 400 days hot, then R2 |
| Uploaded `.db` files | Staged with a TTL and deleted after import (the terminal's `_sweep`), never kept |
| Point-in-time recovery | Durable Objects SQLite supports restoring an object to a point within the last 30 days ([PITR](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api)). Document the runbook |

**Portability.** Every table must be exportable as CSV/Parquet with one command (V5's `export_db_to_csv.py` is the precedent). Researchers should never need production access to reproduce a number.

## 4.11 Measuring the v6.3 read path
**Setup.**
- The v6.3 `rounds` schema and both indexes, copied from `core.ts` lines 100–112.
- 177,905 synthetic rounds for one source, loaded into SQLite 3 on the sandbox (Python `sqlite3`).
- The JS heap measured in Node with `--expose-gc` for the exact object shape `roundsFor` builds.

Durable Object SQLite runs the same engine inside the Workers runtime. Treat the absolute times as indicative and the **ratios** as the finding.

| Measurement | Result |
|---|---|
| Database size after `VACUUM` | 20.8 MB (117 bytes per round, including both indexes) |
| `roundsFor(source)`: full `SELECT … ORDER BY ts_ms ASC` | 259 ms, 177,905 rows |
| JS heap for the resulting `Round[]` (7 fields, ISO string `ts`) | **29.3 MB** |
| Live window: `ORDER BY ts_ms DESC LIMIT 500` | 0.3 ms |
| `tableStats()`: `SELECT MAX(id), COUNT(*) FROM rounds` | 6.3 ms |
| Per-source `SELECT MAX(id) … WHERE source = ?` via `idx_rounds_source_ts` | 7.5 ms (scans every index entry of the source) |
| Same with an added index `(source, id)` | **0.009 ms** |

**Reading.**
- **T1 confirmed.** One source costs about 29 MB of heap on every cache miss. The `"all"` key adds a second copy. Against the 128 MB isolate limit ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)), three large sources plus `all` exceed memory, and the runtime starts a new isolate.
- **T2's proposed fix needs an index.** The per-source `MAX(id)` suggested in §4.3 is *slower* than the global one unless `(source, id)` is indexed. That index makes it about 800× faster.
- **Window reads are about 900× cheaper than full reads.** Every live screen should use them. Long-run statistics come from incremental aggregates (§4.6).

### 4.11.1 Two more findings
| # | Finding | Effect | Fix |
|---|---|---|---|
| T5 | **No `(source, id)` index**, and cache validity is keyed on `MAX(id)` and `COUNT(*)` over the whole table | 6–8 ms of index scanning on every read request before the cache is even consulted | `CREATE INDEX idx_rounds_source_id ON rounds(source, id)`. Better: keep `max_id` per source in memory, updated on insert |
| T6 | **Row-per-statement inserts.** Each round is its own `INSERT OR IGNORE` inside `transactionSync` | Fine at live rates. At import size (100k rows) this dominates CPU time | Multi-row `VALUES` chunks. DO SQL allows at most **100 bound parameters** per query ([DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/)), so 8 columns means at most 12 rows per statement. Chunk at 12 |

### 4.11.2 Capacity
With about 117 bytes per round, a SQLite-backed DO's **10 GB** limit ([DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/)) holds roughly 85 million rounds. At one round every 10 seconds, that is about 27 years for one source. Storage is not the constraint; memory and CPU per request are.

Ledgers grow faster than the tape (several forecasts per round), and the plan is sized with that in mind:

| Table | Rows per round | Bytes per row (est.) | Per year at one round per 10 s |
|---|---|---|---|
| rounds | 1 | 117 | 0.37 GB |
| predictions (example: 4 models × 6 thresholds) | 24 | ~90 | 6.8 GB |
| ledger_chain | ~24 | ~110 | 8.3 GB |
| reliability_bins, mix_state | O(1) | — | < 1 MB |

The per-row ledger is therefore the part that hits 10 GB within about a year. Keep 90 days of per-row predictions hot in the DO. Roll older rows into daily `reliability_bins` and `signal_stats`, and archive the raw rows as Parquet in R2, **with the chain head recorded before the roll-off** so that F-18 verification still works from R2.

## 4.12 Reference code: per-source router and migration runner
```ts
// worker.ts: route every request to exactly one source DO, or to the Directory
export default {
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    const source = url.searchParams.get("source");
    if (!source || source === "all") return env.DIRECTORY.get(env.DIRECTORY.idFromName("dir")).fetch(req);
    if (!/^[a-z0-9-]{1,32}$/.test(source)) return json({ ok: false, error: "bad_source" }, 400);
    return env.SOURCE.get(env.SOURCE.idFromName(source)).fetch(req);
  },
};

// migrations.ts: numbered, forward-only, recorded in _schema
const MIGRATIONS: [number, string][] = [
  [1, `CREATE TABLE rounds(round_id INTEGER PRIMARY KEY AUTOINCREMENT, ts_ms INTEGER NOT NULL,
        m REAL NOT NULL, ts_synthetic INTEGER NOT NULL DEFAULT 0, collector TEXT, batch_id TEXT,
        ingested_ms INTEGER NOT NULL);
       CREATE UNIQUE INDEX u_rounds ON rounds(ts_ms, m);`],
  [2, `CREATE TABLE ingest_quarantine(id INTEGER PRIMARY KEY AUTOINCREMENT, raw_json TEXT,
        reject_reasons TEXT, collector TEXT, batch_id TEXT, received_ms INTEGER);`],
  [3, `CREATE TABLE round_session(round_id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL);`],
];
export function migrate(sql: SqlStorage, storage: DurableObjectStorage) {
  sql.exec("CREATE TABLE IF NOT EXISTS _schema(version INTEGER PRIMARY KEY, applied_ms INTEGER)");
  const cur = (sql.exec("SELECT MAX(version) v FROM _schema").one().v as number) ?? 0;
  for (const [v, ddl] of MIGRATIONS) if (v > cur) storage.transactionSync(() => {
    sql.exec(ddl); sql.exec("INSERT INTO _schema VALUES (?, ?)", v, Date.now());
  });
}
```
In a per-source DO the `source` column disappears from `rounds`, which also removes it from every index: about 10 fewer bytes per row. The Directory keeps `source_aggregates` (App. A) and fans out only for rare cross-source queries.

### 4.12.1 Moving v6.3 data into per-source objects
1. Freeze writes (feature flag). Export per source with `SELECT … WHERE source = ? ORDER BY ts_ms, id` in pages of 5,000.
2. POST each page to the new source DO's internal `/import` with `batch_id = migrate-<source>-<page>`. Idempotent: the unique index turns retries into duplicates.
3. Verify per source: count, `SUM(m)`, min and max `ts_ms`, and a SHA-256 over `ts_ms|m` lines, old vs new.
4. Switch reads with the router flag, then switch writes. Keep the old DO read-only for 30 days.
5. Rebuild ledgers from their own rows (V4 in Ch 08: stop reconstructing). Keep the old ledger as `legacy_*` tables for the side-by-side comparison in Ch 19 §19.3.4.

## 4.13 Tests
| Test | Assertion |
|---|---|
| `migrate_from_v63_snapshot` | Running all migrations on a v6.3 dump preserves every row count and every ledger id |
| `ledger_rebuild_equals_running` | Rebuild from events matches running sums (\|Δ\| < 1e-9) |
| `per_source_isolation` | Ingest into source A does not invalidate source B's caches or change B's `max_id` |
| `alarm_idempotent` | Running `accuracyTick` twice for the same due time resolves each prediction once |
| `as_of_consistency` | `GET /analysis?as_of=T` equals an analysis computed on a copy truncated at T |
| `aggregates_match_batch` | Incremental aggregates equal a batch recompute on a random 50k-round tape |

## 4.14 Measurement
| Metric | Target |
|---|---|
| DO p95 read for a 5k-round window | < 30 ms |
| Ingest transaction (100 rounds, with aggregates) | < 50 ms p95 |
| Heap per SourceDO at 250k rounds | < 60 MB |
| Ledger rebuild drift | 0 |
| Nightly R2 export freshness | < 26 h |

## 4.15 Features this chapter unlocks
- **F-04 `as_of` time-travel** on any analysis endpoint, served from snapshots and the event log. It is what makes honest replays (F-24) possible.
- **F-05 Per-source DO sharding** with a federated cross-source view.
- **F-18 Tamper-evident track record**, built on the append-only ledgers and hash chain (Ch 17).
