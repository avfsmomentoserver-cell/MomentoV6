# Appendix B · API Reference

## B.1 v6.3 Worker (`MomentoV5@v6.3-full-intelligence:functions/core.ts`)
Paths were extracted from the router source. Methods follow the docs where they are documented. For example, `accuracy/tick`, `accuracy/verify` and `intelligence/recalibrate` are POST.

| Group | Paths |
|---|---|
| **accuracy** | `/accuracy/config` · `/accuracy/overview` · `/accuracy/predictions` · `/accuracy/tick` · `/accuracy/verify` |
| **analysis** | `/analysis` |
| **audit** | `/audit` |
| **auth** | `/auth/login` · `/auth/me` · `/auth/register` |
| **autopilot** | `/autopilot/config` · `/autopilot/decisions` · `/autopilot/evaluate` · `/autopilot/reset` · `/autopilot/start` · `/autopilot/status` · `/autopilot/stop` |
| **backtest** | `/backtest/run` · `/backtest/runs` · `/backtest/status` |
| **bands** | `/bands` |
| **baseline** | `/baseline` |
| **brier-score** | `/brier-score` |
| **calibration** | `/calibration` |
| **eta** | `/eta` |
| **export** | `/export` |
| **feed** | `/feed/start` · `/feed/status` · `/feed/step` · `/feed/stop` · `/feed/verify` |
| **forecasts** | `/forecasts` · `/forecasts/accuracy` · `/forecasts/history` · `/forecasts/record` · `/forecasts/resolve` · `/forecasts/transitions` |
| **fx** | `/fx` · `/fx/signals` |
| **health** | `/health` |
| **import** | `/import` |
| **ingest** | `/ingest` |
| **intelligence** | `/intelligence/calibrations` · `/intelligence/forecast` · `/intelligence/recalibrate` |
| **inventory** | `/inventory` |
| **linguistics** | `/linguistics` · `/linguistics/explain` |
| **market** | `/market/candles` · `/market/live` · `/market/points` · `/market/session-phases` · `/market/signals` |
| **mega-pressure** | `/mega-pressure` |
| **momentum** | `/momentum/anchors` · `/momentum/assessment` · `/momentum/hitpoints` · `/momentum/overview` |
| **orchestrator** | `/orchestrator` · `/orchestrator/evaluate` · `/orchestrator/settings` |
| **pipeline** | `/pipeline/calibrations` · `/pipeline/forecast` · `/pipeline/next-round` · `/pipeline/next-round/band` |
| **platform** | `/platform/build-steps` · `/platform/build-steps/sync` · `/platform/docs` · `/platform/overview` |
| **range-lab** | `/range-lab` |
| **releases** | `/releases` · `/releases/latest` |
| **rounds** | `/rounds` · `/rounds/latest` |
| **sessions** | `/sessions` · `/sessions/rebuild` |
| **settings** | `/settings` |
| **sources** | `/sources` |
| **statistics** | `/statistics` |
| **top-rounds** | `/top-rounds` · `/top-rounds/ingest` |
| **users** | `/users` |
| **vocabulary** | `/vocabulary` · `/vocabulary/discover` · `/vocabulary/discoveries` · `/vocabulary/learning/progress` · `/vocabulary/learning/status` |

Parameterised families also exist: `/analysis/{engine}`, `/fx/{engine}`, `/inventory/{id}`, `/sources/{id}`, `/users/{id}`, `/vocabulary/{token}`, `/backtest/run/{id}`, `/platform/doc/{slug}`, `/platform/download/{file}`.

## B.2 ShapeShifters terminal (`ShapeShifters@momento-terminal-replace:backend/momento/api.py`)
| Method | Paths |
|---|---|
| GET | `/health` `/meta` `/settings` `/rounds` `/sessions` `/stats/summary` `/analysis` `/forecast` `/context` `/curves` `/dna` `/ladder` `/eta` `/survival` `/exceedance` `/windows` `/droughts` `/phases` `/randomness` `/randomness/{test}` `/calibration` `/skill` `/ledger` `/backtest/grid` `/ev/table` `/ev/kelly` `/ev/martingale` `/ev/plan` `/fair/hash` `/fair/conventions` `/fair/audits` `/fair/tape` `/alerts` `/annotations` `/seed` `/sim/status` `/export` `/sessions/{id}/bets` |
| POST | `/rounds` `/rounds/bulk` `/rounds/reseed` `/rounds/purge-simulator` `/ingest/db` `/ingest/db/inspect` `/predictions/arm` `/backtest` `/ev/ruin` `/fair/verify` `/fair/verify-batch` `/fair/chain` `/fair/solve` `/alerts` `/annotations` `/sessions` `/sessions/{id}/bets` `/sessions/{id}/close` `/sim/start` `/sim/stop` |

