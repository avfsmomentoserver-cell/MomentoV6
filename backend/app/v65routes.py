"""Momento v6.5 "Platform Book" surface — port of archive/backend-ts-v6.5/v65routes.ts.

Every forecast is STORED AT CREATION in forecast_store (hash-chained, F-18);
the next observed round resolves it; windows overlapping a tape gap or a
reconstructed round are VOID, never scored as misses (F-01). Everything
downstream reads those stored rows — nothing is recomputed after the fact.
"""

from __future__ import annotations

import json
import logging
import math
import re
from typing import Any
from urllib.parse import unquote

from momento import v65 as X
from momento.analysis import BAND_LABELS, band_index
from momento.calibration import range_profile
from momento.clock import iso, now_ms, parse_iso_ms
from momento.jsutil import dumps, js_str, jround, r2, r4, to_fixed
from momento.momentum import anchors, range_momentum
from momento.v64 import word_of

from .http import Query, Resp, fail, inum, js_number, jstr, num, ok, truthy

log = logging.getLogger("momento.v65")

NB = X.NB
GENESIS = X.GENESIS


def parse(s: Any, d: Any) -> Any:
    if not isinstance(s, str) or not s:
        return d
    try:
        return json.loads(s)
    except ValueError:
        return d


def src_of(q: Query) -> str | None:
    s = q.get("source")
    return s if s and s != "all" else None


def is_op(u: dict | None) -> bool:
    return bool(u) and u.get("role") in ("operator", "admin")


BUILTIN_ENGINES = [
    ("baseline", "Measured baseline (full history)", 1.0),
    ("percentile", "Empirical percentiles (recent 500)", 0.8),
    ("markov", "Markov state transitions (V5 7-state)", 0.9),
    ("dna", "DNA analogue matching", 0.7),
    ("band", "v6 band-partition model (tail-lift)", 0.9),
    ("ml", "Logistic ML ensemble", 0.6),
    ("ensemble", "v6 earned-weight per-round ensemble", 0.8),
    ("signals", "Signal layer (pressure · moonshot · ladders · FX · momentum)", 0.6),
]


def init_v65_schema(sql) -> None:
    now = now_ms()
    for k, l, p in BUILTIN_ENGINES:
        sql.exec(
            "INSERT INTO engines (key, label, version, owner, kind, state, prior, created_ms, updated_ms) VALUES (?, ?, '6.3', 'core', 'builtin', 'live', ?, ?, ?) ON CONFLICT(key) DO NOTHING",
            k, l, p, now, now,
        )


# ------------------------------------------------------------ registry glue
_registry_cache: dict | None = None


def reset_registry_cache() -> None:
    global _registry_cache
    _registry_cache = None


def registry(sql) -> dict:
    global _registry_cache
    try:
        rows = sql.rows("SELECT key, label, kind, family, params, state, prior, updated_ms FROM engines")
    except Exception:
        return {"states": {}, "extras": []}
    stamp = "|".join(f"{r['key']}:{r['state']}:{r['updated_ms']}" for r in rows)
    if _registry_cache and _registry_cache["stamp"] == stamp:
        return _registry_cache
    states: dict[str, str] = {}
    extras: list[dict] = []
    for r in rows:
        states[r["key"]] = r["state"]
        if r["kind"] == "custom" and r["state"] != "retired":
            spec = {"family": r["family"], "params": parse(r["params"], {})}
            prior = js_number(r["prior"])
            extras.append({
                "key": r["key"],
                "label": r["label"],
                "prior": prior if math.isfinite(prior) and prior else 0.5,
                "predict": (lambda sp: (lambda rounds: X.custom_predict(sp, [x.multiplier for x in rounds if x.origin != "reconstructed"])))(spec),
            })
    _registry_cache = {"stamp": stamp, "states": states, "extras": extras}
    return _registry_cache


# ------------------------------------------------------------- ledger chain
def append_chain(sql, kind: str, ref_id: int, payload: dict) -> int:
    last = sql.one("SELECT seq, row_hash FROM ledger_chain ORDER BY seq DESC LIMIT 1")
    seq = ((last or {}).get("seq") or 0) + 1
    prev = (last or {}).get("row_hash") or GENESIS
    body = {"seq": seq, "kind": kind, "ref": ref_id, **payload}
    h = X.chain_hash(prev, body)
    now = now_ms()
    sql.exec("INSERT INTO ledger_chain (seq, kind, ref_id, payload, prev_hash, row_hash, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?)", seq, kind, ref_id, X.canonical_json(body), prev, h, now)
    day = iso(now)[:10]
    sql.exec("INSERT INTO ledger_heads (day, seq, head, created_ms) VALUES (?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET seq = excluded.seq, head = excluded.head, created_ms = excluded.created_ms", day, seq, h, now)
    return seq


# ------------------------------------------------------------ stored forecasts
def cone_from(dist: list, h: int = 5) -> list:
    out = []
    qd = X.quantile_from_dist
    for k in range(1, h + 1):
        def q_max(q: float, k=k) -> float:
            s = 1 - q ** (1 / k)
            return qd(dist, 1 - s)

        out.append({"h": k, "p25": r2(qd(dist, 0.25)), "p50": r2(qd(dist, 0.5)), "p75": r2(qd(dist, 0.75)), "p90": r2(qd(dist, 0.9)), "max50": r2(q_max(0.5)), "max90": r2(q_max(0.9))})
    return out


