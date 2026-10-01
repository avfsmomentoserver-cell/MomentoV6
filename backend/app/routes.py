"""MomentoCore router — Python port of core.ts `fetch / route / routeInner` (lines 1636-2714).

`dispatch(core, method, path, query, headers, raw_body)` returns a `Resp`.
Order matches the archive: security/status → routeV65 → routeV64 → core routes.
"""

from __future__ import annotations

import json
import logging
import math
import re
import uuid
from urllib.parse import unquote

from momento import analysis as A
from momento import pipeline as P
from momento.analogue import chart_lab_precision
from momento.analysis import BAND_LABELS, THRESHOLDS, band_index
from momento.calibration import reliability_table
from momento.clock import iso, now_ms, parse_iso_ms
from momento.docs import BUILD_STEPS, CALIBRATION_REFERENCE, DOCS, RANGE_LAB_REFERENCE
from momento.intelligence import COMPONENTS as INTEL_COMPONENTS
from momento.jsutil import dumps, tf
from momento.momentum import assess_live, inverted_forecast

from .core import VERSION, HttpError, as_of_context, clamp_int, constant_time_eq, js_number, median_of, sha256_hex
from .http import Query, Resp, fail, ok, truthy, jstr
from .v64routes import route_v64
from .v65routes import route_v65

log = logging.getLogger("momento.routes")

_SECRET_KEY = re.compile(r"api_key|secret|token", re.I)


def _s(v, d: str) -> str:
    """String(v ?? d)."""
    return jstr(v) if v is not None else d


def read_body(raw: bytes | str | None) -> dict:
    try:
        if not raw:
            return {}
        v = json.loads(raw)
        return v if isinstance(v, dict) else {}
    except (ValueError, TypeError, UnicodeDecodeError):
        return {}


def parse_as_of(raw: str | None, method: str) -> tuple[int | None, Resp | None]:
    if not raw or method != "GET":
        return None, None
    if re.fullmatch(r"\d+", raw):
        return int(raw), None
    ms = parse_iso_ms(raw)
    if ms is None:
        return None, fail("as_of must be epoch ms or ISO-8601", 400)
    return int(ms), None


def dispatch(core, method: str, path: str, q: Query, headers: dict, raw_body: bytes | str | None) -> Resp:
    """core.ts fetch(): normalise path, apply as_of, map errors to the envelope."""
    path = re.sub(r"/+$", "", path) or "/"
    try:
        as_of, err = parse_as_of(q.get("as_of"), method)
        if err:
            return err
        if as_of is None:
            return route_inner(core, method, path, q, headers, raw_body, None)
        with as_of_context(as_of):
            _clear_asof_caches(core)
            try:
                res = route_inner(core, method, path, q, headers, raw_body, as_of)
            finally:
                _clear_asof_caches(core)
                core.intel_ledger_cache = None
        res.headers["X-Momento-As-Of"] = iso(as_of)
        return res
    except HttpError as e:
        return fail(e.message, e.status)
    except Exception as e:  # noqa: BLE001
        log.exception("momento core error")
        return fail("internal error: " + str(e), 500)


def _clear_asof_caches(core) -> None:
    core.analysis_cache.clear()
    core.fx_cache.clear()
    core.momentum_cache.clear()


def _orch_settings(c) -> dict:
    def n(k, d):
        v = c.setting(k)
        return js_number(v) if v is not None else d

    return {"patience": n("orchestrator_patience", 3), "speed": c.setting("orchestrator_speed") or "balanced",
            "risk": c.setting("orchestrator_risk") or "moderate", "minConfidence": n("orchestrator_min_confidence", 0.55)}


def _num_setting(c, k, d):
    v = c.setting(k)
    return js_number(v) if v is not None else d


def _masked_settings(sql) -> dict:
    return {r["key"]: ("••••" + str(r["value"])[-4:] if _SECRET_KEY.search(r["key"]) and r["value"] else r["value"]) for r in sql.rows("SELECT key, value FROM settings")}


