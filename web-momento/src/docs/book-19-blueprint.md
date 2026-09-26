# 19 · Unified Implementation Blueprint

## 19.1 Target architecture
```
                           ┌────────────────────── Cloudflare ──────────────────────┐
 Collectors (Playwright    │  Worker (router, auth, rate-limit)                      │
 WS + DOM, watcher) ──────▶│    ├── Directory DO  (sources, users)                   │
   HMAC-signed batches     │    ├── Source DO × N (SQLite: rounds, sessions,          │
                           │    │     predictions, ledgers, decisions; alarms;        │
                           │    │     WebSocket hibernation fan-out)                  │
                           │    └── R2 (nightly Parquet archive, releases)            │
                           └───────────────▲──────────────────────┬──────────────────┘
                                           │ async                │ Parquet
                              Python sidecar (FastAPI)       Research suite (Python)
                              TSFM / HMM / hazard engines    Experiment Registry, parity
                                           │                      │
                                           └──── MKI (Postgres, +pgvector) ◀──── GitHub webhooks
 Clients: Operator console (5 workspaces) · Terminal · Consumer app · Public track record
```

## 19.2 Monorepo layout
```
momento-platform/
├── packages/engines/        # canonical TS engines: analysis, fx, momentum, intelligence, pipeline, survival
├── packages/schema/         # JSON Schemas → TS + Pydantic types
├── apps/worker/             # core.ts split into routes/, do/, scheduler/
├── apps/console/            # React 19, Graphite Aurora, Lightweight Charts
├── apps/consumer/           # Today / Predictions / Charts / Premium
├── services/sidecar/        # FastAPI: tsfm, hmm, hazard engines
├── research/                # ShapeShifters terminal modules + momento-core research suite + InvestigationSuite
├── knowledge/               # MKI
├── collectors/              # Playwright WS collector, watcher
└── docs/                    # this book
```
Port map:

| Source | Destination |
|---|---|
| `MomentoV5@v6.3:functions/*` | `packages/engines`, `apps/worker` |
| `ShapeShifters@momento-terminal-replace:backend/momento/{survival,windows,randomness,fairness,ev,strategies}` | `packages/engines/survival` (TS port) and `research/` |
| `momento-core@research/*` | `research/` |
| `InvestigationSuite@decomputation` | `research/decomp` and the F-35 spec |
| `MKI@v2` | `knowledge/` |
| `MomentoFresh stride/` | `services/sidecar/stride` |
| `MomentoFX invent/MomentoFX` UI | `apps/console/terminal` |

## 19.3 Roadmap (6 phases, about 24 weeks)
The phases are adapted from the 28-week V6 roadmap (`momento-core@momento-v6-spec Part 4`), resequenced so the measurement foundation comes first.

| Phase | Weeks | Deliver | Exit criteria |
|---|---|---|---|
| **0 · Hygiene & security** | 1 | Revoke and purge `gilabtoke.md` token (H-1); signed ingest (S-1); remove default operator (S-2); close public resolve/backtest routes (S-3); CORS allow-list; remove `--port` DB, `.venv`, committed DBs; gitleaks in CI | Clean secret scan on all repos; Ch 17 security smoke tests green |
| **1 · Foundation** | 2–5 | Monorepo, schema package, engines-parity CI, per-source DOs, event-sourced ledgers, **F-01, F-04, F-18** | Parity 100% on fixture; ledger rebuild matches running sums |
| **2 · Proof** | 6–9 | Bin sums, PIT, ACI → **F-17**; **F-11**; **F-20**; forecast card standard | Coverage error ≤ 2 pp; Reliability Studio live |
| **3 · Intelligence** | 10–14 | **F-12** registry, AdaHedge + fixed-share + sleeping experts, **F-13**; Chronos-2 `tsfm` engine; **F-26** ETA Board with KM + hazard | Each new engine judged on the skill tile, with a bootstrap CI |
| **4 · Terminal & consumer** | 15–19 | **F-21, F-22** (competitive predictor), F-24 replay, **F-35**, F-38 alerts, 5-workspace IA | Leaderboard live; "why" usage ≥ 20% |
| **5 · Decisions & research** | 20–24 | **F-30**, F-31 Auto-Tells v2, F-32, F-33; **F-34** Experiment Registry wired to MKI | Every producer on the Decision Ledger with n ≥ 30 before consumer display |

### 19.3.1 Phase detail
**Phase 0 (week 1).**
- Every item in Ch 17 §17.2.1 marked Critical or High.
- None of it is feature work, but every later number depends on an ingest path nobody else can write to.

**Phase 1 (weeks 2–5), Foundation.** Work items:
1. Monorepo and `packages/schema`: JSON Schemas for `RoundV1`, `ForecastV1`, `Decision` and `AlertV1`, generating TS and Pydantic types.
2. Split `core.ts` (about 2,200 lines) into `routes/`, `do/` and `scheduler/`, behind the same paths.
3. Per-source DOs (F-05 groundwork) and `_schema` migrations.
4. Ledger fixes from Ch 08:
   - V1: like-for-like baselines;
   - V3: void outages;
   - V4: stop reconstructing, store at creation.
