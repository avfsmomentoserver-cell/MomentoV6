"""Momento v6.5 "Platform Book" engines — port of v65.ts (pure, side-effect free).

Causal (only rounds before the decision point are read), deterministic (seeded
RNG) and uncertainty-reporting (Wilson / block-bootstrap CIs, BH q):

  F-01 integrity            F-07 sequence search      F-11 signal significance
  F-13 regime weights       F-14 forecast diff        F-16 counterfactual
  F-17 reliability / PIT / ACI                        F-26/27/29 survival & ETA
  F-31 Kelly tells          F-32 bankroll simulator   F-34 experiment runner
  F-36 fairness battery + provably-fair verification  F-03 CUSUM fingerprint
  F-10 cross-source comparison                        F-12 custom engine families
"""

from __future__ import annotations

import hashlib
import hmac as _hmac
import json
import math
import re

from .analysis import BAND_EDGES, BAND_LABELS, band_index
from .clock import parse_iso_ms
from .jsutil import js_str, jround, jsum, r2, r3, r4, to_fixed

NB = len(BAND_LABELS)
EDGES = [1, *BAND_EDGES, math.inf]
ETA_THRESHOLDS = (2, 5, 10, 20, 50, 100)


# ------------------------------------------------------------------ numerics

def clamp(x, lo=0, hi=1):
    return min(hi, max(lo, x))


def mean(xs) -> float:
    return jsum(xs) / len(xs) if xs else 0


def median(xs) -> float:
    if not xs:
        return 0
    s = sorted(xs)
    m = len(s) >> 1
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


def quantile(srt, q) -> float:
    if not srt:
        return 0
    pos = clamp(q) * (len(srt) - 1)
    lo = math.floor(pos)
    hi = math.ceil(pos)
    return srt[lo] + (srt[hi] - srt[lo]) * (pos - lo)


_M32 = 0xFFFFFFFF


def rng(seed: int = 42):
    """Deterministic PRNG (mulberry32) — bit-identical to the archive."""
    st = [int(seed) & _M32]

    def nxt() -> float:
        st[0] = (st[0] + 0x6D2B79F5) & _M32
        t = st[0]
        t = ((t ^ (t >> 15)) * (t | 1)) & _M32
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & _M32)) & _M32
        return ((t ^ (t >> 14)) & _M32) / 4294967296

    return nxt


def norm_cdf(z: float) -> float:
    t = 1 / (1 + 0.3275911 * abs(z) / math.sqrt(2))
    y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * math.exp(-(z * z) / 2)
    return 0.5 * (1 + y) if z >= 0 else 0.5 * (1 - y)


normCdf = norm_cdf


def two_sided_p(z: float) -> float:
    return 2 * (1 - norm_cdf(abs(z)))


twoSidedP = two_sided_p


def wilson_ci(h, n, z=1.96) -> list:
    if n <= 0:
        return [0, 1]
    p = h / n
    d = 1 + (z * z) / n
    c = p + (z * z) / (2 * n)
    w = z * math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
    return [clamp((c - w) / d), clamp((c + w) / d)]


wilsonCI = wilson_ci


def bh_q(ps) -> list:
    m = len(ps)
    idx = sorted([(p, i) for i, p in enumerate(ps)], key=lambda t: t[0])
    q = [1] * m
    prev = 1
    for k in range(m - 1, -1, -1):
        p, i = idx[k]
        prev = min(prev, (p * m) / (k + 1))
        q[i] = clamp(prev)
    return q


bhQ = bh_q


def two_prop(h1, n1, h2, n2) -> dict:
    if n1 <= 0 or n2 <= 0:
        return {"z": 0, "p": 1, "diff": 0, "lo": 0, "hi": 0}
    p1 = h1 / n1
    p2 = h2 / n2
    pp = (h1 + h2) / (n1 + n2)
    se = math.sqrt(pp * (1 - pp) * (1 / n1 + 1 / n2)) or 1e-9
    z = (p1 - p2) / se
    se_d = math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2) or 1e-9
    return {"z": z, "p": two_sided_p(z), "diff": p1 - p2, "lo": p1 - p2 - 1.96 * se_d, "hi": p1 - p2 + 1.96 * se_d}


twoProp = two_prop


