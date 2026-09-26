# 02 · Repository & Branch Atlas

This atlas covers every repository and branch in `avfsmomentoserver-cell`, as of 26 Sep 2026. **Harvest** rates how much a branch should feed the unified platform (Chapter 19): ★★★ = core source of truth, ★★ = port specific modules, ★ = reference only.

## 2.1 MomentoV5 (private, TypeScript/Python): the main platform
| Branch | Last commit | Commits | State | Harvest |
|---|---|---|---|---|
| `v6.3-full-intelligence` | 2026-09-26 | 4 | Full Intelligence next-round forecast, Accuracy Engine v2, Momentum Lab | ★★★ |
| `v6-platform` | 2026-09-26 | 5 | Integration branch; PR #2 merged v6.3 here | ★★★ |
| `v6` | 2026-09-23 | 7 | Command Center forecast panel, moonshot/mega ETAs, watcher config; also holds the most complete **V5 Python backend** (`backend/momento/*`) | ★★★ |
| `V5.01-backtd` | 2026-09-14 | 6 | Backtesting; linked-read docs, shared data setup | ★★ |
| `fixes` | 2026-09-01 | 3 | Initial platform plus a committed `.venv` (remove it) | ★ |
| `main` | 2026-08-30 | 2 | Initial V5 import | ★ |

Key files on `v6.3-full-intelligence`, under `functions/`:

| File | Size | Role |
|---|---|---|
| `core.ts` | 116 KB | Worker router, Durable Object, 25-table schema, `/api/v1/*` |
| `intelligence.ts` | 50 KB | Full Intelligence: 8 engines, state machine, DNA, earned weights |
| `analysis.ts` | 29 KB | Overview, exceedance, streaks, bands, ladders, ceilings, pressure, shape, moonshot, walk-forward, candles, house edge |
| `pipeline.ts` | 26 KB | Windows, per-round probability, next-round forecast, verify-against-history |
| `momentum.ts` | 23 KB | Hit-point candles, anchors, range momentum, moonshot profile, inverted lens, live assessment |
| `fx.ts` | 23 KB | Correlation, volatility, order flow, support density, breakout, mean reversion, trend quality, event risk, divergence |
| `docs.ts` | 8 KB | In-app documentation |
| `--port` | 176 KB | **An accidentally committed SQLite database.** Delete it (Chapter 17) |

Key V5 Python on `v6:backend/momento/`: `analysis.py` (59 KB), `api/routes/mega_pressure.py` (42 KB), `backtest.py` (38 KB), `store.py`, `forecast.py`, `linguistics.py`, `plugins.py`, `autopilot.py`, `vocabulary_learning.py`, `feed.py`, `orchestrator.py`, `watcher.py`. Features live in `backend/features/` (`ai/pattern_learner.py`, `moonshot_scanner/*`, `band_analysis/relativity.py`).

## 2.2 ShapeShifters (Python): research and the newest terminal
| Branch | Last | Commits | State | Harvest |
|---|---|---|---|---|
| `momento-terminal-replace` | 2026-09-25 | 23 | **Newest terminal.** Python port of the 6.2 bundle plus survival, EV, fairness, randomness battery, windows, strategies. Latest: EMA headline (half-life 50), per-round forecast, verification loop | ★★★ |
| `main` | 2026-09-25 | 8 | Unified forecast dashboard with prediction summary | ★★ |
| `implementing-solutions-7421f` | 2026-09-20 | 9 | Uses only `~/Downloads` watched rounds | ★★ |
| `calibrated`, `codespace-special-memory-…` | 2026-09-14 | 2 | Codespace exports (calibration work) | ★ |
| `vs`, `new` | Aug/Sep | 1–4 | Early scaffolds | ★ |

`momento-terminal-replace:backend/momento/` modules: `api.py` (56 KB, ~70 routes), `db.py`, `ingest.py` (35 KB), `windows.py`, `randomness.py`, `pipeline.py`, `strategies.py`, `watcher.py`, `fairness.py`, `math_models.py`, `ev.py`, `survival.py`, `seed.py`. The tests are the best-tested code in the account: `test_ingest`, `test_windows`, `test_reality_checks`, `test_predictor_arming`, `test_migrations`, `test_math_models`, `test_watcher`.

