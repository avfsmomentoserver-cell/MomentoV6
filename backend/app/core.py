"""Core service — Python port of archive/backend-ts-v6.5/core.ts (MomentoCore DO).

Everything the Durable Object held in memory (rounds cache, analysis / fx /
momentum caches, ledger / recalibrator / evidence / gate / point-range caches,
memoised full-intelligence forecast) lives on one `Core` instance per process.
The DO processed one request at a time; `Core.lock` keeps that guarantee, so
the caches and the scoring loops see a consistent tape.

The request-scoped `as_of` (time machine, F-04) is a contextvar rather than an
instance field, so concurrent requests cannot leak each other's as_of.
"""

from __future__ import annotations

import contextvars
import hashlib
import hmac
import json
import logging
import math
import os
import threading
import time
import uuid
from typing import Any, Callable

from momento import analysis as A
from momento import calibration as C
from momento import fx as FX
from momento import momentum as M
from momento import pipeline as P
from momento.analogue import analogue_next_dist
from momento.analysis import Round, band_index
from momento.clock import iso, now_ms, parse_iso_ms
from momento.docs import BUILD_STEPS
from momento.engine_gate import blend_admission, gated_states
from momento.intelligence import COMPONENTS as INTEL_COMPONENTS
from momento.intelligence import band_log_loss, full_intelligence_forecast, score_intel_forecast
from momento.jsutil import js_str, jround, tf, to_fixed
from momento.point_range import default_selection, select_point_range
from momento.robust_evaluation import evaluate_locked_holdout, gate_confidence, summarize_evidence, unavailable_evidence
from momento.storage import Database

log = logging.getLogger("momento.core")

VERSION = "6.5.0"
INF = float("inf")

_as_of: contextvars.ContextVar[int | None] = contextvars.ContextVar("momento_as_of", default=None)


class HttpError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def clamp01(p: float) -> float:
    return min(1 - 1e-6, max(1e-6, p)) if isinstance(p, (int, float)) and math.isfinite(p) else 0.5


def js_number(raw: Any) -> float:
    """Number(raw) for settings / query values."""
    if raw is None:
        return 0.0
    if isinstance(raw, bool):
        return 1.0 if raw else 0.0
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw).strip()
    if s == "":
        return 0.0
    try:
        if s.lower().startswith(("0x", "-0x")):
            return float(int(s, 16))
        if s.lower() in ("infinity", "+infinity"):
            return INF
        if s.lower() == "-infinity":
            return -INF
        if s.lower() in ("inf", "nan", "+inf", "-inf"):
            return math.nan
        return float(s)
    except ValueError:
        return math.nan


def clamp_int(raw: Any, lo: float, hi: float, dflt: float) -> int:
    n = js_number(raw)
    if not math.isfinite(n):
        return int(dflt)
    return int(min(hi, max(lo, math.floor(n))))


def constant_time_eq(a: str, b: str) -> bool:
    if not isinstance(a, str) or not isinstance(b, str):
        return False
    return hmac.compare_digest(a.encode(), b.encode())


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def median_of(values: list[float]) -> float:
    s = sorted(values)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else tf((s[mid - 1] + s[mid]) / 2, 4)


def _jparse(s: Any, d: Any) -> Any:
    try:
        v = json.loads(s) if isinstance(s, str) else None
        return d if v is None else v
    except (ValueError, TypeError):
        return d


DEFAULT_PLUGINS = [
    ("ladders", "Ladder Telemetry", "analyzer", "Descending in-band collapse sequences with run-length histogram", 1.0),
    ("resistance", "Resistance / Ceilings", "analyzer", "Clustered local-maxima resistance levels with touch counts", 1.0),
    ("streaks", "Streaks & Markov", "analyzer", "Below/above-threshold streaks, conditional rates, 2x2 Markov", 1.0),
    ("regimes", "Session Regimes", "analyzer", "Per-session phase classification (compressed→eruption)", 1.0),
    ("edge_fit", "Edge Fit / House Edge", "analyzer", "Observed mean vs implied fair; cashout EV table", 1.0),
    ("pressure", "Mega Pressure", "analyzer", "Power-law tail priors and dry-run pressure on 100x+ targets", 1.0),
    ("moonshot", "Moonshot Scanner", "analyzer", "Linguistic moonshot factors with honest confidence", 0.9),
    ("shape_shifters", "ShapeShifters", "analyzer", "Curve anatomy, Pareto fit, dry zones, ETA bands, trajectory groups", 1.0),
    ("linguistics", "MomentoLinguistics", "analyzer", "Eight-layer semantic vocabulary over the live series", 0.9),
    ("markov_forecast", "Markov Forecaster", "forecast", "First-order Markov threshold forecasts (earned weight)", 0.0),
    ("ensemble_forecast", "Ensemble Forecaster", "forecast", "Blend of measured exceedance + conditional models", 0.0),
]

DEFAULT_SETTINGS = [
    ("session_gap_minutes", "30"),
    ("orchestrator_patience", "3"),
    ("orchestrator_speed", "balanced"),
    ("orchestrator_risk", "moderate"),
    ("orchestrator_min_confidence", "0.55"),
    ("autopilot_running", "0"),
    ("autopilot_stake", "1.0"),
    ("autopilot_threshold", "2"),
    ("accuracy_enabled", "1"),
    ("accuracy_windows", "15m,1h,4h,1d,7d"),
    ("accuracy_thresholds", "2,5,10"),
    ("accuracy_last_tick", "0"),
]


