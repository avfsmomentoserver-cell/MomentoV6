"""Full-Intelligence next-round forecast (v6.3) — port of intelligence.ts.

V5 forecast engine (Markov state transitions + empirical percentiles + DNA
analogue matching + ladder release + band exhaustion + logistic ML ensemble)
rebuilt on top of every v6 engine. Every engine emits a full next-round
distribution over the six v6 bands; the final forecast is a Bayesian mixture
whose weights are EARNED from the calibration ledger. Pure module.
"""

from __future__ import annotations

import math

from . import analysis as A
from . import calibration as C
from . import fx as FX
from . import momentum as MO
from . import pipeline as PL
from . import point_range as PR
from .analysis import BAND_EDGES, BAND_LABELS, band_index
from .jsutil import jsum, tf


def clamp(v, lo=0, hi=1):
    return min(hi, max(lo, v))


def r2(v):
    return tf(v, 2)


def r3(v):
    return tf(v, 3)


def r4(v):
    return tf(v, 4)


def mean(xs):
    return jsum(xs) / len(xs) if xs else 0


def pstdev(xs):
    if len(xs) < 2:
        return 0
    m = mean(xs)
    return math.sqrt(jsum((b - m) ** 2 for b in xs) / len(xs))


def pct(srt, q):
    if not srt:
        return 0
    pos = (len(srt) - 1) * q
    lo = math.floor(pos)
    hi = math.ceil(pos)
    return srt[lo] + (srt[hi] - srt[lo]) * (pos - lo)


def normalize(xs):
    s = jsum(max(0, b) for b in xs)
    return [max(0, x) / s for x in xs] if s > 0 else [1 / len(xs) for _ in xs]


NB = len(BAND_LABELS)
EDGES = [1, *BAND_EDGES, math.inf]

V5_SETTINGS = {
    "ladderMinLength": 3, "ladderTolerance": 0.06, "collapseMinLength": 3, "lowBand": 2.0, "ignition": 5.0,
    "moonshot": 10.0, "megaMoonshot": 50.0, "shelfWindow": 12, "shelfVariance": 0.35, "baitSpikeRatio": 2.2,
    "volatilityWindow": 30, "dnaWindow": 8, "dnaTolerance": 0.85, "confidenceFloor": 0.05, "horizon": 5,
}
S = V5_SETTINGS

V5_BANDS = [
    {"key": "dust", "lo": 1.0, "hi": 1.2}, {"key": "floor", "lo": 1.2, "hi": 1.5}, {"key": "low", "lo": 1.5, "hi": 2.0},
    {"key": "base", "lo": 2.0, "hi": 3.0}, {"key": "mid", "lo": 3.0, "hi": 5.0}, {"key": "high", "lo": 5.0, "hi": 10.0},
    {"key": "ignition", "lo": 10.0, "hi": 20.0}, {"key": "moonshot", "lo": 20.0, "hi": 50.0}, {"key": "mega", "lo": 50.0, "hi": 100.0},
    {"key": "cosmic", "lo": 100.0, "hi": math.inf},
]


def v5_band_index(m):
    v = max(1, m)
    for i, b in enumerate(V5_BANDS):
        if b["lo"] <= v < b["hi"]:
            return i
    return len(V5_BANDS) - 1


def to_points(m):
    return 100 + math.log2(max(1, m)) * 30


def from_points(p):
    return math.pow(2, (p - 100) / 30)


STATES = ("Normal", "Collapse", "Ignition", "Moonshot", "Exhaustion", "Shelf", "Bait")

STATE_META = {
    "Normal": {"tone": "neutral", "color": "#8b95b7", "meaning": "Balanced distribution, no dominant pressure"},
    "Collapse": {"tone": "bear", "color": "#ef4444", "meaning": "Descending ceilings, energy draining out of the curve"},
    "Ignition": {"tone": "bull", "color": "#2ee6c0", "meaning": "Compression released, upside energy building"},
    "Moonshot": {"tone": "bull", "color": "#38bdf8", "meaning": "High band cleared, extended run in progress"},
    "Exhaustion": {"tone": "bear", "color": "#f59e0b", "meaning": "Upside spent, mean reversion likely"},
    "Shelf": {"tone": "neutral", "color": "#a3a3a3", "meaning": "Flat variance shelf, market coiling"},
    "Bait": {"tone": "warn", "color": "#fb923c", "meaning": "Single spike inside weakness — false invitation"},
}


def energy_of(m):
    if m < 1.3:
        return "snuffed"
    if m < 2:
        return "damp"
    if m < 3:
        return "steady"
    if m < 6:
        return "charged"
    if m < 15:
        return "surging"
    if m < 50:
        return "explosive"
    return "runaway"


def shape_word(window):
    if len(window) < 3:
        return "seed"
    pts = [to_points(x) for x in window]
    h = len(pts) // 2
    delta = mean(pts[h:]) - mean(pts[:h])
    spread = max(pts) - min(pts)
    if spread < 12:
        return "shelf"
    if delta > 10:
        return "ramp"
    if delta < -10:
        return "slide"
    peak = pts.index(max(pts))
    return "edge-spike" if peak == 0 or peak == len(pts) - 1 else "arch"


# ------------------------------------------------------ V5 signal detectors

def ascending_ladder(m):
    if len(m) < 2:
        return {"active": False, "length": 0, "strength": 0, "slope": 0, "floor": 1}
    pts = [to_points(x) for x in m]
    length = 1
    floor = pts[-1]
    tol = S["ladderTolerance"] * 100
    for i in range(len(pts) - 2, -1, -1):
        if pts[i] <= floor + tol:
            length += 1
            floor = min(floor, pts[i])
        else:
            break
    win = pts[-length:]
    slope = (win[-1] - win[0]) / (length - 1) if length > 1 else 0
    active = length >= S["ladderMinLength"] and slope > 0
    pressure = clamp(length / 12) if active else clamp(length / 24)
    return {"active": active, "length": length, "strength": clamp(pressure * 0.6 + clamp(slope / 20) * 0.4), "slope": r3(slope), "floor": r2(from_points(floor))}


def collapse_ladder(m):
    if len(m) < 2:
        return {"active": False, "run": 0, "strength": 0, "ceiling": 1}
    pts = [to_points(x) for x in m]
    run = 1
    ceiling = pts[-1]
    for i in range(len(pts) - 2, -1, -1):
        if pts[i] >= ceiling:
            run += 1
            ceiling = max(ceiling, pts[i])
        else:
            break
    return {"active": run >= S["collapseMinLength"], "run": run, "strength": clamp(run / 10), "ceiling": r2(from_points(ceiling))}