`RESEARCH.md` covers the growth law t(x) = 16.67·ln x, runs test, dry zones, Poisson clustering, Nelson–Aalen, ETA ladder, 6 signal families and κ calibration. There is also a grouped ETA predictor (6 regimes, 5-model ensemble) and a v2 pipeline (HMM, GMM, Pareto Bayesian).

## 2.3 momento-core (Python): V5-core, research and V6 specs
| Branch | Last | Commits | Content | Harvest |
|---|---|---|---|---|
| `research/edge-falsification-suite` | 07-29 | 24 | Edge falsification suite, statistical-honesty skill, free-tier CI | ★★★ |
| `research/csv-suite` | 07-29 | 23 | Causality, scoring and significance tests | ★★★ |
| `momento-v6-spec` | 07-29 | 18 | **V6 specification**: 12 missing features, 28-week roadmap | ★★★ |
| `momento-v6-devin-megaplan` | 07-29 | 20 | Devin AI mega-implementation plan | ★★ |
| `docs/v6-implementation-plan` | 07-29 | 19 | v6 plan, `/v6` entry point | ★★ |
| `main`, `Library` | 08-03 | 25/23 | Library docs structure, `backend/research/*` (profit capping, dynamic strategies) | ★★ |
| `docs/system-documentation-v4` | 07-28 | 2 | Multi-file system docs for v4 | ★★ |
| `feat/v5-realtime-hub-health` | 07-28 | 10 | Realtime hub health | ★★ |
| `ci/free-tier-local-debian` | 07-29 | 32 | Requirements split API/GPU | ★ |
| `momentocore-repository-setup-74595` | 07-29 | 17 | Setup | ★ |

## 2.4 The remaining repositories
| Repo | Branches | What to harvest |
|---|---|---|
| **MKI** (Momento Knowledge Core) | `main` (Phase 6 library analytics and graph), `v2` (extractor fixes) | FastAPI + Postgres + pgvector registry, 31 object types, lifecycle, provenance, STRIDE threat model. ★★★ for the knowledge layer |
| **InvestigationSuite** | `main`, `from-spaces`, `decomputation` | sessionize → ETL → features → train → serve skeleton; 4-layer dedup; **decomputation**: 8 human-readable prediction dimensions and a newbie glossary. ★★★ |
| **MomentoFX** | `main`, `forex-market-simulation-update-63e05`, `momento-core3` | MT5-style terminal (Lightweight Charts, indicators, drawing tools), GPU intelligence, FPGA ingest spec, fairness analytics, measured research (DNA, time patterns, pressure, mega plan). ★★ |
| **MomentoFresh** | `main`, `feature/stride-integration` (78 commits) | **STRIDE**: LLM reasoning distilled into a TSFM (Chronos-2); equal-baseline symmetric points; pressure plugin; Aviator collector; 742-line deployment guide. ★★ |
| **momento-avfs-core** (fork) | `main`, `fx`, `latest-v1`, `fix/prediction-auto-refresh` | FX state machine (13 market states, point conversion, "physics"), moonshot sequence predictor, global DB/watcher, Deriv TradingView integration. ★★ |
| **momento-core3** | `main`, `vibe/fairness-visualization-…` | Core pipeline with forex linguistics; fairness analytics. ★ |
| **momentocore2** | `main`, `forex-simulation-reimplement` | Kafka/Weaviate/K8s agent-swarm design; forex simulation with live streaming. ★ (use for the scale-out design) |
| **avfs-backend** | `main` + 2 `sandbox/*` | Express/SQLite, SSE broadcast, signal detection. ★ |
| **MomentoRabbit** | `main` | README stub. — |
| **azuredev-3867** | none | Empty. — |

## 2.5 Consolidation map
```
            ┌───────────────── canonical runtime ─────────────────┐
MomentoV5@v6.3 (TS engines, DO store, UI)  ◀── port ──  ShapeShifters@momento-terminal-replace
      ▲                                               (survival, windows, randomness, EV, fairness, tests)
      │ features/specs                                 ▲
momento-core@momento-v6-spec / research/*  ────────────┘
      │
MKI (knowledge) · InvestigationSuite@decomputation (explainability) · MomentoFresh (STRIDE/TSFM)
MomentoFX / momento-avfs-core (terminal UX, FX states) · momentocore2 (scale-out design)
```
Recommendation: **one monorepo** (`momento-platform`) with `engines/` (a TS library shared by the Worker and UI), `research/` (Python), `knowledge/` (MKI) and `apps/`. Every other repo gets archived once its modules are ported. Chapter 19 has the details.