def route_inner(c, method: str, path: str, q: Query, headers: dict, raw_body, as_of: int | None) -> Resp:
    sql = c.sql
    if path == "/api/v1/ingest" and method == "POST":
        raw = raw_body.decode("utf-8", "replace") if isinstance(raw_body, (bytes, bytearray)) else (raw_body or "")
        deny = c.verify_ingest_signature(headers, raw)
        if deny:
            return fail(deny.message, deny.status)
    body = read_body(raw_body) if method in ("POST", "PUT") else {}

    if path == "/api/v1/security/status" and method == "GET":
        return ok(c.security_status())
    user = c.user_for(headers)
    r = route_v65(c, method, path, q, body, user, as_of)
    if r is not None:
        return r
    r = route_v64(c, method, path, q, body)
    if r is not None:
        return r

    def op():
        return c.require_operator(headers)

    # ---- system
    if path == "/ping":
        return ok({"service": "momento-core", "version": VERSION, "booted": c.booted})
    if path == "/api/v1/health" and method == "GET":
        return ok({"service": "momento-core", "version": VERSION, "rounds": c.table_stats()["count"], "time": iso(now_ms())})

    # ---- auth
    if path == "/api/v1/auth/login" and method == "POST":
        email = _s(body.get("email"), "").lower().strip()
        password = _s(body.get("password"), "")
        la = sql.one("SELECT fails, locked_until FROM login_attempts WHERE key = ?", email)
        now = now_ms()
        if la and la["locked_until"] > now:
            return fail(f"too many attempts; retry in {math.ceil((la['locked_until'] - now) / 1000)}s", 429)
        u = sql.one("SELECT * FROM users WHERE email = ? AND disabled = 0", email)
        h = c.hash_password(password, (u or {}).get("salt") or "no-such-user-salt")
        if not u or not constant_time_eq(h, u["password_hash"]):
            fails = ((la or {}).get("fails") or 0) + 1
            lock = now + min(15 * 60_000, 1000 * 2 ** (fails - 4)) if fails >= 5 else 0
            sql.exec("INSERT INTO login_attempts (key, fails, locked_until, updated_ms) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET fails = excluded.fails, locked_until = excluded.locked_until, updated_ms = excluded.updated_ms", email, fails, lock, now)
            return fail("invalid credentials", 401)
        sql.exec("DELETE FROM login_attempts WHERE key = ?", email)
        token = uuid.uuid4().hex + uuid.uuid4().hex
        expires = now + 30 * 24 * 3600 * 1000
        sql.exec("INSERT INTO tokens (token, user_id, created_ms, expires_ms) VALUES (?, ?, ?, ?)", "h:" + sha256_hex(token), u["id"], now, expires)
        c.audit(email, "auth.login")
        return ok({"token": token, "user": {"id": u["id"], "email": u["email"], "name": u["name"], "role": u["role"]}, "expiresMs": expires})
    if path == "/api/v1/auth/register" and method == "POST":
        o = op()
        email = _s(body.get("email"), "").lower().strip()
        password = _s(body.get("password"), "")
        role = _s(body.get("role"), "client")
        if role not in ("client", "operator", "admin"):
            return fail("role must be client, operator or admin")
        if role == "admin" and o["role"] != "admin":
            return fail("only an admin may create an admin", 403)
        if "@" not in email or len(password) < 12:
            return fail("valid email and 12+ char password required")
        return _create_user(c, o, email, password, role, body, {"email": email, "role": role})
    if path == "/api/v1/auth/me" and method == "GET":
        return ok({"id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"]} if user else None)

    # ---- rounds / sessions / sources / statistics
    src = q.get("source")
    has_src = bool(src) and src != "all"
    if path == "/api/v1/rounds" and method == "GET":
        limit = clamp_int(q.get("limit"), 1, 5000, 200)
        order = "ASC" if q.get("order") == "asc" else "DESC"
        rows = (sql.rows(f"SELECT id, ts, multiplier, color, source, session_id FROM rounds WHERE source = ? ORDER BY ts_ms {order} LIMIT ?", src, limit) if has_src
                else sql.rows(f"SELECT id, ts, multiplier, color, source, session_id FROM rounds ORDER BY ts_ms {order} LIMIT ?", limit))
        return ok({"rounds": rows, "count": len(rows)})
    if path == "/api/v1/rounds/latest" and method == "GET":
        lim = clamp_int(q.get("limit"), 1, 200, 20)
        rows = (sql.rows("SELECT id, ts, multiplier, color, source, session_id, origin, ingest FROM rounds WHERE source = ? ORDER BY ts_ms DESC LIMIT ?", src, lim) if has_src
                else sql.rows("SELECT id, ts, multiplier, color, source, session_id, origin, ingest FROM rounds ORDER BY ts_ms DESC LIMIT ?", lim))
        return ok({"rounds": rows})
    if path == "/api/v1/sessions" and method == "GET":
        rows = sql.rows("SELECT * FROM sessions WHERE source = ? ORDER BY started_ms DESC LIMIT 200", src) if has_src else sql.rows("SELECT * FROM sessions ORDER BY started_ms DESC LIMIT 200")
        return ok({"sessions": rows})
    if path == "/api/v1/sources" and method == "GET":
        return ok({"sources": sql.rows("""SELECT s.*, (SELECT COUNT(*) FROM rounds r WHERE r.source = s.name) AS rounds,
                (SELECT MAX(r.ts) FROM rounds r WHERE r.source = s.name) AS last_round
         FROM sources s ORDER BY s.name""")})
    if path == "/api/v1/sources" and method == "POST":
        o = op()
        name = _s(body.get("name"), "").strip()
        if not name:
            return fail("name required")
        sql.exec("INSERT INTO sources (name, label, kind, created_ms) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO NOTHING", name, _s(body.get("label"), name), _s(body.get("kind"), "collector"), now_ms())
        c.audit(o["email"], "sources.create", name)
        return ok({"name": name})
    if path.startswith("/api/v1/sources/") and method == "DELETE":
        o = op()
        name = unquote(path.split("/")[-1])
        with sql.transaction():
            sql.exec("DELETE FROM rounds WHERE source = ?", name)
            sql.exec("DELETE FROM sessions WHERE source = ?", name)
            sql.exec("DELETE FROM sources WHERE name = ?", name)
        c.invalidate_caches()
        c.audit(o["email"], "sources.delete", name)
        return ok({"deleted": name})
    if path == "/api/v1/statistics" and method == "GET":
        pl = c.analysis_payload(src)
        return ok({"statistics": pl["overview"], "exceedance": pl["exceedance"]})

    # ---- ingest
    if path == "/api/v1/ingest" and method == "POST":
        source = _s(body.get("source"), "aviator").strip() or "aviator"
        rounds = body.get("rounds") if isinstance(body.get("rounds"), list) else []
        if not rounds:
            return fail("rounds array required")
        return ok({**c.ingest_rounds(source, _s(body.get("method"), "api"), rounds), "source": source})
    if path == "/api/v1/import" and method == "POST":
        o = op()
        entity = _s(body.get("entity"), "rounds")
        rows = body.get("rows") if isinstance(body.get("rows"), list) else []
        if entity == "rounds":
            by: dict[str, list] = {}
            for r in rows:
                s = _s(r.get("source") if isinstance(r, dict) else None, "imported")
                by.setdefault(s, []).append(r)
            out = {s: c.ingest_rounds(s, "import", rs) for s, rs in by.items()}
            c.audit(o["email"], "data.import", "rounds", {"sources": list(by.keys())})
            return ok(out)
        if entity == "vocabulary":
            n = 0
            now = now_ms()
            for r in rows:
                if not isinstance(r, dict) or not isinstance(r.get("token"), str):
                    continue
                sql.exec("""INSERT INTO vocabulary (token, layer, layers, definition, status, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(token) DO NOTHING""", r["token"], _s(r.get("layer"), "band"), dumps(r.get("layers") if r.get("layers") is not None else []), _s(r.get("definition"), ""), _s(r.get("status"), "candidate"), now, now)
                n += 1
            c.audit(o["email"], "data.import", "vocabulary", {"count": n})
            return ok({"imported": n})
        return fail("unsupported entity")
    if path == "/api/v1/export" and method == "GET":
        entity = q.get("entity") or "all"
        limit = clamp_int(q.get("limit"), 1, 250000, 50000)
        out: dict = {"exportedAt": iso(now_ms()), "version": VERSION}
        if entity in ("rounds", "all"):
            out["rounds"] = sql.rows("SELECT id, ts, ts_ms, multiplier, color, source, session_id, ingest FROM rounds ORDER BY ts_ms ASC LIMIT ?", limit)
            out["roundsTruncated"] = c.table_stats()["count"] > limit
        if entity in ("forecasts", "all"):
            out["forecasts"] = sql.rows("SELECT * FROM forecasts ORDER BY created_ms DESC LIMIT 5000")
        if entity in ("vocabulary", "all"):
            out["vocabulary"] = sql.rows("SELECT * FROM vocabulary ORDER BY id")
        if entity in ("autopilot", "all"):
            out["autopilotDecisions"] = sql.rows("SELECT * FROM autopilot_decisions ORDER BY created_ms DESC LIMIT 5000")
        if entity in ("sources", "all"):
            out["sources"] = sql.rows("SELECT * FROM sources")
        if entity in ("settings", "all"):
            out["settings"] = {r["key"]: r["value"] for r in sql.rows("SELECT key, value FROM settings")}
        return ok(out)
    if path == "/api/v1/rounds" and method == "DELETE":
        o = op()
        source = _s(body.get("source") if body.get("source") is not None else q.get("source"), "")
        frm = _s(body.get("from") if body.get("from") is not None else q.get("from"), "")
        if not source or not frm:
            return fail("source and from (ISO timestamp) required")
        from_ms = parse_iso_ms(frm)
        if from_ms is None:
            return fail("invalid from timestamp")
        deleted = sql.exec("DELETE FROM rounds WHERE source = ? AND ts_ms >= ?", source, from_ms).rowsWritten or 0
        c.invalidate_caches()
        c.audit(o["email"], "rounds.delete", source, {"from": frm, "deleted": deleted})
        return ok({"deleted": deleted, "source": source, "from": frm})
    if path == "/api/v1/sessions/rebuild" and method == "POST":
        o = op()
        sources = [r["source"] for r in sql.rows("SELECT DISTINCT source FROM rounds")]
        for s in sources:
            c.rebuild_sessions(s)
        c.invalidate_caches()
        c.audit(o["email"], "sessions.rebuild", ",".join(sources))
        return ok({"rebuilt": sources})

    # ---- analysis
    if path == "/api/v1/analysis" and method == "GET":
        return ok(c.analysis_payload(src))
    if path.startswith("/api/v1/analysis/") and method == "GET":
        sub = path[len("/api/v1/analysis/"):]
        pl = c.analysis_payload(src)
        lazy = {
            "ceiling": lambda: pl["ceilings"], "resistance": lambda: pl["ceilings"], "streaks": lambda: pl["streaks"],
            "distribution": lambda: {"overview": pl["overview"], "bands": pl["bands"]},
            "moonshot": lambda: pl["moonshot"], "signals": lambda: {"gaps": pl["gaps"], "shape": pl["shape"], "streaks": pl["streaks"], "pressure": pl["pressure"]},
            "gap-swing": lambda: pl["gaps"], "house-edge": lambda: pl["houseEdge"],
            "plugins": lambda: c.plugin_status(pl), "ml": lambda: {"note": "Earned-weight models only; measured baseline governs.", "leaderboard": pl.get("rangeLab")},
            "dna": lambda: dna_sequences(c.rounds_for(src)),
        }
        if sub in lazy:
            return ok(lazy[sub]())
        return fail("unknown analysis subresource", 404)
    if path == "/api/v1/eta" and method == "GET":
        pl = c.analysis_payload(src)
        return ok({"exceedance": pl["exceedance"], "gaps": pl["gaps"]})
    if path == "/api/v1/baseline" and method == "GET":
        pl = c.analysis_payload(src)
        return ok({"overview": pl["overview"], "exceedance": pl["exceedance"]})
    if path == "/api/v1/bands" and method == "GET":
        return ok(c.analysis_payload(src)["bands"])
    if path == "/api/v1/brier-score" and method == "GET":
        return ok(c.forecast_accuracy(src))

    # ---- market
    if path == "/api/v1/market/candles" and method == "GET":
        return ok({"candles": A.candles(c.rounds_for(src), clamp_int(q.get("tf"), 10, 86400, 60), clamp_int(q.get("limit"), 10, 500, 150))})
    if path == "/api/v1/market/points" and method == "GET":
        return ok({"points": [{"t": r.ts, "m": r.multiplier, "c": r.color} for r in c.rounds_for(src)[-clamp_int(q.get("limit"), 10, 1000, 200):]]})
    if path == "/api/v1/market/live" and method == "GET":
        rs = c.rounds_for(src)[-2:]
        return ok({"latest": rs[-1] if rs else None, "previous": rs[0] if len(rs) > 1 else None, "feedEnabled": c.setting("feed_enabled") == "1", "feedIntervalMs": _num_setting(c, "feed_interval_ms", 4000)})
    if path == "/api/v1/market/session-phases" and method == "GET":
        return ok({"sessions": A.session_phases(c.rounds_for(src))})
    if path == "/api/v1/market/signals" and method == "GET":
        pl = c.analysis_payload(src)
        return ok({k: pl[k] for k in ("shape", "gaps", "streaks", "ceilings", "pressure")})
    if path == "/api/v1/mega-pressure" and method == "GET":
        return ok(c.analysis_payload(src)["pressure"])

    # ---- linguistics & vocabulary
    if path == "/api/v1/linguistics" and method == "GET":
        return ok(A.linguistics(c.rounds_for(src), clamp_int(q.get("depth"), 20, 1000, 200)))
    if path == "/api/v1/linguistics/explain" and method == "GET":
        token = q.get("token") or ""
        return ok({"token": token, "layers": token.split("·"), "vocabulary": sql.one("SELECT * FROM vocabulary WHERE token = ?", token),
                   "explanation": "Tokens compose band·chroma·streak·transition layers; each layer is measurable on the live series."})
    if path == "/api/v1/vocabulary" and method == "GET":
        status = q.get("status")
        rows = sql.rows("SELECT * FROM vocabulary WHERE status = ? ORDER BY updated_ms DESC LIMIT 500", status) if status else sql.rows("SELECT * FROM vocabulary ORDER BY updated_ms DESC LIMIT 500")
        return ok({"vocabulary": [parse_vocab(r) for r in rows], "counts": sql.rows("SELECT status, COUNT(*) AS n FROM vocabulary GROUP BY status")})
    if path == "/api/v1/vocabulary" and method == "POST":
        o = op()
        token = _s(body.get("token"), "").strip()
        if not token:
            return fail("token required")
        now = now_ms()
        sql.exec("""INSERT INTO vocabulary (token, layer, layers, definition, status, created_ms, updated_ms) VALUES (?, ?, ?, ?, 'candidate', ?, ?)
         ON CONFLICT(token) DO UPDATE SET definition = excluded.definition, updated_ms = excluded.updated_ms""",
                 token, _s(body.get("layer"), "band"), dumps(body.get("layers") if body.get("layers") is not None else []), _s(body.get("definition"), ""), now, now)
        c.audit(o["email"], "vocabulary.create", token)
        return ok({"token": token})
    if path == "/api/v1/vocabulary/discover" and method == "POST":
        rounds = c.rounds_for(_s(body.get("source"), "") or None)
        cands = discover_vocabulary(rounds)
        now = now_ms()
        added = 0
        for cd in cands:
            added += sql.exec("""INSERT INTO vocabulary (token, layer, layers, definition, status, created_ms, updated_ms) VALUES (?, ?, ?, ?, 'candidate', ?, ?)
           ON CONFLICT(token) DO NOTHING""", cd["token"], cd["layer"], dumps(cd["layers"]), cd["definition"], now, now).rowsWritten or 0
        c.audit((user or {}).get("email") or "system", "vocabulary.discover", None, {"added": added})
        return ok({"added": added, "candidates": len(cands)})
    if path == "/api/v1/vocabulary/discoveries" and method == "GET":
        return ok({"discoveries": [parse_vocab(r) for r in sql.rows("SELECT * FROM vocabulary WHERE status = 'candidate' ORDER BY updated_ms DESC LIMIT 100")]})
    if path == "/api/v1/vocabulary/learning/status" and method == "GET":
        return ok({"total": sql.scalar("SELECT COUNT(*) AS n FROM vocabulary", default=0), "byStatus": sql.rows("SELECT status, COUNT(*) AS n FROM vocabulary GROUP BY status")})
    if path == "/api/v1/vocabulary/learning/progress" and method == "GET":
        return ok({"progress": [parse_vocab(r) for r in sql.rows("SELECT * FROM vocabulary WHERE status != 'deprecated' ORDER BY score DESC LIMIT 50")]})
    if path.startswith("/api/v1/vocabulary/") and method in ("PUT", "POST", "DELETE"):
        o = op()
        seg = [s for s in path.split("/") if s]
        vid = js_number(seg[3]) if len(seg) > 3 else math.nan
        action = seg[4] if len(seg) > 4 else None
        row = sql.one("SELECT * FROM vocabulary WHERE id = ?", vid) if math.isfinite(vid) else None
        if not row:
            return fail("vocabulary not found", 404)
        vid = int(vid)
        now = now_ms()
        if method == "DELETE" or action == "deprecate":
            sql.exec("UPDATE vocabulary SET status = 'deprecated', updated_ms = ? WHERE id = ?", now, vid)
        elif action == "formalize":
            sql.exec("UPDATE vocabulary SET status = 'formalized', updated_ms = ? WHERE id = ?", now, vid)
        elif action == "evaluate":
            def pick(k):
                v = body.get(k) if body.get(k) is not None else row.get(k)
                return js_number(v if v is not None else 0)

            hits, misses, uses = pick("hits"), pick("misses"), pick("uses")
            score = hits / (hits + misses) if hits + misses > 0 else 0.5
            sql.exec("UPDATE vocabulary SET hits = ?, misses = ?, uses = ?, score = ?, status = CASE WHEN ? >= 0.6 THEN 'validated' ELSE status END, updated_ms = ? WHERE id = ?", hits, misses, uses, score, score, now, vid)
        elif method == "PUT":
            sql.exec("UPDATE vocabulary SET token = COALESCE(?, token), definition = COALESCE(?, definition), layer = COALESCE(?, layer), updated_ms = ? WHERE id = ?", body.get("token"), body.get("definition"), body.get("layer"), now, vid)
        c.audit(o["email"], f"vocabulary.{method.lower()}{'.' + action if action else ''}", str(vid))
        return ok({"id": vid})

    # ---- forecasts
    if path == "/api/v1/forecasts" and method == "GET":
        status = q.get("status")
        conds, params = [], []
        if status == "open":
            conds.append("actual IS NULL")
        if status == "resolved":
            conds.append("actual IS NOT NULL")
        if has_src:
            conds.append("source = ?")
            params.append(src)
        qy = "SELECT * FROM forecasts" + (" WHERE " + " AND ".join(conds) if conds else "") + " ORDER BY created_ms DESC LIMIT ?"
        params.append(clamp_int(q.get("limit"), 1, 500, 100))
        return ok({"forecasts": sql.rows(qy, *params)})
    if path == "/api/v1/forecasts/record" and method == "POST":
        threshold = js_number(body.get("threshold")) if body.get("threshold") is not None else math.nan
        probability = js_number(body.get("probability")) if body.get("probability") is not None else math.nan
        if not math.isfinite(threshold) or not math.isfinite(probability) or probability < 0 or probability > 1:
            return fail("threshold and probability∈[0,1] required")
        source = _s(body.get("source"), "aviator")
        sql.exec("INSERT INTO forecasts (source, model, threshold, probability, note, created_ms) VALUES (?, ?, ?, ?, ?, ?)", source, _s(body.get("model"), "manual"), threshold, probability, _s(body.get("note"), ""), now_ms())
        from momento.jsutil import js_str

        c.audit((user or {}).get("email") or "system", "forecasts.record", f"{source}@{js_str(threshold)}x")
        return ok({"recorded": True})
    if path == "/api/v1/forecasts/resolve" and method == "POST":
        op()
        return ok({"resolved": c.resolve_forecasts()})
    if path == "/api/v1/forecasts/accuracy" and method == "GET":
        return ok(c.forecast_accuracy(src))
    if path == "/api/v1/forecasts/history" and method == "GET":
        return ok({"history": sql.rows("SELECT * FROM forecasts WHERE actual IS NOT NULL ORDER BY resolved_ms DESC LIMIT 200")})
    if path == "/api/v1/forecasts/transitions" and method == "GET":
        return ok(c.analysis_payload(src)["bands"])

    # ---- orchestrator
    if path == "/api/v1/orchestrator" and method == "GET":
        pl = c.analysis_payload(None)
        sv = _orch_settings(c)
        last = c.rounds_for(None, False)[-1:]
        return ok({"settings": sv, "state": {"streak": pl["streaks"]["current"], "streakKind": pl["streaks"]["currentKind"], "dryZone": pl["shape"]["dryZone"]["active"],
                                             "tailPressure": pl["pressure"]["overallPressure"], "lastRound": last[0] if last else None},
                   "guidance": orchestrator_guidance(pl, sv)})
    if path == "/api/v1/orchestrator/settings" and method == "GET":
        return ok({"settings": _orch_settings(c)})
    if path == "/api/v1/orchestrator/settings" and method in ("PUT", "POST"):
        o = op()
        from momento.jsutil import js_str

        if "patience" in body:
            c.set_setting("orchestrator_patience", js_str(js_number(body["patience"])))
        if "speed" in body:
            c.set_setting("orchestrator_speed", jstr(body["speed"]))
        if "risk" in body:
            c.set_setting("orchestrator_risk", jstr(body["risk"]))
        if "minConfidence" in body:
            c.set_setting("orchestrator_min_confidence", js_str(js_number(body["minConfidence"])))
        c.audit(o["email"], "orchestrator.settings", None, body)
        return ok({"settings": {"patience": c.setting("orchestrator_patience"), "speed": c.setting("orchestrator_speed"), "risk": c.setting("orchestrator_risk"), "minConfidence": c.setting("orchestrator_min_confidence")}})
    if path == "/api/v1/orchestrator/evaluate" and method == "POST":
        g = orchestrator_guidance(c.analysis_payload(None), _orch_settings(c))
        sql.exec("INSERT INTO orchestrator_log (source, kind, detail, created_ms) VALUES ('all', 'evaluate', ?, ?)", dumps(g), now_ms())
        return ok({"guidance": g, "evaluatedAt": iso(now_ms())})

    # ---- autopilot
    if path == "/api/v1/autopilot/decisions" and method == "GET":
        lim = clamp_int(q.get("limit"), 1, 500, 100)
        rows = sql.rows("SELECT * FROM autopilot_decisions WHERE source = ? ORDER BY created_ms DESC LIMIT ?", src, lim) if has_src else sql.rows("SELECT * FROM autopilot_decisions ORDER BY created_ms DESC LIMIT ?", lim)
        closed = [r for r in rows if r["resolved"] == 1]
        pnl = 0.0
        for r in closed:
            pnl += r["pnl"] or 0
        return ok({"decisions": rows, "pnl": tf(pnl, 2), "wins": sum(1 for r in closed if (r["pnl"] or 0) > 0), "resolved": len(closed)})
    if path == "/api/v1/autopilot/config" and method == "GET":
        return ok({"config": {"running": c.setting("autopilot_running") == "1", "stake": _num_setting(c, "autopilot_stake", 1), "threshold": _num_setting(c, "autopilot_threshold", 2)}})
    if path == "/api/v1/autopilot/config" and method == "PUT":
        o = op()
        from momento.jsutil import js_str

        if "stake" in body:
            c.set_setting("autopilot_stake", js_str(js_number(body["stake"])))
        if "threshold" in body:
            c.set_setting("autopilot_threshold", js_str(js_number(body["threshold"])))
        c.audit(o["email"], "autopilot.config", None, body)
        return ok({"config": {"stake": c.setting("autopilot_stake"), "threshold": c.setting("autopilot_threshold")}})
    if path == "/api/v1/autopilot/status" and method == "GET":
        return ok({"running": c.setting("autopilot_running") == "1", "feedEnabled": c.setting("feed_enabled") == "1", "stake": _num_setting(c, "autopilot_stake", 1), "threshold": _num_setting(c, "autopilot_threshold", 2)})
    if path in ("/api/v1/autopilot/start", "/api/v1/autopilot/stop") and method == "POST":
        o = op()
        on = path.endswith("start")
        c.set_setting("autopilot_running", "1" if on else "0")
        c.audit(o["email"], "autopilot.start" if on else "autopilot.stop")
        return ok({"running": on})
    if path == "/api/v1/autopilot/reset" and method == "POST":
        o = op()
        sql.exec("DELETE FROM autopilot_decisions")
        c.audit(o["email"], "autopilot.reset")
        return ok({"reset": True})
    if path == "/api/v1/autopilot/evaluate" and method == "POST":
        rounds = c.rounds_for(None, False)
        if not rounds:
            return fail("no rounds yet")
        latest = rounds[-1]
        g = orchestrator_guidance(c.analysis_payload(None), _orch_settings(c))
        stake = _num_setting(c, "autopilot_stake", 1)
        threshold = _num_setting(c, "autopilot_threshold", 2)
        decision = "skip" if g["action"] == "skip" else "enter"
        pnl = (stake * (threshold - 1) if latest.multiplier >= threshold else -stake) if decision == "enter" else 0
        now = now_ms()
        with sql.transaction():
            sql.exec("INSERT INTO autopilot_decisions (source, round_id, decision, threshold, confidence, reason, stake, pnl, resolved, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
                     latest.source, latest.id, decision, threshold, g["confidence"], g["reason"], stake if decision == "enter" else 0, pnl, now)
            for f in sql.rows("SELECT id, threshold, probability FROM forecasts WHERE actual IS NULL"):
                actual = 1 if latest.multiplier >= f["threshold"] else 0
                sql.exec("UPDATE forecasts SET actual = ?, brier = ?, resolved_ms = ?, resolved_round_id = ? WHERE id = ?", actual, (f["probability"] - actual) ** 2, now, latest.id, f["id"])
        return ok({"decision": decision, "pnl": pnl, "round": latest})

    # ---- inventory (plugins)
    if path == "/api/v1/inventory" and method == "GET":
        return ok({"plugins": sql.rows("SELECT * FROM plugins ORDER BY category, key")})
    if path == "/api/v1/inventory" and method == "POST":
        o = op()
        key = _s(body.get("key"), "").strip()
        if not key:
            return fail("key required")
        sql.exec("INSERT INTO plugins (key, name, category, description, created_ms) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO NOTHING", key, _s(body.get("name"), key), _s(body.get("category"), "analyzer"), _s(body.get("description"), ""), now_ms())
        c.audit(o["email"], "inventory.create", key)
        return ok({"key": key})
    if path.startswith("/api/v1/inventory/"):
        seg = [s for s in path.split("/") if s]
        pid = js_number(seg[3]) if len(seg) > 3 else math.nan
        action = seg[4] if len(seg) > 4 else None
        row = sql.one("SELECT * FROM plugins WHERE id = ?", pid) if math.isfinite(pid) else None
        if not row:
            return fail("plugin not found", 404)
        pid = int(pid)
        if method == "DELETE":
            o = op()
            sql.exec("DELETE FROM plugins WHERE id = ?", pid)
            c.audit(o["email"], "inventory.delete", str(pid))
            return ok({"deleted": pid})
        if method == "GET":
            return ok({"plugin": row, "runs": sql.rows("SELECT * FROM plugin_runs WHERE plugin_id = ? ORDER BY created_ms DESC LIMIT 20", pid)})
        o = op()
        if action == "enabled":
            sql.exec("UPDATE plugins SET enabled = ? WHERE id = ?", 1 if truthy(body.get("enabled")) else 0, pid)
        elif action == "config":
            w = body.get("weight") if body.get("weight") is not None else row.get("weight")
            sql.exec("UPDATE plugins SET config = ?, weight = ? WHERE id = ?", dumps(body.get("config") if body.get("config") is not None else {}), js_number(w if w is not None else 1), pid)
        c.audit(o["email"], f"inventory.{action or 'update'}", str(pid))
        return ok({"id": pid})

    # ---- backtest & range lab & calibration
    if path == "/api/v1/backtest/runs" and method == "GET":
        return ok({"runs": sql.rows("SELECT id, source, kind, params, created_ms FROM backtest_runs ORDER BY created_ms DESC LIMIT 100")})
    if path == "/api/v1/backtest/status" and method == "GET":
        return ok({"runs": sql.scalar("SELECT COUNT(*) AS n FROM backtest_runs", default=0), "engine": "walk-forward, train-half fit / test-half score, Brier vs baseline"})
    if path == "/api/v1/backtest/run" and method == "POST":
        if not user:
            return fail("authentication required", 401)
        kind = _s(body.get("kind"), "threshold-ensemble")
        source = _s(body.get("source"), "all")
        rounds = c.rounds_for(None if source == "all" else source)
        if len(rounds) < 600:
            return fail("need at least 600 rounds to backtest")
        result = A.walk_forward(rounds, THRESHOLDS, 300)
        rid = sql.exec("INSERT INTO backtest_runs (source, kind, params, result, created_ms) VALUES (?, ?, ?, ?, ?)", source, kind, dumps({"thresholds": THRESHOLDS, "warmup": 300}), dumps(result), now_ms()).lastrowid
        c.audit(user["email"], "backtest.run", kind, {"rounds": len(rounds)})
        return ok({"runId": rid, "result": result})
    if path.startswith("/api/v1/backtest/run/") and method in ("GET", "DELETE"):
        bid = js_number(path.split("/")[-1])
        if method == "GET":
            row = sql.one("SELECT * FROM backtest_runs WHERE id = ?", bid) if math.isfinite(bid) else None
            if not row:
                return fail("run not found", 404)
            return ok({"run": row, "result": json.loads(row["result"])})
        o = op()
        sql.exec("DELETE FROM backtest_runs WHERE id = ?", bid)
        c.audit(o["email"], "backtest.delete", jstr(bid))
        return ok({"deleted": bid})
    if path == "/api/v1/range-lab" and method == "GET":
        source = src or "all"
        rounds = c.rounds_for(None if source == "all" else source)
        return ok({"dataset": {"rounds": len(rounds), "source": source}, "reference": RANGE_LAB_REFERENCE, "live": A.walk_forward(rounds, THRESHOLDS, 300) if len(rounds) >= 600 else None, "liveThresholds": [2, 5, 10, 50, 100]})
    if path == "/api/v1/research/recalibration" and method == "GET":
        rc = c.intel_recalibrator()
        samples = c.intel_cal_samples(clamp_int(c.setting("intel_recalibration_window") or "1000", 100, 3000, 1000))
        return ok({"recalibrator": rc, "reliability": reliability_table(samples, rc), "bands": BAND_LABELS, "sample": len(samples), "evidence": c.intel_evidence()["value"]})
    if path == "/api/v1/research/blend-gate" and method == "GET":
        reg = c.gated_registry()
        return ok({"mode": c.forecast_tuning()["blend_gate"], "gate": reg.get("gate"), "states": reg.get("states")})
    if path == "/api/v1/research/chartlab-precision" and method == "GET":
        rounds = c.rounds_for(src, {"includeReconstructed": False})
        t = c.forecast_tuning()

        def qn(name):
            return q.get(name) if q.get(name) else math.nan

        return ok(chart_lab_precision([r.multiplier for r in rounds], {
            "window": clamp_int(qn("window"), 8, 120, t["chartlab_window"]), "horizon": clamp_int(qn("horizon"), 3, 100, 20),
            "k": clamp_int(qn("k"), 5, 400, t["chartlab_k"]), "anchors": clamp_int(qn("anchors"), 30, 400, 150),
        }))
    if path == "/api/v1/research/forecast-tuning" and method == "GET":
        return ok({"tuning": c.forecast_tuning()})
    if path == "/api/v1/research/point-range" and method == "GET":
        return ok({"selection": c.intel_point_range()})
    if path == "/api/v1/research/evidence" and method == "GET":
        ev = c.intel_evidence()
        return ok({"evidence": ev["value"], "detail": ev["full"], "bands": BAND_LABELS})
    if path == "/api/v1/calibration" and method == "GET":
        return ok(_calibration(c))

    # ---- top rounds
    if path == "/api/v1/top-rounds" and method == "GET":
        scope = q.get("scope") or "all"
        source = src or "all"
        sv = [source] if source != "all" else []
        if scope == "all":
            rows = sql.rows("SELECT id, ts, multiplier, color, source FROM rounds WHERE source = ? ORDER BY multiplier DESC LIMIT 25", source) if sv else sql.rows("SELECT id, ts, multiplier, color, source FROM rounds ORDER BY multiplier DESC LIMIT 25")
        elif scope == "day":
            rows = sql.rows(f"""WITH ranked AS (SELECT id, ts, multiplier, color, source, substr(ts, 1, 10) AS day, ROW_NUMBER() OVER (PARTITION BY substr(ts, 1, 10) ORDER BY multiplier DESC) AS rn FROM rounds{' WHERE source = ?' if sv else ''})
           SELECT id, ts, multiplier, color, source, day FROM ranked WHERE rn = 1 ORDER BY day DESC LIMIT 60""", *sv)
        else:
            rows = sql.rows(f"""WITH ranked AS (SELECT id, ts, multiplier, color, source, session_id, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY multiplier DESC) AS rn FROM rounds WHERE session_id IS NOT NULL{' AND source = ?' if sv else ''})
           SELECT id, ts, multiplier, color, source, session_id FROM ranked WHERE rn = 1 ORDER BY ts DESC LIMIT 60""", *sv)
        return ok({"scope": scope, "top": rows})
    if path == "/api/v1/top-rounds/ingest" and method == "POST":
        o = op()
        rows = sql.rows("SELECT id, ts, multiplier, color, source FROM rounds ORDER BY multiplier DESC LIMIT 100")
        with sql.transaction():
            sql.exec("DELETE FROM top_rounds")
            for r in rows:
                sql.exec("INSERT INTO top_rounds (source, scope, scope_key, round_id, ts, multiplier, color) VALUES (?, 'all', 'all', ?, ?, ?, ?)", r["source"], r["id"], r["ts"], r["multiplier"], r["color"])
        c.audit(o["email"], "top_rounds.rebuild", None, {"count": len(rows)})
        return ok({"count": len(rows)})

    # ---- feed engine (disabled — no synthetic data)
    if path == "/api/v1/feed/status" and method == "GET":
        return ok({"enabled": False, "cursor": 0, "rounds": 0, "intervalMs": 0})
    if path == "/api/v1/feed/stop" and method == "POST":
        return ok({"enabled": False})
    if (path in ("/api/v1/feed/start", "/api/v1/feed/step") and method == "POST") or (path == "/api/v1/feed/verify" and method == "GET"):
        return fail("feed engine disabled", 410)

    # ---- settings / users / audit
    if path == "/api/v1/settings" and method == "GET":
        return ok({"settings": _masked_settings(sql)})
    if path == "/api/v1/settings" and method in ("PUT", "POST"):
        o = op()
        values = body.get("values") if isinstance(body.get("values"), dict) else {k: v for k, v in body.items() if k != "values"}
        for k, v in values.items():
            c.set_setting(k, jstr(v))
        c.invalidate_caches()  # settings feed forecast tuning / range profile
        c.audit(o["email"], "settings.update", None, values)
        return ok({"settings": _masked_settings(sql)})
    if path == "/api/v1/users" and method == "GET":
        op()
        return ok({"users": sql.rows("SELECT id, email, name, role, created_ms, disabled FROM users ORDER BY id")})
    if path == "/api/v1/users" and method == "POST":
        o = op()
        email = _s(body.get("email"), "").lower().strip()
        password = _s(body.get("password"), "")
        role = _s(body.get("role"), "client")
        # hardening (deviation): same allow-list and 12-char rule as /auth/register
        if role not in ("client", "operator", "admin"):
            return fail("role must be client, operator or admin")
        if role == "admin" and o["role"] != "admin":
            return fail("only an admin may create an admin", 403)
        if "@" not in email or len(password) < 12:
            return fail("valid email and 12+ char password required")
        return _create_user(c, o, email, password, role, body, {"email": email})
    if path.startswith("/api/v1/users/") and method == "DELETE":
        o = op()
        uid = js_number(path.split("/")[-1])
        if uid == o["id"]:
            return fail("cannot delete yourself")
        sql.exec("UPDATE users SET disabled = 1 WHERE id = ?", uid)
        c.audit(o["email"], "users.disable", jstr(uid))
        return ok({"disabled": uid})
    if path == "/api/v1/audit" and method == "GET":
        op()
        return ok({"log": sql.rows("SELECT * FROM audit_log ORDER BY created_ms DESC LIMIT ?", clamp_int(q.get("limit"), 1, 500, 100))})

    # ---- platform
    if path == "/api/v1/platform/docs" and method == "GET":
        return ok({"docs": DOCS, "version": VERSION})
    if path.startswith("/api/v1/platform/doc/") and method == "GET":
        slug = path[len("/api/v1/platform/doc/"):]
        meta = next((d for d in DOCS if d["slug"] == slug), None)
        if not meta:
            return fail("doc not found", 404)
        return ok({"doc": meta, "appPath": f"/dashboard/docs/{slug}"})
    if path == "/api/v1/platform/build-steps" and method == "GET":
        return ok({"steps": sql.rows("SELECT * FROM build_steps ORDER BY step")})
    if path == "/api/v1/platform/build-steps/sync" and method == "POST":
        o = op()
        now = now_ms()
        for s in BUILD_STEPS:
            sql.exec("INSERT OR REPLACE INTO build_steps (step, title, status, updated_ms) VALUES (?, ?, 'done', ?)", s["step"], s["title"], now)
        c.audit(o["email"], "platform.build_steps.sync")
        return ok({"steps": len(BUILD_STEPS)})
    if path == "/api/v1/platform/overview" and method == "GET":
        return ok({"name": "Momento", "suite": "Momento Platform", "version": VERSION, "pipeline": "Collector → Ingest API → Analysis → Forecast Engine → Database → Dashboard",
                   "subProjects": 8, "screens": 34, "rounds": c.table_stats()["count"], "docs": len(DOCS)})
    if path.startswith("/api/v1/platform/download/") and method == "GET":
        filename = unquote(path[len("/api/v1/platform/download/"):])
        row = sql.one("SELECT * FROM releases WHERE filename = ? ORDER BY created_ms DESC LIMIT 1", filename)
        if not row:
            return fail("release not found", 404)
        return ok({"release": row, "note": "Bundle is served from the web origin under /downloads/"})
    if path == "/api/v1/releases" and method == "GET":
        return ok({"releases": sql.rows("SELECT id, version, filename, url, sha256, notes, created_ms FROM releases ORDER BY created_ms DESC")})
    if path == "/api/v1/releases/latest" and method == "GET":
        return ok({"release": sql.one("SELECT * FROM releases ORDER BY created_ms DESC LIMIT 1")})
    if path == "/api/v1/releases" and method == "POST":
        o = op()
        version = _s(body.get("version"), VERSION)
        filename = _s(body.get("filename"), "")
        if not filename:
            return fail("filename required")
        sql.exec("INSERT INTO releases (version, filename, url, sha256, notes, manifest, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?)", version, filename, _s(body.get("url"), f"/downloads/{filename}"),
                 _s(body.get("sha256"), ""), _s(body.get("notes"), ""), dumps(body["manifest"]) if truthy(body.get("manifest")) else None, now_ms())
        c.audit(o["email"], "releases.create", version)
        return ok({"version": version, "filename": filename})

    # ---- FX lab
    if path == "/api/v1/fx" and method == "GET":
        return ok(c.fx_payload(src))
    if path == "/api/v1/fx/signals" and method == "GET":
        p = c.fx_payload(src)
        return ok({"signals": p["signals"], "generatedAt": p["generatedAt"], "rounds": p["rounds"]})
    if path.startswith("/api/v1/fx/") and method == "GET":
        sub = path[len("/api/v1/fx/"):]
        p = c.fx_payload(src)
        if sub in p:
            return ok({sub: p[sub]})
        return fail("unknown fx subresource", 404)

    # ---- prediction pipeline
    if path == "/api/v1/pipeline/forecast" and method == "GET":
        rounds = c.rounds_for(src)
        return ok({**P.pipeline_forecast(rounds, src or "all", c.weights_map()), "inverted": inverted_forecast(rounds, c.weights_map())})
    if path in ("/api/v1/pipeline/next-round", "/api/v1/intelligence/forecast") and method == "GET":
        rounds = c.rounds_for(src)
        if len(rounds) < 8:
            return fail("need at least 8 rounds for a forecast", 409)
        return ok(c.intel_forecast(rounds, src or "all"))
    if path == "/api/v1/pipeline/next-round/band" and method == "GET":
        corr = c.band_correction()
        return ok(P.next_round_forecast(c.rounds_for(src), src or "all", c.weights_map(), corr["value"] or None, corr["sampleSize"]))
    if path == "/api/v1/intelligence/calibrations" and method == "GET":
        rows = [{**r, "dist": json.loads(r["dist"]) if r["dist"] else None, "weights": json.loads(r["weights"]) if r["weights"] else None, "comp_loss": json.loads(r["comp_loss"]) if r["comp_loss"] else None}
                for r in sql.rows("SELECT * FROM intel_calibrations ORDER BY created_ms DESC LIMIT ?", clamp_int(q.get("limit") or "50", 1, 500, 50))]
        corr = c.intel_correction()
        return ok({"rows": rows, "verdicts": {r["verdict"]: r["n"] for r in sql.rows("SELECT verdict, COUNT(*) AS n FROM intel_calibrations GROUP BY verdict")},
                   "ledger": c.intel_ledger(), "correction": corr["value"], "correctionSample": corr["sampleSize"], "components": INTEL_COMPONENTS})
    if path == "/api/v1/intelligence/recalibrate" and method == "POST":
        op()
        sql.exec("DELETE FROM intel_calibrations")
        c.intel_ledger_cache = c.recalibrator_cache = c.point_range_cache = c.evidence_cache = c.gate_cache = None
        c.intel_forecast_cache.clear()
        return ok({"scored": c.calibrate_intel(c.rounds_for(None))})
    if path == "/api/v1/pipeline/calibrations" and method == "GET":
        rows = [{**r, "dist": json.loads(r["dist"]) if r["dist"] else None} for r in sql.rows("SELECT * FROM round_calibrations WHERE id <> -1 ORDER BY created_ms DESC LIMIT ?", clamp_int(q.get("limit") or "50", 1, 200, 50))]
        state = sql.one("SELECT correction, reason FROM round_calibrations WHERE id = -1") or {}
        verdicts: dict = {}
        for r in rows:
            verdicts[r["verdict"]] = verdicts.get(r["verdict"], 0) + 1
        return ok({"rows": rows, "verdicts": verdicts, "correction": state.get("correction") if state.get("correction") is not None else 0,
                   "correctionNote": state.get("reason") or "not yet computed", "backtestDone": c.setting("calibration_backtest_done") == "1"})

    # ---- momentum
    if path == "/api/v1/momentum/overview" and method == "GET":
        return ok(c.momentum_payload(src, clamp_int(q.get("bucketMs"), 60_000, 3_600_000, 300_000)))
    if path == "/api/v1/momentum/hitpoints" and method == "GET":
        p = c.momentum_payload(src, clamp_int(q.get("bucketMs"), 60_000, 3_600_000, 300_000))
        return ok({"bucketMs": p["bucketMs"], "rounds": p["rounds"], "points": p["hitPoints"]})
    if path == "/api/v1/momentum/anchors" and method == "GET":
        return ok({"anchors": c.momentum_payload(src, 300_000)["anchors"]})
    if path == "/api/v1/momentum/assessment" and method == "GET":
        open_ = sql.rows("SELECT id, window, threshold, probability, created_ms, due_ms FROM scheduled_predictions WHERE resolved_ms IS NULL ORDER BY due_ms ASC LIMIT 200")
        return ok(assess_live(c.rounds_for(src), [{"id": r["id"], "window": str(r["window"]), "threshold": js_number(r["threshold"]), "p": js_number(r["probability"]), "createdMs": js_number(r["created_ms"]), "dueMs": js_number(r["due_ms"])} for r in open_]))

    # ---- accuracy engine v2
    if path == "/api/v1/accuracy/overview" and method == "GET":
        return ok(_accuracy_overview(c))
    if path == "/api/v1/accuracy/tick" and method == "POST":
        return ok(c.accuracy_tick())
    if path == "/api/v1/accuracy/config" and method == "GET":
        return ok({"config": c.accuracy_config()})
    if path == "/api/v1/accuracy/config" and method in ("PUT", "POST"):
        o = op()
        if "enabled" in body:
            c.set_setting("accuracy_enabled", "1" if truthy(body["enabled"]) else "0")
        if isinstance(body.get("windows"), list):
            c.set_setting("accuracy_windows", ",".join(jstr(x) for x in body["windows"]))
        if isinstance(body.get("thresholds"), list):
            c.set_setting("accuracy_thresholds", ",".join(jstr(x) for x in body["thresholds"]))
        c.audit(o["email"], "accuracy.config", None, body)
        return ok({"config": c.accuracy_config()})
    if path == "/api/v1/accuracy/predictions" and method == "GET":
        status = q.get("status") or "all"
        window = q.get("window")
        conds, params = [], []
        if status == "open":
            conds.append("resolved_ms IS NULL")
        if status == "resolved":
            conds.append("resolved_ms IS NOT NULL")
        if window and window != "all":
            conds.append("window = ?")
            params.append(window)
        where = f" WHERE {' AND '.join(conds)}" if conds else ""
        return ok({"predictions": sql.rows(f"SELECT * FROM scheduled_predictions{where} ORDER BY created_ms DESC LIMIT ?", *params, clamp_int(q.get("limit"), 1, 500, 120))})
    if path == "/api/v1/accuracy/verify" and method == "POST":
        source = _s(body.get("source"), "all")
        rounds = c.rounds_for(None if source == "all" else source)
        if len(rounds) < 500:
            return fail("need at least 500 rounds to verify")
        cfg = c.accuracy_config()
        result = P.verify_against_history(rounds, {"thresholds": cfg["thresholds"], "windows": cfg["windows"], "cadenceMs": c.cadence_ms(),
                                                   "blockWeights": {"baseline": 0.25, "markov": 0.25, "streak": 0.25, "recent": 0.25}})
        for run in result["runs"]:
            if not run.get("blocks"):
                continue
            for m in run["models"]:
                c.upsert_ledger(m["model"], run["window"], run["threshold"], {"n": m["blocks"], "brierSum": m["brier"] * m["blocks"], "baseSum": run["brierBase"] * m["blocks"],
                                                                             "loglossSum": m["logloss"] * m["blocks"], "hits": m["hitRate"] * m["blocks"], "roundsScanned": result["scanned"]})
        c.recompute_weights()
        sql.exec("INSERT INTO backtest_runs (source, kind, params, result, created_ms) VALUES (?, 'accuracy-history', ?, ?, ?)", source,
                 dumps({"thresholds": cfg["thresholds"], "windows": [w["id"] for w in cfg["windows"]]}), dumps(result), now_ms())
        c.audit((user or {}).get("email") or "system", "accuracy.verify", source, {"blocks": result.get("blocks")})
        return ok(result)

    return fail(f"no route: {method} {path}", 404)