class Core:
    """The whole stateful backend (one per process / database)."""

    def __init__(self, db: Database, env: dict | None = None, *, bootstrap: bool = True, calibrate_on_boot: bool = True):
        self.db = db
        self.sql = db
        self.env: dict = dict(os.environ) if env is None else dict(env)
        self.lock = threading.RLock()
        self.analysis_cache: dict[str, dict] = {}
        self.fx_cache: dict[str, dict] = {}
        self.momentum_cache: dict[str, dict] = {}
        self.rounds_cache: dict[str, dict] = {}
        self.intel_forecast_cache: dict[str, dict] = {}
        self.intel_ledger_cache: dict | None = None
        self.recalibrator_cache: dict | None = None
        self.evidence_cache: dict | None = None
        self.gate_cache: dict | None = None
        self.point_range_cache: dict | None = None
        self.accuracy_busy = False
        self.extra_candidates: list[Callable[["Core"], list[dict]]] = []  # P6 hook: momento_core experts
        self.ingest_listeners: list[Callable[[str, int, str], None]] = []
        self.alarm_at_ms: int = 0
        #: bound on full-intelligence calibration done inside an ingest request
        #: (None = archive behaviour; the server sets a small budget and the
        #: scheduler drains the remainder in the background)
        self.ingest_intel_budget: int | None = None
        self.booted = False
        from . import v64routes, v65routes  # schema seeds live with their route modules

        self._v64 = v64routes
        self._v65 = v65routes
        with self.lock:
            v64routes.init_v64_schema(self.sql)
            v65routes.init_v65_schema(self.sql)
            if bootstrap:
                self.bootstrap(calibrate=calibrate_on_boot)

        # P6: register momento_core experts as shadow candidate engines.
        # Done after bootstrap so rounds_for() works and schema exists.
        try:
            from momento.candidates import register_candidates
            register_candidates(self)
        except Exception as e:  # pragma: no cover — candidates must never break boot
            log.error("candidate registration failed: %s", e)

    # ------------------------------------------------------------ bootstrap
    def bootstrap(self, calibrate: bool = True) -> None:
        sql = self.sql
        now = now_ms()
        if sql.scalar("SELECT COUNT(*) AS n FROM users") == 0:
            salt = uuid.uuid4().hex
            pw = str(self.env.get("SETUP_PASSWORD") or "") or "momento"
            sql.exec(
                "INSERT INTO users (email, name, role, password_hash, salt, created_ms) VALUES (?, ?, 'operator', ?, ?, ?)",
                "operator@momento.local", "Operator", self.hash_password(pw, salt), salt, now,
            )
        if sql.scalar("SELECT COUNT(*) AS n FROM plugins") == 0:
            for key, name, category, description, weight in DEFAULT_PLUGINS:
                sql.exec(
                    "INSERT OR IGNORE INTO plugins (key, name, category, description, weight, created_ms) VALUES (?, ?, ?, ?, ?, ?)",
                    key, name, category, description, weight, now,
                )
        if sql.scalar("SELECT COUNT(*) AS n FROM build_steps") == 0:
            for s in BUILD_STEPS:
                sql.exec("INSERT OR REPLACE INTO build_steps (step, title, status, updated_ms) VALUES (?, ?, 'done', ?)", s["step"], s["title"], now)
        for k, v in DEFAULT_SETTINGS:
            sql.exec("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", k, v)
        if sql.scalar("SELECT COUNT(*) AS n FROM sources") == 0:
            sql.exec("INSERT OR IGNORE INTO sources (name, label, kind, created_ms) VALUES (?, ?, ?, ?)", "aviator", "Aviator Collector", "collector", now)
        if not self.alarm_at_ms:
            self.alarm_at_ms = now + 20_000
        if calibrate:
            try:
                self.calibrate_new_rounds()
            except Exception as e:  # pragma: no cover — boot must not fail on scoring
                log.error("calibration bootstrap failed: %s", e)

    # ----------------------------------------------------------------- auth
    @staticmethod
    def hash_password(password: str, salt: str) -> str:
        return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000, 32).hex()

    @staticmethod
    def bearer(headers: dict) -> str | None:
        h = headers.get("authorization") or ""
        return h[7:] if h.startswith("Bearer ") else None

    def user_for(self, headers: dict) -> dict | None:
        token = self.bearer(headers)
        if not token:
            return None
        row = self.sql.one(
            """SELECT u.id, u.email, u.name, u.role, t.expires_ms FROM tokens t JOIN users u ON u.id = t.user_id
         WHERE t.token IN (?, ?) AND u.disabled = 0""",
            "h:" + sha256_hex(token), token,
        )
        if not row or row["expires_ms"] < now_ms():
            return None
        return row

    def require_operator(self, headers: dict) -> dict:
        user = self.user_for(headers)
        if not user:
            raise HttpError("authentication required", 401)
        if user["role"] not in ("operator", "admin"):
            raise HttpError("operator role required", 403)
        return user

    def verify_ingest_signature(self, headers: dict, raw: str) -> HttpError | None:
        """S-1: HMAC-signed ingest. Returns a denial, or None when allowed."""
        secret = str(self.env.get("INGEST_HMAC_SECRET") or self.setting("ingest_hmac_secret") or "")
        if not secret:
            return None  # not configured → open (flagged in /security/status)
        ts = headers.get("x-momento-ts") or ""
        nonce = headers.get("x-momento-nonce") or ""
        sig = (headers.get("x-momento-signature") or "").lower()
        sql = self.sql

        def quarantine(reason: str) -> HttpError:
            sql.exec("INSERT INTO ingest_quarantine (source, payload, reasons, created_ms) VALUES ('ingest', ?, ?, ?)", raw[:4000], json.dumps([reason]), now_ms())
            return HttpError("ingest signature rejected: " + reason, 401)

        if not ts or not nonce or not sig:
            return quarantine("missing signature headers")
        tsn = js_number(ts)
        if not math.isfinite(tsn) or abs(now_ms() - tsn) > 60_000:
            return quarantine("timestamp skew > 60s")
        if sql.one("SELECT 1 AS x FROM ingest_nonces WHERE nonce = ?", nonce):
            return quarantine("replayed nonce")
        want = hmac.new(secret.encode(), (ts + nonce + raw).encode(), hashlib.sha256).hexdigest()
        if not constant_time_eq(want, sig):
            return quarantine("bad signature")
        sql.exec("INSERT INTO ingest_nonces (nonce, created_ms) VALUES (?, ?)", nonce, now_ms())
        sql.exec("DELETE FROM ingest_nonces WHERE created_ms < ?", now_ms() - 10 * 60_000)
        return None

    def security_status(self) -> dict:
        sql = self.sql
        env = self.env
        hm = bool(env.get("INGEST_HMAC_SECRET") or self.setting("ingest_hmac_secret"))
        legacy = sql.scalar("SELECT COUNT(*) AS n FROM tokens WHERE token NOT LIKE 'h:%'", default=0)
        default_op = sql.one("SELECT id FROM users WHERE email = 'operator@momento.local' AND disabled = 0") is not None
        qn = sql.scalar("SELECT COUNT(*) AS n FROM ingest_quarantine", default=0)
        setup = bool(env.get("SETUP_PASSWORD"))
        cors = env.get("CORS_ORIGINS")
        checks = [
            {"id": "S-1", "title": "Signed ingest (HMAC + nonce + 60s skew)", "ok": hm, "detail": "enforced" if hm else "INGEST_HMAC_SECRET not set — ingest is open"},
            {"id": "S-2", "title": "No default operator credential", "ok": (not default_op) or setup,
             "detail": ("bootstrap password from SETUP_PASSWORD" if setup else "operator@momento.local / momento still active — rotate it") if default_op else "default operator removed"},
            {"id": "S-3", "title": "Mutating endpoints require auth", "ok": True, "detail": "forecasts/resolve → operator, backtest/run → user"},
            {"id": "S-4", "title": "Role allow-list + 12-char passwords", "ok": True, "detail": "client | operator | admin; only admin mints admin"},
            {"id": "S-5", "title": "Tokens stored as SHA-256", "ok": legacy == 0, "detail": f"{legacy} legacy plaintext token(s) still valid until expiry" if legacy else "all tokens hashed"},
            {"id": "S-6", "title": "PBKDF2-SHA256 100k", "ok": True, "detail": "100,000 iterations (kept for hash compatibility with v6.5 databases)"},
            {"id": "S-7", "title": "Constant-time compare + login backoff", "ok": True, "detail": "exponential lockout after 5 failures"},
            {"id": "S-8", "title": "CORS allow-list", "ok": bool(cors), "detail": str(cors) if cors else "CORS_ORIGINS not set — '*' (demo)"},
            {"id": "S-9", "title": "Quarantine for rejected ingest", "ok": True, "detail": f"{qn} quarantined payload(s)"},
        ]
        return {"version": VERSION, "passing": sum(1 for c in checks if c["ok"]), "total": len(checks), "checks": checks}

    def audit(self, actor: str, action: str, target: str | None = None, meta: Any = None) -> None:
        self.sql.exec(
            "INSERT INTO audit_log (actor, action, target, meta, created_ms) VALUES (?, ?, ?, ?, ?)",
            actor, action, target, json.dumps(meta, separators=(",", ":"), default=str)[:2000] if meta else None, now_ms(),
        )

    # ------------------------------------------------------------- settings
    def setting(self, key: str) -> str | None:
        r = self.sql.one("SELECT value FROM settings WHERE key = ?", key)
        return r["value"] if r else None

    def set_setting(self, key: str, value: str) -> None:
        self.sql.exec("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value)

    def num_setting(self, key: str, lo: float, hi: float, dflt: float) -> float:
        raw = self.setting(key)
        v = math.nan if raw is None or raw == "" else js_number(raw)
        return min(hi, max(lo, v)) if math.isfinite(v) else dflt

    # --------------------------------------------------------------- rounds
    @property
    def as_of_ms(self) -> int | None:
        return _as_of.get()

    def invalidate_caches(self) -> None:
        self.rounds_cache.clear()
        self.analysis_cache.clear()
        self.intel_forecast_cache.clear()

    def table_stats(self) -> dict:
        return self.sql.one("SELECT COALESCE(MAX(id), 0) AS maxId, COUNT(*) AS count FROM rounds")

    def rounds_for(self, source: str | None, cacheable_or_opts: Any = True) -> list[Round]:
        cacheable = cacheable_or_opts if isinstance(cacheable_or_opts, bool) else True
        if isinstance(cacheable_or_opts, dict) and cacheable_or_opts.get("includeReconstructed") is not None:
            want_recon = bool(cacheable_or_opts["includeReconstructed"])
        else:
            want_recon = self.setting("reconstruct_in_forecast") != "0"
        key = f"{source or 'all'}|{'r' if want_recon else 'o'}"
        as_of = self.as_of_ms
        if as_of is not None:
            tok = _as_of.set(None)
            try:
                all_r = self.rounds_for(source, {"includeReconstructed": want_recon})
            finally:
                _as_of.reset(tok)
            ok = {r["id"] for r in self.sql.rows(
                "SELECT id FROM rounds WHERE ts_ms < ? AND (created_ms < ? OR ingest IN ('import', 'seed-span', 'db-import', 'reconstruct'))", as_of, as_of)}
            return [r for r in all_r if r.id in ok]
        stats = self.table_stats()
        if cacheable:
            hit = self.rounds_cache.get(key)
            if hit and hit["maxId"] == stats["maxId"] and hit["count"] == stats["count"]:
                return hit["rounds"]
        oc = "" if want_recon else " AND origin != 'reconstructed'"
        cols = "id, ts, ts_ms, multiplier, color, source, session_id, origin"
        if source and source != "all":
            rows = self.db._conn.execute(f"SELECT {cols} FROM rounds WHERE source = ?{oc} ORDER BY ts_ms ASC", (source,)).fetchall()
        else:
            rows = self.db._conn.execute(f"SELECT {cols} FROM rounds WHERE 1 = 1{oc} ORDER BY ts_ms ASC").fetchall()
        rounds = [Round(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7] or "observed") for r in rows]
        if cacheable:
            self.rounds_cache[key] = {"maxId": stats["maxId"], "count": stats["count"], "rounds": rounds}
        return rounds

    def last_session_id(self) -> int:
        return self.sql.scalar("SELECT id FROM sessions ORDER BY id DESC LIMIT 1", default=0)

    def rebuild_sessions(self, source: str) -> None:
        """30-minute-gap sessionization (investigationsuite methodology)."""
        gap = 30 * 60 * 1000
        sql = self.sql
        with sql.transaction():
            rows = sql.rows("SELECT id, ts_ms, multiplier FROM rounds WHERE source = ? AND origin != 'reconstructed' ORDER BY ts_ms ASC", source)
            sql.exec("DELETE FROM sessions WHERE source = ?", source)
            sql.exec("UPDATE rounds SET session_id = NULL WHERE source = ?", source)
            sid = None
            start = prev = None
            count = 0
            mx = 0.0

            def close():
                if sid is not None and start and prev:
                    sql.exec("UPDATE rounds SET session_id = ? WHERE source = ? AND origin != 'reconstructed' AND ts_ms BETWEEN ? AND ?", sid, source, start["ts_ms"], prev["ts_ms"])
                    sql.exec("UPDATE sessions SET started_ms = ?, ended_ms = ?, rounds = ?, max_multiplier = ? WHERE id = ?", start["ts_ms"], prev["ts_ms"], count, mx, sid)

            for r in rows:
                ts = r["ts_ms"]
                if not start or (prev is not None and ts - prev["ts_ms"] > gap):
                    close()
                    sid = sql.exec("INSERT INTO sessions (source, started_ms, ended_ms, rounds, max_multiplier) VALUES (?, ?, ?, 0, 0)", source, ts, ts).lastrowid
                    start = r
                    count = 0
                    mx = 0.0
                count += 1
                mx = max(mx, r["multiplier"])
                prev = r
            close()
        self.rounds_cache.clear()

    @staticmethod
    def normalize_round(raw: Any, fallback_ts: int) -> dict | None:
        if not isinstance(raw, dict):
            if isinstance(raw, (list, tuple)):
                return None
            n = js_number(raw)
            return {"tsMs": fallback_ts, "multiplier": n, "color": None} if math.isfinite(n) and n >= 1 else None
        o = raw
        mult_raw = next((o[k] for k in ("multiplier", "value", "crash_point", "result", "payout") if o.get(k) is not None), None)
        m = js_number(mult_raw) if not isinstance(mult_raw, (dict, list)) else math.nan
        if mult_raw is None or not math.isfinite(m) or m < 1:
            return None
        ts_raw = next((o[k] for k in ("timestamp", "time", "ts", "created_at") if o.get(k) is not None), None)
        ts = fallback_ts
        if isinstance(ts_raw, (int, float)) and not isinstance(ts_raw, bool):
            ts = int(ts_raw if ts_raw > 1e12 else ts_raw * 1000)
        elif isinstance(ts_raw, str):
            p = parse_iso_ms(ts_raw)
            if p is not None:
                ts = p
        cr = o.get("color") if o.get("color") is not None else o.get("colour")
        color = cr.lower()[:16] if isinstance(cr, str) and cr else None
        return {"tsMs": ts, "multiplier": min(m, 1e7), "color": color}

    def ingest_rounds(self, source: str, method: str, incoming: list, origin: str = "observed") -> dict:
        sql = self.sql
        now = now_ms()
        srt = [x for x in (self.normalize_round(r, now) for r in incoming) if x is not None]
        rejected = len(incoming) - len(srt)
        srt.sort(key=lambda r: r["tsMs"])
        inserted = 0
        with sql.transaction():
            conn = self.db._conn
            for r in srt:
                cur = conn.execute(
                    "INSERT OR IGNORE INTO rounds (ts, ts_ms, multiplier, color, source, session_id, ingest, created_ms, origin) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)",
                    (iso(r["tsMs"]), r["tsMs"], r["multiplier"], r["color"], source, method, now, origin),
                )
                inserted += cur.rowcount if cur.rowcount > 0 else 0
            sql.exec("INSERT INTO ingest_log (source, method, count, rejected, created_ms) VALUES (?, ?, ?, ?, ?)", source, method, inserted, rejected, now)
            sql.exec("INSERT INTO sources (name, label, kind, created_ms) VALUES (?, ?, 'collector', ?) ON CONFLICT(name) DO NOTHING", source, source, now)
        self.invalidate_caches()
        if 0 < len(srt) <= 200:
            self.extend_sessions(source, srt)
        if inserted > 0:
            try:
                self.calibrate_new_rounds(max_intel=self.ingest_intel_budget)
            except Exception as e:
                log.error("calibration after ingest failed: %s", e)
            try:
                self._v65.on_ingest(self.adapter, inserted, origin)
            except Exception as e:
                log.error("v6.5 onIngest: %s", e)
            for fn in self.ingest_listeners:
                try:
                    fn(source, inserted, origin)
                except Exception as e:  # pragma: no cover
                    log.error("ingest listener: %s", e)
            # P7: push to WebSocket /live clients (fire-and-forget)
            try:
                from app.main import live_push
                live_push(self, "round", {"source": source, "inserted": inserted, "origin": origin})
            except Exception:
                pass  # never block on push failures
        return {"inserted": inserted, "rejected": rejected}

    def extend_sessions(self, source: str, srt: list[dict]) -> None:
        gap = 30 * 60 * 1000
        sql = self.sql
        last = sql.one("SELECT * FROM sessions WHERE source = ? ORDER BY ended_ms DESC LIMIT 1", source)
        sid = last["id"] if last else None
        started = last["started_ms"] if last else 0
        ended = last["ended_ms"] if last else 0
        count = last["rounds"] if last else 0
        mx = last["max_multiplier"] if last else 0
        with sql.transaction():
            for r in srt:
                idr = sql.one("SELECT id FROM rounds WHERE source = ? AND ts_ms = ? AND multiplier = ? ORDER BY id DESC LIMIT 1", source, r["tsMs"], r["multiplier"])
                if not idr:
                    continue
                if sid is None or r["tsMs"] - ended > gap:
                    sid = sql.exec("INSERT INTO sessions (source, started_ms, ended_ms, rounds, max_multiplier) VALUES (?, ?, ?, 0, 0)", source, r["tsMs"], r["tsMs"]).lastrowid
                    started = r["tsMs"]
                    count = 0
                    mx = 0
                ended = max(ended, r["tsMs"])
                count += 1
                mx = max(mx, r["multiplier"])
                sql.exec("UPDATE rounds SET session_id = ? WHERE id = ?", sid, idr["id"])
            if sid is not None:
                sql.exec("UPDATE sessions SET started_ms = ?, ended_ms = ?, rounds = ?, max_multiplier = ? WHERE id = ?", started, ended, count, mx, sid)
        self.rounds_cache.clear()

    # ------------------------------------------------------------- analysis
    def analysis_payload(self, source: str | None) -> dict:
        rounds = self.rounds_for(source)
        max_id = self.table_stats()["maxId"]
        key = f"{source or 'all'}:{max_id}"
        hit = self.analysis_cache.get(key)
        if hit:
            return hit
        payload = {
            "source": source or "all",
            "generatedAt": iso(),
            "overview": A.overview(rounds),
            "exceedance": A.exceedance(rounds),
            "streaks": A.streaks(rounds, 2),
            "bands": A.bands(rounds),
            "pressure": A.pressure(rounds),
            "shape": A.shape(rounds),
            "moonshot": A.moonshot(rounds),
            "gaps": A.gaps(rounds),
            "houseEdge": A.house_edge(rounds),
            "ladders": A.ladders(rounds),
            "ceilings": A.ceilings(rounds),
        }
        if len(self.analysis_cache) > 16:
            self.analysis_cache.clear()
        self.analysis_cache[key] = payload
        return payload

    def fx_payload(self, source: str | None) -> dict:
        rounds = self.rounds_for(source)
        max_id = self.table_stats()["maxId"]
        key = f"{source or 'all'}:{max_id}"
        hit = self.fx_cache.get(key)
        if hit:
            return hit
        sig = FX.fx_signals(rounds)
        payload = {
            "source": source or "all",
            "generatedAt": iso(),
            "rounds": len(rounds),
            "signals": sig["signals"],
            **sig["engines"],
            "divergence": FX.divergence(rounds),
            "hitPoints": M.hit_points(rounds, 300_000)[-24:],
            "anchorState": M.anchors(rounds)["state"],
            "rangeMomentum": [{"id": r["id"], "momentum": r["momentum"], "trend": r["trend"], "currentRun": r["currentRun"], "medianGapMs": r["medianGapMs"]} for r in M.range_momentum(rounds)],
        }
        if len(self.fx_cache) > 16:
            self.fx_cache.clear()
        self.fx_cache[key] = payload
        return payload

    def momentum_payload(self, source: str | None, bucket_ms: int) -> dict:
        rounds = self.rounds_for(source)
        max_id = self.table_stats()["maxId"]
        key = f"{source or 'all'}:{bucket_ms}:{max_id}"
        hit = self.momentum_cache.get(key)
        if hit:
            return hit
        payload = {
            "source": source or "all",
            "generatedAt": iso(),
            "rounds": len(rounds),
            "bucketMs": bucket_ms,
            "hitPoints": M.hit_points(rounds, bucket_ms),
            "anchors": M.anchors(rounds),
            "momentum": M.range_momentum(rounds),
            "moonshot": M.moonshot(rounds, 10),
            "rangeForecast": M.range_forecast(rounds),
            "inverted": M.inverted_forecast(rounds, self.weights_map()),
        }
        if len(self.momentum_cache) > 8:
            self.momentum_cache.clear()
        self.momentum_cache[key] = payload
        return payload

    def plugin_status(self, payload: dict) -> list:
        plugins = self.sql.rows("SELECT key, name, enabled, weight, runs FROM plugins ORDER BY key")
        computed = {
            "ladders": payload.get("ladders"), "resistance": payload.get("ceilings"), "streaks": payload.get("streaks"),
            "regimes": None, "edge_fit": payload.get("houseEdge"), "pressure": payload.get("pressure"),
            "moonshot": payload.get("moonshot"), "shape_shifters": payload.get("shape"), "linguistics": None,
            "markov_forecast": payload.get("streaks"), "ensemble_forecast": payload.get("exceedance"),
        }
        return [{**p, "computed": computed.get(p["key"])} for p in plugins]

    def forecast_accuracy(self, source: str | None) -> dict:
        if source and source != "all":
            rows = self.sql.rows("SELECT * FROM forecasts WHERE source = ? ORDER BY created_ms DESC LIMIT 500", source)
        else:
            rows = self.sql.rows("SELECT * FROM forecasts ORDER BY created_ms DESC LIMIT 500")
        resolved = [r for r in rows if r.get("actual") is not None]
        brier = sum((r.get("brier") or 0) for r in resolved) / len(resolved) if resolved else None
        by: dict[str, dict] = {}
        for r in resolved:
            m = by.setdefault(r["model"], {"model": r["model"], "n": 0, "brierSum": 0.0, "hits": 0})
            m["n"] += 1
            m["brierSum"] += r.get("brier") or 0
            if r["actual"] == 1:
                m["hits"] += 1
        return {
            "total": len(rows),
            "open": len(rows) - len(resolved),
            "resolved": len(resolved),
            "brier": tf(brier, 5) if brier is not None else None,
            "perModel": [{"model": m["model"], "n": m["n"], "brier": tf(m["brierSum"] / m["n"], 5), "hitRate": tf(m["hits"] / m["n"], 4)} for m in by.values()],
            "recent": rows[:50],
        }

    def resolve_forecasts(self) -> int:
        latest = self.sql.one("SELECT id, multiplier FROM rounds ORDER BY ts_ms DESC LIMIT 1")
        if not latest:
            return 0
        n = 0
        with self.sql.transaction():
            for f in self.sql.rows("SELECT id, threshold, probability FROM forecasts WHERE actual IS NULL"):
                actual = 1 if latest["multiplier"] >= f["threshold"] else 0
                brier = (f["probability"] - actual) ** 2
                self.sql.exec("UPDATE forecasts SET actual = ?, brier = ?, resolved_ms = ?, resolved_round_id = ? WHERE id = ?", actual, brier, now_ms(), latest["id"], f["id"])
                n += 1
        return n

    # ----------------------------------------------- accuracy engine v2
    def accuracy_config(self) -> dict:
        enabled = self.setting("accuracy_enabled") != "0"
        ids = [s.strip() for s in (self.setting("accuracy_windows") or "15m,1h,4h,1d,7d").split(",") if s.strip()]
        windows = [w for w in (next((x for x in P.WINDOWS if x["id"] == i), None) for i in ids) if w]
        th = [v for v in (js_number(s) for s in (self.setting("accuracy_thresholds") or "2,5,10").split(",")) if math.isfinite(v) and v >= 1.01]
        return {"enabled": enabled, "windows": windows or list(P.WINDOWS), "thresholds": th or [2, 5, 10]}

    def weights_map(self) -> dict:
        return {r["model"]: r["weight"] for r in self.sql.rows("SELECT model, weight FROM engine_weights WHERE weight > 0")}

    def recompute_weights(self) -> None:
        rows = self.sql.rows("SELECT model, SUM(brier_sum) AS b, SUM(base_sum) AS s, SUM(n) AS n FROM accuracy_ledger WHERE n > 0 GROUP BY model")
        skills: dict[str, float] = {}
        for r in rows:
            n = r["n"] or 0
            if n < 5:
                continue
            skills[r["model"]] = (r["s"] - r["b"]) / n
        now = now_ms()
        total = sum(s for s in skills.values() if s > 0)
        models = list(dict.fromkeys([*skills.keys(), "baseline", "markov", "streak", "recent", "ensemble"]))
        for m in models:
            skill = skills.get(m, 0.0)
            w = max(0.0, skill) / total if total > 0 else 0.0
            self.sql.exec(
                """INSERT INTO engine_weights (model, skill, weight, updated_ms) VALUES (?, ?, ?, ?)
         ON CONFLICT(model) DO UPDATE SET skill = excluded.skill, weight = excluded.weight, updated_ms = excluded.updated_ms""",
                m, tf(skill, 5), tf(w, 5), now,
            )

    def cadence_ms(self) -> int:
        ts = sorted(r["ts_ms"] for r in self.sql.rows("SELECT ts_ms FROM rounds ORDER BY ts_ms DESC LIMIT 201"))
        gaps = sorted(g for g in (ts[i] - ts[i - 1] for i in range(1, len(ts))) if 0 < g < 6 * 3_600_000)
        return gaps[len(gaps) // 2] if gaps else 4000

    def upsert_ledger(self, model: str, window: str, threshold: float, d: dict) -> None:
        self.sql.exec(
            """INSERT INTO accuracy_ledger (model, window, threshold, n, brier_sum, base_sum, logloss_sum, hits, rounds_scanned, updated_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(model, window, threshold) DO UPDATE SET
         n = n + excluded.n, brier_sum = brier_sum + excluded.brier_sum, base_sum = base_sum + excluded.base_sum,
         logloss_sum = logloss_sum + excluded.logloss_sum, hits = hits + excluded.hits,
         rounds_scanned = rounds_scanned + excluded.rounds_scanned, updated_ms = excluded.updated_ms""",
            model, window, threshold, d["n"], d["brierSum"], d["baseSum"], d["loglossSum"], d["hits"], d["roundsScanned"], now_ms(),
        )

    def append_accuracy_history(self, window: str, threshold: float) -> None:
        sql = self.sql
        row = sql.one("SELECT SUM(n) AS n, SUM(brier_sum) AS b, SUM(base_sum) AS s, SUM(hits) AS h FROM accuracy_ledger WHERE model = 'pipeline' AND window = ? AND threshold = ?", window, threshold)
        n = max(1, row["n"] or 0)
        sql.exec(
            "INSERT INTO accuracy_history (window, threshold, ts, cumulative_n, cumulative_brier, cumulative_base, hit_rate) VALUES (?, ?, ?, ?, ?, ?, ?)",
            window, threshold, now_ms(), row["n"], tf((row["b"] or 0) / n, 6), tf((row["s"] or 0) / n, 6), tf((row["h"] or 0) / n, 4),
        )
        if sql.scalar("SELECT COUNT(*) AS n FROM accuracy_history WHERE window = ? AND threshold = ?", window, threshold) > 600:
            sql.exec(
                """DELETE FROM accuracy_history WHERE window = ? AND threshold = ? AND id <=
         (SELECT MAX(id) - 400 FROM accuracy_history WHERE window = ? AND threshold = ?)""",
                window, threshold, window, threshold,
            )

    def accuracy_tick(self) -> dict:
        """Resolve matured multi-window predictions, update ledgers + weights, schedule replacements."""
        if self.accuracy_busy:
            return {"skipped": True, "reason": "tick already running"}
        self.accuracy_busy = True
        try:
            sql = self.sql
            now = now_ms()
            cfg = self.accuracy_config()
            summary: dict = {"resolved": 0, "scheduled": 0, "fed": 0, "weights": False}
            if not cfg["enabled"]:
                self.schedule_accuracy_alarm()
                return {"disabled": True, **summary}
            cadence = self.cadence_ms()
            rounds_all = self.rounds_for(None)
            matured = sql.rows("SELECT * FROM scheduled_predictions WHERE resolved_ms IS NULL AND due_ms <= ?", now)
            with sql.transaction():
                for f in matured:
                    out_n = sql.scalar("SELECT COUNT(*) AS n FROM rounds WHERE ts_ms > ? AND ts_ms <= ? AND multiplier >= ?", f["created_ms"], f["due_ms"], f["threshold"], default=0)
                    actual = 1 if out_n > 0 else 0
                    p = f["probability"]
                    brier = (p - actual) ** 2
                    base_p = 0.5
                    comps = _jparse(f.get("components") or "[]", [])
                    for c in comps if isinstance(comps, list) else []:
                        if isinstance(c, dict) and c.get("model") == "baseline":
                            base_p = c.get("p", 0.5) if c.get("p") is not None else 0.5
                            break
                    base_brier = (base_p - actual) ** 2
                    ll = -(actual * math.log(max(1e-9, p)) + (1 - actual) * math.log(max(1e-9, 1 - p)))
                    sql.exec("UPDATE scheduled_predictions SET resolved_ms = ?, actual = ?, outcome_rounds = ?, brier = ?, logloss = ? WHERE id = ?", now, actual, out_n, tf(brier, 6), tf(ll, 6), f["id"])
                    model = f.get("model") or "pipeline"
                    self.upsert_ledger(model, f["window"], f["threshold"], {"n": 1, "brierSum": brier, "baseSum": base_brier, "loglossSum": ll, "hits": 1 if (p >= 0.5) == (actual == 1) else 0, "roundsScanned": 0})
                    if model == "pipeline":
                        self.append_accuracy_history(f["window"], f["threshold"])
                    summary["resolved"] += 1
                if matured:
                    self.recompute_weights()
                    summary["weights"] = True
            intel = None
            try:
                intel = self.intel_forecast(rounds_all, "all") if len(rounds_all) >= 50 else None
            except Exception as e:
                log.error("full-intelligence forecast failed in accuracy tick: %s", e)
            intel_dist = C.sanitize_dist([d["probability"] for d in intel["distribution"]]) if intel else None
            pipe_w = self.weights_map()

            def is_open(model, window, t):
                return sql.one("SELECT id FROM scheduled_predictions WHERE model = ? AND window = ? AND threshold = ? AND resolved_ms IS NULL LIMIT 1", model, window, t) is not None

            def insert(model, window, t, per_round, n_r, components, due) -> bool:
                p = clamp01(per_round)
                p_win = P.window_probability(p, n_r)
                if not math.isfinite(p_win):
                    return False
                sql.exec(
                    """INSERT INTO scheduled_predictions (source, window, threshold, model, probability, per_round, expected_rounds, components, created_ms, due_ms)
           VALUES ('all', ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    window, t, model, tf(p_win, 6), tf(p, 6), n_r, json.dumps(components, separators=(",", ":")), now, due,
                )
                return True

            with sql.transaction():
                for w in (cfg["windows"] if len(rounds_all) >= 50 else []):
                    n_r = P.expected_rounds(rounds_all, w["ms"])
                    for t in cfg["thresholds"]:
                        per = P.per_round_probability(rounds_all, t, pipe_w)
                        base_win = {"model": "baseline", "p": tf(P.window_probability(per["baseRate"], n_r), 6)}
                        if not is_open("pipeline", w["id"], t):
                            comps = [{"model": c["model"], "p": tf(P.window_probability(c["p"], n_r), 6)} for c in per["components"]]
                            if insert("pipeline", w["id"], t, per["p"], n_r, comps, now + w["ms"]):
                                summary["scheduled"] += 1
                        if intel and intel_dist and not is_open("full-intelligence", w["id"], t):
                            comps = [base_win] + [
                                c for c in (
                                    {"model": k["key"], "p": tf(P.window_probability(C.survival_at(C.sanitize_dist(k["distribution"]) or intel_dist, t), n_r), 6)}
                                    for k in intel["intelligence"]["components"]
                                ) if c["model"] != "baseline"
                            ]
                            if insert("full-intelligence", w["id"], t, C.survival_at(intel_dist, t), n_r, comps, now + w["ms"]):
                                summary["scheduled"] += 1
            self.set_setting("accuracy_last_tick", str(now))
            self.schedule_accuracy_alarm()
            summary["cadenceMs"] = cadence
            summary["enabledWindows"] = [w["id"] for w in cfg["windows"]]
            summary["thresholds"] = cfg["thresholds"]
            return summary
        finally:
            self.accuracy_busy = False

    def schedule_accuracy_alarm(self) -> None:
        due = self.sql.scalar("SELECT MIN(due_ms) AS d FROM scheduled_predictions WHERE resolved_ms IS NULL")
        now = now_ms()
        nxt = min(due + 1_000, now + 2 * 60_000) if due else now + 60_000
        self.alarm_at_ms = max(now + 5_000, nxt)

    def alarm(self) -> dict:
        """Durable-alarm equivalent: driven by the in-process scheduler."""
        out: dict = {}
        try:
            out["accuracy"] = self.accuracy_tick()
        except Exception as e:
            log.error("accuracy alarm tick failed: %s", e)
        try:
            out["deep"] = self.run_deep()
        except Exception as e:
            log.error("deep tier tick failed: %s", e)
        self.schedule_accuracy_alarm()
        return out

    def run_deep(self) -> dict:
        return self._v64.deep_tick(self.adapter)

    # ------------------------------------------------ next-round calibration
    def calibration_config(self) -> dict:
        return {"enabled": self.setting("calibration_enabled") != "0", "window": clamp_int(self.setting("calibration_window") or "30", 10, 200, 30), "minSample": 15}

    def band_correction(self) -> dict:
        cfg = self.calibration_config()
        corr = self.sql.one("SELECT correction FROM round_calibrations WHERE id = -1")
        n = self.sql.scalar("SELECT COUNT(*) AS n FROM round_calibrations WHERE id <> -1 AND resolved_ms IS NOT NULL", default=0)
        v = (corr or {}).get("correction") or 0
        return {"value": v, "sampleSize": n} if n >= cfg["minSample"] else {"value": 0, "sampleSize": n}

    @staticmethod
    def score_round_forecast(expected: float, lo: float, hi: float, actual: float, state: str, tail_lift: float) -> dict:
        be = band_index(actual) - band_index(expected)
        le = math.log(max(1, actual)) - math.log(max(1, expected))
        in_range = lo <= actual <= hi
        loose = lo / 1.5 <= actual <= hi * 1.5
        short = P.band_label_of_short
        if in_range and abs(be) <= 1:
            verdict = "hit"
            reason = f"Actual settled inside the p25–p75 range in {'the' if be == 0 else 'an adjacent'} projected band — {state} projection held."
        elif abs(be) <= 1 and loose:
            verdict = "adjacent"
            reason = f"Off by one band ({short(band_index(expected))} → {short(band_index(actual))}) and inside the padded range — direction correct."
        elif be > 1:
            verdict = "miss-high"
            reason = f"Actual landed {be} bands ABOVE the projected {short(band_index(expected))} — the tail was hotter than tail-lift {to_fixed(tail_lift, 2)} implied under {state}. The lift is too timid for this regime."
        elif be < -1:
            verdict = "miss-low"
            reason = f"Actual landed {-be} bands BELOW the projected {short(band_index(expected))} — the base bands held weight the model gave to the tail; {state} over-weighted moonshot bands."
        else:
            verdict = "near"
            reason = "Just outside the central range in a neighbouring band — the band split was right, the range edges were tight."
        return {"verdict": verdict, "bandErr": be, "logErr": le, "reason": reason}

    def calibrate_new_rounds(self, max_intel: int | None = None) -> int:
        cfg = self.calibration_config()
        if not cfg["enabled"]:
            return 0
        sql = self.sql
        all_r = self.rounds_for(None)
        ex = sql.one("SELECT COUNT(*) AS n, MAX(created_ms) AS last FROM round_calibrations WHERE id <> -1")
        if ex["n"]:
            last = ex["last"] or 0
            targets = [x for x in all_r if x.tsMs > last]
        else:
            targets = all_r[-120:]
        targets = [x for x in targets if x.origin != "reconstructed"]
        scored = 0
        # O(n) per target in the archive (filter); all_r is sorted by ts so bisect the prefix
        import bisect
        ts_list = [x.tsMs for x in all_r]
        with sql.transaction():
            for r in targets:
                k = bisect.bisect_left(ts_list, r.tsMs)
                if k < 100:
                    continue
                history = all_r[:k]
                corr = self.band_correction()
                f = P.next_round_forecast(history, "all", self.weights_map())
                s = self.score_round_forecast(f["expectedMultiplier"], f["rangeLo"], f["rangeHi"], r.multiplier, f["state"], f["tailLift"])
                sql.exec(
                    """INSERT INTO round_calibrations (source, state, expected, range_lo, range_hi, reach, tail_lift, correction, dist, actual, verdict, reason, band_err, log_err, created_ms, resolved_ms)
         VALUES ('all', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    f["state"], f["expectedMultiplier"], f["rangeLo"], f["rangeHi"], f["moonshotReach"], f["tailLift"], corr["value"],
                    json.dumps(f["distribution"], separators=(",", ":")), r.multiplier, s["verdict"], s["reason"], s["bandErr"], tf(s["logErr"], 5), r.tsMs, r.tsMs,
                )
                scored += 1
            if scored:
                self.update_band_correction()
                log.info("calibration: %d rounds scored (%s)", scored, "incremental" if ex["n"] else "backtest")
        try:
            self.calibrate_intel(all_r, max_rounds=max_intel)
        except Exception as e:
            log.error("intel calibration failed: %s", e)
        return scored

    def update_band_correction(self) -> None:
        cfg = self.calibration_config()
        rows = self.sql.rows("SELECT log_err FROM round_calibrations WHERE id <> -1 AND resolved_ms IS NOT NULL ORDER BY created_ms DESC LIMIT ?", cfg["window"])
        n = len(rows)
        mean = sum(r["log_err"] for r in rows) / n if n else 0
        v = max(-1.5, min(1.5, mean))
        self.sql.exec(
            """INSERT INTO round_calibrations (id, source, state, expected, range_lo, range_hi, reach, tail_lift, correction, dist, actual, verdict, reason, band_err, log_err, created_ms, resolved_ms)
       VALUES (-1, 'all', 'state', 0, 0, 0, 0, 0, ?, NULL, NULL, 'state', ?, 0, 0, 0, 0)
       ON CONFLICT(id) DO UPDATE SET correction = excluded.correction, reason = excluded.reason""",
            tf(v, 5), f"rectification state · n={n} over trailing {cfg['window']} · bias {js_str(jround(v * 100))}%",
        )

    # ------------------------------------------- full-intelligence calibration
    def _intel_stamp(self) -> dict:
        return self.sql.one("SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS id FROM intel_calibrations")

    def _asof_key(self) -> str:
        a = self.as_of_ms
        return "live" if a is None else str(a)

    def intel_ledger(self, window: int = 200) -> dict:
        st = self._intel_stamp()
        key = f"{st['n']}:{st['id']}:{window}:{self._asof_key()}"
        if self.intel_ledger_cache and self.intel_ledger_cache["key"] == key:
            return self.intel_ledger_cache["value"]
        rows = self.sql.rows(
            "SELECT comp_loss, COALESCE(cal_loss, mix_loss) AS mix_loss, base_loss, verdict FROM intel_calibrations WHERE resolved_ms IS NOT NULL AND created_ms < ? ORDER BY created_ms DESC LIMIT ?",
            self.as_of_ms if self.as_of_ms is not None else 9e15, window,
        )
        sums: dict[str, float] = {}
        counts: dict[str, int] = {}
        mix = base = 0.0
        hits = 0
        for r in rows:
            cl = _jparse(r["comp_loss"], {}) if r["comp_loss"] else {}
            if not isinstance(cl, dict):
                cl = {}
            for k, v in cl.items():
                if not isinstance(v, (int, float)) or not math.isfinite(v):
                    continue
                sums[k] = sums.get(k, 0) + v
                counts[k] = counts.get(k, 0) + 1
            mix += r["mix_loss"] or 0
            base += r["base_loss"] or 0
            if r["verdict"] in ("hit", "adjacent"):
                hits += 1
        n = len(rows)
        value = {
            "weights": {},
            "logLoss": {k: v / counts[k] for k, v in sums.items()} if n else {},
            "sample": n,
            "mixLogLoss": mix / n if n else None,
            "baseLogLoss": base / n if n else None,
            "hitRate": hits / n if n else None,
        }
        self.intel_ledger_cache = {"key": key, "value": value}
        return value

    def intel_correction(self) -> dict:
        cfg = self.calibration_config()
        rows = self.sql.rows("SELECT log_err FROM intel_calibrations WHERE resolved_ms IS NOT NULL ORDER BY created_ms DESC LIMIT ?", cfg["window"])
        total = self.sql.scalar("SELECT COUNT(*) AS n FROM intel_calibrations", default=0)
        if len(rows) < cfg["minSample"]:
            return {"value": 0, "sampleSize": total}
        errs = sorted((r["log_err"] or 0) for r in rows)
        L = len(errs)
        mid = errs[(L - 1) // 2] if L % 2 else (errs[L // 2 - 1] + errs[L // 2]) / 2
        return {"value": max(-1.5, min(1.5, mid)), "sampleSize": total}

    def intel_cal_samples(self, window: int = 1000) -> list[dict]:
        rows = self.sql.rows(
            "SELECT dist, actual FROM intel_calibrations WHERE resolved_ms IS NOT NULL AND actual IS NOT NULL AND dist IS NOT NULL AND created_ms < ? ORDER BY created_ms DESC LIMIT ?",
            self.as_of_ms if self.as_of_ms is not None else 9e15, window,
        )
        out = []
        for r in reversed(rows):
            d = _jparse(r["dist"], None)
            if isinstance(d, list):
                out.append({"dist": d, "actual": r["actual"]})
        return out

    def intel_recalibrator(self) -> dict:
        st = self._intel_stamp()
        enabled = self.setting("intel_recalibration") != "0"
        window = clamp_int(self.setting("intel_recalibration_window") or "1000", 100, 3000, 1000)
        key = f"{st['n'] // 10}:{self._asof_key()}:{'true' if enabled else 'false'}:{window}"
        if self.recalibrator_cache and self.recalibrator_cache["key"] == key:
            return self.recalibrator_cache["value"]
        try:
            value = C.fit_recalibrator(self.intel_cal_samples(window)) if enabled else C.fit_recalibrator([], {"minSample": INF})
            if not enabled:
                value = {**value, "reason": "Recalibration disabled by operator (setting intel_recalibration = 0)."}
        except Exception as e:
            log.error("recalibrator fit failed: %s", e)
            value = {**C.fit_recalibrator([], {"minSample": INF}), "reason": "Recalibration fit failed — raw mixture published."}
        self.recalibrator_cache = {"key": key, "value": value}
        return value

    def intel_evidence(self) -> dict:
        st = self._intel_stamp()
        window = clamp_int(self.setting("intel_recalibration_window") or "1000", 100, 3000, 1000)
        live = self.intel_recalibrator()
        key = f"{st['n'] // 10}:{self._asof_key()}:{window}:{live.get('active')}:{live.get('quantileActive')}:{self.setting('range_profile') or 'loose'}"
        if self.evidence_cache and self.evidence_cache["key"] == key:
            return self.evidence_cache
        cutoff = self.sql.scalar(
            "SELECT MAX(created_ms) AS t FROM intel_calibrations WHERE resolved_ms IS NOT NULL AND actual IS NOT NULL AND created_ms < ?",
            self.as_of_ms if self.as_of_ms is not None else 9e15,
        )
        meta = {"dataCutoffMs": cutoff, "ledgerWindow": window}
        full = None
        try:
            full = evaluate_locked_holdout(self.intel_cal_samples(window), {"rangeProfile": self.setting("range_profile")})
            value = summarize_evidence(full, live, meta)
        except Exception as e:
            log.error("locked-holdout evidence failed: %s", e)
            value = unavailable_evidence("Locked-holdout evidence could not be computed; no skill is claimed.", meta)
        self.evidence_cache = {"key": key, "full": full, "value": value}
        return self.evidence_cache

    def forecast_tuning(self) -> dict:
        bg = self.setting("blend_gate") or ""
        return {
            "point_method": self.setting("point_method") or "auto",
            "range_method": self.setting("range_method") or "auto",
            "range_adaptive": self.setting("range_adaptive") != "0",
            "range_profile": C.range_profile(self.setting("range_profile"))["name"],
            "point_range_window": self.num_setting("point_range_window", 100, 3000, 600),
            "point_range_min_sample": self.num_setting("point_range_min_sample", 30, 2000, 100),
            "point_range_se": self.num_setting("point_range_se", 0, 5, 1),
            "aci_gamma": self.num_setting("aci_gamma", 0.001, 0.1, 0.01),
            "aci_max_shift": self.num_setting("aci_max_shift", 0, 0.3, 0.15),
            "blend_gate": bg if bg in ("all", "candidates", "off") else "candidates",
            "blend_gate_window": self.num_setting("blend_gate_window", 100, 3000, 600),
            "blend_gate_min_sample": self.num_setting("blend_gate_min_sample", 30, 2000, 100),
            "blend_gate_se": self.num_setting("blend_gate_se", 0, 5, 2),
            "chartlab_engine": self.setting("chartlab_engine") != "0",
            "chartlab_window": jround(self.num_setting("chartlab_window", 8, 120, 30)),
            "chartlab_k": jround(self.num_setting("chartlab_k", 5, 400, 40)),
        }

    def chart_lab_engine(self) -> list[dict]:
        t = self.forecast_tuning()
        if not t["chartlab_engine"]:
            return []
        w, k = int(t["chartlab_window"]), int(t["chartlab_k"])
        return [{
            "key": "chartlab",
            "label": "Chart Lab analogues",
            "prior": 0.6,
            "predict": lambda rounds: analogue_next_dist([r.multiplier for r in rounds if r.origin != "reconstructed"], {"window": w, "k": k}),
        }]

    def intel_gate(self, candidate_keys: list[str]) -> dict | None:
        t = self.forecast_tuning()
        if t["blend_gate"] == "off":
            return None
        st = self._intel_stamp()
        keys = [*INTEL_COMPONENTS, *candidate_keys] if t["blend_gate"] == "all" else list(candidate_keys)
        key = f"{st['n'] // 10}:{self._asof_key()}:{','.join(keys)}:{t['blend_gate_window']}:{t['blend_gate_min_sample']}:{t['blend_gate_se']}"
        if self.gate_cache and self.gate_cache["key"] == key:
            return self.gate_cache["value"]
        try:
            rows = self.sql.rows(
                "SELECT weights, comp_loss FROM intel_calibrations WHERE resolved_ms IS NOT NULL AND actual IS NOT NULL AND comp_loss IS NOT NULL AND created_ms < ? ORDER BY created_ms DESC LIMIT ?",
                self.as_of_ms if self.as_of_ms is not None else 9e15, int(t["blend_gate_window"]),
            )
            parsed = []
            for r in reversed(rows):
                try:
                    parsed.append({"weights": json.loads(r["weights"]) or {}, "compLoss": json.loads(r["comp_loss"]) or {}})
                except (ValueError, TypeError):
                    pass
            value = blend_admission(parsed, keys, {"window": t["blend_gate_window"], "minSample": t["blend_gate_min_sample"], "seMultiple": t["blend_gate_se"]})
        except Exception as e:
            log.error("blend gate failed: %s", e)
            value = None
        self.gate_cache = {"key": key, "value": value}
        return value

    def gated_registry(self) -> dict:
        reg = self._v65.registry(self.sql)
        extras = [*reg["extras"], *self.chart_lab_engine()]
        for provider in self.extra_candidates:
            try:
                extras.extend(provider(self))
            except Exception as e:  # pragma: no cover
                log.error("candidate provider failed: %s", e)
        cands = [e["key"] for e in extras]
        gate = self.intel_gate(cands)
        states = gated_states(reg["states"], gate, list(INTEL_COMPONENTS), cands)
        return {"states": states, "extras": extras, "gate": gate}

    def intel_point_range(self) -> dict:
        st = self._intel_stamp()
        prof = C.range_profile(self.setting("range_profile"))
        pm = self.setting("point_method") or "auto"
        im = self.setting("range_method") or "auto"
        adaptive = self.setting("range_adaptive") != "0"
        rc = self.intel_recalibrator()
        t = self.forecast_tuning()
        key = f"{st['n'] // 10}:{self._asof_key()}:{prof['name']}:{pm}:{im}:{adaptive}:{rc.get('active')}:{rc.get('gamma')}:{rc.get('tau')}:{t['point_range_window']}:{t['point_range_min_sample']}:{t['point_range_se']}:{t['aci_gamma']}:{t['aci_max_shift']}"
        if self.point_range_cache and self.point_range_cache["key"] == key:
            return self.point_range_cache["value"]
        try:
            value = select_point_range(self.intel_cal_samples(int(t["point_range_window"])), rc, {
                "nominal": prof["nominal"], "pointMethod": pm, "intervalMethod": im, "adaptive": adaptive,
                "window": int(t["point_range_window"]), "minSample": t["point_range_min_sample"], "minSeMultiple": t["point_range_se"],
                "gamma": t["aci_gamma"], "maxShift": t["aci_max_shift"],
            })
        except Exception as e:
            log.error("point/range selection failed: %s", e)
            value = default_selection(prof["nominal"], "Point/range selection failed — median and equal-tailed range published.")
        self.point_range_cache = {"key": key, "value": value}
        return value

    def _intel_opts(self, reg: dict, ledger: dict, weights: dict, corr: dict) -> dict:
        return {
            "engineStates": reg["states"],
            "extraEngines": reg["extras"],
            "ledger": ledger,
            "pipelineWeights": weights,
            "correction": corr["value"] or None,
            "correctionSample": corr["sampleSize"],
            "recalibrator": self.intel_recalibrator(),
            "rangeProfile": self.setting("range_profile"),
            "pointRange": self.intel_point_range(),
        }

    def intel_forecast(self, rounds: list[Round], source: str) -> dict:
        reg = self.gated_registry()
        head = rounds[-1] if rounds else None
        st = self._intel_stamp()
        reg_key = json.dumps(reg["states"], sort_keys=True) + "|" + ",".join(e["key"] for e in reg["extras"])
        key = ":".join(str(x) for x in [
            source, len(rounds), head.id if head else 0, head.tsMs if head else 0, head.multiplier if head else 0, st["n"], st["id"], self._asof_key(), reg_key,
            self.setting("intel_recalibration") or "1", self.setting("range_profile") or "loose", self.setting("evidence_gate") or "1",
            self.setting("point_method") or "auto", self.setting("range_method") or "auto", self.setting("range_adaptive") or "1",
            json.dumps(self.forecast_tuning(), sort_keys=True),
        ])
        hit = self.intel_forecast_cache.get(key)
        if hit:
            return hit
        corr = self.intel_correction()
        raw = full_intelligence_forecast(rounds, source, self._intel_opts(reg, self.intel_ledger(), self.weights_map(), corr))
        gated = gate_confidence(raw, self.intel_evidence()["value"], self.setting("evidence_gate") != "0")
        gate = reg["gate"] or {}
        value = {
            **gated["forecast"],
            "evidence": gated["evidence"],
            "blendGate": {
                "mode": self.forecast_tuning()["blend_gate"],
                "admitted": gate.get("admitted") if reg["gate"] else None,
                "excluded": gate.get("excluded", []) if reg["gate"] else [],
                "reason": gate.get("reason") if reg["gate"] else "Blend gate off: engines follow the operator registry.",
            },
        }
        if len(self.intel_forecast_cache) >= 8:
            self.intel_forecast_cache.pop(next(iter(self.intel_forecast_cache)))
        self.intel_forecast_cache[key] = value
        return value

    def calibrate_intel(self, all_r: list[Round], max_rounds: int | None = None) -> int:
        """Score each new round against the forecast that existed before it landed.

        `max_rounds` bounds one call's work (the scheduler drains the rest in
        later ticks); None keeps the archive's caps (backtest 150, catch-up 300).
        """
        cfg = self.calibration_config()
        if not cfg["enabled"] or len(all_r) < 150:
            return 0
        sql = self.sql
        last_row = sql.one("SELECT COUNT(*) AS n, MAX(created_ms) AS last FROM intel_calibrations")
        max_bt = clamp_int(self.setting("intel_backtest_rounds") or "150", 20, 1000, 150)
        n_all = len(all_r)
        if not last_row["n"]:
            start = max(100, n_all - max_bt)
        else:
            start = n_all
            last = last_row["last"] or 0
            while start > 0 and all_r[start - 1].tsMs > last:
                start -= 1
            start = max(start, n_all - 300, 100)
        end = n_all if max_rounds is None else min(n_all, start + max_rounds)
        scored = 0
        weights = self.weights_map()
        for i in range(start, end):
            target = all_r[i]
            if target.origin == "reconstructed":
                continue
            reg = self.gated_registry()
            history = all_r[:i]
            corr = self.intel_correction()
            f = full_intelligence_forecast(history, "all", self._intel_opts(reg, self.intel_ledger(), weights, corr))
            s = score_intel_forecast({**f, "expectedMultiplier": f["baseMultiplier"]}, target.multiplier)
            comp_loss = {c["key"]: tf(band_log_loss(c["distribution"], target.multiplier), 5) for c in f["intelligence"]["components"]}
            mix_loss = band_log_loss(f["rawDistribution"], target.multiplier)
            cal_loss = band_log_loss([d["probability"] for d in f["distribution"]], target.multiplier)
            sql.exec(
                """INSERT INTO intel_calibrations (source, round_id, state, expected, range_lo, range_hi, reach, confidence, correction, dist, weights, comp_loss, mix_loss, cal_loss, base_loss, actual, verdict, reason, band_err, log_err, created_ms, resolved_ms)
         VALUES ('all', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                target.id, f["state"], f["expectedMultiplier"], f["rangeLo"], f["rangeHi"], f["moonshotReach"], f["confidence"], corr["value"],
                json.dumps(f["rawDistribution"], separators=(",", ":")),
                json.dumps({c["key"]: c["weight"] for c in f["intelligence"]["components"]}, separators=(",", ":")),
                json.dumps(comp_loss, separators=(",", ":")), tf(mix_loss, 5), tf(cal_loss, 5), comp_loss.get("baseline"),
                target.multiplier, s["verdict"], s["reason"], s["bandErr"], tf(s["logErr"], 5), target.tsMs, target.tsMs,
            )
            scored += 1
        if scored:
            self.intel_forecast_cache.clear()
            log.info("intel calibration: %d rounds scored (%s)", scored, "incremental" if last_row["n"] else "backtest")
        return scored

    # ------------------------------------------------------------- adapter
    @property
    def adapter(self) -> "Core":
        """The v6.4/v6.5 route modules take the CoreAdapter surface; Core provides it directly."""
        return self

    # CoreAdapter camelCase surface used by ported route modules
    def roundsFor(self, source, opts=None):  # noqa: N802
        return self.rounds_for(source, True if opts is None else opts)

    def invalidate(self):
        self.invalidate_caches()

    def setSetting(self, k, v):  # noqa: N802
        self.set_setting(k, v)

    def tableStats(self):  # noqa: N802
        return self.table_stats()

    def ingest(self, source, method, rows, origin="observed"):
        return self.ingest_rounds(source, method, rows, origin)

    def rebuildSessions(self, source):  # noqa: N802
        self.rebuild_sessions(source)

    def intel(self, rounds, source):
        return self.intel_forecast(rounds, source)

    def analysis(self, source):
        return self.analysis_payload(source)


def as_of_context(ms: int | None):
    """Bind the request's as_of (time machine) for this thread/task."""
    from contextlib import contextmanager

    @contextmanager
    def _cm():
        tok = _as_of.set(ms)
        try:
            yield
        finally:
            _as_of.reset(tok)

    return _cm()