def nested_bands(m):
    w = m[-S["shelfWindow"]:]
    if len(w) < 4:
        return {"detected": False, "compression": 0}
    pts = [to_points(x) for x in w]
    h = len(pts) // 2
    early = max(pts[:h]) - min(pts[:h])
    late = max(pts[h:]) - min(pts[h:])
    compression = clamp((early - late) / max(1, early))
    return {"detected": compression > 0.35 and late < 25, "compression": r4(compression)}


def shelf_signal(m):
    w = m[-S["shelfWindow"]:]
    if len(w) < 5:
        return {"active": False, "strength": 0, "level": 1}
    pts = [to_points(x) for x in w]
    norm = pstdev(pts) / 100
    return {"active": norm <= S["shelfVariance"] / 2, "strength": clamp(1 - norm * 3), "level": r2(from_points(mean(pts)))}


def bait_signal(m):
    w = m[-8:]
    if len(w) < 5:
        return {"active": False, "strength": 0, "spike": 0, "ratio": 1}
    spike = max(w)
    others = [x for x in w if x != spike]
    ctx = mean(others) if others else 1
    ratio = spike / max(1, ctx)
    lows = sum(1 for x in others if x < S["lowBand"])
    active = ratio >= S["baitSpikeRatio"] and lows >= len(others) * 0.6
    return {"active": active, "strength": clamp((ratio - 1) / 5) if active else clamp((ratio - 1) / 12), "spike": r2(spike), "ratio": r3(ratio)}


def signals_of(window):
    return {"asc": ascending_ladder(window), "col": collapse_ladder(window), "nested": nested_bands(window),
            "shelf": shelf_signal(window), "bait": bait_signal(window)}


def classify_state(sig, m):
    scores = {"Normal": 0.34, "Collapse": 0, "Ignition": 0, "Moonshot": 0, "Exhaustion": 0, "Shelf": 0, "Bait": 0}
    if not m:
        return {"state": "Normal", "scores": scores}
    last = m[-1]
    recent = m[-10:]
    high_hits = sum(1 for x in recent if x >= S["moonshot"])
    low_hits = sum(1 for x in recent if x < S["lowBand"])
    scores["Collapse"] = sig["col"]["strength"] * (1.25 if sig["col"]["active"] else 0.5)
    scores["Ignition"] = sig["asc"]["strength"] * 0.7 + sig["nested"]["compression"] * 0.55
    scores["Moonshot"] = clamp(high_hits / 2.5) if last >= S["ignition"] else clamp(high_hits / 6)
    scores["Shelf"] = sig["shelf"]["strength"] * (1.2 if sig["shelf"]["active"] else 0.4)
    scores["Bait"] = sig["bait"]["strength"] * (1.3 if sig["bait"]["active"] else 0.35)
    peak = max(recent)
    if peak >= S["moonshot"] and last < S["lowBand"]:
        scores["Exhaustion"] = clamp(0.55 + low_hits / 14)
    elif peak >= S["ignition"] and last < S["lowBand"]:
        scores["Exhaustion"] = clamp(0.4 + low_hits / 20)
    if last >= S["moonshot"]:
        scores["Moonshot"] = clamp(scores["Moonshot"] + 0.45)
    if last >= S["ignition"]:
        scores["Ignition"] = clamp(scores["Ignition"] + 0.2)
    if low_hits >= 7:
        scores["Collapse"] = clamp(scores["Collapse"] + 0.2)
    for k in STATES:
        scores[k] = r4(clamp(scores[k]))
    state = "Normal"
    for k in STATES:
        if scores[k] > scores[state]:
            state = k
    return {"state": state, "scores": scores}


# A label is a pure function of its <=40-round window, and consecutive
# forecasts (live, walk-forward calibration) share all but one window, so the
# labels are memoised by window content. Output is identical to recomputing.
_STATE_MEMO: dict = {}
_STATE_MEMO_MAX = 200_000


def _state_of_window(w):
    key = tuple(w)
    hit = _STATE_MEMO.get(key)
    if hit is None:
        hit = classify_state(signals_of(w), w)["state"]
        if len(_STATE_MEMO) >= _STATE_MEMO_MAX:
            _STATE_MEMO.clear()
        _STATE_MEMO[key] = hit
    return hit


def state_sequence(m, limit=1500):
    offset = max(0, len(m) - limit)
    labels = []
    for i in range(offset, len(m)):
        w = m[max(0, i - 39): i + 1]
        if len(w) < 5:
            labels.append("Normal")
            continue
        labels.append(_state_of_window(w))
    return {"labels": labels, "offset": offset}


def transition_matrix(labels):
    counts = {a: {b: 0 for b in STATES} for a in STATES}
    for i in range(1, len(labels)):
        counts[labels[i - 1]][labels[i]] += 1
    out = {}
    for a in STATES:
        total = sum(counts[a].values())
        out[a] = {b: (r4((counts[a][b] + 0.5) / (total + 0.5 * len(STATES))) if total else r4(1 / len(STATES))) for b in STATES}
    return out


# ------------------------------------------------------------ V5 DNA report

def dna_report(m, scan=6000):
    W = S["dnaWindow"]
    sig = [v5_band_index(x) for x in m[-W:]]
    signature = [V5_BANDS[i]["key"] for i in sig]
    if len(m) < W * 3:
        return {"signature": signature, "matchCount": 0, "confidence": 0, "outcomes": None, "matches": [], "followers": []}
    start0 = max(0, len(m) - scan)
    keys = [v5_band_index(v) if i >= start0 else 0 for i, v in enumerate(m)]
    max_dist = W * (len(V5_BANDS) - 1)
    matches = []
    limit = len(m) - W * 2
    for s in range(start0, limit):
        d = 0
        for k in range(W):
            d += abs(keys[s + k] - sig[k])
        sim = 1 - d / max_dist
        if sim >= S["dnaTolerance"]:
            matches.append({"index": s, "similarity": r4(sim), "next": r2(m[s + W])})
    matches.sort(key=lambda x: -x["similarity"])
    followers = [x["next"] for x in matches]
    srt = sorted(followers)
    outcomes = None
    if followers:
        nf = len(followers)
        outcomes = {"count": nf, "median": r2(pct(srt, 0.5)), "p75": r2(pct(srt, 0.75)), "p90": r2(pct(srt, 0.9)),
                    "over2": r4(sum(1 for f in followers if f >= 2) / nf), "over5": r4(sum(1 for f in followers if f >= 5) / nf),
                    "over10": r4(sum(1 for f in followers if f >= 10) / nf)}
    return {"signature": signature, "matchCount": len(matches), "confidence": r4(clamp(len(matches) / 25)), "outcomes": outcomes,
            "matches": matches[:16], "followers": followers}


