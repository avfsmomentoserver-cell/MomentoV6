"""Chart Lab analogue engine + fair precision test — port of analogue.ts.

The fair baseline for Chart Lab's median continuation is the same median over
K random past windows (not a flat path, which a skewed median always beats).
"""

from __future__ import annotations

import math

from .analysis import BAND_EDGES, band_index
from .jsutil import js_str, jround, jsum, to_fixed

NB = len(BAND_EDGES) + 1
LOG_CAP = math.log(1000)


def _lx(m: float) -> float:
    return min(math.log(max(1, m)), LOG_CAP)


def _zscore(p: list) -> list:
    m = jsum(p) / len(p)
    sd = math.sqrt(jsum((b - m) ** 2 for b in p) / len(p)) or 1
    return [(v - m) / sd for v in p]


def nearest_analogues(x: list, mu: float, opts: dict, horizon: int = 1) -> list:
    n = len(x)
    W = opts["window"]
    if n < W + horizon + 50:
        return []
    pre = [0.0] * (n + 1)
    for i in range(n):
        pre[i + 1] = pre[i] + (x[i] - mu)

    def path_of(end):
        base = pre[end - W]
        return [pre[end - W + j] - base for j in range(W + 1)]

    cur = path_of(n)
    cz = _zscore(cur)
    lo = max(W, n - opts["scanLimit"])
    cands = []
    for e in range(lo, n - horizon + 1):
        p = path_of(e)
        pz = _zscore(p)
        d = 0
        for j in range(len(pz)):
            d += (pz[j] - cz[j]) ** 2
        d += 0.5 * (p[W] - cur[W]) ** 2
        cands.append((e, d))
    cands.sort(key=lambda c: c[1])
    return [c[0] for c in cands[: min(opts["k"], len(cands))]]


nearestAnalogues = nearest_analogues


def analogue_next_dist(multipliers: list, opts: dict | None = None) -> list:
    opts = opts or {}
    window = 30 if opts.get("window") is None else opts["window"]
    k = 40 if opts.get("k") is None else opts["k"]
    scan_limit = 6000 if opts.get("scanLimit") is None else opts["scanLimit"]
    shrink = 20 if opts.get("shrink") is None else opts["shrink"]
    n = len(multipliers)
    base = [1] * NB
    tail_n = max(scan_limit, 2000)
    for m in multipliers[-tail_n:] if tail_n else multipliers:
        base[band_index(m)] += 1
    bs = sum(base)
    base_dist = [c / bs for c in base]
    if n < window + 60:
        return base_dist
    x = [_lx(m) for m in multipliers]
    mu = jsum(x) / n
    ends = nearest_analogues(x, mu, {"window": window, "k": k, "scanLimit": scan_limit}, 1)
    if not ends:
        return base_dist
    counts = [0] * NB
    for e in ends:
        counts[band_index(multipliers[e])] += 1
    tot = len(ends) + shrink
    return [(c + shrink * base_dist[i]) / tot for i, c in enumerate(counts)]


analogueNextDist = analogue_next_dist


# ------------------------------------------------------------ precision test

_M32 = 0xFFFFFFFF


def _imul(a: int, b: int) -> int:
    return (a * b) & _M32


def mulberry(seed: int):
    state = [seed & _M32]

    def rnd() -> float:
        state[0] = (state[0] + 0x6D2B79F5) & _M32
        t = state[0]
        t = _imul(t ^ (t >> 15), t | 1)
        t ^= (t + _imul(t ^ (t >> 7), t | 61)) & _M32
        return ((t ^ (t >> 14)) & _M32) / 4294967296

    return rnd


def _median(xs: list) -> float:
    s = sorted(xs)
    m = (len(s) - 1) / 2
    return (s[math.floor(m)] + s[math.ceil(m)]) / 2


def _mean(xs) -> float:
    return jsum(xs) / len(xs) if xs else 0


def _se_of(xs) -> float:
    if len(xs) < 2:
        return math.inf
    m = _mean(xs)
    return math.sqrt(jsum((v - m) ** 2 for v in xs) / (len(xs) - 1) / len(xs))


def _r4(v: float) -> float:
    return jround(v * 1e4) / 1e4


