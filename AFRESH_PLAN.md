# AFRESH — Python backend rebuild for the v6.5 frontend

Branch: `afresh` (from `robust` @ `c935d20`). Status: **plan** (this document lands first; implementation follows on the same branch).

## 1. Goal

Replace the Cloudflare-Worker TypeScript backend with a **Python backend**. It is built on the attached `momento_core` package (`avfs-code-2026-07-24_13-55-17.rar`), and everything it lacks is ported from the archived v6.5 TypeScript backend. The v6.5 frontend (`web-momento/`) must work unchanged on every page: same `/api/v1` paths, the same `{ok, data} | {ok:false, error}` envelope, the same field names, auth, and `?as_of=` time machine.

Non-goals:
- No frontend redesign. Only the API base URL changes, through the existing `EXPO_PUBLIC_RORK_FUNCTIONS_URL`.
- No claim of predictive skill beyond what the locked holdout shows. The evidence gate, earned point and range selection, and the blend admission gate are kept as hard rules.

## 2. Inputs, read and measured

### 2.1 Attached archive (`momento_core`, ~23.2k lines Python)

| Package | What it gives | Used as |
|---|---|---|
| `linguistics/` (engine, house_edge, reverse_layers) | 8-layer MomentoLinguistics conversion, house-edge per band, reverse lookup | Linguistics v2, vocabulary, dictionary, band colours |
| `analysis/` (round_analyzer, streak_detection, band_exhaustion, time_series, momento_scaler) | Round scoring, streaks, band exhaustion and normalisation events, time-series stats | `/analysis`, investigate, momentum and DNA features; candidate engines |
| `prediction/` (engine, percentile_service, ml_engine) | CrashPredictionEngine, rolling percentile snapshots, sklearn next-round model | Candidate mixture engines (behind the blend gate) |
| `signals/hunter_pro.py` | SignalHunterPro events (bait, collapse, ignition, ladder, moonshot, shelf) | Signals component and `/signals/*` |
| `plugins/` (collapse_ceiling, gap_swing) | Ceiling / gap-swing analysers | Inventory plugins (`/inventory/*`) |
| `orchestrator/` + `orchestrator_pluggable/` | Risk manager, mistake prevention, instruction generator, execution planner; conservative / default / aggressive modules | `/orchestrator/*` |
| `autopilot/` (engine, strategy_selector) | Autopilot decisions, strategy selection, trade results | `/autopilot/*` |
| `collector/ingest_client.py` | Downloads/inbox watcher → ingest | `collectors/` CLI pushing to `/api/v1/ingest` |
| `db/` (SQLAlchemy models) | Round / crash / prediction schemas | **Replaced** (see §4.3); column names kept where they match |
| `api/` (FastAPI, 45 routes, different names) | Route skeletons, services | Logic reused in the new routers; route names follow the v6.5 contract |

Its test suite currently has **182 passing and 27 failing** tests: collapse_ceiling direction/strength, bankroll P&L, speed engine, orchestrator integration, collector ingest, round_analyzer severity, gap_swing MA-200, and crash prediction. All 27 are fixed or rewritten in phase P1, so the vendored core starts green.

Docs read: `docs/SYSTEM_SPEC.md`, `core/REVISED_ARCHITECTURE_UI_LOGIC_SEPARATION.md`, `core/platform_core_overview.md`, `core/test_results_summary.md`, and `.kiro/steering/*`. Points taken from them:
- the spec requires `/health`, rounds with `timestamp + multiplier` dedupe, SQLite in WAL mode, and systemd services;
- the architecture doc requires services behind routes, not mock data in routes;
- the test summary reports that band-exhaustion regimes did **not** validate on 126k rounds, so those outputs are candidates, not trusted features.

### 2.2 Archived backend (TypeScript, 13.8k lines, `archive/backend-ts-v6.5/`)

