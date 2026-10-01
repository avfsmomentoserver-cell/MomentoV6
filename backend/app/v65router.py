"""routeV65 — the v6.5 Platform Book dispatcher (archive v65routes.ts:986-1790)."""

from __future__ import annotations

import json
import math
import re

from momento import v65 as X
from momento.analysis import BAND_LABELS
from momento.calibration import range_profile
from momento.clock import iso, now_ms
from momento.jsutil import dumps, js_str, jround, r2, r4
from momento.v64 import word_of

from . import v65routes as S
from .http import Query, Resp, fail, inum, js_number, jstr, num, ok, truthy
from .v65routes import parse, src_of

INF = float("inf")


def _str_or(v, d: str) -> str:
    return jstr(v) if v is not None else d


def _round(v: float) -> int:
    return int(jround(v))


def route_v65(a, method: str, path: str, q: Query, body: dict, user: dict | None, as_of: int | None) -> Resp | None:
    sql = a.sql
    if not path.startswith("/api/v1/"):
        return None
    p = path[8:]

    def rounds():
        return a.rounds_for(src_of(q))

    def need_op():
        if not user:
            return fail("authentication required", 401)
        if not S.is_op(user):
            return fail("operator role required", 403)
        return None

    # ---- F-04 time travel (core recomputes /intelligence/forecast on the truncated tape)
    if p == "intelligence/forecast" and method == "GET" and as_of:
        return None
    if p == "asof/forecast" and method == "GET":
        t = num(q.get("t") if q.get("t") is not None else as_of, now_ms())
        row = sql.one("SELECT * FROM forecast_store WHERE created_ms <= ? ORDER BY created_ms DESC LIMIT 1", t)
        if not row:
            return ok({"found": False, "t": t})
        return ok({"found": True, "t": t, "forecast": {**row, "dist": parse(row["dist"], []), "comp": parse(row["comp"], []), "cone": parse(row["cone"], []), "comp_loss": parse(row["comp_loss"], None)}})
    if p == "asof/info" and method == "GET":
        r = sql.one("SELECT MIN(ts_ms) AS a, MAX(ts_ms) AS b, COUNT(*) AS n FROM rounds")
        f = sql.one("SELECT MIN(created_ms) AS a, MAX(created_ms) AS b, COUNT(*) AS n, SUM(origin = 'live') AS live FROM forecast_store")
        visible = len(a.rounds_for(None)) if as_of else r["n"]
        return ok({"asOf": as_of, "visibleRounds": visible, "rounds": {"from": r["a"], "to": r["b"], "n": r["n"]}, "forecasts": {"from": f["a"], "to": f["b"], "n": f["n"], "live": f["live"] or 0},
                   "knowledgeRule": "Live-ingested rounds count from their ingest time (created_ms). Historical back-fills (import, seed, reconstruct) count from their own round timestamp, and are labelled as such."})
    if p == "asof/property-test" and method == "GET":
        rows = sql.rows("SELECT id, created_ms FROM forecast_store ORDER BY RANDOM() LIMIT ?", inum(q.get("n"), 200, 1, 1000))
        mismatch = 0
        for r in rows:
            got = sql.one("SELECT id FROM forecast_store WHERE created_ms <= ? ORDER BY created_ms DESC, id DESC LIMIT 1", r["created_ms"])
            same = sql.scalar("SELECT COUNT(*) AS n FROM forecast_store WHERE created_ms = ?", r["created_ms"], default=0)
            if got["id"] != r["id"] and same == 1:
                mismatch += 1
        return ok({"tested": len(rows), "mismatches": mismatch, "passes": mismatch == 0})

    # ---- F-01 integrity
    if p == "integrity" and method == "GET":
        rep = X.integrity_report(rounds())
        sess = q.get("session")
        lst = rep["sessions"]
        if sess:
            lst = [s for s in lst if js_str(s["sessionId"]) == sess]
        # archive: the `days` filter is a no-op (`|| true`) — kept as such
        return ok({"summary": rep["summary"], "sessions": lst[: inum(q.get("limit"), 400, 1, 5000)]})
    if p == "integrity/summary" and method == "GET":
        rep = X.integrity_report(rounds())
        v = sql.one("SELECT COUNT(*) AS n, SUM(void) AS v FROM forecast_store WHERE resolved_ms IS NOT NULL")
        return ok({**rep["summary"], "ledgerVoided": v["v"] or 0, "ledgerResolved": v["n"] or 0, "quarantined": sql.scalar("SELECT COUNT(*) AS n FROM ingest_quarantine", default=0)})

    # ---- F-02 collectors
    if p == "collectors" and method == "GET":
        s = src_of(q)
        rows = sql.rows(f"SELECT source, ingest, COUNT(*) AS n, MAX(ts_ms) AS last, MIN(ts_ms) AS first FROM rounds {'WHERE source = ?' if s else ''} GROUP BY source, ingest ORDER BY source", *([s] if s else []))
        by: dict[str, list] = {}
        for r in rows:
            by.setdefault(r["source"], []).append(r)
        out = []
        now = now_ms()
        for source, cs in by.items():
            pair = sql.one(
                "SELECT COUNT(*) AS n, SUM(ABS(a.multiplier - b.multiplier) < 0.005) AS agree FROM rounds a JOIN rounds b ON a.source = b.source AND a.ingest < b.ingest AND ABS(a.ts_ms - b.ts_ms) <= 1000 WHERE a.source = ?",
                source,
            )
            pairs = pair["n"] or 0
            out.append({
                "source": source,
                "collectors": [{"method": c["ingest"], "rounds": c["n"], "lastTs": iso(c["last"]) if c["last"] else None, "lagSeconds": _round((now - c["last"]) / 1000) if c["last"] else None} for c in cs],
                "multiCollector": len(cs) >= 2,
                "pairs": pairs,
                "agreement": r4((pair["agree"] or 0) / pairs) if pairs else None,
                "disagreements": pairs - (pair["agree"] or 0),
                "note": "Reconciled on (source, ts ± 1 s, value)." if len(cs) >= 2 else "Only one collector feeds this source — consensus needs a second, independently keyed collector (WebSocket + DOM).",
            })
        return ok({"sources": out})
    if p == "collectors/disagreements" and method == "GET":
        s = q.get("source") or ""
        rows = sql.rows(
            """SELECT a.id AS a_id, b.id AS b_id, a.ts AS ts, a.multiplier AS a_m, b.multiplier AS b_m, a.ingest AS a_c, b.ingest AS b_c FROM rounds a JOIN rounds b ON a.source = b.source AND a.ingest < b.ingest AND ABS(a.ts_ms - b.ts_ms) <= 1000
       WHERE a.source = ? AND ABS(a.multiplier - b.multiplier) >= 0.005 LIMIT 200""", s)
        return ok({"source": s, "rows": rows, "quarantine": sql.rows("SELECT * FROM ingest_quarantine ORDER BY id DESC LIMIT 100")})

    # ---- F-03 fingerprint
    if p == "fingerprint" and method == "GET":
        tz = num(a.setting("tz_offset_min"), 120, -720, 840)
        stats = X.cusum_fingerprint(rounds(), tz)
        return ok({"source": q.get("source") or "all", "stats": stats, "alarm": any(s.get("alarm") for s in stats),
                   "note": "Two-sided CUSUM (k = 0.5σ, h = 5σ, in-control ARL ≈ 465 days) on daily shares; σ from the first third of days."})

    # ---- F-05 federation
    if p == "federation" and method == "GET":
        t0 = now_ms()
        srcs = sql.rows("SELECT source, COUNT(*) AS n, MAX(ts_ms) AS last FROM rounds GROUP BY source")
        return ok({
            "mode": "single-process (local SQLite)",
            "sources": [{"source": s["source"], "rounds": s["n"], "last": iso(s["last"]) if s["last"] else None} for s in srcs],
            "fanOutMs": now_ms() - t0,
            "note": "One SQLite database per deployment; source=all is the federated view. Per-source sharding can be added by running one backend per source behind the same API paths.",
        })

    # ---- F-06 dictionary
    if p == "dictionary" and method == "GET":
        rs = [r for r in rounds() if r.origin != "reconstructed"]
        words = [word_of(r.multiplier) for r in rs]
        n = len(rs)
        split = math.floor(n * 0.6)
        base_a = sum(1 for r in rs[:split] if r.multiplier >= 2) / (split or 1)
        base_b = sum(1 for r in rs[split:] if r.multiplier >= 2) / ((n - split) or 1)
        toks = sql.rows("SELECT * FROM vocabulary ORDER BY uses DESC LIMIT 400")
        # index word positions once: token match = every word of the phrase at i-g..i-1
        rows = []
        for t in toks:
            parts = str(t["token"]).split("·")
            g = len(parts)
            na = ha = nb = hb = 0
            for i in range(g, n):
                if words[i - g: i] != parts:
                    continue
                y = 1 if rs[i].multiplier >= 2 else 0
                if i < split:
                    na += 1
                    ha += y
                else:
                    nb += 1
                    hb += y
            ta = X.two_prop(ha, na, jround(base_a * split), split)
            tb = X.two_prop(hb, nb, jround(base_b * (n - split)), n - split)
            lo, hi = X.wilson_ci(hb, nb)
            rb = hb / nb if nb else 0
            rows.append({
                "id": t["id"], "token": t["token"], "layer": t["layer"], "status": t["status"], "definition": t["definition"],
                "blockA": {"n": na, "rate": r4(ha / na if na else 0), "p": ta["p"]},
                "blockB": {"n": nb, "rate": r4(rb), "lo": r4(lo), "hi": r4(hi), "p": tb["p"], "lift": r4(rb / base_b if base_b else 0), "liftLo": r4(lo / base_b if base_b else 0), "liftHi": r4(hi / base_b if base_b else 0)},
                "qA": 1, "qB": 1,
            })
        qa = X.bh_q([r["blockA"]["p"] for r in rows])
        qb = X.bh_q([r["blockB"]["p"] for r in rows])
        for i, r in enumerate(rows):
            r["qA"] = r4(qa[i])
            r["qB"] = r4(qb[i])

        def sign(x):
            return (x > 0) - (x < 0)

        formalisable = [r for r in rows if r["qA"] < 0.05 and r["qB"] < 0.05 and sign(r["blockA"]["rate"] - base_a) == sign(r["blockB"]["rate"] - base_b)]
        formal = [r for r in rows if r["status"] == "formalized"]
        precision = sum(1 for r in formal if r["blockB"]["liftLo"] > 1 or r["blockB"]["liftHi"] < 1) / len(formal) if formal else None
        return ok({"base": {"blockA": r4(base_a), "blockB": r4(base_b)}, "split": split, "rows": rows, "formalisable": [r["token"] for r in formalisable], "precision": precision,
                   "rule": "Formalisation needs BH q < 0.05 on the held-out block (B) with the same sign as the discovery block (A)."})
    m = re.match(r"^vocabulary/(\d+)/page$", p)
    if m and method == "GET":
        t = sql.one("SELECT * FROM vocabulary WHERE id = ?", int(m.group(1)))
        if not t:
            return fail("not found", 404)
        rs = [r for r in rounds() if r.origin != "reconstructed"]
        words = [word_of(r.multiplier) for r in rs]
        parts = str(t["token"]).split("·")
        g = len(parts)
        ex = []
        for i in range(g, len(rs)):
            if len(ex) >= 400:
                break
            if words[i - g: i] == parts:
                ex.append({"ts": rs[i].ts, "next": rs[i].multiplier})
        hist = sql.rows("SELECT * FROM audit_log WHERE target = ? ORDER BY created_ms DESC LIMIT 50", str(t["token"]))
        return ok({"token": t, "examples": list(reversed(ex[-40:])), "occurrences": len(ex), "history": hist})

    # ---- F-07 sequence search
    if p == "sequence/search" and method == "GET":
        return ok(X.sequence_search(rounds(), q.get("pattern") or "", inum(q.get("k"), 1, 1, 50), num(q.get("T"), 2, 1.01, 1000)))

    # ---- F-09 workbench
    if p == "workbench/families" and method == "GET":
        return ok({"families": X.ENGINE_FAMILIES})
    if p == "workbench/run" and method == "POST":
        fam = _str_or(body.get("family"), "window")
        if fam not in X.ENGINE_FAMILIES:
            return fail("unknown family")
        spec = {"family": fam, "params": body.get("params") if isinstance(body.get("params"), dict) else {}}
        src = body.get("source") if isinstance(body.get("source"), str) and body.get("source") != "all" else None
        ms = [r.multiplier for r in a.rounds_for(src) if r.origin != "reconstructed"]
        res = X.score_custom(spec, ms, inum(body.get("n"), 400, 50, 3000))
        sql.exec("INSERT INTO backtest_runs (source, kind, params, result, created_ms) VALUES (?, 'workbench', ?, ?, ?)", _str_or(body.get("source"), "all"), dumps(spec), dumps(res), now_ms())
        return ok({"spec": spec, **res})
    if p == "workbench/runs" and method == "GET":
        rows = sql.rows("SELECT * FROM backtest_runs WHERE kind = 'workbench' ORDER BY id DESC LIMIT 50")
        return ok({"runs": [{"id": r["id"], "source": r["source"], "spec": parse(r["params"], {}), "result": parse(r["result"], {}), "created": r["created_ms"]} for r in rows]})

    # ---- F-10 compare
    if p == "compare" and method == "GET":
        A, B = q.get("a") or "", q.get("b") or ""
        if not A or not B:
            return fail("a and b sources required")
        return ok({"a": A, "b": B, **X.compare_sources(a.rounds_for(A), a.rounds_for(B), q.get("metric") or "all")})

    # ---- F-11 significance
    if p == "signals/significance" and method == "GET":
        T = num(q.get("T"), 2, 1.01, 1000)
        res = X.signal_significance(rounds(), {"T": T, "window": inum(q.get("window"), 20000, 500, 250000)})
        control = X.shuffled_significance(rounds()[-20000:], T) if q.get("shuffle") == "1" else None
        return ok({**res, "shuffleControl": {"significantCount": control["significantCount"], "rate": r4(control["significantCount"] / len(X.SIGNALS))} if control else None})

    # ---- F-12 registry
    if p == "engines" and method == "GET":
        which = S.pick_ledger(a, q)
        return ok({**S.engine_leaderboard(a, which, inum(q.get("trailing"), 1000, 50, 20000)), "families": X.ENGINE_FAMILIES})
    if p == "engines" and method == "POST":
        g = need_op()
        if g:
            return g
        fam = _str_or(body.get("family"), "")
        if fam not in X.ENGINE_FAMILIES:
            return fail("family must be one of " + ", ".join(X.ENGINE_FAMILIES.keys()))
        params = dict(body.get("params")) if isinstance(body.get("params"), dict) else {}
        for d in X.ENGINE_FAMILIES[fam]["params"]:
            params[d["key"]] = num(params.get(d["key"]), d["default"], d["min"], d["max"])
        spec = {"family": fam, "params": params}
        ms = [r.multiplier for r in a.rounds_for(None) if r.origin != "reconstructed"]
        adm = X.admission_tests(spec, ms)
        if not adm["passed"]:
            return Resp({"ok": False, "error": "admission tests failed", "data": adm}, 422)
        key = f"custom:{fam}:{'-'.join(jstr(v) for v in params.values())}"[:60]
        label = _str_or(body.get("label"), f"{X.ENGINE_FAMILIES[fam]['label']} ({', '.join(f'{k}={jstr(v)}' for k, v in params.items())})")
        now = now_ms()
        sql.exec(
            """INSERT INTO engines (key, label, version, owner, kind, family, params, state, prior, admission, created_ms, updated_ms) VALUES (?, ?, '1', ?, 'custom', ?, ?, 'shadow', ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET label = excluded.label, params = excluded.params, admission = excluded.admission, updated_ms = excluded.updated_ms""",
            key, label, user["email"], fam, dumps(params), num(body.get("prior"), 0.5, 0.05, 2), dumps(adm), now, now,
        )
        sql.exec("INSERT INTO engine_history (key, from_state, to_state, reason, actor, created_ms) VALUES (?, NULL, 'shadow', 'registered — passed admission (deterministic, causal, null tape, not a stub)', ?, ?)", key, user["email"], now)
        S.reset_registry_cache()
        a.invalidate()
        return ok({"key": key, "state": "shadow", "admission": adm})
    m = re.match(r"^engines/([^/]+)/state$", p)
    if m and method == "POST":
        g = need_op()
        if g:
            return g
        key = _unq(m.group(1))
        to = _str_or(body.get("state"), "")
        if to not in ("live", "shadow", "demoted", "retired"):
            return fail("state must be live | shadow | demoted | retired")
        if key == "baseline" and to != "live":
            return fail("the measured baseline is always live")
        e = sql.one("SELECT state FROM engines WHERE key = ?", key)
        if not e:
            return fail("unknown engine", 404)
        if e["state"] == "demoted" and to == "live":
            return fail("re-promotion goes through shadow mode first")
        now = now_ms()
        sql.exec("UPDATE engines SET state = ?, updated_ms = ? WHERE key = ?", to, now, key)
        sql.exec("INSERT INTO engine_history (key, from_state, to_state, reason, actor, created_ms) VALUES (?, ?, ?, ?, ?, ?)", key, e["state"], to, _str_or(body.get("reason"), "operator change"), user["email"], now)
        S.reset_registry_cache()
        a.invalidate()
        return ok({"key": key, "from": e["state"], "to": to})
    m = re.match(r"^engines/([^/]+)/history$", p)
    if m and method == "GET":
        return ok({"history": sql.rows("SELECT * FROM engine_history WHERE key = ? ORDER BY created_ms DESC", _unq(m.group(1)))})
    if p == "engines/demotion-check" and method == "POST":
        g = need_op()
        if g:
            return g
        return ok(S.auto_demote(a, True))

    # ---- F-13 mixture by regime
    if p == "mixture" and method == "GET":
        which = S.pick_ledger(a, q)
        return ok({"ledger": which, **X.regime_weights(S.ledger_rows(a, which, 3000), {"shrink": num(q.get("shrink"), 50, 1, 1000)})})

    # ---- F-14 diff
    if p == "forecast/diff" and method == "GET":
        ids = [js_number(x) if x else None for x in (q.get("from"), q.get("to"))]

        def pick(i, off):
            return sql.one("SELECT * FROM forecast_store WHERE id = ?", i) if i else sql.one("SELECT * FROM forecast_store ORDER BY id DESC LIMIT 1 OFFSET ?", off)

        A, B = pick(ids[0], 1), pick(ids[1], 0)
        if not A or not B:
            return ok({"available": False, "note": "Need at least two stored forecasts."})

        def to_sf(r):
            return {"id": r["id"], "created_ms": r["created_ms"], "state": r["state"], "expected": r["expected"], "range_lo": r["range_lo"], "range_hi": r["range_hi"], "reach": r["reach"], "dist": parse(r["dist"], []), "comp": parse(r["comp"], [])}

        return ok({"available": True, **X.forecast_diff(to_sf(A), to_sf(B))})

    # ---- F-15 distribution
    if p == "intelligence/distribution" and method == "GET":
        r = sql.one("SELECT * FROM forecast_store ORDER BY id DESC LIMIT 1")
        rs = rounds()
        if r:
            f = {"id": r["id"], "dist": parse(r["dist"], []), "comp": parse(r["comp"], []), "created": r["created_ms"]}
        else:
            x = a.intel(rs, "all")
            f = {"id": None, "dist": [d["probability"] for d in x["distribution"]], "comp": [{"key": c["key"], "weight": c["weight"], "dist": c["distribution"]} for c in x["intelligence"]["components"]], "created": now_ms()}
        xs = [1.1, 1.2, 1.5, 2, 3, 5, 7, 10, 20, 50, 100, 200, 500, 1000]
        ms = sorted(x.multiplier for x in rs if x.origin != "reconstructed")
        import bisect

        def base(xv):
            return (len(ms) - bisect.bisect_left(ms, xv)) / len(ms) if ms else 0

        return ok({
            "forecastId": f["id"], "bands": BAND_LABELS, "mixture": f["dist"], "engines": f["comp"],
            "survival": [{"x": xv, "mixture": r4(X.survival_from_dist(f["dist"], xv)), "base": r4(base(xv)), "law": r4(min(1, 0.97 / xv)), "engines": {c["key"]: r4(X.survival_from_dist(c["dist"], xv)) for c in f["comp"]}} for xv in xs],
        })

    # ---- F-16 counterfactual
    if p == "accuracy/counterfactual" and method == "GET":
        which = S.pick_ledger(a, q)
        rows = S.ledger_rows(a, which, inum(q.get("n"), 2000, 50, 20000))
        w = q.get("without")
        keys = [w] if w else list(dict.fromkeys(k for r in rows for k in r["weights"].keys()))
        return ok({"ledger": which, "rows": [X.counterfactual(rows, k) for k in keys]})

    # ---- F-17 reliability studio
    if p == "accuracy/reliability" and method == "GET":
        which = S.pick_ledger(a, q)
        rows = S.ledger_rows(a, which, inum(q.get("n"), 5000, 50, 50000))
        T = num(q.get("threshold"), 2, 1.01, 1000)
        model = q.get("model") or "mixture"
        comp_by_id = {}
        if model != "mixture" and which == "stored" and rows:
            for cr in sql.rows(f"SELECT id, comp FROM forecast_store WHERE id IN ({','.join('?' for _ in rows)})", *[r["id"] for r in rows]) if len(rows) < 900 else sql.rows("SELECT id, comp FROM forecast_store"):
                comp_by_id[cr["id"]] = cr["comp"]
        pr = []
        for r in rows:
            d = r["dist"]
            if model != "mixture" and which == "stored":
                c = next((x for x in parse(comp_by_id.get(r["id"]), []) if x.get("key") == model), None)
                if c:
                    d = c["dist"]
            pr.append({"p": X.survival_from_dist(d, T), "y": 1 if r["actual"] >= T else 0})
        return ok({"ledger": which, "model": model, "threshold": T, **X.reliability(pr)})
    if p == "accuracy/pit" and method == "GET":
        which = S.pick_ledger(a, q)
        rows = S.ledger_rows(a, which, inum(q.get("n"), 5000, 50, 50000))
        return ok({"ledger": which, **X.pit_histogram([{"dist": r["dist"], "actual": r["actual"]} for r in rows])})
    if p == "accuracy/coverage" and method == "GET":
        which = S.pick_ledger(a, q)
        rows = S.ledger_rows(a, which, inum(q.get("n"), 5000, 50, 50000))
        prof = range_profile(a.setting("range_profile"))
        return ok({"ledger": which, **X.coverage_aci([{"dist": r["dist"], "lo": r["lo"], "hi": r["hi"], "actual": r["actual"]} for r in rows], num(q.get("target"), prof["nominal"], 0.1, 0.95), num(q.get("gamma"), 0.01, 0.001, 0.2)), "rangeProfile": prof["name"]})

    # ---- F-18 ledger
    if p == "ledger/head" and method == "GET":
        last = sql.one("SELECT seq, row_hash, created_ms FROM ledger_chain ORDER BY seq DESC LIMIT 1")
        return ok({"seq": (last or {}).get("seq", 0), "head": (last or {}).get("row_hash", S.GENESIS), "at": (last or {}).get("created_ms"), "genesis": S.GENESIS, "daily": sql.rows("SELECT * FROM ledger_heads ORDER BY day DESC LIMIT 60")})
    if p == "ledger/export" and method == "GET":
        frm = inum(q.get("from"), 1, 1)
        lim = inum(q.get("limit"), 2000, 1, 20000)
        rows = sql.rows("SELECT seq, kind, ref_id, payload, prev_hash, row_hash, created_ms FROM ledger_chain WHERE seq >= ? ORDER BY seq LIMIT ?", frm, lim)
        return ok({"from": frm, "rows": rows, "algorithm": "row_hash = sha256(prev_hash + '|' + canonical_json(payload))", "genesis": S.GENESIS})
    if p == "ledger/verify" and method == "GET":
        rows = sql.rows("SELECT seq, payload, prev_hash, row_hash FROM ledger_chain ORDER BY seq")
        prev = S.GENESIS
        bad = None
        for r in rows:
            h = X.chain_hash(prev, json.loads(r["payload"]))
            if r["prev_hash"] != prev or h != r["row_hash"]:
                bad = r["seq"]
                break
            prev = h
        tampered = 0
        for r in sql.rows("SELECT f.id, f.expected, f.range_lo, f.range_hi, c.payload FROM forecast_store f JOIN ledger_chain c ON c.seq = f.chain_seq"):
            pl = json.loads(r["payload"])
            if abs(pl["expected"] - r["expected"]) > 1e-9 or abs(pl["lo"] - r["range_lo"]) > 1e-9 or abs(pl["hi"] - r["range_hi"]) > 1e-9:
                tampered += 1
        return ok({"rows": len(rows), "valid": bad is None and tampered == 0, "firstBadSeq": bad, "tamperedForecasts": tampered, "head": prev})
    if p == "ledger/backfill" and method == "POST":
        g = need_op()
        if g:
            return g
        n = inum(body.get("n"), 100, 1, 300)
        all_r = a.rounds_for(None)
        t = sql.scalar("SELECT MIN(after_ts_ms) AS t FROM forecast_store")
        stop = t if t is not None else INF
        end = len(all_r) - 1
        while end > 0 and all_r[end].tsMs >= stop:
            end -= 1
        start = max(150, end - n + 1)
        made = 0
        t0 = now_ms()
        for i in range(start, end + 1):
            if all_r[i].origin == "reconstructed":
                continue
            S.store_forecast(a, all_r[: i + 1], "backfill")
            made += 1
            if now_ms() - t0 > 25_000:
                break
        S.resolve_open(a, all_r)
        return ok({"created": made, "elapsedMs": now_ms() - t0, "note": "Backfilled rows are causal walk-forward forecasts created now; they are chained with origin = backfill and can be excluded from any metric."})
    if p == "ledger/forecasts" and method == "GET":
        lim = inum(q.get("limit"), 100, 1, 2000)
        rows = sql.rows("SELECT * FROM forecast_store WHERE created_ms <= ? ORDER BY id DESC LIMIT ?", as_of, lim) if as_of else sql.rows("SELECT * FROM forecast_store ORDER BY id DESC LIMIT ?", lim)
        stats = sql.one("SELECT COUNT(*) AS n, SUM(resolved_ms IS NOT NULL) AS resolved, SUM(void) AS voided, SUM(origin = 'live') AS live, AVG(CASE WHEN void = 0 THEN base_loss - mix_loss END) AS skill FROM forecast_store")
        return ok({"stats": stats, "rows": [{**{k: v for k, v in r.items() if k not in ("comp", "cone", "comp_loss")}, "dist": parse(r["dist"], [])} for r in rows]})

    # ---- F-19 gates
    if p == "app/gate" and method == "GET":
        lb = S.engine_leaderboard(a, S.pick_ledger(a, q), 2000)
        min_n = inum(q.get("minN"), 300, 30, 100000)
        mix = lb["mixture"]
        mix_ok = mix["n"] >= min_n and mix["lo"] is not None and mix["lo"] > 0
        passing = [e["key"] for e in lb["engines"] if e["n"] >= min_n and (e["lo"] if e["lo"] is not None else -1) > 0]
        return ok({"minN": min_n, "mixture": {**mix, "passes": mix_ok}, "passing": passing, "showBaseRate": not mix_ok, "label": "skill-backed forecast" if mix_ok else "base rate",
                   "note": f"The mixture's skill CI lower bound is above 0 at n ≥ {min_n}." if mix_ok else f"No producer has a skill CI lower bound above 0 at n ≥ {min_n}; consumer cards show the measured base rate, clearly labelled."})

    # ---- F-21 cone
    if p == "intelligence/cone" and method == "GET":
        h = inum(q.get("h"), 5, 1, 20)
        r = sql.one("SELECT * FROM forecast_store ORDER BY id DESC LIMIT 1")
        rs = rounds()
        intel = None if r else a.intel(rs, "all")
        dist = parse(r["dist"], []) if r else [d["probability"] for d in intel["distribution"]]
        cad = X.median_interval_ms(rs)
        last = rs[-1] if rs else None
        eta = [x for x in X.eta_board(rs)["rows"] if x["threshold"] in (10, 50)]
        res = S.ledger_rows(a, S.pick_ledger(a, q), 2000)
        qd = X.quantile_from_dist
        cov = sum(1 for x in res if qd(x["dist"], 0.25) <= x["actual"] <= qd(x["dist"], 0.75)) / len(res) if res else None
        cov90 = sum(1 for x in res if x["actual"] <= qd(x["dist"], 0.9)) / len(res) if res else None
        t0 = last.tsMs if last else now_ms()
        return ok({
            "forecastId": r["id"] if r else None,
            "lastTs": last.tsMs if last else None,
            "cadenceMs": _round(cad),
            "cone": [{**c, "t": t0 + c["h"] * cad} for c in S.cone_from(dist, h)],
            "etaMarkers": [{"threshold": e["threshold"], "rounds": e.get("etaMedian"), "at": e.get("etaMedianAt")} for e in eta],
            "coverage": {"p25p75": r4(cov) if cov is not None else None, "belowP90": r4(cov90) if cov90 is not None else None, "n": len(res)},
            "intelligence": S.intel_summary(intel if intel is not None else (a.intel(rs, "all") if len(rs) >= 50 else None)),
        })

    # ---- F-22 drawn predictions + leaderboard
    if p == "predictions" and method == "POST":
        level = num(body.get("level"), 0, 1.01, 10000)
        horizon = _round(num(body.get("horizon") if body.get("horizon") is not None else body.get("rounds"), 10, 1, 500))
        minutes = num(body.get("minutes"), 0, 0.5, 1440) if body.get("minutes") is not None else None
        if not level:
            return fail("level (×) required")
        rs = a.rounds_for(None)
        cad = X.median_interval_ms(rs)
        H = max(1, _round((minutes * 60_000) / cad)) if minutes else horizon
        last = rs[-1] if rs else None
        if not last:
            return fail("no rounds yet")
        fr = sql.one("SELECT dist FROM forecast_store ORDER BY id DESC LIMIT 1")
        dist = parse(fr["dist"], []) if fr else [d["probability"] for d in a.intel(rs, "all")["distribution"]]
        p_one = X.survival_from_dist(dist, level)
        mix_p = r4(1 - (1 - p_one) ** H)
        prob = r4(num(body.get("probability"), mix_p, 0.001, 0.999))
        user_key = f"user:{user['id']}" if user else f"anon:{_str_or(body.get('clientId'), 'guest')[:40]}"
        display = _str_or(body.get("displayName") if body.get("displayName") is not None else (user or {}).get("name"), "guest")[:40]
        with sql.transaction():
            pid = sql.exec(
                "INSERT INTO drawn_predictions (user_key, display_name, source, level, horizon, probability, mixture_p, after_round_id, after_ts_ms, drawing, created_ms) VALUES (?, ?, 'all', ?, ?, ?, ?, ?, ?, ?, ?)",
                user_key, display, level, H, prob, mix_p, last.id, last.tsMs, dumps(body["drawing"]) if truthy(body.get("drawing")) else None, now_ms(),
            ).lastrowid
            seq = S.append_chain(sql, "prediction", pid, {"user": user_key, "level": level, "horizon": H, "probability": prob, "mixtureP": mix_p, "afterRoundId": last.id})
            sql.exec("UPDATE drawn_predictions SET chain_seq = ? WHERE id = ?", seq, pid)
        return ok({"id": pid, "level": level, "horizon": H, "probability": prob, "mixtureP": mix_p, "etaMinutes": r2((H * cad) / 60_000), "chainSeq": seq})
    if p == "predictions" and method == "GET":
        who = q.get("user")
        rows = sql.rows("SELECT * FROM drawn_predictions WHERE user_key = ? ORDER BY id DESC LIMIT 200", who) if who else sql.rows("SELECT * FROM drawn_predictions ORDER BY id DESC LIMIT 200")
        rel = None
        if who:
            res = [r for r in rows if r["resolved_ms"] and not r["void"]]
            rel = X.reliability([{"p": r["probability"], "y": r["actual"]} for r in res], 5)
        return ok({"rows": rows, "reliability": rel})
    if p == "leaderboard" and method == "GET":
        period = q.get("period") or "all"
        now = now_ms()
        since = now - 86_400_000 if period == "daily" else now - 7 * 86_400_000 if period == "weekly" else 0
        min_n = inum(q.get("minN"), 30, 1, 10000)
        rows = sql.rows("SELECT * FROM drawn_predictions WHERE resolved_ms IS NOT NULL AND void = 0 AND created_ms >= ?", since)
        by: dict[str, list] = {}
        for r in rows:
            by.setdefault(r["user_key"], []).append(r)
        users = []
        for k, rs in by.items():
            d = [r["mix_logloss"] - r["logloss"] for r in rs]
            lo, hi = X.block_bootstrap_ci(d, {"seed": len(k)})
            users.append({"user": k, "name": rs[-1]["display_name"], "n": len(rs), "hits": sum(1 for r in rs if r["actual"] == 1), "skill": r4(X.mean(d)),
                          "lo": r4(lo) if math.isfinite(lo) else None, "hi": r4(hi) if math.isfinite(hi) else None, "ranked": len(rs) >= min_n, "beatsPlatform": math.isfinite(lo) and lo > 0})
        users.sort(key=lambda u: (-int(u["ranked"]), -u["skill"]))
        ranked = [u for u in users if u["ranked"]]
        chance = None
        if ranked:
            def lcg(seed):
                s = [seed]

                def nxt():
                    s[0] = (s[0] * 1664525 + 1013904223) % 4294967296
                    return s[0] / 4294967296

                return nxt

            pos = 0
            sims = 200
            nn = max(30, _round(X.mean([u["n"] for u in ranked])))
            for si in range(sims):
                rnd = lcg(si + 1)
                d = []
                for _ in range(nn if rows else 0):
                    row = rows[math.floor(rnd() * len(rows))]
                    pm = row["mixture_p"]
                    pn = min(0.999, max(0.001, pm + (rnd() - 0.5) * 0.2))
                    y = row["actual"]

                    def ll(pp):
                        return -(y * math.log(pp) + (1 - y) * math.log(1 - pp))

                    d.append(ll(pm) - ll(pn))
                lo, _hi = X.block_bootstrap_ci(d, {"B": 100, "seed": si})
                if lo > 0:
                    pos += 1
            chance = r4((pos / sims) * len(ranked))
        return ok({"period": period, "minN": min_n, "users": users, "rankedUsers": len(ranked), "positiveSkillUsers": sum(1 for u in ranked if u["beatsPlatform"]), "expectedByChance": chance,
                   "scoring": "log-score skill vs the platform mixture (positive = you beat Momento)"})

    # ---- F-24 / F-08 replay with narration
    if p == "replay" and method == "GET":
        all_r = a.rounds_for(src_of(q))
        to = num(q.get("to"), all_r[-1].tsMs if all_r else now_ms())
        frm = num(q.get("from"), to - num(q.get("minutes"), 30, 1, 1440) * 60_000)
        idx0 = next((i for i, r in enumerate(all_r) if r.tsMs >= frm), -1)
        sl = [r for r in all_r if frm <= r.tsMs <= to][: inum(q.get("limit"), 400, 1, 3000)]
        fs = sql.rows("SELECT id, after_ts_ms, created_ms, state, expected, range_lo, range_hi, reach, dist, origin FROM forecast_store WHERE after_ts_ms >= ? AND after_ts_ms <= ? ORDER BY after_ts_ms", frm - 60 * 60_000, to)
        below2 = since10 = 0
        for i in range(0 if idx0 < 0 else idx0):
            below2 = below2 + 1 if all_r[i].multiplier < 2 else 0
            since10 = 0 if all_r[i].multiplier >= 10 else since10 + 1
        fi = 0
        current = None
        frames = []
        for r in sl:
            while fi < len(fs) and fs[fi]["after_ts_ms"] < r.tsMs:
                current = fs[fi]
                fi += 1
            stored = {"id": current["id"], "expected": current["expected"], "lo": current["range_lo"], "hi": current["range_hi"], "state": current["state"], "origin": current["origin"]} if current else None
            caption = X.narrate(r.multiplier, {"below2": below2, "since10": since10}, stored)
            below2 = below2 + 1 if r.multiplier < 2 else 0
            since10 = 0 if r.multiplier >= 10 else since10 + 1
            frames.append({"id": r.id, "ts": r.ts, "tsMs": r.tsMs, "multiplier": r.multiplier, "origin": r.origin, "forecast": stored, "caption": caption})
        return ok({"from": frm, "to": to, "frames": frames, "storedForecasts": len(fs),
                   "note": "Forecasts are the rows stored at the time, never recomputed." if fs else "No stored forecasts in this window yet — backfill the ledger or wait for live rounds."})

    # ---- F-26 / F-27 / F-29 survival
    if p == "eta/board" and method == "GET":
        rs = rounds()
        board = X.eta_board(rs)
        try:
            intelligence = S.intel_summary(a.intel(rs, "all")) if len(rs) >= 50 else None
        except Exception:
            intelligence = None
        return ok({**board, "intelligence": intelligence})
    if p == "eta/hazard" and method == "GET":
        return ok(X.hazard_timeline(rounds(), num(q.get("T"), 10, 1.01, 1000), inum(q.get("maxG"), 120, 10, 2000)))
    if p == "eta/inround" and method == "GET":
        return ok(X.in_round_eta(rounds(), num(q.get("m0"), 1, 1, 10000)))

    # ---- F-30 decisions
    if p == "decisions" and method == "GET":
        prod = q.get("producer")
        S.sync_autopilot(a)
        rows = sql.rows("SELECT * FROM decisions WHERE producer = ? ORDER BY id DESC LIMIT 300", prod) if prod else sql.rows("SELECT * FROM decisions ORDER BY id DESC LIMIT 300")
        return ok({"rows": [{**r, "reasons": parse(r["reasons"], [])} for r in rows]})
    if p == "decisions/leaderboard" and method == "GET":
        return ok(S.decision_leaderboard(a, rounds()))
    if p == "decisions" and method == "POST":
        rs = a.rounds_for(None)
        last = rs[-1] if rs else None
        if not last:
            return fail("no rounds")
        producer = f"user:{user['email']}" if user else f"user:{_str_or(body.get('clientId'), 'guest')[:40]}"
        now = now_ms()
        sql.exec(
            "INSERT INTO decisions (producer, source, ref, action, target, probability, stake, horizon, after_ts_ms, reasons, created_ms) VALUES (?, 'all', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            producer, f"{producer}:{now}", _str_or(body.get("action"), "stake"), num(body.get("target"), 2, 1.01, 1000),
            num(body.get("probability"), 0.5, 0, 1) if body.get("probability") is not None else None, num(body.get("stake"), 1, 0, 1e6),
            _round(num(body.get("horizon"), 1, 1, 100)), last.tsMs, dumps([_str_or(body.get("reason"), "manual")]), now,
        )
        return ok({"recorded": True})

    # ---- F-31 tells
    if p == "tells" and method == "GET":
        return ok({"kappa": 0.25, "tells": X.kelly_tells(rounds(), {"kappa": num(q.get("kappa"), 0.25, 0, 0.25), "cap": num(q.get("cap"), 0.02, 0, 0.2)}),
                   "rule": "f = κ·(p·x − 1)/(x − 1) with p = Wilson lower bound (n ≥ 100), κ ≤ 0.25, tier cap; f = 0 whenever p·x ≤ 1."})

    # ---- F-32 simulator
    if p == "simulate" and method == "POST":
        s = body.get("strategy") if isinstance(body.get("strategy"), dict) else {}
        strat = {
            "cashout": num(s.get("cashout"), 2, 1.01, 1000),
            "stakeMode": "fraction" if s.get("stakeMode") == "fraction" else "flat",
            "stake": num(s.get("stake"), 1, 0.0001, 1e6),
            "roundsPerSession": _round(num(s.get("roundsPerSession"), 60, 5, 2000)),
        }
        if s.get("stopLoss") is not None and s.get("stopLoss") != "":
            strat["stopLoss"] = num(s.get("stopLoss"), 0, 0, 1e9)
        if s.get("takeProfit") is not None and s.get("takeProfit") != "":
            strat["takeProfit"] = num(s.get("takeProfit"), 0, 0, 1e9)
        src = body.get("source") if isinstance(body.get("source"), str) and body.get("source") != "all" else None
        return ok(X.simulate_bankroll(a.rounds_for(src), strat, {"sessions": _round(num(body.get("sessions"), 20, 1, 500)), "bankroll": num(body.get("bankroll"), 100, 1, 1e9), "paths": _round(num(body.get("paths"), 400, 50, 3000))}))

    # ---- F-33 coach
    if p == "coach" and method == "GET":
        rs = [r for r in rounds() if r.origin != "reconstructed"]
        now = now_ms()
        cap = num(q.get("cap"), 50, 0, 1e9)
        spent = num(q.get("spent"), 0, 0, 1e9)
        started = num(q.get("started"), now - 45 * 60_000)
        usual = num(q.get("usualMinutes"), 40, 1, 1440)
        len_min = (now - started) / 60_000
        below = 0
        for r in reversed(rs):
            if r.multiplier >= 2:
                break
            below += 1
        recent = [r.multiplier for r in rs[-30:]]
        cold = sum(1 for m in recent if m >= 2) / len(recent) if recent else 0
        lines = []
        if cap > 0:
            lines.append({"tone": "stop" if spent / cap >= 0.9 else "warn" if spent / cap >= 0.7 else "info", "text": f"Loss cap {_round((spent / cap) * 100)}% used ({js_str(r2(spent))} of {js_str(r2(cap))})."})
        lines.append({"tone": "warn" if len_min / usual >= 2 else "info", "text": f"Session length {js_str(r2(len_min / usual))}× your usual ({_round(len_min)} min vs {_round(usual)})."})
        if below >= 5:
            lines.append({"tone": "warn", "text": f"{below} rounds below 2× in a row. On this tape the next round's chance of ≥ 2× is unchanged by streaks — the guard asks you to pause, not to chase."})
        lines.append({"tone": "info", "text": f"Last 30 rounds: {_round(cold * 100)}% reached 2×."})
        guard = "stop" if any(l["tone"] == "stop" for l in lines) else "caution" if any(l["tone"] == "warn" for l in lines) else "ok"
        return ok({"guard": guard, "lines": lines, "capUsed": r4(spent / cap) if cap else None, "sessionMinutes": _round(len_min)})

    # ---- F-34 experiments
    if p == "experiments/draft" and method == "POST":
        text = _str_or(body.get("hypothesis"), "").strip()
        if not text:
            return fail("hypothesis required")
        return ok({"spec": X.parse_hypothesis(text), "draftedBy": "parser", "note": "Review the drafted spec — a person approves it before it runs."})
    if p == "experiments" and method == "POST":
        spec_in = body.get("spec") if isinstance(body.get("spec"), dict) else X.parse_hypothesis(_str_or(body.get("hypothesis"), ""))
        if not spec_in or not spec_in.get("condition") or not spec_in.get("target"):
            return fail("spec.condition and spec.target required")
        cond, tgt = spec_in["condition"], spec_in["target"]
        spec = {
            "name": _str_or(spec_in.get("name") if spec_in.get("name") is not None else body.get("hypothesis"), "experiment")[:100],
            "hypothesis": _str_or(spec_in.get("hypothesis") if spec_in.get("hypothesis") is not None else body.get("hypothesis"), ""),
            "condition": {"kind": cond.get("kind"), "x": num(cond.get("x"), 2, 1.01, 1000), "k": _round(num(cond.get("k"), 3, 1, 500)), "pattern": cond.get("pattern")},
            "target": {"x": num(tgt.get("x"), 2, 1.01, 1000), "h": _round(num(tgt.get("h"), 1, 1, 100))},
            "split": num(spec_in.get("split"), 0.6, 0.3, 0.9),
        }
        if spec["condition"]["pattern"] is None:
            del spec["condition"]["pattern"]
        family = _str_or(body.get("family"), "default")
        res = X.run_experiment(spec, rounds(), {"shuffles": 30, "plants": 20})
        now = now_ms()
        with sql.transaction():
            eid = sql.exec(
                "INSERT INTO experiments (name, hypothesis, spec, result, p, verdict, lifecycle, family, drafted_by, approved_by, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?, 'pending', 'running', ?, ?, ?, ?, ?)",
                spec["name"], spec["hypothesis"], dumps(spec), dumps(res), res["test"]["p"], family, _str_or(body.get("draftedBy"), "parser"), (user or {}).get("email") or "console", now, now,
            ).lastrowid
            fam = sql.rows("SELECT id, p, result FROM experiments WHERE family = ? AND p IS NOT NULL ORDER BY id", family)
            qs = X.bh_q([f["p"] for f in fam])
            for i, f in enumerate(fam):
                rr = json.loads(f["result"])
                v = X.verdict_for(rr, qs[i])
                sql.exec("UPDATE experiments SET q = ?, verdict = ?, lifecycle = CASE WHEN lifecycle IN ('promoted','shadow') THEN lifecycle ELSE ? END, updated_ms = ? WHERE id = ?", r4(qs[i]), v["verdict"], v["lifecycle"], now, f["id"])
        row = sql.one("SELECT * FROM experiments WHERE id = ?", eid)
        return ok({**row, "spec": spec, "result": res, "familySize": len(fam), "reason": X.verdict_for(res, row["q"])["reason"]})
    if p == "experiments" and method == "GET":
        rows = sql.rows("SELECT * FROM experiments ORDER BY id DESC LIMIT 200")
        return ok({"rows": [{**r, "spec": parse(r["spec"], {}), "result": parse(r["result"], None)} for r in rows]})
    m = re.match(r"^experiments/(\d+)$", p)
    if m and method == "GET":
        r = sql.one("SELECT * FROM experiments WHERE id = ?", int(m.group(1)))
        if not r:
            return fail("not found", 404)
        res = parse(r["result"], None)
        return ok({**r, "spec": parse(r["spec"], {}), "result": res, "reason": X.verdict_for(res, r["q"] if r["q"] is not None else 1)["reason"] if res else None})
    m = re.match(r"^experiments/(\d+)/promote$", p)
    if m and method == "POST":
        g = need_op()
        if g:
            return g
        r = sql.one("SELECT * FROM experiments WHERE id = ?", int(m.group(1)))
        if not r:
            return fail("not found", 404)
        if r["verdict"] != "supported":
            return fail("only supported experiments can be promoted into the registry")
        spec = parse(r["spec"], None) or {}
        cond = spec.get("condition") or {}
        params = {"x": cond.get("x") if cond.get("x") is not None else 2, "k": cond.get("k") if cond.get("k") is not None else 3, "window": 5000}
        key = f"custom:exp{r['id']}"
        adm = X.admission_tests({"family": "conditional", "params": params}, [x.multiplier for x in a.rounds_for(None)])
        now = now_ms()
        sql.exec(
            "INSERT INTO engines (key, label, version, owner, kind, family, params, state, prior, admission, created_ms, updated_ms) VALUES (?, ?, '1', ?, 'custom', 'conditional', ?, 'shadow', 0.4, ?, ?, ?) ON CONFLICT(key) DO NOTHING",
            key, f"Experiment #{r['id']}: {str(r['name'])[:50]}", user["email"], dumps(params), dumps(adm), now, now,
        )
        sql.exec("INSERT INTO engine_history (key, from_state, to_state, reason, actor, created_ms) VALUES (?, NULL, 'shadow', ?, ?, ?)", key, f"promoted from experiment #{r['id']}", user["email"], now)
        sql.exec("UPDATE experiments SET lifecycle = 'shadow', engine_key = ?, updated_ms = ? WHERE id = ?", key, now, r["id"])
        S.reset_registry_cache()
        return ok({"key": key, "state": "shadow", "admission": adm})

    # ---- F-35 explain
    m = re.match(r"^forecast/(latest|\d+)/explain$", p)
    if m and method == "GET":
        row = sql.one("SELECT * FROM forecast_store ORDER BY id DESC LIMIT 1") if m.group(1) == "latest" else sql.one("SELECT * FROM forecast_store WHERE id = ?", int(m.group(1)))
        rs = a.rounds_for(None)
        if not row:
            fid = S.store_forecast(a, rs, "live")
            if fid:
                row = sql.one("SELECT * FROM forecast_store WHERE id = ?", fid)
        if not row:
            return ok({"available": False})
        sql.exec("INSERT INTO event_log (kind, meta, created_ms) VALUES ('explain.open', ?, ?)", js_str(row["id"]), now_ms())
        hist = [r for r in rs if r.tsMs <= row["after_ts_ms"]]
        return ok({"available": True, **S.explain(a, row, hist)})
    if p == "events" and method == "POST":
        sql.exec("INSERT INTO event_log (kind, meta, created_ms) VALUES (?, ?, ?)", _str_or(body.get("kind"), "view")[:40], dumps(body.get("meta"))[:500], now_ms())
        return ok({"logged": True})
    if p == "events/summary" and method == "GET":
        rows = sql.rows("SELECT kind, COUNT(*) AS n FROM event_log WHERE created_ms > ? GROUP BY kind", now_ms() - 7 * 86_400_000)
        views = next((r["n"] for r in rows if r["kind"] == "forecast.view"), 0)
        opens = next((r["n"] for r in rows if r["kind"] == "explain.open"), 0)
        return ok({"rows": rows, "whyRate": r4(opens / views) if views else None, "target": 0.2})

    # ---- F-36 fairness
    if p == "fair/battery" and method == "GET":
        return ok(X.fairness_battery(rounds()))
    if p == "fair/verify" and method == "POST":
        server = _str_or(body.get("server") if body.get("server") is not None else body.get("serverSeed"), "")
        if not server:
            return fail("server seed required")
        inp = {"server": server}
        if isinstance(body.get("clients"), list):
            inp["clients"] = [jstr(c) for c in body["clients"]]
        if body.get("client") is not None:
            inp["client"] = jstr(body["client"])
        if body.get("nonce") is not None:
            inp["nonce"] = js_number(body["nonce"])
        if body.get("observed") is not None:
            inp["observed"] = js_number(body["observed"])
        res = X.verify_all(inp)
        return ok({"results": res, "matches": [r["convention"] for r in res if r.get("match")]})
    if p == "fair/solve" and method == "POST":
        lst = body.get("rounds") if isinstance(body.get("rounds"), list) else []
        if not lst:
            return fail("rounds [{server, client|clients, nonce, observed}] required")
        conv = []
        for r in lst:
            r = r if isinstance(r, dict) else {}
            item = {"server": _str_or(r.get("server"), "")}
            if r.get("client") is not None:
                item["client"] = jstr(r["client"])
            if isinstance(r.get("clients"), list):
                item["clients"] = [jstr(c) for c in r["clients"]]
            if r.get("nonce") is not None:
                item["nonce"] = js_number(r["nonce"])
            if r.get("observed") is not None:
                item["observed"] = js_number(r["observed"])
            conv.append(item)
        return ok(X.solve_convention(conv))
    if p == "fair/chain" and method == "POST":
        return ok(X.verify_seed_chain(_str_or(body.get("revealed"), ""), _str_or(body.get("committed"), ""), inum(body.get("maxDepth"), 2000, 1, 20000)))

    # ---- F-37 ask
    if p == "knowledge/ask" and method == "POST":
        qn = _str_or(body.get("q") if body.get("q") is not None else body.get("question"), "").strip()
        if not qn:
            return fail("question required")
        passages = [x for x in body.get("passages")[:8] if isinstance(x, dict)] if isinstance(body.get("passages"), list) else []
        passages = [{"id": jstr(x.get("id")), "title": jstr(x.get("title")) if x.get("title") is not None else "", "text": jstr(x.get("text")) if x.get("text") is not None else ""} for x in passages]
        return ok(S.ask_momento(a, qn, passages))

    # ---- F-38 alerts
    if p == "alerts/fields" and method == "GET":
        return ok({"fields": S.ALERT_FIELDS, "current": S.live_fields(a, a.rounds_for(None)), "presets": [
            {"name": "10× gap past its 90th percentile", "field": "eta.10.kmPercentile", "op": ">=", "value": 90},
            {"name": "50× gap past its 90th percentile (F-28)", "field": "eta.50.kmPercentile", "op": ">=", "value": 90},
            {"name": "Anchor forming (F-25)", "field": "anchor.active", "op": "=", "value": 1},
            {"name": "5+ rounds below 2×", "field": "streak.below2", "op": ">=", "value": 5},
            {"name": "Moonshot landed (≥ 50×)", "field": "last.multiplier", "op": ">=", "value": 50},
        ]})
    if p == "alerts/rules" and method == "GET":
        return ok({"rules": sql.rows("SELECT * FROM alert_rules ORDER BY id DESC")})
    if p == "alerts/rules" and method == "POST":
        field = _str_or(body.get("field"), "")
        if not any(f["field"] == field for f in S.ALERT_FIELDS):
            return fail("unknown field")
        op = _str_or(body.get("op"), ">=")
        if op not in (">=", "<=", ">", "<", "="):
            return fail("op must be one of >= <= > < =")
        qf, qt = body.get("quiet_from"), body.get("quiet_to")
        sql.exec(
            "INSERT INTO alert_rules (owner, name, field, op, value, source, channel, debounce_s, quiet_from, quiet_to, daily_cap, created_ms) VALUES (?, ?, ?, ?, ?, 'all', ?, ?, ?, ?, ?, ?)",
            (user or {}).get("email") or "console", _str_or(body.get("name"), field)[:80], field, op, num(body.get("value"), 0), _str_or(body.get("channel"), "in-app"),
            _round(num(body.get("debounce_s"), 300, 0, 86400)),
            _round(num(qf, 0, 0, 23)) if qf is not None and qf != "" else None, _round(num(qt, 0, 0, 23)) if qt is not None and qt != "" else None,
            _round(num(body.get("daily_cap"), 20, 1, 500)), now_ms(),
        )
        return ok({"created": True})
    m = re.match(r"^alerts/rules/(\d+)$", p)
    if m and method == "DELETE":
        sql.exec("DELETE FROM alert_rules WHERE id = ?", int(m.group(1)))
        return ok({"deleted": True})
    m = re.match(r"^alerts/rules/(\d+)/toggle$", p)
    if m and method == "POST":
        sql.exec("UPDATE alert_rules SET enabled = 1 - enabled WHERE id = ?", int(m.group(1)))
        return ok({"toggled": True})
    if p == "alerts" and method == "GET":
        rows = sql.rows("SELECT * FROM alerts ORDER BY id DESC LIMIT ?", inum(q.get("limit"), 50, 1, 500))
        unread = sql.scalar("SELECT COUNT(*) AS n FROM alerts WHERE read = 0", default=0)
        rated = sql.one("SELECT COUNT(*) AS n, SUM(rating > 0) AS good FROM alerts WHERE rating IS NOT NULL")
        return ok({"rows": rows, "unread": unread, "precision": r4((rated["good"] or 0) / rated["n"]) if rated["n"] else None})
    if p == "alerts/read" and method == "POST":
        if truthy(body.get("id")):
            sql.exec("UPDATE alerts SET read = 1 WHERE id = ?", js_number(body["id"]))
        else:
            sql.exec("UPDATE alerts SET read = 1")
        return ok({"read": True})
    if p == "alerts/rate" and method == "POST":
        sql.exec("UPDATE alerts SET rating = ? WHERE id = ?", 1 if js_number(body.get("rating")) > 0 else -1, js_number(body.get("id")))
        return ok({"rated": True})

    if p == "platform/book" and method == "GET":
        def c(t, w=""):
            return sql.scalar(f"SELECT COUNT(*) AS n FROM {t} {w}", default=0)

        return ok({
            "version": "6.5.0",
            "stored": {"forecasts": c("forecast_store"), "resolved": c("forecast_store", "WHERE resolved_ms IS NOT NULL"), "voided": c("forecast_store", "WHERE void = 1"), "chain": c("ledger_chain"),
                       "predictions": c("drawn_predictions"), "decisions": c("decisions"), "experiments": c("experiments"), "engines": c("engines"), "alertRules": c("alert_rules"), "alerts": c("alerts")},
            "features": FEATURE_STATUS,
        })
    return None


