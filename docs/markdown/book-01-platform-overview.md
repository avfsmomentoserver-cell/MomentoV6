# 01 · Platform Overview

> **Chapter purpose.** This chapter gives you the whole of Momento before the deep dives: what it is, who it serves, how data moves through it, what vocabulary it uses, and where it stands as of September 2026. It also shows how new features attach to it. Every later chapter zooms into one box of the diagram in §1.3.

## 1.1 What Momento is
Momento, also called AVFS · Momento Core, is an **analytics and forecasting platform for crash-curve round data**. The reference source is Aviator. Each round produces a single number: the multiplier *m* ≥ 1.00× at which the curve stopped. Momento turns that stream of numbers into five capabilities:

| # | Capability | What it means in practice | Main chapters |
|---|---|---|---|
| 1 | **Collect** | Capture every round from the live game (browser/WebSocket), exported files (JSON/CSV/plain) and legacy databases (`avfs.db`) | 03 |
| 2 | **Store** | Keep each round immutable, with provenance: `source`, `ts_ms`, `session_id`, `ingest` channel, `created_ms` | 04, App. A |
| 3 | **Describe** | Render the tape in a shared language (MomentoLinguistics) and in trading-style views (candles, points, anchors, hit-points) | 05, 06, 09 |
| 4 | **Forecast** | Produce next-round band distributions, threshold probabilities, ETAs and time-window outlooks from a family of engines blended by earned weights | 07, 10, 15 |
| 5 | **Verify** | Store every forecast *before* the round lands, score it afterwards, keep a permanent ledger, and feed the result back into the weights | 08 |

The fifth capability is what makes Momento a forecasting *platform* rather than a dashboard. It comes straight from the v5 principles in `MomentoV5@v6.3:docs/markdown/overview.md`: **"Honest accuracy — every forecast is stored before the round resolves and scored afterwards. Nothing can be back-dated."**

## 1.2 Who it serves
The code and docs describe four user types. Each needs different depth.

| Persona | Surfaces | What they need | Where the book helps |
|---|---|---|---|
| **Operator / analyst** | Operator console: Command Center, Market, Forecast Studio, Range Lab, Calibration, Momentum Lab, Darkboard | Full depth, every engine, raw ledgers, ingest control | Ch 06–10, 12, 16 |
| **Consumer** | `/app`, `/app/pro`, `/app/charts`, `/app/premium` | One clear daily card, trusted track record, alerts | Ch 11, 16, F-18, F-22, F-26 |
| **Researcher** | Investigation Suite, Eagle-Eye, Bird's-Eye, research repos | Reproducible experiments, significance testing, decomputation | Ch 12, F-34, F-35 |
| **Builder (you)** | Repos, docs, MKI | A single map of what exists and what to build next | The whole book, especially 02, 18, 19 |

## 1.3 The canonical pipeline
```
┌──────────┐   ┌────────────┐   ┌──────────────┐   ┌────────────────┐   ┌────────┐   ┌───────────┐
│Collector │──▶│ Ingest API │──▶│ Analysis Core│──▶│ Forecast Engine│──▶│   DB   │──▶│ Dashboard │
│(browser, │   │ dedupe,    │   │ linguistics, │   │ 8 engines,     │   │ ledger,│   │ operator +│
│ watcher) │   │ sessionise │   │ ladders, ... │   │ earned mixture │   │ weights│   │ consumer  │
└──────────┘   └────────────┘   └──────────────┘   └────────────────┘   └────────┘   └───────────┘
                                                          ▲                  │
                                                          └── accuracy ledger ┘  (feedback loop)
```
Source: `MomentoV5@main:docs/markdown/architecture.md`, `MomentoV5@v6.3-full-intelligence:functions/*`.

In v6.3 every box above is a module in a single Cloudflare Worker plus Durable Object deployment (`architecture.md`):

| Module | Responsibility (quoted from the architecture doc) |
|---|---|
| `functions/index.ts` | "Entrypoint: CORS + dispatch into the DO" |
| `functions/core.ts` | "The DO: schema, bootstrap, auth, all routes, caching, feed engine" (about 13.8k words, the largest file) |
| `functions/analysis.ts` | "Pure analysis functions — rounds in, metrics out, no I/O" |
| `functions/intelligence.ts` | Full Intelligence: 8 engines, earned mixture, Accuracy Engine v2 |
| `functions/pipeline.ts` | Pipeline forecast, next-round band, calibrations |
| `functions/momentum.ts` | Momentum Lab: points, anchors, hit-points, assessment |
| `functions/fx.ts` | FX Analysis Lab: indicator engines and the FX state machine |
| `functions/docs.ts` | Docs manifest plus reference constants (calibration, range-lab) |