| Module | Lines | Ported to |
|---|---|---|
| core.ts (Durable Object, routing, auth, settings, ingest, calibration loop, scheduler) | 2,901 | `app/` (routers, services, scheduler) |
| v65.ts / v65routes.ts (engine registry, accuracy ledger and hash chain, decisions, experiments, alerts, integrity, collectors, as_of, workbench) | 3,546 | `momento/proof/`, `momento/lab/`, routers |
| intelligence.ts (8-component mixture, earned weights, extras) | 1,289 | `momento/intelligence/mixture.py` |
| v64.ts / v64routes.ts (shapes / Chart Lab, fair solver, deep jobs, reconstruct, seed) | 1,990 | `momento/charts/`, `momento/data/reconstruct.py` |
| analysis.ts, momentum.ts, pipeline.ts, fx.ts | 2,521 | `momento/analysis/`, `momento/intelligence/pipeline.py`, `momento/fx/` |
| calibration.ts, robust-evaluation.ts, point-range.ts, engine-gate.ts, analogue.ts | 1,415 | `momento/intelligence/` (direct ports with golden parity tests) |
| docs.ts | 110 | `app/routers/platform.py` |

40 tables are used: rounds, sessions, sources, users, tokens, forecasts, plugins, plugin_runs, autopilot_decisions, backtest_runs, ingest_log, settings, build_steps, audit_log, top_rounds, vocabulary, releases, orchestrator_log, scheduled_predictions, accuracy_ledger, engine_weights, accuracy_history, round_calibrations, intel_calibrations, forecast_store, ledger_chain, ledger_heads, engines, engine_history, drawn_predictions, decisions, experiments, alert_rules, alerts, ingest_quarantine, ingest_nonces, login_attempts, event_log, deep_jobs, deep_results, shape_predictions, ai_summaries.

### 2.3 Frontend contract (v6.5 `web-momento`)

- The frontend calls 103 distinct route prefixes. The archived backend serves 205 routes (190 static plus pattern routes). **All 205 are rebuilt**, so docs, scripts and integrations keep working; the full matrix is in §9.
- The client is `lib/api.ts`: `fetch(BASE + path)`, bearer token from local storage, and the JSON envelope.
- There is no live WebSocket in the frontend code; the live loop is polling. A WebSocket `/live` is added in P7 as an optional push channel (Ch 16 protocol) without breaking polling.
- The only route the UI calls that is missing from the archived backend is `/api/v1/orchestrator/settings`. It is added fresh.

## 3. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **FastAPI + uvicorn**, Python ≥ 3.11 | Same stack as `momento_core`; async I/O; OpenAPI for free |
| D2 | **stdlib `sqlite3` in WAL mode** with a thin repository layer and a schema-migration table; no ORM in hot paths | The walk-forward calibration loop issues thousands of small queries, so ORM overhead dominates there. The archived 40-table schema is ported 1:1, which makes data import a straight copy. A Postgres adapter can come later behind the same repository API. |
| D3 | **numpy** for vector work; sklearn only inside the optional ML engine (lazy import) | Fast cold start; the ML engine is a candidate, not a dependency of the forecast |
| D4 | **In-process tape state per source** (replaces the Durable Object): a ring of rounds plus incremental analysis, guarded by an asyncio lock; one writer connection plus a read pool | Ingest → forecast stays inside the 250 ms budget (Ch 16) |
| D5 | Heavy work (calibration catch-up, deep jobs, backtests, Chart Lab precision) runs on a **bounded worker pool** with a job table; routes never block more than ~1 s | Robustness under bulk import; matches the deep_jobs contract |
| D6 | **Envelope, auth and hashing are byte-compatible** with the archive: PBKDF2-SHA256 at 100k iterations with a hex salt, tokens stored as `h:` + sha256, the same roles, login throttling | Existing users and exported data move over without resets |
| D7 | **Golden parity tests**: the archived TS modules, built with `esbuild` as before, generate fixtures on seeded synthetic tapes. The Python ports must match the probabilities and quantiles (|Δ| ≤ 1e-6) | Proves the port is faithful before any improvement is made |
| D8 | `momento_core` experts become **candidate engines** (percentile, crash-prediction, ML, signal hunter, band exhaustion, gap swing, collapse ceiling). They are scored every round in shadow and enter the blend **only if the blend gate admits them** (> 2 SE log-loss gain) | "Intelligent" means only what demonstrably improves the forecast is used; this keeps the honesty rules |
| D9 | **Evidence gate, earned point/range selection and loose ranges** carry over unchanged. Confidence is capped at LOW without locked-holdout skill | No regressions in honesty |
| D10 | Settings, as_of, audit and alerts are **cross-cutting middleware/services**, not per-route code | Consistency; less code |
| D11 | Deployment: Dockerfile plus systemd units (api, collector); `MOMENTO_DB`, `MOMENTO_CORS`, `MOMENTO_OPERATOR_*` env; the frontend sets `EXPO_PUBLIC_RORK_FUNCTIONS_URL` to the new host | Matches SYSTEM_SPEC operations; the frontend code is unchanged |