# ---------------------------------------------------- V5 band exhaustion

def band_exhaustion(m):
    total = len(m)
    if total < 10:
        return {"bands": [], "mostOverdue": None}
    out = []
    for t in (2, 3, 5, 10, 20, 50, 100):
        hits = 0
        last = -1
        for i in range(total):
            if m[i] >= t:
                hits += 1
                last = i
        rate = hits / total
        expected_gap = r2(1 / rate) if rate > 0 else None
        since = total - 1 - last if last >= 0 else total
        overdue = r3(since / expected_gap) if expected_gap else 0
        out.append({"threshold": t, "rate": r4(rate), "expectedGap": expected_gap, "roundsSince": since, "overdueRatio": overdue,
                    "exhaustion": r4(clamp(overdue / 2.5)), "status": "overdue" if overdue > 1.25 else "due" if overdue > 0.85 else "fresh"})
    ranked = sorted([b for b in out if b["expectedGap"]], key=lambda b: -b["overdueRatio"])
    return {"bands": out, "mostOverdue": ranked[0] if ranked else None}


# ------------------------------------------ V5 ladder release conditions

def detect_ladders(m, min_length=4, base_window=20):
    out = []
    n = len(m)
    if n < min_length:
        return out
    base = [0.0] * n
    run = 0
    for i in range(n):
        run += m[i]
        if i >= base_window:
            run -= m[i - base_window]
        base[i] = run / min(i + 1, base_window)
    i = 0
    while i < n - min_length + 1:
        b = base[i]
        a = 0
        j = i
        while j < n and m[j] >= b:
            a += 1
            j += 1
        if a >= min_length:
            pure = all(m[k] < m[k + 1] for k in range(i, i + a - 1))
            out.append({"type": "ascend", "start": i, "end": i + a - 1, "length": a, "pure": pure})
            i += a
            continue
        c = 0
        j = i
        while j < n and m[j] <= b:
            c += 1
            j += 1
        if c >= min_length:
            pure = all(m[k] > m[k + 1] for k in range(i, i + c - 1))
            out.append({"type": "collapse", "start": i, "end": i + c - 1, "length": c, "pure": pure})
            i += c
            continue
        i += 1
    return out