def store_forecast(a, rounds, origin: str, created_ms: int | None = None) -> int | None:
    if len(rounds) < 150:
        return None
    last = rounds[-1]
    f = a.intel(rounds, "all")
    dist = [d["probability"] for d in f["distribution"]]
    comp = [{"key": c["key"], "weight": c["weight"], "dist": c["distribution"]} for c in f["intelligence"]["components"]]
    created = created_ms if created_ms is not None else now_ms()
    d4 = [r4(x) for x in dist]
    with a.sql.transaction():
        fid = a.sql.exec(
            """INSERT INTO forecast_store (source, origin, after_round_id, after_ts_ms, created_ms, state, expected, range_lo, range_hi, reach, confidence, dist, comp, cone)
     VALUES ('all', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            origin, last.id, last.tsMs, created, f["state"], f["expectedMultiplier"], f["rangeLo"], f["rangeHi"], f["moonshotReach"], f["confidence"],
            dumps(d4), dumps([{"key": c["key"], "weight": r4(c["weight"]), "dist": [r4(x) for x in c["dist"]]} for c in comp]), dumps(cone_from(dist)),
        ).lastrowid
        seq = append_chain(a.sql, "forecast", fid, {
            "origin": origin, "afterRoundId": last.id, "afterTsMs": last.tsMs, "createdMs": created, "state": f["state"],
            "expected": f["expectedMultiplier"], "lo": f["rangeLo"], "hi": f["rangeHi"], "reach": f["moonshotReach"], "dist": d4,
        })
        a.sql.exec("UPDATE forecast_store SET chain_seq = ? WHERE id = ?", seq, fid)
    return fid


def resolve_open(a, rounds) -> dict:
    sql = a.sql
    obs = rounds
    if not obs:
        return {"forecasts": 0, "predictions": 0, "decisions": 0}
    med = X.median_interval_ms([r for r in obs if r.origin != "reconstructed"])
    ts = [r.tsMs for r in obs]
    import bisect

    def idx_after(t):
        return bisect.bisect_right(ts, t)

    nf = np_ = nd = 0
    with sql.transaction():
        for f in sql.rows("SELECT * FROM forecast_store WHERE resolved_ms IS NULL ORDER BY id LIMIT 2000"):
            i = idx_after(f["after_ts_ms"])
            if i >= len(obs):
                continue
            t = obs[i]
            prev = obs[i - 1] if i > 0 else None
            void_reason = None
            if t.origin == "reconstructed":
                void_reason = "target is a reconstructed round"
            elif prev and med and t.tsMs - prev.tsMs > 2.5 * med and jround((t.tsMs - prev.tsMs) / med) - 1 >= 1:
                void_reason = f"tape gap of {js_str(jround((t.tsMs - prev.tsMs) / 1000))}s before the target"
            dist = parse(f["dist"], [])
            comp = parse(f["comp"], [])
            b = band_index(t.multiplier)

            def L(d):
                v = d[b] if b < len(d) and d[b] is not None else 1e-6
                return r4(-math.log(max(1e-6, v)))

            comp_loss = {c["key"]: L(c["dist"]) for c in comp}
            ml = L(dist)
            sql.exec(
                "UPDATE forecast_store SET resolved_round_id = ?, actual = ?, void = ?, void_reason = ?, mix_loss = ?, base_loss = ?, comp_loss = ?, resolved_ms = ? WHERE id = ?",
                t.id, t.multiplier, 1 if void_reason else 0, void_reason, ml, comp_loss.get("baseline"), dumps(comp_loss), now_ms(), f["id"],
            )
            append_chain(sql, "resolution", f["id"], {"forecastId": f["id"], "roundId": t.id, "actual": t.multiplier, "void": 1 if void_reason else 0, "mixLoss": ml})
            nf += 1
        for p in sql.rows("SELECT * FROM drawn_predictions WHERE resolved_ms IS NULL ORDER BY id LIMIT 2000"):
            i = idx_after(p["after_ts_ms"])
            H = p["horizon"]
            if i + H > len(obs):
                continue
            win = obs[i: i + H]
            hit_at = next((k for k, r in enumerate(win) if r.multiplier >= p["level"]), -1)
            y = 1 if hit_at >= 0 else 0
            is_void = 1 if any(r.origin == "reconstructed" for r in win) else 0

            def ll(q):
                return r4(-(y * math.log(max(1e-6, q)) + (1 - y) * math.log(max(1e-6, 1 - q))))

            sql.exec(
                "UPDATE drawn_predictions SET resolved_ms = ?, actual = ?, rounds_used = ?, logloss = ?, mix_logloss = ?, void = ? WHERE id = ?",
                now_ms(), y, hit_at + 1 if hit_at >= 0 else H, ll(p["probability"]), ll(p["mixture_p"]), is_void, p["id"],
            )
            append_chain(sql, "prediction-resolution", p["id"], {"predictionId": p["id"], "actual": y, "void": is_void})
            np_ += 1
        for d in sql.rows("SELECT * FROM decisions WHERE resolved_ms IS NULL ORDER BY id LIMIT 2000"):
            i = idx_after(d["after_ts_ms"])
            H = d["horizon"] or 1
            if i + H > len(obs):
                continue
            win = obs[i: i + H]
            tgt = d["target"] if d["target"] is not None else 2
            y = 1 if any(r.multiplier >= tgt for r in win) else 0
            stake = d["stake"] if d["stake"] is not None else 0
            pnl = (stake * (tgt - 1) if y else -stake) if d["action"] in ("stake", "enter") else 0
            sql.exec("UPDATE decisions SET resolved_ms = ?, outcome = ?, pnl = ? WHERE id = ?", now_ms(), y, r4(pnl), d["id"])
            nd += 1
    return {"forecasts": nf, "predictions": np_, "decisions": nd}


_last_live_store = 0


def on_ingest(a, inserted: int, origin: str) -> None:
    global _last_live_store
    if inserted <= 0 or origin == "reconstructed":
        return
    rounds = a.rounds_for(None)
    resolve_open(a, rounds)
    now = now_ms()
    if now - _last_live_store >= 500 or inserted <= 5:
        store_forecast(a, rounds, "live")
        _last_live_store = now
    try:
        record_tells(a, rounds)
        evaluate_alerts(a, rounds)
        auto_demote(a)
    except Exception as e:
        log.error("v65 post-ingest: %s", e)


# ------------------------------------------------------------- ledgers
def ledger_rows(a, which: str, limit: int = 5000, include_backfill: bool = True) -> list[dict]:
    if which == "calibration":
        rows = a.sql.rows("SELECT id, state, dist, weights, comp_loss, mix_loss, base_loss, actual, range_lo, range_hi, created_ms FROM intel_calibrations WHERE resolved_ms IS NOT NULL AND actual IS NOT NULL ORDER BY created_ms DESC LIMIT ?", int(limit))
        return [{
            "id": r["id"], "state": r["state"], "weights": parse(r["weights"], {}), "compLoss": parse(r["comp_loss"], {}),
            "mixLoss": r["mix_loss"], "baseLoss": r["base_loss"], "dist": parse(r["dist"], []), "actual": r["actual"],
            "lo": r["range_lo"], "hi": r["range_hi"], "createdMs": r["created_ms"],
        } for r in reversed(rows)]
    rows = a.sql.rows(
        f"SELECT id, state, dist, comp, comp_loss, mix_loss, base_loss, actual, range_lo, range_hi, created_ms FROM forecast_store WHERE resolved_ms IS NOT NULL AND void = 0 {'' if include_backfill else 'AND origin = ' + chr(39) + 'live' + chr(39)} ORDER BY created_ms DESC LIMIT ?",
        int(limit),
    )
    out = []
    for r in reversed(rows):
        comp = parse(r["comp"], [])
        out.append({
            "id": r["id"], "state": r["state"], "weights": {c["key"]: c["weight"] for c in comp}, "compLoss": parse(r["comp_loss"], {}),
            "mixLoss": r["mix_loss"], "baseLoss": r["base_loss"], "dist": parse(r["dist"], []), "actual": r["actual"],
            "lo": r["range_lo"], "hi": r["range_hi"], "createdMs": r["created_ms"],
        })
    return out


def pick_ledger(a, q: Query | None = None) -> str:
    w = q.get("ledger") if q else None
    if w in ("stored", "calibration"):
        return w
    n = a.sql.scalar("SELECT COUNT(*) AS n FROM forecast_store WHERE resolved_ms IS NOT NULL AND void = 0", default=0)
    return "stored" if n >= 100 else "calibration"


def _isnum(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _fin(v) -> bool:
    return _isnum(v) and math.isfinite(v)


def engine_leaderboard(a, which: str, trailing: int = 1000) -> dict:
    rows = ledger_rows(a, which, trailing)
    engines = a.sql.rows("SELECT * FROM engines ORDER BY kind, key")
    by_key = {e["key"]: e for e in engines}
    keys = list(dict.fromkeys([*(e["key"] for e in engines), *(k for r in rows for k in r["compLoss"].keys())]))
    out = []
    for k in keys:
        diffs, losses = [], []
        for r in rows:
            l = r["compLoss"].get(k)
            if not _isnum(l) or not _isnum(r["baseLoss"]):
                continue
            diffs.append(r["baseLoss"] - l)
            losses.append(l)
        lo, hi = X.block_bootstrap_ci(diffs, {"seed": len(k) * 13})
        e = by_key.get(k)
        w = X.mean([r["weights"].get(k) or 0 for r in rows]) if rows else 0
        base_mean = X.mean([r["baseLoss"] for r in rows if _isnum(r["compLoss"].get(k))]) if rows else 0
        md = X.mean(diffs)
        out.append({
            "key": k,
            "label": (e or {}).get("label") or k,
            "kind": (e or {}).get("kind") or "builtin",
            "family": (e or {}).get("family"),
            "state": (e or {}).get("state") or "live",
            "owner": (e or {}).get("owner") or "core",
            "prior": (e or {}).get("prior") if (e or {}).get("prior") is not None else 1,
            "n": len(diffs),
            "logLoss": r4(X.mean(losses)) if losses else None,
            "skill": r4(md) if diffs else None,
            "skillPct": r4(md / base_mean) if diffs and base_mean else None,
            "lo": r4(lo) if math.isfinite(lo) else None,
            "hi": r4(hi) if math.isfinite(hi) else None,
            "avgWeight": r4(w),
            "verdict": "insufficient" if len(diffs) < 30 else "beats baseline" if lo > 0 else "worse than baseline" if hi < 0 else "no measurable skill",
            "admission": parse((e or {}).get("admission"), None),
        })
    mix = [d for d in (r["baseLoss"] - r["mixLoss"] if _isnum(r["baseLoss"]) and _isnum(r["mixLoss"]) else math.nan for r in rows) if math.isfinite(d)]
    mlo, mhi = X.block_bootstrap_ci(mix, {"seed": 5})
    out.sort(key=lambda x: -(x["skill"] if x["skill"] is not None else -9))
    return {
        "ledger": which,
        "n": len(rows),
        "mixture": {"n": len(mix), "skill": r4(X.mean(mix)), "lo": r4(mlo), "hi": r4(mhi),
                    "logLoss": r4(X.mean([r["mixLoss"] or 0 for r in rows])), "baseLogLoss": r4(X.mean([r["baseLoss"] or 0 for r in rows]))},
        "engines": out,
    }


# ------------------------------------------------------------ F-20 auto-demotion
_last_demote_check = 0


def auto_demote(a, force: bool = False) -> dict:
    global _last_demote_check
    now = now_ms()
    if not force and now - _last_demote_check < 5 * 60_000:
        return {"demoted": []}
    _last_demote_check = now
    if a.setting("auto_demotion") == "0":
        return {"demoted": []}
    lb = engine_leaderboard(a, pick_ledger(a), 400)
    demoted = []
    for e in lb["engines"]:
        if e["key"] == "baseline" or e["state"] != "live" or e["n"] < 100 or e["hi"] is None:
            continue
        if e["hi"] < 0:
            a.sql.exec("UPDATE engines SET state = 'demoted', updated_ms = ? WHERE key = ?", now, e["key"])
            a.sql.exec("INSERT INTO engine_history (key, from_state, to_state, reason, actor, created_ms) VALUES (?, 'live', 'demoted', ?, 'auto-demotion', ?)", e["key"], f"trailing-{e['n']} log-score skill {js_str(e['skill'])} with 95% CI upper bound {js_str(e['hi'])} < 0", now)
            a.sql.exec("INSERT INTO alerts (kind, title, body, link, created_ms) VALUES ('engine', ?, ?, '/dashboard/engines', ?)", f"Engine demoted: {e['label']}",
                       f"Trailing skill {js_str(e['skill'])} (CI {js_str(e['lo'])} to {js_str(e['hi'])}) is below 0 with 95% confidence. Weight set to the floor; re-promotion goes through shadow mode.", now)
            demoted.append(e["key"])
    if demoted:
        reset_registry_cache()
    return {"demoted": demoted}


# ------------------------------------------------------------ F-31 tells → decisions
def record_tells(a, rounds) -> None:
    if a.setting("tells_enabled") == "0" or not rounds:
        return
    last = rounds[-1]
    for t in X.kelly_tells(rounds, {"targets": [2, 5, 10]}):
        a.sql.exec(
            """INSERT OR IGNORE INTO decisions (producer, source, ref, action, target, probability, base_rate, stake, horizon, after_ts_ms, reasons, guard, created_ms)
       VALUES ('auto-tells-v2', 'all', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)""",
            f"{last.id}:{js_str(t['target'])}", t["action"], t["target"], t["pLower"], t["pHat"], t["fraction"] * 100, last.tsMs, dumps(t["reasons"]), "no-edge" if t["action"] == "skip" else None, now_ms(),
        )


def sync_autopilot(a) -> int:
    try:
        rows = a.sql.rows("SELECT * FROM autopilot_decisions ORDER BY id")
    except Exception:
        return 0
    n = 0
    for r in rows:
        res = a.sql.exec(
            """INSERT OR IGNORE INTO decisions (producer, source, ref, action, target, probability, base_rate, stake, horizon, after_ts_ms, reasons, guard, created_ms, resolved_ms, outcome, pnl)
       VALUES ('autopilot', ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?, NULL, ?, ?, ?, ?)""",
            r["source"], f"ap:{r['id']}", r["decision"], r["threshold"], r["confidence"], r["stake"], r["created_ms"], dumps([r["reason"]]), r["created_ms"],
            r["created_ms"] if r["resolved"] else None, ((1 if (r["pnl"] or 0) > 0 else 0) if r["resolved"] else None), r["pnl"] if r["resolved"] else None,
        )
        n += res.rowsWritten
    return n


def decision_leaderboard(a, rounds) -> dict:
    sync_autopilot(a)
    ms = sorted(r.multiplier for r in rounds if r.origin != "reconstructed")
    import bisect

    def base_at(x):
        return (len(ms) - bisect.bisect_left(ms, x)) / len(ms) if ms else 0

    out = []
    for p in a.sql.rows("SELECT producer, COUNT(*) AS n FROM decisions GROUP BY producer"):
        rows = a.sql.rows("SELECT * FROM decisions WHERE producer = ? AND resolved_ms IS NOT NULL ORDER BY created_ms", p["producer"])
        acted = [r for r in rows if r["action"] in ("stake", "enter")]
        hits = sum(1 for r in acted if r["outcome"] == 1)
        base_r = X.mean([1 - (1 - base_at(r["target"] if r["target"] is not None else 2)) ** (r["horizon"] or 1) for r in acted]) if acted else 0
        lo, hi = X.wilson_ci(hits, len(acted))
        pnls = [r["pnl"] if r["pnl"] is not None else 0 for r in acted]
        plo, phi = X.block_bootstrap_ci([x * 100 for x in pnls], {"seed": 3})
        eq = peak = dd = 0.0
        for x in pnls:
            eq += x
            peak = max(peak, eq)
            dd = max(dd, peak - eq)
        hr = hits / len(acted) if acted else 0
        out.append({
            "producer": p["producer"], "total": p["n"], "resolved": len(rows), "acted": len(acted),
            "hitRate": r4(hr), "baseRate": r4(base_r), "delta": r4(hr - base_r), "deltaLo": r4(lo - base_r), "deltaHi": r4(hi - base_r),
            "pnlPer100": r2(X.mean(pnls) * 100 if acted else 0),
            "pnlLo": r2(plo) if math.isfinite(plo) else None, "pnlHi": r2(phi) if math.isfinite(phi) else None,
            "drawdown": r2(dd), "guardVetoes": sum(1 for r in rows if r["guard"]), "ranked": len(acted) >= 30,
        })
    out.sort(key=lambda x: (-int(x["ranked"]), -x["pnlPer100"]))
    try:
        ap = a.sql.scalar("SELECT COUNT(*) AS n FROM autopilot_decisions", default=0)
    except Exception:
        ap = 0
    mirrored = a.sql.scalar("SELECT COUNT(*) AS n FROM decisions WHERE producer = 'autopilot'", default=0)
    return {"producers": out, "reconciliation": {"autopilotRows": ap, "ledgerRows": mirrored, "mismatches": abs(ap - mirrored)}}


# ------------------------------------------------------------ F-38 alerts
def live_fields(a, rounds) -> dict:
    out: dict[str, float] = {}
    eta = X.eta_board(rounds)
    for r in eta["rows"]:
        T = js_str(r["threshold"])
        if r.get("kmPercentile") is not None:
            out[f"eta.{T}.kmPercentile"] = r["kmPercentile"] * 100
        out[f"eta.{T}.pNext"] = (r.get("pNext") or 0) * 100
        out[f"eta.{T}.pWithin10"] = (r.get("pWithin10") or 0) * 100
        out[f"eta.{T}.gap"] = r["currentGap"]
    last = a.sql.one("SELECT * FROM forecast_store ORDER BY id DESC LIMIT 1")
    if last:
        d = parse(last["dist"], [])
        out["forecast.expected"] = last["expected"]
        out["forecast.reach"] = last["reach"]
        out["forecast.p2"] = X.survival_from_dist(d, 2) * 100
        out["forecast.p10"] = X.survival_from_dist(d, 10) * 100
        out["forecast.confidence"] = (last["confidence"] or 0) * 100
    ms = [r.multiplier for r in rounds]
    below = 0
    for m in reversed(ms):
        if m >= 2:
            break
        below += 1
    out["streak.below2"] = below
    out["last.multiplier"] = ms[-1] if ms else 0
    try:
        st = (anchors(rounds) or {}).get("state") or {}
        out["anchor.active"] = 1 if st.get("active") else 0
        if st.get("size") is not None:
            out["anchor.size"] = st["size"]
    except Exception:
        pass
    return out


ALERT_FIELDS = [
    {"field": "eta.10.kmPercentile", "label": "10× gap KM percentile", "unit": "%"},
    {"field": "eta.50.kmPercentile", "label": "50× gap KM percentile", "unit": "%"},
    {"field": "eta.100.kmPercentile", "label": "100× gap KM percentile", "unit": "%"},
    {"field": "eta.10.pWithin10", "label": "P(10× within 10 rounds)", "unit": "%"},
    {"field": "eta.10.gap", "label": "Rounds since last 10×", "unit": "rounds"},
    {"field": "eta.50.gap", "label": "Rounds since last 50×", "unit": "rounds"},
    {"field": "forecast.expected", "label": "Forecast median", "unit": "×"},
    {"field": "forecast.reach", "label": "Forecast p90 reach", "unit": "×"},
    {"field": "forecast.p2", "label": "P(next ≥ 2×)", "unit": "%"},
    {"field": "forecast.p10", "label": "P(next ≥ 10×)", "unit": "%"},
    {"field": "streak.below2", "label": "Rounds below 2× in a row", "unit": "rounds"},
    {"field": "last.multiplier", "label": "Last round multiplier", "unit": "×"},
    {"field": "anchor.active", "label": "Anchor forming (1 = yes)", "unit": ""},
]


def evaluate_alerts(a, rounds) -> None:
    rules = a.sql.rows("SELECT * FROM alert_rules WHERE enabled = 1")
    if not rules:
        return
    f = live_fields(a, rounds)
    now = now_ms()
    hour = ((now + 120 * 60_000) // 3_600_000) % 24
    last_f = a.sql.one("SELECT id FROM forecast_store ORDER BY id DESC LIMIT 1")
    for r in rules:
        v = f.get(r["field"])
        if v is None:
            continue
        th = r["value"]
        op = r["op"]
        on = v >= th if op == ">=" else v <= th if op == "<=" else v > th if op == ">" else v < th if op == "<" else abs(v - th) < 1e-9
        was_on = r["last_state"] == 1
        a.sql.exec("UPDATE alert_rules SET last_state = ? WHERE id = ?", 1 if on else 0, r["id"])
        if not on or was_on:
            continue
        if r["last_fired_ms"] and now - r["last_fired_ms"] < r["debounce_s"] * 1000:
            continue
        if r["quiet_from"] is not None and r["quiet_to"] is not None:
            qf, qt = r["quiet_from"], r["quiet_to"]
            if (qf <= hour < qt) if qf <= qt else (hour >= qf or hour < qt):
                continue
        today = a.sql.scalar("SELECT COUNT(*) AS n FROM alerts WHERE rule_id = ? AND created_ms > ?", r["id"], now - 86_400_000, default=0)
        if today >= r["daily_cap"]:
            continue
        meta = next((x for x in ALERT_FIELDS if x["field"] == r["field"]), None)
        parts = str(r["field"]).split(".")
        T = js_number(parts[1]) if len(parts) > 1 else math.nan
        p_next = f.get(f"eta.{js_str(T)}.pNext") if math.isfinite(T) else f.get("forecast.p2")
        a.sql.exec(
            "INSERT INTO alerts (rule_id, kind, title, body, probability, link, forecast_id, created_ms) VALUES (?, 'rule', ?, ?, ?, ?, ?, ?)",
            r["id"], r["name"],
            f"{meta['label'] if meta else r['field']} is {js_str(r2(v))}{meta['unit'] if meta else ''} (rule {op} {js_str(th)}). Calibrated P(next round ≥ {js_str(T) if math.isfinite(T) else 2}×) = {js_str(r2(p_next or 0))}% — a probability, not a directive.",
            r4(p_next / 100) if p_next is not None else None, "/dashboard/intelligence", last_f["id"] if last_f else None, now,
        )
        a.sql.exec("UPDATE alert_rules SET last_fired_ms = ? WHERE id = ?", now, r["id"])


# ------------------------------------------------------------ F-35 explain
def _std(xs: list) -> float:
    m = X.mean(xs)
    return math.sqrt(X.mean([(x - m) ** 2 for x in xs]))


def explain(a, f_row: dict, rounds) -> dict:
    dist = parse(f_row["dist"], [])
    comp = parse(f_row["comp"], [])
    base = next((c["dist"] for c in comp if c["key"] == "baseline"), dist)
    qm = lambda d: X.quantile_from_dist(d, 0.5)  # noqa: E731
    base_mid = qm(base)
    lb = engine_leaderboard(a, pick_ledger(a), 400)
    skills = {e["key"]: e for e in lb["engines"]}
    waterfall = []
    for c in comp:
        raw = c["weight"] * (qm(c["dist"]) - base_mid)
        s = skills.get(c["key"])
        waterfall.append({"key": c["key"], "weight": c["weight"], "engineMid": r2(qm(c["dist"])), "raw": raw, "skill": s["skill"] if s else None, "skillVerdict": s["verdict"] if s else "insufficient"})
    waterfall.sort(key=lambda w: -abs(w["raw"]))
    mix_mid = qm(dist)
    sum_raw = sum(w["raw"] for w in waterfall)
    scale = (mix_mid - base_mid) / sum_raw if abs(sum_raw) > 1e-9 else 0
    eta = X.eta_board(rounds)
    e10 = next((r for r in eta["rows"] if r["threshold"] == 10), None)
    try:
        rm = range_momentum(rounds)
    except Exception:
        rm = []
    m10 = next((x for x in rm if x.get("min") == 10), None)
    try:
        an = anchors(rounds) or {}
    except Exception:
        an = {}
    ms = [r.multiplier for r in rounds]
    vol = _std([math.log(m) for m in ms[-50:]])
    vol_l = _std([math.log(m) for m in ms[-2000:]])
    argmax = dist.index(max(dist)) if dist else -1
    sig = X.signal_significance(rounds, {"T": 2, "window": 8000})
    below = 0
    for m in reversed(ms):
        if m >= 2:
            break
        below += 1
    mix = lb["mixture"]
    st = an.get("state") or {}
    informative = mix["lo"] is not None and mix["lo"] > 0
    calib10 = (e10 or {}).get("calibration") or {}
    dims = [
        {"dimension": "Next value", "value": f"{js_str(r2(f_row['expected']))}× (50% range {js_str(r2(f_row['range_lo']))}–{js_str(r2(f_row['range_hi']))}×)", "engine": "mixture", "skill": mix["skill"], "informative": informative},
        {"dimension": "Next big one", "value": f"10× conditional median in {js_str(e10['etaMedian'])} rounds (p90 {js_str(e10.get('etaP90'))})" if e10 and e10.get("etaMedian") is not None else "not enough 10× gaps",
         "engine": "survival (KM)", "skill": calib10.get("beforeMedian"), "informative": ((e10 or {}).get("memoryless") or {}).get("verdict") != "memoryless"},
        {"dimension": "Hotter or cooler?", "value": f"{m10['trend']}" if m10 else "—", "engine": "range momentum", "skill": None, "informative": False},
        {"dimension": "Steady or wild?", "value": f"σ(log) {js_str(r2(vol))} vs {js_str(r2(vol_l))} long-run → {'wild' if vol > vol_l * 1.15 else 'steady' if vol < vol_l * 0.85 else 'normal'}", "engine": "volatility", "skill": None, "informative": False},
        {"dimension": "Most likely band", "value": f"{BAND_LABELS[argmax] if argmax >= 0 else 'undefined'} at {to_fixed(dist[argmax] * 100, 1) if argmax >= 0 else 'NaN'}%", "engine": "mixture", "skill": mix["skill"], "informative": informative},
        {"dimension": "Building or fading?", "value": (f"anchor forming{' (' + st['label'] + ')' if st.get('label') else ''}" if st.get("active") else "no anchor"), "engine": "momentum anchors", "skill": None, "informative": False},
        {"dimension": "Session risk", "value": f"{below} rounds below 2× — guard caution" if below >= 5 else "normal", "engine": "guard", "skill": None, "informative": False},
        {"dimension": "How sure are we?", "value": f"confidence {to_fixed(js_number(f_row['confidence']) * 100, 0)}% · mixture skill {to_fixed((mix['skill'] or 0) * 100, 2)} milli-nats (CI {js_str(mix['lo'])} to {js_str(mix['hi'])})", "engine": "ledger", "skill": mix["skill"], "informative": informative},
    ]
    flips = [{"key": r["key"], "label": r["label"], "active": r["active"], "lift": r["lift"], "significant": r["significant"]} for r in sig["rows"]][:14]
    near = [f"A round ≥ 2× ends the {below}-round run below 2× (streak signals switch off)." if below > 0 else "A round below 2× starts a new below-2× streak."]
    if e10:
        near.append(f"A 10× resets the 10× gap (now {js_str(e10['currentGap'])} rounds, KM percentile {js_str(jround((e10.get('kmPercentile') or 0) * 100))}%).")
    w0 = waterfall[0] if waterfall else None
    pull = ((("+" if w0["raw"] * scale >= 0 else "") + js_str(r2(w0["raw"] * scale))) if w0 else "0")
    sentence = (
        f"The forecast is {js_str(r2(f_row['expected']))}× (state {f_row['state']}). The baseline alone says {js_str(r2(base_mid))}×; the largest pull comes from {w0['key'] if w0 else 'baseline'} ({pull}×). "
        + ("The mixture has measured skill over the baseline." if informative else "The mixture has no measurable skill over the baseline, so treat it as the base rate.")
    )
    allowed = [r2(js_number(x)) for x in (f_row["expected"], base_mid, abs(w0["raw"] * scale) if w0 else 0, f_row["range_lo"], f_row["range_hi"])]
    return {
        "forecastId": f_row["id"],
        "createdAt": iso(f_row["created_ms"]),
        "headline": {"expected": f_row["expected"], "lo": f_row["range_lo"], "hi": f_row["range_hi"], "reach": f_row["reach"], "state": f_row["state"], "baselineMid": r2(base_mid), "mixtureMid": r2(mix_mid)},
        "dimensions": dims,
        "waterfall": [{"key": w["key"], "weight": r4(w["weight"]), "engineMid": w["engineMid"], "contribution": r2(w["raw"] * scale), "skill": w["skill"], "skillVerdict": w["skillVerdict"]} for w in waterfall],
        "signals": flips,
        "wouldChange": near,
        "narrator": {"sentence": sentence, "numbersCheck": X.numbers_check(sentence, allowed)},
    }


# ------------------------------------------------------------ F-37 ask
def intel_summary(intel: dict | None) -> dict | None:
    if not intel or not isinstance(intel, dict):
        return None
    block = intel.get("intelligence") or {}
    cal = block.get("calibration")
    dist = intel.get("distribution") if isinstance(intel.get("distribution"), list) else []
    return {
        "state": intel.get("state"),
        "confidence": intel.get("confidence") if _isnum(intel.get("confidence")) else None,
        "confidenceLabel": intel.get("confidenceLabel"),
        "expectedMultiplier": intel.get("expectedMultiplier"),
        "rangeLo": intel.get("rangeLo"),
        "rangeHi": intel.get("rangeHi"),
        "moonshotReach": intel.get("moonshotReach"),
        "band": intel.get("band"),
        "pOver2": r4(sum((d.get("probability") or 0) for d in dist[2:])) if dist else None,
        "calibrated": bool(cal.get("distributionActive") or cal.get("quantileActive")) if cal else False,
        "generatedAt": intel.get("generatedAt"),
    }


ASK_SYSTEM = (
    "You answer questions about the Momento research platform. Sources, in priority order: (1) the numbered documentation passages — cite every claim from them with its id in square brackets, e.g. [ch08#3]; "
    "(2) the LIVE DATA JSON — cite numbers taken from it with [data]; (3) general statistics / research-methodology knowledge, only for how-to-test or methodology questions, and prefix those sentences with 'General:'. "
    "Never invent platform features, numbers or results. Forecasts are probabilities, never guarantees — do not present them as betting advice. If none of the sources support an answer, reply exactly: NO_ANSWER. Under 250 words."
)


def ask_momento(a, question: str, passages: list[dict]) -> dict:
    key = (a.env or {}).get("ENTRIM_API_KEY") or a.setting("entrim_api_key") or ""
    live = None
    try:
        stats = a.table_stats()
        all_r = a.rounds_for(None)
        intel = intel_summary(a.intel(all_r, "all")) if len(all_r) >= 50 else None
        pressure = None
        try:
            pressure = ((a.analysis(None) or {}).get("pressure") or {}).get("overallPressure")
        except Exception:
            pass
        live = {
            "rounds": stats["count"],
            "span": {"from": iso(all_r[0].tsMs), "to": iso(all_r[-1].tsMs)} if all_r else None,
            "last10": [r.multiplier for r in all_r[-10:]],
            "forecast": intel,
            "megaPressurePct": pressure,
        }
    except Exception:
        live = None
    live_text = dumps(live) if live else "(live data unavailable)"
    if not key:
        lines = [f"- {p['text'][:280].strip()}… [{p['id']}]" for p in passages[:3]]
        f = (live or {}).get("forecast")
        live_line = (
            f"- Live: {js_str(live['rounds'])} rounds · state {f['state']} · expected {js_str(f['expectedMultiplier'])}x (p25–p75 {js_str(f['rangeLo'])}–{js_str(f['rangeHi'])}x) · confidence {f['confidenceLabel']}{' · recalibrated' if f['calibrated'] else ''} [data]"
            if f else None
        )
        if not lines and not live_line:
            return {"answer": None, "refused": True, "reason": "No knowledge passages or live data matched, so Ask Momento refuses rather than guess.", "citations": [], "grounding": "none"}
        return {
            "answer": "Closest knowledge (no AI key set — extractive answer):\n\n" + "\n".join([*lines, *([live_line] if live_line else [])]),
            "refused": False,
            "citations": [p["id"] for p in passages[:3]],
            "grounding": "docs" if lines else "data",
            "model": "extractive",
        }
    base = re.sub(r"/+$", "", a.setting("entrim_base_url") or "https://api.entrim.ai/v1")
    model = a.setting("entrim_model") or "deepseek-ai/DeepSeek-V4-Flash"
    passage_text = "\n\n".join(f"[{p['id']}] ({p['title']}) {p['text'][:1400]}" for p in passages) if passages else "(no documentation passages matched)"
    try:
        import httpx

        res = httpx.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            content=dumps({"model": model, "temperature": 0.2, "max_tokens": 900, "messages": [
                {"role": "system", "content": ASK_SYSTEM},
                {"role": "user", "content": f"Question: {question}\n\nDocumentation passages:\n{passage_text}\n\nLIVE DATA:\n{live_text}"},
            ]}),
            timeout=45.0,
        )
        if res.status_code >= 400:
            return {"answer": None, "refused": True, "reason": f"AI provider returned HTTP {res.status_code}.", "citations": [], "grounding": "none", "model": model}
        body = res.json()
        text = (((body.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
        tags = list(dict.fromkeys(t[1:-1] for t in re.findall(r"\[[^\]]+\]", text)))
        ids = {p["id"] for p in passages}
        cited = [t for t in tags if t in ids]
        used_data = "data" in tags and live is not None
        general = re.search(r"(^|\n)\s*General:", text) is not None
        if not text or "NO_ANSWER" in text:
            return {"answer": None, "refused": True, "reason": "The sources do not support an answer, so Ask Momento refuses rather than guess.", "citations": [], "grounding": "none", "model": model}
        if not cited and not used_data and not general:
            return {"answer": None, "refused": True, "reason": "The answer did not cite a passage or the live data, so it was refused.", "citations": [], "grounding": "none", "model": model}
        return {"answer": text, "refused": False, "citations": cited, "grounding": "docs" if cited else "data" if used_data else "general", "usedData": used_data, "model": model}
    except Exception as e:
        return {"answer": None, "refused": True, "reason": f"AI provider unreachable: {e}", "citations": [], "grounding": "none"}




def route_v65(*args, **kw):  # router lives in its own module (imported lazily to avoid a cycle)
    from .v65router import route_v65 as _r

    return _r(*args, **kw)
