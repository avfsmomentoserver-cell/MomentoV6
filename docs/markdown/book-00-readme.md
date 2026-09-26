# The Momento Platform Book

The engineering book for the **Momento Platform**, also called **AVFS · Momento Core**. It is written for the people who build it.

This book was put together by going through all 13 repositories and 50+ branches in the `avfsmomentoserver-cell` GitHub account. That covered 1,766 unique files and 293 design documents. It has two jobs:

1. **Knowledge source.** It records what each part of Momento is, where it lives, how it works and how the versions relate to each other.
2. **Invention engine.** It gives a researched, concrete catalogue of new forecasting-platform features. Each part of Momento also gets a recommended implementation blueprint, backed by external technical references.

Every chapter follows the same pattern:

> **What exists** (repo · branch · file) → **How it works** → **Best implementation** (with references) → **Features to invent** → **How to measure it**

## Table of contents

### Part I: The platform as it is
| # | Chapter | Covers |
|---|---------|--------|
| 01 | [Platform overview](chapters/01-platform-overview.md) | Mission, pipeline, version lineage (V5 → v6 → v6.3), the canonical dataset |
| 02 | [Repository and branch atlas](chapters/02-repo-branch-atlas.md) | All 13 repos and every branch: purpose, state and what to harvest from each |
| 03 | [Data collection and ingestion](chapters/03-ingestion.md) | Collectors, watchers, the ingest API, dedupe, sessionisation, data quality |
| 04 | [Storage and data model](chapters/04-storage.md) | SQLite WAL, Durable Object SQLite, Postgres/pgvector, the 25-table model |
| 05 | [MomentoLinguistics](chapters/05-linguistics.md) | The 8-layer vocabulary, points scale, vocabulary lifecycle |
| 06 | [Analysis engines](chapters/06-analysis-engines.md) | Ladders, ceilings, streaks, bands, exceedance, pressure, shape, FX engines |
| 07 | [Forecast engines and Full Intelligence](chapters/07-forecast-engines.md) | 8 engines, the 7-state machine, DNA, the earned Bayesian mixture, confidence |
| 08 | [Accuracy and verification](chapters/08-accuracy.md) | Accuracy Engine v2, Brier/log-loss ledger, walk-forward, calibration |
| 09 | [Momentum Lab and the trading terminal](chapters/09-momentum-terminal.md) | Hit-point candles, anchors, MomentoFX terminal, charts |
| 10 | [Survival, ETA and Moonshot](chapters/10-survival-eta.md) | Survival curves, tail fitting, Nelson–Aalen, Cox PH, ETA ladders |
| 11 | [Decisions, Autopilot and Bankroll](chapters/11-decision-autopilot.md) | Orchestrator, Auto-Tells, paper ledger, EV, staking, profit capping |
| 12 | [Research and investigation suite](chapters/12-research-suite.md) | Edge falsification, the 9 statistical rules, InvestigationSuite, decomputation |
| 13 | [Fairness verification](chapters/13-fairness.md) | Seed-chain and HMAC verification, fairness analytics |
| 14 | [Momento Knowledge Core (MKI)](chapters/14-knowledge-core.md) | Knowledge registry, 31 object types, lifecycle, pgvector |
| 15 | [AI layer: STRIDE, TSFMs and agents](chapters/15-ai-layer.md) | STRIDE distillation, Chronos-2, pattern learner, `.devin` agents, MDOS |
| 16 | [Front-end and UX](chapters/16-frontend.md) | ~20 operator screens, consumer app, Graphite Aurora theme |
| 17 | [Infrastructure, security and ops](chapters/17-infra-security.md) | Cloudflare, local dev, CI, threat model, repo hygiene findings |

### Part II: What to build next
| # | Chapter | Covers |
|---|---------|--------|
| 18 | [Feature invention catalogue](chapters/18-feature-catalogue.md) | 38 new forecasting-platform features, each with algorithm, API, UI and measurement plan |
| 19 | [Unified implementation blueprint](chapters/19-blueprint.md) | Target architecture, service boundaries, 6-phase roadmap, definition of done |

### Appendices
| | Appendix | |
|---|---|---|
| A | [Data model reference](appendices/A-data-model.md) | Every table and its columns and indexes |
| B | [API reference](appendices/B-api.md) | v6.3 Worker `/api/v1/*` and ShapeShifters terminal API |
| C | [Glossary](appendices/C-glossary.md) | Momento vocabulary A–Z |
| D | [Evidence ledger](appendices/D-evidence-ledger.md) | Every measured result recorded in the repos, with its location |
| E | [Sources](appendices/E-sources.md) | External technical references used in this book |

## How to use this book
- **Inventing a feature:** open Chapter 18 and pick an entry. Each one names the chapter holding the relevant engine, the tables it touches and the metric that proves it works.
- **Choosing which branch to build on:** Chapter 02 ranks every branch as a harvest source.
- **Implementing:** Chapter 19 gives the order to build in. Each subsystem chapter ends with a "Best implementation" section.

## Conventions
- `repo@branch:path` points to a source location, for example `MomentoV5@v6.3-full-intelligence:functions/intelligence.ts`.
- **Measured** means the number appears in a repo document or test and is quoted in Appendix D. **Proposed** means this book recommends it.
- Secrets found in the repos are **never** reproduced here. See Chapter 17 §Hygiene.

---
Compiled 26 September 2026 from the repositories as they stood that day, including PR #2 `v6.3-full-intelligence`, merged the same day.