def block_bootstrap_ci(xs, opts: dict | None = None) -> list:
    opts = opts or {}
    n = len(xs)
    if n < 5:
        return [math.nan, math.nan]
    blk = opts.get("block") if opts.get("block") is not None else jround(math.sqrt(n))
    block = int(max(1, min(blk, n // 2)))
    B = opts.get("B") if opts.get("B") is not None else 400
    r = rng(opts.get("seed") if opts.get("seed") is not None else 7)
    nb = math.ceil(n / block)
    means = []
    for _ in range(B):
        s = 0
        c = 0
        for _k in range(nb):
            start = math.floor(r() * (n - block + 1))
            j = 0
            while j < block and c < n:
                s += xs[start + j]
                j += 1
                c += 1
        means.append(s / c)
    means.sort()
    a = opts.get("alpha") if opts.get("alpha") is not None else 0.05
    return [quantile(means, a / 2), quantile(means, 1 - a / 2)]


blockBootstrapCI = block_bootstrap_ci


def median_interval_ms(rounds) -> float:
    d = []
    for i in range(max(1, len(rounds) - 2000), len(rounds)):
        x = rounds[i].tsMs - rounds[i - 1].tsMs
        if 0 < x < 30 * 60_000:
            d.append(x)
    return median(d) if d else 10_000


medianIntervalMs = median_interval_ms


def survival_from_dist(dist, x) -> float:
    s = 0
    for i in range(NB - 1, -1, -1):
        lo = EDGES[i]
        hi = EDGES[i + 1]
        if x <= lo:
            s += dist[i]
        elif x < hi:
            hi_f = hi if math.isfinite(hi) else lo * 10
            frac = clamp((1 / x - 1 / hi_f) / (1 / lo - 1 / hi_f))
            s += dist[i] * frac
    return clamp(s)


survivalFromDist = survival_from_dist


def quantile_from_dist(dist, q) -> float:
    c = 0
    for i in range(NB):
        nxt = c + dist[i]
        if nxt >= q or i == NB - 1:
            lo = EDGES[i]
            hi = EDGES[i + 1] if math.isfinite(EDGES[i + 1]) else lo * 10
            f = clamp((q - c) / dist[i]) if dist[i] > 0 else 0.5
            inv = 1 / lo - f * (1 / lo - 1 / hi)
            return max(1, 1 / inv)
        c = nxt
    return 1


quantileFromDist = quantile_from_dist


def band_shares(ms) -> list:
    c = [0] * NB
    for m in ms:
        c[band_index(m)] += 1
    n = len(ms) or 1
    return [x / n for x in c]


bandShares = band_shares


def _origin(r) -> str | None:
    return getattr(r, "origin", None)


# ================================================================= F-01

def integrity_report(rounds, opts: dict | None = None) -> dict:
    opts = opts or {}
    low = opts.get("low") if opts.get("low") is not None else 1.2
    gf = opts.get("gapFactor") if opts.get("gapFactor") is not None else 2.5
    observed_all = [r for r in rounds if _origin(r) != "reconstructed"]
    ref_low = sum(1 for r in observed_all if r.multiplier < low) / len(observed_all) if observed_all else 0.19
    law_low = 1 - 0.97 / low
    ref = max(ref_low, law_low)
    groups: dict[str, list] = {}
    synthetic = 0
    prev = None
    for r in rounds:
        if r.sessionId is not None:
            key = f"{r.source}#{js_str(r.sessionId)}"
        else:
            if not prev or r.tsMs - prev.tsMs > 30 * 60_000 or prev.source != r.source:
                synthetic += 1
            key = f"{r.source}~{synthetic}"
        groups.setdefault(key, []).append(r)
        prev = r
    sessions = []
    fair_map = opts.get("fairMatch") or {}
    agr_map = opts.get("agreement") or {}
    for key, rs in groups.items():
        if len(rs) < 5:
            continue
        rs.sort(key=lambda r: r.tsMs)
        obs = [r for r in rs if _origin(r) != "reconstructed"]
        med = median_interval_ms(obs if len(obs) > 5 else rs)
        gaps = []
        est = 0
        for i in range(1, len(obs)):
            dt = obs[i].tsMs - obs[i - 1].tsMs
            if dt > gf * med:
                miss = max(0, jround(dt / med) - 1)
                est += miss
                gaps.append({"fromTs": obs[i - 1].ts, "toTs": obs[i].ts, "seconds": jround(dt / 1000), "estMissing": miss})
        completeness = len(obs) / ((len(obs) + est) or 1)
        lows = sum(1 for r in obs if r.multiplier < low)
        share = lows / len(obs) if obs else 0
        se = math.sqrt((ref * (1 - ref)) / max(1, len(obs)))
        z = (share - ref) / (se or 1e-9)
        low_score = clamp(share / (ref or 1))
        sid = re.split(r"[#~]", key)[1]
        fair = fair_map.get(key)
        agr = agr_map.get(key)
        comps = [(completeness, 0.4), (max(1e-3, low_score if z < -2 else 1), 0.3)]
        if fair is not None:
            comps.append((max(1e-3, fair), 0.2))
        if agr is not None:
            comps.append((max(1e-3, agr), 0.1))
        wsum = jsum(c[1] for c in comps)
        acc = 0
        for v, w in comps:
            acc = acc + w * math.log(max(1e-6, v))
        integ = math.exp(acc / wsum)
        sessions.append({
            "sessionId": int(sid) if re.fullmatch(r"\d+", sid) else sid,
            "source": rs[0].source, "from": rs[0].ts, "to": rs[-1].ts, "rounds": len(rs), "observed": len(obs),
            "reconstructed": len(rs) - len(obs), "medianIntervalMs": jround(med), "gaps": gaps[:200], "estMissing": est,
            "completeness": r4(completeness), "lowShare": r4(share), "lowShareRef": r4(ref), "lowShareZ": r2(z),
            "lowShareCI": [r4(v) for v in wilson_ci(lows, len(obs))], "lowScore": r4(low_score),
            "fairMatch": fair, "agreement": agr, "integrity": r4(integ),
            "voidWindows": sum(1 for g in gaps if g["estMissing"] >= 1),
        })
    sessions.sort(key=lambda s: -(parse_iso_ms(s["from"]) or 0))
    tot_obs = sum(s["observed"] for s in sessions)
    tot_miss = sum(s["estMissing"] for s in sessions)
    acc = 0
    for s in sessions:
        acc = acc + s["integrity"] * s["observed"]
    w_int = acc / tot_obs if tot_obs else 0
    return {
        "sessions": sessions,
        "summary": {
            "sessions": len(sessions), "observed": tot_obs, "estMissing": tot_miss,
            "completeness": r4(tot_obs / ((tot_obs + tot_miss) or 1)), "integrity": r4(w_int),
            "highQuality": sum(1 for s in sessions if s["integrity"] >= 0.95),
            "lowShareRef": r4(ref), "lawLowShare": r4(law_low), "tapeLowShare": r4(ref_low),
            "p2x2": r4((sum(1 for r in observed_all if r.multiplier >= 2) / (len(observed_all) or 1)) * 2),
            "voidWindows": sum(s["voidWindows"] for s in sessions),
            "note": (f"Observed share below {js_str(low)}× is {to_fixed(ref_low * 100, 1)}% vs {to_fixed(law_low * 100, 1)}% under the fair law — low rounds are probably being missed by the collector, which biases every probability upward."
                     if ref_low < law_low - 0.01 else
                     f"Low-round share is consistent with the fair law ({to_fixed(ref_low * 100, 1)}% vs {to_fixed(law_low * 100, 1)}%)."),
        },
    }


integrityReport = integrity_report


def is_void_window(rounds, from_idx, to_idx, med_ms, gf=2.5) -> bool:
    i = max(1, from_idx + 1)
    while i <= to_idx and i < len(rounds):
        dt = rounds[i].tsMs - rounds[i - 1].tsMs
        if dt > gf * med_ms and jround(dt / med_ms) - 1 >= 1:
            return True
        if _origin(rounds[i]) == "reconstructed":
            return True
        i += 1
    return False


isVoidWindow = is_void_window

# ================================================================= F-11

SIGNALS = [
    {"key": "last_low", "label": "Last < 1.2×", "describe": "The previous round crashed below 1.2×"},
    {"key": "last_big", "label": "Last ≥ 10×", "describe": "The previous round reached 10×"},
    {"key": "last_mid", "label": "Last in 1.5–2×", "describe": "The previous round landed in 1.5–2×"},
    {"key": "last_5", "label": "Last ≥ 5×", "describe": "The previous round reached 5×"},
    {"key": "two_low", "label": "2 below 2× in a row", "describe": "The last 2 rounds were both below 2×"},
    {"key": "three_low", "label": "3 below 2× in a row", "describe": "The last 3 rounds were all below 2×"},
    {"key": "five_low", "label": "5+ below 2× streak", "describe": "A below-2× streak of at least 5"},
    {"key": "two_high", "label": "2 above 2× in a row", "describe": "The last 2 rounds were both ≥ 2×"},
    {"key": "cold10", "label": "Cold tape (mean10 < 1.8)", "describe": "Geometric mean of the last 10 below 1.8×"},
    {"key": "dry20", "label": "Dry run (max20 < 5×)", "describe": "No 5× in the last 20 rounds"},
    {"key": "overdue10", "label": "10× overdue (gap > median)", "describe": "Rounds since the last 10× exceed its median gap"},
    {"key": "overdue10_p90", "label": "10× deeply overdue (> p90)", "describe": "Rounds since the last 10× exceed its 90th-percentile gap"},
    {"key": "overdue50", "label": "50× overdue (gap > median)", "describe": "Rounds since the last 50× exceed its median gap"},
    {"key": "zigzag", "label": "Zig-zag lo/hi/lo", "describe": "Alternating <2× / ≥2× / <2×"},
]


def _tail(xs, w):
    """JS xs.slice(-w)."""
    return xs[int(-w):]


def _at(xs, i, default):
    return xs[i] if 0 <= i < len(xs) else default


def _jsign(x):
    if x != x:
        return math.nan
    return 1 if x > 0 else -1 if x < 0 else 0


def _sig(z):
    return 1 / (1 + _jexp(-z))


def _jexp(x):
    try:
        return math.exp(x)
    except OverflowError:
        return math.inf


def signal_matrix(ms, med_gap10, p90_gap10, med_gap50) -> dict:
    from collections import deque
    n = len(ms)
    active = [bytearray(n + 1) for _ in SIGNALS]
    low_run = high_run = since10 = since50 = 0
    logs: deque = deque()
    log_sum = 0
    win: deque = deque()
    for i in range(n + 1):
        if i > 0:
            last = ms[i - 1]
            vals = (
                last < 1.2, last >= 10, 1.5 <= last < 2, last >= 5,
                low_run >= 2, low_run >= 3, low_run >= 5, high_run >= 2,
                len(logs) >= 10 and math.exp(log_sum / 10) < 1.8,
                len(win) >= 20 and max(win) < 5,
                since10 > med_gap10, since10 > p90_gap10, since50 > med_gap50,
                i >= 3 and ms[i - 3] < 2 and ms[i - 2] >= 2 and ms[i - 1] < 2,
            )
            for s, v in enumerate(vals):
                active[s][i] = 1 if v else 0
        if i == n:
            break
        m = ms[i]
        if m < 2:
            low_run += 1
            high_run = 0
        else:
            high_run += 1
            low_run = 0
        since10 = 0 if m >= 10 else since10 + 1
        since50 = 0 if m >= 50 else since50 + 1
        lg = math.log(m)
        logs.append(lg)
        log_sum += lg
        if len(logs) > 10:
            log_sum -= logs.popleft()
        win.append(m)
        if len(win) > 20:
            win.popleft()
    return {"active": active, "current": [active[s][n] == 1 for s in range(len(SIGNALS))]}


signalMatrix = signal_matrix


def gaps_between(ms, T) -> dict:
    gaps = []
    run = 0
    seen = False
    for m in ms:
        if m >= T:
            if seen:
                gaps.append(run)
            seen = True
            run = 0
        else:
            run += 1
    return {"gaps": gaps, "current": run}


gapsBetween = gaps_between


def _obs_ms(rounds):
    return [r.multiplier for r in rounds if _origin(r) != "reconstructed"]


def signal_significance(rounds, opts: dict | None = None) -> dict:
    opts = opts or {}
    T = opts.get("T") if opts.get("T") is not None else 2
    ms = _tail(_obs_ms(rounds), opts.get("window") if opts.get("window") is not None else 20000)
    g10 = sorted(gaps_between(ms, 10)["gaps"])
    g50 = sorted(gaps_between(ms, 50)["gaps"])
    med_gap10 = quantile(g10, 0.5) if g10 else 10
    p90_gap10 = quantile(g10, 0.9) if g10 else 30
    med_gap50 = quantile(g50, 0.5) if g50 else 50
    sm = signal_matrix(ms, med_gap10, p90_gap10, med_gap50)
    active, current = sm["active"], sm["current"]
    n = len(ms)
    hits_all = sum(1 for m in ms if m >= T)
    base = hits_all / (n or 1)
    half = n // 2
    rows = []
    for si, s in enumerate(SIGNALS):
        na = ha = na1 = ha1 = na2 = ha2 = 0
        act = active[si]
        for i in range(1, n):
            if not act[i]:
                continue
            hit = 1 if ms[i] >= T else 0
            na += 1
            ha += hit
            if i < half:
                na1 += 1
                ha1 += hit
            else:
                na2 += 1
                ha2 += hit
        rate = ha / na if na else 0
        lo, hi = wilson_ci(ha, na)
        t = two_prop(ha, na, hits_all - ha, n - na)
        rows.append({
            "key": s["key"], "label": s["label"], "describe": s["describe"], "active": current[si],
            "n": na, "hits": ha, "rate": r4(rate), "base": r4(base),
            "lift": r4(rate / base if base else 0), "liftLo": r4(lo / base if base else 0), "liftHi": r4(hi / base if base else 0),
            "p": t["p"], "block1": {"n": na1, "rate": r4(ha1 / na1 if na1 else 0)},
            "block2": {"n": na2, "rate": r4(ha2 / na2 if na2 else 0)}, "q": 1, "significant": False,
        })
    qs = bh_q([r["p"] for r in rows])
    for i, r in enumerate(rows):
        r["q"] = r4(qs[i])
        r["p"] = r4(r["p"])
        r["significant"] = qs[i] < 0.05 and r["n"] >= 30
    persist = [
        _jsign(r["block1"]["rate"] - base) == _jsign(r["block2"]["rate"] - base) and r["block2"]["n"] >= 30
        for r in rows if r["significant"]
    ]
    return {
        "target": T, "window": n, "base": r4(base), "rows": rows,
        "significantCount": sum(1 for r in rows if r["significant"]),
        "persistence": r4(sum(1 for p in persist if p) / len(persist)) if persist else None,
        "note": f"Lift of P(next ≥ {js_str(T)}×) when each signal is on, vs the {to_fixed(base * 100, 1)}% base rate over {n:,} rounds. Coloured only when BH q < 0.05 across all {len(SIGNALS)} signals; grey = no evidence.",
    }


signalSignificance = signal_significance


def shuffled_significance(rounds, T=2, seed=3) -> dict:
    from dataclasses import replace
    r = rng(seed)
    xs = [replace(x) for x in rounds]
    ms = [x.multiplier for x in xs]
    for i in range(len(ms) - 1, 0, -1):
        j = math.floor(r() * (i + 1))
        ms[i], ms[j] = ms[j], ms[i]
    for i, x in enumerate(xs):
        x.multiplier = ms[i]
    return signal_significance(xs, {"T": T})


shuffledSignificance = shuffled_significance


# ================================================================= F-26 / F-27 / F-29

def km_curve(gaps, max_k=None) -> dict:
    K = int(max(1, max_k if max_k is not None else (max(gaps) + 1 if gaps else 1)))
    events = [0] * (K + 1)
    for g in gaps:
        if g <= K:
            events[g] += 1
    S = [1]
    hazard = []
    at_risk = []
    risk = len(gaps)
    s = 1
    for k in range(K + 1):
        h = events[k] / risk if risk > 0 else 0
        hazard.append(h)
        at_risk.append(risk)
        s *= 1 - h
        S.append(s)
        risk -= events[k]
    return {"S": S, "hazard": hazard, "atRisk": at_risk}


kmCurve = km_curve


def _fit_logistic_hazard(gaps) -> dict:
    K = min(2000, max(gaps)) if gaps else 0
    R = [0] * (K + 1)
    E = [0] * (K + 1)
    # R[k] = #gaps with min(g,K) >= k  (suffix count, O(n + K))
    cnt = [0] * (K + 2)
    for g in gaps:
        gg = min(g, K)
        cnt[gg] += 1
        E[gg] += 1
    acc = 0
    for k in range(K, -1, -1):
        acc += cnt[k]
        R[k] = acc
    xs = [math.log(1 + k) for k in range(K + 1)]
    b0 = b1 = 0.0
    info11 = 1
    for _ in range(30):
        g0 = g1 = h00 = h01 = h11 = 0
        for k in range(K + 1):
            if not R[k]:
                continue
            x = xs[k]
            p = 1 / (1 + _jexp(-(b0 + b1 * x)))
            g0 += E[k] - R[k] * p
            g1 += (E[k] - R[k] * p) * x
            w = R[k] * p * (1 - p)
            h00 += w
            h01 += w * x
            h11 += w * x * x
        det = (h00 * h11 - h01 * h01) or 1e-12
        d0 = (h11 * g0 - h01 * g1) / det
        d1 = (-h01 * g0 + h00 * g1) / det
        b0 += d0
        b1 += d1
        info11 = h00 / det
        if abs(d0) + abs(d1) < 1e-9:
            break

    def ll(gs):
        s = 0
        for g in gs:
            for k in range(g + 1):
                p = clamp(1 / (1 + _jexp(-(b0 + b1 * math.log(1 + k)))), 1e-9, 1 - 1e-9)
                s += math.log(p) if k == g else math.log(1 - p)
        return s

    return {"b0": b0, "b1": b1, "se1": math.sqrt(max(1e-12, info11)), "ll": ll}


def _const_hazard_ll(train, test) -> float:
    ev = len(train)
    exposure = 0
    for g in train:
        exposure = exposure + g + 1
    p = clamp(ev / (exposure or 1), 1e-9, 1 - 1e-9)
    s = 0
    for g in test:
        s = s + math.log(p) + g * math.log(1 - p)
    return s


def eta_board(rounds, opts: dict | None = None) -> dict:
    from .clock import iso, now_iso, now_ms
    opts = opts or {}
    obs = [r for r in rounds if _origin(r) != "reconstructed"]
    ms = [r.multiplier for r in obs]
    cadence = opts.get("cadenceMs") if opts.get("cadenceMs") is not None else median_interval_ms(obs)
    now = obs[-1].tsMs if obs else now_ms()
    rows = []
    for T in (opts.get("thresholds") if opts.get("thresholds") is not None else ETA_THRESHOLDS):
        gb = gaps_between(ms, T)
        gaps, current = gb["gaps"], gb["current"]
        n_ev = len(gaps)
        rate = sum(1 for m in ms if m >= T) / len(ms) if ms else 0
        if n_ev < 8:
            rows.append({"threshold": T, "events": n_ev, "currentGap": current, "rate": r4(rate), "kmPercentile": None, "etaMedian": None, "etaP90": None,
                         "etaMedianAt": None, "etaP90At": None, "pNext": r4(rate), "pWithin10": r4(1 - math.pow(1 - rate, 10)), "memoryless": None,
                         "hazardModel": None, "calibration": None, "note": f"Only {n_ev} completed gaps — not enough for Kaplan–Meier."})
            continue
        max_k = max(max(gaps), current) + 2
        km = km_curve(gaps, max_k)
        Sg = _at(km["S"], current, 0)
        pct = 1 - Sg

        def cond(k, km=km, Sg=Sg, current=current):
            return _at(km["S"], current + k, 0) / Sg if Sg > 0 else 0

        med = None
        p90 = None
        for k in range(0, max_k - current + 2):
            c = cond(k + 1)
            if med is None and c <= 0.5:
                med = k + 1
            if p90 is None and c <= 0.1:
                p90 = k + 1
                break
        if med is None:
            med = max(1, math.ceil(math.log(0.5) / math.log(1 - rate))) if rate > 0 else None
        if p90 is None:
            p90 = max(1, math.ceil(math.log(0.1) / math.log(1 - rate))) if rate > 0 else None
        h_now = _at(km["hazard"], current, rate)
        cut = math.floor(n_ev * 0.7)
        train = gaps[:cut]
        test = gaps[cut:]
        fit = _fit_logistic_hazard(train if len(train) >= 8 else gaps)
        b1lo = fit["b1"] - 1.96 * fit["se1"]
        b1hi = fit["b1"] + 1.96 * fit["se1"]
        ll_model = fit["ll"]([min(g, 2000) for g in test]) if test else 0
        ll_const = _const_hazard_ll(train, test) if test else 0
        beats = len(test) >= 5 and ll_model > ll_const
        adj_med = None
        if beats:
            s = 1
            for k in range(5000):
                s *= 1 - 1 / (1 + _jexp(-(fit["b0"] + fit["b1"] * math.log(1 + current + k))))
                if s <= 0.5:
                    adj_med = k + 1
                    break
        half = gaps[: n_ev // 2]
        later = gaps[n_ev // 2:]
        cal_hits = cal_n = 0
        if len(half) >= 8 and len(later) >= 8:
            km2 = km_curve(half, max_k)
            S2 = km2["S"]
            r = rng(T * 101)
            for g in later:
                at = math.floor(r() * (g + 1))
                S0 = _at(S2, at, 0)
                if S0 <= 0:
                    continue
                m2 = 0
                for k in range(1, max_k):
                    if _at(S2, at + k, 0) / S0 <= 0.5:
                        m2 = k
                        break
                if not m2:
                    continue
                cal_n += 1
                if g - at + 1 <= m2:
                    cal_hits += 1
        flat = b1lo <= 0 <= b1hi
        rows.append({
            "threshold": T, "events": n_ev, "currentGap": current, "rate": r4(rate), "kmPercentile": r4(pct),
            "pressure": jround(pct * 100), "hazardNow": r4(h_now), "pNext": r4(clamp(h_now or rate)),
            "pWithin10": r4(1 - cond(10)), "etaMedian": med, "etaP90": p90,
            "etaMedianAt": iso(int(now + med * cadence)) if med is not None else None,
            "etaP90At": iso(int(now + p90 * cadence)) if p90 is not None else None,
            "medianGap": quantile(sorted(gaps), 0.5),
            "memoryless": {"beta1": r4(fit["b1"]), "lo": r4(b1lo), "hi": r4(b1hi),
                           "verdict": "memoryless" if flat else "rising hazard" if fit["b1"] > 0 else "falling hazard"},
            "hazardModel": {"heldOutLL": r2(ll_model), "constLL": r2(ll_const), "beatsKM": beats, "adjustedEtaMedian": adj_med},
            "calibration": {"n": cal_n, "beforeMedian": r4(cal_hits / cal_n), "target": 0.5} if cal_n else None,
            "note": (f'Gap hazard is flat (β₁ CI spans 0): being "overdue" carries no information for {js_str(T)}×.' if flat else
                     f"Hazard {'rises' if fit['b1'] > 0 else 'falls'} with gap length for {js_str(T)}× (β₁ {js_str(r3(fit['b1']))}); "
                     f"{'the hazard model beats KM on held-out gaps' if beats else 'but it does not beat KM out of sample, so KM is shown'}."),
        })
    return {"cadenceMs": jround(cadence), "generatedAt": now_iso(), "lastTs": obs[-1].ts if obs else None, "rows": rows}


etaBoard = eta_board


def hazard_timeline(rounds, T=10, max_g=120) -> dict:
    ms = _obs_ms(rounds)
    gb = gaps_between(ms, T)
    gaps, current = gb["gaps"], gb["current"]
    rate = sum(1 for m in ms if m >= T) / len(ms) if ms else 0
    km = km_curve(gaps, max(max_g, current + 1))
    hz = km["hazard"]
    series = []
    for g in range(0, int(min(max_g, len(hz) - 1)) + 1):
        risk = km["atRisk"][g]
        ev = jround(_at(hz, g, 0) * risk)
        lo, hi = wilson_ci(ev, risk)
        series.append({"g": g, "hazard": r4(_at(hz, g, 0)), "lo": r4(lo), "hi": r4(hi), "atRisk": risk})
    path = []
    run = 0
    start = max(0, len(ms) - 200)
    for i in range(len(ms)):
        if i >= start:
            path.append({"i": i - start, "g": run, "hazard": r4(_at(hz, min(run, len(hz) - 1), rate))})
        run = 0 if ms[i] >= T else run + 1
    return {"threshold": T, "rate": r4(rate), "currentGap": current, "series": series, "path": path}


hazardTimeline = hazard_timeline


def in_round_eta(rounds, m0, targets=None) -> dict:
    targets = targets if targets is not None else [1.5, 2, 3, 5, 10, 20, 50, 100]
    ms = _obs_ms(rounds)
    alive = [m for m in ms if m >= m0]
    rows = []
    for x in targets:
        if not x > m0:
            continue
        h = sum(1 for m in alive if m >= x)
        lo, hi = wilson_ci(h, len(alive))
        rows.append({"target": x, "law": r4(m0 / x), "empirical": r4(h / len(alive)) if alive else None, "lo": r4(lo), "hi": r4(hi),
                     "secondsFromStart": r2(16.67 * math.log(x)), "secondsFromNow": r2(16.67 * (math.log(x) - math.log(max(1, m0))))})
    return {"m0": m0, "sample": len(alive), "rows": rows,
            "note": "Under the multiplier law P(M ≥ x | M ≥ m₀) = m₀/x, and the flight takes t(x) ≈ 16.67·ln x seconds. The empirical column checks the source against that law."}


inRoundEta = in_round_eta


# ================================================================= F-17

def reliability(rows, bins=10) -> dict:
    n = len(rows)
    B = [{"n": 0, "sp": 0, "sy": 0} for _ in range(bins)]
    brier = 0
    ybar = 0
    for r in rows:
        b = min(bins - 1, math.floor(r["p"] * bins))
        B[b]["n"] += 1
        B[b]["sp"] += r["p"]
        B[b]["sy"] += r["y"]
        brier += (r["p"] - r["y"]) ** 2
        ybar += r["y"]
    brier /= n or 1
    ybar /= n or 1
    rel = res = 0
    table = []
    for i, b in enumerate(B):
        pb = b["sp"] / b["n"] if b["n"] else 0
        ob = b["sy"] / b["n"] if b["n"] else 0
        rel += (b["n"] / (n or 1)) * (pb - ob) ** 2
        res += (b["n"] / (n or 1)) * (ob - ybar) ** 2
        lo, hi = wilson_ci(b["sy"], b["n"])
        table.append({"bin": i, "lo": i / bins, "hi": (i + 1) / bins, "n": b["n"], "meanP": r4(pb), "observed": r4(ob), "ciLo": r4(lo), "ciHi": r4(hi)})
    unc = ybar * (1 - ybar)
    bss = 1 - brier / unc if unc > 0 else 0
    diffs = [(ybar - r["y"]) ** 2 - (r["p"] - r["y"]) ** 2 for r in rows]
    lo, hi = block_bootstrap_ci(diffs)
    return {"n": n, "brier": r4(brier), "climatology": r4(unc), "bss": r4(bss),
            "bssCI": [r4(lo / unc if unc else 0), r4(hi / unc if unc else 0)],
            "murphy": {"reliability": r4(rel), "resolution": r4(res), "uncertainty": r4(unc)}, "table": table}


def pit_histogram(items, bins=10, seed=11) -> dict:
    r = rng(seed)
    h = [0] * bins
    for it in items:
        b = band_index(it["actual"])
        F = jsum(it["dist"][:b])
        u = clamp(F + r() * _at(it["dist"], b, 0), 0, 0.999999)
        h[math.floor(u * bins)] += 1
    n = len(items) or 1
    exp = n / bins
    chi2 = 0
    for x in h:
        chi2 = chi2 + (x - exp) ** 2 / (exp or 1)
    k = bins - 1
    z = (math.cbrt(chi2 / k) - (1 - 2 / (9 * k))) / math.sqrt(2 / (9 * k))
    p = 1 - norm_cdf(z)
    return {"bins": [{"bin": i, "count": c, "share": r4(c / n)} for i, c in enumerate(h)], "n": len(items), "chi2": r2(chi2), "p": r4(p), "uniform": p > 0.05}


pitHistogram = pit_histogram


def coverage_aci(items, target=0.5, gamma=0.01) -> dict:
    raw_hits = aci_hits = 0
    alpha = 1 - target
    trail = []
    rr = ra = 0
    every = max(1, len(items) // 60)
    for i, it in enumerate(items):
        in_raw = 1 if it["lo"] <= it["actual"] <= it["hi"] else 0
        a = clamp(alpha, 0.01, 0.99)
        qlo = quantile_from_dist(it["dist"], a / 2)
        qhi = quantile_from_dist(it["dist"], 1 - a / 2)
        in_aci = 1 if qlo <= it["actual"] <= qhi else 0
        raw_hits += in_raw
        aci_hits += in_aci
        alpha = alpha + gamma * ((1 - target) - (1 - in_aci))
        rr += in_raw
        ra += in_aci
        if (i + 1) % every == 0:
            trail.append({"i": i + 1, "raw": r4(rr / (i + 1)), "aci": r4(ra / (i + 1)), "alpha": r4(alpha)})
    n = len(items) or 1
    return {"n": len(items), "target": target, "raw": r4(raw_hits / n), "aci": r4(aci_hits / n),
            "rawError": r4(abs(raw_hits / n - target)), "aciError": r4(abs(aci_hits / n - target)),
            "alphaNow": r4(alpha), "trail": trail, "passes": abs(aci_hits / n - target) <= 0.02}


coverageACI = coverage_aci


# ================================================================= F-16 / F-13 / F-14

def _isnum(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def counterfactual(rows, without) -> dict:
    diffs = []
    with_l = wo_l = 0
    for r in rows:
        num = den = num_all = den_all = 0
        for k, w in r["weights"].items():
            l = r["compLoss"].get(k)
            if not _isnum(l):
                continue
            p = math.exp(-l)
            num_all += w * p
            den_all += w
            if k == without:
                continue
            num += w * p
            den += w
        if not den or not den_all:
            continue
        lw = -math.log(max(1e-6, num_all / den_all))
        lwo = -math.log(max(1e-6, num / den))
        with_l += lw
        wo_l += lwo
        diffs.append(lwo - lw)
    n = len(diffs)
    lo, hi = block_bootstrap_ci(diffs)
    return {"without": without, "n": n, "withLogLoss": r4(with_l / n) if n else None, "withoutLogLoss": r4(wo_l / n) if n else None,
            "marginalValue": r4(mean(diffs)) if n else None, "lo": r4(lo), "hi": r4(hi),
            "verdict": "insufficient" if n < 30 else "adds value" if lo > 0 else "hurts the mixture" if hi < 0 else "no measurable effect"}


def earn_generic(keys, log_loss, n, prior=None) -> dict:
    prior = prior or {}
    known = [k for k in keys if _isnum(log_loss.get(k))]
    best = min(log_loss[k] for k in known) if known else 0
    n_eff = min(60, n)
    raw: dict = {}
    for k in keys:
        pk = prior.get(k)
        raw[k] = (pk if pk is not None else 1) * (_jexp(-n_eff * (log_loss[k] - best)) if n >= 15 and _isnum(log_loss.get(k)) else 1)
    s = jsum(raw.values()) or 1
    for k in keys:
        raw[k] = max(0.02, raw[k] / s)
    s2 = jsum(raw.values()) or 1
    for k in keys:
        raw[k] = raw[k] / s2
    return raw


earnGeneric = earn_generic


def _mix_loss_from(r, w) -> float:
    num = den = 0
    for k, l in r["compLoss"].items():
        wk = w.get(k)
        wk = wk if wk is not None else 0
        num += wk * math.exp(-l)
        den += wk
    return -math.log(max(1e-6, num / den)) if den else r["mixLoss"]


def regime_weights(rows, opts: dict | None = None) -> dict:
    opts = opts or {}
    k0 = opts.get("shrink") if opts.get("shrink") is not None else 50
    keys = list(dict.fromkeys(k for r in rows for k in r["compLoss"].keys()))
    cut = math.floor(len(rows) * 0.7)
    train = rows[:cut]
    test = rows[cut:]

    def avg(rs):
        s: dict = {}
        for r in rs:
            for k, l in r["compLoss"].items():
                s[k] = s.get(k, 0) + l
        for k in list(s):
            s[k] /= len(rs) or 1
        return s

    glob = earn_generic(keys, avg(train), len(train))
    st_of = lambda r: r.get("state") if r.get("state") is not None else "?"  # noqa: E731
    states = list(dict.fromkeys(st_of(r) for r in rows))
    by_state = {}
    for st in states:
        rs = [r for r in train if st_of(r) == st]
        w = earn_generic(keys, avg(rs), len(rs))
        shr = len(rs) / (len(rs) + k0)
        by_state[st] = {"n": len(rs), "weights": {k: r4(shr * w[k] + (1 - shr) * glob[k]) for k in keys}}
    diffs = []
    for r in test:
        wr = (by_state.get(st_of(r)) or {}).get("weights") or glob
        diffs.append(_mix_loss_from(r, glob) - _mix_loss_from(r, wr))
    lo, hi = block_bootstrap_ci(diffs)
    return {"keys": keys, "trainN": len(train), "testN": len(test), "global": {k: r4(v) for k, v in glob.items()}, "byState": by_state,
            "heldOutGain": r4(mean(diffs)), "lo": r4(lo), "hi": r4(hi), "real": len(test) >= 30 and lo > 0,
            "note": "Not enough held-out rows yet." if len(test) < 30 else "Regime weights beat global weights out of sample." if lo > 0 else
            "Regimes do not beat global weights out of sample — global weights stay in force."}


regimeWeights = regime_weights

_LOGREP = [math.log(1.2), math.log(1.72), math.log(3.1), math.log(7), math.log(25), math.log(200)]


def _e_log(d) -> float:
    s = 0
    for i, p in enumerate(d):
        s = s + p * _LOGREP[i]
    return s


def forecast_diff(a, b) -> dict:
    from .clock import iso
    keys = list(dict.fromkeys([c["key"] for c in a["comp"]] + [c["key"] for c in b["comp"]]))
    contrib = []
    for k in keys:
        ca = next((c for c in a["comp"] if c["key"] == k), None)
        cb = next((c for c in b["comp"] if c["key"] == k), None)
        va = ca["weight"] * _e_log(ca["dist"]) if ca else 0
        vb = cb["weight"] * _e_log(cb["dist"]) if cb else 0
        wa = ca["weight"] if ca else 0
        wb = cb["weight"] if cb else 0
        contrib.append({"key": k, "weightFrom": r4(wa), "weightTo": r4(wb), "deltaLog": r4(vb - va), "deltaWeight": r4(wb - wa)})
    contrib.sort(key=lambda x: -abs(x["deltaLog"]))

    def side(f):
        return {"id": f["id"], "at": iso(f["created_ms"]), "state": f["state"], "expected": f["expected"], "lo": f["range_lo"], "hi": f["range_hi"], "reach": f["reach"]}

    return {"from": side(a), "to": side(b),
            "delta": {"expected": r2(b["expected"] - a["expected"]), "lo": r2(b["range_lo"] - a["range_lo"]), "hi": r2(b["range_hi"] - a["range_hi"]),
                      "reach": r2(b["reach"] - a["reach"]), "stateChanged": a["state"] != b["state"]},
            "topEngines": contrib[:3], "engines": contrib,
            "bandShift": [{"band": BAND_LABELS[i], "from": r4(_at(a["dist"], i, 0)), "to": r4(p), "delta": r4(p - _at(a["dist"], i, 0))} for i, p in enumerate(b["dist"])]}


forecastDiff = forecast_diff


# ================================================================= F-07

BAND_TOKENS = ["L", "M", "H", "V", "X", "Z"]


def token_string(ms) -> str:
    return "".join(BAND_TOKENS[band_index(m)] for m in ms)


tokenString = token_string


def sequence_search(rounds, pattern, k=1, T=2) -> dict:
    from .clock import now_ms
    obs = [r for r in rounds if _origin(r) != "reconstructed"]
    ms = [r.multiplier for r in obs]
    tape_s = token_string(ms)
    pat = re.sub(r"[^LMHVXZ]", "", str(pattern).upper())[:8]
    if not pat:
        return {"pattern": pat, "error": "pattern must use tokens L M H V X Z (bands <1.5, 1.5–2, 2–5, 5–10, 10–100, 100+)"}
    t0 = now_ms()
    occ = []
    frm = 0
    while True:
        i = tape_s.find(pat, frm)
        if i < 0:
            break
        occ.append(i)
        frm = i + 1
    nxt = [0] * NB
    nn = hit = 0
    for i in occ:
        j = i + len(pat)
        if j + k > len(ms):
            continue
        nn += 1
        nxt[band_index(ms[j])] += 1
        if any(ms[j + t] >= T for t in range(k)):
            hit += 1
    base = sum(1 for m in ms if m >= T) / len(ms) if ms else 0
    base_k = 1 - math.pow(1 - base, k)
    lo, hi = wilson_ci(hit, nn)
    base_shares = band_shares(ms)
    rate = hit / nn if nn else 0
    t = two_prop(hit, nn, jround(base_k * len(ms)), len(ms))
    differs = lo > base_k or hi < base_k
    return {
        "pattern": pat, "k": k, "target": T, "occurrences": len(occ), "scored": nn, "rate": r4(rate), "lo": r4(lo), "hi": r4(hi),
        "base": r4(base_k), "p": r4(t["p"]), "differs": nn >= 20 and differs,
        "verdict": "too few occurrences" if nn < 20 else ("above base rate" if rate > base_k else "below base rate") if differs else "no different from base rate",
        "nextBand": [{"band": BAND_LABELS[i], "token": BAND_TOKENS[i], "share": r4(c / nn if nn else 0), "base": r4(base_shares[i])} for i, c in enumerate(nxt)],
        "timeline": [{"at": obs[i].ts if i < len(obs) else None, "idx": i} for i in occ[-300:]],
        "latestMatch": tape_s.endswith(pat), "elapsedMs": now_ms() - t0,
    }


sequenceSearch = sequence_search


# ================================================================= F-12 / F-09

ENGINE_FAMILIES = {
    "window": {"label": "Empirical window", "params": [{"key": "window", "label": "Window (rounds)", "min": 20, "max": 5000, "default": 300}]},
    "ewma": {"label": "Exponentially weighted shares", "params": [{"key": "halfLife", "label": "Half-life (rounds)", "min": 5, "max": 5000, "default": 200}]},
    "markov1": {"label": "First-order band Markov", "params": [{"key": "alpha", "label": "Laplace α", "min": 0.1, "max": 50, "default": 2}, {"key": "window", "label": "Window", "min": 200, "max": 20000, "default": 5000}]},
    "streak": {"label": "Streak-conditional", "params": [{"key": "x", "label": "Streak threshold (×)", "min": 1.2, "max": 10, "default": 2}, {"key": "window", "label": "Window", "min": 200, "max": 20000, "default": 5000}]},
    "conditional": {"label": "Experiment condition (from F-34)", "params": [{"key": "x", "label": "Condition level", "min": 1.1, "max": 100, "default": 2}, {"key": "k", "label": "Streak length", "min": 1, "max": 20, "default": 3}, {"key": "window", "label": "Window", "min": 200, "max": 20000, "default": 5000}]},
}


def _p(P, key, default) -> float:
    from .jsutil import num
    v = P.get(key)
    return num(v if v is not None else default)


def _smooth(c, a=0.5):
    s = jsum(c) + a * NB
    return [(x + a) / s for x in c]


def custom_predict(spec, ms) -> list:
    P = spec.get("params") or {}
    if not ms:
        return [1 / NB] * NB
    fam = spec.get("family")
    if fam == "window":
        c = [0] * NB
        for m in _tail(ms, _p(P, "window", 300)):
            c[band_index(m)] += 1
        return _smooth(c)
    if fam == "ewma":
        hl = _p(P, "halfLife", 200)
        lam = math.pow(0.5, 1 / hl)
        c = [0] * NB
        w = 1
        i = len(ms) - 1
        lim = max(0, len(ms) - hl * 8)
        while i >= lim:
            c[band_index(ms[i])] += w
            w *= lam
            i -= 1
        return _smooth(c, 0.2)
    if fam == "markov1":
        a = _p(P, "alpha", 2)
        xs = _tail(ms, _p(P, "window", 5000))
        last = band_index(xs[-1])
        bi = [band_index(x) for x in xs]
        c = [0] * NB
        for i in range(1, len(xs)):
            if bi[i - 1] == last:
                c[bi[i]] += 1
        return _smooth(c, a)
    if fam in ("streak", "conditional"):
        x = _p(P, "x", 2)
        k = None if fam == "streak" else _p(P, "k", 3)
        xs = _tail(ms, _p(P, "window", 5000))
        run = 0
        i = len(xs) - 1
        while i >= 0 and xs[i] < x:
            run += 1
            i -= 1
        want = k if k is not None else min(run, 8)
        c = [0] * NB
        rr = 0
        for i in range(len(xs)):
            cnd = min(rr, 8) == want if k is None else rr >= want
            if i > 0 and cnd and (k is None or run >= want):
                c[band_index(xs[i])] += 1
            rr = rr + 1 if xs[i] < x else 0
        if k is not None and run < want:
            cc = [0] * NB
            for m in xs:
                cc[band_index(m)] += 1
            return _smooth(cc)
        return _smooth(c, 1)
    return [1 / NB] * NB


customPredict = custom_predict


def score_custom(spec, ms, n=400, stride=1) -> dict:
    start = max(50, len(ms) - n * stride)
    diffs = []
    losses = []
    base_counts = [0] * NB
    for i in range(min(start, len(ms))):
        base_counts[band_index(ms[i])] += 1
    probs = []
    i = start
    while i < len(ms):
        d = custom_predict(spec, ms[:i])
        tot = jsum(base_counts) + NB * 0.5
        base = [(c + 0.5) / tot for c in base_counts]
        b = band_index(ms[i])
        l = -math.log(max(1e-6, d[b]))
        lb = -math.log(max(1e-6, base[b]))
        losses.append(l)
        diffs.append(lb - l)
        probs.append({"p": jsum(d[2:]), "y": 1 if ms[i] >= 2 else 0})
        for j in range(i, min(len(ms), i + stride)):
            base_counts[band_index(ms[j])] += 1
        i += stride
    lo, hi = block_bootstrap_ci(diffs)
    return {"n": len(diffs), "logLoss": r4(mean(losses)), "skill": r4(mean(diffs)), "lo": r4(lo), "hi": r4(hi), "reliability": reliability(probs)}


scoreCustom = score_custom


def admission_tests(spec, ms) -> dict:
    cut = max(100, len(ms) - 200)
    prefix = ms[:cut]
    a = custom_predict(spec, prefix)
    b = custom_predict(spec, prefix)
    deterministic = all(abs(x - b[i]) < 1e-12 for i, x in enumerate(a))
    future = [*prefix, *[m * 3 for m in ms[cut:]]]
    c = custom_predict(spec, future[:cut])
    causal = all(abs(x - c[i]) < 1e-12 for i, x in enumerate(a))
    valid = all(math.isfinite(x) and x >= 0 for x in a) and abs(jsum(a) - 1) < 1e-6
    r = rng(99)
    sh = ms[-3000:]
    for i in range(len(sh) - 1, 0, -1):
        j = math.floor(r() * (i + 1))
        sh[i], sh[j] = sh[j], sh[i]
    nul = score_custom(spec, sh, 250)
    null_ok = not (nul["lo"] > 0)
    not_stub = len({to_fixed(x, 6) for x in a}) > 1 or spec.get("family") == "window"
    return {"deterministic": deterministic, "causal": causal, "valid": valid,
            "nullTape": {"ok": null_ok, "skill": nul["skill"], "lo": nul["lo"], "hi": nul["hi"]}, "notStub": not_stub,
            "passed": deterministic and causal and valid and null_ok and not_stub}


admissionTests = admission_tests

# ================================================================= F-34

def condition_mask(ms, c) -> bytearray:
    n = len(ms)
    out = bytearray(n)
    x = c.get("x") if c.get("x") is not None else 2
    k = max(1, c.get("k") if c.get("k") is not None else 1)
    below = above = since = 0
    kind = c.get("kind")
    tape_s = token_string(ms) if kind == "sequence" else ""
    pat = re.sub(r"[^LMHVXZ]", "", str(c.get("pattern") or "").upper())
    lp = len(pat)
    for i in range(n):
        on = False
        if kind == "streak_below":
            on = below >= k
        elif kind == "streak_above":
            on = above >= k
        elif kind == "after_at_least":
            on = i > 0 and ms[i - 1] >= x
        elif kind == "after_below":
            on = i > 0 and ms[i - 1] < x
        elif kind == "gap_since":
            on = since >= k
        elif kind == "sequence":
            on = bool(pat) and i >= lp and tape_s[i - lp:i] == pat
        out[i] = 1 if on else 0
        m = ms[i]
        below = below + 1 if m < x else 0
        above = above + 1 if m >= x else 0
        since = 0 if m >= x else since + 1
    return out


conditionMask = condition_mask


def _target_hit(ms, i, t):
    h = t["h"]
    if i + h > len(ms):
        return None
    for j in range(int(math.ceil(h)) if h > 0 else 0):
        if ms[i + j] >= t["x"]:
            return 1
    return 0


def _effect_on(ms, mask, t, frm, to) -> dict:
    nc = hc = nb = hb = 0
    for i in range(frm, to):
        y = _target_hit(ms, i, t)
        if y is None:
            continue
        nb += 1
        hb += y
        if mask[i]:
            nc += 1
            hc += y
    tp = two_prop(hc, nc, hb - hc, nb - nc)
    return {"n": nc, "hits": hc, "rate": hc / nc if nc else 0, "base": hb / nb if nb else 0, "z": tp["z"], "p": tp["p"], "diff": tp["diff"]}


def _shuffle(xs, r):
    for i in range(len(xs) - 1, 0, -1):
        j = math.floor(r() * (i + 1))
        xs[i], xs[j] = xs[j], xs[i]


def run_experiment(spec, rounds, opts: dict | None = None) -> dict:
    opts = opts or {}
    ms = _obs_ms(rounds)
    split = math.floor(len(ms) * (spec.get("split") if spec.get("split") is not None else 0.6))
    cond = spec["condition"]
    tgt = spec["target"]
    mask = condition_mask(ms, cond)
    train = _effect_on(ms, mask, tgt, 0, split)
    test = _effect_on(ms, mask, tgt, split, len(ms))
    r = rng(opts.get("seed") if opts.get("seed") is not None else 1234)
    S = opts.get("shuffles") if opts.get("shuffles") is not None else 30
    null_z = []
    xs = list(ms)
    for _ in range(S):
        _shuffle(xs, r)
        mk = condition_mask(xs, cond)
        null_z.append(_effect_on(xs, mk, tgt, split, len(xs))["z"])
    shuffle_p = (sum(1 for z in null_z if abs(z) >= abs(test["z"])) + 1) / (S + 1)
    P = opts.get("plants") if opts.get("plants") is not None else 20
    detected = 0
    lift = 1.2
    for _ in range(P):
        ys = list(ms)
        _shuffle(ys, r)
        mk = condition_mask(ys, cond)
        base = test["base"] or 0.5
        extra = clamp((lift - 1) * base / max(1e-6, 1 - base))
        for i in range(split, len(ys)):
            if not mk[i]:
                continue
            if _target_hit(ys, i, tgt) == 0 and r() < extra:
                ys[i] = max(ys[i], tgt["x"])
        mk2 = condition_mask(ys, cond)
        e = _effect_on(ys, mk2, tgt, split, len(ys))
        if e["p"] < 0.05 and e["diff"] > 0:
            detected += 1
    power = detected / (P or 1)
    return {
        "split": split,
        "train": {**train, "rate": r4(train["rate"]), "base": r4(train["base"]), "z": r2(train["z"]), "p": r4(train["p"]), "diff": r4(train["diff"])},
        "test": {**test, "rate": r4(test["rate"]), "base": r4(test["base"]), "z": r2(test["z"]), "p": r4(test["p"]), "diff": r4(test["diff"]),
                 "ci": [r4(v) for v in wilson_ci(test["hits"], test["n"])]},
        "shuffle": {"runs": S, "p": r4(shuffle_p), "nullZ": [r2(z) for z in null_z]},
        "power": r4(power), "plantedLift": lift, "sameSign": _jsign(train["diff"]) == _jsign(test["diff"]),
    }


runExperiment = run_experiment


def verdict_for(res, q) -> dict:
    if res["test"]["n"] < 30:
        return {"verdict": "insufficient", "lifecycle": "draft", "reason": f"Only {res['test']['n']} condition hits in the test block."}
    if q < 0.05 and res["sameSign"] and res["shuffle"]["p"] < 0.05:
        return {"verdict": "supported", "lifecycle": "validating",
                "reason": f"Test-block q = {to_fixed(q, 3)}, same sign as training, beats the shuffle baseline (p {js_str(res['shuffle']['p'])})."}
    if res["power"] >= 0.8:
        return {"verdict": "rejected", "lifecycle": "rejected",
                "reason": f"No effect (q = {to_fixed(q, 3)}) and the planted-lift check detects a +20% effect {js_str(jround(res['power'] * 100))}% of the time, so the test was adequately powered."}
    return {"verdict": "underpowered", "lifecycle": "candidate",
            "reason": f"No effect (q = {to_fixed(q, 3)}), but power to detect a +20% lift is only {js_str(jround(res['power'] * 100))}% — collect more rounds."}


verdictFor = verdict_for


def _parse_float(s: str) -> float:
    m = re.match(r"\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?", s)
    return float(m.group(0)) if m else math.nan


def parse_hypothesis(text: str) -> dict:
    t = text.lower()
    xs = [_parse_float(m.group(0)) for m in re.finditer(r"(\d+(\.\d+)?)\s*x", t)]
    km = re.search(r"(\d+)\s*(rounds?|in a row|consecutive|times)", t)
    k = int(km.group(1)) if km else 3
    hm = re.search(r"within\s*(\d+)", t) or re.search(r"next\s*(\d+)", t)
    h = int(hm.group(1)) if hm else 1
    cond_x = xs[0] if xs else 2
    tgt_x = xs[1] if len(xs) > 1 else xs[0] if xs else 2
    kind = "streak_below"
    streak_below = bool(re.search(r"\d+\s*(rounds?|in a row|consecutive|times)?\s*(in a row\s*)?(below|under|less than)", t))
    streak_above = bool(re.search(r"\d+\s*(rounds?|in a row|consecutive|times)\s*(in a row\s*)?(above|over|at least)", t))
    if re.search(r"pattern|sequence", t):
        kind = "sequence"
    elif streak_below and re.search(r"\d+\s*(rounds?|in a row|consecutive)", t):
        kind = "streak_below"
    elif streak_above:
        kind = "streak_above"
    elif re.search(r"after (a|an|one)?\s*(big|high|\d+(\.\d+)?\s*x\+?|round (at least|above|over))", t) or re.search(r"after .*(above|over|at least)", t):
        kind = "after_at_least"
    elif re.search(r"since|overdue|gap", t):
        kind = "gap_since"
    elif re.search(r"above|over|hot", t) and re.search(r"in a row|consecutive|streak", t):
        kind = "streak_above"
    pm = re.search(r"\b[LMHVXZ]{2,8}\b", text, re.ASCII)
    pattern = pm.group(0) if pm else ""
    condition = {"kind": kind, "x": cond_x, "k": max(k, 5) if kind == "gap_since" else k}
    if pattern:
        condition["pattern"] = pattern
    return {"name": text[:60], "hypothesis": text, "condition": condition, "target": {"x": tgt_x, "h": h}}


parseHypothesis = parse_hypothesis


# ================================================================= F-31 / F-32

def kelly_tells(rounds, opts: dict | None = None) -> list:
    opts = opts or {}
    ms = _tail(_obs_ms(rounds), opts.get("window") if opts.get("window") is not None else 5000)
    kappa = min(0.25, opts.get("kappa") if opts.get("kappa") is not None else 0.25)
    cap = opts.get("cap") if opts.get("cap") is not None else 0.02
    min_n = opts.get("minN") if opts.get("minN") is not None else 100
    out = []
    for x in (opts.get("targets") if opts.get("targets") is not None else [1.5, 2, 3, 5, 10]):
        n = len(ms)
        h = sum(1 for m in ms if m >= x)
        lo = wilson_ci(h, n)[0]
        p = lo if n >= min_n else 0
        edge = p * x - 1
        f = min(cap, (kappa * edge) / (x - 1)) if edge > 0 else 0
        out.append({
            "target": x, "n": n, "pHat": r4(h / n if n else 0), "pLower": r4(lo), "ev": r4((h / n if n else 0) * x - 1),
            "evLower": r4(edge), "fraction": r4(f), "action": "stake" if f > 0 else "skip",
            "reasons": [
                f"Wilson lower bound p ≥ {to_fixed(lo * 100, 2)}% at n = {n}",
                f"p·x − 1 = {to_fixed(edge * 100, 2)}% > 0 → κ·Kelly = {to_fixed(f * 100, 2)}% (cap {to_fixed(cap * 100, 1)}%)" if edge > 0
                else f"p·x − 1 = {to_fixed(edge * 100, 2)}% ≤ 0 → stake 0 (no measured edge)",
            ],
        })
    return out


kellyTells = kelly_tells


def simulate_bankroll(rounds, strat, opts: dict | None = None) -> dict:
    opts = opts or {}
    ms = _obs_ms(rounds)
    bank0 = opts.get("bankroll") if opts.get("bankroll") is not None else 100
    S = opts.get("sessions") if opts.get("sessions") is not None else 20
    paths = opts.get("paths") if opts.get("paths") is not None else 400
    L = int(max(5, strat["roundsPerSession"]))
    r = rng(opts.get("seed") if opts.get("seed") is not None else 17)
    steps = S * L
    curves = []
    ruined = cap_hits = stop_hits = 0
    dds = []
    finals = []
    flat = strat.get("stakeMode") == "flat"
    stake_v = strat["stake"]
    cashout = strat["cashout"]
    tp = strat.get("takeProfit")
    sl = strat.get("stopLoss")
    nms = len(ms)
    for _p_ in range(paths):
        bank = bank0
        peak = bank0
        max_dd = 0
        curve = [bank0]
        dead = False
        for _s in range(S):
            start = math.floor(r() * max(1, nms - L))
            sess_start = bank
            for i in range(L):
                if dead:
                    curve.append(bank)
                    continue
                stake = min(bank, stake_v) if flat else bank * stake_v
                if stake <= 0 or bank < 0.01:
                    dead = True
                    curve.append(bank)
                    continue
                m = ms[start + i] if start + i < nms else 1
                bank += stake * (cashout - 1) if m >= cashout else -stake
                peak = max(peak, bank)
                max_dd = max(max_dd, (peak - bank) / peak if peak > 0 else 0)
                curve.append(bank)
                if tp and bank - sess_start >= tp:
                    cap_hits += 1
                    curve.extend([bank] * (L - i - 1))
                    break
                if sl and sess_start - bank >= sl:
                    stop_hits += 1
                    curve.extend([bank] * (L - i - 1))
                    break
            if bank < 0.01:
                dead = True
        if dead or bank < bank0 * 0.01:
            ruined += 1
        dds.append(max_dd)
        finals.append(bank)
        curves.append(curve[: steps + 1])
    fan = []
    every = max(1, steps // 80)
    for t in range(0, steps + 1, every):
        col = sorted(c[min(t, len(c) - 1)] for c in curves)
        fan.append({"t": t, "p5": r2(quantile(col, 0.05)), "p25": r2(quantile(col, 0.25)), "p50": r2(quantile(col, 0.5)), "p75": r2(quantile(col, 0.75)), "p95": r2(quantile(col, 0.95))})
    p_hit = sum(1 for m in ms if m >= cashout) / nms if nms else 0
    ev_per_bet = p_hit * cashout - 1
    closed = bank0 + steps * stake_v * ev_per_bet if flat else None
    sorted_f = sorted(finals)
    mc = mean(finals)
    sd = math.sqrt(mean([(f - mc) ** 2 for f in finals]))
    sdd = sorted(dds)
    return {
        "strategy": strat, "bankroll": bank0, "sessions": S, "paths": paths, "fan": fan,
        "final": {"p5": r2(quantile(sorted_f, 0.05)), "p50": r2(quantile(sorted_f, 0.5)), "p95": r2(quantile(sorted_f, 0.95)), "mean": r2(mc)},
        "ruin": r4(ruined / paths), "drawdown": {"p50": r4(quantile(sdd, 0.5)), "p95": r4(quantile(sdd, 0.95))},
        "takeProfitHits": cap_hits, "stopLossHits": stop_hits, "evPerBet": r4(ev_per_bet), "pHit": r4(p_hit),
        "closedForm": {"expectedFinal": r2(closed), "mcMean": r2(mc), "mcError": r2((1.96 * sd) / math.sqrt(paths)),
                       "agrees": abs(mc - closed) <= (2.5 * sd) / math.sqrt(paths) + 1e-6 or bool(sl) or bool(tp)} if closed is not None else None,
    }


simulateBankroll = simulate_bankroll


# ================================================================= F-36 / F-03

MESSAGE_TEMPLATES = {
    "client:nonce": lambda c, n, s: f"{c}:{js_str(n)}",
    "client-nonce": lambda c, n, s: f"{c}-{js_str(n)}",
    "nonce:client": lambda c, n, s: f"{js_str(n)}:{c}",
    "clientnonce": lambda c, n, s: f"{c}{js_str(n)}",
    "server:client:nonce": lambda c, n, s: f"{s}:{c}:{js_str(n)}",
    "nonce-only": lambda c, n, s: js_str(n),
    "client-only": lambda c, n, s: c,
}


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8", "surrogatepass")).hexdigest()


def sha512_hex(s: str) -> str:
    return hashlib.sha512(s.encode("utf-8", "surrogatepass")).hexdigest()


def hmac_hex(key: str, msg: str, alg: str) -> str:
    dig = hashlib.sha256 if alg == "SHA-256" else hashlib.sha512
    return _hmac.new(key.encode("utf-8"), msg.encode("utf-8"), dig).hexdigest()


sha256Hex, sha512Hex, hmacHex = sha256_hex, sha512_hex, hmac_hex


def crash_stake(digest: str, edge: float) -> float:
    i = int(digest[:8], 16)
    raw = (2 ** 32 / (i + 1)) * (1 - edge)
    return math.floor(max(1, raw) * 100) / 100


def crash_bustabit(digest: str, divisor: int = 101) -> float:
    if int(digest, 16) % divisor == 0:
        return 1
    X = int(digest[:13], 16)
    e = 2 ** 52
    return math.floor((100 * e - X) / (e - X)) / 100


crashStake, crashBustabit = crash_stake, crash_bustabit


def verify_all(inp: dict) -> list:
    c = inp.get("client") if inp.get("client") is not None else "".join(inp.get("clients") or [])
    n = inp.get("nonce") if inp.get("nonce") is not None else 0
    server = inp["server"]
    obsv = inp.get("observed")
    cmp = (lambda v: abs(v - obsv) <= 0.005) if obsv is not None else (lambda v: None)
    out = []
    for name, tpl in MESSAGE_TEMPLATES.items():
        for alg in ("SHA-256", "SHA-512"):
            d = hmac_hex(server, tpl(c, n, server), alg)
            for edge in (0, 0.01, 0.02, 0.03, 0.04, 0.05):
                v = crash_stake(d, edge)
                out.append({"convention": f"stake|{name}|{alg}|edge={js_str(edge)}", "value": v, "match": cmp(v)})
    b1 = hmac_hex(server, c or server, "SHA-256")
    out.append({"convention": "bustabit|hmac(server,client)", "value": crash_bustabit(b1), "match": cmp(crash_bustabit(b1))})
    b2 = sha256_hex(server)
    out.append({"convention": "bustabit|sha256(server)", "value": crash_bustabit(b2), "match": cmp(crash_bustabit(b2))})
    sp = sha512_hex(server + c)
    X = int(sp[:13], 16)
    e = 2 ** 52
    spribe = max(1, math.floor((100 * e - X) / (e - X)) / 100)
    out.append({"convention": "spribe|sha512(server+clients)", "value": spribe, "match": cmp(spribe)})
    return out


verifyAll = verify_all


def solve_convention(rounds) -> dict:
    cands = None
    per = []
    for i, rd in enumerate(rounds):
        res = verify_all(rd)
        m = [r["convention"] for r in res if r["match"]]
        per.append({"idx": i, "matches": m})
        cands = list(dict.fromkeys(m)) if cands is None else [x for x in cands if x in m]
    lst = cands or []
    n = len(rounds)
    return {"rounds": n, "candidates": lst, "perRound": per, "confirmed": n >= 3 and len(lst) == 1,
            "note": "A single match is weak evidence — supply at least 3 rounds (k ≥ 3 intersection)." if n < 3 else
            f"Convention confirmed across {n} rounds." if len(lst) == 1 else
            "No convention reproduces every round — source is unverifiable with these seeds." if not lst else
            f"{len(lst)} conventions still consistent — add rounds."}


solveConvention = solve_convention


def verify_seed_chain(revealed: str, committed: str, max_depth: int = 2000) -> dict:
    h = revealed
    for d in range(max_depth + 1):
        if h == committed:
            return {"found": True, "depth": d}
        h = sha256_hex(h)
    return {"found": False, "depth": None}


verifySeedChain = verify_seed_chain


def fairness_battery(rounds) -> dict:
    ms = _obs_ms(rounds)
    n = len(ms)
    tests = []
    edges = []
    for x in (1.5, 2, 3, 5, 10):
        h = sum(1 for m in ms if m >= x)
        lo, hi = wilson_ci(h, n)
        edges.append({"cashout": x, "rtp": r4((h / (n or 1)) * x), "rtpLo": r4(lo * x), "rtpHi": r4(hi * x), "edge": r4(1 - (h / (n or 1)) * x)})
    edge_hat = clamp(mean([e["edge"] for e in edges]), -0.2, 0.2)

    def law(x):
        return 1 if x <= 1 else clamp((1 - edge_hat) / x)

    exp_shares = [law(EDGES[i]) - (law(EDGES[i + 1]) if math.isfinite(EDGES[i + 1]) else 0) for i in range(len(BAND_LABELS))]
    obs = band_shares(ms)
    chi = 0
    for i, o in enumerate(obs):
        chi = chi + (n * (o - exp_shares[i]) ** 2) / max(1e-9, n * exp_shares[i])
    k = NB - 2
    zc = (math.cbrt(chi / k) - (1 - 2 / (9 * k))) / math.sqrt(2 / (9 * k))
    tests.append({"test": "band χ² vs fair law", "statistic": r2(chi), "p": r4(1 - norm_cdf(zc)), "n": n,
                  "note": f"Expected shares from P(M ≥ x) = (1 − {to_fixed(edge_hat * 100, 1)}%)/x."})
    r = rng(5)
    hist = [0] * 10
    for m in ms:
        f_hi = 1 - law(m + 0.01)
        f_lo = 1 - law(m)
        u = clamp(f_lo + r() * max(0, f_hi - f_lo), 0, 0.999999)
        hist[math.floor(u * 10)] += 1
    ex = n / 10
    chi_p = 0
    for c in hist:
        chi_p = chi_p + (c - ex) ** 2 / (ex or 1)
    zp = (math.cbrt(chi_p / 9) - (1 - 2 / 81)) / math.sqrt(2 / 81)
    tests.append({"test": "discrete-law PIT uniformity", "statistic": r2(chi_p), "p": r4(1 - norm_cdf(zp)), "n": n, "note": "Randomised PIT on the 0.01 lattice, 10 bins."})
    b = [1 if m >= 2 else 0 for m in ms]
    n1 = sum(b)
    n0 = n - n1
    runs = 1 if n else 0
    for i in range(1, n):
        if b[i] != b[i - 1]:
            runs += 1
    mu = (2 * n1 * n0) / (n or 1) + 1
    vr = (2 * n1 * n0 * (2 * n1 * n0 - n)) / ((n * n * (n - 1)) or 1)
    zr = (runs - mu) / math.sqrt(vr or 1)
    tests.append({"test": "runs test (≥ 2×)", "statistic": r2(zr), "p": r4(two_sided_p(zr)), "n": n, "note": f"{runs} runs vs {to_fixed(mu, 0)} expected."})
    lg = [math.log(m) for m in ms]
    mu2 = mean(lg)
    num = den = 0
    for i in range(n):
        den += (lg[i] - mu2) ** 2
        if i:
            num += (lg[i] - mu2) * (lg[i - 1] - mu2)
    rho = num / den if den else 0
    zrho = rho * math.sqrt(n)
    tests.append({"test": "lag-1 autocorrelation (log)", "statistic": r4(rho), "p": r4(two_sided_p(zrho)), "n": n, "note": "Independence of consecutive rounds."})
    q = bh_q([t["p"] for t in tests])
    return {
        "n": n, "houseEdge": r4(edge_hat), "edges": edges,
        "tests": [{**t, "q": r4(q[i]), "flagged": q[i] < 0.05} for i, t in enumerate(tests)],
        "expectedShares": [{"band": BAND_LABELS[i], "expected": r4(s), "observed": r4(obs[i])} for i, s in enumerate(exp_shares)],
        "verdict": "deviation flagged — check tape integrity (missed rounds bias the battery) before suspecting the RNG" if any(x < 0.05 for x in q)
        else "consistent with a fair RNG at the measured house edge",
    }


fairnessBattery = fairness_battery


def cusum_fingerprint(rounds, tz_min=120) -> list:
    from .clock import iso
    obs = [r for r in rounds if _origin(r) != "reconstructed"]
    days: dict = {}
    for r in obs:
        d = iso(r.tsMs + tz_min * 60_000)[:10]
        days.setdefault(d, []).append(r.multiplier)
    keys = sorted(days.keys())
    stats = [
        ("low12", "share < 1.2×", lambda xs: sum(1 for m in xs if m < 1.2) / len(xs)),
        ("over2", "share ≥ 2×", lambda xs: sum(1 for m in xs if m >= 2) / len(xs)),
        ("over10", "share ≥ 10×", lambda xs: sum(1 for m in xs if m >= 10) / len(xs)),
        ("edge2", "house edge @2×", lambda xs: 1 - (sum(1 for m in xs if m >= 2) / len(xs)) * 2),
    ]
    res = []
    for key, label, f in stats:
        series = [{"day": d, "n": len(days[d]), "value": f(days[d])} for d in keys if len(days[d]) >= 50]
        warm = series[: max(3, len(series) // 3)]
        mu = mean([x["value"] for x in warm])
        sd = math.sqrt(mean([(x["value"] - mu) ** 2 for x in warm])) or 0.01
        hi = lo = 0
        out = []
        for x in series:
            z = (x["value"] - mu) / sd
            hi = max(0, hi + z - 0.5)
            lo = max(0, lo - z - 0.5)
            out.append({"day": x["day"], "n": x["n"], "value": r4(x["value"]), "cusumHi": r2(hi), "cusumLo": r2(lo), "alarm": hi > 5 or lo > 5})
        first = next((x["day"] for x in out if x["alarm"]), None)
        res.append({"key": key, "label": label, "reference": r4(mu), "sd": r4(sd), "series": out, "alarm": any(x["alarm"] for x in out), "firstAlarm": first})
    return res


cusumFingerprint = cusum_fingerprint


# ================================================================= F-10

def compare_sources(a, b, metric) -> dict:
    from .jsutil import num
    ma = _obs_ms(a)
    mb = _obs_ms(b)

    def prop(x):
        ha = sum(1 for m in ma if m >= x)
        hb = sum(1 for m in mb if m >= x)
        t = two_prop(ha, len(ma), hb, len(mb))
        return {"metric": f"P(M ≥ {js_str(x)}×)", "a": r4(ha / (len(ma) or 1)), "b": r4(hb / (len(mb) or 1)), "diff": r4(t["diff"]), "lo": r4(t["lo"]), "hi": r4(t["hi"]), "p": r4(t["p"])}

    if metric == "all" or not metric:
        rows = [prop(x) for x in (1.2, 2, 5, 10, 100)]
    else:
        v = num(metric)
        rows = [prop(v if v == v and v != 0 else 2)]
    ga = gaps_between(ma, 10)["gaps"]
    gb = gaps_between(mb, 10)["gaps"]
    U = 0
    if ga and gb:
        allv = sorted([(v, 0) for v in ga] + [(v, 1) for v in gb], key=lambda t: t[0])
        rank = 1
        ra = 0
        i = 0
        while i < len(allv):
            j = i
            while j < len(allv) and allv[j][0] == allv[i][0]:
                j += 1
            avg = (rank + rank + (j - i) - 1) / 2
            for t in range(i, j):
                if allv[t][1] == 0:
                    ra += avg
            rank += j - i
            i = j
        U = ra - (len(ga) * (len(ga) + 1)) / 2
    mu_u = (len(ga) * len(gb)) / 2
    sd_u = math.sqrt((len(ga) * len(gb) * (len(ga) + len(gb) + 1)) / 12) or 1
    z_u = (U - mu_u) / sd_u
    q = bh_q([*[r["p"] for r in rows], two_sided_p(z_u)])
    return {
        "nA": len(ma), "nB": len(mb), "rows": [{**r, "q": r4(q[i]), "differs": q[i] < 0.05} for i, r in enumerate(rows)],
        "gaps10": {"medianA": median(ga), "medianB": median(gb), "z": r2(z_u), "p": r4(two_sided_p(z_u)), "q": r4(q[-1])},
        "edgeA": r4(1 - (sum(1 for m in ma if m >= 2) / (len(ma) or 1)) * 2),
        "edgeB": r4(1 - (sum(1 for m in mb if m >= 2) / (len(mb) or 1)) * 2),
    }


compareSources = compare_sources


# ================================================================= F-18

def canonical_json(v) -> str:
    if v is None or isinstance(v, bool):
        return json.dumps(v)
    if isinstance(v, (int, float)):
        return js_str(v) if math.isfinite(v) else "null"
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, (list, tuple)):
        return "[" + ",".join(canonical_json(x) for x in v) + "]"
    if isinstance(v, dict):
        ks = sorted(str(k) for k in v.keys())
        src = {str(k): x for k, x in v.items()}
        return "{" + ",".join(f"{json.dumps(k, ensure_ascii=False)}:{canonical_json(src[k])}" for k in ks) + "}"
    if hasattr(v, "__dict__"):
        return canonical_json(dict(vars(v)))
    return json.dumps(str(v), ensure_ascii=False)


canonicalJson = canonical_json


def chain_hash(prev: str, payload) -> str:
    return sha256_hex(prev + "|" + canonical_json(payload))


chainHash = chain_hash
chain_hash_sync = chain_hash
chainHashSync = chain_hash
sha256_sync = sha256_hex
sha256Sync = sha256_hex
GENESIS = "0" * 64


# ================================================================= F-08 narrator

def narrate(m, prev_run, stored=None) -> str:
    band = BAND_LABELS[band_index(m)]
    what = ("an instant crash" if m < 1.2 else "a short flight" if m < 2 else "a solid flight" if m < 5 else
            "a big flight" if m < 10 else "a moonshot" if m < 100 else "a jackpot-class moonshot")
    parts = [f"{to_fixed(m, 2)}× — {what} ({band})."]
    b2 = prev_run["below2"]
    if m < 2 and b2 + 1 >= 3:
        parts.append(f"That makes {js_str(b2 + 1)} rounds below 2× in a row.")
    if m >= 2 and b2 >= 3:
        parts.append(f"It ends a {js_str(b2)}-round run below 2×.")
    if m >= 10:
        parts.append(f"First 10×+ after {js_str(prev_run['since10'])} rounds.")
    if stored:
        inside = stored["lo"] <= m <= stored["hi"]
        parts.append(f"The stored forecast said {to_fixed(stored['expected'], 2)}× with a 50% range {to_fixed(stored['lo'], 2)}–{to_fixed(stored['hi'], 2)}× — "
                     f"{'inside the range' if inside else 'above the range' if m > stored['hi'] else 'below the range'}.")
    return " ".join(parts)


def numbers_check(text: str, allowed) -> dict:
    found = [float(m.group(0)) for m in re.finditer(r"\d+(\.\d+)?", text)]
    found = [int(x) if x.is_integer() else x for x in found]
    unknown = [x for x in found if x > 1 and not any(abs(a - x) <= 0.011 or abs(a * 100 - x) <= 0.6 for a in allowed)]
    return {"ok": len(unknown) == 0, "unknown": unknown}


numbersCheck = numbers_check
