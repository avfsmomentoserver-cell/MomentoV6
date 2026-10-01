"""V6.4 endpoints — port of archive/backend-ts-v6.5/v64routes.ts.

Two-tier compute model: the deep tier (scheduled jobs) runs full-history scans
and persists them in deep_results; the live tier overlays the newest rounds on
the latest deep result.
"""

from __future__ import annotations

import json
import logging
import math
import re
from typing import Any

from momento import v64 as V
from momento.clock import iso, now_ms, parse_iso_ms
from momento.jsutil import js_str, jround, to_fixed

from .http import Query, Resp, fail, inum, js_number, jstr, num, ok, text_resp, truthy

log = logging.getLogger("momento.v64")

SEED_JOBS = [
    ("DNA · bands → next ≥2x", "dna", {"alphabet": "band", "kMin": 2, "kMax": 6, "targetLo": 2, "targetHi": 1e9, "minSupport": 40}, 20, 1),
    ("DNA · colours → next pink", "dna", {"alphabet": "hue", "kMin": 2, "kMax": 9, "targetLo": 10, "targetHi": 1e9, "minSupport": 40}, 20, 1),
    ("DNA · tempo → next ≥2x", "dna", {"alphabet": "tempo", "kMin": 2, "kMax": 5, "targetLo": 2, "targetHi": 1e9, "minSupport": 40}, 45, 1),
    ("Linguistics · full history", "linguistics", {"depth": 240}, 15, 1),
    ("Vocabulary · discover + evaluate", "vocabulary", {"minCount": 25}, 60, 1),
    ("Chart predictions · project + score", "shape", {"window": 30, "horizon": 20, "k": 40}, 5, 1),
    ("AI forecast summary", "ai", {}, 30, 1),
    ("Gap reconstruction", "reconstruct", {"minGapSec": 120, "maxGapHours": 8, "maxFillPerGap": 2000}, 360, 0),
]


def _dumps(v: Any) -> str:
    from momento.jsutil import dumps

    return dumps(v)


def tz(a) -> float:
    return num(a.setting("tz_offset_min"), 120, -720, 840)


def init_v64_schema(sql) -> None:
    """Tables live in storage/schema.sql; this seeds the default deep jobs."""
    now = now_ms()
    for name, kind, params, every, enabled in SEED_JOBS:
        sql.exec(
            "INSERT INTO deep_jobs (name, kind, params, every_min, enabled, created_ms) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO NOTHING",
            name, kind, _dumps(params), every, enabled, now,
        )


# ------------------------------------------------------------ round filters
def _ts_param(q: Query, k: str) -> float | None:
    v = q.get(k)
    if not v:
        return None
    n = js_number(v)
    if math.isfinite(n):
        return n if n > 1e12 else n * 1000
    return parse_iso_ms(v)


def round_filter(q: Query) -> tuple[str, list]:
    w: list[str] = []
    a: list = []
    source = q.get("source")
    if source and source != "all":
        w.append("source = ?")
        a.append(source)
    ranges = []
    for s in (x.strip() for x in (q.get("ranges") or "").split(",")):
        if not s:
            continue
        m = s.replace("+", "-", 1).split("-")
        lo = 0.0 if m[0] == "" else js_number(m[0])
        hi = 1e12 if len(m) < 2 or m[1] == "" else js_number(m[1])
        if math.isfinite(lo) and math.isfinite(hi) and hi > lo:
            ranges.append((lo, hi))
    if ranges:
        w.append("(" + " OR ".join("(multiplier >= ? AND multiplier < ?)" for _ in ranges) + ")")
        for lo, hi in ranges:
            a += [lo, hi]
    if q.get("minX"):
        w.append("multiplier >= ?")
        a.append(js_number(q.get("minX")))
    if q.get("maxX"):
        w.append("multiplier < ?")
        a.append(js_number(q.get("maxX")))
    hue = q.get("hue")
    if hue == "blue":
        w.append("multiplier < 2")
    elif hue == "purple":
        w.append("multiplier >= 2 AND multiplier < 10")
    elif hue == "pink":
        w.append("multiplier >= 10")
    ingest = q.get("ingest")
    if ingest and ingest != "all":
        w.append("ingest = ?")
        a.append(ingest)
    origin = q.get("origin")
    if origin and origin != "all":
        if origin == "real":
            w.append("origin != 'reconstructed'")
        else:
            w.append("origin = ?")
            a.append(origin)
    session = q.get("session")
    if session and session != "all":
        w.append("session_id = ?")
        a.append(js_number(session))
    frm, to = _ts_param(q, "from"), _ts_param(q, "to")
    if frm:
        w.append("ts_ms >= ?")
        a.append(frm)
    if to:
        w.append("ts_ms <= ?")
        a.append(to)
    # NaN binds as NULL in sqlite (comparison → no rows), matching D1/DO behaviour for NaN
    a = [None if isinstance(x, float) and math.isnan(x) else x for x in a]
    return ("WHERE " + " AND ".join(w) if w else ""), a


# ---------------------------------------------------------- deep execution
def latest_result(sql, job_id) -> dict | None:
    return sql.one("SELECT * FROM deep_results WHERE job_id = ? ORDER BY created_ms DESC LIMIT 1", job_id)


def dna_from_params(rounds, p: dict, cadence) -> dict:
    alphabet = p.get("alphabet") if jstr(p.get("alphabet")) in V.ALPHABETS else "band"
    lo = num(p.get("targetLo"), 2, 1, 1e9)
    hi = num(p.get("targetHi"), 1e9, lo, 1e12)
    return V.dna_scan(rounds, {
        "alphabet": alphabet,
        "kMin": inum(p.get("kMin"), 2, 1, 12),
        "kMax": inum(p.get("kMax"), 6, 1, 14),
        "target": {"lo": lo, "hi": hi, "label": f"≥{js_str(lo)}x" if hi >= 1e9 else f"{js_str(lo)}–{js_str(hi)}x"},
        "minSupport": num(p.get("minSupport"), 30, 1, 1e6),
        "pivot": num(p.get("pivot"), 2, 1.01, 1e6),
        "limit": inum(p.get("limit"), 40, 5, 200),
        "cadence": cadence,
    })