# --------------------------------------------------------------- helpers

def _create_user(c, o, email, password, role, body, out) -> Resp:
    salt = uuid.uuid4().hex
    h = c.hash_password(password, salt)
    try:
        c.sql.exec("INSERT INTO users (email, name, role, password_hash, salt, created_ms) VALUES (?, ?, ?, ?, ?, ?)", email, _s(body.get("name"), email.split("@")[0]), role, h, salt, now_ms())
    except Exception:  # noqa: BLE001  (UNIQUE(email))
        return fail("email already registered", 409)
    c.audit(o["email"], "users.create", email)
    return ok(out)


def _calibration(c) -> dict:
    rounds = c.rounds_for(None)
    n = len(rounds)
    mults = [r.multiplier for r in rounds]
    exc = A.exceedance(rounds, [1.5, 2, 3, 5, 10, 25, 50, 100, 250, 500, 1000])
    fit = A.pressure(rounds)["powerLaw"]
    post = [r for i, r in enumerate(rounds) if i > 0 and rounds[i - 1].multiplier >= 10]
    post_rate = sum(1 for r in post if r.multiplier >= 2) / len(post) if post else None
    ref = CALIBRATION_REFERENCE
    checks = []
    for t, ref_pct in ref["exceedance"].items():
        tv = js_number(t)
        row = next((e for e in exc if e["threshold"] == tv), None)
        live = row["rate"] * 100 if row else None
        checks.append({"threshold": tv, "referencePct": ref_pct, "livePct": tf(live, 4) if live is not None else None,
                       "deltaPct": tf((live - ref_pct) / ref_pct * 100, 3) if live is not None else None, "match": live is not None and abs(live - ref_pct) / ref_pct < 0.01})
    s = 0.0
    for m in mults:
        s += m
    return {"dataset": {"rounds": n, "mean": tf(s / max(1, n), 3), "median": median_of(mults) if rounds else 0, "max": A.max_of(mults) if rounds else 0},
            "reference": ref, "exceedance": exc, "tail": fit, "postHigh": {"rate": post_rate, "reference": ref["postHigh2x"] / 100, "n": len(post)},
            "checks": checks, "allMatch": all(ch["match"] for ch in checks)}