def ladder_intel(m):
    empty = {"ladderCount": 0, "moonshotProbability": 0, "releaseCorrelation": 0, "etaToMoonshot": 0, "pressureScore": 0,
             "releasePrediction": "none", "currentLadder": None, "compressionNearRelease": False, "etaAdjustment": 0}
    if len(m) < 10:
        return empty
    ladders = detect_ladders(m, 4)
    if not ladders:
        return empty
    srt = sorted(ladders, key=lambda l: -l["length"])
    longest = [l for l in srt if l["length"] >= 10]
    if not longest:
        longest = srt[: max(1, len(srt) // 10)]
    etas = []
    for l in longest:
        for i in range(l["end"] + 1, min(len(m), l["end"] + 15)):
            if m[i] >= 20:
                etas.append(i - l["end"])
                break
    current = [l for l in ladders if l["end"] == len(m) - 1]
    cur = None
    for l in current:
        if cur is None or l["length"] > cur["length"]:
            cur = l
    moonshot_probability = (min(0.95, 0.6 + cur["length"] * 0.02) if cur["length"] >= 10 else 0.3) if cur else 0.2
    accumulation = 0
    for k in range(1, len(ladders)):
        a = ladders[k - 1]
        b = ladders[k]
        if a["type"] == b["type"] and b["start"] - a["end"] <= 5:
            accumulation += a["length"] + b["length"]
    pressure_score = clamp(accumulation / max(1, len(ladders) * 20))
    release = "imminent" if pressure_score > 0.7 else "likely" if pressure_score > 0.4 else "possible" if pressure_score > 0.2 else "none"
    w = sorted(m[-50:])
    fi = math.floor(len(w) * 0.95)
    ceiling = w[fi] if fi < len(w) else 2
    last10 = m[-10:]
    contained = all(x <= ceiling for x in last10)
    p10 = [to_points(x) for x in last10]
    spread10 = max(p10) - min(p10)
    cnr = contained and spread10 < 40
    eta_adj = -pressure_score * 5 - (cur["length"] * 0.3 if cur else 0) - (2 if cnr else 0)
    return {"ladderCount": len(ladders), "moonshotProbability": r4(moonshot_probability),
            "releaseCorrelation": r4(len(etas) / len(longest) if longest else 0), "etaToMoonshot": r2(mean(etas) if etas else 10),
            "pressureScore": r4(pressure_score), "releasePrediction": release,
            "currentLadder": {"type": cur["type"], "length": cur["length"]} if cur else None,
            "compressionNearRelease": cnr, "etaAdjustment": r2(eta_adj)}


# ------------------------------------------------ V5 logistic ML ensemble

ML_WEIGHTS = {
    "over2": {"bias": -0.35, "meanLog": 1.15, "stdLog": 0.42, "lastLog": -0.28, "lowShare": -1.6, "highShare": 0.85, "trend": 0.55, "maxLog": 0.12},
    "over5": {"bias": -1.45, "meanLog": 0.95, "stdLog": 0.78, "lastLog": -0.18, "lowShare": -1.15, "highShare": 1.3, "trend": 0.62, "maxLog": 0.22},
    "over10": {"bias": -2.3, "meanLog": 0.7, "stdLog": 0.92, "lastLog": -0.12, "lowShare": -0.85, "highShare": 1.65, "trend": 0.58, "maxLog": 0.3},
}


def ml_intel(m, empirical):
    w = m[-40:]
    logs = [math.log(max(1.01, x)) for x in w]
    features = {
        "meanLog": r4(mean(logs)), "stdLog": r4(pstdev(logs)), "lastLog": r4(logs[-1] if logs else 0),
        "lowShare": r4(sum(1 for x in w if x < S["lowBand"]) / max(1, len(w))),
        "highShare": r4(sum(1 for x in w if x >= S["ignition"]) / max(1, len(w))),
        "recentMean": r4(mean(w[-8:])), "trend": r4(mean(logs[-8:]) - mean(logs[:8])),
        "maxLog": r4(max(logs) if logs else 0),
    }
    predictions = {}
    for target, wts in ML_WEIGHTS.items():
        z = wts["bias"]
        for k, v in wts.items():
            if k != "bias":
                z += v * features.get(k, 0)
        model = 1 / (1 + math.exp(-clamp(z, -60, 60)))
        emp = empirical[target]
        blended = clamp(model * 0.6 + emp * 0.4)
        predictions[target] = {"model": r4(model), "empirical": r4(emp), "blended": r4(blended), "edge": r4(blended - emp)}
    return {"features": features, "predictions": predictions}


# ----------------------------------------------------- distribution tools

def band_shares(values, prior=None, pseudo=0):
    c = [0.0] * NB
    for v in values:
        c[band_index(v)] += 1
    if prior and pseudo > 0:
        for i in range(NB):
            c[i] += prior[i] * pseudo
    return normalize(c)


def reshape_from_survival(ref, s2, s5, s10):
    a = clamp(s2, 0.001, 0.999)
    b = clamp(min(s5, a), 0.0005, a)
    c = clamp(min(s10, b), 0.0002, b)
    lo = (ref[0] + ref[1]) or 1
    hi = (ref[4] + ref[5]) or 1
    return normalize([(1 - a) * (ref[0] / lo), (1 - a) * (ref[1] / lo), a - b, b - c, c * (ref[4] / hi), c * (ref[5] / hi)])


def tilt(ref, s, lam=0.35):
    mid = (NB - 1) / 2
    return normalize([p * math.exp(lam * s * ((i - mid) / mid)) for i, p in enumerate(ref)])


def _surv(d, band):
    return jsum(d[band:])


def band_log_loss(dist, actual):
    i = band_index(actual)
    v = dist[i] if i < len(dist) and dist[i] is not None else 1e-6
    return -math.log(max(1e-6, v))


bandLogLoss = band_log_loss


def js_divergence(p, q):
    m = [(x + q[i]) / 2 for i, x in enumerate(p)]

    def kl(a, b):
        s = 0
        for i, x in enumerate(a):
            if x > 0 and b[i] > 0:
                s = s + x * math.log(x / b[i])
        return s

    return 0.5 * kl(p, m) + 0.5 * kl(q, m)


COMPONENTS = ("baseline", "percentile", "markov", "dna", "band", "ml", "ensemble", "signals")
COMPONENT_LABEL = {
    "baseline": "Measured baseline (full history)",
    "percentile": "Empirical percentiles (recent 500)",
    "markov": "Markov state transitions (V5 7-state)",
    "dna": "DNA analogue matching",
    "band": "v6 band-partition model (tail-lift)",
    "ml": "Logistic ML ensemble",
    "ensemble": "v6 earned-weight per-round ensemble",
    "signals": "Signal layer (pressure · moonshot · ladders · FX · momentum)",
}


# ------------------------------------------------------------- main engine

PRIOR = {"baseline": 1.0, "percentile": 0.8, "markov": 0.9, "dna": 0.7, "band": 0.9, "ml": 0.6, "ensemble": 0.8, "signals": 0.6}


def _isnum(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _jexp(x):
    try:
        return math.exp(x)
    except OverflowError:
        return math.inf


def earn_weights(ledger):
    out = {}
    ll = (ledger or {}).get("logLoss") or {}
    n = (ledger or {}).get("sample") or 0
    known = [c for c in COMPONENTS if _isnum(ll.get(c))]
    n_eff = min(60, n)
    best = min(ll[c] for c in known) if known else 0
    for c in COMPONENTS:
        l = ll.get(c)
        out[c] = PRIOR[c] * _jexp(-n_eff * (l - best)) if n >= 15 and _isnum(l) else PRIOR[c]
    s = jsum(out[c] for c in COMPONENTS) or 1
    for c in COMPONENTS:
        out[c] = out[c] / s
    out["baseline"] = max(out["baseline"], 0.08)
    for c in COMPONENTS:
        out[c] = max(out[c], 0.02)
    s2 = jsum(out[c] for c in COMPONENTS)
    for c in COMPONENTS:
        out[c] = r4(out[c] / s2)
    return out


earnWeights = earn_weights


def full_intelligence_forecast(all_rounds, source, opts=None):
    from .clock import now_iso
    from .jsutil import js_str, jround, to_fixed
    opts = opts or {}
    mh = opts.get("maxHistory") if opts.get("maxHistory") is not None else 20_000
    rounds = all_rounds[int(-mh):]
    m = [r.multiplier for r in rounds]
    n = len(m)
    last = m[-1] if m else 1
    cadence_ms = PL.median_interval_ms(rounds)
    pw = opts.get("pipelineWeights") or {}
    ledger = opts.get("ledger") or None

    baseline = band_shares(m)
    recent = m[-500:]
    recent_sorted = sorted(recent)
    percentiles = {}
    for k, q in (("p05", 0.05), ("p10", 0.1), ("p25", 0.25), ("p50", 0.5), ("p75", 0.75), ("p90", 0.9), ("p95", 0.95), ("p99", 0.99)):
        percentiles[k] = r2(pct(recent_sorted, q))
    percentile_dist = band_shares(recent, baseline, 20)

    def surv(t):
        return sum(1 for x in m if x >= t) / n if n else 0

    emp = {"over2": surv(2), "over5": surv(5), "over10": surv(10)}
    in_band = [[] for _ in range(NB)]
    for v in m[-5000:]:
        in_band[band_index(v)].append(v)
    for b in in_band:
        b.sort()
    representative = [math.exp(mean([math.log(v) for v in b])) if len(b) >= 5 else 200 if i == NB - 1 else math.sqrt(EDGES[i] * EDGES[i + 1])
                      for i, b in enumerate(in_band)]

    def quantile_of(dist, q):
        c = 0
        for i in range(NB):
            nxt = c + dist[i]
            if nxt >= q or i == NB - 1:
                f = clamp((q - c) / dist[i]) if dist[i] > 0 else 0.5
                b = in_band[i]
                if len(b) >= 8:
                    return max(1, pct(b, f))
                lo = EDGES[i]
                hi = EDGES[i + 1] if math.isfinite(EDGES[i + 1]) else lo * 10
                return lo * math.pow(hi / lo, f)
            c = nxt
        return representative[NB - 1]

    sig = signals_of(m[-40:])
    cls = classify_state(sig, m[-40:])
    current = cls["state"]
    seq = state_sequence(m, 1500)
    labels, offset = seq["labels"], seq["offset"]
    matrix = transition_matrix(labels)
    markov_row = matrix[current]
    state_values = {s: [] for s in STATES}
    for i, lab in enumerate(labels):
        state_values[lab].append(m[offset + i])

    dna = dna_report(m)
    exhaustion = band_exhaustion(m[-5000:])
    ladders = ladder_intel(m[-1500:])
    ml = ml_intel(m, emp)
    press = A.pressure(rounds)
    ms = A.moonshot(rounds)
    sh = A.shape(rounds, 80)
    st = A.streaks(rounds, 2)
    band_test = A.bands(rounds[-5000:])
    v6band = PL.next_round_forecast(rounds, source, pw)
    per2 = PL.per_round_probability(rounds, 2, pw)
    per5 = PL.per_round_probability(rounds, 5, pw)
    per10 = PL.per_round_probability(rounds, 10, pw)
    trend = rev = vol = brk = None
    if n >= 200:
        trend = FX.trend_quality(rounds)
        rev = FX.mean_reversion(rounds)
        vol = FX.volatility_profile(rounds)
        brk = FX.breakout(rounds)
    momentum = MO.range_momentum(rounds[-5000:])
    research = MO.moonshot(rounds[-8000:], 10) if n >= 300 else None

    pts = [to_points(x) for x in m[-21:]]
    gaps = [p - pts[i] for i, p in enumerate(pts[1:])]
    net = jsum(gaps)
    swing_dir = "up" if net > 6 else "down" if net < -6 else "flat"
    vw = [math.log(max(1.01, x)) for x in m[-S["volatilityWindow"]:]]
    reg_vol = pstdev(vw)
    reg_drift = mean(vw)
    regime = "compressed" if reg_vol < 0.45 else "balanced" if reg_vol < 0.85 else "expanded" if reg_vol < 1.35 else "chaotic"
    if reg_drift > 0.95 and reg_vol > 0.8:
        regime = "trending-up"
    elif reg_drift < 0.45 and reg_vol < 0.7:
        regime = "grinding-down"
    regime_conf = clamp(len(vw) / S["volatilityWindow"])

    dna_weight = min(0.35, dna["confidence"] * 0.35)
    mo = exhaustion["mostOverdue"]
    overdue_tilt = min(0.2, (mo["exhaustion"] if mo else 0) * 0.2)
    op = press["overallPressure"]
    pressure_tilt = min(0.15, ((op - 70) / 100) * 0.15) if op > 70 else 0
    moonshot_tilt = min(0.12, (ms["confidence"] - 0.7) * 0.4) if ms["confidence"] > 0.7 else 0
    ladder_tilt = min(0.25, (ladders["moonshotProbability"] - 0.6) * 0.5) if ladders["moonshotProbability"] > 0.6 else 0
    collapse_tilt = min(0.1, sig["col"]["strength"] * 0.1) if sig["col"]["active"] else 0
    momentum_tilt = 0.04 if swing_dir == "up" else -0.04 if swing_dir == "down" else 0

    raw = []
    for s in STATES:
        p = markov_row[s]
        if dna["outcomes"] and dna_weight > 0:
            if s in ("Moonshot", "Ignition"):
                p = p * (1 - dna_weight) + dna["outcomes"]["over5"] * dna_weight
            elif s in ("Collapse", "Exhaustion"):
                p = p * (1 - dna_weight) + (1 - dna["outcomes"]["over2"]) * dna_weight
        if s in ("Moonshot", "Ignition"):
            p += overdue_tilt + pressure_tilt
            if s == "Moonshot":
                p += moonshot_tilt + ladder_tilt
            if momentum_tilt > 0:
                p += momentum_tilt
        elif s in ("Collapse", "Exhaustion"):
            p = max(0, p - overdue_tilt * 0.5) + collapse_tilt
            if momentum_tilt < 0:
                p += -momentum_tilt
        raw.append((s, max(0, p)))
    raw_total = jsum(p for _, p in raw) or 1
    state_prob = {s: p / raw_total for s, p in raw}

    state_dist = {s: band_shares(state_values[s], baseline, 10) for s in STATES}
    followers = [m[offset + i + 1] for i in range(len(labels) - 1) if labels[i] == current]
    markov_tilt = clamp((state_prob["Moonshot"] + state_prob["Ignition"] - markov_row["Moonshot"] - markov_row["Ignition"])
                        - (state_prob["Collapse"] + state_prob["Exhaustion"] - markov_row["Collapse"] - markov_row["Exhaustion"]), -1, 1)
    markov_dist = tilt(band_shares(followers, baseline, 20), markov_tilt, 0.6)

    candidates = []
    for s in STATES:
        vals = sorted(state_values[s])
        lo = pct(vals, 0.25) if len(vals) >= 10 else quantile_of(state_dist[s], 0.25)
        hi = pct(vals, 0.75) if len(vals) >= 10 else quantile_of(state_dist[s], 0.75)
        candidates.append({"state": s, "probability": r4(state_prob[s]), "rangeLo": r2(max(1, lo)), "rangeHi": r2(max(lo + 0.05, hi)),
                           "survival": r4(_surv(state_dist[s], 2)), "label": STATE_META[s]["meaning"], "color": STATE_META[s]["color"],
                           "note": f"transition from {current} · n={len(vals)}"})
    candidates.sort(key=lambda c: -c["probability"])
    top = candidates[0]

    dna_dist = band_shares(dna["followers"], baseline, 10) if dna["followers"] else baseline
    band_dist = normalize([d["probability"] for d in v6band["distribution"]])
    ml_dist = reshape_from_survival(baseline, ml["predictions"]["over2"]["blended"], ml["predictions"]["over5"]["blended"], ml["predictions"]["over10"]["blended"])
    ensemble_dist = reshape_from_survival(baseline, per2["p"], per5["p"], per10["p"])

    J = js_str
    signals = []

    def push(engine, reading, direction, note):
        signals.append({"engine": engine, "reading": reading, "direction": r3(clamp(direction, -1, 1)), "note": note})

    push("Mega pressure", f"{J(op)}% · {press['status']}", 0.4 if op >= 65 else 0.15 if op >= 40 else 0, "Power-law tail priors vs current dry runs on 100x+ targets.")
    push("Moonshot scanner", f"{J(jround(ms['confidence'] * 100))}%{' · imminent' if ms['imminent'] else ''}",
         0.5 if ms["imminent"] else (ms["confidence"] - 0.4) * 0.5, ms["narrative"])
    if research and research.get("readiness") is not None:
        push("Moonshot research", f"readiness {J(research['readiness'])}", (research["readiness"] - 50) / 100, research["note"])
    push("Ladder release", f"{ladders['releasePrediction']} · p {J(jround(ladders['moonshotProbability'] * 100))}%",
         0.4 if ladders["moonshotProbability"] > 0.6 else 0.2 if ladders["releasePrediction"] == "likely" else 0,
         f"{J(ladders['ladderCount'])} ladders · release correlation {J(jround(ladders['releaseCorrelation'] * 100))}% · ETA ~{J(ladders['etaToMoonshot'])} rounds.")
    if mo:
        push("Band exhaustion", f"{J(mo['threshold'])}x {mo['status']} ({J(mo['overdueRatio'])}×gap)", 0.25 if mo["status"] == "overdue" else 0,
             f"{J(mo['roundsSince'])} rounds since the last {J(mo['threshold'])}x vs expected gap {J(mo['expectedGap'])}.")
    dz = sh["dryZone"]
    push("ShapeShifters", f"{sh['classification']}{(' · dry ' + J(dz['severity'])) if dz['active'] else ''}",
         -0.3 * dz["severity"] if dz["active"] else 0.2 if sh["classification"] == "exponential" else 0,
         f"Pareto α {J(sh['pareto']['alpha'])} ({sh['pareto']['plausibility']}).")
    push("Gap / swing", f"{swing_dir} (net {J(r2(net))} pts)", 0.2 if swing_dir == "up" else -0.2 if swing_dir == "down" else 0,
         "V5 point-space round-over-round swing across the last 20 rounds.")
    push("Streak", f"{st['currentKind']} {J(st['current'])} (max below {J(st['maxBelow'])})",
         -0.15 if st["currentKind"] == "below" and st["current"] >= 5 else 0, f"P(stay below) {J(jround(st['markov']['pStayBelow'] * 100))}%.")
    if trend:
        push("FX trend quality", f"{trend['classification']} · {trend['direction']}",
             (0.4 if trend["direction"] == "up" else -0.4) if trend["classification"] == "trending" else 0, trend["note"])
    if rev:
        push("FX mean reversion", f"H {J(rev['hurst'])} · z {J(rev['zScore'])}", 0.35 if rev["zScore"] < -1.5 else -0.35 if rev["zScore"] > 1.5 else 0, rev["interpretation"])
    if vol:
        push("FX volatility", f"{vol['regime']} (p{J(jround(vol['volPercentile'] * 100))})", 0.25 if vol["regime"] == "compressed" else -0.1 if vol["regime"] == "expanded" else 0, vol["note"])
    if brk:
        push("FX breakout", f"{J(jround(brk['compressionPercentile'] * 100))}% squeeze", 0.3 if brk["compressionPercentile"] > 0.8 else 0, brk["note"])
    m10 = next((x for x in momentum if x["min"] == 10), None)
    if m10:
        push("Range momentum 10x+", f"{m10['trend']}{(' · ' + J(m10['momentum'])) if m10.get('momentum') is not None else ''}",
             0.3 if m10["trend"] == "accelerating" else -0.2 if m10["trend"] == "cooling" else 0,
             f"median gap {J(m10['medianGap'])} · recent {J(m10['recentGap']) if m10.get('recentGap') is not None else '—'} · run {J(m10['currentRun'])}.")
    push("Regime", f"{regime} · σ {J(r3(reg_vol))}", 0.3 if regime == "trending-up" else -0.3 if regime == "grinding-down" else 0,
         "V5 volatility regime from rolling log dispersion.")
    composite = clamp(mean([s["direction"] for s in signals]) * 2, -1, 1) if signals else 0
    signals_dist = tilt(percentile_dist, composite)

    dists = {"baseline": baseline, "percentile": percentile_dist, "markov": markov_dist, "dna": dna_dist, "band": band_dist,
             "ml": ml_dist, "ensemble": ensemble_dist, "signals": signals_dist}

    weights = earn_weights(ledger)
    states = opts.get("engineStates") or {}
    extras = []
    for e in opts.get("extraEngines") or []:
        try:
            d = normalize(e["predict"](rounds))
        except Exception:  # noqa: BLE001 — a failing custom engine falls back to baseline
            d = baseline
        ok = len(d) == NB and all(_isnum(x) and math.isfinite(x) for x in d)
        extras.append({"key": e["key"], "label": e["label"], "prior": e["prior"], "dist": d if ok else baseline})
    extra_w = {}
    if extras or states:
        ll = (ledger or {}).get("logLoss") or {}
        n_s = (ledger or {}).get("sample") or 0
        n_eff = min(60, n_s)
        keys = [*COMPONENTS, *[e["key"] for e in extras]]
        pri = {**PRIOR, **{e["key"]: e["prior"] for e in extras}}

        def state_of(k):
            if k == "baseline":
                return "live"
            v = states.get(k)
            return v if v is not None else ("live" if k in COMPONENTS else "shadow")

        known = [k for k in keys if _isnum(ll.get(k)) and state_of(k) == "live"]
        best = min(ll[k] for k in known) if known else 0
        rw = {}
        for k in keys:
            if state_of(k) == "shadow":
                rw[k] = 0
                continue
            l = ll.get(k)
            rw[k] = pri[k] * (_jexp(-n_eff * (l - best)) if n_s >= 15 and _isnum(l) else 1 if k in COMPONENTS else 0.25)
        s0 = jsum(rw[k] for k in keys) or 1
        for k in keys:
            rw[k] /= s0
        rw["baseline"] = max(rw["baseline"], 0.08)
        for k in keys:
            stt = state_of(k)
            if stt == "demoted":
                rw[k] = 0.02
            elif stt == "live":
                rw[k] = max(rw[k], 0.02)
        s0 = jsum(rw[k] for k in keys) or 1
        for c in COMPONENTS:
            weights[c] = r4(rw[c] / s0)
        for e in extras:
            extra_w[e["key"]] = r4(rw[e["key"]] / s0)
    mix_raw = []
    for i in range(NB):
        a = 0
        for c in COMPONENTS:
            a = a + weights[c] * dists[c][i]
        b = 0
        for e in extras:
            b = b + extra_w.get(e["key"], 0) * e["dist"][i]
        mix_raw.append(a + b)
    mixture = normalize(mix_raw)
    jsd = 0
    for c in COMPONENTS:
        jsd = jsd + weights[c] * js_divergence(dists[c], mixture)
    agreement = clamp(1 - jsd / math.log(2) * 4)

    rc = opts.get("recalibrator") or C.identity_recalibrator("No recalibrator supplied.")
    calibrated = C.apply_distribution(mixture, rc) if rc.get("active") else mixture
    prof = C.range_profile(opts.get("rangeProfile"))
    lvl = {"rangeLo": C.map_level(rc, prof["lo"]), "expected": C.map_level(rc, 0.5), "rangeHi": C.map_level(rc, prof["hi"]), "reach": C.map_level(rc, prof["reach"])}
    corr_opt = opts.get("correction")
    corr = 0 if rc.get("active") or rc.get("quantileActive") else (corr_opt if corr_opt is not None else 0)
    factor = clamp(math.exp(corr), 0.5, 2) if corr else 1
    expected_raw = quantile_of(mixture, 0.5)
    q_expected = quantile_of(calibrated, lvl["expected"])
    q_lo = quantile_of(calibrated, lvl["rangeLo"])
    q_hi = quantile_of(calibrated, lvl["rangeHi"])
    q_reach = quantile_of(calibrated, lvl["reach"])
    opr = opts.get("pointRange")
    pr = opr if (opr and opr.get("sample", 0) > 0 and (opr.get("pointMethod") != "median" or opr.get("intervalMethod") != "central" or opr.get("adaptive"))) else None

    def qf(q):
        return quantile_of(calibrated, q)

    median_pub = max(1, q_expected * factor)
    expected = median_pub
    lo0 = q_lo * factor
    hi0 = q_hi * factor
    pr_iv = bool(pr and (pr.get("intervalMethod") != "central" or pr.get("adaptive")))
    if pr:
        expected = max(1, (q_expected if pr["pointMethod"] == "median" else PR.point_estimate(qf, pr["pointMethod"])) * factor)
        if pr_iv:
            a, b = PR.interval(qf, pr["coverage"], pr["intervalMethod"])
            lo0 = a * factor
            hi0 = b * factor
    range_lo = max(1, min(lo0, expected))
    range_hi = max(expected, hi0, range_lo + 0.01)
    reach = max(range_hi, q_reach * factor)
    quantiles = {}
    prev = 1
    for k, q in (("p05", 0.05), ("p10", 0.1), ("p15", 0.15), ("p25", 0.25), ("p50", 0.5), ("p75", 0.75), ("p85", 0.85), ("p90", 0.9), ("p95", 0.95)):
        v = median_pub if k == "p50" else max(1, quantile_of(calibrated, C.map_level(rc, q)) * factor)
        prev = max(prev, v)
        quantiles[k] = r2(prev)

    def pct_label(q):
        return f"p{J(jround(q * 100))}"

    tail_share = calibrated[4] + calibrated[5]
    recent_crash = sum(1 for x in recent if x < 2) / len(recent) if recent else 0
    mode_index = calibrated.index(max(calibrated))

    score_vals = sorted((cls["scores"][s] for s in STATES), reverse=True)
    agreement_v5 = score_vals[0] - mean(score_vals[1:])
    sample_factor = clamp(n / 150)
    base_conf = clamp(max(S["confidenceFloor"], agreement_v5 * 0.55 + sample_factor * 0.3 + regime_conf * 0.15))
    lead = top["probability"] - (candidates[1]["probability"] if len(candidates) > 1 else 0)
    boost = 0.05 if ms["confidence"] > 0.8 or op > 85 else 0
    state_conviction = clamp(base_conf * 0.55 + lead * 1.4 + dna["confidence"] * 0.15 + boost)
    hit_rate = (ledger or {}).get("hitRate")
    cal_sample = (ledger or {}).get("sample") or 0
    mll = (ledger or {}).get("mixLogLoss")
    bll = (ledger or {}).get("baseLogLoss")
    skill_raw = (bll - mll) / bll if mll is not None and bll is not None and bll > 0 else None
    confidence = (state_conviction * 0.35 + agreement * 0.25 + hit_rate * 0.4) if cal_sample >= 15 and hit_rate is not None else (state_conviction * 0.6 + agreement * 0.4) * 0.6
    if cal_sample < 15:
        confidence = min(confidence, 0.6)
    elif skill_raw is None or skill_raw < 0.03:
        confidence = min(confidence, 0.6)
    confidence = clamp(confidence, 0.05, 0.95)
    confidence_label = "HIGH" if confidence >= 0.66 else "MEDIUM" if confidence >= 0.38 else "LOW"
    skill_pct = r2(skill_raw * 100) if skill_raw is not None else None

    horizon_outlook = []
    for t in (2, 5, 10, 20, 50, 100):
        p = clamp(C.survival_at(calibrated, t), 1e-6, 1 - 1e-6)
        run = 0
        i = n - 1
        while i >= 0 and m[i] < t:
            run += 1
            i -= 1
        horizon_outlook.append({"threshold": t, "perRound": r4(p), "baseline": r4(surv(t)), "withinHorizon": r4(1 - math.pow(1 - p, S["horizon"])),
                                "etaMedian": A.median_wait(p), "etaP90": A.percentile_wait(p, 0.9), "currentRun": run})

    lls = (ledger or {}).get("logLoss") or {}
    comp_out = []
    for c in COMPONENTS:
        comp_out.append({"key": c, "label": COMPONENT_LABEL[c], "weight": weights[c], "prior": PRIOR[c], "mid": r2(quantile_of(dists[c], 0.5)),
                         "p2": r4(_surv(dists[c], 2)), "p10": r4(_surv(dists[c], 4)), "distribution": [r4(x) for x in dists[c]],
                         "logLoss": r4(lls[c]) if _isnum(lls.get(c)) else None,
                         "samples": dna["matchCount"] if c == "dna" else len(followers) if c == "markov" else len(recent) if c == "percentile" else n})
    for e in extras:
        comp_out.append({"key": e["key"], "label": e["label"], "weight": extra_w.get(e["key"], 0), "prior": e["prior"], "mid": r2(quantile_of(e["dist"], 0.5)),
                         "p2": r4(_surv(e["dist"], 2)), "p10": r4(_surv(e["dist"], 4)), "distribution": [r4(x) for x in e["dist"]],
                         "logLoss": r4(lls[e["key"]]) if _isnum(lls.get(e["key"])) else None, "samples": n})

    def mid(c):
        return next(x for x in comp_out if x["key"] == c)["mid"]

    band_label = BAND_LABELS[band_index(expected)]
    honesty = ("Band-to-band transitions pass the chi-square independence test — consecutive rounds behave as independent draws, so engines can only earn weight by out-scoring the measured baseline on the calibration ledger."
               if band_test["independent"] else
               "Band transitions fail the independence test on the trailing sample — conditional engines may carry information; their earned weights show how much.")
    window10 = m[-10:]
    note = (f"{top['state']}: {STATE_META[top['state']]['meaning'].lower()} (from {current}). "
            f"Last round settled {to_fixed(last, 2)}x in the {BAND_LABELS[band_index(last)]} band with {energy_of(last)} energy, forming a {shape_word(window10)} across the last {len(window10)} rounds. "
            f"Mixture of {len(COMPONENTS)} engines{' (recalibrated)' if rc.get('active') else ''} puts P(≥2x) at {J(jround(C.survival_at(calibrated, 2) * 100))}%"
            + (f" and {J(jround(tail_share * 100))}% on the 10x+ bands." if tail_share >= 0.05 else "."))
    csample = opts.get("correctionSample") if opts.get("correctionSample") is not None else 0
    if corr:
        rect = {"active": abs(corr) >= 0.05, "factor": r4(factor), "biasPct": r4(corr), "sampleSize": csample,
                "note": (f"Full-intelligence median ran {J(jround(corr * 100))}% low (median log error) across {J(csample)} verified rounds — central range scaled up {to_fixed(factor, 2)}x."
                         if corr > 0 else
                         f"Full-intelligence median ran {J(jround(-corr * 100))}% high (median log error) across {J(csample)} verified rounds — central range scaled down {to_fixed(factor, 2)}x.")}
    elif corr_opt and (rc.get("active") or rc.get("quantileActive")):
        rect = {"active": False, "factor": 1, "biasPct": r4(corr_opt), "sampleSize": csample,
                "note": "Median log-bias rectification superseded by out-of-sample distribution / quantile recalibration."}
    else:
        rect = None
    return {
        "engine": "full-intelligence-v6.3", "source": source, "generatedAt": now_iso(), "cadenceMs": cadence_ms,
        "state": top["state"], "confidence": r4(confidence), "confidenceLabel": confidence_label,
        "expectedMultiplier": r2(expected), "rangeLo": r2(range_lo), "rangeHi": r2(range_hi), "band": band_label,
        "distribution": [{"label": BAND_LABELS[i], "edge": EDGES[i], "probability": r4(p), "representative": r2(representative[i])} for i, p in enumerate(calibrated)],
        "rawDistribution": [r4(x) for x in mixture], "baseMultiplier": r2(expected_raw), "tailLift": v6band["tailLift"], "moonshotReach": r2(reach),
        "rangeProfile": {**prof, "label": (f"{J(jround(pr['coverage'] * 100))}% {'shortest' if pr['intervalMethod'] == 'shortest' else 'central'}" if pr_iv
                                            else f"{pct_label(prof['lo'])}–{pct_label(prof['hi'])}")},
        "pointRange": {
            "pointMethod": pr["pointMethod"] if pr else "median",
            "intervalMethod": pr["intervalMethod"] if pr_iv else "central",
            "coverage": r4(pr["coverage"] if pr_iv else prof["nominal"]), "nominal": prof["nominal"], "adaptive": bool(pr and pr.get("adaptive")),
            "sample": (opr or {}).get("sample") or 0, "median": r2(median_pub),
            "reason": (opr or {}).get("reason") if (opr or {}).get("reason") is not None else "Median and equal-tailed profile range (no ledger selection supplied).",
        },
        "quantiles": quantiles, "rectification": rect,
        "lastRound": {"multiplier": last, "band": BAND_LABELS[band_index(last)]},
        "components": [{"model": c["key"], "p": c["p2"], "weight": c["weight"], "mid": c["mid"]} for c in comp_out],
        "note": note, "predictedState": top["state"], "predictedBand": band_label, "horizon": S["horizon"],
        "stateConviction": r4(state_conviction), "stateScores": cls["scores"], "candidates": candidates, "transitionMatrix": matrix,
        "blend": {"markovMid": mid("markov"), "percentileMid": mid("percentile"), "dnaMid": mid("dna"), "bandMid": mid("band"), "mlMid": mid("ml"),
                  "ensembleMid": mid("ensemble"), "signalsMid": mid("signals"), "baselineMid": mid("baseline")},
        "intelligence": {
            "components": comp_out, "agreement": r4(agreement), "calibratedHitRate": r4(hit_rate) if hit_rate is not None else None,
            "skillPct": skill_pct, "calibrationSample": cal_sample, "signals": signals,
            "dna": {"signature": dna["signature"], "matchCount": dna["matchCount"], "confidence": dna["confidence"], "outcomes": dna["outcomes"], "matches": dna["matches"]},
            "exhaustion": exhaustion, "ladders": ladders, "ml": ml, "percentiles": percentiles, "horizonOutlook": horizon_outlook,
            "regime": {"label": regime, "volatility": r4(reg_vol), "drift": r4(reg_drift)},
            "independence": {"chiSquare": r2(band_test["chiSquare"]), "independent": band_test["independent"]},
            "honesty": honesty,
            "calibration": {
                "distributionActive": rc.get("active"), "quantileActive": rc.get("quantileActive"), "gamma": rc.get("gamma"), "tau": rc.get("tau"),
                "levels": {k: r4(v) for k, v in lvl.items()}, "sample": rc.get("sample"), "validSample": rc.get("validSample"),
                "validRawLogLoss": rc.get("validRawLogLoss"), "validCalLogLoss": rc.get("validCalLogLoss"), "improvementPct": rc.get("improvementPct"),
                "coverageRaw": rc.get("coverageRaw"), "coverageCal": rc.get("coverageCal"),
                "crash": {"raw": r4(mixture[0] + mixture[1]), "calibrated": r4(calibrated[0] + calibrated[1]), "observed": r4(recent_crash)},
                "legacyCorrection": corr != 0, "modeBand": BAND_LABELS[mode_index], "reason": rc.get("reason"),
            },
        },
    }


fullIntelligenceForecast = full_intelligence_forecast


def score_intel_forecast(f, actual):
    from .jsutil import js_str
    eb = band_index(f["expectedMultiplier"])
    ab = band_index(actual)
    band_err = ab - eb
    log_err = math.log(max(1, actual)) - math.log(max(1, f["expectedMultiplier"]))
    in_range = f["rangeLo"] <= actual <= f["rangeHi"]
    loose = f["rangeLo"] / 1.5 <= actual <= f["rangeHi"] * 1.5

    def short(i):
        return BAND_LABELS[i].replace("x", "", 1)

    stt = f["state"]
    if in_range and abs(band_err) <= 1:
        return {"verdict": "hit", "bandErr": band_err, "logErr": log_err, "reason": f"Inside the published range in {'the' if band_err == 0 else 'an adjacent'} projected band — {stt} projection held."}
    if abs(band_err) <= 1 and loose:
        return {"verdict": "adjacent", "bandErr": band_err, "logErr": log_err, "reason": f"Off by one band ({short(eb)} → {short(ab)}) inside the padded range — direction correct."}
    if band_err > 1:
        return {"verdict": "miss-high", "bandErr": band_err, "logErr": log_err, "reason": f"Landed {js_str(band_err)} bands above the projected {short(eb)} — the tail ran hotter than the mixture implied under {stt}."}
    if band_err < -1:
        return {"verdict": "miss-low", "bandErr": band_err, "logErr": log_err, "reason": f"Landed {js_str(-band_err)} bands below the projected {short(eb)} — base bands held weight the mixture gave to the upside under {stt}."}
    return {"verdict": "near", "bandErr": band_err, "logErr": log_err, "reason": "Just outside the central range in a neighbouring band — band split right, range edges tight."}


scoreIntelForecast = score_intel_forecast
