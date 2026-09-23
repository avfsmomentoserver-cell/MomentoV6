# Orchestrator & Autopilot

## Decision Orchestrator (`/orchestrator`)

Converts measured state into one disciplined answer: **enter** or **skip**.

Inputs:
- **Patience** — how many dry rounds are required before entering (slider, persisted).
- **Minimum confidence** — the bar the measured confidence must clear.
- **Speed profile** — patient / balanced / fast.
- **Risk profile** — conservative / moderate / aggressive.

Confidence starts at 0.4 and earns increments from: dry streak within patience, active dry zone, loaded tail pressure. The guidance panel states the action, the reason chain, and **mistake-prevention notes** (e.g. "do not chase immediately after a streak break — measured continuation offers no edge").

`GET /api/v1/orchestrator` returns settings + live state + guidance; `POST /api/v1/orchestrator/evaluate` records an evaluation into `orchestrator_log`.

## Autopilot Ledger (`/dashboard/autopilot`)

When armed, the autopilot evaluates on every round and records a decision (enter/skip) with reason, stake and **paper P&L** scored against the actual round. The ledger is a discipline tool:

- **Paper P&L** — at threshold T, entering wins `stake·(T−1)` when the round clears T and loses `stake` otherwise. Long-run expectation is `P(≥T)·T − 1` — negative under the house edge, and the ledger shows it honestly.
- **Config** — stake and cashout threshold, persisted server-side.
- **Reset** — clears the ledger (audit-logged).

The original archive's autopilot semantics (patience, speed, risk, mistake prevention, measured P&L) are all carried forward.