## 2.6 Development timeline
The commit history shows five waves. Knowing them tells you which copy of an idea is the newest.

| Window (2026) | Wave | Repos / branches | What happened |
|---|---|---|---|
| mid–late Jul | **Foundations** | `avfs-backend` (07-18), `momento-core` (07-28 → 07-29), `momento-avfs-core@main` (07-31) | Express/SSE prototype; V4 system docs; V5 multi-scope architecture; per-source WebSocket hub (`feat/v5-realtime-hub-health`: "route round/analysis/session events per-source", "accuracy-drift self-awareness"); the **research suite** (`research/csv-suite`: walk-forward splitter, permutation test, skill score with bootstrap CI; `research/edge-falsification-suite`: conformance and independence tests with power controls); the V6 spec and 28-week roadmap |
| early Aug | **Forex and terminal experiments** | `MomentoFX` (08-01), `momento-core3` (08-02), `momentocore2` (08-02), `momento-avfs-core@fx` (08-09), `MomentoFresh` (08-04) | TradingView adapter and MT5-style dashboard; forex linguistics; live streaming; FX state machine; **STRIDE** (78 commits) with a 742-line deployment guide |
| late Aug | **Prediction tuning** | `momento-avfs-core@latest-v1` (08-26), `MomentoV5@main` (08-30) | Moonshot sequence prediction with session filtering; fixes for NaN and prediction lag; V5 import |
| early–mid Sep | **V5 hardening and research** | `MomentoV5@fixes`, `@V5.01-backtd` (09-14), `InvestigationSuite` (09-01 → 09-20), `ShapeShifters` (08-31 → 09-20), `MKI` (09-21/22) | External collector plus downloads watcher; WebSocket transport; decomputation into 8 dimensions; grouped ETA predictor; MKI phases 2–6 (AI provider, doc generation, scheduled research, book production, library analytics) |
| 23–26 Sep | **v6 and the terminal** | `MomentoV5@v6` (09-23), `@v6.3-full-intelligence` → `@v6-platform` (09-26), `ShapeShifters@momento-terminal-replace` (09-25) | Command Center forecast panel; next-round calibration loop ("record every forecast, score vs actual… auto-rectify"); band-partition model with tail-lift; Full Intelligence v6.3.0; terminal EMA headline, per-round forecast, watcher "ingest each archived round exactly once" |

## 2.7 Concept overlap matrix
Most core ideas were implemented several times in different repos. The matrix names the **canonical copy** to keep (●) and the copies to mine for extra ideas (○). Porting decisions in Ch 19 follow this table.