def run_job(a, job: dict) -> dict:
    started = now_ms()
    try:
        params = json.loads(job.get("params") or "{}") or {}
    except ValueError:
        params = {}
    kind = job.get("kind")
    source = params.get("source") or None
    rounds = V.apply_range(a.rounds_for(source), {k: params.get(k) for k in ("fromMs", "toMs", "minX", "maxX", "lastN")})
    cadence = V.fit_cadence(a.rounds_for(source, {"includeReconstructed": False}))
    payload: dict = {}
    status = "ok"
    try:
        if kind == "dna":
            payload = dna_from_params(rounds, params, cadence)
        elif kind == "linguistics":
            payload = V.linguistics_v2(rounds, inum(params.get("depth"), 240, 20, 2000), cadence)
        elif kind == "vocabulary":
            payload = vocabulary_cycle(a, rounds, num(params.get("minCount"), 25, 5, 10000))
        elif kind == "shape":
            payload = shape_cycle(a, source, inum(params.get("window"), 30, 8, 200), inum(params.get("horizon"), 20, 3, 200), inum(params.get("k"), 40, 5, 500))
        elif kind == "ai":
            payload = ai_summary(a, False)
        elif kind == "reconstruct":
            payload = reconstruct(a, {**params, "dryRun": False})
        else:
            status = "unknown kind"
    except Exception as e:  # job failures are reported, never raised
        log.exception("deep job %s failed", kind)
        status = "error: " + str(e)
    duration = now_ms() - started
    stats = a.table_stats()
    if status == "ok":
        a.sql.exec(
            "INSERT INTO deep_results (job_id, kind, params, payload, rounds, max_id, duration_ms, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            job.get("id"), kind, _dumps(params), _dumps(payload), len(rounds), stats["maxId"], duration, now_ms(),
        )
        if job.get("id"):
            a.sql.exec("DELETE FROM deep_results WHERE job_id = ? AND id NOT IN (SELECT id FROM deep_results WHERE job_id = ? ORDER BY created_ms DESC LIMIT 5)", job["id"], job["id"])
    if job.get("id"):
        a.sql.exec("UPDATE deep_jobs SET last_run_ms = ?, last_duration_ms = ?, last_status = ? WHERE id = ?", now_ms(), duration, status, job["id"])
    return {"status": status, "duration": duration, "kind": kind}


_deep_busy = False


def deep_tick(a) -> dict:
    global _deep_busy
    if _deep_busy:
        return {"ran": []}
    _deep_busy = True
    ran: list[str] = []
    try:
        jobs = a.sql.rows("SELECT * FROM deep_jobs WHERE enabled = 1 ORDER BY id")
        now = now_ms()
        for j in jobs:
            due = not j.get("last_run_ms") or now - j["last_run_ms"] >= j["every_min"] * 60_000
            if not due:
                continue
            if j["kind"] == "ai" and not ai_key(a):
                continue
            run_job(a, j)
            ran.append(j["name"])
    finally:
        _deep_busy = False
    return {"ran": ran}


# ----------------------------------------------------------- vocabulary v2
def vocabulary_cycle(a, rounds, min_count) -> dict:
    cands = V.discover_phrases(rounds, int(min_count))
    now = now_ms()
    updated = 0
    for c in cands:
        status = "validated" if abs(c["z"]) >= 3 and c["uses"] >= 100 else "candidate"
        res = a.sql.exec(
            """INSERT INTO vocabulary (token, layer, layers, definition, status, uses, hits, misses, score, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET definition = excluded.definition, uses = excluded.uses, hits = excluded.hits, misses = excluded.misses, score = excluded.score,
         status = CASE WHEN vocabulary.status IN ('formalized','deprecated') THEN vocabulary.status ELSE excluded.status END, updated_ms = excluded.updated_ms""",
            c["token"], c["layer"], _dumps(c["layers"]), c["definition"], status, c["uses"], c["hits"], c["misses"], c["score"], now, now,
        )
        if res.rowsWritten > 0:
            updated += 1
    return {"discovered": len(cands), "written": updated, "top": cands[:20]}


# ------------------------------------------------------------ shape ledger
def _capped_mu(rounds) -> float:
    cap = math.log(1000)
    return sum(min(math.log(max(1, r.multiplier)), cap) for r in rounds) / len(rounds)


def shape_cycle(a, source, window: int, horizon: int, k: int) -> dict:
    all_r = a.rounds_for(source)
    cadence = V.fit_cadence(a.rounds_for(source, {"includeReconstructed": False}))
    proj = V.project_shape(all_r, {"window": window, "horizon": horizon, "k": k, "cadence": cadence, "tzOffsetMin": tz(a)})
    recorded = False
    if proj:
        mu = _capped_mu(all_r)
        res = a.sql.exec(
            "INSERT OR IGNORE INTO shape_predictions (anchor_round_id, anchor_ts_ms, window, horizon, name, family, payload, mu, start_level, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            proj["anchorRoundId"], proj["anchorTsMs"], window, horizon, proj["name"], proj["family"],
            _dumps({"path": proj["path"], "baselinePath": proj["baselinePath"]}), mu, proj["currentShape"]["path"][-1], now_ms(),
        )
        recorded = res.rowsWritten > 0
    scored = score_shapes(a, all_r)
    return {"recorded": recorded, "scored": scored, "name": proj["name"] if proj else None}


def _r4(v: float) -> float:
    return jround(v * 1e4) / 1e4


