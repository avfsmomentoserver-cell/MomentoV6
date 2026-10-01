"""Out-of-sample recalibration of the next-round distribution.

Port of archive/backend-ts-v6.5/calibration.ts (see that file for the full
method notes): a validated band-level distribution layer p' ∝ (p·r^γ)^τ and a
PIT quantile remap, each switched on only when rolling-origin held-out
validation shows it beats the raw mixture.

Samples are dicts ``{"dist": [6 floats], "actual": float}``; the recalibrator
is a plain dict with the v6.5 field names.
"""

from __future__ import annotations

import math

from .analysis import BAND_EDGES, band_index
from .jsutil import js_str, jsqrt, jsum, tf, to_fixed

CAL_NB = len(BAND_EDGES) + 1
EDGES = [1, *BAND_EDGES, math.inf]


def _clamp(v: float, lo: float = 0, hi: float = 1) -> float:
    return min(hi, max(lo, v))


def _r4(v: float) -> float:
    return tf(v, 4)


PUBLISHED_LEVELS = (0.05, 0.1, 0.15, 0.25, 0.5, 0.75, 0.85, 0.9, 0.95)

RANGE_PROFILES = {
    "tight": {"name": "tight", "lo": 0.25, "hi": 0.75, "reach": 0.9, "nominal": 0.5},
    "loose": {"name": "loose", "lo": 0.15, "hi": 0.85, "reach": 0.95, "nominal": 0.7},
    "wide": {"name": "wide", "lo": 0.1, "hi": 0.9, "reach": 0.95, "nominal": 0.8},
}
DEFAULT_RANGE_PROFILE = "loose"


def range_profile(name=None) -> dict:
    return RANGE_PROFILES.get(name or "", RANGE_PROFILES[DEFAULT_RANGE_PROFILE])


rangeProfile = range_profile

GAMMAS = [0, 0.25, 0.5, 0.75, 1]
TAUS = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25]


def identity_recalibrator(reason: str, sample: int = 0) -> dict:
    return {
        "active": False,
        "quantileActive": False,
        "gamma": 0,
        "tau": 1,
        "ratios": [1] * CAL_NB,
        "levels": [{"q": q, "mapped": q} for q in PUBLISHED_LEVELS],
        "sample": sample,
        "fitSample": 0,
        "validSample": 0,
        "validRawLogLoss": None,
        "validCalLogLoss": None,
        "improvementPct": None,
        "coverageRaw": None,
        "coverageCal": None,
        "quantileErrRaw": None,
        "quantileErrCal": None,
        "reason": reason,
    }


identityRecalibrator = identity_recalibrator