## 4. Architecture

```
backend/
  pyproject.toml          deps: fastapi, uvicorn, numpy; extras: ml (scikit-learn)
  momento_core/           vendored attached core, package name kept so its 83 internal
                          imports and 209 tests work unchanged (linguistics, analysis,
                          prediction, signals, plugins, orchestrator, autopilot) — fixed to green
  momento/                new domain code (pure, no FastAPI imports)
    data/                 rounds, sources, sessions, ingest (validation, dedupe, quarantine,
                          nonces), reconstruct, seed, integrity, collectors
    intelligence/         mixture (8 components + extras), calibration, recalibrator,
                          robust_evaluation, point_range, engine_gate, analogue, pipeline,
                          scoring, evidence
    analysis/             band stats, momentum, mega-pressure, range lab, DNA, investigate
    charts/               shapes / Chart Lab, fair solver, market candles/points/phases
    fx/                   FX engines
    proof/                accuracy ledger + hash chain, decisions, alerts, reliability/PIT/coverage
    lab/                  engine registry, workbench, experiments, backtests, deep jobs, simulate
    operate/              orchestrator (core modules), autopilot, inventory plugins, knowledge/ask
    storage/              sqlite repository, schema.sql, migrations, as_of context
  app/
    main.py               app factory, CORS, envelope + error handlers, as_of middleware
    auth.py               tokens, roles, throttling
    scheduler.py          background loops (calibration, scheduled predictions, alerts)
    jobs.py               bounded worker pool + job table
    routers/              platform, data, linguistics, analysis, intelligence, lab, proof,
                          operate, charts  (see §9)
  tests/                  unit, golden parity, contract, live smoke
  collectors/             downloads/inbox watcher → POST /api/v1/ingest
  deploy/                 Dockerfile, systemd units, env example
archive/backend-ts-v6.5/  the previous backend, unchanged, kept for parity fixtures
web-momento/              v6.5 frontend (unchanged)
```

### 4.1 Request path
Request → CORS → as_of middleware (sets a context var) → auth dependency (optional or operator) → router → service (pure domain plus repository) → envelope. Errors are mapped to `{ok:false, error}` with the archived status codes (400, 401, 403, 404, 409, 410, 429).

### 4.2 Ingest → forecast path
`POST /ingest` validates (finite, ≥ 1.00, ts sanity, nonce or replay check), dedupes on `(source, ts, multiplier)`, and quarantines suspicious rows. It then appends to the tape state, schedules incremental analysis, invalidates forecast caches, and enqueues calibration catch-up (bounded at 300 rounds per batch, as in the archive). Forecasts are cached by `(source, head, ledger stamp, settings hash, as_of)`, as in the archive.

### 4.3 Storage
`schema.sql` reproduces the 40 archived tables (same names and columns) plus `schema_version` and `jobs`. Indexes cover `rounds(source, ts_ms)`, `intel_calibrations(created_ms)`, and `accuracy_ledger(source, created_ms)`. PRAGMAs: `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`. `POST /import` accepts the archive's export format, and a CLI copies a sql.js or D1 dump directly.

## 5. Phases and acceptance