def _accuracy_overview(c) -> dict:
    sql = c.sql
    totals = sql.one("SELECT COUNT(*) AS scheduled, SUM(CASE WHEN resolved_ms IS NULL THEN 1 ELSE 0 END) AS open, SUM(CASE WHEN resolved_ms IS NOT NULL THEN 1 ELSE 0 END) AS resolved FROM scheduled_predictions")
    acc = sql.one("SELECT SUM(n) AS n, SUM(brier_sum) AS b, SUM(base_sum) AS s, SUM(hits) AS h FROM accuracy_ledger WHERE model = 'pipeline'")

    def per(n, x, d):
        return tf(x / n, d) if n else None

    by_model = []
    for r in sql.rows("SELECT model, SUM(n) AS n, SUM(brier_sum) AS b, SUM(base_sum) AS s, SUM(logloss_sum) AS l, SUM(hits) AS h FROM accuracy_ledger WHERE model IN ('pipeline', 'full-intelligence') GROUP BY model"):
        mn = r["n"] or 0
        by_model.append({"model": r["model"], "n": mn, "brier": per(mn, r["b"], 5), "base": per(mn, r["s"], 5), "logloss": per(mn, r["l"], 5), "hitRate": per(mn, r["h"], 4),
                         "skillPct": tf(((r["s"] - r["b"]) / r["s"]) * 100, 2) if mn and (r["s"] or 0) > 0 else None})
    n = acc["n"] or 0
    brier = acc["b"] / n if n else None
    base = acc["s"] / n if n else None
    return {
        "config": c.accuracy_config(), "byModel": by_model, "cadenceMs": c.cadence_ms(), "lastTickMs": _num_setting(c, "accuracy_last_tick", 0),
        "totals": {"scheduled": totals["scheduled"] or 0, "open": totals["open"] or 0, "resolved": totals["resolved"] or 0, "ledgerN": n,
                   "brier": tf(brier, 5) if brier is not None else None, "base": tf(base, 5) if base is not None else None,
                   "liftPct": tf(((brier - base) / base) * 100, 2) if brier is not None and base else None, "hitRate": tf((acc["h"] or 0) / n, 4) if n else None},
        "ledger": [{**r, "brier": per(r["n"], r["brier_sum"], 5), "base": per(r["n"], r["base_sum"], 5), "hitRate": per(r["n"], r["hits"], 4)} for r in sql.rows("SELECT * FROM accuracy_ledger ORDER BY model, window, threshold")],
        "perWindow": [{**r, "brier": per(r["n"], r["b"], 5), "base": per(r["n"], r["s"], 5), "hitRate": per(r["n"], r["h"], 4)} for r in sql.rows("SELECT window, threshold, SUM(n) AS n, SUM(brier_sum) AS b, SUM(base_sum) AS s, SUM(hits) AS h FROM accuracy_ledger WHERE model = 'pipeline' GROUP BY window, threshold")],
        "weights": sql.rows("SELECT * FROM engine_weights ORDER BY weight DESC, model"),
        "history": sql.rows("SELECT * FROM accuracy_history ORDER BY ts ASC LIMIT 4000"),
        "open": sql.rows("SELECT * FROM scheduled_predictions WHERE resolved_ms IS NULL ORDER BY due_ms ASC LIMIT 60"),
        "recent": sql.rows("SELECT * FROM scheduled_predictions WHERE resolved_ms IS NOT NULL ORDER BY resolved_ms DESC LIMIT 60"),
    }


