# v6.5 Platform Book Edition

v6.5 implements **The Momento Platform Book** (repo `momento-platform-book`): the full Chapter 18 feature catalogue (F-01…F-38), the Chapter 17 Phase 0 security fixes, and the complete book bundled into the Documentation Center (section "Platform Book").

## What's new at a glance

- **Proof** — Track Record (hash-chained forecast ledger, verifiable in your browser), Reliability (calibration by bucket, Brier/log-loss skill with CIs), Integrity (duplicates, gaps, collector consensus, federation), Explain (per-forecast attribution and signal significance), Fairness Console (RTP, test battery with BH correction, Spribe-style verifier, convention solver, seed-chain walk, CUSUM fingerprints), Platform Book (live status of every feature + security checks).
- **Lab** — Engine Registry (shadow → candidate → admitted, earned by out-of-sample skill), Experiments (plain-English hypothesis → pre-registered test), ETA Board (Kaplan–Meier percentiles of current gaps), Predict & Cone, Replay, Multi-timeframe, Decisions (fractional Kelly on Wilson lower bounds, bootstrap drawdown), Simulator, Living Dictionary (discovery/held-out validation of vocabulary), Sequence Search & source Comparator, Alerts Center (debounce, caps, rated precision), Ask Momento (BM25 over docs + book, cited answers, refuses without support).
- **Time machine (F-04)** — the clock control in the top bar sets `as_of`; every GET is answered with what the platform knew at that instant (rounds with `ts < as_of` that had been ingested by then; imported/reconstructed history counts as known at its own timestamp). An amber banner shows while it is active. Responses carry `X-Momento-As-Of`.
- **Command Center** shows a signal-significance strip; **Market** shows the forecast cone; the consumer **Today** page shows the F-34 gate label (model only when it has earned skill, otherwise the labelled base rate).
- **Alerts bell** in the top bar with unread count.

## Feature catalogue (Chapter 18)

| id | feature | status | where | api (/api/v1) |
|---|---|---|---|---|
| F-01 | Tape Integrity Score | live | /dashboard/integrity | `/integrity, /integrity/summary` |
| F-02 | Multi-collector consensus | partial | /dashboard/integrity | `/collectors, /collectors/disagreements` |
| F-03 | Source fingerprinting (CUSUM) | live | /dashboard/fairness | `/fingerprint` |
| F-04 | Time-travel queries (as_of) | live | TopBar time control | `?as_of=, /asof/*` |
| F-05 | Per-source sharding / federated view | partial | /dashboard/integrity | `/federation` |
| F-06 | Living Dictionary | live | /dashboard/dictionary | `/dictionary, /vocabulary/{id}/page` |
| F-07 | Sequence search | live | /dashboard/sequence | `/sequence/search` |
| F-08 | Narrated replay | live | /dashboard/replay | `/replay` |
| F-09 | Engine Workbench | live | /dashboard/engines | `/workbench/run, /workbench/runs` |
| F-10 | Cross-source comparator | live | /dashboard/sequence | `/compare` |
| F-11 | Signal significance strip | live | Command Center | `/signals/significance` |
| F-12 | Engine Marketplace / registry | live | /dashboard/engines | `/engines, /engines/{key}/state` |
| F-13 | Regime-aware weights | live | /dashboard/engines | `/mixture?by=regime` |
| F-14 | Forecast diff | live | /dashboard/explain | `/forecast/diff` |
| F-15 | Distribution explorer | live | /dashboard/explain | `/intelligence/distribution` |
| F-16 | Counterfactual engine toggle | live | /dashboard/engines | `/accuracy/counterfactual` |
| F-17 | Reliability Studio | live | /dashboard/reliability | `/accuracy/reliability, /pit, /coverage` |
| F-18 | Tamper-evident track record | live | /dashboard/track-record | `/ledger/head, /ledger/export, /ledger/verify` |
| F-19 | Accuracy gates per tier | live | consumer app | `/app/gate` |
| F-20 | Auto-demotion and alerts | live | /dashboard/engines | `/engines/{key}/history` |
| F-21 | Forecast cone on chart | live | Market, /dashboard/predict | `/intelligence/cone` |
| F-22 | Drawn predictions + leaderboard | live | /dashboard/predict, /app/charts | `/predictions, /leaderboard` |
| F-23 | Multi-source terminal | live | /dashboard/multi | `/candles per source` |
| F-24 | Replay mode | live | /dashboard/replay | `/replay` |
| F-25 | Anchor alerts | live | /dashboard/alerts | `alert preset` |
| F-26 | ETA Board | live | /dashboard/eta | `/eta/board` |
| F-27 | Hazard timeline | live | /dashboard/eta | `/eta/hazard` |
| F-28 | ETA alerts | live | /dashboard/alerts | `alert preset` |
| F-29 | In-round live ETA | live | /dashboard/eta | `/eta/inround` |
| F-30 | Decision Ledger + producer leaderboard | live | /dashboard/decisions | `/decisions, /decisions/leaderboard` |
| F-31 | Auto-Tells v2 | live | /dashboard/decisions | `/tells` |
| F-32 | Bankroll Simulator | live | /dashboard/simulator | `/simulate` |
| F-33 | Session Coach | live | /dashboard/simulator | `/coach` |
| F-34 | Experiment Registry | live | /dashboard/experiments | `/experiments` |
| F-35 | Explain-this-forecast | live | /dashboard/explain | `/forecast/{id}/explain` |
| F-36 | Fairness Console | live | /dashboard/fairness | `/fair/*` |
| F-37 | Ask Momento | live | ⌘K / /dashboard/ask | `/knowledge/ask` |
| F-38 | Alerts Center | live | /dashboard/alerts + TopBar bell | `/alerts, /alerts/rules` |

"Partial" means the engine and API ship but need a second live collector (F-02) or multiple deployed shards (F-05) to be fully exercised.

## Phase 0 security (Chapter 17)

| id | fix |
|---|---|
| S-1 | HMAC-signed ingest: `X-Momento-Ts`, `X-Momento-Nonce`, `X-Momento-Signature = hex(HMAC-SHA256(secret, ts + "\n" + nonce + "\n" + body))`; 60 s skew, nonce replay table, failures quarantined. Enabled when `INGEST_HMAC_SECRET` (env) or the `ingest_hmac_secret` setting is present. |
| S-2 | Bootstrap operator password from `SETUP_PASSWORD` (falls back to the dev default and is reported as "action"). |
| S-3 | Resolving forecasts needs an operator; running backtests needs a signed-in user. |
| S-4 | Registration role allow-list; only an admin can create an admin; passwords ≥ 12 characters. |
| S-5 | Session tokens stored as SHA-256 hashes (legacy tokens still accepted until they expire). |
| S-6 | CORS allow-list from `CORS_ORIGINS` (comma-separated); `*` only when unset. |
| S-7 | Login backoff per email+IP and constant-time comparisons. |
| S-8/S-9 | Tracked junk files removed; status endpoint `GET /api/v1/security/status` reports every check. |

## Deploy checklist

1. Set `INGEST_HMAC_SECRET`, `SETUP_PASSWORD`, `CORS_ORIGINS` on the worker.
2. Update your collectors to sign requests (see S-1).
3. Rotate the default operator password and any API keys that have been shared in chat or commits.
4. Open **Platform Book** in the console and confirm all checks pass.
