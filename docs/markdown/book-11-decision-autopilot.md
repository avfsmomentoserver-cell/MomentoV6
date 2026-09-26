# 11 · Decisions, Autopilot & Bankroll

This chapter covers the layer that turns forecasts into **actions**: instructions, paper decisions, stake sizes and session limits. It:
- walks through the V6 orchestrator and the Autopilot ledger as coded, and notes five semantic issues that change what the ledger measures;
- maps trading vocabulary (entry, exit, stop) onto what a crash round actually offers;
- specifies a single `Decision` record, ledger-driven sizing, a Guard engine and the promotion rules that decide what users see.

## 11.1 What exists
### 11.1.1 Decision Orchestrator (`MomentoV5@v6:backend/momento/orchestrator.py`)
`plan(payload, performance)` combines five parts:
- `patience_engine`: whether to wait;
- `speed_engine`: how fast to act;
- `risk_engine`: exposure against performance;
- `mistake_prevention`: guardrails built from recent performance;
- `instruction`: a plain-language instruction with `action`, `confidence`, `target_multiplier`, `stop_multiplier`, `position_size` and `detail`.

The Worker equivalents are `/api/v1/orchestrator`, `/evaluate` and `/settings`, plus the `orchestrator_log` table.

### 11.1.2 Autopilot ledger (`MomentoV5@v6:backend/momento/autopilot.py`, table `autopilot_decisions`)
Default config:
```python
{"enabled": False, "source": "aviator", "max_risk_per_round": 0.02, "daily_loss_limit": 0.15,
 "max_consecutive_losses": 3, "min_confidence_threshold": 0.45, "execution_delay_ms": 400,
 "base_position_size": 10.0, "position_sizing_method": "confidence_scaled",
 "ceiling_analyzer_weight": 0.35, "gap_swing_analyzer_weight": 0.30, "linguistic_analysis_weight": 0.35}
```
The flow, as coded:
1. **`_weighted_signals`** blends three analyser scores:
   - ceiling: `max(0, resistance.pressure − 0.5·collapse.strength)`;
   - gap swing: the full score if direction is up, 0.25× if flat, 0 if down;
   - linguistic: `max(state_scores.Ignition, state_scores.Moonshot)`.

   The composite is their weighted mean.
2. **`evaluate`** calls `orchestrator.plan`. If the orchestrator says ENTER but `composite < 0.45 × 0.6 = 0.27`, the action is downgraded to PREPARE. It records entry = the **latest** multiplier, exit = target, stop and size.
3. **`resolve(source, round_id, multiplier)`** settles up to 50 open decisions with `round_id < current`:
   - ENTER and m ≥ target: `pnl = size·(target − 1)`, won;
   - ENTER and m < target: `pnl = −size`, lost;
   - otherwise pnl 0.
4. **`performance`**, `equity_curve` and `reset` report on this. All P&L is **paper**.

### 11.1.3 V6 spec: Auto-Tells (`momento-core@momento-v6-spec §3.2, §3.8`)
- `AutoTellSignal{action ENTER/EXIT/HOLD/SKIP, confidence, recommended_stake (Kelly), entry_range, exit_targets[], stop_loss, risk_reward_ratio, expected_value, reasoning[], contributing_factors, backtested_performance}`
- `RiskAssessment{overall_risk_score, volatility, prediction_uncertainty, bankroll_exposure, consecutive_losses, drawdown_percentage}`
- `BankrollManager{total, current, allocated, reserved, max_bet_percentage 1–2%, kelly_criterion_factor (fractional), stop_loss_daily, take_profit_daily, position_sizing_method fixed|kelly|martingale_safe|fibonacci_safe}`

### 11.1.4 Signal families (`ShapeShifters RESEARCH.md §9`)
| Family | Trigger | Entry | Target | Stop | Horizon |
|---|---|---|---|---|---|
| dry-rebound | ≥ 2 consecutive < 1.5× | 1.5–2.5 | 2–4 | 1.2 | 6 |
| streak-continuation | win streak ≥ 3 | 1.6–3 | 2.5–5 | 1.3 | 4 |
| moonshot-pressure | momentum ≠ weak ∧ P(moon) ≥ 55 | 1.8–6 | 5–12 | 1.4 | 10 |
| volatility-compression | v_L < 0.35 ∧ last 8 ∈ [1.1, 3] | 1.5–2.5 | 3–6 | 1.25 | 8 |
| momentum-build | d > 0.15 | 0.9m–1.4m | 1.3m–2m | 0.75m | 5 |
| floor-defend | ≥ 10/20 < 1.5× | 1.2–1.8 | 2–3.5 | 1.05 | 6 |