def parse_vocab(r: dict) -> dict:
    return {**r, "layers": json.loads(r["layers"] if r.get("layers") is not None else "[]")}


def orchestrator_guidance(payload: dict, s: dict) -> dict:
    from momento.jsutil import js_str

    st, shape, pr = payload["streaks"], payload["shape"], payload["pressure"]
    mistakes, reasons = [], []
    conf = 0.4
    if st["currentKind"] == "below" and st["current"] >= s["patience"]:
        conf += min(0.25, st["current"] * 0.03)
        reasons.append(f"dry streak of {js_str(st['current'])} within patience ({js_str(s['patience'])})")
    elif st["currentKind"] == "below":
        reasons.append(f"dry streak {js_str(st['current'])} below patience {js_str(s['patience'])} — wait")
    else:
        reasons.append("streak just broke; chase risk elevated")
        mistakes.append("Do not chase immediately after a streak break — measured continuation offers no edge.")
    if shape["dryZone"]["active"]:
        conf += 0.1
        reasons.append("dry zone active (rolling 50-round mean below 2.0x)")
    if pr["overallPressure"] >= 65:
        conf += 0.1
        reasons.append(f"tail pressure loaded ({js_str(pr['overallPressure'])}%)")
    conf = min(0.95, conf)
    if s["risk"] == "aggressive":
        mistakes.append("Aggressive risk profile active — size positions defensively.")
    return {"action": "enter" if conf >= s["minConfidence"] else "skip", "confidence": tf(conf, 2), "reason": "; ".join(reasons), "mistakes": mistakes}