def chart_lab_precision(multipliers: list, opts: dict | None = None) -> dict:
    opts = opts or {}

    def o(key, d):
        v = opts.get(key)
        return d if v is None else v

    W, H, K = o("window", 30), o("horizon", 20), o("k", 40)
    scan_limit, want, min_history = o("scanLimit", 6000), o("anchors", 150), o("minHistory", 1500)
    rnd = mulberry(o("seed", 17))
    n = len(multipliers)
    x = [_lx(m) for m in multipliers]
    step = max(H, math.floor((n - min_history - H) / want))
    gM, gF, gR, llA, llB = [], [], [], [], []
    end = min_history
    while end + H <= n and len(gM) < want:
        hx = x[:end]
        mu = _mean(hx)
        ends = nearest_analogues(hx, mu, {"window": W, "k": K, "scanLimit": scan_limit}, H)
        if len(ends) < 5:
            end += step
            continue

        def cont_of(e):
            out, s = [], 0
            for h in range(H):
                s += hx[e + h] - mu
                out.append(s)
            return out

        lo = max(W, end - scan_limit)
        random_ends = [lo + math.floor(rnd() * max(1, end - H - lo)) for _ in ends]
        conts = [cont_of(e) for e in ends]
        rconts = [cont_of(e) for e in random_ends]
        m_path = [_median([c[h] for c in conts]) for h in range(H)]
        r_path = [_median([c[h] for c in rconts]) for h in range(H)]
        s = aM = aF = aR = 0
        for h in range(H):
            s += x[end + h] - mu
            aM += abs(m_path[h] - s)
            aF += abs(0 - s)
            aR += abs(r_path[h] - s)
        gM.append(aM / H)
        gF.append(aF / H)
        gR.append(aR / H)
        dist = analogue_next_dist(multipliers[:end], {"window": W, "k": K, "scanLimit": scan_limit})
        base = [1] * NB
        for m in multipliers[max(0, end - max(scan_limit, 2000)):end]:
            base[band_index(m)] += 1
        bs = sum(base)
        b = band_index(multipliers[end])
        llA.append(-math.log(max(1e-6, dist[b])))
        llB.append(-math.log(max(1e-6, base[b] / bs)))
        end += step
    mae_model, mae_flat, mae_random = _mean(gM), _mean(gF), _mean(gR)
    gains_r = [r - gM[i] for i, r in enumerate(gR)]
    gains_n = [b - llA[i] for i, b in enumerate(llB)]
    gvr, gvr_se = _mean(gains_r), _se_of(gains_r)
    ng, ng_se = _mean(gains_n), _se_of(gains_n)
    enough = len(gM) >= 30
    precise = enough and gvr > gvr_se and ng > ng_se
    svf = _r4(1 - mae_model / mae_flat if mae_flat else 0)
    svr = _r4(1 - mae_model / mae_random if mae_random else 0)

    def fse(v):
        return js_str(_r4(v)) if math.isfinite(v) else "∞"

    return {
        "anchors": len(gM), "window": W, "horizon": H, "k": K,
        "maeModel": _r4(mae_model), "maeFlat": _r4(mae_flat), "skillVsFlat": svf,
        "maeRandom": _r4(mae_random), "skillVsRandom": svr,
        "gainVsRandom": _r4(gvr), "gainVsRandomSe": _r4(gvr_se) if math.isfinite(gvr_se) else -1,
        "nextLogLoss": _r4(_mean(llA)), "nextLogLossBase": _r4(_mean(llB)),
        "nextGain": _r4(ng), "nextGainSe": _r4(ng_se) if math.isfinite(ng_se) else -1,
        "verdict": "insufficient-data" if not enough else ("more-precise" if precise else "not-more-precise"),
        "reason": (f"Only {len(gM)} walk-forward anchors; at least 30 are needed." if not enough else
                   f"Skill vs flat path {to_fixed(svf * 100, 1)}%, vs random-window median {to_fixed(svr * 100, 1)}% "
                   f"(gain {js_str(_r4(gvr))} ± {fse(gvr_se)} SE); "
                   f"next-round log loss {js_str(_r4(_mean(llA)))} vs base {js_str(_r4(_mean(llB)))} (gain {js_str(_r4(ng))} ± {fse(ng_se)} SE) over {len(gM)} anchors."),
    }


chartLabPrecision = chart_lab_precision
