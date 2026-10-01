"""FX analysis engines — port of fx.ts (v6.0). Pure: rounds in, metrics out."""

from __future__ import annotations

import math

from .analysis import THRESHOLDS, exceedance, max_of, quantile  # noqa: F401  (re-exported)
from .jsutil import js_str, jround, jsum, tf, to_fixed


def _clamp(v, lo, hi):
    return min(hi, max(lo, v))


def _r3(v):
    return tf(v, 3)


def _r4(v):
    return tf(v, 4)


def _ln(m):
    return math.log(max(1.01, m))


def _find_index_ge(sorted_vals, x) -> int:
    for i, v in enumerate(sorted_vals):
        if v >= x:
            return i
    return -1


def _utc_hour(ms) -> int:
    return int((int(ms) // 3_600_000) % 24)


# ------------------------------------------------------------- correlation

def correlation_engine(rounds, threshold: float = 2, max_lag: int = 20) -> dict:
    recent = rounds[-10000:]
    n = len(recent)
    logs = [_ln(r.multiplier) for r in recent]
    flags = [1 if r.multiplier >= threshold else 0 for r in recent]

    def acf_of(series):
        m = jsum(series) / max(1, n)
        c0 = 0
        for v in series:
            c0 += (v - m) ** 2
        out = []
        q = 0
        for lag in range(1, max_lag + 1):
            ck = 0
            for i in range(lag, n):
                ck += (series[i] - m) * (series[i - lag] - m)
            acf = ck / c0 if c0 > 0 else 0
            sig = abs(acf) > (1.96 / math.sqrt(n) if n > 0 else math.inf)
            q += (n * (n + 2) * acf * acf) / max(1, n - lag)
            out.append({"lag": lag, "acf": _r4(acf), "significant": sig})
        return out, _r3(q)

    lr, lq = acf_of(logs)
    fr, fq = acf_of(flags)
    any_sig = any(r["significant"] for r in lr) or any(r["significant"] for r in fr)
    return {
        "n": n, "logAcf": lr, "flagAcf": fr, "ljungBoxLog": lq, "ljungBoxFlag": fq,
        "note": "Some lags exceed the 95% band — small but measurable serial structure." if any_sig
        else "No lag exceeds the 95% band — the series behaves close to serially independent.",
    }


correlationEngine = correlation_engine


# -------------------------------------------------------------- volatility

def volatility_profile(rounds, window: int = 50) -> dict:
    recent = rounds[-6000:]
    rets = [0 if i == 0 else _ln(r.multiplier) - _ln(recent[i - 1].multiplier) for i, r in enumerate(recent)]
    vols = []
    for i in range(window, len(recent)):
        s = s2 = 0
        for j in range(i - window + 1, i + 1):
            s += rets[j]
            s2 += rets[j] ** 2
        m = s / window
        vols.append({"t": recent[i].ts[5:16], "vol": math.sqrt(max(0, s2 / window - m * m))})
    srt = sorted(v["vol"] for v in vols)
    current = vols[-1]["vol"] if vols else 0
    rank = _find_index_ge(srt, current) / len(srt) if srt else 0.5
    ewma = srt[len(srt) // 2] if srt else 0
    for v in vols:
        ewma = 0.06 * v["vol"] + 0.94 * ewma
    vov = []
    for i in range(window, len(vols)):
        s = s2 = 0
        for j in range(i - window + 1, i + 1):
            s += vols[j]["vol"]
            s2 += vols[j]["vol"] ** 2
        m = s / window
        vov.append(math.sqrt(max(0, s2 / window - m * m)))
    acc: dict[int, list] = {}
    for i in range(1, len(recent)):
        h = _utc_hour(recent[i].tsMs)
        e = acc.setdefault(h, [0, 0])
        e[0] += abs(rets[i])
        e[1] += 1
    hourly = [{"hour": f"{h:02d}h", "vol": _r4(acc[h][0] / acc[h][1]) if h in acc else 0} for h in range(24)]
    vol_of_vol = jsum(vov) / len(vov) if vov else 0
    pct = _r3(_clamp(rank, 0, 1))
    return {
        "currentVol": _r4(current), "volPercentile": pct, "ewmaVol": _r4(ewma), "volOfVol": _r4(vol_of_vol),
        "regime": "expanded" if pct >= 0.8 else "compressed" if pct <= 0.2 else "normal",
        "series": vols[-400:], "hourly": hourly,
        "note": "Volatility in the top quintile — expansion regime." if pct >= 0.8
        else "Volatility squeezed — compression regime, break risk builds." if pct <= 0.2
        else "Volatility near its central range.",
    }


volatilityProfile = volatility_profile


# -------------------------------------------------------------- order flow

def order_flow(rounds, bucket: int = 20) -> dict:
    recent = rounds[-bucket * 60:] if bucket * 60 else rounds[:]
    buckets, cumulative = [], []
    cvd = 0
    i = 0
    while i + bucket <= len(recent):
        buy = sum(1 for j in range(i, i + bucket) if recent[j].multiplier >= 2)
        imb = (2 * buy - bucket) / bucket
        cvd += imb
        buckets.append({"t": recent[i].ts[5:16], "buy": buy, "sell": bucket - buy, "imbalance": _r3(imb)})
        cumulative.append({"t": recent[i].ts[5:16], "cvd": _r3(cvd)})
        i += bucket
    imbs = [b["imbalance"] for b in buckets]
    mean = jsum(imbs) / max(1, len(imbs))
    sd = math.sqrt(jsum((b - mean) ** 2 for b in imbs) / max(1, len(imbs) - 1))
    current = imbs[-1] if imbs else 0
    z = (current - mean) / sd if sd > 0 else 0
    return {
        "bucket": bucket, "buckets": buckets, "cumulative": cumulative,
        "currentImbalance": _r3(current), "currentZ": _r3(z),
        "note": "Aggressive buy-side pressure vs recent norm." if z > 1 else "Sell-side (dry) pressure vs recent norm." if z < -1 else "Balanced two-sided flow.",
    }


orderFlow = order_flow


# ---------------------------------------------------------- support density

def support_density(rounds, window: int = 800, bin_count: int = 36) -> dict:
    recent = rounds[-window:]
    values = [r.multiplier for r in recent]
    current = values[-1] if values else 1
    lo = math.log10(max(1, quantile(sorted(values), 0.02)))
    hi = math.log10(max(lo + 0.3, max_of(values)))
    width = (hi - lo) / bin_count
    if not width or math.isnan(width):
        width = 0.1
    counts = [0] * bin_count
    for v in values:
        b = int(_clamp(math.floor((math.log10(max(1, v)) - lo) / width), 0, bin_count - 1))
        counts[b] += 1
    bins = [{"from": tf(10 ** (lo + b * width), 2), "to": tf(10 ** (lo + (b + 1) * width), 2), "count": c} for b, c in enumerate(counts)]
    avg = len(values) / bin_count
    levels = []
    run = None
    for b in range(bin_count):
        if counts[b] >= avg * 1.35 and counts[b] >= 3:
            mid = 10 ** (lo + (b + 0.5) * width)
            run = [run[0] + mid * counts[b], run[1] + counts[b]] if run else [mid * counts[b], counts[b]]
        elif run:
            levels.append({"level": tf(run[0] / run[1], 2), "touches": run[1]})
            run = None
    if run:
        levels.append({"level": tf(run[0] / run[1], 2), "touches": run[1]})
    supports = sorted([l for l in levels if l["level"] < current], key=lambda l: -l["level"])
    resistances = sorted([l for l in levels if l["level"] >= current], key=lambda l: l["level"])
    return {
        "current": tf(current, 2), "bins": bins, "supports": supports, "resistances": resistances,
        "nearestSupport": supports[0]["level"] if supports else None,
        "nearestResistance": resistances[0]["level"] if resistances else None,
        "note": f"Price shelf {js_str(supports[0]['level'])}× below, {js_str(resistances[0]['level'])}× above the current print."
        if supports and resistances else "Not enough clustered density to define shelves yet.",
    }


supportDensity = support_density


# ---------------------------------------------------------------- breakout

def breakout(rounds, window: int = 30, horizon: int = 10) -> dict:
    recent = rounds[-6000:]
    logs = [_ln(r.multiplier) for r in recent]
    ranges, range_ts = [], []
    for i in range(window, len(logs)):
        seg = logs[i - window + 1:i + 1]
        ranges.append(max(seg) - min(seg))
        range_ts.append(recent[i].ts[5:16])
    srt = sorted(ranges)
    range_now = ranges[-1] if ranges else 0
    pct = _find_index_ge(srt, range_now) / len(srt) if srt else 0.5
    comp_n = comp_breaks = all_n = all_breaks = 0
    for i in range(window, len(recent) - horizon):
        seg = logs[i - window + 1:i + 1]
        lo, hi = min(seg), max(seg)
        broke = any(logs[j] > hi for j in range(i + 1, i + horizon + 1))
        all_n += 1
        if broke:
            all_breaks += 1
        a = max(0, i - window - 300)
        b = i - window + 1
        local = sorted(ranges[a:b]) if b > a else []
        local_pct = _find_index_ge(local, hi - lo) / len(local) if len(local) > 30 else 1
        if local_pct <= 0.2:
            comp_n += 1
            if broke:
                comp_breaks += 1
    comp_rate = comp_breaks / comp_n if comp_n else 0
    base_rate = all_breaks / all_n if all_n else 0
    tail = ranges[-300:]
    off = len(ranges) - 300
    return {
        "window": window, "horizon": horizon, "rangeNow": tf(range_now, 3),
        "compressionPercentile": _r3(1 - _clamp(pct, 0, 1)),
        "series": [{"t": range_ts[max(0, off + i)], "range": tf(v, 3)} for i, v in enumerate(tail)],
        "postCompressionBreakRate": _r4(comp_rate), "baseBreakRate": _r4(base_rate), "sample": comp_n,
        "note": f"Squeezes resolve upward {to_fixed((comp_rate / max(1e-9, base_rate) - 1) * 100, 0)}% more often than base — compression carries information here."
        if comp_rate > base_rate * 1.1 else "Compression shows no measured breakout edge — squeezes resolve at the base rate.",
    }


# ----------------------------------------------------------- mean reversion

def mean_reversion(rounds) -> dict:
    recent = rounds[-5000:]
    logs = [_ln(r.multiplier) for r in recent]
    n = len(logs)
    sizes = []
    s = 16
    while s <= n // 2:
        sizes.append(s)
        s *= 2
    rs = []
    for size in sizes:
        rs_sum, blocks = 0, 0
        start = 0
        while start + size <= n:
            seg = logs[start:start + size]
            m = jsum(seg) / size
            cum, lo, hi, ss = 0, math.inf, -math.inf, 0
            for v in seg:
                cum += v - m
                lo = min(lo, cum)
                hi = max(hi, cum)
                ss += (v - m) ** 2
            sd = math.sqrt(ss / size)
            if sd > 0:
                rs_sum += (hi - lo) / sd
                blocks += 1
            start += size
        if blocks:
            rs.append((math.log(size), math.log(max(1e-9, rs_sum / blocks))))
    hurst = 0.5
    if len(rs) >= 2:
        mx = jsum(p[0] for p in rs) / len(rs)
        my = jsum(p[1] for p in rs) / len(rs)
        num = den = 0
        for x, y in rs:
            num += (x - mx) * (y - my)
            den += (x - mx) ** 2
        hurst = _clamp(num / den, 0, 1) if den else 0.5
    diffs = [logs[i + 1] - logs[i] for i in range(n - 1)]

    def var_of(arr):
        m = jsum(arr) / max(1, len(arr))
        return jsum((b - m) ** 2 for b in arr) / max(1, len(arr))

    v1 = var_of(diffs)
    vrs = []
    for q in (2, 4, 8):
        agg = []
        for i in range(q - 1, len(diffs)):
            t = 0
            for j in range(i - q + 1, i + 1):
                t += diffs[j]
            agg.append(t)
        vrs.append({"q": q, "vr": _r3(var_of(agg) / (q * v1) if v1 > 0 else 1)})
    sxy = sxx = 0
    for i in range(1, n):
        sxy += logs[i - 1] * logs[i]
        sxx += logs[i - 1] ** 2
    phi = sxy / sxx if sxx > 0 else 1
    half_life = int(jround(math.log(2) / -math.log(max(1e-9, phi)))) if 0 < phi < 1 else None
    wl = logs[-50:]
    wm = jsum(wl) / max(1, len(wl))
    wsd = math.sqrt(jsum((b - wm) ** 2 for b in wl) / max(1, len(wl)))
    z = (logs[n - 1] - wm) / wsd if wsd > 0 else 0
    return {
        "hurst": _r3(hurst), "varianceRatios": vrs, "ar1": _r3(phi), "halfLife": half_life, "zScore": _r3(z),
        "interpretation": "Mean-reverting tendency (H<0.45) — excursions tend to fade." if hurst < 0.45
        else "Trending/persistent tendency (H>0.55) — moves cluster." if hurst > 0.55
        else "Random-walk-like (H≈0.5) — no reversion or persistence edge.",
    }


meanReversion = mean_reversion


# ------------------------------------------------------------ trend quality

def trend_quality(rounds, window: int = 60) -> dict:
    recent = rounds[-6000:]
    logs = [_ln(r.multiplier) for r in recent]

    def eff_at(i):
        net = abs(logs[i] - logs[i - window + 1])
        path = 0
        for j in range(i - window + 2, i + 1):
            path += abs(logs[j] - logs[j - 1])
        return net / path if path > 0 else 0

    series = []
    stp = max(1, math.floor((len(logs) - window) / 240))
    i = window - 1
    while i < len(logs):
        series.append({"t": recent[i].ts[5:16], "eff": _r3(eff_at(i))})
        i += stp
    efficiency = _r3(eff_at(len(logs) - 1)) if len(logs) >= window else 0
    seg = logs[-window:] if window else logs[:]
    n = len(seg)
    mx = (n - 1) / 2
    my = jsum(seg) / n if n else math.nan
    sxy = sxx = syy = 0
    for x, y in enumerate(seg):
        sxy += (x - mx) * (y - my)
        sxx += (x - mx) ** 2
        syy += (y - my) ** 2
    slope = sxy / sxx if sxx else 0
    r2 = _clamp((sxy ** 2) / (sxx * syy), 0, 1) if syy > 0 else 0
    return {
        "efficiency": efficiency, "r2": _r3(r2),
        "direction": "up" if slope > 0.002 else "down" if slope < -0.002 else "flat",
        "classification": "trending" if efficiency > 0.35 and r2 > 0.25 else "ranging",
        "series": series,
        "note": "Directional efficiency elevated — trends are being paid." if efficiency > 0.35 else "Choppy tape — path/net ratio favors range tactics.",
    }


trendQuality = trend_quality


# ---------------------------------------------------------------- event risk

def event_risk(rounds, window: int = 200, scan: int = 4000) -> dict:
    recent = rounds[-scan:]
    logs = [_ln(r.multiplier) for r in recent]
    sorted_all = sorted(r.multiplier for r in recent)
    extreme = tf(quantile(sorted_all, 0.995), 2) if sorted_all else 100
    anomalies = []
    count = 0
    since = None
    for i in range(window, len(recent)):
        seg = logs[i - window:i]
        m = jsum(seg) / window
        sd = math.sqrt(jsum((b - m) ** 2 for b in seg) / window)
        z = (logs[i] - m) / sd if sd > 0 else 0
        if abs(z) > 3:
            count += 1
            if len(anomalies) < 12 or i > len(recent) - 12:
                anomalies.append({"ts": recent[i].ts, "multiplier": tf(recent[i].multiplier, 2), "z": _r3(z)})
    for i in range(len(recent) - 1, -1, -1):
        if recent[i].multiplier >= extreme:
            since = len(recent) - 1 - i
            break
    last = logs[-window:] if window else logs[:]
    lm = jsum(last) / max(1, len(last))
    lsd = math.sqrt(jsum((b - lm) ** 2 for b in last) / max(1, len(last)))
    return {
        "extremeThreshold": extreme,
        "anomalyRate": _r4(count / max(1, len(recent) - window)),
        "sinceLastExtreme": since,
        "zNow": _r3((logs[-1] - lm) / lsd) if lsd > 0 else 0,
        "anomalies": list(reversed(anomalies[-12:])),
        "note": f"Last q99.5 extreme ({js_str(extreme)}×) landed {since} rounds ago." if since is not None else "No q99.5 extreme in the scanned window.",
    }


eventRisk = event_risk


# ---------------------------------------------------------------- divergence

def divergence(rounds, thresholds=(2, 5, 10)) -> list:
    by_source: dict[str, list] = {}
    for r in rounds:
        by_source.setdefault(r.source, []).append(r.multiplier)
    total = len(rounds)

    def base_at(t):
        return sum(1 for r in rounds if r.multiplier >= t) / total if total else 0

    rows = []
    for source, mults in by_source.items():
        if len(mults) < 200:
            continue
        divs = []
        for t in thresholds:
            rate = sum(1 for m in mults if m >= t) / len(mults)
            base = base_at(t)
            divs.append({"threshold": t, "rate": _r4(rate), "base": _r4(base), "deltaPct": _r3((rate - base) / base * 100 if base > 0 else 0)})
        score = _r3(max_of([abs(d["deltaPct"]) for d in divs]))
        rows.append({"source": source, "rounds": len(mults), "divergences": divs, "score": score})
    return sorted(rows, key=lambda r: -r["score"])


# ----------------------------------------------------------------- signals

def fx_signals(rounds) -> dict:
    trend = trend_quality(rounds)
    rev = mean_reversion(rounds)
    vol = volatility_profile(rounds)
    flow = order_flow(rounds)
    brk = breakout(rounds)
    events = event_risk(rounds)
    signals = [
        {"key": "trend", "label": "Trend quality", "value": f"{trend['classification']} (ER {js_str(trend['efficiency'])})",
         "dir": (0.6 if trend["direction"] == "up" else -0.6) if trend["classification"] == "trending" else 0, "note": trend["note"]},
        {"key": "reversion", "label": "Mean reversion", "value": f"H {js_str(rev['hurst'])} · z {js_str(rev['zScore'])}",
         "dir": 0.5 if rev["zScore"] < -1.5 else -0.5 if rev["zScore"] > 1.5 else 0, "note": rev["interpretation"]},
        {"key": "vol", "label": "Volatility regime", "value": f"{vol['regime']} (p{js_str(jround(vol['volPercentile'] * 100))})",
         "dir": 0.4 if vol["regime"] == "compressed" else -0.2 if vol["regime"] == "expanded" else 0, "note": vol["note"]},
        {"key": "flow", "label": "Order-flow tilt", "value": f"z {js_str(flow['currentZ'])}", "dir": _clamp(flow["currentZ"] / 2, -1, 1), "note": flow["note"]},
        {"key": "breakout", "label": "Breakout setup", "value": f"{js_str(jround(brk['compressionPercentile'] * 100))}% squeeze",
         "dir": 0.5 if brk["compressionPercentile"] > 0.8 else 0, "note": brk["note"]},
        {"key": "events", "label": "Event risk", "value": f"{events['sinceLastExtreme']} since extreme" if events["sinceLastExtreme"] is not None else "quiet",
         "dir": 0, "note": events["note"]},
    ]
    return {
        "signals": signals,
        "engines": {"trend": trend, "reversion": rev, "volatility": vol, "orderFlow": flow, "breakout": brk, "events": events,
                    "density": support_density(rounds), "correlation": correlation_engine(rounds)},
    }


fxSignals = fx_signals