def dna_sequences(rounds) -> dict:
    seqs: dict[str, list] = {}
    for i in range(len(rounds) - 3):
        key = f"{band_index(rounds[i].multiplier)}{band_index(rounds[i + 1].multiplier)}{band_index(rounds[i + 2].multiplier)}"
        e = seqs.setdefault(key, [0, 0.0])
        e[0] += 1
        e[1] += rounds[i + 3].multiplier
    top = sorted(seqs.items(), key=lambda kv: -kv[1][0])[:25]
    return {"top": [{"triplet": " → ".join(BAND_LABELS[int(ch)] for ch in k), "count": v[0], "forwardMean": tf(v[1] / v[0], 3)} for k, v in top], "unique": len(seqs)}


def discover_vocabulary(rounds) -> list[dict]:
    cands = []
    recent = rounds[-500:]
    high = sum(1 for r in recent if r.multiplier >= 10)
    for i in range(1, len(recent)):
        prev, cur = recent[i - 1].multiplier, recent[i].multiplier
        if cur >= 10:
            a, b = BAND_LABELS[band_index(prev)], BAND_LABELS[band_index(cur)]
            cands.append({"token": f"{a}→{b}", "layer": "transition", "layers": [a, b], "definition": f"Observed band transition into a high round (≥10x), {high} occurrences in last 500."})
    dry = 0
    for r in reversed(recent):
        if r.multiplier >= 2:
            break
        dry += 1
    if dry >= 5:
        cands.append({"token": f"dry{min(dry, 9)}", "layer": "streak", "layers": ["streak", str(dry)], "definition": f"Current below-2x run of {dry} rounds at discovery time."})
    seen, out = set(), []
    for cd in cands:
        if cd["token"] in seen:
            continue
        seen.add(cd["token"])
        out.append(cd)
    return out[:30]