**Sensitivity** s ∈ [0, 100] sets the firing threshold at 70 − 0.3·s. **κ calibration** scales the displayed confidence (Ch 08).

### 11.1.5 Bankroll, EV and capping
| Location | Content |
|---|---|
| `ShapeShifters@momento-terminal-replace:backend/momento/ev.py` | `ev_table` (per-game edges, e.g. Spaceman 3.8%, RTP 96.2%), `kelly`, `expected_loss`, `risk_of_ruin`, `martingale_analysis`, `bankroll_plan`. It returns an explicit message when Kelly is ≤ 0 |
| `momento-core@main:backend/research/profit_capping.py` + `MomentoFX research/PROFIT_CAPPING_REPORT.md` | Capping modes fixed/dynamic/tiered/hybrid. Tiers: Starter $100–500 (cap 25%, max bet 5%), Growth $500–2k (30%, 8%), Advanced $2–5k (40%, 10%), Expert $5–10k (50%, 12%), Professional $10k+ (50%, 15%). The documented backtest reports 17.6% ROI with 74.7% of the cap used (App. D) |
| `backend/research/dynamic_strategies.py`, `strategies.py` | Strategy library (dynamic confidence, `strategy_grid`, strictly causal backtest) |
| Terminal pages | Bankroll, EV, Strategy, Responsible |

The mega plan in the evidence ledger tested strategies on 60,215 rounds and found none that beat the baseline. Streak 50×/3 showed 90.38% accuracy with F1 0.08, which is the base-rate effect (App. D). The Decision Ledger below is designed so that such results appear automatically for every producer.

## 11.2 What a crash decision actually is
A crash round offers one decision per stake: the **cash-out target x**, set before the round or taken manually during it. Trading words map as follows:

| Trading term | Crash meaning | Current code |
|---|---|---|
| Entry | Joining the next round (price is always 1.00×) | `entry_point` = latest multiplier (not meaningful) |
| Exit / target | Cash-out multiplier x | `exit_point`, used in `resolve` |
| Stop-loss | No equivalent inside a round: a lower cash-out is just a smaller x. Across rounds it means "stop after L losses" | `stop_loss` stored, **never used** in `resolve` |
| Horizon | Number of rounds the signal stays valid | Not stored; decisions settle on the next round |

For a single stake at target x with win probability p, the net odds are b = x − 1, so:
\[ \text{EV per unit} = p\,x - 1, \qquad f^* = \frac{p\,x - 1}{x - 1}, \qquad p_{\text{break-even}} = \frac1x. \]
Under the published law P(M ≥ x) = (1 − h)/x, EV = −h at **every** x, so f* < 0 at every x. `ev.py` already encodes this. A producer can therefore justify a stake only if its **ledger-measured** p at x exceeds 1/x with a CI that excludes it. That is what the sizing rule in §11.4.2 implements. It needs no argument in the UI: the ledger either shows the excess or it does not.

## 11.3 Findings
| # | Finding | Effect | Fix |
|---|---|---|---|
| D1 | `stop_loss` is stored but not used; `entry_point` is the previous round's multiplier | Displayed "risk/reward" is not what the ledger scores | Drop entry/stop from the single-round record; model stops as session rules in the Guard |
| D2 | **Decision count depends on polling.** `evaluate(record=True)` writes a row per call. `resolve` then settles every open row with `round_id <` current (up to 50) against **one** round | UI refreshes multiply exposure on the same round; P&L scales with refresh rate | Unique key (source, producer, target_round_id). Idempotent upsert |
| D3 | Horizon-based families (for example moonshot-pressure, horizon 10) are settled on the next round only | A 10-round signal is scored as a 1-round bet | Store `horizon` and settle with "first round ≥ x within horizon" semantics, or as H one-round stakes, and say which |
| D4 | Composite gate hard-coded as `min_confidence_threshold × 0.6` | An undocumented 0.27 threshold | Make the gate an explicit config key with its measured effect on the ledger |
| D5 | Confidence is the orchestrator's own number | Kelly-style sizing from self-reported confidence overstates p | Size from the ledger's lower bound (§11.4.2) |

