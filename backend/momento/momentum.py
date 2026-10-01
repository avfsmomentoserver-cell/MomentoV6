"""Momentum & Structure engines — port of momentum.ts (v6.2).

hitPoints, anchors, rangeMomentum, moonshot (research), rangeForecast,
invertedForecast and assessLive. Pure: rounds in, metrics out.
"""

from __future__ import annotations

import bisect
import dataclasses
import math

from .clock import now_iso, now_ms
from .jsutil import jround, jsum, tf
from .pipeline import WINDOWS, expected_rounds, per_round_probability, window_probability


def _clamp(v, lo, hi):
    return min(hi, max(lo, v))


def _r2(v):
    return tf(v, 2)


def _r3(v):
    return tf(v, 3)


def _r4(v):
    return tf(v, 4)


def _r5(v):
    return tf(v, 5)


def _mean(xs):
    return jsum(xs) / len(xs) if xs else 0


def _median(xs):
    if not xs:
        return 0
    s = sorted(xs)
    return s[len(s) // 2]


def _quantile(xs, q):
    if not xs:
        return 0
    s = sorted(xs)
    return s[int(_clamp(math.floor(q * len(s)), 0, len(s) - 1))]


MEGA_MIN = 10


def hit_points(rounds, bucket_ms: int = 300_000) -> list:
    cells: dict[int, dict] = {}

    def ensure(t):
        c = cells.get(t)
        if c is None:
            c = {"mults": [], "energy": 0, "mega": 0}
            cells[t] = c
        return c

    for r in rounds:
        b = math.floor(r.tsMs / bucket_ms) * bucket_ms
        cell = ensure(b)
        cell["mults"].append(r.multiplier)
        span = int(_clamp(math.ceil(r.multiplier / MEGA_MIN), 1, 4)) if r.multiplier >= MEGA_MIN else 1
        share = r.multiplier / span
        cell["energy"] += share
        if span > 1:
            cell["mega"] += 1
        for k in range(1, span):
            ensure(b + k * bucket_ms)["energy"] += share
    out = []
    for t in sorted(cells):
        c = cells[t]
        ms = c["mults"]
        out.append({
            "t": t, "count": len(ms),
            "open": _r2(ms[0]) if ms else 0,
            "close": _r2(ms[-1]) if ms else 0,
            "high": _r2(max(ms)) if ms else 0,
            "low": _r2(min(ms)) if ms else 0,
            "rawEnergy": _r2(jsum(ms)),
            "energy": _r2(c["energy"]),
            "megaCount": c["mega"],
        })
    return out


hitPoints = hit_points


def anchors(rounds) -> dict:
    m = [r.multiplier for r in rounds]
    n = len(m)
    global_mean = _mean(m)
    trough = [i for i in range(1, n - 1) if m[i] < m[i - 1] and m[i] <= m[i + 1]]
    points = []
    for i in range(1, n - 1):
        if not (m[i] > m[i - 1] and m[i] >= m[i + 1]):
            continue
        k = bisect.bisect_left(trough, i)  # trough[k-1] < i <= trough[k]
        start = trough[k - 1] if k > 0 else 0
        k2 = bisect.bisect_right(trough, i)
        end = trough[k2] if k2 < len(trough) else n - 1
        points.append({"peakIdx": i, "peak": _r2(m[i]), "peakTsMs": rounds[i].tsMs, "left": i - start, "right": end - i, "size": end - start})
    dirs, outcomes = [], []
    for a in points:
        end_idx = a["peakIdx"] + a["right"]
        nxt = m[end_idx + 1:end_idx + 11]
        if len(nxt) < 5 or global_mean <= 0:
            continue
        nm = _mean(nxt)
        up = nm > global_mean
        dirs.append(1 if up else 0)
        outcomes.append({"size": a["size"], "up": up, "nextMean": nm})

    def band_of(size):
        return "small <5" if size < 5 else "medium 5-15" if size <= 15 else "large >15"

    bands = []
    for band in ("small <5", "medium 5-15", "large >15"):
        rows = [o for o in outcomes if band_of(o["size"]) == band]
        bands.append({"band": band, "n": len(rows),
                      "pctUpward": _r3(_mean([1 if o["up"] else 0 for o in rows])) if rows else None,
                      "nextMean": _r2(_mean([o["nextMean"] for o in rows])) if rows else None})
    last_peak = points[-1] if points else None
    last_trough = trough[-1] if trough else -1
    rising = 0
    potential = None
    if not (last_peak and last_peak["peakIdx"] > last_trough):
        i = n - 1
        while i > last_trough:
            if i < n - 1 and m[i] > m[i + 1]:
                break
            rising = n - i
            potential = max(potential if potential is not None else 0, m[i])
            i -= 1
    phase = "released" if last_peak and last_peak["peakIdx"] > last_trough else "forming" if rising >= 2 else "idle"
    return {
        "recent": points[-40:],
        "count": len(points),
        "medianPeak": _r2(_median([p["peak"] for p in points])),
        "medianSize": _r2(_median([p["size"] for p in points])),
        "direction": {
            "sampled": len(outcomes),
            "pctUpward": _r3(_mean(dirs)) if dirs else None,
            "nextMean": _r2(_mean([o["nextMean"] for o in outcomes])) if outcomes else None,
            "globalMean": _r2(global_mean),
            "bySize": bands,
        },
        "state": {
            "phase": phase, "risingRun": rising,
            "roundsSincePeak": n - 1 - last_peak["peakIdx"] if last_peak else None,
            "lastPeak": last_peak["peak"] if last_peak else None,
            "potential": _r2(potential) if potential is not None else None,
        },
    }


MOMENTUM_RANGES = [2, 5, 10, 50, 100]


def range_momentum(rounds) -> list:
    n = len(rounds)
    m = [r.multiplier for r in rounds]
    out = []
    for mn in MOMENTUM_RANGES:
        hits = [i for i in range(n) if m[i] >= mn]
        gaps = [hits[k] - hits[k - 1] for k in range(1, len(hits))]
        gaps_t = [rounds[hits[k]].tsMs - rounds[hits[k - 1]].tsMs for k in range(1, len(hits))]
        median_gap = _median(gaps)
        recent_gap = _median(gaps[-3:]) if len(gaps) >= 3 else None
        mom = _clamp(median_gap / recent_gap, 0, 3) if recent_gap is not None and median_gap > 0 else None
        trend = "calm" if mom is None else "accelerating" if mom >= 1.25 else "cooling" if mom <= 0.75 else "steady"
        out.append({
            "id": f"{mn}x+", "min": mn, "hits": len(hits),
            "hitRate": _r4(len(hits) / n) if n else 0,
            "medianGap": _r2(median_gap),
            "recentGap": _r2(recent_gap) if recent_gap is not None else None,
            "momentum": _r3(mom) if mom is not None else None,
            "trend": trend,
            "currentRun": n - 1 - hits[-1] if hits else n,
            "medianGapMs": jround(_median(gaps_t)),
        })
    return out


rangeMomentum = range_momentum


def _low_streak_before(m, idx, cap=2):
    s = 0
    i = idx - 1
    while i >= 0 and m[i] < cap:
        s += 1
        i -= 1
    return s


def moonshot(rounds, threshold: float = 10) -> dict:
    m = [r.multiplier for r in rounds]
    n = len(m)
    hit_idx = [i for i in range(n) if m[i] >= threshold]
    anchor_peaks = [a["peakIdx"] for a in anchors(rounds)["recent"]]
    pts = hit_points(rounds[-6000:], 300_000)
    energy_by_ts = {p["t"]: p["energy"] for p in pts}
    samples = []
    for k, i in enumerate(hit_idx):
        prev = hit_idx[k - 1] if k > 0 else None
        tail = m[max(0, i - 10):i]
        bucket = energy_by_ts.get(math.floor(rounds[i].tsMs / 300_000) * 300_000 - 300_000)
        samples.append({
            "gap": i - prev if prev is not None else min(i, 500),
            "lowStreak": _low_streak_before(m, i),
            "mean10": _mean(tail),
            "anchorNear": 1 if any(p < i and i - p <= 6 for p in anchor_peaks) else 0,
            "bucketEnergy": bucket if bucket is not None else -1,
        })
    valid_energy = [s["bucketEnergy"] for s in samples if s["bucketEnergy"] >= 0]
    recent_peaks = [p for p in anchor_peaks if p > n - 7]
    current = {
        "gap": n - 1 - hit_idx[-1] if hit_idx else n,
        "lowStreak": _low_streak_before(m, n),
        "mean10": _mean(m[-10:]),
        "anchorNear": 1 if recent_peaks else 0,
        "bucketEnergy": pts[-1]["energy"] if pts else -1,
    }

    def cond(key, label, field, higher, pool=None):
        pool = samples if pool is None else pool
        vals = [s[field] for s in pool if s[field] >= 0]
        med = _median(vals)
        cur = current[field]
        met = ((cur >= med) if higher else (cur <= med)) if len(vals) >= 5 else None
        return {"key": key, "label": label, "median": _r2(med), "p25": _r2(_quantile(vals, 0.25)), "p75": _r2(_quantile(vals, 0.75)),
                "current": _r2(cur) if cur >= 0 else None, "met": met}

    conditions = [
        cond("gap", "Rounds since previous moonshot", "gap", True),
        cond("lowStreak", "Sub-2x streak before the hit", "lowStreak", True),
        cond("mean10", "Mean of prior 10 rounds", "mean10", False),
        cond("anchorNear", "Anchor peak within last 6 rounds", "anchorNear", True),
        cond("bucketEnergy", "Prior 5-min bucket energy", "bucketEnergy", False, [s for s in samples if s["bucketEnergy"] >= 0]),
    ]
    readiness = None
    if len(samples) >= 10:
        parts = []
        gap_med = _median([s["gap"] for s in samples])
        parts.append((_clamp(current["gap"] / max(1, gap_med), 0, 2) / 2, 30))
        streak_med = max(1, _median([s["lowStreak"] for s in samples]))
        parts.append((_clamp(current["lowStreak"] / streak_med, 0, 2) / 2, 25))
        mean_med = _median([s["mean10"] for s in samples])
        parts.append((_clamp((mean_med - current["mean10"]) / max(0.1, mean_med), 0, 1), 20))
        parts.append((1 if current["anchorNear"] else 0, 15))
        e_med = _median(valid_energy)
        if e_med > 0 and current["bucketEnergy"] >= 0:
            parts.append((_clamp((e_med - current["bucketEnergy"]) / e_med, 0, 1), 10))
        total_w = jsum(w for _, w in parts)
        acc = 0
        for v, w in parts:
            acc = acc + v * w
        readiness = int(jround((acc / total_w) * 100))
    return {
        "threshold": threshold, "hits": len(hit_idx), "share": _r4(len(hit_idx) / n) if n else 0,
        "conditions": conditions, "readiness": readiness,
        "note": "Fewer than 10 historical moonshots — profile needs more history before readiness is trusted." if len(samples) < 10
        else "Readiness blends how each researched condition sits vs its historical moonshot median. Correlation, not causation — treat as a pressure gauge.",
    }


BANDS = [{"id": "2-5x", "min": 2, "max": 5}, {"id": "5-10x", "min": 5, "max": 10}, {"id": "10x+", "min": 10, "max": math.inf}]


def range_forecast(rounds, windows=None) -> list:
    windows = WINDOWS if windows is None else windows
    n = len(rounds)
    m = [r.multiplier for r in rounds]
    out = []
    for b in BANDS:
        hits = [i for i in range(n) if b["min"] <= m[i] < b["max"]]
        gaps = [hits[k] - hits[k - 1] for k in range(1, len(hits))]
        rate = len(hits) / n if n else 0
        median_gap = _median(gaps)
        geometric = 1 / median_gap if median_gap > 0 else rate
        per = _clamp(0.5 * rate + 0.5 * geometric, 0, 1)
        out.append({
            "id": b["id"], "min": b["min"], "max": b["max"] if math.isfinite(b["max"]) else 0,
            "hits": len(hits), "rate": _r4(rate), "medianGap": _r2(median_gap), "perRound": _r5(per),
            "windows": [{"window": w["id"], "label": w["label"], "probability": _r5(window_probability(per, expected_rounds(rounds, w["ms"])))} for w in windows],
        })
    return out


rangeForecast = range_forecast


def inverted_forecast(rounds, weights: dict, thresholds=(2, 5, 10), windows=None, tail: int = 20_000) -> dict:
    windows = WINDOWS if windows is None else windows
    tail_rounds = rounds[-tail:] if tail else rounds[:]
    mults = [r.multiplier for r in tail_rounds]
    anchor = _median(mults) or 2
    inverted = [dataclasses.replace(r, multiplier=anchor / r.multiplier) for r in tail_rounds][::-1]
    out = []
    for w in windows:
        n_r = expected_rounds(rounds, w["ms"])
        readings = []
        for t in thresholds:
            per = per_round_probability(inverted, anchor / t, weights)
            readings.append({"threshold": t, "invertedPerRound": per, "dipProbability": _r5(window_probability(per["p"], n_r))})
        out.append({"window": w["id"], "label": w["label"], "expectedRounds": n_r, "readings": readings})
    return {
        "anchor": _r3(anchor), "tailRounds": len(tail_rounds), "windows": out,
        "note": "Reads the series backwards with high-value compression (mult' = median/mult). Inverted-high = sub-threshold round in real space, so dip probability is the bearish read; compare side-by-side with the standard windows.",
    }


invertedForecast = inverted_forecast


def assess_live(rounds, open_preds) -> dict:
    now = now_ms()
    preds = []
    for o in open_preds:
        span = max(1, o["dueMs"] - o["createdMs"])
        progress = _clamp((now - o["createdMs"]) / span, 0, 1)
        upper = min(now, o["dueMs"])
        max_seen = 0
        hit = False
        so_far = 0
        for r in rounds:
            if r.tsMs < o["createdMs"]:
                continue
            if r.tsMs > upper:
                break
            so_far += 1
            if r.multiplier > max_seen:
                max_seen = r.multiplier
            if r.multiplier >= o["threshold"]:
                hit = True
        n_r = expected_rounds(rounds, span)
        on_pace = so_far / max(1, n_r * progress) if progress > 0 else 0
        preds.append({
            "id": o["id"], "window": o["window"], "threshold": o["threshold"], "p": _r5(o["p"]),
            "progress": _r3(progress), "roundsSoFar": so_far, "maxSeen": _r2(max_seen), "hitYet": hit,
            "onPace": _r2(_clamp(on_pace, 0, 3)),
            "verdictNow": "cleared" if hit else "expired" if progress >= 1 else "watching",
        })
    pts = hit_points(rounds[-2400:], 300_000)
    tested = agreed = 0
    drift = 0
    for i in range(6, len(pts)):
        base = _mean([p["energy"] for p in pts[i - 6:i]])
        if base <= 0:
            continue
        ratio = pts[i]["energy"] / base
        drift += ratio
        tested += 1
        if 0.5 <= ratio <= 2:
            agreed += 1
    return {
        "predictions": preds,
        "buckets": {"tested": tested, "agreement": _r3(agreed / tested) if tested else None, "driftIndex": _r3(drift / tested) if tested else None},
        "generatedAt": now_iso(),
    }


assessLive = assess_live