| Phase | Scope | Done when |
|---|---|---|
| **P0** ✅ | Branch `afresh`; archive the TS backend to `archive/backend-ts-v6.5/`; this plan | Pushed (this commit) |
| **P1** ✅ | Vendor `momento_core` into `backend/momento_core/`; fix the 27 failing tests; drop the SQLAlchemy coupling from the pure modules | Vendored suite green |
| **P2** ✅ | Storage + app skeleton: schema, repository, envelope, auth (PBKDF2-compatible), settings, audit, health, users, sources, ingest, rounds, sessions, export/import | Login, ingest and rounds work against the unchanged frontend |
| **P3** ✅ | Intelligence port: mixture, calibration, recalibrator, robust evaluation, point_range, engine_gate, analogue, pipeline, scoring, evidence; forecast and research routes | Golden parity tests pass; the forecast page renders |
| **P4** ✅ | Analysis, linguistics (core engine), momentum, DNA, range lab, mega-pressure, investigate, market, charts / shapes, fair, FX | Every analysis and chart page renders with live data |
| **P5** ✅ | Proof + Lab: accuracy ledger and hash chain, decisions, alerts, engines registry, workbench, experiments, backtests, deep jobs, simulate, seed, reconstruct | Contract test: all 205 routes return a valid envelope |
| **P6** ✅ | Operate: orchestrator (core modules + `/orchestrator/settings`), autopilot, inventory plugins, knowledge/ask, AI summary; `momento_core` experts registered as gated candidate engines | Orchestrator, autopilot and inventory pages work; the gate table lists the new candidates |
| **P7** ✅ | Scheduler, jobs, optional WebSocket `/live` (Ch 16 protocol), collectors CLI, deploy (Docker, systemd), docs | Live smoke: 3,000-round ingest, forecast p95 < 250 ms in-process, all frontend endpoints 200 |
| **P8** ✅ | Evidence: walk-forward backtests (iid, drift) and the gate verdict for every candidate engine; honest results table in the docs | Report committed |

### 5.1 Progress notes and deviations (kept current)

- **Layout.** The routes live in `backend/app/routes.py` (core surface), `app/v64routes.py` and `app/v65routes.py` + `app/v65router.py` (Platform Book), dispatched in the archive's order (security/status → v6.5 → v6.4 → core). This replaces the per-domain `app/routers/*.py` split sketched in §4; behaviour is unchanged and it keeps a 1:1 mapping to the archived files for review.
- **Contract test** (`backend/tests/contract`): regenerates the endpoint list from `web-momento/src` (every `api.get/post/put/del/live` and `useV1` call) plus the §9 matrix — 216 method/path pairs — and calls each one against a seeded database. Result: no 5xx, no missing route, envelope intact; 19 happy-path POST/PUT bodies also return `ok`.
- **Ingest latency.** The archive scored up to 150 full-intelligence backtest forecasts *inside* the first ingest request (64 s for 3,000 rounds on the archived worker run locally). The Python server scores at most `MOMENTO_INGEST_INTEL_BUDGET` (default 10) inline and a background scheduler drains the rest (`MOMENTO_INTEL_DRAIN` per tick). Same rows, same order, same scores — just not on the request path. Live run: 3,000-round ingest returns in 1.9 s.
- **State-sequence memo.** `intelligence.state_sequence` memoises each 40-round window's state label (pure function of the window), halving the cost of a full-intelligence forecast; parity tests unchanged.
- **Users route hardening.** `POST /api/v1/users` now applies the same role allow-list, admin-only-admin rule and 12-character minimum as `/auth/register` (the archive accepted 4 characters and any role there).
- **Time machine.** `as_of` is a request-scoped contextvar, so concurrent requests cannot leak it; the `X-Momento-As-Of` header and the 400 on a bad value match the archive.
- **Federation note.** `/federation` reports `single-process (local SQLite)` instead of the Durable Object wording.
- **Still open:** none — P6, P7 and P8 are complete. Deploy files (`backend/deploy/`) and the scheduler are in.
- **P6 (done):** 7 momento_core experts (percentile, crash prediction, ML, signal hunter, band exhaustion, collapse ceiling, gap swing) registered as shadow candidate engines via `Core.extra_candidates` (`momento/candidates.py`). Candidates appear in `gated_registry().extras`, flow through calibration `comp_loss`, and receive gate verdicts (admit/exclude). Controlled by `MOMENTO_CANDIDATES` env var or `momento_core_candidates` setting.
- **P7 (done):** WebSocket `/live` endpoint added (`app/main.py`) — thin push channel (Ch 16 protocol) that sends `hello` on connect, `round` events on ingest, and `pong` on ping. Does not break polling. Collectors CLI (`app/collectors.py`) reads JSON/CSV files or watches a directory and posts to `/api/v1/ingest`.
- **P8 (done):** Walk-forward backtests on iid and drift synthetic tapes (`momento/evidence.py`). Honest results: no candidate admitted on iid (expected — no signal in random data). Report committed to `docs/markdown/evidence-report.md`.

