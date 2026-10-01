"""Admit an engine to the blend only if it improves it — port of engine-gate.ts.

Leave-one-out on the linear pool: with/without engine c at the landed band,
admitted only if the mean per-round log-loss gain exceeds ``seMultiple`` SE.
The baseline is always kept.
"""

from __future__ import annotations

import math

from .jsutil import js_str, jround, jsum

P_FLOOR = 1e-6


def _mean(xs) -> float:
    return jsum(xs) / len(xs) if xs else 0


def _se_of(xs) -> float:
    if len(xs) < 2:
        return math.inf
    m = _mean(xs)
    return math.sqrt(jsum((v - m) ** 2 for v in xs) / (len(xs) - 1) / len(xs))


def _fin(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _r5(v: float) -> float:
    return jround(v * 1e5) / 1e5


def blend_admission(inp, keys, opts: dict | None = None) -> dict:
    opts = opts or {}
    window = opts.get("window") if opts.get("window") is not None else 600
    min_sample = opts.get("minSample") if opts.get("minSample") is not None else 100
    k = opts.get("seMultiple") if opts.get("seMultiple") is not None else 2
    always = set(opts["always"] if opts.get("always") is not None else ["baseline"])
    src = list(inp)[-window:] if window else list(inp)
    rows = [r for r in src if r and r.get("weights") is not None and r.get("compLoss") is not None and all(_fin(v) for v in r["compLoss"].values())]
    verdicts = []
    for c in keys:
        if c in always:
            verdicts.append({"key": c, "sample": len(rows), "gain": 0, "se": 0, "trialShare": 0, "admitted": True, "status": "always", "reason": "Always kept as the reference engine."})
            continue
        gains = []
        share_sum = 0
        for r in rows:
            cl, w = r["compLoss"], r["weights"]
            lc = cl.get(c)
            if not _fin(lc):
                continue
            others = [j for j in cl if j != c and _fin(cl[j]) and (w.get(j) or 0) > 0]
            w_sum = jsum(w.get(j) or 0 for j in others)
            if not (w_sum > 0):
                continue
            p_others = jsum((w.get(j) or 0) * math.exp(-cl[j]) for j in others)
            wc = w.get(c) or 0
            ts = opts.get("trialShare")
            s = wc if wc > 0.021 else (ts if ts is not None else 1 / max(2, len(keys)))
            share_sum += s
            without = max(P_FLOOR, p_others / w_sum)
            with_c = max(P_FLOOR, (p_others + s * math.exp(-lc)) / (w_sum + s))
            gains.append(math.log(with_c) - math.log(without))
        g = _mean(gains)
        se = _se_of(gains)
        trial = share_sum / len(gains) if gains else 0
        if len(gains) < min_sample:
            verdicts.append({"key": c, "sample": len(gains), "gain": _r5(g), "se": _r5(se) if math.isfinite(se) else -1, "trialShare": _r5(trial),
                             "admitted": False, "status": "insufficient-data", "reason": f"{len(gains)}/{js_str(min_sample)} scored rounds — not yet tested."})
            continue
        admitted = g > 0 and g > k * se
        verdicts.append({
            "key": c, "sample": len(gains), "gain": _r5(g), "se": _r5(se), "trialShare": _r5(trial), "admitted": admitted,
            "status": "admitted" if admitted else "excluded",
            "reason": (f"Improves the blend: +{js_str(_r5(g))} log-loss per round (± {js_str(_r5(se))} SE) over {len(gains)} rounds." if admitted
                       else f"Does not improve the blend: {'+' if g >= 0 else ''}{js_str(_r5(g))} per round (± {js_str(_r5(se))} SE) over {len(gains)} rounds."),
        })
    tested = [v for v in verdicts if v["status"] not in ("insufficient-data", "always")]
    return {
        "sample": len(rows),
        "admitted": [v["key"] for v in verdicts if v["admitted"]],
        "excluded": [v["key"] for v in verdicts if v["status"] == "excluded"],
        "verdicts": verdicts,
        "reason": (f"Blend gate collecting evidence: {len(rows)}/{js_str(min_sample)} resolved rounds." if len(rows) < min_sample
                   else f"{sum(1 for v in tested if v['admitted'])} of {len(tested)} tested engines improve the blend by more than {js_str(k)} SE."),
    }


blendAdmission = blend_admission


def gated_states(operator: dict, gate: dict | None, built_in, candidates) -> dict:
    out = dict(operator)
    if not gate:
        return out
    for v in gate["verdicts"]:
        op = operator.get(v["key"])
        if op in ("shadow", "demoted", "retired"):
            continue
        if v["status"] == "always":
            continue
        if v["status"] == "insufficient-data":
            out[v["key"]] = (op if op is not None else "live") if v["key"] in built_in else "shadow"
            continue
        out[v["key"]] = "live" if v["admitted"] else "shadow"
    for c in candidates:
        if c not in out:
            out[c] = "shadow"
    return out


gatedStates = gated_states