5. F-01 Tape Integrity, F-04 `as_of`, F-18 hash chain.
6. Engines-parity CI: TS vs Python golden outputs on a fixed 10k-round fixture, to 1e-9.

Exit when parity is 100% and a ledger rebuilt from rows equals the running sums.

**Phase 2 (weeks 6–9), Proof.** Work items:
- `reliability_bins`, randomised PIT, ACI and block-bootstrap CIs → F-17;
- the F-11 significance strip;
- F-20 auto-demotion;
- the forecast card standard (Ch 16), so no unscored number can be displayed;
- Ch 13 KS fix and fairness audit tables.

Exit when coverage error ≤ 2 pp and the null-tape suite shows no engine with CI-positive skill.

**Phase 3 (weeks 10–14), Intelligence.** Work items:
- the F-12 registry with admission tests (`no_stub_engines`);
- earned mixture with AdaHedge, fixed-share and sleeping experts;
- F-13 regimes;
- the Chronos-2 sidecar engine (Ch 15 Stage A);
- F-26 ETA Board with KM, pressure as a KM percentile and the hazard model gated on held-out log-likelihood;
- Ch 09 fixes M1–M4.

Exit when each new engine appears on the skill tile with a CI, and the mixture is at least as good as its best component out of sample.

**Phase 4 (weeks 15–19), Terminal & consumer.** Work items:
- WebSocket push replacing polling (Ch 16 U1);
- F-21 cone;
- F-22 drawn predictions and leaderboards;
- F-24 replay;
- F-35 explain;
- F-38 alerts;
- the 5-workspace IA;
- the consumer app gated by F-19.

Exit when the latency budget is met, the leaderboard is live and "why" usage is ≥ 20%.

**Phase 5 (weeks 20–24), Decisions & research.** Work items:
- F-30 Decision Ledger;
- F-31 Auto-Tells v2 with Wilson-bound sizing;
- F-32 simulator;
- F-33 coach;
- F-34 Experiment Registry wired to MKI (automatic up to `validating`);
- F-36 Fairness Console.

Exit when every producer is on the ledger with n ≥ 30 before consumer display.

### 19.3.2 Latency budget: ingest to forecast on screen ≤ 250 ms p95
| Stage | Budget (ms) | Owner |
|---|---|---|
| Collector → Worker (network) | 60 | collectors |
| Signature check, validation, dedupe, insert | 15 | worker |
| Incremental analysis `applyRound` (Ch 09) | 20 | engines |
| Engines + mixture (heavy engines cached; sidecar never awaited) | 40 | engines |
| Ledger commit + chain hash | 5 | worker |
| Broadcast over hibernated sockets | 15 | worker |
| Network to client | 60 | — |
| Render (memoised, canvas charts) | 35 | console |
| **Total** | **250** | |

Measure end to end with a client render beacon, correcting for clock offset. Alert at > 500 ms p95 over 10 minutes (Ch 17 SLOs).

### 19.3.3 Team shape
| Track | Phases | Skills |
|---|---|---|
| Platform (Worker, DO, CI, security) | 0–5 | TypeScript, Cloudflare |
| Engines & ledger | 1–3 | TS + Python, statistics |
| Research & sidecar | 3, 5 | Python, forecasting, survival |
| Front-end | 2, 4 | React, charts, real-time |
| Knowledge | 5 | Python, Postgres |

One person per track is enough to run the plan. Platform and Engines are on the critical path.

### 19.3.4 Risks
| Risk | Mitigation |
|---|---|
| Parity drift between TS and Python | Golden-fixture CI (Phase 1), one canonical implementation per engine |
| Ledger numbers change after fixes (V1, V4), and users see skill drop | Publish a changelog. Show old vs corrected numbers side by side for 2 weeks |
| Sidecar cost and latency | Cache per N rounds, abstain on stale results, CPU model first |
| Feature creep from 38 ideas | Only P1 in Phases 1–3. Each P2/P3 feature must name its metric before starting |
| Security debt returns | Security smoke tests in CI block deploys |

## 19.4 Definition of done (every feature)
1. The engine or feature is behind a flag and has a registry entry.
2. It is causal: it passes the Δt firewall test.
3. Parity test passes if it exists in both TS and Python.
4. Its **metric is defined in the ledger**. A before/after skill number with a CI is shown in the PR description.
5. It is explainable: it contributes to F-35 decomputation.
6. It is secure: new routes declare their guard, and the CI security smoke covers them.
7. It is documented: a chapter section in this book is updated, and an MKI object is created or updated.

## 19.5 The one number
Every screen, engine and feature in Momento serves one headline metric: **out-of-sample log-score skill vs the measured baseline**. It is already the "skill vs baseline" tile in v6.3. Protecting its integrity (F-01, F-04, F-17, F-18) and giving every idea a fair shot at moving it (F-12, F-34) is the core of this blueprint.