| Concept | MomentoV5 v6.3 (TS) | MomentoV5 v6 (Py) | ShapeShifters terminal | momento-core | MomentoFX / core3 / avfs-core | Other | Canonical choice |
|---|---|---|---|---|---|---|---|
| Ingest + dedupe | ● `core.ts` unique `(source, ts_ms, multiplier)` | ○ `store.py` | ○ `ingest.py` (35 KB, DB inspect, migrations tests) | | ○ FPGA ingest spec | ○ InvestigationSuite 4-layer dedup | v6.3 schema + terminal's DB-inspect/import tooling |
| Sessionisation (30-min gap) | ● `core.ts` batch + incremental | ○ | ○ | | | ○ InvestigationSuite methodology | v6.3 |
| File watcher | | ○ `watcher.py` | ● `watcher.py` ("each archived round exactly once, with its own timestamp"), `test_watcher` | | ○ avfs-core global watcher | | terminal watcher (best tested) |
| Linguistics | ○ `analysis.ts linguistics()` | ● `linguistics.py` (8 layers) + `vocabulary_learning.py` | | | ○ MomentoFX vocabulary system; core3 forex linguistics | | V5 Python semantics, ported to TS |
| State machine | ● `intelligence.ts` (7 states) | ○ V5 7-state | | | ○ avfs-core FX (13 market states); `fx.ts` | | v6.3; FX 13-state used as a regime feature (F-13) |
| Next-round forecast | ● `intelligence.ts` + `pipeline.ts` | ○ `forecast.py` (Markov + percentile + DNA) | ○ `pipeline.py` per-round forecast, EMA headline | ○ research baselines | ○ avfs-core moonshot sequence | | v6.3 earned mixture |
| Accuracy ledger | ● Accuracy Engine v2 (running sums) | ○ `forecasts` Brier table | ○ `/ledger`, `/skill`, `/calibration` | ● scoring with bootstrap CI | | | v6.3 ledger + momento-core CI methods |
| Survival / ETA | ○ `medianWait` (geometric) | ○ mega/moonshot ETAs (v6) | ● `survival.py` (empirical + Hill tail), `/eta`, `/survival` | | | ○ ShapeShifters@implementing grouped ETA | terminal survival, ported to TS |
| Pressure | ○ `pressure()` + tail fit | ● `mega_pressure.py` (42 KB) | | | ○ MEGA_PRESSURE_TRACKER guide | ○ MomentoFresh pressure plugin | redefined as KM percentile (Ch 10) |
| Randomness battery | | | ● `randomness.py` + `/randomness/{test}` | ● independence tests with power controls | | | terminal battery + momento-core power analysis |
| Fairness verification | ○ feed hash chain | ○ `feed.py` | ● `fairness.py` (`/fair/*`) | | ○ MomentoFX `fairness_analytics`; core3 fairness viz | | terminal |
| EV / bankroll | | ○ `autopilot.py` | ● `ev.py` (kelly, martingale, ruin, plan) | ○ profit capping, dynamic strategies | ○ PROFIT_CAPPING_REPORT | | terminal `ev.py` |
| Charts | ○ Recharts | | ○ terminal UI | | ● MomentoFX Lightweight Charts + drawing tools | ○ avfs-core Deriv TradingView | Lightweight Charts (Ch 16) |
| Realtime | ○ client-driven `feed/step` | ○ `hub.py` WS | ○ | ● per-source hub | | ○ avfs-backend SSE; V5.01 WebSocket transport | DO WebSocket hibernation, per-source (Ch 17) |
| Explainability | ○ reasons in forecasts | | | | | ● InvestigationSuite decomputation | decomputation (F-35) |
| Knowledge | ○ `docs.ts` | | | ○ Library docs | | ● MKI | MKI |
| AI / TSFM | | ○ `features/ai/pattern_learner.py` | ○ v2 pipeline (HMM, GMM, Pareto Bayesian) | | ○ MomentoFX GPU intelligence | ● MomentoFresh STRIDE | sidecar engines (Ch 15) |

## 2.8 Porting difficulty and risk
| Module | From → to | Lines/size | Difficulty | Main risk | Mitigation |
|---|---|---|---|---|---|
| `survival.py` | Py → TS `packages/engines/survival` | small | **S** | Numeric drift in Hill estimator | Parity fixture of 10k rounds, tolerance 1e-9 |
| `windows.py`, `randomness.py` | Py → TS (windows) / stay Py (battery) | small | S | Battery is compute-heavy | Keep battery in sidecar, nightly |
| `fairness.py` | Py → TS | small | S | Operator conventions differ | Convention registry (Ch 13) |
| `ev.py` | Py → TS | small | S | Closed-form vs simulation mismatch | Property tests (F-32) |
| `linguistics.py` | Py → TS | medium | M | Semantic drift between V5 and v6 tokens | Golden token file generated by V5 |
| `mega_pressure.py` | Py → redesign | 42 KB | M | Many heuristics with no measured value | Rebuild as KM percentile, keep API shape |
| `core.ts` | split into modules | 116 KB | M | Router regressions | Contract tests from `api-reference.md` |
| MKI | as-is | service | S | Postgres + pgvector ops | Managed Postgres |
| STRIDE | as-is into sidecar | service | L | GPU cost, reproducibility | Start with Chronos-2 zero-shot baseline (Ch 15) |
| MomentoFX terminal UI | JS → React 19 | large | M | Drawing tools state | Keep Lightweight Charts primitives |