## 1.4 The life of one round (end-to-end trace)
Following one round through v6.3 makes the architecture concrete.

1. **Capture.** A collector sees the curve crash at 3.47×. It POSTs `{ts, multiplier, color, source}` to `/api/v1/ingest` (REST push). The other routes are `/import` (file upload), a watcher that picks up files dropped in `~/Downloads`, or the built-in feed engine (`/feed/step`), which produces provably-fair rounds from a SHA-256 hash chain.
2. **Normalise and dedupe.** The DO normalises the timestamp to `ts_ms` and inserts the round into `rounds`, protected by the unique index `(source, ts_ms, multiplier)`. A second collector sending the same round is a no-op. The insert is written to `ingest_log` and `audit_log`.
3. **Sessionise.** Incremental sessionization for small live batches (`core.ts` line ~636) attaches the round to the open session. A new session starts if the gap since the previous round exceeds 30 minutes, following the Investigation Suite methodology.
4. **Invalidate cache.** The in-memory analysis payload is keyed by `(source, max_round_id)`. The insert moves `max_round_id`, so the next read recomputes (`architecture.md`, "Analysis caching").
5. **Resolve pending forecasts.** Every forecast stored for "the next round" or for a window containing this round is resolved: `actual ∈ {0,1}` per threshold, and a Brier or log-score contribution. The running sums in the Accuracy Engine v2 ledger are updated in O(1) (Ch 08).
6. **Re-forecast.** The pipeline and Full Intelligence engines produce a new distribution over the 6 bands and a threshold ladder. The new forecast is **written to the ledger before the next round arrives**.
7. **Push to screens.** React Query invalidation repaints open views. In v6.3 the live feed is client-driven: the console posts `feed/step` on an interval. WebSocket push is documented as the upgrade path (Ch 16 and 17 cover moving to DO WebSocket hibernation).

The latency budget in the blueprint (Ch 19) is **≤ 250 ms p95 from ingest to new forecast on screen**. This trace shows why that is achievable: steps 2–6 are single-actor, in-memory operations over one SQLite database.

