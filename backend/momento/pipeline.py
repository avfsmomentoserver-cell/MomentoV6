"""Prediction pipeline + Accuracy Engine v2 math — port of pipeline.ts (v6.0).

Per-round ensemble probability → P(hit within N rounds); earned weights; the
next-round band projection; O(n) walk-forward verification in window blocks.
"""

from __future__ import annotations

import math

from .analysis import BAND_EDGES, BAND_LABELS, band_index
from .analysis import moonshot as moonshot_of
from .analysis import pressure as pressure_of
from .analysis import shape as shape_of
from .analysis import streaks as streaks_of
from .clock import now_iso
from .jsutil import js_str, jround, jsum, tf, to_fixed

WINDOWS = [
    {"id": "15m", "label": "15 minutes", "ms": 15 * 60_000},
    {"id": "1h", "label": "1 hour", "ms": 3_600_000},
    {"id": "4h", "label": "4 hours", "ms": 4 * 3_600_000},
    {"id": "1d", "label": "1 day", "ms": 24 * 3_600_000},
    {"id": "7d", "label": "7 days", "ms": 7 * 24 * 3_600_000},
]


def window_by_id(id_: str):
    return next((w for w in WINDOWS if w["id"] == id_), None)


windowById = window_by_id


def _clamp(v, lo, hi):
    return min(hi, max(lo, v))


def _r4(v):
    return tf(v, 4)


def _r5(v):
    return tf(v, 5)


def streak_map_of(rounds, threshold: float) -> list:
    out = [0] * len(rounds)
    run = 0
    for i, r in enumerate(rounds):
        run = 1 if r.multiplier >= threshold else run + 1
        out[i] = run
    return out