## 6. Testing

- **Unit:** domain modules (pytest).
- **Golden parity:** TS archive versus Python port on seeded tapes, covering mixture distributions, calibration quantiles, point/range selection, gate verdicts, and analogue distributions.
- **Contract:** every row in §9 is called against a seeded DB and must return an envelope with no 5xx. The frontend's 103 prefixes are additionally checked against the field names the frontend reads (from `web-momento/src/lib/types.ts`).
- **Live smoke:** run uvicorn, ingest, then forecast and research, and build the frontend.
- **Honesty:** iid tapes must never yield a confidence above LOW or a gate admission at 2 SE beyond the expected false-positive rate.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Field-shape drift breaks pages silently | Contract test against `types.ts` plus golden fixtures |
| Python is slower than V8 in the walk-forward loops | numpy vectorisation, caches keyed like the archive, bounded catch-up, and a worker pool |
| `momento_core` heuristics (band exhaustion, signals) add noise | Shadow-only until the blend gate admits them; the core's own 126k-round test reported unvalidated regimes |
| Hosting moves off Cloudflare | Docker/systemd deploy; the frontend URL is set by env; the archived worker stays deployable from `archive/` |

## 8. Migration

1. Export from the archived worker with `GET /api/v1/export?entity=all`.
2. Load it with `POST /api/v1/import`, or with `python -m momento.storage.import_dump`.
3. Point `EXPO_PUBLIC_RORK_FUNCTIONS_URL` at the new API and rebuild the frontend.
4. Users and tokens carry over, because the hashing is compatible.

## 9. Route matrix (205 routes)

The source column means: **momento_core + port** = domain logic from the attached core, with the response shape from the archive. **port** = ported from the archived TS. **fresh** = new (`/orchestrator/settings`). "Called by v6.5 UI" marks the routes the frontend calls.

#### `app/routers/analysis.py` (21 routes)

| Method | Path | Source | Called by v6.5 UI |
|---|---|---|---|
| GET | `/api/v1/analysis` | momento_core + port | yes |
| GET | `/api/v1/analysis/{source}` | momento_core + port | yes |
| GET | `/api/v1/dna/live` | port | yes |
| GET | `/api/v1/dna/scan` | port | yes |
| GET | `/api/v1/investigate/gaps` | port | yes |
| GET | `/api/v1/investigate/range` | port | yes |
| GET | `/api/v1/investigate/round` | port | yes |
| GET | `/api/v1/live/pulse` | port | yes |
| GET | `/api/v1/market/candles` | port | yes |
| GET | `/api/v1/market/live` | port |  |
| GET | `/api/v1/market/points` | port | yes |
| GET | `/api/v1/market/session-phases` | port | yes |
| GET | `/api/v1/market/signals` | port |  |
| GET | `/api/v1/mega-pressure` | port | yes |
| GET | `/api/v1/momentum/anchors` | port |  |
| GET | `/api/v1/momentum/assessment` | port | yes |
| GET | `/api/v1/momentum/hitpoints` | port |  |
| GET | `/api/v1/momentum/overview` | port | yes |
| GET | `/api/v1/range-lab` | port | yes |
| GET | `/api/v1/sequence/search` | port |  |
| GET | `/api/v1/signals/significance` | port |  |

#### `app/routers/charts.py` (8 routes)