def _unq(s: str) -> str:
    from urllib.parse import unquote

    return unquote(s)


FEATURE_STATUS = [
    {"id": "F-01", "name": "Tape Integrity Score", "status": "live", "where": "/dashboard/integrity", "api": "/integrity, /integrity/summary"},
    {"id": "F-02", "name": "Multi-collector consensus", "status": "partial", "where": "/dashboard/integrity", "api": "/collectors, /collectors/disagreements"},
    {"id": "F-03", "name": "Source fingerprinting (CUSUM)", "status": "live", "where": "/dashboard/fairness", "api": "/fingerprint"},
    {"id": "F-04", "name": "Time-travel queries (as_of)", "status": "live", "where": "TopBar time control", "api": "?as_of=, /asof/*"},
    {"id": "F-05", "name": "Per-source sharding / federated view", "status": "partial", "where": "/dashboard/integrity", "api": "/federation"},
    {"id": "F-06", "name": "Living Dictionary", "status": "live", "where": "/dashboard/dictionary", "api": "/dictionary, /vocabulary/{id}/page"},
    {"id": "F-07", "name": "Sequence search", "status": "live", "where": "/dashboard/sequence", "api": "/sequence/search"},
    {"id": "F-08", "name": "Narrated replay", "status": "live", "where": "/dashboard/replay", "api": "/replay"},
    {"id": "F-09", "name": "Engine Workbench", "status": "live", "where": "/dashboard/engines", "api": "/workbench/run, /workbench/runs"},
    {"id": "F-10", "name": "Cross-source comparator", "status": "live", "where": "/dashboard/sequence", "api": "/compare"},
    {"id": "F-11", "name": "Signal significance strip", "status": "live", "where": "Command Center", "api": "/signals/significance"},
    {"id": "F-12", "name": "Engine Marketplace / registry", "status": "live", "where": "/dashboard/engines", "api": "/engines, /engines/{key}/state"},
    {"id": "F-13", "name": "Regime-aware weights", "status": "live", "where": "/dashboard/engines", "api": "/mixture?by=regime"},
    {"id": "F-14", "name": "Forecast diff", "status": "live", "where": "/dashboard/explain", "api": "/forecast/diff"},
    {"id": "F-15", "name": "Distribution explorer", "status": "live", "where": "/dashboard/explain", "api": "/intelligence/distribution"},
    {"id": "F-16", "name": "Counterfactual engine toggle", "status": "live", "where": "/dashboard/engines", "api": "/accuracy/counterfactual"},
    {"id": "F-17", "name": "Reliability Studio", "status": "live", "where": "/dashboard/reliability", "api": "/accuracy/reliability, /pit, /coverage"},
    {"id": "F-18", "name": "Tamper-evident track record", "status": "live", "where": "/dashboard/track-record", "api": "/ledger/head, /ledger/export, /ledger/verify"},
    {"id": "F-19", "name": "Accuracy gates per tier", "status": "live", "where": "consumer app", "api": "/app/gate"},
    {"id": "F-20", "name": "Auto-demotion and alerts", "status": "live", "where": "/dashboard/engines", "api": "/engines/{key}/history"},
    {"id": "F-21", "name": "Forecast cone on chart", "status": "live", "where": "Market, /dashboard/predict", "api": "/intelligence/cone"},
    {"id": "F-22", "name": "Drawn predictions + leaderboard", "status": "live", "where": "/dashboard/predict, /app/charts", "api": "/predictions, /leaderboard"},
    {"id": "F-23", "name": "Multi-source terminal", "status": "live", "where": "/dashboard/multi", "api": "/candles per source"},
    {"id": "F-24", "name": "Replay mode", "status": "live", "where": "/dashboard/replay", "api": "/replay"},
    {"id": "F-25", "name": "Anchor alerts", "status": "live", "where": "/dashboard/alerts", "api": "alert preset"},
    {"id": "F-26", "name": "ETA Board", "status": "live", "where": "/dashboard/eta", "api": "/eta/board"},
    {"id": "F-27", "name": "Hazard timeline", "status": "live", "where": "/dashboard/eta", "api": "/eta/hazard"},
    {"id": "F-28", "name": "ETA alerts", "status": "live", "where": "/dashboard/alerts", "api": "alert preset"},
    {"id": "F-29", "name": "In-round live ETA", "status": "live", "where": "/dashboard/eta", "api": "/eta/inround"},
    {"id": "F-30", "name": "Decision Ledger + producer leaderboard", "status": "live", "where": "/dashboard/decisions", "api": "/decisions, /decisions/leaderboard"},
    {"id": "F-31", "name": "Auto-Tells v2", "status": "live", "where": "/dashboard/decisions", "api": "/tells"},
    {"id": "F-32", "name": "Bankroll Simulator", "status": "live", "where": "/dashboard/simulator", "api": "/simulate"},
    {"id": "F-33", "name": "Session Coach", "status": "live", "where": "/dashboard/simulator", "api": "/coach"},
    {"id": "F-34", "name": "Experiment Registry", "status": "live", "where": "/dashboard/experiments", "api": "/experiments"},
    {"id": "F-35", "name": "Explain-this-forecast", "status": "live", "where": "/dashboard/explain", "api": "/forecast/{id}/explain"},
    {"id": "F-36", "name": "Fairness Console", "status": "live", "where": "/dashboard/fairness", "api": "/fair/*"},
    {"id": "F-37", "name": "Ask Momento", "status": "live", "where": "⌘K / /dashboard/ask", "api": "/knowledge/ask"},
    {"id": "F-38", "name": "Alerts Center", "status": "live", "where": "/dashboard/alerts + TopBar bell", "api": "/alerts, /alerts/rules"},
]