def median_interval_ms(rounds, span: int = 200) -> float:
    tail = rounds[-span:] if span else rounds[:]
    gaps = []
    for i in range(1, len(tail)):
        g = tail[i].tsMs - tail[i - 1].tsMs
        if 0 < g < 6 * 3600_000:
            gaps.append(g)
    if not gaps:
        return 4000
    gaps.sort()
    return gaps[len(gaps) // 2]


medianIntervalMs = median_interval_ms


def expected_rounds(rounds, window_ms: float) -> int:
    interval = median_interval_ms(rounds)
    return int(_clamp(jround(window_ms / interval), 1, 200_000))


expectedRounds = expected_rounds


def _logit(p):
    c = _clamp(p, 1e-6, 1 - 1e-6)
    return math.log(c / (1 - c))


def _sigmoid(z):
    return 1 / (1 + math.exp(-z))


def per_round_probability(rounds, threshold: float, weights: dict, recent: int = 200, streak_map=None) -> dict:
    n = len(rounds)
    if n == 0:
        return {"p": 0.5, "baseRate": 0.5, "components": [], "note": "no history yet"}
    flags = [1 if r.multiplier >= threshold else 0 for r in rounds]
    base_rate = sum(flags) / n
    hh = hl = lh = ll = 0
    for i in range(1, n):
        if flags[i - 1] == 1:
            if flags[i] == 1:
                hh += 1
            else:
                hl += 1
        elif flags[i] == 1:
            lh += 1
        else:
            ll += 1
    prev_hit = flags[n - 1] == 1
    if prev_hit:
        p_markov = hh / (hh + hl) if hh + hl > 0 else base_rate
    else:
        p_markov = lh / (lh + ll) if lh + ll > 0 else base_rate
    sm = streak_map if streak_map is not None else streak_map_of(rounds, threshold)
    s = 0 if prev_hit else sm[n - 1]
    s_n = s_hits = 0
    if not prev_hit:
        for i in range(1, n):
            if flags[i - 1]:
                continue
            if sm[i - 1] == s:
                s_n += 1
                if flags[i]:
                    s_hits += 1
    p_streak = s_hits / s_n if s_n >= 10 else base_rate
    tail_high = sum(flags[-recent:]) if recent else sum(flags)
    p_recent = tail_high / max(1, min(recent, n))
    models = {"baseline": base_rate, "markov": p_markov, "streak": p_streak, "recent": p_recent}
    w = {"baseline": 0.25}
    skill_sum = 0
    for m in ("markov", "streak", "recent"):
        sk = max(0, (weights or {}).get(m) or 0)
        w[m] = sk
        skill_sum += sk
    if skill_sum <= 0:
        w["baseline"] = 1
    else:
        for m in ("markov", "streak", "recent"):
            w[m] = (w[m] / skill_sum) * 0.75
    total_w = jsum(w.values()) or 1
    components = [{"model": m, "p": _r5(p), "weight": _r4((w.get(m) or 0) / total_w)} for m, p in models.items()]
    z = 0
    for m, p in models.items():
        z = z + ((w.get(m) or 0) / total_w) * _logit(p)
    p = _clamp(_sigmoid(z), 1e-6, 1 - 1e-6)
    skill_models = [m for m, v in w.items() if m != "baseline" and v > 0]
    return {
        "p": _r5(p),
        "baseRate": _r5(base_rate),
        "components": components,
        "note": f"Blended with earned weight on {', '.join(skill_models)}; baseline keeps its floor." if skill_models
        else "No model has earned skill over baseline yet — measured rate governs.",
    }


perRoundProbability = per_round_probability


def window_probability(p_per_round: float, n_rounds: float) -> float:
    p = _clamp(p_per_round, 1e-9, 1 - 1e-9)
    return _clamp(1 - (1 - p) ** n_rounds, 1e-9, 1 - 1e-9)


windowProbability = window_probability


def pipeline_forecast(rounds, source: str, weights: dict, thresholds=(2, 5, 10), windows=None) -> dict:
    windows = WINDOWS if windows is None else windows
    cadence = median_interval_ms(rounds)
    out = []
    for w in windows:
        n_r = expected_rounds(rounds, w["ms"])
        preds = []
        for t in thresholds:
            per = per_round_probability(rounds, t, weights)
            run = 0
            for i in range(len(rounds) - 1, -1, -1):
                if rounds[i].multiplier >= t:
                    break
                run += 1
            preds.append({"threshold": t, "probability": _r5(window_probability(per["p"], n_r)), "baselineRate": per["baseRate"], "perRound": per, "currentRun": run})
        out.append({"window": w["id"], "label": w["label"], "expectedRounds": n_r, "predictions": preds})
    return {"source": source, "generatedAt": now_iso(), "cadenceMs": cadence, "weights": weights, "windows": out}


pipelineForecast = pipeline_forecast


def band_label_of(m: float) -> str:
    i = 0
    while i < len(BAND_EDGES) and m >= BAND_EDGES[i]:
        i += 1
    return BAND_LABELS[i]


bandLabelOf = band_label_of


def band_label_of_short(index: int) -> str:
    i = max(0, min(len(BAND_LABELS) - 1, index))
    return BAND_LABELS[i].replace("x", "", 1)


bandLabelOfShort = band_label_of_short


def _pct(x: float) -> str:
    return js_str(jround(x * 100))


def next_round_forecast(rounds, source: str, weights: dict, prior_correction=None, rectification_sample=None) -> dict:
    n = len(rounds)
    last_m = rounds[-1].multiplier if n else 1
    cadence = median_interval_ms(rounds)
    st = streaks_of(rounds, 2)
    sm = streak_map_of(rounds, 2)
    per = per_round_probability(rounds, 2, weights, 200, sm)

    recent = rounds[-400:]
    edges = [1, 1.5, 2, 5, 10, 100, math.inf]
    labels = ["<1.5x", "1.5–2x", "2–5x", "5–10x", "10–100x", "100x+"]
    counts = [0] * 6
    log_sums = [0.0] * 6
    for r in recent:
        b = band_index(r.multiplier)
        counts[b] += 1
        log_sums[b] += math.log(max(1.01, r.multiplier))
    tot = len(recent)
    below_n = counts[0] + counts[1]
    above_n = tot - below_n

    def rep(b):
        if counts[b] >= 5:
            return math.exp(log_sums[b] / counts[b])
        return 200 if b == 5 else (edges[b] + edges[b + 1]) / 2

    p_below = below_n / tot if tot else math.nan
    p_above = above_n / tot if tot else math.nan
    cond_below = [counts[b] / below_n if below_n else 0.5 for b in (0, 1)]
    cond_above = [counts[2 + i] / above_n if above_n else 0.25 for i in range(4)]

    shape = shape_of(rounds, 80)
    ms = moonshot_of(rounds)
    press = pressure_of(rounds)
    r20 = rounds[-20:]
    hi_run = sum(1 for r in r20 if r.multiplier >= 10)
    above_share = sum(1 for r in r20 if r.multiplier >= 2) / len(r20) if r20 else 0

    state = "Shelf"
    if hi_run >= 2:
        state = "Ignition"
    elif ms["imminent"] or (ms["confidence"] >= 0.5 and press["overallPressure"] >= 65):
        state = "Moonshot"
    elif shape["dryZone"]["active"] and st["currentKind"] == "below" and st["current"] >= 6:
        state = "Collapse"
    elif above_share >= 0.4 and st["currentKind"] == "above" and st["current"] >= 3:
        state = "Bait"
    elif st["currentKind"] == "below" and st["current"] >= 5:
        state = "Exhaustion"

    tail_lift = _clamp(min(1, max(0, ms["confidence"])) * 0.7 + (0.5 if state == "Ignition" else 0), 0, 1)
    hi = [w * (1 + tail_lift * i * 0.7) for i, w in enumerate(cond_above)]
    hi[0] *= max(0, 1 - tail_lift * 0.9)
    hi_sum = jsum(hi) or 1
    band_p = [_r5(p) for p in [
        cond_below[0] * p_below, cond_below[1] * p_below,
        hi[0] / hi_sum * p_above, hi[1] / hi_sum * p_above, hi[2] / hi_sum * p_above, hi[3] / hi_sum * p_above,
    ]]
    reps = [rep(b) for b in range(6)]

    def quantile(q):
        c = 0
        for i in range(6):
            c += band_p[i]
            if c >= q:
                lo = edges[i]
                hi_e = reps[i] * 2 if edges[i + 1] == math.inf else edges[i + 1]
                return math.sqrt(lo * hi_e)
        return reps[5] * 2

    expected_raw = 0
    for i, p in enumerate(band_p):
        expected_raw = expected_raw + p * reps[i]
    correction = _clamp(math.exp(prior_correction), 0.5, 2) if prior_correction else 1
    expected = max(1, quantile(0.5) * correction)
    range_lo = max(1, quantile(0.25) * (0.6 + 0.4 * correction))
    range_hi = max(range_lo, quantile(0.75) * (0.8 + 0.2 * correction))
    moonshot_reach = quantile(0.9)

    def mid_for(p2):
        below = 1 - p2
        above = p2
        mass = [cond_below[0] * below, cond_below[1] * below, hi[0] / hi_sum * above, hi[1] / hi_sum * above, hi[2] / hi_sum * above, hi[3] / hi_sum * above]
        c = 0
        for i in range(6):
            c += mass[i]
            if c >= 0.5:
                lo = edges[i]
                hi_e = reps[i] * 2 if edges[i + 1] == math.inf else edges[i + 1]
                return max(1, math.sqrt(lo * hi_e))
        return max(1, reps[5] * 2)

    components = [{**c, "mid": tf(mid_for(c["p"]), 2)} for c in per["components"]]
    confidence = min(0.95, max(0.05, per["p"]))
    label = "HIGH" if confidence >= 0.66 else "MEDIUM" if confidence >= 0.38 else "LOW"
    notes = {
        "Ignition": f"Consecutive 10x+ rounds inside the last 20 — the tail is hot, so the next-round distribution weights the moonshot bands hard (P(≥2x) {_pct(per['p'])}%).",
        "Moonshot": f"Moonshot conditions are building — {_pct(ms['confidence'])}% scanner confidence with {js_str(press['overallPressure'])}% tail pressure; the upper range reaches the moonshot target.",
        "Collapse": f"Dry zone active (severity {js_str(shape['dryZone']['severity'])}) with a {js_str(st['current'])}-round below-2x streak — energy is snuffed, the distribution compresses toward the base bands.",
        "Bait": f"{_pct(above_share)}% of the last 20 rounds cleared 2x and the streak is still above — a single spike inside this heat reads as a false invitation.",
        "Exhaustion": f"The below-2x streak sits at {js_str(st['current'])} rounds (max {js_str(st['maxBelow'])}) — the ladder is worn out and a reset is more likely than another push.",
        "Shelf": f"No dominant signal — the shape layer reads {shape['classification']} and the measured band distribution governs (P(≥2x) {_pct(per['p'])}%).",
    }
    streak_part = f"drying {js_str(st['current'])} rounds" if st["currentKind"] == "below" else f"riding an above streak of {js_str(st['current'])}"
    tail_share = band_p[4] + band_p[5]
    tail_part = f" The next-round distribution still carries {_pct(tail_share)}% in the 10x+ moonshot bands." if tail_share >= 0.2 else ""
    rs = rectification_sample if rectification_sample is not None else 0
    rect = None
    if prior_correction:
        rect = {
            "active": abs(prior_correction) >= 0.05,
            "factor": _r4(correction),
            "biasPct": _r4(prior_correction),
            "sampleSize": rs,
            "note": (f"Model ran {_pct(prior_correction)}% low across {js_str(rs)} verified rounds — point estimate scaled up {to_fixed(correction, 2)}x (rectified)."
                     if prior_correction > 0 else
                     f"Model ran {_pct(-prior_correction)}% high across {js_str(rs)} verified rounds — point estimate scaled down {to_fixed(correction, 2)}x (rectified)."),
        }
    return {
        "source": source,
        "generatedAt": now_iso(),
        "cadenceMs": cadence,
        "state": state,
        "confidence": _r4(confidence),
        "confidenceLabel": label,
        "expectedMultiplier": tf(expected, 2),
        "rangeLo": tf(range_lo, 2),
        "rangeHi": tf(range_hi, 2),
        "band": band_label_of(expected),
        "distribution": [{"label": labels[i], "edge": edges[i], "probability": p, "representative": tf(reps[i], 2)} for i, p in enumerate(band_p)],
        "baseMultiplier": tf(expected_raw, 2),
        "tailLift": _r4(tail_lift),
        "moonshotReach": tf(moonshot_reach, 2),
        "rectification": rect,
        "lastRound": {"multiplier": last_m, "band": band_label_of(last_m)},
        "components": components,
        "note": f"{notes[state]} Last round settled {to_fixed(last_m, 2)}x in the {band_label_of(last_m)} band, {streak_part}.{tail_part}",
    }


nextRoundForecast = next_round_forecast


# ----------------------------------------------------------------- verify

def _new_acc():
    return {"n": 0, "brier": 0, "base": 0, "logloss": 0, "hits": 0}


def _score(acc, p, y, base):
    pc = _clamp(p, 1e-6, 1 - 1e-6)
    acc["n"] += 1
    acc["brier"] += (pc - y) ** 2
    acc["base"] += (base - y) ** 2
    acc["logloss"] += -(y * math.log(pc) + (1 - y) * math.log(1 - pc))
    if (pc >= 0.5) == (y == 1):
        acc["hits"] += 1


def _finalize(acc):
    n = max(1, acc["n"])
    return {"brier": _r5(acc["brier"] / n), "base": _r5(acc["base"] / n), "logloss": _r5(acc["logloss"] / n), "hitRate": _r4(acc["hits"] / n)}


def _model_row(name, acc):
    n = max(1, acc["n"])
    return {"model": name, "blocks": acc["n"], "brier": _r5(acc["brier"] / n), "logloss": _r5(acc["logloss"] / n), "hitRate": _r4(acc["hits"] / n)}


def verify_against_history(rounds, opts: dict | None = None) -> dict:
    opts = opts or {}
    thresholds = opts.get("thresholds") or [2, 5, 10]
    windows = opts.get("windows") or WINDOWS
    warmup = max(300, opts.get("warmup") if opts.get("warmup") is not None else 500)
    cadence = opts.get("cadenceMs") if opts.get("cadenceMs") is not None else median_interval_ms(rounds)
    n = len(rounds)
    runs = []
    blocks_total = 0
    for t in thresholds:
        flags = [1 if r.multiplier >= t else 0 for r in rounds]
        prefix = [0] * (n + 1)
        for i in range(n):
            prefix[i + 1] = prefix[i] + flags[i]
        # below_before[i] = length of the zero-run ending at i-1 (the archive's inner back-scan)
        below_before = [0] * (n + 1)
        for i in range(1, n + 1):
            below_before[i] = below_before[i - 1] + 1 if flags[i - 1] == 0 else 0
        for w in windows:
            block_size = _clamp(jround(w["ms"] / cadence), 1, n - warmup)
            block_size = int(block_size)
            # Deliberate deviation: v6.5 let block_size go negative when n < warmup and then
            # indexed past the tape (NaN rows). Python reports such runs as insufficient.
            if n < warmup + block_size * 2 or block_size < 1:
                runs.append({"window": w["id"], "label": w["label"], "blockSize": block_size, "threshold": t, "blocks": 0,
                             "brier": 0, "brierBase": 0, "logloss": 0, "hitRate": 0, "liftPct": 0, "verdict": "insufficient", "models": []})
                continue
            acc_base, acc_markov, acc_recent, acc_streak, acc_ens = _new_acc(), _new_acc(), _new_acc(), _new_acc(), _new_acc()
            high_count = 0
            hh = hl = lh = ll = 0
            below_run = 0
            # incremental streak tables over i in [1, start): counts by run length
            run_n: dict[int, int] = {}
            run_hits: dict[int, int] = {}
            upto = 1
            blocks = (n - warmup) // block_size
            wts = opts.get("blockWeights") or {"baseline": 0.25, "markov": 0.25, "streak": 0.25, "recent": 0.25}
            w_total = jsum(wts.values()) or 1
            for b in range(blocks):
                start = warmup + b * block_size
                end = start + block_size
                base = high_count / max(1, start)
                prev_hit = flags[start - 1] == 1
                if prev_hit:
                    p_markov = hh / (hh + hl) if hh + hl > 0 else base
                else:
                    p_markov = lh / (lh + ll) if lh + ll > 0 else base
                while upto < start:
                    if flags[upto - 1] == 0:
                        k = below_before[upto]
                        run_n[k] = run_n.get(k, 0) + 1
                        if flags[upto] == 1:
                            run_hits[k] = run_hits.get(k, 0) + 1
                    upto += 1
                s_n = s_hits = 0
                if not prev_hit:
                    s_n = run_n.get(below_run, 0)
                    s_hits = run_hits.get(below_run, 0)
                p_streak = s_hits / s_n if s_n >= 10 else base
                tail_start = max(0, start - 200)
                p_recent = (prefix[start] - prefix[tail_start]) / max(1, start - tail_start)
                ens_inputs = [("baseline", base), ("markov", p_markov), ("streak", p_streak), ("recent", p_recent)]
                z = 0
                for m, p in ens_inputs:
                    z = z + ((wts.get(m) or 0) / w_total) * _logit(p)
                p_ens = _sigmoid(z)
                y = 1 if prefix[end] - prefix[start] > 0 else 0
                _score(acc_base, base, y, base)
                _score(acc_markov, p_markov, y, base)
                _score(acc_streak, p_streak, y, base)
                _score(acc_recent, p_recent, y, base)
                _score(acc_ens, p_ens, y, base)
                for i in range(start, end):
                    if flags[i] == 1:
                        high_count += 1
                        below_run = 0
                    else:
                        below_run += 1
                    if i > 0:
                        if flags[i - 1] == 1:
                            if flags[i] == 1:
                                hh += 1
                            else:
                                hl += 1
                        elif flags[i] == 1:
                            lh += 1
                        else:
                            ll += 1
            f_base = _finalize(acc_base)
            models = [_model_row("markov", acc_markov), _model_row("streak", acc_streak), _model_row("recent", acc_recent), _model_row("ensemble", acc_ens)]
            f_ens = _finalize(acc_ens)
            lift = ((f_ens["brier"] - f_base["brier"]) / f_base["brier"]) * 100 if f_base["brier"] > 0 else 0
            blocks_total += acc_base["n"]
            runs.append({
                "window": w["id"], "label": w["label"], "blockSize": block_size, "threshold": t, "blocks": acc_base["n"],
                "brier": f_base["brier"], "brierBase": f_base["brier"], "logloss": f_base["logloss"], "hitRate": f_base["hitRate"],
                "liftPct": tf(lift, 2),
                "verdict": "insufficient" if acc_base["n"] < 20 else "accepted" if f_ens["brier"] <= f_base["brier"] * 0.995 else "rejected",
                "models": models,
            })
    return {"runs": runs, "scanned": n, "blocks": blocks_total, "cadenceMs": cadence, "generatedAt": now_iso()}


verifyAgainstHistory = verify_against_history


def skills_from_runs(runs) -> dict:
    acc: dict[str, list] = {}
    for run in runs:
        if run["verdict"] == "insufficient" or not run["blocks"]:
            continue
        for m in run["models"]:
            e = acc.setdefault(m["model"], [0, 0])
            e[0] += (run["brierBase"] - m["brier"]) * run["blocks"]
            e[1] += run["blocks"]
    return {k: (_r5(e[0] / e[1]) if e[1] else 0) for k, e in acc.items()}


skillsFromRuns = skills_from_runs