| Method | Path | Source | Called by v6.5 UI |
|---|---|---|---|
| GET | `/api/v1/fair/battery` | port |  |
| POST | `/api/v1/fair/chain` | port | yes |
| POST | `/api/v1/fair/solve` | port | yes |
| POST | `/api/v1/fair/verify` | port | yes |
| GET | `/api/v1/shapes/backtest` | port | yes |
| GET | `/api/v1/shapes/gallery` | port | yes |
| GET | `/api/v1/shapes/ledger` | port |  |
| GET | `/api/v1/shapes/project` | port | yes |

#### `app/routers/data.py` (32 routes)

| Method | Path | Source | Called by v6.5 UI |
|---|---|---|---|
| GET | `/api/v1/collectors` | port |  |
| GET | `/api/v1/collectors/disagreements` | port |  |
| GET | `/api/v1/export` | port |  |
| GET | `/api/v1/federation` | port |  |
| GET | `/api/v1/fingerprint` | port |  |
| POST | `/api/v1/import` | port |  |
| POST | `/api/v1/ingest` | momento_core + port | yes |
| GET | `/api/v1/integrity` | port |  |
| GET | `/api/v1/integrity/summary` | port |  |
| POST | `/api/v1/ledger/backfill` | port | yes |
| GET | `/api/v1/ledger/export` | port |  |
| GET | `/api/v1/ledger/forecasts` | port |  |
| GET | `/api/v1/ledger/head` | port |  |
| GET | `/api/v1/ledger/verify` | port |  |
| POST | `/api/v1/reconstruct/clear` | port | yes |
| POST | `/api/v1/reconstruct/config` | port | yes |
| GET | `/api/v1/reconstruct/plan` | port | yes |
| POST | `/api/v1/reconstruct/run` | port | yes |
| GET | `/api/v1/reconstruct/status` | port | yes |
| DELETE | `/api/v1/rounds` | momento_core + port | yes |
| GET | `/api/v1/rounds` | momento_core + port | yes |
| GET | `/api/v1/rounds/export` | momento_core + port |  |
| GET | `/api/v1/rounds/latest` | momento_core + port | yes |
| GET | `/api/v1/rounds/page` | momento_core + port | yes |
| POST | `/api/v1/seed/prime` | port | yes |
| POST | `/api/v1/seed/span` | port | yes |
| POST | `/api/v1/seed/top-rounds` | port | yes |
| GET | `/api/v1/sessions` | port | yes |
| POST | `/api/v1/sessions/rebuild` | port | yes |
| GET | `/api/v1/sources` | port | yes |
| POST | `/api/v1/sources` | port | yes |
| * | `/api/v1/sources/{name}` | port | yes |

#### `app/routers/intelligence.py` (30 routes)

| Method | Path | Source | Called by v6.5 UI |
|---|---|---|---|
| GET | `/api/v1/asof/forecast` | port |  |
| GET | `/api/v1/asof/info` | port |  |
| GET | `/api/v1/asof/property-test` | port |  |
| GET | `/api/v1/calibration` | port | yes |
| GET | `/api/v1/compare` | port |  |
| GET | `/api/v1/forecast/diff` | port |  |
| GET | `/api/v1/forecast/{latest|id}` | port | yes |
| GET | `/api/v1/forecasts` | port | yes |
| GET | `/api/v1/forecasts/accuracy` | port | yes |
| GET | `/api/v1/forecasts/history` | port |  |
| POST | `/api/v1/forecasts/record` | port | yes |
| POST | `/api/v1/forecasts/resolve` | port | yes |
| GET | `/api/v1/forecasts/transitions` | port |  |
| GET | `/api/v1/intelligence/calibrations` | port | yes |
| GET | `/api/v1/intelligence/cone` | port |  |
| GET | `/api/v1/intelligence/distribution` | port |  |
| GET | `/api/v1/intelligence/forecast` | port | yes |
| POST | `/api/v1/intelligence/recalibrate` | port | yes |
| GET | `/api/v1/mixture` | port |  |
| GET | `/api/v1/pipeline/calibrations` | port | yes |
| GET | `/api/v1/pipeline/forecast` | port | yes |
| GET | `/api/v1/pipeline/next-round/band` | port |  |
| GET | `/api/v1/predictions` | port | yes |
| POST | `/api/v1/predictions` | port | yes |
| GET | `/api/v1/research/blend-gate` | port | yes |
| GET | `/api/v1/research/chartlab-precision` | port | yes |
| GET | `/api/v1/research/evidence` | port |  |
| GET | `/api/v1/research/forecast-tuning` | port |  |
| GET | `/api/v1/research/point-range` | port |  |
| GET | `/api/v1/research/recalibration` | port |  |