## 11.4 Reference design
### 11.4.1 One decision object, many producers
Every producer emits the same record: the orchestrator, Auto-Tells, the signal families, user-drawn predictions (F-22) and Autopilot.
```ts
export interface Decision {
  id: string; producer: string; producer_version: string; source_id: string;
  created_ms: number; target_round_id: number;        // the first round it applies to (commit before it starts)
  action: "ENTER" | "SKIP" | "HOLD";
  cashout_x: number; horizon_rounds: number; semantics: "first_hit_within" | "each_round";
  p_claimed: number;                                  // producer's own probability
  p_ledger_lo: number | null;                         // Wilson lower bound from the ledger at emit time
  stake_units: number; guard_verdict: "allow" | "veto"; guard_reasons: string[];
  forecast_id: string | null; reasons: string[];      // Layer-8 sentence ids (Ch 05)
  resolved_ms?: number; outcome_rounds?: number[]; won?: 0 | 1; pnl_units?: number; hash?: string;
}
```
Every decision is stored and resolved, including SKIPs; a SKIP's counterfactual outcome is recorded too. Decisions are hash-chained like predictions (Ch 08 §8.4.5).

### 11.4.2 Stake sizing driven by measured edge
The Kelly fraction is f* = (bp − q)/b, where b is the net odds, p the win probability and q = 1 − p ([Kelly explainer, Paul Butler](https://explore.paulbutler.org/bet/); [Stanford notes](https://crypto.stanford.edu/~blynn/pr/kelly.html)). Implementation rules:
- **p comes from the ledger**, not from the engine's own claim. Use the *lower* bound of the Wilson interval on the producer's realised hit rate for that exact (target x, horizon, semantics).
- f* ≤ 0 means **stake 0**. The Auto-Tell becomes `SKIP` and shows the reason ("measured 49.1% [47.8, 50.4] vs break-even 50.0% at 2.00×").
- Use fractional Kelly (the spec's `kelly_criterion_factor`, e.g. 0.25–0.5), capped by the tier's max bet %.
- Use `risk_of_ruin` from `ev.py` to show the probability of hitting the daily stop.

```ts
export function stakeFor(d: { x: number; hits: number; n: number }, bankroll: number, frac = 0.25, capPct = 0.02) {
  const pLo = wilsonLower(d.hits, d.n, 1.96);
  const f = (pLo * d.x - 1) / (d.x - 1);
  if (!(f > 0)) return { stake: 0, action: "SKIP" as const, why: `p_lo ${pLo.toFixed(4)} ≤ 1/x ${(1 / d.x).toFixed(4)}` };
  return { stake: Math.min(frac * f, capPct) * bankroll, action: "ENTER" as const, why: `f* ${f.toFixed(4)} × ${frac}` };
}
```

### 11.4.3 Session guards as a first-class engine
Session guards already exist in pieces:
- daily stop-loss and take-profit;
- the profit-cap tiers;
- `mistake_prevention`, `max_consecutive_losses` = 3 and `daily_loss_limit` = 15%;
- the Responsible page.

Merge them into a **Guard engine** with its own veto. It evaluates before every ENTER:

| Rule | Default | Source |
|---|---|---|
| Daily loss ≥ limit | 15% of session bankroll | autopilot config |
| Consecutive losses ≥ L | 3 | autopilot config |
| Cap utilisation ≥ tier cap | 25–50% by tier | profit capping |
| Session length ≥ T | 60 min | Responsible page |
| Stake > tier max-bet % | 5–15% by tier | profit capping |
| Stake increase after a loss | disallowed (martingale detector) | `martingale_analysis` |

Every veto is logged, together with the counterfactual outcome of the vetoed stake. Users can then see what the guard prevented, measured.

### 11.4.4 Backtest before promote
A producer is shown to consumers only after `strategy_grid` / `backtest` (strictly causal, `strategies.py`) passes on ≥ 2 held-out segments with a positive lower CI on P&L per decision. Until then it is labelled **Lab**. Each promotion writes an entry in the Experiment Registry (F-34), with the pre-registered target and segments.

### 11.4.5 The Decision Ledger
For each producer × (x, horizon):
- n, realised hit rate, base rate of the same target, and their difference with a block-bootstrap CI;
- paper P&L per 100 decisions with a CI, max drawdown and time under water;
- the share of SKIPs and the counterfactual P&L of the SKIPs. This shows whether skipping helps;
- the guard veto count and the counterfactual P&L of the vetoes.

```sql
CREATE TABLE decisions (
  id TEXT PRIMARY KEY, producer TEXT NOT NULL, producer_version TEXT, source_id TEXT NOT NULL,
  created_ms INTEGER NOT NULL, target_round_id INTEGER NOT NULL, action TEXT NOT NULL,
  cashout_x REAL NOT NULL, horizon_rounds INTEGER NOT NULL DEFAULT 1, semantics TEXT NOT NULL,
  p_claimed REAL, p_ledger_lo REAL, stake_units REAL NOT NULL DEFAULT 0,
  guard_verdict TEXT, guard_reasons TEXT, forecast_id TEXT, reasons TEXT,
  resolved_ms INTEGER, outcome_rounds TEXT, won INTEGER, pnl_units REAL, cf_pnl_units REAL, hash TEXT,
  UNIQUE (source_id, producer, target_round_id, cashout_x, horizon_rounds));
CREATE INDEX idx_dec_prod ON decisions (producer, cashout_x, resolved_ms);
```

### 11.4.6 Bankroll Simulator
Monte-Carlo any strategy on **block-bootstrapped real sessions** (resampling whole sessions keeps within-session structure), plus the fair-law synthetic tape as a reference. Show:
- the equity fan (p5/p50/p95);
- ruin probability and time to ruin;
- cap hits;
- the distribution of the session-end bankroll.

```python
def simulate(strategy, sessions, bankroll=100.0, n_paths=2000, rng=np.random.default_rng(11)):
    ends, ruins = [], 0
    for _ in range(n_paths):
        b, path = bankroll, rng.choice(len(sessions), size=len(sessions))
        for s in path:
            for m in sessions[s]:
                stake, x = strategy.next(b)
                if stake <= 0: continue
                b += stake * (x - 1) if m >= x else -stake
                if b <= 0: ruins += 1; break
            if b <= 0: break
        ends.append(b)
    return np.percentile(ends, [5, 50, 95]), ruins / n_paths
```

## 11.5 Tests
| Test | Assertion |
|---|---|
| `decision_idempotent` | 20 `evaluate` calls for the same round produce 1 decision (D2) |
| `horizon_semantics` | A horizon-10 decision is settled on the first qualifying round within 10, or lost after 10 (D3) |
| `kelly_zero_under_fair` | On a fair synthetic tape, `stakeFor` returns SKIP for every x in 1.1…100 after 10k rounds |
| `guard_veto_logged` | Crossing the daily loss limit vetoes and logs with a counterfactual |
| `ledger_matches_replay` | Rebuilding the Decision Ledger from the event log reproduces all aggregates |
| `simulator_fair_ev` | Simulated mean P&L per unit on the fair tape ≈ −h ± MC error |

## 11.6 Measurement
For each producer:
- resolved n;
- realised hit rate vs target base rate (difference plus CI);
- paper P&L per 100 decisions with a CI;
- max drawdown;
- SKIP and veto counterfactuals.

These are shown in Autopilot and the Decision Ledger.

## 11.7 Features this chapter unlocks
- **F-30 Decision Ledger and producer leaderboard.**
- **F-31 Auto-Tells v2:** the V6 AutoTellSignal fed by ledger-measured p, with fractional Kelly, guard veto and explanations.
- **F-32 Bankroll Simulator:** Monte-Carlo of any strategy on bootstrapped real sessions, with the equity fan, ruin probability and cap hits.
- **F-33 Session Coach:** the Guard engine and Layer-8 sentences give live session guidance ("cap 74% used; guard suggests stop").
