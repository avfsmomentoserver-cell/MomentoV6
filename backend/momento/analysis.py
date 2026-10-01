"""Pure analysis engine — port of archive/backend-ts-v6.5/analysis.ts.

Rounds in, metrics out. No I/O, no state. Field names follow the v6.5 API
contract (camelCase) because the frontend reads them directly.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Optional

from .jsutil import int32, jlog, jmax, jmin, jpow, jround, jsdiv, jsqrt, jsum, tf

THRESHOLDS = (1.2, 1.5, 2, 3, 5, 10, 20, 50, 100, 250, 500, 1000)
LIVE_THRESHOLDS = (2, 5, 10, 50, 100)

BAND_EDGES = [1.5, 2, 5, 10, 100]
BAND_LABELS = ["<1.5x", "1.5–2x", "2–5x", "5–10x", "10–100x", "100x+"]


@dataclass(slots=True)
class Round:
    id: int
    ts: str
    tsMs: int
    multiplier: float
    color: Optional[str] = None
    source: str = "all"
    sessionId: Optional[int] = None
    #: observed | anchor | seeded | reconstructed
    origin: str = "observed"

    def to_json(self) -> dict:
        return {
            "id": self.id, "ts": self.ts, "tsMs": self.tsMs, "multiplier": self.multiplier, "color": self.color,
            "source": self.source, "sessionId": self.sessionId, "origin": self.origin,
        }


def band_index(m: float) -> int:
    i = 0
    while i < len(BAND_EDGES) and m >= BAND_EDGES[i]:
        i += 1
    return i


bandIndex = band_index


def wilson(p: float, n: int, z: float = 1.96) -> list:
    if n == 0:
        return [0, 0]
    denom = 1 + (z * z) / n
    centre = p + (z * z) / (2 * n)
    spread = z * jsqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
    return [max(0, (centre - spread) / denom), min(1, (centre + spread) / denom)]


def median_wait(rate: float) -> Optional[int]:
    if rate <= 0 or rate >= 1:
        return None
    return max(1, math.ceil(math.log(2) / -math.log(1 - rate)))


def percentile_wait(rate: float, q: float) -> Optional[int]:
    if rate <= 0 or rate >= 1:
        return None
    return max(1, math.ceil(math.log(1 - q) / math.log(1 - rate)))


medianWait = median_wait
percentileWait = percentile_wait


def quantile(sorted_vals: list, q: float) -> float:
    if not sorted_vals:
        return 0
    pos = (len(sorted_vals) - 1) * q
    lo = math.floor(pos)
    hi = math.ceil(pos)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def max_of(values) -> float:
    m = 0
    for v in values:
        if v > m:
            m = v
    return m


maxOf = max_of


# ---------------------------------------------------------------- overview

def overview(rounds: list[Round]) -> dict:
    mults = sorted(r.multiplier for r in rounds)
    n = len(mults)
    sessions = {r.sessionId for r in rounds if r.sessionId is not None}
    sorted_ts = sorted(rounds, key=lambda r: r.tsMs)
    return {
        "count": n,
        "mean": jsum(mults) / n if n else 0,
        "median": quantile(mults, 0.5),
        "max": mults[-1] if n else 0,
        "min": mults[0] if n else 0,
        "firstTs": sorted_ts[0].ts if sorted_ts else None,
        "lastTs": sorted_ts[n - 1].ts if n else None,
        "sessions": len(sessions),
        "q10": quantile(mults, 0.1),
        "q25": quantile(mults, 0.25),
        "q75": quantile(mults, 0.75),
        "q90": quantile(mults, 0.9),
        "q95": quantile(mults, 0.95),
        "q99": quantile(mults, 0.99),
    }


# -------------------------------------------------------------- exceedance

def exceedance(rounds: list[Round], thresholds=THRESHOLDS) -> list[dict]:
    n = len(rounds)
    hits = {t: 0 for t in thresholds}
    for r in rounds:
        m = r.multiplier
        for t in thresholds:
            if m >= t:
                hits[t] += 1
    out = []
    for threshold in thresholds:
        h = hits.get(threshold, 0)
        rate = h / n if n else 0
        run = 0
        for i in range(len(rounds) - 1, -1, -1):
            if rounds[i].multiplier >= threshold:
                break
            run += 1
        out.append({
            "threshold": threshold, "hits": h, "rate": rate, "ci": wilson(rate, n),
            "etaMedian": median_wait(rate), "etaP90": percentile_wait(rate, 0.9), "currentRun": run,
        })
    return out


# ----------------------------------------------------------------- streaks

def streaks(rounds: list[Round], threshold: float = 2) -> dict:
    flags = [r.multiplier >= threshold for r in rounds]
    n = len(flags)
    current = 0
    for i in range(n - 1, -1, -1):
        if flags[i] == flags[n - 1]:
            current += 1
        else:
            break
    current_kind = "above" if (n and flags[n - 1]) else "below"
    max_below = max_above = run = 0
    kind = None
    cond: dict[int, list] = {}
    n_below = n_above = jump = stay_below = 0
    post_high_n = post_high_hits = 0
    below_run_before = 0  # streak of below-threshold rounds ending at i-1
    for i in range(n):
        if kind == flags[i]:
            run += 1
        else:
            kind = flags[i]
            run = 1
        if not flags[i]:
            max_below = max(max_below, run)
            n_below += 1
        else:
            max_above = max(max_above, run)
            n_above += 1
        if i > 0 and not flags[i - 1]:
            streak = below_run_before
            b = cond.setdefault(streak, [0, 0])
            b[0] += 1
            if flags[i]:
                b[1] += 1
                jump += 1
            else:
                stay_below += 1
        if i > 0 and rounds[i - 1].multiplier >= 10:
            post_high_n += 1
            if flags[i]:
                post_high_hits += 1
        below_run_before = below_run_before + 1 if not flags[i] else 0
    conditional = [
        {"streak": s, "n": bn, "rate": hits / bn if bn else 0, "ci": wilson(hits / bn if bn else 0, bn)}
        for s, (bn, hits) in sorted(cond.items()) if s <= 6
    ]
    transitions = n_below + n_above - 1
    return {
        "threshold": threshold,
        "current": current,
        "currentKind": current_kind,
        "maxBelow": max_below,
        "maxAbove": max_above,
        "conditional": conditional,
        "markov": {
            "pStayBelow": (stay_below / max(1, transitions)) if n_below else 0,
            "pJump": jump / max(1, transitions) if n_below else 0,
            "nBelow": n_below,
            "nAbove": n_above,
        },
        "postHigh": {"rate": post_high_hits / post_high_n if post_high_n else 0, "n": post_high_n},
        "continuationProb": stay_below / max(1, transitions) if n_below else None,
        "expectedDuration": 1 / max(1e-9, jump / max(1, transitions)) if n_below else None,
    }


# ------------------------------------------------------------------- bands

def bands(rounds: list[Round]) -> dict:
    k = len(BAND_LABELS)
    counts = [0] * k
    matrix = [[0] * k for _ in range(k)]
    prev = -1
    for r in rounds:
        b = band_index(r.multiplier)
        counts[b] += 1
        if prev >= 0:
            matrix[prev][b] += 1
        prev = b
    total = len(rounds)
    row_sums = [jsum(row) for row in matrix]
    col_sums = [jsum(matrix[i][j] for i in range(k)) for j in range(k)]
    grand = jsum(row_sums)
    chi = 0.0
    for i in range(k):
        for j in range(k):
            expected = jsdiv(row_sums[i] * col_sums[j], grand)
            if expected > 0:
                chi += ((matrix[i][j] - expected) ** 2) / expected
    transition = [[(v / row_sums[i]) if row_sums[i] else 0 for v in row] for i, row in enumerate(matrix)]
    return {
        "counts": counts,
        "shares": [(c / total) if total else 0 for c in counts],
        "transition": transition,
        "chiSquare": chi,
        "independent": chi < 37.65,
    }


# ----------------------------------------------------------------- ladders

def ladders(rounds: list[Round], low: float = 2, high: float = 5, min_len: int = 3) -> dict:
    from .jsutil import js_str
    found: list[dict] = []
    histogram: dict[int, int] = {}
    run: list[Round] = []

    def flush():
        nonlocal run
        if len(run) >= min_len:
            found.append({
                "startIndex": run[0].id, "endIndex": run[-1].id, "length": len(run),
                "band": f"{js_str(low)}–{js_str(high)}x", "values": [r.multiplier for r in run],
            })
            histogram[len(run)] = histogram.get(len(run), 0) + 1
        run = []

    for r in rounds:
        in_band = low <= r.multiplier < high
        if in_band and (not run or r.multiplier < run[-1].multiplier):
            run.append(r)
        else:
            flush()
            if in_band:
                run = [r]
    flush()
    current = found[-1] if found else None
    return {"ladders": found[-50:], "current": current if current and current["length"] > 0 else None, "histogram": histogram}


# -------------------------------------------------------------- resistance

def ceilings(rounds: list[Round], window: int = 400, min_touches: int = 3, tolerance: float = 0.05) -> dict:
    recent = rounds[-window:] if window > 0 else []
    peaks = []
    for i in range(1, len(recent) - 1):
        m = recent[i].multiplier
        if m >= 2 and m > recent[i - 1].multiplier and m >= recent[i + 1].multiplier:
            peaks.append(m)
    clusters: list[dict] = []
    for i, m in enumerate(peaks):
        c = next((cl for cl in clusters if abs(m - cl["level"]) / cl["level"] <= tolerance), None)
        if c:
            c["mults"].append(m)
            c["level"] = jsum(c["mults"]) / len(c["mults"])
            c["last"] = i
        else:
            clusters.append({"level": m, "mults": [m], "last": i})
    levels = [
        {
            "level": tf(c["level"], 3),
            "archetype": "ascending" if c["level"] > c["mults"][0] else "descending" if c["level"] < c["mults"][0] else "flat",
            "touches": len(c["mults"]),
            "lastTouchIndex": c["last"],
            "withinTolerance": tolerance,
        }
        for c in clusters if len(c["mults"]) >= min_touches
    ]
    levels.sort(key=lambda x: -x["touches"])
    return {"levels": levels[:12], "dominant": levels[0] if levels else None}


# ---------------------------------------------------------------- pressure

def tail_fit(rounds: list[Round], fit_from: float = 25) -> dict:
    n = len(rounds)
    fit_ts = [25, 50, 100, 250, 500, 1000, 2500, 5000]
    hit_counts = {t: 0 for t in fit_ts}
    for r in rounds:
        m = r.multiplier
        if m < 25:
            continue
        for t in fit_ts:
            if m >= t:
                hit_counts[t] += 1
    xs, ys = [], []
    for t in fit_ts:
        p = hit_counts[t] / n if n else 0
        if p > 0 and t >= fit_from:
            xs.append(math.log(t))
            ys.append(math.log(p))
    if len(xs) < 2:
        return {"a": 0.9497, "b": 1.006}
    mx = jsum(xs) / len(xs)
    my = jsum(ys) / len(ys)
    nu = de = 0.0
    for i in range(len(xs)):
        nu += (xs[i] - mx) * (ys[i] - my)
        de += (xs[i] - mx) ** 2
    slope = nu / de if de else -1
    return {"a": math.exp(my - slope * mx), "b": -slope}


tailFit = tail_fit


def pressure(rounds: list[Round]) -> dict:
    n = len(rounds)
    fit = tail_fit(rounds)
    targets = [100, 250, 500, 1000, 2500, 5000, 10000, 100000]
    hit_counts = {t: 0 for t in targets}
    for r in rounds:
        m = r.multiplier
        if m < 100:
            continue
        for t in targets:
            if m >= t:
                hit_counts[t] += 1
    rows = []
    # one backward scan per target, bounded by the gap length
    for target in targets:
        hits = hit_counts[target]
        rate = hits / n if n else 0
        modeled = min(0.5, fit["a"] * jpow(target, -fit["b"]))
        blended = rate if hits >= 5 else modeled
        run = 0
        for i in range(len(rounds) - 1, -1, -1):
            if rounds[i].multiplier >= target:
                break
            run += 1
        med = median_wait(blended)
        rows.append({
            "target": target,
            "rate": blended,
            "etaMedian": med,
            "etaP90": percentile_wait(blended, 0.9),
            "currentRun": run,
            "pressurePct": min(99, jround((run / med) * 50)) if med else 0,
        })
    overall = jround(jsum(t["pressurePct"] for t in rows) / max(1, len(rows)))
    status = "critical" if overall >= 85 else "loaded" if overall >= 65 else "building" if overall >= 40 else "calm"
    return {"powerLaw": {"a": tf(fit["a"], 4), "b": tf(fit["b"], 4), "fitFrom": 25}, "targets": rows, "overallPressure": overall, "status": status}


# ------------------------------------------------------------------- shape

def _slope_of(arr: list[float]) -> float:
    if not arr:
        return 0.0
    mx = (len(arr) - 1) / 2
    my = jsum(arr) / len(arr)
    nu = de = 0.0
    for x, y in enumerate(arr):
        nu += (x - mx) * (y - my)
        de += (x - mx) ** 2
    return nu / de if de else 0.0


def shape(rounds: list[Round], window: int = 60) -> dict:
    recent = [r.multiplier for r in rounds[-window:]] if window > 0 else []
    logs = [math.log(max(1.01, m)) for m in recent]
    n = len(logs)
    slope = accel = 0.0
    if n > 4:
        half = n // 2
        slope = _slope_of(logs)
        accel = _slope_of(logs[half:]) - _slope_of(logs[:half])
    mean = jsum(logs) / max(1, n)
    sd = jsqrt(jsum((b - mean) ** 2 for b in logs) / max(1, n))
    if n:
        skew = jsum(jsdiv(b - mean, sd) ** 3 for b in logs) / n
        kurt = jsum(jsdiv(b - mean, sd) ** 4 for b in logs) / n
    else:
        skew = kurt = 0.0
    classification = "uniform"
    if kurt > 4 and skew > 0.8:
        classification = "clustered"
    elif kurt > 3.2:
        classification = "power_law"
    elif abs(accel) > 0.01:
        classification = "exponential" if accel > 0 else "bimodal"
    rolling = recent[-50:]
    roll_mean = jsum(rolling) / max(1, len(rolling))
    dry = roll_mean < 2
    severity = min(1, (2 - roll_mean) / 1.2) if dry else 0
    srt = sorted(recent)
    xm = max(1.05, quantile(srt, 0.75))
    tail = [m for m in srt if m >= xm]
    if len(tail) >= 3:
        alpha = jsdiv(len(tail), jsum(math.log(m / xm) for m in tail))
    else:
        alpha = 1.006
    if tail:
        ks = jmax([abs(1 - jpow(xm / m, alpha) - (i + 1) / len(tail)) for i, m in enumerate(tail)])
    else:
        ks = 0
    p_value = math.exp(-2 * len(tail) * ks * ks) if math.isfinite(ks) else math.nan
    plausibility = "pareto-plausible" if p_value > 0.05 else "pareto-rejected"
    eta = []
    for target in (2, 5, 10, 50, 100):
        t0 = xm
        rate = jpow(t0 / target, alpha) if target > t0 else 0.5
        eta.append({"target": target, "median": median_wait(rate), "band": [percentile_wait(rate, 0.05), percentile_wait(rate, 0.95)]})
    group = BAND_LABELS[band_index(recent[-1] if recent else 1)]
    return {
        "classification": classification,
        "slope": tf(slope, 4),
        "acceleration": tf(accel, 4),
        "skewness": tf(skew, 3),
        "kurtosis": tf(kurt, 3),
        "dryZone": {"active": dry, "severity": tf(severity, 2), "window": 50, "threshold": 2},
        "pareto": {"alpha": tf(alpha, 3), "ks": tf(ks, 3), "pValue": tf(p_value, 4), "plausibility": plausibility},
        "eta": eta,
        "trajectory": {"group": group, "forwardMedian": tf(mean, 2)},
    }


# ---------------------------------------------------------------- moonshot

def moonshot(rounds: list[Round]) -> dict:
    def dist(t: float) -> int:
        for i in range(len(rounds) - 1, -1, -1):
            if rounds[i].multiplier >= t:
                return len(rounds) - 1 - i
        return -1

    d10, d100 = dist(10), dist(100)
    press = pressure(rounds)
    sh = shape(rounds, 80)
    recent50 = [r.multiplier for r in rounds[-50:]]
    spread = max(recent50 + [1]) - min(recent50 + [1])
    compression = max(0, 1 - spread / 20)
    factors = {
        "tailPressure": press["overallPressure"] / 100,
        "since10x": d10,
        "since100x": d100,
        "tenXOverdue": d10 > 12,
        "hundredXOverdue": d100 > 90,
        "compression": tf(compression, 2),
        "dryZone": sh["dryZone"]["active"],
    }
    score = 0.2
    score += (press["overallPressure"] / 100) * 0.35
    score += 0.12 if d10 > 12 else 0
    score += 0.1 if d100 > 90 else 0
    score += compression * 0.13
    score += 0.1 if sh["dryZone"]["active"] else 0
    confidence = min(0.95, score)
    from .jsutil import js_str
    return {
        "imminent": confidence >= 0.55,
        "confidence": tf(confidence, 3),
        "factors": factors,
        "historical": {
            "count100": jsum(1 for r in rounds if r.multiplier >= 100),
            "count1000": jsum(1 for r in rounds if r.multiplier >= 1000),
            "max": max_of(r.multiplier for r in rounds),
        },
        "narrative": (
            f"Moonshot conditions building — tail pressure {js_str(press['overallPressure'])}%, {d10} rounds since 10x, compression {int32(compression * 100)}%."
            if confidence >= 0.55
            else f"No moonshot edge: measured exceedance governs. {d10} rounds since last 10x."
        ),
    }


# ------------------------------------------------------------- linguistics

def _below_run_at(seq: list[bool], i: int) -> int:
    run = 0
    j = i - 1
    while j >= 0 and not seq[j]:
        run += 1
        j -= 1
    return run


def linguistics(rounds: list[Round], depth: int = 200) -> dict:
    layer_names = ["band", "chroma", "streak", "transition", "momentum", "pressure", "shape"]
    press = pressure(rounds)
    shape_state = shape(rounds, 80)["classification"]
    recent = rounds[-depth:] if depth > 0 else []
    seq = [r.multiplier >= 2 for r in rounds]
    # below-run before each index, computed once (O(n))
    before = [0] * (len(rounds) + 1)
    for i in range(1, len(rounds) + 1):
        before[i] = 0 if seq[i - 1] else before[i - 1] + 1
    tokens: dict[str, dict] = {}
    out = []
    press_state = "loaded" if press["overallPressure"] >= 65 else "building" if press["overallPressure"] >= 40 else "calm"
    for idx, r in enumerate(recent):
        gi = len(rounds) - depth + idx
        # NB: with fewer rounds than `depth`, gi is offset (negative for early rows) exactly as in v6.5
        band = BAND_LABELS[band_index(r.multiplier)]
        chroma = r.color if r.color is not None else "unrecorded"
        above = r.multiplier >= 2
        streak = "break" if above else f"dry{min(before[gi] if gi >= 0 else 0, 9)}"
        prev_band = BAND_LABELS[band_index(rounds[gi - 1].multiplier)] if gi > 0 else band
        transition = f"{prev_band}→{band}"
        momentum = ("rising" if rounds[gi - 5].multiplier < r.multiplier else "fading") if gi >= 5 else "flat"
        layers = [band, chroma, streak, transition, momentum, press_state, shape_state]
        token = "·".join(layers[:4])
        ex = tokens.get(token)
        if ex:
            ex["count"] += 1
        else:
            tokens[token] = {"token": token, "layers": layers, "count": 1}
        out.append({"token": token, "layers": layers, "multiplier": r.multiplier, "ts": r.ts})
    top = sorted(tokens.values(), key=lambda t: -t["count"])[:40]
    return {"recent": out, "tokens": top, "layers": layer_names}


# ------------------------------------------------------------------- gaps

def gaps(rounds: list[Round], thresholds=LIVE_THRESHOLDS) -> list[dict]:
    out = []
    n = len(rounds)
    for t in thresholds:
        since = 0
        for i in range(n - 1, -1, -1):
            if rounds[i].multiplier >= t:
                break
            since += 1
        hits = jsum(1 for r in rounds if r.multiplier >= t)
        rate = hits / n if n else 0
        mw = median_wait(rate)
        pct = jround(jmin(99, jsdiv(since, mw or 0) * 50)) if rate else 0
        out.append({"threshold": t, "since": since, "rate": rate, "etaMedian": mw, "etaP90": percentile_wait(rate, 0.9), "percentile": pct})
    return out


# -------------------------------------------------------------- forecasting

def walk_forward(rounds: list[Round], thresholds=THRESHOLDS, warmup: int = 300) -> dict:
    n = len(rounds)
    split_at = max(warmup + 100, (n - warmup) // 2 + warmup)
    test_rounds = rounds[split_at:]
    train_rounds = rounds[warmup:split_at]

    def brier(probs, ys):
        return jsum((p - ys[i]) ** 2 for i, p in enumerate(probs)) / max(1, len(ys))

    verdicts = []
    model_briers: dict[str, list] = {}

    def record(name, b):
        model_briers.setdefault(name, []).append(b)

    for t in thresholds:
        train_y = [1 if r.multiplier >= t else 0 for r in train_rounds]
        base_rate = jsum(train_y) / max(1, len(train_y))
        test_y = [1 if r.multiplier >= t else 0 for r in test_rounds]
        if not test_y:
            continue
        probs_base = [base_rate] * len(test_y)
        b_base = brier(probs_base, test_y)
        record("base", b_base)
        a11 = a10 = h0 = l0 = 0
        for i in range(1, len(train_y)):
            if train_y[i - 1] == 1:
                if train_y[i] == 1:
                    a11 += 1
                else:
                    h0 += 1
            else:
                if train_y[i] == 1:
                    a10 += 1
                else:
                    l0 += 1
        p_after_high = a11 / max(1, a11 + h0)
        p_after_low = a10 / max(1, a10 + l0)
        probs_markov = [base_rate if i == 0 else (p_after_high if test_y[i - 1] == 1 else p_after_low) for i in range(len(test_y))]
        record("markov1", brier(probs_markov, test_y))
        record("streak", brier(probs_base, test_y))
        ewma = base_rate
        probs_ewma = []
        for y in test_y:
            probs_ewma.append(ewma)
            ewma = 0.02 * y + 0.98 * ewma
        record("ewma", brier(probs_ewma, test_y))
        probs_ens = [(probs_base[i] + probs_markov[i] + probs_ewma[i]) / 3 for i in range(len(test_y))]
        record("ensemble", brier(probs_ens, test_y))
        b_ens = brier(probs_ens, test_y)
        models = [
            {"name": name, "brier": tf(arr[-1], 5), "lift": tf(jsdiv(arr[-1] - b_base, b_base) * 100, 2)}
            for name, arr in model_briers.items() if name != "base"
        ]
        rate = jsum(test_y) / len(test_y)
        verdicts.append({
            "threshold": t,
            "rate": rate,
            "ci": wilson(rate, len(test_y)),
            "brierBase": tf(b_base, 5),
            "brierEnsemble": tf(b_ens, 5),
            "lift": tf(jsdiv(b_ens - b_base, b_base) * 100, 2),
            "verdict": "accepted" if b_ens <= b_base * 0.995 else "rejected",
            "models": models,
        })
    leaderboard = []
    base_arr = model_briers.get("base", [])
    base_avg = jsdiv(jsum(base_arr), len(base_arr))
    for name, arr in model_briers.items():
        avg = jsum(arr) / len(arr)
        leaderboard.append({"name": name, "brier": tf(avg, 5), "lift": tf(jsdiv(avg - base_avg, base_avg) * 100, 2)})
    leaderboard.sort(key=lambda x: x["lift"] if not math.isnan(x["lift"]) else 0)
    return {"verdicts": verdicts, "leaderboard": leaderboard, "split": {"train": len(train_rounds), "test": len(test_rounds), "warmup": warmup}}


walkForward = walk_forward


# ------------------------------------------------------------------ market

def candles(rounds: list[Round], tf_seconds: float, limit: int = 120) -> list[dict]:
    buckets: dict[float, dict] = {}
    for r in rounds[-4000:]:
        bucket = math.floor(r.tsMs / 1000 / tf_seconds) * tf_seconds
        b = buckets.get(bucket)
        m = r.multiplier
        if b is None:
            buckets[bucket] = {"o": m, "h": m, "l": m, "c": m, "t": bucket, "n": 1}
        else:
            b["h"] = max(b["h"], m)
            b["l"] = min(b["l"], m)
            b["c"] = m
            b["n"] += 1
    vals = sorted(buckets.values(), key=lambda b: b["t"])
    return vals[-limit:] if limit > 0 else []


def session_phases(rounds: list[Round]) -> list[dict]:
    by: dict[int, list] = {}
    for r in rounds:
        by.setdefault(r.sessionId if r.sessionId is not None else 0, []).append(r)
    out = []
    for sid in sorted(by):
        rs = by[sid]
        mx = max(r.multiplier for r in rs)
        mean = jsum(r.multiplier for r in rs) / len(rs)
        p2 = jsum(1 for r in rs if r.multiplier >= 2) / len(rs)
        out.append({
            "sessionId": sid,
            "started": rs[0].ts,
            "ended": rs[-1].ts,
            "rounds": len(rs),
            "max": tf(mx, 2),
            "mean": tf(mean, 3),
            "p2": tf(p2 * 100, 2),
            "phase": "eruption" if mx >= 100 else "expansion" if mx >= 20 else "steady" if p2 > 0.55 else "compressed",
        })
    return out


sessionPhases = session_phases


def house_edge(rounds: list[Round]) -> dict:
    n = len(rounds)
    total = jsum(r.multiplier for r in rounds)

    def ev_at(t):
        p = jsum(1 for r in rounds if r.multiplier >= t) / n if n else 0
        return {"threshold": t, "p": tf(p, 4), "ev": tf(p * t - 1, 4)}

    mean = total / max(1, n)
    return {
        "observedMean": tf(mean, 4),
        "impliedFair": 1.0,
        "estimatedEdge": tf(1 - 1 / max(1e-9, mean), 4),
        "evTable": [ev_at(t) for t in (1.2, 1.5, 2, 3, 5, 10, 50, 100)],
    }


houseEdge = house_edge