## B.3 v6.3 route guards (as coded)
| Guard | Routes |
|---|---|
| none | `/ingest` (**S-1**), `/forecasts/resolve` (**S-3**), all GET analysis routes |
| optional user | `/forecasts/record`, `/backtest/run` |
| `requireOperator` | `/import`, `DELETE /rounds`, `DELETE /sources/{name}`, `/autopilot/*` controls, `/intelligence/recalibrate`, `/auth/register`, settings, users, vocabulary writes |
| disabled (410) | `/feed/start`, `/feed/step`, `/feed/verify` |

The envelope is `{ok: true, data}` / `{ok: false, error}`. CORS is `*` (Ch 17).

## B.4 Proposed endpoints (this book)
Guards: **P** = public read, **U** = user, **O** = operator, **C** = signed collector, **I** = internal (scheduler only).

| Endpoint | Guard | Feature / chapter |
|---|---|---|
| `POST /ingest` (HMAC headers `X-Collector`, `X-Ts`, `X-Nonce`, `X-Sig`) | C | Ch 17 S-1 |
| `GET /integrity?source=&session=`, `GET /integrity/summary?source=&days=` | P | F-01 |
| `GET /collectors?source=`, `GET /collectors/disagreements?source=` | O | F-02 |
| `GET /fingerprint?source=` | P | F-03 |
| `?as_of=ts_ms` on `/analysis`, `/intelligence/*`, `/eta/*`, `/accuracy/*` | P | F-04 |
| `GET /vocabulary/{id}/page` | P | F-06 |
| `GET /sequence/search?pattern=&k=&source=` | U | F-07 |
| `POST /workbench/run`, `GET /workbench/runs` | O | F-09 |
| `GET /compare?a=&b=&metric=` | U | F-10 |
| `GET /signals/significance?source=` | P | F-11 |
| `GET /engines`, `POST /engines`, `POST /engines/{key}/state`, `GET /engines/{key}/history` | P / O | F-12, F-20 |
| `GET /mixture?source=&by=regime` | P | F-13 |
| `GET /forecast/diff?source=&from=&to=` | P | F-14 |
| `GET /intelligence/distribution?source=` | P | F-15 |
| `GET /accuracy/counterfactual?without=` | U | F-16 |
| `GET /accuracy/reliability?model=&window=&threshold=`, `/accuracy/pit`, `/accuracy/coverage` | P | F-17 |
| `GET /ledger/head`, `GET /ledger/export?from=` | P | F-18 |
| `GET /intelligence/cone?source=&h=` | P | F-21 |
| `POST /predictions`, `GET /leaderboard?period=` | U / P | F-22 |
| `GET /replay?source=&from=&to=` (streamed) | U | F-24 |
| `GET /eta/board?source=`, `GET /eta/hazard?source=&T=`, `GET /eta/inround?source=&m0=` | P | F-26 to F-29 |
| `GET /decisions?producer=`, `GET /decisions/leaderboard` | P | F-30 |
| `GET /tells?source=` | U | F-31 |
| `POST /simulate` | U | F-32 |
| `POST /experiments`, `GET /experiments/{id}` | O / P | F-34 |
| `GET /forecast/{id}/explain` | P | F-35 |
| `POST /fair/verify`, `POST /fair/solve`, `GET /fair/audit`, `GET /fair/battery`, `GET /fair/edge` | P | F-36 |
| `GET /knowledge/ask?q=` | O | F-37 |
| `POST /alerts/rules`, `GET /alerts` | U | F-38 |
| `POST /accuracy/rebuild` | O | Ch 04 |
| `WS /live` (hello with `sources`, `lastSeq`) | P / U | Ch 16 |
| resolution job (no public route) | I | Ch 08, S-3 |