def shape_gallery(all_r, follow: int) -> dict:
    cap = math.log(1000)
    L = [min(math.log(max(1, r.multiplier)), cap) for r in all_r]
    mu = sum(L) / max(1, len(L))

    def path_at(end: int, w: int) -> list:
        out = [0.0]
        for i in range(end - w + 1, end + 1):
            out.append(out[-1] + (L[i] - mu))
        return [_r4(v) for v in out]

    n = len(all_r)
    base2 = sum(1 for r in all_r if r.multiplier >= 2) / max(1, n)
    base10 = 1 - (1 - sum(1 for r in all_r if r.multiplier >= 10) / max(1, n)) ** follow
    windows = [w for w in (12, 20, 30, 50, 80) if n > w + 5]
    current = []
    for w in windows:
        p = path_at(n - 1, w)
        current.append({"window": w, **V.name_shape(p), "path": p})
    stats: dict[str, dict] = {}
    w = 30
    # prefix count of ≥10x for the "any pink within follow" check (O(1) per step)
    pre = [0]
    for r in all_r:
        pre.append(pre[-1] + (1 if r.multiplier >= 10 else 0))
    for end in range(w, n - follow - 1, 5):
        path = path_at(end, w)
        sh = V.name_shape(path)
        st = stats.get(sh["name"])
        if st is None:
            st = {**sh, "n": 0, "next2": 0, "ten": 0, "example": path}
            stats[sh["name"]] = st
        st["n"] += 1
        if all_r[end + 1].multiplier >= 2:
            st["next2"] += 1
        if pre[min(n, end + 1 + follow)] - pre[end + 1] > 0:
            st["ten"] += 1
    total = sum(s["n"] for s in stats.values()) or 1
    fams = [{
        "name": s["name"], "family": s["family"], "description": s["description"], "samples": s["n"], "share": _r4(s["n"] / total),
        "nextGe2": _r4(s["next2"] / s["n"]), "pinkWithin": _r4(s["ten"] / s["n"]),
        "liftGe2": jround((s["next2"] / s["n"] / max(1e-9, base2)) * 100) / 100, "liftPink": jround((s["ten"] / s["n"] / max(1e-9, base10)) * 100) / 100,
        "example": s["example"],
    } for s in stats.values()]
    fams.sort(key=lambda x: -x["samples"])
    return {"current": current, "families": fams, "base": {"ge2": _r4(base2), "pinkWithin": _r4(base10), "follow": follow}, "sampledWindow": w, "analysed": n}


def score_shapes(a, all_r) -> int:
    pending = a.sql.rows("SELECT * FROM shape_predictions WHERE resolved_ms IS NULL ORDER BY anchor_ts_ms ASC LIMIT 200")
    if not pending:
        return 0
    index = {r.id: i for i, r in enumerate(all_r)}
    scored = 0
    for p in pending:
        idx = index.get(p["anchor_round_id"])
        if idx is None:
            continue
        h = p["horizon"]
        after = [r for r in all_r[idx + 1: idx + 1 + h] if r.origin != "reconstructed"]
        if len(after) < h:
            continue
        stored = json.loads(p["payload"])
        s = V.score_projection(stored, after, p["mu"], p["start_level"])
        if not s:
            continue
        a.sql.exec(
            "UPDATE shape_predictions SET resolved_ms = ?, mae_model = ?, mae_base = ?, skill = ?, coverage = ?, payload = ? WHERE id = ?",
            now_ms(), s["maeModel"], s["maeBase"], s["skill"], s["iqrCoverage"], _dumps({**stored, "actual": s["actual"]}), p["id"],
        )
        scored += 1
    return scored


def shape_ledger(a) -> dict:
    rows = a.sql.rows("SELECT id, anchor_ts_ms, window, horizon, name, family, resolved_ms, mae_model, mae_base, skill, coverage FROM shape_predictions ORDER BY anchor_ts_ms DESC LIMIT 200")
    res = [r for r in rows if r["resolved_ms"]]

    def mean(k):
        return sum(r[k] for r in res) / len(res) if res else None

    by: dict[str, dict] = {}
    for r in res:
        b = by.setdefault(r["name"], {"n": 0, "skill": 0.0})
        b["n"] += 1
        b["skill"] += r["skill"]
    mm, mb = mean("mae_model"), mean("mae_base")
    return {
        "total": len(rows),
        "resolved": len(res),
        "pending": len(rows) - len(res),
        "maeModel": mm,
        "maeBase": mb,
        "skill": 1 - mm / mb if mm is not None and mb else None,
        "coverage": mean("coverage"),
        "byName": sorted(({"name": k, "n": v["n"], "skill": v["skill"] / v["n"]} for k, v in by.items()), key=lambda x: -x["n"]),
        "recent": rows[:40],
    }


# --------------------------------------------------------- reconstruction
def cap_lookup(a, source):
    rows = a.sql.rows(
        f"SELECT scope, scope_key, MIN(multiplier) AS floor, COUNT(*) AS n FROM top_rounds WHERE scope IN ('day','month','year') {'AND source = ?' if source else ''} GROUP BY scope, scope_key",
        *([source] if source else []),
    )
    m = {f"{r['scope']}:{r['scope_key']}": r["floor"] for r in rows if r["n"] >= 10}
    offset = tz(a)

    def caps(ts):
        vals = [m[k] for k in (f"{s}:{V.scope_key(s, ts, offset)}" for s in ("day", "month", "year")) if k in m]
        return min(vals) if vals else None

    return caps


def reconstruct(a, p: dict) -> dict:
    if truthy(p.get("source")) and p.get("source") != "all":
        sources = [jstr(p["source"])]
    else:
        sources = [r["source"] for r in a.sql.rows("SELECT DISTINCT source FROM rounds WHERE origin != 'reconstructed'")]
    report = []
    inserted = 0
    anchors_placed = 0
    dry = truthy(p.get("dryRun"))
    for src in sources:
        observed = [r for r in a.rounds_for(src, {"includeReconstructed": False}) if r.origin != "anchor"]
        anchors = a.sql.rows("SELECT ts_ms AS tsMs, multiplier FROM rounds WHERE source = ? AND origin = 'anchor'", src)
        plan = V.plan_reconstruction(observed, anchors, cap_lookup(a, src), {
            "minGapSec": num(p.get("minGapSec"), 120, 30, 86_400),
            "maxGapHours": num(p.get("maxGapHours"), 8, 0.1, 240),
            "maxFillPerGap": inum(p.get("maxFillPerGap"), 2000, 1, 20_000),
            "seed": inum(p.get("seed"), 20260926, 0, 2**31),
            "fromMs": p.get("fromMs"),
            "toMs": p.get("toMs"),
        })
        fills = [r for r in plan["rounds"] if r["origin"] == "reconstructed"]
        if not dry and fills:
            with a.sql.transaction():
                a.sql.exec("DELETE FROM rounds WHERE source = ? AND origin = 'reconstructed'", src)
                now = now_ms()
                for r in fills:
                    res = a.sql.exec(
                        "INSERT OR IGNORE INTO rounds (ts, ts_ms, multiplier, color, source, session_id, ingest, created_ms, origin) VALUES (?, ?, ?, ?, ?, NULL, 'reconstruct', ?, 'reconstructed')",
                        iso(r["tsMs"]), r["tsMs"], r["multiplier"], V.hue_of(r["multiplier"]), src, now,
                    )
                    inserted += res.rowsWritten
        placed = sum(g["anchors"] for g in plan["gaps"])
        anchors_placed += placed
        report.append({
            "source": src, "cadence": plan["cadence"], "gaps": len(plan["gaps"]), "fills": len(fills), "anchors": placed,
            "largest": sorted(plan["gaps"], key=lambda g: -g["gapSec"])[:25],
        })
    if not dry:
        a.invalidate()
    return {"dryRun": dry, "inserted": inserted, "anchorsPlaced": anchors_placed, "sources": report}