## 2.9 Branch census (measured)
These numbers were produced by the script in §2.10 on 26 September 2026. "Files" counts every tracked path. "TS" and "Py" count `.ts/.tsx` and `.py` files, **including vendored ones**, which explains the ShapeShifters and MomentoV5@fixes outliers.

| Repo | Branch | Commits | Files | TS | Py | MD | First | Last |
|---|---|---|---|---|---|---|---|---|
| MomentoV5 | v6.3-full-intelligence | 4 | 188 | 122 | 0 | 49 | 2026-09-23 | 2026-09-26 |
| MomentoV5 | v6-platform | 5 | 188 | 122 | 0 | 49 | 2026-09-23 | 2026-09-26 |
| MomentoV5 | v6 | 7 | 512 | 308 | 86 | 42 | 2026-08-30 | 2026-09-23 |
| MomentoV5 | V5.01-backtd | 6 | 512 | 308 | 86 | 42 | 2026-08-30 | 2026-09-14 |
| MomentoV5 | fixes | 3 | 9,458 | 308 | 3,642 | 60 | 2026-08-30 | 2026-09-01 |
| MomentoV5 | main | 2 | 508 | 308 | 86 | 40 | 2026-08-30 | 2026-08-30 |
| ShapeShifters | momento-terminal-replace | 23 | 149 | 107 | 25 | 3 | 2026-08-31 | 2026-09-25 |
| ShapeShifters | main | 8 | 31 | 0 | 6 | 5 | 2026-08-31 | 2026-09-25 |
| ShapeShifters | implementing-solutions-7421f | 9 | 32 | 0 | 6 | 7 | 2026-08-31 | 2026-09-20 |
| ShapeShifters | calibrated / codespace-… / new | 2 / 2 / 1 | 26,722 / 26,722 / 26,718 | 5,758 | 1 | 573 | 2026-09-11 | 2026-09-14 |
| ShapeShifters | vs | 4 | 16 | 0 | 0 | 3 | 2026-08-31 | 2026-08-31 |
| momento-core | main / Library | 25 / 23 | 764 | 208 | 207 | 159 | 2026-07-28 | 2026-08-03 |
| momento-core | 9 other branches | 2–32 | 390–707 | 188–208 | 84–206 | 62–103 | 2026-07-28 | 2026-07-29 |
| MomentoFX | main / forex-… / momento-core3 | 14 / 14 / 11 | 726 | 209 | 217 | 103 | 2026-07-29 | 2026-08-01 |
| momento-avfs-core | latest-v1 | 10 | 438 | 202 | 101 | 60 | 2026-07-31 | 2026-08-26 |
| momento-avfs-core | fx / fix/… / main | 5 / 4 / 2 | 406–422 | 188–194 | 87–95 | 54–58 | 2026-07-31 | 2026-08-09 |
| MomentoFresh | feature/stride-integration | 78 | 98 | 23 | 54 | 11 | 2026-08-03 | 2026-08-04 |
| MomentoFresh | main | 74 | 96 | 23 | 54 | 9 | 2026-08-03 | 2026-08-04 |
| MKI | v2 / main | 11 / 10 | 154 | 26 | 78 | 21 | 2026-09-20 | 2026-09-22 |
| InvestigationSuite | decomputation | 7 | 71 | 0 | 25 | 7 | 2026-09-01 | 2026-09-20 |
| InvestigationSuite | main / from-spaces | 4 / 3 | 29 | 0 | 14 | 5 | 2026-09-01 | 2026-09-01 |
| momento-core3 | vibe/fairness-visualization-… | 2 | 721 | 208 | 215 | 102 | 2026-07-29 | 2026-08-01 |
| momento-core3 | main | 3 | 15 | 0 | 7 | 2 | 2026-08-02 | 2026-08-02 |
| momentocore2 | forex-simulation-reimplement / main | 8 / 7 | 71 / 66 | 1 | 40 / 35 | 3 | 2026-07-29 | 2026-08-02 |
| avfs-backend | main + 2 sandbox branches | 2–3 | 3 | 0 | 0 | 1–2 | 2026-07-18 | 2026-07-18 |
| MomentoRabbit | main | 2 | 2 | 0 | 0 | 1 | 2026-08-04 | 2026-08-04 |

### 2.9.1 Code overlap across repos
The overlap was measured by comparing git blob hashes of `.py/.ts/.tsx` files, excluding `node_modules` and virtual environments. An identical blob means the file is byte-for-byte the same.