def _finite(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def sanitize_dist(dist) -> list | None:
    if not dist or len(dist) != CAL_NB:
        return None
    xs = [x if _finite(x) and x > 0 else 0 for x in dist]
    s = jsum(xs)
    if not (s > 0):
        return None
    return [x / s for x in xs]


sanitizeDist = sanitize_dist


def _floor_dist(dist: list, eps: float = 1e-4) -> list:
    xs = [max(eps, x) for x in dist]
    s = jsum(xs)
    return [x / s for x in xs]


def log_loss(dist: list, actual: float) -> float:
    b = band_index(actual)
    p = dist[b] if b < len(dist) and dist[b] is not None else 1e-6
    return -math.log(max(1e-6, p))


logLoss = log_loss


# -------------------------------------------------------- continuous CDF

def _within_band_cdf(i: int, x: float) -> float:
    lo = EDGES[i]
    hi = EDGES[i + 1]
    if x <= lo:
        return 0
    if not math.isfinite(hi):
        return _clamp(1 - lo / x)
    if x >= hi:
        return 1
    return _clamp((1 / lo - 1 / x) / (1 / lo - 1 / hi))


def _within_band_inverse(i: int, f: float) -> float:
    lo = EDGES[i]
    hi = EDGES[i + 1]
    g = _clamp(f, 0, 0.999999)
    if not math.isfinite(hi):
        return lo / (1 - g)
    return 1 / (1 / lo - g * (1 / lo - 1 / hi))


def cdf_at(dist: list, x: float) -> float:
    if not (x > 1):
        return 0
    b = band_index(x)
    c = 0
    for i in range(b):
        c += dist[i]
    return _clamp(c + dist[b] * _within_band_cdf(b, x))


cdfAt = cdf_at


def survival_at(dist: list, t: float) -> float:
    return _clamp(1 - cdf_at(dist, t), 1e-6, 1 - 1e-6)


survivalAt = survival_at


def quantile_at(dist: list, q: float) -> float:
    qq = _clamp(q, 1e-6, 1 - 1e-6)
    c = 0
    for i in range(CAL_NB):
        nxt = c + dist[i]
        if nxt >= qq or i == CAL_NB - 1:
            f = _clamp((qq - c) / dist[i]) if dist[i] > 0 else 0.5
            return max(1, _within_band_inverse(i, f))
        c = nxt
    return 1


quantileAt = quantile_at


# ------------------------------------------------------ distribution layer

def apply_distribution(dist: list, rc: dict) -> list:
    clean = sanitize_dist(dist)
    if not clean:
        return [1 / CAL_NB] * CAL_NB
    if not rc.get("active"):
        return clean
    ratios = rc.get("ratios") or []
    gamma = rc["gamma"]
    tau = rc["tau"]
    xs = []
    for i, p in enumerate(clean):
        r = ratios[i] if i < len(ratios) and ratios[i] is not None else 1
        xs.append(max(1e-9, p * r ** gamma) ** tau)
    s = jsum(xs)
    out = [x / s for x in xs] if s > 0 and math.isfinite(s) else clean
    return _floor_dist(out)


applyDistribution = apply_distribution


def _reliability_ratios(samples: list, kappa: float) -> list:
    expected = [0.0] * CAL_NB
    observed = [0] * CAL_NB
    for s in samples:
        d = s["dist"]
        for i in range(CAL_NB):
            expected[i] += d[i]
        observed[band_index(s["actual"])] += 1
    return [_clamp((observed[i] + kappa) / (e + kappa), 0.25, 4) for i, e in enumerate(expected)]


def _mean_loss(samples: list, rc: dict) -> list:
    return [log_loss(apply_distribution(s["dist"], rc), s["actual"]) for s in samples]


def _avg(xs: list) -> float:
    return jsum(xs) / len(xs) if xs else 0


# ---------------------------------------------------------- quantile layer

def _pit(dist: list, actual: float) -> float:
    return cdf_at(dist, actual)


def _empirical_quantile(srt: list, q: float) -> float:
    if not srt:
        return q
    pos = (len(srt) - 1) * q
    lo = math.floor(pos)
    hi = math.ceil(pos)
    return srt[lo] + (srt[hi] - srt[lo]) * (pos - lo)


def _fit_levels(pits: list, shrink: float) -> list:
    srt = sorted(pits)
    w = len(pits) / (len(pits) + shrink)
    prev = 0
    out = []
    for q in PUBLISHED_LEVELS:
        target = _empirical_quantile(srt, q)
        mapped = _clamp(q + w * (target - q), 0.02, 0.98)
        mapped = max(mapped, prev + 0.01)
        prev = mapped
        out.append({"q": q, "mapped": _r4(mapped)})
    return out


def _quantile_error(pits: list, levels: list) -> float:
    if not pits:
        return 0
    n = len(pits)
    return _avg([abs(sum(1 for u in pits if u <= l["mapped"]) / n - l["q"]) for l in levels])


def coverage(pits: list, levels: list, q_lo: float = 0.25, q_hi: float = 0.75) -> float:
    lo = next((l["mapped"] for l in levels if l["q"] == q_lo), q_lo)
    hi = next((l["mapped"] for l in levels if l["q"] == q_hi), q_hi)
    return sum(1 for u in pits if lo <= u <= hi) / len(pits) if pits else 0


def map_level(rc: dict, q: float) -> float:
    if not rc.get("quantileActive"):
        return q
    return next((l["mapped"] for l in rc["levels"] if l["q"] == q), q)


mapLevel = map_level


# -------------------------------------------------------------------- fit

def _identity_layer() -> dict:
    return {"active": False, "gamma": 0, "tau": 1, "ratios": [1] * CAL_NB}


def _select_dist_layer(train: list, kappa: float) -> dict:
    ratios = _reliability_ratios(train, kappa)
    identity = _identity_layer()
    best_layer, best_loss = identity, _avg(_mean_loss(train, {**identity, "active": True}))
    for gamma in GAMMAS:
        for tau in TAUS:
            if gamma == 0 and tau == 1:
                continue
            layer = {"active": True, "gamma": gamma, "tau": tau, "ratios": ratios}
            l = _avg(_mean_loss(train, layer))
            if l < best_loss - 1e-9:
                best_layer, best_loss = layer, l
    return best_layer


def fit_recalibrator(inp: list, opts: dict | None = None) -> dict:
    opts = opts or {}
    min_sample = opts.get("minSample", 60)
    kappa = opts.get("kappa", 20)
    shrink = opts.get("shrink", 100)
    samples = []
    for s in inp:
        d = sanitize_dist(s.get("dist"))
        a = s.get("actual")
        if d and _finite(a) and a >= 1:
            samples.append({"dist": d, "actual": a})
    n = len(samples)
    if n < min_sample:
        return identity_recalibrator(f"Collecting evidence: {n}/{min_sample} resolved forecasts before recalibration is fitted.", n)

    folds = []
    for f in (0.5, 0.6, 0.7, 0.8, 0.9):
        start = math.floor(n * f)
        end = n if f == 0.9 else math.floor(n * (f + 0.1))
        folds.append((samples[:start], samples[start:end]))
    identity = _identity_layer()
    id_levels = [{"q": q, "mapped": q} for q in PUBLISHED_LEVELS]

    raw_losses, cal_losses, raw_pits, layer_pits, pit_pairs = [], [], [], [], []
    for train, valid in folds:
        if not train or not valid:
            continue
        layer = _select_dist_layer(train, kappa)
        for s in valid:
            raw_losses.append(log_loss(s["dist"], s["actual"]))
            cal_losses.append(log_loss(apply_distribution(s["dist"], layer), s["actual"]))
            raw_pits.append(_pit(s["dist"], s["actual"]))
        train_pits = [_pit(apply_distribution(s["dist"], layer), s["actual"]) for s in train]
        valid_pits = [_pit(apply_distribution(s["dist"], layer), s["actual"]) for s in valid]
        layer_pits.extend(valid_pits)
        pit_pairs.append({"pits": valid_pits, "levels": _fit_levels(train_pits, shrink)})
    raw_loss = _avg(raw_losses)
    diffs = [l - cal_losses[i] for i, l in enumerate(raw_losses)]
    d_mean = _avg(diffs)
    d_se = jsqrt(_avg([(d - d_mean) ** 2 for d in diffs]) / max(1, len(diffs) - 1))
    dist_active = d_mean > max(1e-4, d_se)
    cal_loss = _avg(cal_losses) if dist_active else raw_loss

    held_pits = layer_pits if dist_active else raw_pits
    err_raw = _quantile_error(held_pits, id_levels)
    err_cand = _avg([_quantile_error(pp["pits"] if dist_active else [], pp["levels"]) for pp in pit_pairs])
    err_cand_raw = err_cand
    if not dist_active:
        pairs = []
        for train, valid in folds:
            if not train or not valid:
                continue
            lv = _fit_levels([_pit(s["dist"], s["actual"]) for s in train], shrink)
            pairs.append(_quantile_error([_pit(s["dist"], s["actual"]) for s in valid], lv))
        err_cand_raw = _avg(pairs)
    err_held = err_cand if dist_active else err_cand_raw
    quantile_active = err_held < err_raw - 0.005

    final_layer = _select_dist_layer(samples, kappa) if dist_active else identity
    dist_layer = final_layer if final_layer["active"] else identity
    effective_active = dist_active and dist_layer["active"]
    all_pits = [_pit(apply_distribution(s["dist"], dist_layer), s["actual"]) for s in samples]
    levels = _fit_levels(all_pits, shrink) if quantile_active else id_levels

    held = len(diffs)
    reason = []
    reason.append(
        f"Distribution recalibrated (γ {js_str(dist_layer['gamma'])}, τ {js_str(dist_layer['tau'])}): rolling-origin held-out log-loss {to_fixed(raw_loss, 4)} → {to_fixed(cal_loss, 4)} on {held} rounds."
        if effective_active
        else f"Raw mixture kept: recalibration did not beat it on {held} rolling-origin held-out rounds by more than one standard error."
    )
    reason.append(
        f"Quantile levels remapped from PITs: held-out calibration error {to_fixed(err_raw * 100, 1)}% → {to_fixed(err_held * 100, 1)}%."
        if quantile_active
        else f"Quantile levels unchanged: held-out calibration error {to_fixed(err_raw * 100, 1)}% (remap would give {to_fixed(err_held * 100, 1)}%)."
    )

    def cov_levels(pp):
        return coverage(pp["pits"], pp["levels"] if quantile_active else id_levels)

    if dist_active:
        cov_cal = _avg([cov_levels(pp) for pp in pit_pairs])
    elif quantile_active:
        cov_cal = coverage(raw_pits, levels)
    else:
        cov_cal = coverage(raw_pits, id_levels)
    return {
        "active": effective_active,
        "quantileActive": quantile_active,
        "gamma": dist_layer["gamma"],
        "tau": dist_layer["tau"],
        "ratios": [_r4(r) for r in dist_layer["ratios"]],
        "levels": levels,
        "sample": n,
        "fitSample": n - held,
        "validSample": held,
        "validRawLogLoss": _r4(raw_loss),
        "validCalLogLoss": _r4(cal_loss if effective_active else raw_loss),
        "improvementPct": _r4(((raw_loss - (cal_loss if effective_active else raw_loss)) / raw_loss) * 100) if raw_loss > 0 else None,
        "coverageRaw": _r4(coverage(raw_pits, id_levels)),
        "coverageCal": _r4(cov_cal),
        "quantileErrRaw": _r4(err_raw),
        "quantileErrCal": _r4(err_held if quantile_active else err_raw),
        "reason": " ".join(reason),
    }


fitRecalibrator = fit_recalibrator


def reliability_table(samples: list, rc: dict) -> list:
    n = len(samples) or 1
    raw = [0.0] * CAL_NB
    cal = [0.0] * CAL_NB
    obs = [0] * CAL_NB
    for s in samples:
        d = sanitize_dist(s.get("dist"))
        if not d:
            continue
        c = apply_distribution(d, rc)
        for i in range(CAL_NB):
            raw[i] += d[i]
            cal[i] += c[i]
        obs[band_index(s["actual"])] += 1
    return [{"band": i, "predictedRaw": _r4(raw[i] / n), "predictedCal": _r4(cal[i] / n), "observed": _r4(obs[i] / n)} for i in range(CAL_NB)]


reliabilityTable = reliability_table
