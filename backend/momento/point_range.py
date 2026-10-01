"""Headline "expected" and range estimators — port of point-range.ts.

Point: median | geomean (exp E[log X]) | trimmed. Interval: central | shortest
(log space). Alternatives replace median/central only when they beat them by
more than ``minSeMultiple`` SE on resolved rounds; ACI adaptive coverage is
kept only when it brings realised coverage closer to nominal at no cost.
"""

from __future__ import annotations

import math

from .calibration import apply_distribution, quantile_at, sanitize_dist
from .jsutil import js_str, jround, jsum, to_fixed

POINT_METHODS = ["median", "geomean", "trimmed"]
INTERVAL_METHODS = ["central", "shortest"]

GRID_N = 199
GRID = [(i + 1) / (GRID_N + 1) for i in range(GRID_N)]


def _mean(xs) -> float:
    return jsum(xs) / len(xs) if xs else 0


def _se_of(xs: list) -> float:
    if len(xs) < 2:
        return math.inf
    m = _mean(xs)
    return math.sqrt(jsum((x - m) ** 2 for x in xs) / (len(xs) - 1) / len(xs))


def _log_grid(qf) -> list:
    prev = 0
    out = []
    for q in GRID:
        v = math.log(max(1, qf(q)))
        prev = max(prev, v if math.isfinite(v) else prev)
        out.append(prev)
    return out


def point_estimate(qf, method: str) -> float:
    if method == "median":
        return max(1, qf(0.5))
    lg = _log_grid(qf)
    if method == "geomean":
        return math.exp(_mean(lg))
    lo = math.floor(GRID_N * 0.1)
    hi = math.ceil(GRID_N * 0.9)
    return math.exp(_mean(lg[lo:hi]))


pointEstimate = point_estimate


def interval(qf, coverage: float, method: str) -> list:
    c = min(0.98, max(0.05, coverage))
    if method == "central":
        return [max(1, qf((1 - c) / 2)), max(1, qf((1 + c) / 2))]
    lg = _log_grid(qf)
    k = max(1, int(jround(c * (GRID_N + 1))))
    best = 0
    best_w = math.inf
    i = 0
    while i + k < GRID_N:
        w = lg[i + k] - lg[i]
        if w < best_w - 1e-12:
            best_w = w
            best = i
        i += 1
    if not math.isfinite(best_w):
        return interval(qf, c, "central")
    return [math.exp(lg[best]), math.exp(lg[min(GRID_N - 1, best + k)])]


def point_loss(pred: float, actual: float) -> float:
    return (math.log(max(1, actual)) - math.log(max(1, pred))) ** 2


pointLoss = point_loss


def interval_score(lo: float, hi: float, actual: float, coverage: float) -> float:
    a = 1 - coverage
    L = math.log(max(1, lo))
    H = math.log(max(1, hi))
    y = math.log(max(1, actual))
    return H - L + (2 / a) * (max(0, L - y) + max(0, y - H))


intervalScore = interval_score


def default_selection(nominal: float, reason: str, sample: int = 0) -> dict:
    return {
        "pointMethod": "median", "intervalMethod": "central", "coverage": nominal, "nominal": nominal,
        "adaptive": False, "sample": sample, "pointScores": [], "intervalScores": [],
        "realisedCoverage": None, "reason": reason,
    }


defaultSelection = default_selection