| Pair | Shared files | Share of the smaller repo |
|---|---|---|
| momento-core@main ↔ momento-core3@vibe/fairness-… | 405 | 100% |
| momento-core@main ↔ MomentoFX@main | 403 | 99% |
| MomentoFX@main ↔ momento-core3@vibe/… | 411 | 99% |
| momento-core@main ↔ momento-avfs-core@latest-v1 | 215 | 72% |
| momento-avfs-core@latest-v1 ↔ MomentoV5@v6 | 214 | 72% |
| momento-core@main ↔ MomentoV5@v6 | 211 | 62% |
| MomentoV5@v6.3 ↔ ShapeShifters@momento-terminal-replace | 52 | 43% |

**Reading.** MomentoFX, momento-core and momento-core3 are effectively one codebase in three places. MomentoV5@v6 inherits about two thirds of it. v6.3 is a rewrite that keeps only about 50 shared files, mostly configuration and UI primitives.

### 2.9.2 Findings
| # | Finding | Evidence | Action |
|---|---|---|---|
| G1 | **Four pairs of branches point at identical trees:** MomentoV5 v6-platform = v6.3-full-intelligence; momento-core main = Library; ShapeShifters calibrated = codespace-special-memory-…; MomentoFX main = forex-market-simulation-update-63e05 | Same `^{tree}` hash | Delete one of each pair after tagging |
| G2 | **`node_modules` committed** on ShapeShifters calibrated, codespace-… and new: 26,7xx files, of which 5,136 are under `node_modules/date-fns` alone | `git ls-tree` | Delete the branches or rewrite them without `node_modules` |
| G3 | **`.venv_backend` committed** on MomentoV5@fixes: 8,851 files under `.venv_backend/lib` | `git ls-tree` | Same (H-4 in Ch 17) |
| G4 | **Triplicated core** (§2.9.1), so a fix in one copy does not reach the other two | Blob overlap 99–100% | Keep momento-core@main as the only research source and archive the other two |
| G5 | **Short-lived branches with unclear status**: 3 avfs-backend branches with 3 files each, and `vs` with no source code | Census | Archive |

## 2.10 Reproducing the census
```bash
# run inside a directory holding full clones of every repo
for r in */; do r=${r%/}; ( cd "$r"
  for b in $(git branch -r | grep -v HEAD); do
    n=$(git rev-list --count "$b"); f=$(git ls-tree -r --name-only "$b" | wc -l)
    ts=$(git ls-tree -r --name-only "$b" | grep -cE '\.(ts|tsx)$')
    py=$(git ls-tree -r --name-only "$b" | grep -c '\.py$')
    first=$(git log --reverse --format=%as "$b" | head -1); last=$(git log -1 --format=%as "$b")
    echo "$r|${b#origin/}|$n|$f|$ts|$py|$first|$last|$(git rev-parse "$b^{tree}")"
  done ) ; done
```
```python
# overlap: identical blobs across two refs
import subprocess
def blobs(repo, ref):
    out = subprocess.run(["git", "-C", repo, "ls-tree", "-r", ref], capture_output=True, text=True).stdout
    return {l.split()[2] for l in out.splitlines()
            if l.split("\t")[1].endswith((".py", ".ts", ".tsx")) and "node_modules" not in l}
a, b = blobs("momento-core", "origin/main"), blobs("MomentoFX", "origin/main")
print(len(a & b), len(a & b) / min(len(a), len(b)))
```
Run it in CI of the future monorepo against the archived repos once a month. If the overlap grows after archiving, someone is still editing an old copy.

## 2.11 Archive plan
Once each module has been ported and its parity test passes:
1. Tag the final commit of each branch `archive/<branch>-2026-10`.
2. Set the repo to read-only (archived) on GitHub.
3. Add a `MOVED.md` pointing at the path in `momento-platform`.
4. Remove secrets **before** archiving (Ch 17 Phase 0). An archived repo still exposes its full history.

Repos to archive in the first pass: `MomentoRabbit` (stub), `azuredev-3867` (empty), `avfs-backend`, `momentocore2`, `momento-core3`, `ShapeShifters@vs/new/calibrated/codespace-*`.