#### `app/routers/lab.py` (20 routes)

| Method | Path | Source | Called by v6.5 UI |
|---|---|---|---|
| POST | `/api/v1/backtest/run` | port | yes |
| GET | `/api/v1/backtest/run/{id}` | port | yes |
| GET | `/api/v1/backtest/runs` | port | yes |
| GET | `/api/v1/backtest/status` | port | yes |
| GET | `/api/v1/deep/jobs` | port | yes |
| POST | `/api/v1/deep/jobs/delete` | port | yes |
| GET | `/api/v1/deep/result` | port | yes |
| POST | `/api/v1/deep/run` | port | yes |
| GET | `/api/v1/engines` | port | yes |
| POST | `/api/v1/engines` | port | yes |
| POST | `/api/v1/engines/demotion-check` | port |  |
| * | `/api/v1/engines/{key}/state` | port | yes |
| GET | `/api/v1/experiments` | port | yes |
| POST | `/api/v1/experiments` | port | yes |
| POST | `/api/v1/experiments/draft` | port | yes |
| POST | `/api/v1/experiments/{id}/promote` | port | yes |
| POST | `/api/v1/simulate` | port | yes |
| GET | `/api/v1/workbench/families` | port |  |
| POST | `/api/v1/workbench/run` | port |  |
| GET | `/api/v1/workbench/runs` | port |  |

#### `app/routers/linguistics.py` (11 routes)

| Method | Path | Source | Called by v6.5 UI |
|---|---|---|---|
| GET | `/api/v1/dictionary` | port |  |
| GET | `/api/v1/linguistics` | momento_core + port | yes |
| GET | `/api/v1/linguistics/explain` | momento_core + port |  |
| GET | `/api/v1/linguistics/v2` | momento_core + port | yes |
| GET | `/api/v1/vocabulary` | port | yes |
| POST | `/api/v1/vocabulary` | port | yes |
| POST | `/api/v1/vocabulary/discover` | port | yes |
| GET | `/api/v1/vocabulary/discoveries` | port |  |
| GET | `/api/v1/vocabulary/learning/progress` | port |  |
| GET | `/api/v1/vocabulary/learning/status` | port | yes |
| * | `/api/v1/vocabulary/{id}[/deprecate|/formalize]` | port | yes |

#### `app/routers/operate.py` (19 routes)

| Method | Path | Source | Called by v6.5 UI |
|---|---|---|---|
| GET | `/api/v1/ai/metrics` | port |  |
| GET | `/api/v1/ai/summary` | port | yes |
| POST | `/api/v1/ai/summary` | port | yes |
| GET | `/api/v1/autopilot/config` | momento_core + port | yes |
| PUT | `/api/v1/autopilot/config` | momento_core + port | yes |
| GET | `/api/v1/autopilot/decisions` | momento_core + port | yes |
| POST | `/api/v1/autopilot/evaluate` | momento_core + port | yes |
| POST | `/api/v1/autopilot/reset` | momento_core + port | yes |
| POST | `/api/v1/autopilot/start` | momento_core + port | yes |
| GET | `/api/v1/autopilot/status` | momento_core + port | yes |
| POST | `/api/v1/autopilot/stop` | momento_core + port | yes |
| GET | `/api/v1/inventory` | momento_core + port | yes |
| POST | `/api/v1/inventory` | momento_core + port | yes |
| * | `/api/v1/inventory/{id}[/config|/enabled]` | momento_core + port | yes |
| POST | `/api/v1/knowledge/ask` | port | yes |
| GET | `/api/v1/orchestrator` | momento_core + port | yes |
| POST | `/api/v1/orchestrator/evaluate` | momento_core + port | yes |
| GET | `/api/v1/orchestrator/settings` | fresh | yes |
| PUT | `/api/v1/orchestrator/settings` | fresh | yes |