# ------------------------------------------------------------- AI summary
def ai_key(a) -> str | None:
    return (a.env or {}).get("ENTRIM_API_KEY") or a.setting("entrim_api_key") or None


def metrics_bundle(a) -> dict:
    all_r = a.rounds_for(None)
    real = a.rounds_for(None, {"includeReconstructed": False})
    cadence = V.fit_cadence(real)
    intel = a.intel(all_r, "all") if all_r else {}
    intelligence = intel.get("intelligence") or {}
    analysis = a.analysis(None)
    proj = V.project_shape(all_r, {"window": 30, "horizon": 20, "k": 40, "cadence": cadence, "tzOffsetMin": tz(a)})
    ling = V.linguistics_v2(all_r[-5000:], 40, cadence)
    dna = V.dna_scan(all_r[-20000:], {"alphabet": "hue", "kMin": 2, "kMax": 7, "target": {"lo": 10, "hi": 1e9, "label": "≥10x"}, "minSupport": 40, "limit": 5})
    ledger = shape_ledger(a)
    recon = [{"origin": r["origin"], "n": r["n"]} for r in a.sql.rows("SELECT origin, COUNT(*) AS n FROM rounds GROUP BY origin")]
    pressure = analysis.get("pressure")
    return {
        "generatedAt": iso(),
        "rounds": {"total": len(all_r), "real": len(real), "byOrigin": recon, "last20": [r.multiplier for r in all_r[-20:]]},
        "nextRound": {
            "state": intel.get("state"),
            "expected": intel.get("expectedMultiplier"),
            "range": [intel.get("rangeLo"), intel.get("rangeHi")],
            "reach": intel.get("moonshotReach"),
            "confidence": intel.get("confidence"),
            "confidenceLabel": intel.get("confidenceLabel"),
            "candidates": (intel.get("candidates") or [])[:3],
            "skillPctVsBaseline": intelligence.get("skillPct"),
            "calibratedHitRate": intelligence.get("calibratedHitRate"),
            "calibrationSample": intelligence.get("calibrationSample"),
            "independence": intelligence.get("independence"),
            "engines": [{"key": c["key"], "weight": c["weight"]} for c in intelligence.get("components") or []],
        },
        "shape": {"projected": proj["name"], "current": proj["currentShape"]["name"], "drift": proj["drift"], "confidence": proj["confidence"], "etas": proj["etas"], "first5": proj["rounds"][:5]} if proj else None,
        "shapeLedger": {"resolved": ledger["resolved"], "skill": ledger["skill"], "coverage": ledger["coverage"]},
        "dna": {"verdict": dna["verdict"], "significant": dna["significant"], "expectedFalsePositives": dna["expectedFalsePositives"],
                "live": [{"k": l["k"], "pattern": l["pattern"], "n": l["n"], "rate": l["rate"], "base": l["base"], "z": l["z"]} for l in dna["live"]]},
        "linguistics": {"narrative": ling["narrative"], "currentSentenceLength": len(ling["sentences"]["current"]), "expectedSentenceLength": ling["sentences"]["expectedLength"],
                        "entropyBits": ling["entropyBits"], "maxEntropyBits": ling["maxEntropyBits"]},
        "pressure": {"overall": pressure.get("overallPressure"), "state": pressure.get("state")} if pressure else None,
        "moonshot": analysis.get("moonshot"),
    }


SYSTEM_PROMPT = (
    "You are the forecast analyst for Momento, a research console for Spribe Aviator crash-game rounds (a provably-fair RNG). "
    "Write a concise, decision-ready summary of the next-round outlook from the metrics JSON. Rules: "
    "1) First line: a single headline sentence (no markdown symbols) stating state, expected multiplier, range and confidence. "
    "2) Then markdown sections: '### Next round', '### Shape & timing', '### Pattern & language evidence', '### Reliability', '### Bottom line'. "
    "3) Quote the numbers exactly as given; never invent metrics. 4) Always compare to baseline and say plainly when skill vs baseline is ~0 — the game is RNG and nothing guarantees an outcome. "
    "5) Mention reconstructed-round share if non-zero. ETA 'eta' strings are already in the operator's local clock — copy them verbatim, never convert time zones. 6) Under 320 words. No financial advice, no betting instructions."
)