def select_point_range(inp, rc: dict, opts: dict) -> dict:
    nominal = min(0.95, max(0.1, opts["nominal"]))
    min_sample = opts.get("minSample") if opts.get("minSample") is not None else 100
    window = opts.get("window") if opts.get("window") is not None else 600
    k = opts.get("minSeMultiple") if opts.get("minSeMultiple") is not None else 1
    rows = []
    for s in list(inp)[-window:] if window else list(inp):
        d = sanitize_dist((s or {}).get("dist"))
        a = (s or {}).get("actual")
        if not d or not isinstance(a, (int, float)) or not math.isfinite(a) or a < 1:
            continue
        pub = apply_distribution(d, rc)
        rows.append({"qf": (lambda p: (lambda q: quantile_at(p, q)))(pub), "actual": a})
    forced_point = opts.get("pointMethod") if opts.get("pointMethod") in POINT_METHODS else None
    forced_interval = opts.get("intervalMethod") if opts.get("intervalMethod") in INTERVAL_METHODS else None
    if len(rows) < min_sample:
        sel = default_selection(nominal, f"Median and equal-tailed range kept: {len(rows)}/{js_str(min_sample)} resolved rounds before methods are compared.", len(rows))
        return {**sel, "pointMethod": forced_point or "median", "intervalMethod": forced_interval or "central"}

    p_loss = {m: [] for m in POINT_METHODS}
    for r in rows:
        for m in POINT_METHODS:
            p_loss[m].append(point_loss(point_estimate(r["qf"], m), r["actual"]))
    point_scores = []
    for m in POINT_METHODS:
        diffs = [b - p_loss[m][i] for i, b in enumerate(p_loss["median"])]
        point_scores.append({"method": m, "loss": _mean(p_loss[m]), "gainVsDefault": _mean(diffs), "se": 0 if m == "median" else _se_of(diffs)})
    point_method = "median"
    if forced_point:
        point_method = forced_point
    else:
        earned = [s for s in point_scores if s["method"] != "median" and s["gainVsDefault"] > 0 and s["gainVsDefault"] > k * s["se"]]
        if earned:
            point_method = sorted(earned, key=lambda s: s["loss"])[0]["method"]

    i_loss = {m: [] for m in INTERVAL_METHODS}
    for r in rows:
        for m in INTERVAL_METHODS:
            lo, hi = interval(r["qf"], nominal, m)
            i_loss[m].append(interval_score(lo, hi, r["actual"], nominal))
    interval_scores = []
    for m in INTERVAL_METHODS:
        diffs = [b - i_loss[m][i] for i, b in enumerate(i_loss["central"])]
        interval_scores.append({"method": m, "loss": _mean(i_loss[m]), "gainVsDefault": _mean(diffs), "se": 0 if m == "central" else _se_of(diffs)})
    interval_method = "central"
    if forced_interval:
        interval_method = forced_interval
    else:
        s = next(x for x in interval_scores if x["method"] == "shortest")
        if s["gainVsDefault"] > 0 and s["gainVsDefault"] > k * s["se"]:
            interval_method = "shortest"

    allow_adaptive = opts.get("adaptive") is not False
    gamma = opts.get("gamma") if opts.get("gamma") is not None else 0.01
    max_shift = min(0.3, max(0, opts.get("maxShift") if opts.get("maxShift") is not None else 0.15))
    level = nominal
    hits_a = hits_f = 0
    score_a, score_f = [], []
    for r in rows:
        la, ha = interval(r["qf"], level, interval_method)
        lf, hf = interval(r["qf"], nominal, interval_method)
        in_a = 1 if la <= r["actual"] <= ha else 0
        hits_a += in_a
        hits_f += 1 if lf <= r["actual"] <= hf else 0
        score_a.append(interval_score(la, ha, r["actual"], nominal))
        score_f.append(interval_score(lf, hf, r["actual"], nominal))
        level = min(min(0.97, nominal + max_shift), max(max(0.05, nominal - max_shift), level + gamma * (nominal - in_a)))
    n = len(rows)
    cov_err_a = abs(hits_a / n - nominal)
    cov_err_f = abs(hits_f / n - nominal)
    costs = [a - score_f[i] for i, a in enumerate(score_a)]
    adaptive = allow_adaptive and cov_err_a < cov_err_f - 0.01 and _mean(costs) < _se_of(costs)
    coverage = level if adaptive else nominal
    hits = hits_a if adaptive else hits_f

    def fmt(x):
        return to_fixed(x, 4)

    ps = next(s for s in point_scores if s["method"] == point_method)
    is_ = next(s for s in interval_scores if s["method"] == interval_method)
    by = "set by operator"
    parts = [
        ("Expected = median (set by operator)." if forced_point else
         f"Expected = median: no alternative beat it by more than {js_str(k)} SE in squared log error on {n} resolved rounds.")
        if point_method == "median" else
        f"Expected = {point_method} ({by if forced_point else 'earned'}): squared log error {fmt(ps['loss'])} vs median {fmt(point_scores[0]['loss'])} on {n} resolved rounds.",
        ("Range = equal-tailed (set by operator)." if forced_interval else
         "Range = equal-tailed: the shortest interval did not earn a better interval score.")
        if interval_method == "central" else
        f"Range = shortest log-interval ({by if forced_interval else 'earned'}): interval score {fmt(is_['loss'])} vs {fmt(interval_scores[0]['loss'])}.",
        f"Coverage level {to_fixed(coverage * 100, 1)}% (nominal {to_fixed(nominal * 100, 0)}%, adapted to recent misses; realised {to_fixed(hits / n * 100, 1)}% vs {to_fixed(hits_f / n * 100, 1)}% fixed)."
        if adaptive else
        f"Coverage level fixed at {to_fixed(nominal * 100, 0)}% (realised {to_fixed(hits_f / n * 100, 1)}%"
        + (f"; adaptive level {to_fixed(hits_a / n * 100, 1)}% not earned" if allow_adaptive else "") + ").",
    ]
    return {
        "pointMethod": point_method, "intervalMethod": interval_method, "coverage": coverage, "nominal": nominal,
        "adaptive": adaptive, "sample": n, "pointScores": point_scores, "intervalScores": interval_scores,
        "realisedCoverage": hits / n, "reason": " ".join(parts),
    }


selectPointRange = select_point_range