#### `app/routers/platform.py` (45 routes)

| Method | Path | Source | Called by v6.5 UI |
|---|---|---|---|
| GET | `/api/v1/app/gate` | port |  |
| GET | `/api/v1/audit` | port | yes |
| POST | `/api/v1/auth/login` | port | yes |
| GET | `/api/v1/auth/me` | port | yes |
| POST | `/api/v1/auth/register` | port |  |
| GET | `/api/v1/bands` | port |  |
| GET | `/api/v1/baseline` | port |  |
| GET | `/api/v1/brier-score` | port |  |
| GET | `/api/v1/coach` | port |  |
| GET | `/api/v1/eta` | port |  |
| GET | `/api/v1/eta/board` | port |  |
| GET | `/api/v1/eta/hazard` | port |  |
| GET | `/api/v1/eta/inround` | port |  |
| POST | `/api/v1/events` | port | yes |
| GET | `/api/v1/events/summary` | port |  |
| POST | `/api/v1/feed/start` | port | yes |
| GET | `/api/v1/feed/status` | port | yes |
| POST | `/api/v1/feed/step` | port | yes |
| POST | `/api/v1/feed/stop` | port | yes |
| GET | `/api/v1/feed/verify` | port | yes |
| GET | `/api/v1/fx` | port | yes |
| GET | `/api/v1/fx/signals` | port |  |
| GET | `/api/v1/fx/{engine}` | port | yes |
| GET | `/api/v1/health` | momento_core + port | yes |
| GET | `/api/v1/leaderboard` | port |  |
| GET | `/api/v1/platform/book` | port |  |
| GET | `/api/v1/platform/build-steps` | port | yes |
| POST | `/api/v1/platform/build-steps/sync` | port |  |
| GET | `/api/v1/platform/doc/{slug}` | port | yes |
| GET | `/api/v1/platform/docs` | port | yes |
| GET | `/api/v1/platform/download/{file}` | port |  |
| GET | `/api/v1/platform/overview` | port | yes |
| GET | `/api/v1/releases` | port | yes |
| POST | `/api/v1/releases` | port | yes |
| GET | `/api/v1/releases/latest` | port | yes |
| GET | `/api/v1/replay` | port |  |
| GET | `/api/v1/security/status` | port |  |
| GET | `/api/v1/settings` | port | yes |
| GET | `/api/v1/statistics` | port |  |
| GET | `/api/v1/tells` | port |  |
| GET | `/api/v1/top-rounds` | port |  |
| POST | `/api/v1/top-rounds/ingest` | port |  |
| GET | `/api/v1/users` | port | yes |
| POST | `/api/v1/users` | port | yes |
| * | `/api/v1/users/{id}` | port | yes |

#### `app/routers/proof.py` (19 routes)

| Method | Path | Source | Called by v6.5 UI |
|---|---|---|---|
| GET | `/api/v1/accuracy/config` | port |  |
| GET | `/api/v1/accuracy/counterfactual` | port |  |
| GET | `/api/v1/accuracy/coverage` | port |  |
| GET | `/api/v1/accuracy/overview` | port | yes |
| GET | `/api/v1/accuracy/pit` | port |  |
| GET | `/api/v1/accuracy/predictions` | port |  |
| GET | `/api/v1/accuracy/reliability` | port |  |
| POST | `/api/v1/accuracy/tick` | port | yes |
| POST | `/api/v1/accuracy/verify` | port | yes |
| GET | `/api/v1/alerts` | port | yes |
| GET | `/api/v1/alerts/fields` | port |  |
| POST | `/api/v1/alerts/rate` | port | yes |
| POST | `/api/v1/alerts/read` | port | yes |
| GET | `/api/v1/alerts/rules` | port | yes |
| POST | `/api/v1/alerts/rules` | port | yes |
| * | `/api/v1/alerts/rules/{id}[/toggle]` | port | yes |
| GET | `/api/v1/decisions` | port | yes |
| POST | `/api/v1/decisions` | port | yes |
| GET | `/api/v1/decisions/leaderboard` | port |  |