def ai_summary(a, force: bool) -> dict:
    stats = a.table_stats()
    last = a.sql.one("SELECT * FROM ai_summaries WHERE status = 'ok' ORDER BY created_ms DESC LIMIT 1")
    if not force and last and last["max_id"] == stats["maxId"]:
        return {"cached": True, **format_summary(last)}
    key = ai_key(a)
    metrics = metrics_bundle(a)
    model = a.setting("entrim_model") or "deepseek-ai/DeepSeek-V4-Flash"
    base = re.sub(r"/+$", "", a.setting("entrim_base_url") or "https://api.entrim.ai/v1")
    started = now_ms()
    status = "ok"
    if not key:
        status = "no-key"
        content = fallback_summary(metrics)
    else:
        try:
            import httpx

            res = httpx.post(
                f"{base}/chat/completions",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                content=_dumps({"model": model, "temperature": 0.3, "max_tokens": 1600, "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": "Metrics JSON:\n" + _dumps(metrics)},
                ]}),
                timeout=75.0,
            )
            try:
                body = res.json()
            except ValueError:
                body = {}
            content = (((body.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
            if res.status_code >= 400 or not content:
                status = "error"
                content = fallback_summary(metrics) + f"\n\n> AI provider error: {(body.get('error') or {}).get('message') or res.status_code}"
        except Exception as e:
            status = "error"
            content = fallback_summary(metrics) + f"\n\n> AI provider unreachable: {e}"
    headline = ""
    for line in content.split("\n"):
        if line.strip():
            headline = re.sub(r"^#+\s*", "", line).replace("**", "").strip()
            break
    a.sql.exec(
        "INSERT INTO ai_summaries (model, max_id, rounds, headline, content, metrics, duration_ms, status, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        model if key else "deterministic", stats["maxId"], stats["count"], headline, content, _dumps(metrics), now_ms() - started, status, now_ms(),
    )
    a.sql.exec("DELETE FROM ai_summaries WHERE id NOT IN (SELECT id FROM ai_summaries ORDER BY created_ms DESC LIMIT 50)")
    row = a.sql.one("SELECT * FROM ai_summaries ORDER BY id DESC LIMIT 1")
    return {"cached": False, **format_summary(row)}


def format_summary(r: dict) -> dict:
    return {
        "id": r["id"], "model": r["model"], "status": r["status"], "headline": r["headline"], "content": r["content"],
        "metrics": json.loads(r.get("metrics") or "{}"), "maxId": r["max_id"], "rounds": r["rounds"], "durationMs": r["duration_ms"],
        "createdAt": iso(r["created_ms"]),
    }


def fallback_summary(m: dict) -> str:
    nr = m["nextRound"]

    def fx(v):
        return f"{to_fixed(v, 2)}x" if isinstance(v, (int, float)) and not isinstance(v, bool) else "—"

    rng = nr["range"]
    shape = m["shape"]
    sl = m["shapeLedger"]["skill"]
    return "\n".join([
        f"{nr['state'] if nr['state'] is not None else '—'} · expected {fx(nr['expected'])} · range {fx(rng[0])}–{fx(rng[1])} · {nr['confidenceLabel'] or ''} confidence",
        "### Next round",
        f"Full-intelligence state **{jstr(nr['state']) if nr['state'] is not None else 'undefined'}**, expected **{fx(nr['expected'])}**, range {fx(rng[0])}–{fx(rng[1])}, reach {fx(nr['reach'])}.",
        "### Shape & timing",
        f"Current shape **{shape['current']}** → projected **{shape['projected']}** (drift {jstr(shape['drift'])}, confidence {to_fixed(shape['confidence'] * 100, 0)}%)." if shape else "Not enough rounds for a shape projection.",
        "### Pattern & language evidence",
        f"{m['dna']['verdict']} {m['linguistics']['narrative']}",
        "### Reliability",
        f"Skill vs baseline: {jstr(nr['skillPctVsBaseline']) if nr['skillPctVsBaseline'] is not None else '—'}% over {jstr(nr['calibrationSample'] or 0)} scored rounds. Shape-ledger skill: {'pending' if sl is None else to_fixed(sl * 100, 1) + '%'}.",
        "### Bottom line",
        "Aviator is a provably-fair RNG; treat every forecast as a calibrated description of odds, not a guarantee.",
        "",
        "_(Deterministic summary — set ENTRIM_API_KEY to enable the AI analyst.)_",
    ])


# ------------------------------------------------------------------ router
def _csv_cell(v: Any) -> str:
    if v is None:
        return ""
    return jstr(v)


def route_v64(a, method: str, path: str, q: Query, body: dict) -> Resp | None:
    sql = a.sql

    if path == "/api/v1/live/pulse" and method == "GET":
        stats = a.table_stats()
        last = sql.one("SELECT id, ts, multiplier, source, origin FROM rounds WHERE origin != 'reconstructed' ORDER BY ts_ms DESC LIMIT 1")
        t = sql.scalar("SELECT MAX(last_run_ms) AS t FROM deep_jobs")
        return ok({"maxId": stats["maxId"], "count": stats["count"], "last": last, "deepRunMs": t, "serverTime": now_ms()})

    if path == "/api/v1/rounds/page" and method == "GET":
        where, args = round_filter(q)
        page_size = inum(q.get("pageSize"), 500, 10, 2000)
        page = inum(q.get("page"), 1, 1, 1e7)
        order = "ASC" if q.get("order") == "asc" else "DESC"
        sort = "multiplier" if q.get("sort") == "multiplier" else "ts_ms"
        agg = sql.one(
            f"""SELECT COUNT(*) AS n, AVG(MIN(multiplier, 1000)) AS avgCapped, MAX(multiplier) AS max, MIN(multiplier) AS min,
         SUM(CASE WHEN multiplier < 2 THEN 1 ELSE 0 END) AS blue,
         SUM(CASE WHEN multiplier >= 2 AND multiplier < 10 THEN 1 ELSE 0 END) AS purple,
         SUM(CASE WHEN multiplier >= 10 THEN 1 ELSE 0 END) AS pink,
         SUM(CASE WHEN origin = 'reconstructed' THEN 1 ELSE 0 END) AS reconstructed,
         SUM(CASE WHEN origin = 'anchor' THEN 1 ELSE 0 END) AS anchors,
         MIN(ts_ms) AS firstMs, MAX(ts_ms) AS lastMs
       FROM rounds {where}""", *args)
        rows = sql.rows(f"SELECT id, ts, ts_ms, multiplier, color, source, session_id, ingest, origin FROM rounds {where} ORDER BY {sort} {order}, id {order} LIMIT ? OFFSET ?", *args, page_size, (page - 1) * page_size)
        ingests = sql.rows(f"SELECT ingest, COUNT(*) AS n FROM rounds {where} GROUP BY ingest ORDER BY n DESC", *args)
        total = sql.scalar("SELECT COUNT(*) AS n FROM rounds", default=0)
        return ok({"rounds": rows, "page": page, "pageSize": page_size, "pages": max(1, math.ceil(agg["n"] / page_size)), "filtered": agg["n"], "total": total, "stats": agg, "ingests": ingests})

    if path == "/api/v1/rounds/export" and method == "GET":
        where, args = round_filter(q)
        fmt = "json" if q.get("format") == "json" else "csv"
        limit = inum(q.get("limit"), 250_000, 1, 1_000_000)
        rows = sql.rows(f"SELECT id, ts, multiplier, source, session_id, ingest, origin FROM rounds {where} ORDER BY ts_ms ASC LIMIT ?", *args, limit)
        stamp = re.sub(r"[:T]", "-", iso()[:19])
        if fmt == "json":
            return text_resp(_dumps([{**r, "hue": V.hue_of(r["multiplier"])} for r in rows]), "application/json",
                             headers={"content-disposition": f'attachment; filename="momento-rounds-{stamp}.json"'})
        lines = ["id,timestamp,multiplier,hue,source,session_id,ingest,origin"]
        for r in rows:
            lines.append(",".join(_csv_cell(x) for x in (r["id"], r["ts"], r["multiplier"], V.hue_of(r["multiplier"]), r["source"], r["session_id"], r["ingest"], r["origin"])))
        return text_resp("\n".join(lines), "text/csv; charset=utf-8", headers={"content-disposition": f'attachment; filename="momento-rounds-{stamp}.csv"'})

    if path == "/api/v1/seed/top-rounds" and method == "POST":
        source = jstr(body.get("source") if body.get("source") is not None else "aviator").strip() or "aviator"
        tz_min = num(body.get("tzOffsetMin"), tz(a), -720, 840)
        src_text = body.get("html") if body.get("html") is not None else body.get("text")
        parsed = V.parse_top_rounds(jstr(src_text) if src_text is not None else "", tz_min)
        if truthy(body.get("scope")) and jstr(body.get("scope")) in ("day", "month", "year"):
            for r in parsed["rows"]:
                r["scope"] = body["scope"]
        if truthy(body.get("dryRun")):
            return ok({**parsed, "rows": [{**r, "ts": iso(r["tsMs"])} for r in parsed["rows"]]})
        stored = anchored = matched = 0
        now = now_ms()
        with sql.transaction():
            for r in parsed["rows"]:
                key = V.scope_key(r["scope"], r["tsMs"], tz_min)
                ts_iso = iso(r["tsMs"])
                if not sql.one("SELECT id FROM top_rounds WHERE source = ? AND scope = ? AND scope_key = ? AND ABS(multiplier - ?) < 0.005 AND ts = ?", source, r["scope"], key, r["multiplier"], ts_iso):
                    sql.exec("INSERT INTO top_rounds (source, scope, scope_key, round_id, ts, multiplier, color) VALUES (?, ?, ?, NULL, ?, ?, 'pink')", source, r["scope"], key, ts_iso, r["multiplier"])
                    stored += 1
                if not re.search("rounds", r["metric"], re.I) or body.get("anchor") is False:
                    continue
                hit = sql.one("SELECT id FROM rounds WHERE source = ? AND ABS(multiplier - ?) < 0.006 AND ts_ms BETWEEN ? AND ?", source, r["multiplier"], r["tsMs"] - 90_000, r["tsMs"] + 150_000)
                if hit:
                    matched += 1
                    sql.exec("UPDATE top_rounds SET round_id = ? WHERE source = ? AND scope = ? AND ABS(multiplier - ?) < 0.005 AND round_id IS NULL", hit["id"], source, r["scope"], r["multiplier"])
                    continue
                ts = r["tsMs"] + 30_000
                res = sql.exec(
                    "INSERT OR IGNORE INTO rounds (ts, ts_ms, multiplier, color, source, session_id, ingest, created_ms, origin) VALUES (?, ?, ?, 'pink', ?, NULL, 'top-rounds', ?, 'anchor')",
                    iso(ts), ts, r["multiplier"], source, now,
                )
                anchored += res.rowsWritten
        a.invalidate()
        a.audit("seeder", "seed.top_rounds", source, {"rows": len(parsed["rows"]), "stored": stored, "anchored": anchored, "matched": matched})
        return ok({"source": source, "blocks": parsed["blocks"], "warnings": parsed["warnings"], "parsed": len(parsed["rows"]), "stored": stored, "anchored": anchored, "matched": matched})

    if path == "/api/v1/seed/span" and method == "POST":
        source = jstr(body.get("source") if body.get("source") is not None else "aviator").strip() or "aviator"
        if isinstance(body.get("multipliers"), list):
            raw = [js_number(v) for v in body["multipliers"]]
        else:
            txt = jstr(body.get("text")) if body.get("text") is not None else ""
            raw = [js_number(re.sub(r"x$", "", s, flags=re.I)) for s in re.split(r"[\s,;]+", txt)]
        mults = [v for v in raw if math.isfinite(v) and v >= 1]
        if body.get("order") != "oldest-first":
            mults.reverse()
        start = parse_iso_ms(jstr(body.get("start")) if body.get("start") is not None else "")
        end = parse_iso_ms(jstr(body.get("end")) if body.get("end") is not None else "")
        if not mults:
            return fail("no multipliers found")
        if start is None or end is None or end <= start:
            return fail("valid start < end timestamps required")
        cadence = V.fit_cadence(a.rounds_for(source, {"includeReconstructed": False}))
        spread = V.spread_span(mults, start, end, cadence)
        if truthy(body.get("dryRun")):
            return ok({"source": source, "rounds": [{**r, "ts": iso(r["tsMs"])} for r in spread], "cadence": cadence})
        res = a.ingest(source, "seed-span", [{"timestamp": r["tsMs"], "multiplier": r["multiplier"]} for r in spread], "seeded")
        a.rebuild_sessions(source)
        return ok({"source": source, **res, "cadence": cadence, "first": iso(spread[0]["tsMs"]), "last": iso(spread[-1]["tsMs"])})

    if path == "/api/v1/seed/prime" and method == "POST":
        sources = [r["source"] for r in sql.rows("SELECT DISTINCT source FROM rounds")]
        for s in sources:
            a.rebuild_sessions(s)
        a.invalidate()
        ran = []
        for j in sql.rows("SELECT * FROM deep_jobs WHERE enabled = 1 AND kind IN ('dna','linguistics','vocabulary','shape')"):
            run_job(a, j)
            ran.append(j["name"])
        return ok({"sources": sources, "sessionsRebuilt": len(sources), "jobs": ran})

    if path == "/api/v1/reconstruct/plan" and method == "GET":
        return ok(reconstruct(a, {"source": q.get("source"), "minGapSec": q.get("minGapSec"), "maxGapHours": q.get("maxGapHours"), "maxFillPerGap": q.get("maxFillPerGap"), "dryRun": True}))
    if path == "/api/v1/reconstruct/run" and method == "POST":
        res = reconstruct(a, {**body, "dryRun": False})
        a.audit("reconstructor", "reconstruct.run", jstr(body.get("source") if body.get("source") is not None else "all"), {"inserted": res["inserted"]})
        return ok(res)
    if path == "/api/v1/reconstruct/clear" and method == "POST":
        src = jstr(body["source"]) if truthy(body.get("source")) and body.get("source") != "all" else None
        res = sql.exec("DELETE FROM rounds WHERE origin = 'reconstructed' AND source = ?", src) if src else sql.exec("DELETE FROM rounds WHERE origin = 'reconstructed'")
        a.invalidate()
        return ok({"removed": res.rowsWritten})
    if path == "/api/v1/reconstruct/config" and method == "POST":
        u = body.get("useInForecast")
        a.set_setting("reconstruct_in_forecast", "0" if (u is False or (u == 0 and not isinstance(u, bool) and isinstance(u, (int, float))) or u == "0") else "1")
        a.invalidate()
        return ok({"useInForecast": a.setting("reconstruct_in_forecast") != "0"})
    if path == "/api/v1/reconstruct/status" and method == "GET":
        rows = sql.rows("SELECT source, origin, COUNT(*) AS n FROM rounds GROUP BY source, origin ORDER BY source")
        return ok({"byOrigin": rows, "useInForecast": a.setting("reconstruct_in_forecast") != "0"})

    if path == "/api/v1/dna/scan" and method == "GET":
        rounds = V.apply_range(a.rounds_for(q.get("source")), V.range_from_query(q))
        cadence = V.fit_cadence(a.rounds_for(q.get("source"), {"includeReconstructed": False}))
        scan = dna_from_params(rounds, q.to_dict(), cadence)
        rest = {k: v for k, v in scan.items() if k != "table"}
        return ok({**rest, "alphabets": V.ALPHABETS, "layer": "on-demand"})
    if path == "/api/v1/dna/live" and method == "GET":
        jobs = sql.rows("SELECT * FROM deep_jobs WHERE kind = 'dna' ORDER BY id")
        all_r = a.rounds_for(None)
        cadence = V.fit_cadence(a.rounds_for(None, {"includeReconstructed": False}))
        stats = a.table_stats()
        out = []
        for j in jobs:
            r = latest_result(sql, j["id"])
            if not r:
                out.append({"job": {"id": j["id"], "name": j["name"], "every": j["every_min"]}, "result": None})
                continue
            scan = json.loads(r["payload"])
            overlay = V.dna_overlay(all_r, {"alphabet": scan["alphabet"], "kRange": scan["kRange"], "baseRate": scan["baseRate"], "table": scan["table"]}, cadence)
            rest = {k: v for k, v in scan.items() if k != "table"}
            out.append({
                "job": {"id": j["id"], "name": j["name"], "every": j["every_min"], "lastRunMs": j["last_run_ms"]},
                "result": {**rest, "computedAt": iso(r["created_ms"]), "roundsAtCompute": r["rounds"], "newSinceCompute": max(0, stats["maxId"] - r["max_id"])},
                "overlay": overlay,
            })
        return ok({"scans": out, "layer": "deep + live overlay"})

    if path == "/api/v1/linguistics/v2" and method == "GET":
        rounds = V.apply_range(a.rounds_for(q.get("source")), V.range_from_query(q))
        cadence = V.fit_cadence(a.rounds_for(q.get("source"), {"includeReconstructed": False}))
        return ok(V.linguistics_v2(rounds, inum(q.get("depth"), 240, 20, 2000), cadence))

    if path == "/api/v1/investigate/round" and method == "GET":
        all_r = a.rounds_for(q.get("source"))
        idx = -1
        if q.get("id"):
            want = js_number(q.get("id"))
            idx = next((i for i, r in enumerate(all_r) if r.id == want), -1)
        elif q.get("ts"):
            t = parse_iso_ms(q.get("ts"))
            if t is not None:
                best = math.inf
                for i, r in enumerate(all_r):
                    d = abs(r.tsMs - t)
                    if d < best:
                        best, idx = d, i
        else:
            idx = len(all_r) - 1
        if idx < 0:
            return fail("round not found", 404)
        calib = sql.one("SELECT state, expected, range_lo, range_hi, confidence, verdict, reason, comp_loss, weights FROM intel_calibrations WHERE round_id = ? LIMIT 1", all_r[idx].id)
        cadence = V.fit_cadence(a.rounds_for(all_r[idx].source, {"includeReconstructed": False}))
        return ok(V.investigate_round(all_r, idx, calib, cadence, inum(q.get("radius"), 30, 5, 200)))
    if path == "/api/v1/investigate/range" and method == "GET":
        all_r = a.rounds_for(q.get("source"))
        return ok(V.investigate_range(all_r, V.apply_range(all_r, V.range_from_query(q))))
    if path == "/api/v1/investigate/gaps" and method == "GET":
        real = a.rounds_for(q.get("source"), {"includeReconstructed": False})
        cadence = V.fit_cadence(real)
        per: dict[str, dict] = {}
        for src in dict.fromkeys(r.source for r in real):
            per[src] = V.fit_cadence([r for r in real if r.source == src])
        min_gap = num(q.get("minGapSec"), 120, 10, 1e7) * 1000
        gaps = []
        for i in range(1, len(real)):
            if real[i].source != real[i - 1].source:
                continue
            d = real[i].tsMs - real[i - 1].tsMs
            if d >= min_gap:
                med = (per.get(real[i].source) or cadence)["medianMs"]
                gaps.append({"source": real[i].source, "afterId": real[i - 1].id, "startMs": real[i - 1].tsMs, "endMs": real[i].tsMs, "gapSec": jround(d / 1000), "estMissing": max(0, jround(d / max(1, med)) - 1)})
        gaps.sort(key=lambda g: -g["gapSec"])
        return ok({"cadence": cadence, "perSource": per, "count": len(gaps), "totalMissing": sum(g["estMissing"] for g in gaps), "gaps": gaps[: inum(q.get("limit"), 200, 1, 5000)]})

    if path == "/api/v1/shapes/project" and method == "GET":
        all_r = V.apply_range(a.rounds_for(q.get("source")), V.range_from_query(q))
        cadence = V.fit_cadence(a.rounds_for(q.get("source"), {"includeReconstructed": False}))
        window = inum(q.get("window"), 30, 8, 200)
        horizon = inum(q.get("horizon"), 20, 3, 200)
        proj = V.project_shape(all_r, {"window": window, "horizon": horizon, "k": inum(q.get("k"), 40, 5, 500), "cadence": cadence, "tzOffsetMin": tz(a)})
        if not proj:
            return fail("not enough rounds for this window/horizon", 422)
        tail = [{"id": r.id, "tsMs": r.tsMs, "multiplier": r.multiplier, "origin": r.origin or "observed"} for r in all_r[-max(window * 4, 120):]]
        return ok({**proj, "cadence": cadence, "tail": tail, "ledger": shape_ledger(a)})
    if path == "/api/v1/shapes/ledger" and method == "GET":
        return ok(shape_ledger(a))
    if path == "/api/v1/shapes/backtest" and method == "GET":
        all_r = a.rounds_for(q.get("source"), {"includeReconstructed": False})
        W = inum(q.get("window"), 30, 8, 200)
        H = inum(q.get("horizon"), 20, 3, 100)
        n = inum(q.get("n"), 40, 5, 200)
        cadence = V.fit_cadence(all_r)
        step = max(H, (len(all_r) - 2000 - H) // n)
        cap = math.log(1000)
        # prefix sums of the capped log so each anchor's mu is O(1)
        pre = [0.0]
        for r in all_r:
            pre.append(pre[-1] + min(math.log(max(1, r.multiplier)), cap))
        rows = []
        end = len(all_r) - H - 1
        while end > 2000 and len(rows) < n:
            hist = all_r[: end + 1]
            proj = V.project_shape(hist, {"window": W, "horizon": H, "k": 40, "cadence": cadence, "tzOffsetMin": tz(a)})
            if proj:
                mu = pre[end + 1] / len(hist)
                sc = V.score_projection({"path": proj["path"], "baselinePath": proj["baselinePath"]}, all_r[end + 1: end + 1 + H], mu, proj["currentShape"]["path"][-1])
                if sc:
                    rows.append({"anchorId": all_r[end].id, "name": proj["name"], "skill": sc["skill"], "maeModel": sc["maeModel"], "maeBase": sc["maeBase"], "coverage": sc["iqrCoverage"]})
            end -= step

        def mean(k):
            return jround((sum(r[k] for r in rows) / len(rows)) * 1e4) / 1e4 if rows else None

        mm, mb = mean("maeModel"), mean("maeBase")
        return ok({
            "n": len(rows), "window": W, "horizon": H, "maeModel": mm, "maeBase": mb,
            "skill": jround((1 - mm / mb) * 1e4) / 1e4 if mm is not None and mb else None,
            "coverage": mean("coverage"),
            "wins": sum(1 for r in rows if r["maeModel"] < r["maeBase"]),
            "rows": list(reversed(rows)),
            "note": "Walk-forward: each projection uses only rounds before its anchor. Skill = 1 − MAE(model)/MAE(flat baseline); IQR coverage ≈ 50% means well-calibrated fans.",
        })
    if path == "/api/v1/shapes/gallery" and method == "GET":
        return ok(shape_gallery(a.rounds_for(q.get("source")), inum(q.get("follow"), 10, 3, 100)))

    if path == "/api/v1/deep/jobs" and method == "GET":
        jobs = sql.rows("SELECT * FROM deep_jobs ORDER BY id")
        return ok({
            "jobs": [{**j, "params": json.loads(j["params"]), "nextRunMs": j["last_run_ms"] + j["every_min"] * 60_000 if j["last_run_ms"] else now_ms()} for j in jobs],
            "aiConfigured": bool(ai_key(a)),
        })
    if path == "/api/v1/deep/jobs" and method in ("POST", "PUT"):
        now = now_ms()
        if truthy(body.get("id")):
            sql.exec(
                "UPDATE deep_jobs SET name = COALESCE(?, name), params = COALESCE(?, params), every_min = COALESCE(?, every_min), enabled = COALESCE(?, enabled) WHERE id = ?",
                body.get("name"), _dumps(body["params"]) if truthy(body.get("params")) else None,
                inum(body.get("every_min"), 30, 1, 10_080) if "every_min" in body else None,
                (1 if truthy(body.get("enabled")) else 0) if "enabled" in body else None, body["id"],
            )
            return ok({"id": body["id"]})
        if not truthy(body.get("name")) or not truthy(body.get("kind")):
            return fail("name and kind required")
        sql.exec("INSERT INTO deep_jobs (name, kind, params, every_min, enabled, created_ms) VALUES (?, ?, ?, ?, 1, ?)", jstr(body["name"]), jstr(body["kind"]), _dumps(body.get("params") or {}), inum(body.get("every_min"), 30, 1, 10_080), now)
        return ok({"created": True})
    if path == "/api/v1/deep/jobs/delete" and method == "POST":
        jid = js_number(body.get("id"))
        sql.exec("DELETE FROM deep_jobs WHERE id = ?", jid)
        sql.exec("DELETE FROM deep_results WHERE job_id = ?", jid)
        return ok({"deleted": body.get("id")})
    if path == "/api/v1/deep/run" and method == "POST":
        if truthy(body.get("id")):
            job = sql.one("SELECT * FROM deep_jobs WHERE id = ?", js_number(body["id"]))
            if not job:
                return fail("job not found", 404)
            return ok(run_job(a, job))
        return ok(deep_tick(a))
    if path == "/api/v1/deep/result" and method == "GET":
        r = latest_result(sql, js_number(q.get("job")))
        if not r:
            return ok({"result": None})
        payload = json.loads(r["payload"])
        if isinstance(payload, dict):
            payload.pop("table", None)
        return ok({"result": {**r, "payload": payload}})

    if path == "/api/v1/ai/summary" and method == "GET":
        r = sql.one("SELECT * FROM ai_summaries ORDER BY created_ms DESC LIMIT 1")
        stats = a.table_stats()
        return ok({"summary": format_summary(r) if r else None, "configured": bool(ai_key(a)), "roundsSince": max(0, stats["maxId"] - r["max_id"]) if r else None})
    if path == "/api/v1/ai/summary" and method == "POST":
        return ok({"summary": ai_summary(a, truthy(body.get("force"))), "configured": bool(ai_key(a))})
    if path == "/api/v1/ai/metrics" and method == "GET":
        return ok(metrics_bundle(a))
    return None