## 1.5 Version lineage
| Generation | Where | Stack | Defining idea |
|---|---|---|---|
| **V5** | `MomentoV5@main`, `@V5.01-backtd`, `@fixes` | FastAPI + SQLAlchemy + SQLite (WAL), React/Vite, Playwright | 8 sub-projects, the 7-state machine, Linguistics, Autopilot |
| **V5-core variants** | `momento-core`, `momento-avfs-core`, `momento-core3`, `momentocore2` | FastAPI / Python | Research suite, FX state machine, fairness visuals, a distributed design |
| **v6** | `MomentoV5@v6`, `@v6-platform` | Cloudflare Worker + Durable Object SQLite, React 19 | Serverless, single-writer store, Graphite Aurora UI |
| **v6.2 / v6.3** | `MomentoV5@v6.3-full-intelligence` (PR #2, merged 26 Sep 2026) | same | Full Intelligence forecast, Accuracy Engine v2, Momentum Lab |
| **Terminal** | `ShapeShifters@momento-terminal-replace` | Python backend + terminal UI | Ports the 6.2 TS bundle to Python, adds survival, EV, fairness and a randomness battery |
| **Side lines** | `MomentoFX`, `MomentoFresh`, `MKI`, `InvestigationSuite`, `avfs-backend`, `MomentoRabbit` | mixed | MT5-style terminal, STRIDE/TSFM, knowledge core, research skeleton, Express backend |

The v5 kernel (`MomentoV5:PROJECT_KNOWLEDGE.md`) lists the ideas that carry across every generation:
- a Round Event Model;
- schema contracts between modules;
- an event bus;
- an **Engine Registry** ("Plugin system for analyzers");
- the intelligence chain **Pattern → DNA → Similarity → Probability → Confidence → Forecast**, in which "each engine is replaceable with clear contracts, independently tested, and produces measurable outputs".

That last sentence is the design goal this book builds on (F-12, Ch 19 §19.4).

## 1.6 The eight sub-projects and their surfaces
Source: `MomentoV5@v6.3:docs/markdown/overview.md`, `PROJECT_KNOWLEDGE.md`.

| # | Sub-project | Responsibility | Surface(s) |
|---|---|---|---|
| 1 | Collector & Ingest | File watcher, REST push, upload, live engine | `/dashboard/ingest` |
| 2 | Analysis Core | Ladders, resistance, streaks, regimes, edge fit | `/dashboard` (Command Center) |
| 3 | MomentoLinguistics | Eight-layer semantic vocabulary | `/dashboard/linguistics`, `/dashboard/vocabulary` |
| 4 | Forecast Engine | Markov + percentile + DNA blend, measured accuracy | `/dashboard/studio`, `/range-lab`, `/calibration` |
| 5 | Decision Orchestrator | Patience, speed, risk, mistake prevention | `/orchestrator` |
| 6 | Autopilot Ledger | Recorded decisions, measured paper P&L | `/dashboard/autopilot` |
| 7 | Plugin Inventory | Analyzer registry with live weights | `/inventory` |
| 8 | Consumer App | Simplified daily guidance, premium tiers | `/app`, `/app/pro`, `/app/charts`, `/app/premium` |

v6.3 adds these surfaces:
- Market & Charts: `/dashboard/market`, `/momento-fx`, `/momento-fx-v2`;
- ShapeShifters research: `/dashboard/darkboard`;
- Investigation Suite: `/dashboard/investigation`, `/eagle-eye`, `/birdeye`;
- Platform & delivery: `/build-steps`, `/downloads`, `/docs`.

## 1.7 Core vocabulary and maths (the minimum you need)
These quantities appear on almost every page of the book.

**Bands.** v6 uses 6 buckets, defined in `analysis.ts`:
```ts
export const BAND_EDGES  = [1.5, 2, 5, 10, 100];
export const BAND_LABELS = ["<1.5x", "1.5–2x", "2–5x", "5–10x", "10–100x", "100x+"];
export const THRESHOLDS  = [1.2, 1.5, 2, 3, 5, 10, 20, 50, 100, 250, 500, 1000] as const;
export const LIVE_THRESHOLDS = [2, 5, 10, 50, 100] as const;
```
V5 Linguistics uses 10 named bands (dust … cosmic; see Ch 05). Every forecast engine in v6.3 outputs a **distribution over the 6 bands**, `dist[6]`. That is the plugin contract in Ch 19.

**Exceedance.** P(m ≥ t) is estimated from the tape with a Wilson 95% interval (`wilson(p, n, z = 1.96)`). The reference crash-curve law is P(≥t) = (1 − h)/t for house edge h. The measured tail fit on the canonical tape is P(≥t) ≈ 0.9497 · t^−1.006. The exponent ≈ −1 is consistent with that law.

**Waiting times.** With per-round rate p for "≥ t", the median wait is ⌈ln 0.5 / ln(1 − p)⌉ rounds (`medianWait`). Chapter 10 replaces this geometric assumption with an empirical Kaplan–Meier curve, which also handles censored gaps.

**Points.** Momentum Lab maps a multiplier to a price-like scale: `points = 100 + 30·log₂(m)`. So 1× = 100, 2× = 130, 4× = 160, 1,024× = 400. Candles, anchors and hit-points are built on this scale (Ch 09).

**Scoring.** The Brier score is BS = mean((p − o)²). The log-score is −log p(observed band). Skill is 1 − score_model / score_baseline, where the baseline is the measured long-run band share. The v6.3 UI shows **skill vs baseline** as its headline tile. This book treats it as *the one number* (Ch 19 §19.5).

## 1.8 The canonical dataset
The v6.3 calibration report (`MomentoV5@v6.3-full-intelligence:docs/markdown/calibration-report.md`) documents the reference tape. Every engine's defaults are tuned against it.

| Metric | Value |
|---|---|
| Rounds | **177,905** across **33 sessions** (2024-01-01 → 2026-08-02 UTC) |
| Sources | `avfs.db` 150,410 · `momento_prev` 18,805 · `project` 8,690 |
| Dedupe / sessionisation | on (timestamp, multiplier); 30-minute gap |
| Mean / median / max | 10.604× / 2.01× / 58,938.65× |
| P(≥2×) · P(≥10×) · P(≥100×) | 50.47% · 9.22% · 0.941% |
| Tail fit | P(≥t) ≈ 0.9497 · t^−1.006 |
| Band χ² (transitions) | 837.6 on 25 dof |

Three observations about this dataset shape the whole platform.

1. **The mean is dominated by the tail.** The mean is 10.6× but the median is 2.01×. Any engine or UI that reports averages will mislead, which is why forecasts are band distributions and quantiles.
2. **The transition χ² needs care.** A χ² of 837.6 on 25 degrees of freedom rejects independence between consecutive bands on this merged tape. That makes it one of the most interesting single numbers in the repos. But it is computed across 33 sessions from 3 sources. Session boundaries, source mixing and capture gaps can all create apparent dependence. Chapter 06 §6.6 and F-01 describe how to rerun it **per session and per source, with gap-free tapes only**, before any engine relies on it.
3. **There is a capture-bias signature.** A measured P(≥2×) of 50.47% implies P(≥2)·2 ≈ 1.009. Under P(≥m) = (1−h)/m, that product should sit just below 1. The likeliest explanation is that very low rounds (such as 1.00×–1.05×) get dropped when a collector misses short rounds. This skews every threshold probability. Feature F-01 (Ch 18) turns this into a platform capability: a *Tape Integrity Score*.

## 1.9 Design principles found across the repos
| Principle | Where it is stated | What it means for new features |
|---|---|---|
| **Observation before prediction** | `overview.md`, `PROJECT_KNOWLEDGE.md` | Every forecast screen starts with the measured present (exceedance, gaps, state) |
| **Immutable raw events** | same | Never UPDATE `rounds`. Corrections go to a separate table (proposed `round_corrections`, App. A) |
| **Explainability is mandatory** | same | Every engine must emit reasons. F-35 makes this a product feature |
| **Honest accuracy** | same | Forecasts are stored before the round lands. F-18 makes this tamper-evident |
| **Earned, not asserted** | `full-intelligence.md`: "HIGH requires demonstrated out-of-sample skill" | Engine weight and displayed confidence come only from the ledger |
| **One vocabulary** | Linguistics docs | Every screen speaks bands, energy and states |
| **Causal by construction** | `ShapeShifters@momento-terminal-replace:backend/momento/strategies.py` | At index *i*, an engine sees only rounds `[:i]` |
| **Ledger never pruned** | `accuracy-engine.md` | O(1) running sums over unlimited history |
| **Local vs production independence** | `PROJECT_KNOWLEDGE.md` | SQLite/local dev must keep working when cloud is added. This is why the blueprint keeps a Python sidecar runnable locally |

## 1.10 Maturity scorecard (September 2026)
This scorecard is my assessment after reading all branches. It tells you where effort pays off first.

| Subsystem | Maturity | Evidence | Biggest gap | Fix |
|---|---|---|---|---|
| Ingest & storage | ●●●○○ | Unique dedupe index, sessionisation, audit log | Single global DO, no gap detection, capture bias | F-01, F-05 |
| Analysis Core | ●●●●○ | Pure functions, Wilson CIs, walk-forward | Some statistics computed on the merged tape | Per-session recompute (Ch 06) |
| Linguistics | ●●●○○ | 8 layers, vocabulary lifecycle table | Promotion rules not tied to significance | F-06, BH gating |
| Forecast engines | ●●●●○ | 8 engines, earned mixture, MEDIUM cap without ≥3% skill | No plugin contract, no regime weights | F-12, F-13 |
| Accuracy | ●●●●○ | Ledger v2, running sums, Brier and log-score | No reliability diagram / PIT / coverage | F-17 |
| Survival / ETA | ●●○○○ | Terminal survival module, empirical + Hill | v6.3 still geometric; no censoring | F-26 |
| Decisions | ●●○○○ | Autopilot ledger, orchestrator engines | Producers not scored on one ledger | F-30 |
| Research | ●●●○○ | Investigation Suite (73 tests), mega plan | Not wired to the product | F-34 |
| Knowledge (MKI) | ●●●○○ | Knowledge model, threat model, DB audit | Not fed by CI | Ch 14 |
| Security | ●●○○○ | PBKDF2 100k, tokens, STRIDE model | Secrets and DBs committed to repos | Ch 17 Phase 0 |

## 1.11 Does the canonical tape fit one law? (measurement O1)
The canonical tape has 177,905 rounds over 33 sessions (App. D, D-1 and D-2). A crash game with house edge h, drawn as \(m = \lfloor (1-h)/(1-r) \cdot 100 \rfloor / 100\), satisfies \(P(m \ge t) = (1-h)/t\) exactly on the cent grid. So \(t \cdot P(m \ge t)\) should be the same constant, \(1-h\), at every threshold. That makes this check the cheapest test of the tape in the book.

| Threshold t | Measured P(≥t) | t · P(≥t) | Expected at h = 3% | Binomial SE of P | z |
|---|---|---|---|---|---|
| 2× | 50.47% | 1.0094 | 0.97 | 0.00119 | **+16.6** |
| 10× | 9.22% | 0.922 | 0.97 | 0.00070 | **−6.8** |
| 100× | 0.941% | 0.941 | 0.97 | 0.00023 | −1.3 |

The SE uses \(\sqrt{p_0(1-p_0)/n}\) with \(p_0 = 0.97/t\) and n = 177,905. The z-scores treat rounds as independent, so read them as a scale, not exact p-values.

**What this rules out.**
- **One fair law with any single edge.** t·P(≥t) falls from 1.009 to 0.922 between 2× and 10×. No single h fits both points.
- **Only losing low rounds.** If a collector dropped low rounds at rate q, every P(≥t) would scale by 1/(1 − q·P(m < 2)). Matching the 2× point needs a factor of 1.041, which predicts P(≥10) = 10.1%. The tape shows 9.22%.
- **The tail fit on its own.** The fit \(0.9497\,t^{-1.006}\) (D-3) gives P(≥2) ≈ 47.3%, well below the measured 50.47%. The fit describes the upper range, not the body.

**What it points to.** The committed research database shows the same signature and gives the cause. In `InvestigationSuite@decomputation:data/avfs.db` (150,416 rows), all rows together give t·P(≥2) = 1.017, t·P(≥10) = 0.916 and χ² = 869. The cause is a single burst of 7,696 rows inserted on 3 July with microsecond timestamps, whose own P(≥2) is 91%. Remove it (plus 39 test, fixture and placeholder rows) and the remaining 142,680 rounds give 0.973, 0.965 and 0.988, with χ² = 27.5 on 25 dof: the fair law at h ≈ 3%, with no transition structure (Ch 06 §6.8).

The canonical 177,905-round tape itself is not committed, so the same check cannot be run on it yet. Its numbers should be treated as **provisional** until they are recomputed per ingest batch. The platform consequences:
- every row carries its provenance (`collector`, `batch_id`, `ts_synthetic`, `kind`);
- burst and duplicate detectors run at ingest;
- every statistic is computed per (source, batch) first and pooled only after the parts agree.

The `source_epochs`, `session_quality` and `ingest_quarantine` tables in App. A exist for this.

**Reproduce.**
```python
import math
n = 177_905
for t, p in [(2, .5047), (10, .0922), (100, .00941)]:
    p0 = .97 / t
    print(t, round(t * p, 4), round((p - p0) / math.sqrt(p0 * (1 - p0) / n), 1))
```

## 1.12 System context and trust boundaries
```
   operator browsers ──HTTPS──┐                ┌── research notebooks (read-only export)
   consumer app  ─────HTTPS───┤                │
                              ▼                │
  collectors ──signed batch──► Worker router ──► per-source DO (tape, ledgers, SQLite)
  (network capture)           │   auth, CORS   │         │ alarms: resolve, calibrate, snapshot
                              │                ▼         ▼
                              │         Directory DO   R2 cold tier (Parquet, backups)
                              ▼
                        Python sidecar (battery, Chronos-2, survival fits) ── MKI (Postgres)
```
There are five trust boundaries. Each has one control in the target design:

| Boundary | Today (v6.3) | Target control | Chapter |
|---|---|---|---|
| Collector → Worker | Anyone can POST `/ingest`; `CORS: *` (S-1) | Per-collector HMAC key, timestamp and nonce; quarantine on failure | 03, 17 |
| Browser → Worker | Bearer token in local storage; some writes unauthenticated (S-3, S-8) | HttpOnly session cookie, explicit guard on every route | 16, 17 |
| Worker → DO | One global object (T3) | One DO per source; Directory for cross-source reads | 04 |
| DO → sidecar | Not wired | Signed internal calls; sidecar results cached and never awaited on the hot path | 15 |
| Sidecar → MKI | Separate service | Read-only role for ask/search; writes only through the extractor | 14 |

## 1.13 Non-functional requirements
| Property | Target | How it is measured |
|---|---|---|
| Ingest-to-screen latency | ≤ 250 ms p95 | Client render beacon (Ch 19 §19.3.2) |
| Ingest durability | 0 acknowledged rounds lost | Collector sequence numbers against stored ids, nightly |
| Tape completeness | ≥ 99% per session, reported | `session_quality.completeness` (F-01) |
| Ledger immutability | Every row in the hash chain | `/ledger/head` checked by an external job (F-18) |
| Forecast honesty | No number shown without a skill tile and n | UI contract test (Ch 16) |
| Reproducibility | Any screen rebuildable `as_of` any time | Replay equals stored output, CI (F-04) |
| Memory per DO | < 32 MB steady state | Window reads plus incremental aggregates (Ch 04 §4.3) |
| Security | No Critical or High findings open | CI security smoke tests (Ch 17) |

## 1.14 Findings index
Each chapter numbers the defects it found in the code. Every finding cites the file it came from. The measured ones also include a reproducible snippet.

| Prefix | Chapter | Topic | Count | Most important |
|---|---|---|---|---|
| O | 01 | Canonical dataset | 1 | O1: tape does not fit one law; the committed tape's cause is a contaminating batch |
| G | 02 | Repo hygiene | 5 | G1: four pairs of identical branches |
| I | 03 | Ingestion | 8 | I1: timestamp-less batches drop repeated low rounds |
| T | 04 | Storage | 6 | T1: whole-tape load of about 29 MB per source |
| L | 05 | Linguistics | 4 | L2: shapes on fair data, ramp or slide ≈ 72% |
| N | 06 | Analysis engines | 7 | N6: duplicate and burst rows, not dynamics, cause the χ² structure |
| E | 07 | Forecast engines | 8 | E7: the n_eff = 60 rule costs log-score on fair data |
| V | 08 | Accuracy | 4 | V1: baseline mismatch |
| M | 09 | Momentum | 4 | M1: +44% rate bias |
| P | 10 | Survival | 4 | P1: something is "overdue" 70.9% of the time |
| D | 11 | Decisions | 5 | D2: decision count depends on polling |
| R | 12 | Research | 2 | R1: early stop on the test fold |
| F1 | 13 | Fairness | 1 | KS test against the wrong CDF |
| A | 15 | AI layer | 6 | A1: stub TSFM wrappers |
| U | 16 | Frontend | 4 | U1: 58 polling timers |
| S / H | 17 | Security | 15 | H-1: token in public repos |

## 1.15 How features attach to the platform
Every feature in Chapter 18 plugs into exactly one or more of five extension points. Designing to these points keeps the platform coherent.

| Extension point | Contract | Example features |
|---|---|---|
| **Collector** | Emits signed batches `{source, rounds[], collector_id}` | F-02, F-03 |
| **Engine** | `predict(rounds, ctx) → dist[6]`, optional `abstain()` | F-12, F-13, TSFM, hazard |
| **Ledger consumer** | Reads predictions and resolutions, never writes rounds | F-17, F-18, F-19, F-20, F-30 |
| **Analysis view** | Pure `(rounds, params) → payload`, cacheable by `(source, max_round_id, params)` | F-07, F-11, F-26, F-27 |
| **Surface** | A route in a workspace that reads only public APIs | F-21, F-22, F-24, F-35, F-38 |

## 1.16 How to read this book
- **Part I (Ch 01–17)** documents what exists. Each chapter has four parts: *what the code does*, *how well it works*, *best-practice design* (with sources), and *features it unlocks*.
- **Part II (Ch 18–19)** is the invention layer: 38 features and the blueprint to build them.
- **Appendices** are the reference: data model (A), APIs (B), glossary (C), measured evidence (D), sources (E).
- Code locations are written `repo@branch:path`. Quoted numbers are the repos' own measured results. Treat them as the baseline every new feature has to beat.
