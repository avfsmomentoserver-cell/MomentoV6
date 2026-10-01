"""Momento V6.4 research engines — port of v64.ts (pure, no I/O).

Top-rounds parser, cadence model, gap reconstruction, span seeder, DNA k-mer
scans + live overlay, linguistics v2, investigation case files and the
analogue-ensemble shape projection. Every statistic sits next to its baseline.
"""

from __future__ import annotations

import datetime as _dt
import json
import math
import re

from .clock import iso, parse_iso_ms
from .jsutil import js_str, jround, jsum, r2, r4, to_fixed

AVIATOR = {"blue": "rgb(52, 180, 255)", "purple": "rgb(145, 62, 248)", "pink": "rgb(192, 23, 180)"}


def hue_of(m: float) -> str:
    return "blue" if m < 2 else "purple" if m < 10 else "pink"


hueOf = hue_of


def _ln(m: float) -> float:
    return math.log(max(1, m))


_M32 = 0xFFFFFFFF


def mulberry32(seed: int):
    st = [int(seed) & _M32]

    def rnd() -> float:
        st[0] = (st[0] + 0x6D2B79F5) & _M32
        t = st[0]
        t = ((t ^ (t >> 15)) * (t | 1)) & _M32
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & _M32)) & _M32
        return ((t ^ (t >> 14)) & _M32) / 4294967296

    return rnd


def _median(xs) -> float:
    if not xs:
        return 0
    s = sorted(xs)
    h = len(s) >> 1
    return s[h] if len(s) % 2 else (s[h - 1] + s[h]) / 2


def _quant(srt, q) -> float:
    if not srt:
        return 0
    i = (len(srt) - 1) * q
    lo = math.floor(i)
    hi = math.ceil(i)
    return srt[lo] + (srt[hi] - srt[lo]) * (i - lo)


def _wilson(k, n, z=1.96):
    if not n:
        return [0, 1]
    p = k / n
    d = 1 + (z * z) / n
    c = (p + (z * z) / (2 * n)) / d
    h = (z * math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
    return [max(0, c - h), min(1, c + h)]


def _zscore(k, n, p0) -> float:
    if not n or p0 <= 0 or p0 >= 1:
        return 0
    return (k - n * p0) / math.sqrt(n * p0 * (1 - p0))


# ------------------------------------------------------------- range filter

def apply_range(rounds, f: dict) -> list:
    out = rounds
    if f.get("fromMs"):
        out = [r for r in out if r.tsMs >= f["fromMs"]]
    if f.get("toMs"):
        out = [r for r in out if r.tsMs <= f["toMs"]]
    if f.get("sessionId"):
        out = [r for r in out if r.sessionId == f["sessionId"]]
    if f.get("minX"):
        out = [r for r in out if r.multiplier >= f["minX"]]
    if f.get("maxX"):
        out = [r for r in out if r.multiplier <= f["maxX"]]
    ln_ = f.get("lastN")
    if ln_ and len(out) > ln_:
        out = out[-int(ln_):]
    return out


applyRange = apply_range


def _js_number(v: str):
    """Number(v) for query strings: '' → 0 handled by caller; invalid → NaN."""
    try:
        s = v.strip()
        if s == "":
            return 0.0
        if s.lower().startswith(("0x", "-0x", "+0x")):
            return float(int(s, 16))
        x = float(s)
        if s.lower() in ("inf", "+inf", "-inf", "nan", "infinity", "-infinity", "+infinity") and s not in ("Infinity", "-Infinity", "+Infinity"):
            return math.nan
        return x
    except ValueError:
        return math.nan


def range_from_query(q) -> dict:
    def num(k):
        v = q.get(k)
        if v is None or v == "":
            return None
        n = _js_number(v)
        return n if math.isfinite(n) else None

    def time(k):
        v = q.get(k)
        if not v:
            return None
        n = _js_number(v)
        if math.isfinite(n):
            return n if n > 1e12 else n * 1000
        return parse_iso_ms(v)

    return {"fromMs": time("from"), "toMs": time("to"), "minX": num("minX"), "maxX": num("maxX"), "sessionId": num("session"), "lastN": num("lastN")}


rangeFromQuery = range_from_query


# -------------------------------------------------------- top-rounds parser

def date_utc(y: int, mo0: int, d: int, h: int = 0, mi: int = 0, s: int = 0) -> int:
    """Date.UTC with JS overflow semantics (month 12 → next year, day 0 → previous month end)."""
    y += mo0 // 12
    mo0 %= 12
    base = _dt.datetime(y, mo0 + 1, 1, tzinfo=_dt.timezone.utc)
    t = base + _dt.timedelta(days=d - 1, hours=h, minutes=mi, seconds=s)
    return int((t - _dt.datetime(1970, 1, 1, tzinfo=_dt.timezone.utc)).total_seconds() * 1000)


_ROW_RE = re.compile(r"([0-9]{2})\.([0-9]{2})\.([0-9]{2})\s+([0-9]{2}):([0-9]{2})(?:\s*</div>\s*<div[^>]*>)?\s*([0-9][0-9,\s]*(?:\.[0-9]+)?)\s*x", re.I)
_ACTIVE_RE = re.compile(r'top-tab-switcher__tab[^"]*--active[^"]*"[^>]*>\s*([A-Za-z]+)\s*<')


def parse_top_rounds(inp: str, tz_offset_min: int = 120) -> dict:
    warnings, rows, blocks = [], [], []

    def to_ms(dd, mo, yy, hh, mi):
        return date_utc(2000 + int(yy), int(mo) - 1, int(dd), int(hh), int(mi)) - tz_offset_min * 60_000

    parts = re.split(r"<app-top-tab-switcher", inp, flags=re.I)[1:] if "top-tab-switcher" in inp else [inp]
    for part in parts:
        actives = _ACTIVE_RE.findall(part)
        metric = next((a for a in actives if re.fullmatch(r"(x|win|rounds)", a, re.I)), "Rounds")
        scope_raw = next((a for a in actives if re.fullmatch(r"(day|month|year)", a, re.I)), "unknown").lower()
        scope = scope_raw if scope_raw in ("day", "month", "year") else "unknown"
        text = part.replace("<!---->", "")
        local = []
        for m in _ROW_RE.finditer(text):
            raw = re.sub(r"[,\s]", "", m.group(6))
            try:
                mult = float(raw)
            except ValueError:
                continue
            if not math.isfinite(mult) or mult < 1:
                continue
            local.append({"scope": scope, "metric": metric, "localText": f"{m.group(1)}.{m.group(2)}.{m.group(3)} {m.group(4)}:{m.group(5)}",
                          "tsMs": to_ms(*m.groups()[:5]), "multiplier": mult})
        if not local:
            continue
        if not re.search("rounds", metric, re.I):
            warnings.append(f'A {metric} block was found — only the "Rounds" tab lists round multipliers; its rows were still read as multipliers.')
        blocks.append({"scope": scope, "metric": metric, "rows": len(local), "min": min(r["multiplier"] for r in local), "max": max(r["multiplier"] for r in local)})
        rows.extend(local)
    if not rows:
        warnings.append("No DD.MM.YY HH:MM + multiplier pairs were found.")
    return {"blocks": blocks, "rows": rows, "warnings": warnings}


parseTopRounds = parse_top_rounds


def scope_key(scope: str, ts_ms: float, tz_offset_min: int = 120) -> str:
    d = iso(ts_ms + tz_offset_min * 60_000)
    return d[:10] if scope == "day" else d[:7] if scope == "month" else d[:4] if scope == "year" else "unknown"


scopeKey = scope_key


# ------------------------------------------------------------ cadence model

def fit_cadence(rounds) -> dict:
    xs, ys = [], []
    for i in range(1, len(rounds)):
        if rounds[i].source != rounds[i - 1].source:
            continue
        d = rounds[i].tsMs - rounds[i - 1].tsMs
        if d <= 2_000 or d > 180_000:
            continue
        xs.append(_ln(rounds[i - 1].multiplier))
        ys.append(d)
    n = len(xs)
    if n < 30:
        return {"a": 12_000, "b": 6_000, "medianMs": 14_000, "sample": n}
    mx = jsum(xs) / n
    my = jsum(ys) / n
    sxy = sxx = 0
    for i in range(n):
        sxy += (xs[i] - mx) * (ys[i] - my)
        sxx += (xs[i] - mx) ** 2
    b = max(0, sxy / sxx) if sxx > 0 else 0
    a = max(3_000, my - b * mx)
    return {"a": jround(a), "b": jround(b), "medianMs": jround(_median(ys)), "sample": n}


fitCadence = fit_cadence


def step_ms(c: dict, prev_mult: float) -> float:
    return c["a"] + c["b"] * _ln(prev_mult)


stepMs = step_ms


# ------------------------------------------------------ gap reconstruction

def plan_reconstruction(observed, anchors_, caps, opts: dict) -> dict:
    cadence = fit_cadence(observed)
    rng = mulberry32(opts["seed"])
    pool = [r.multiplier for r in observed]
    gaps, out = [], []
    if len(pool) < 50:
        return {"gaps": gaps, "rounds": out, "cadence": cadence}

    def draw(cap):
        for _ in range(40):
            v = pool[math.floor(rng() * len(pool))]
            if cap is None or v < cap:
                return v
        return min(pool[math.floor(rng() * len(pool))], cap * 0.99 if cap else math.inf)

    sorted_anchors = sorted(anchors_, key=lambda a: a["tsMs"])
    for i in range(1, len(observed)):
        prev, nxt = observed[i - 1], observed[i]
        if prev.source != nxt.source:
            continue
        gap_ms = nxt.tsMs - prev.tsMs
        if gap_ms < opts["minGapSec"] * 1000 or gap_ms > opts["maxGapHours"] * 3_600_000:
            continue
        if opts.get("fromMs") and nxt.tsMs < opts["fromMs"]:
            continue
        if opts.get("toMs") and prev.tsMs > opts["toMs"]:
            continue
        in_gap = [a for a in sorted_anchors if prev.tsMs + 2_000 < a["tsMs"] < nxt.tsMs - 2_000]
        points = [{"tsMs": prev.tsMs, "multiplier": prev.multiplier, "anchor": False}]
        points += [{"tsMs": a["tsMs"], "multiplier": a["multiplier"], "anchor": True} for a in in_gap]
        points.append({"tsMs": nxt.tsMs, "multiplier": nxt.multiplier, "anchor": False})
        fills = 0
        gap_cap = None
        s = 1
        while s < len(points) and fills < opts["maxFillPerGap"]:
            a, b = points[s - 1], points[s]
            t = a["tsMs"]
            m = a["multiplier"]
            seg = []
            while fills + len(seg) < opts["maxFillPerGap"]:
                cap = caps(t)
                gap_cap = cap if gap_cap is None else gap_cap if cap is None else min(gap_cap, cap)
                v = draw(cap)
                t_next = t + step_ms(cadence, m)
                if t_next + step_ms(cadence, v) * 0.5 > b["tsMs"]:
                    break
                seg.append({"tsMs": jround(t_next), "multiplier": r2(v), "origin": "reconstructed"})
                t = t_next
                m = v
            if seg:
                span = seg[-1]["tsMs"] - a["tsMs"]
                target = b["tsMs"] - a["tsMs"] - step_ms(cadence, seg[-1]["multiplier"])
                k = target / span if span > 0 and target > 0 else 1
                for r in seg:
                    r["tsMs"] = jround(a["tsMs"] + (r["tsMs"] - a["tsMs"]) * min(1.5, max(0.6, k)))
            out.extend(seg)
            fills += len(seg)
            if b["anchor"]:
                out.append({"tsMs": b["tsMs"], "multiplier": b["multiplier"], "origin": "anchor"})
            s += 1
        gaps.append({"source": prev.source, "startMs": prev.tsMs, "endMs": nxt.tsMs, "gapSec": jround(gap_ms / 1000), "anchors": len(in_gap), "fills": fills, "cap": gap_cap})
    return {"gaps": gaps, "rounds": out, "cadence": cadence}


planReconstruction = plan_reconstruction


def spread_span(mults, start_ms, end_ms, cadence) -> list:
    if not mults:
        return []
    if len(mults) == 1:
        return [{"tsMs": start_ms, "multiplier": mults[0]}]
    steps = [step_ms(cadence, m) for m in mults[:-1]]
    total = jsum(steps)
    scale = (end_ms - start_ms) / total if total > 0 else 0
    t = start_ms
    out = []
    for i, m in enumerate(mults):
        out.append({"tsMs": jround(t), "multiplier": m})
        if i < len(steps):
            t += steps[i] * scale
    return out


spreadSpan = spread_span


# ------------------------------------------------------- DNA / pattern DNA

ALPHABETS = {
    "band": {"label": "6 bands · A <1.5 · B 1.5–2 · C 2–5 · D 5–10 · E 10–100 · F 100+", "symbols": ["A", "B", "C", "D", "E", "F"]},
    "hue": {"label": "Aviator colours · b blue <2 · p purple 2–10 · k pink 10+", "symbols": ["b", "p", "k"]},
    "binary": {"label": "Binary around a pivot (default 2x) · 0 below · 1 at/above", "symbols": ["0", "1"]},
    "tempo": {"label": "Hue × tempo · uppercase = long wait before the round", "symbols": ["b", "p", "k", "B", "P", "K"]},
}


def encode(rounds, alphabet: str, pivot: float = 2, cadence=None) -> list:
    out = []
    for i, r in enumerate(rounds):
        m = r.multiplier
        if alphabet == "band":
            out.append("A" if m < 1.5 else "B" if m < 2 else "C" if m < 5 else "D" if m < 10 else "E" if m < 100 else "F")
            continue
        if alphabet == "binary":
            out.append("1" if m >= pivot else "0")
            continue
        h = "b" if m < 2 else "p" if m < 10 else "k"
        if alphabet == "hue":
            out.append(h)
            continue
        prev = rounds[i - 1] if i > 0 else None
        expected = step_ms(cadence, prev.multiplier) if cadence and prev else 15_000
        slow = (r.tsMs - prev.tsMs > expected * 1.8) if prev else False
        out.append(h.upper() if slow else h)
    return out


def _pattern_row(pattern, k, n, hits, s, base, last_ms):
    return {"pattern": pattern, "k": k, "n": n, "hits": hits, "rate": r4(hits / n), "ci": [r4(v) for v in _wilson(hits, n)],
            "base": r4(base), "lift": r4(hits / n / base if base else 0), "z": r2(_zscore(hits, n, base)), "avgNext": r2(s / n), "lastSeenMs": last_ms}


def dna_scan(rounds, opts: dict) -> dict:
    alphabet = opts["alphabet"]
    sym = encode(rounds, alphabet, opts.get("pivot") if opts.get("pivot") is not None else 2, opts.get("cadence"))
    tgt = opts["target"]
    in_t = [tgt["lo"] <= r.multiplier < tgt["hi"] for r in rounds]
    n_all = max(1, len(rounds))
    base = sum(1 for x in in_t if x) / n_all
    table: dict[str, list] = {}
    last: dict[str, float] = {}
    k_min, k_max = opts["kMin"], opts["kMax"]
    for k in range(k_min, k_max + 1):
        for i in range(k, len(rounds)):
            p = f"{k}:{''.join(sym[i - k:i])}"
            row = table.get(p)
            if row is None:
                row = table[p] = [0, 0, 0]
            row[0] += 1
            if in_t[i]:
                row[1] += 1
            row[2] += min(rounds[i].multiplier, 1000)
            last[p] = rounds[i].tsMs
    all_p = []
    by_k: dict[int, dict] = {}
    for key, (n, hits, s) in table.items():
        k = int(key.split(":")[0])
        agg = by_k.get(k) or {"patterns": 0, "significant": 0, "maxAbsZ": 0}
        agg["patterns"] += 1
        if n < opts["minSupport"]:
            by_k[k] = agg
            continue
        z = _zscore(hits, n, base)
        if abs(z) >= 3:
            agg["significant"] += 1
        agg["maxAbsZ"] = max(agg["maxAbsZ"], abs(z))
        by_k[k] = agg
        all_p.append({"pattern": key.split(":")[1], "k": k, "n": n, "hits": hits, "rate": r4(hits / n), "ci": [r4(v) for v in _wilson(hits, n)],
                      "base": r4(base), "lift": r4(hits / n / base if base else 0), "z": r2(z), "avgNext": r2(s / n), "lastSeenMs": last.get(key)})
    tested = len(all_p)
    efp = r2(tested * 0.0027)
    significant = sum(1 for p in all_p if abs(p["z"]) >= 3)
    limit = opts.get("limit") if opts.get("limit") is not None else 40
    top = sorted(all_p, key=lambda p: -p["z"])[:limit]
    under = sorted(all_p, key=lambda p: p["z"])[:min(15, limit)]
    live = []
    for k in range(k_min, k_max + 1):
        p = "".join(sym[-k:]) if k else "".join(sym)
        hit = next((x for x in all_p if x["k"] == k and x["pattern"] == p), None)
        if hit:
            live.append(hit)
        else:
            row = table.get(f"{k}:{p}")
            if row:
                live.append(_pattern_row(p, k, row[0], row[1], row[2], base, last.get(f"{k}:{p}")))
    excess = significant - efp
    if tested == 0:
        verdict = "Not enough data for this range — widen the filter or lower min support."
    elif excess > max(3, 2 * math.sqrt(efp + 1)):
        verdict = f"{significant} patterns at |z|≥3 vs ~{js_str(efp)} expected by chance — structure worth a hold-out test."
    else:
        verdict = f"{significant} patterns at |z|≥3 vs ~{js_str(efp)} expected by chance — consistent with randomness (no reliable DNA edge)."
    return {
        "alphabet": alphabet, "alphabetLabel": ALPHABETS[alphabet]["label"], "target": tgt, "kRange": [k_min, k_max],
        "analysed": len(rounds), "baseRate": r4(base), "tested": tested, "expectedFalsePositives": efp, "significant": significant,
        "top": top, "under": under, "live": live,
        "byK": [{"k": k, **v, "maxAbsZ": r2(v["maxAbsZ"])} for k, v in sorted(by_k.items())],
        "verdict": verdict, "table": table,
    }


dnaScan = dna_scan


def dna_overlay(rounds, snapshot: dict, cadence=None) -> list:
    sym = encode(rounds[-64:], snapshot["alphabet"], snapshot.get("pivot") if snapshot.get("pivot") is not None else 2, cadence)
    out = []
    lo, hi = snapshot["kRange"]
    base = snapshot["baseRate"]
    for k in range(lo, hi + 1):
        p = "".join(sym[-k:]) if k else "".join(sym)
        row = snapshot["table"].get(f"{k}:{p}")
        if not row:
            out.append({"k": k, "pattern": p, "n": 0, "rate": 0, "lift": 0, "z": 0})
            continue
        out.append({"k": k, "pattern": p, "n": row[0], "rate": r4(row[1] / row[0]), "lift": r4(row[1] / row[0] / base if base else 0), "z": r2(_zscore(row[1], row[0], base))})
    return out


dnaOverlay = dna_overlay


# ----------------------------------------------------------- linguistics v2

WORDS = [
    {"word": "dust", "lo": 1, "hi": 1.2, "gloss": "instant crash"},
    {"word": "low", "lo": 1.2, "hi": 1.5, "gloss": "shallow flight"},
    {"word": "soft", "lo": 1.5, "hi": 2, "gloss": "near-miss below 2x"},
    {"word": "lift", "lo": 2, "hi": 3, "gloss": "clears 2x"},
    {"word": "climb", "lo": 3, "hi": 5, "gloss": "solid climb"},
    {"word": "rise", "lo": 5, "hi": 10, "gloss": "strong purple"},
    {"word": "surge", "lo": 10, "hi": 50, "gloss": "pink round"},
    {"word": "blast", "lo": 50, "hi": 100, "gloss": "deep pink"},
    {"word": "moon", "lo": 100, "hi": 1000, "gloss": "three-digit moon"},
    {"word": "legend", "lo": 1000, "hi": math.inf, "gloss": "four-digit+ legend"},
]


def word_of(m: float) -> str:
    for w in WORDS:
        if w["lo"] <= m < w["hi"]:
            return w["word"]
    return WORDS[-1]["word"]


wordOf = word_of


def _entropy(arr) -> float:
    c: dict[str, int] = {}
    for w in arr:
        c[w] = c.get(w, 0) + 1
    h = 0
    for v in c.values():
        p = v / len(arr)
        h -= p * math.log2(p)
    return h


def linguistics_v2(rounds, depth: int = 240, cadence=None) -> dict:
    words = [word_of(r.multiplier) for r in rounds]
    n = len(words) or 1
    counts: dict[str, int] = {}
    for w in words:
        counts[w] = counts.get(w, 0) + 1
    lexicon = [{"word": w["word"], "gloss": w["gloss"], "lo": w["lo"], "hi": 1e9 if w["hi"] == math.inf else w["hi"],
                "count": counts.get(w["word"], 0), "share": r4(counts.get(w["word"], 0) / n), "hue": hue_of(w["lo"])} for w in WORDS]
    entropy_bits = r4(_entropy(words))
    trend = []
    win = 200
    stp = max(1, len(words) // 60)
    i = win
    while i <= len(words):
        trend.append({"index": i, "bits": r4(_entropy(words[i - win:i]))})
        i += stp
    tail = rounds[-depth:] if depth else rounds[:]
    stream = []
    for idx, r in enumerate(tail):
        gi = len(rounds) - len(tail) + idx
        prev = rounds[gi - 1] if gi - 1 >= 0 else None
        d = r.tsMs - prev.tsMs if prev else 0
        exp = step_ms(cadence, prev.multiplier) if cadence and prev else 15_000
        tempo = "steady" if not prev else "gap" if d > 180_000 else "slow" if d > exp * 1.6 else "quick" if d < exp * 0.7 else "steady"
        stream.append({"id": r.id, "word": words[gi], "hue": hue_of(r.multiplier), "multiplier": r.multiplier, "ts": r.ts, "tempo": tempo, "origin": getattr(r, "origin", None)})
    sentences = []
    cur: list[str] = []
    for i, r in enumerate(rounds):
        cur.append(words[i])
        if r.multiplier >= 10:
            sentences.append({"words": cur, "closer": words[i], "closedAt": r.ts})
            cur = []
    p_pink = sum(1 for r in rounds if r.multiplier >= 10) / n
    lens = [len(s["words"]) for s in sentences]

    def bucket(L):
        return "1–5" if L <= 5 else "6–10" if L <= 10 else "11–20" if L <= 20 else "21–40" if L <= 40 else "41–80" if L <= 80 else "81+"

    edges = [("1–5", 1, 5), ("6–10", 6, 10), ("11–20", 11, 20), ("21–40", 21, 40), ("41–80", 41, 80), ("81+", 81, 100000)]

    def geom_mass(a, b):
        return (1 - p_pink) ** (a - 1) - (1 - p_pink) ** b if p_pink > 0 else 0

    hist = [{"length": lab, "count": sum(1 for L in lens if bucket(L) == lab), "expected": r2(len(sentences) * geom_mass(a, b))} for lab, a, b in edges]

    def share(w):
        return counts.get(w, 0) / n

    phrase_rows = []
    for g in range(2, 5):
        c: dict[str, int] = {}
        for i in range(g, len(words) + 1):
            p = " ".join(words[i - g:i])
            c[p] = c.get(p, 0) + 1
        positions = max(1, len(words) - g + 1)
        for p, cnt in c.items():
            p_exp = 1
            for w in p.split(" "):
                p_exp = p_exp * share(w)
            expected = positions * p_exp
            if expected < 3 and cnt < 5:
                continue
            z = (cnt - expected) / math.sqrt(expected * (1 - p_exp)) if expected > 0 else 0
            phrase_rows.append({"phrase": p, "n": g, "count": cnt, "expected": r2(expected), "lift": r2(cnt / expected if expected else 0), "z": r2(z)})
    phrases = sorted(phrase_rows, key=lambda r: -r["z"])[:30]
    under = sorted(phrase_rows, key=lambda r: r["z"])[:12]
    next_word = {"context": "", "order": 0, "support": 0, "dist": [], "pLift2x": 0, "base2x": 0}
    base2x = sum(1 for r in rounds if r.multiplier >= 2) / n
    for order in (3, 2, 1):
        if len(words) <= order:
            continue
        ctx_list = words[-order:]
        ctx = " ".join(ctx_list)
        follow: dict[str, int] = {}
        support = ge2 = 0
        for i in range(order, len(words)):
            if words[i - order:i] != ctx_list:
                continue
            support += 1
            follow[words[i]] = follow.get(words[i], 0) + 1
            if rounds[i].multiplier >= 2:
                ge2 += 1
        if support >= 30 or order == 1:
            next_word = {
                "context": ctx, "order": order, "support": support,
                "dist": [{"word": w["word"], "p": r4(follow.get(w["word"], 0) / max(1, support)), "base": r4(share(w["word"]))} for w in WORDS],
                "pLift2x": r4(ge2 / support if support else 0), "base2x": r4(base2x),
            }
            break
    cw = cur
    narrative = (
        f"The market has spoken {len(cw)} word{'' if len(cw) == 1 else 's'} since the last surge"
        + (f" (“…{' '.join(cw[-8:])}”)" if cw else "")
        + f". A sentence ends at a pink round; with P(≥10x) = {to_fixed(p_pink * 100, 1)}% the expected sentence length is {to_fixed(1 / p_pink, 1) if p_pink else '—'} words. "
        + f"Vocabulary entropy is {to_fixed(entropy_bits, 2)} of {to_fixed(math.log2(len(WORDS)), 2)} bits — "
        + f"after “{next_word['context']}”, P(next ≥2x) = {to_fixed(next_word['pLift2x'] * 100, 1)}% vs {to_fixed(base2x * 100, 1)}% overall (n={next_word['support']})."
    )
    return {
        "analysed": len(rounds), "lexicon": lexicon, "entropyBits": entropy_bits, "maxEntropyBits": r4(math.log2(len(WORDS))),
        "entropyTrend": trend, "typeTokenRatio": r4(len(counts) / n), "stream": stream,
        "sentences": {
            "count": len(sentences),
            "meanLength": r2(jsum(lens) / len(lens) if lens else 0),
            "expectedLength": r2(1 / p_pink if p_pink else 0),
            "current": {"words": cw[-60:], "length": len(cw)},
            "recent": [{"words": s["words"][-24:], "length": len(s["words"]), "closer": s["closer"], "closedAt": s["closedAt"]} for s in reversed(sentences[-12:])],
            "lengthHistogram": hist,
        },
        "phrases": phrases, "underPhrases": under, "nextWord": next_word, "narrative": narrative,
    }


linguisticsV2 = linguistics_v2


def discover_phrases(rounds, min_count: int = 25) -> list:
    words = [word_of(r.multiplier) for r in rounds]
    n = len(words) or 1
    base = sum(1 for r in rounds if r.multiplier >= 2) / n
    out = []
    for g in range(1, 5):
        stats: dict[str, list] = {}
        for i in range(g, len(words)):
            p = " ".join(words[i - g:i])
            s = stats.get(p)
            if s is None:
                s = stats[p] = [0, 0]
            s[0] += 1
            if rounds[i].multiplier >= 2:
                s[1] += 1
        for p, (uses, hits) in stats.items():
            if uses < min_count:
                continue
            z = _zscore(hits, uses, base)
            rate = hits / uses
            out.append({
                "token": p.replace(" ", "·"), "layer": "word" if g == 1 else f"phrase-{g}", "layers": p.split(" "),
                "definition": f"After “{p}”, next round ≥2x {to_fixed(rate * 100, 1)}% vs {to_fixed(base * 100, 1)}% base (n={uses}, z={to_fixed(z, 2)}).",
                "uses": uses, "hits": hits, "misses": uses - hits, "score": r4(rate), "lift": r4(rate / base if base else 0), "z": r2(z),
            })
    return sorted(out, key=lambda o: -abs(o["z"]))[:80]


discoverPhrases = discover_phrases


# ----------------------------------------------------------- investigation

def investigate_round(all_r, idx: int, calib: dict | None, cadence: dict, radius: int = 30) -> dict:
    r = all_r[idx]
    n = len(all_r)
    srt = sorted(x.multiplier for x in all_r)
    import bisect
    below = bisect.bisect_left(srt, r.multiplier)
    exceed = (n - below) / n

    def since_last(x):
        for j in range(idx - 1, -1, -1):
            if all_r[j].multiplier >= x:
                return idx - j
        return None

    def base_rate(x):
        return sum(1 for y in all_r if y.multiplier >= x) / n

    counters = []
    for x in (2, 5, 10, 50, 100):
        since = since_last(x)
        p = base_rate(x)
        counters.append({"threshold": x, "roundsSince": since, "expectedGap": r2(1 / p) if p else None, "pressure": r2(since * p) if since is not None and p else None})
    dry = 0
    j = idx - 1
    while j >= 0 and all_r[j].multiplier < 2:
        dry += 1
        j -= 1
    prev = all_r[idx - 1] if idx - 1 >= 0 else None
    delta_ms = r.tsMs - prev.tsMs if prev else None
    expected_ms = jround(step_ms(cadence, prev.multiplier)) if prev else None
    sess = [x for x in all_r if r.sessionId is not None and x.sessionId == r.sessionId]
    pos = next((i for i, x in enumerate(sess) if x.id == r.id), -1)
    sym = encode(all_r, "band")
    k = 6
    pattern = "".join(sym[idx - k:idx]) if idx >= k else ""
    pn = p_hit = 0
    base2 = base_rate(2)
    if pattern:
        pat = sym[idx - k:idx]
        for i in range(k, n):
            if i == idx:
                continue
            if sym[i - k:i] == pat:
                pn += 1
                if all_r[i].multiplier >= 2:
                    p_hit += 1
    W = 12
    analogues = []
    if idx >= W:
        lx = [min(_ln(x.multiplier), 5) for x in all_r]
        q = lx[idx - W:idx]
        for s in range(W, n):
            if abs(s - idx) < W:
                continue
            d = 0
            for jj in range(W):
                d += (lx[s - W + jj] - q[jj]) ** 2
            analogues.append({"index": s, "id": all_r[s].id, "ts": all_r[s].ts, "distance": r4(math.sqrt(d / W)), "next": all_r[s].multiplier})
        analogues.sort(key=lambda a: a["distance"])
        del analogues[12:]
    words = [word_of(x.multiplier) for x in all_r[max(0, idx - 20):idx + 1]]
    context = [{"id": x.id, "ts": x.ts, "multiplier": x.multiplier, "hue": hue_of(x.multiplier), "focus": x.id == r.id, "origin": getattr(x, "origin", None) or "observed"}
               for x in all_r[max(0, idx - radius):min(n, idx + radius + 1)]]
    parsed_loss = parsed_weights = None
    try:
        parsed_loss = json.loads(calib["comp_loss"]) if calib and calib.get("comp_loss") else None
        parsed_weights = json.loads(calib["weights"]) if calib and calib.get("weights") else None
    except (TypeError, ValueError):
        pass
    if delta_ms is None:
        verdict = "first round"
    elif delta_ms > 180_000:
        verdict = "after a session gap"
    elif expected_ms and delta_ms > expected_ms * 1.6:
        verdict = "slower than cadence"
    elif expected_ms and delta_ms < expected_ms * 0.7:
        verdict = "faster than cadence"
    else:
        verdict = "on cadence"
    return {
        "round": {"id": r.id, "ts": r.ts, "multiplier": r.multiplier, "source": r.source, "sessionId": r.sessionId, "hue": hue_of(r.multiplier), "word": word_of(r.multiplier), "origin": getattr(r, "origin", None) or "observed"},
        "rarity": {"percentile": r4(below / n), "exceedance": r4(exceed), "oneIn": r2(1 / exceed) if exceed > 0 else None, "rankFromTop": n - below},
        "timing": {"deltaMs": delta_ms, "expectedMs": expected_ms, "verdict": verdict},
        "counters": counters,
        "dryRunBefore": dry,
        "session": {"id": r.sessionId, "rounds": len(sess), "position": pos + 1, "max": r2(max(x.multiplier for x in sess))} if r.sessionId else None,
        "dna": {"pattern": pattern, "occurrences": pn, "rateGe2": r4(p_hit / pn) if pn else None, "base2": r4(base2)},
        "sentence": " ".join(words),
        "forecast": {"state": calib.get("state"), "expected": calib.get("expected"), "rangeLo": calib.get("range_lo"), "rangeHi": calib.get("range_hi"),
                     "confidence": calib.get("confidence"), "verdict": calib.get("verdict"), "reason": calib.get("reason"), "engineLoss": parsed_loss, "weights": parsed_weights} if calib else None,
        "analogues": [{**a, "next": r2(a["next"])} for a in analogues],
        "analogueNextGe2": r4(sum(1 for a in analogues if a["next"] >= 2) / len(analogues)) if analogues else None,
        "context": context,
    }


investigateRound = investigate_round


def investigate_range(all_r, slc) -> dict:
    def stat(rs):
        m = sorted(x.multiplier for x in rs)
        n = len(m) or 1
        acc = 0
        for b in m:
            acc = acc + min(b, 1000)
        return {
            "count": len(rs), "mean": r2(acc / n), "median": r2(_quant(m, 0.5)), "max": r2(m[-1] if m else 0),
            "ge2": r4(sum(1 for x in m if x >= 2) / n), "ge10": r4(sum(1 for x in m if x >= 10) / n),
            "ge100": r4(sum(1 for x in m if x >= 100) / n), "lt12": r4(sum(1 for x in m if x < 1.2) / n),
        }

    a = stat(slc)
    b = stat(all_r)
    xa = sorted(_ln(x.multiplier) for x in slc)
    xb = sorted(_ln(x.multiplier) for x in all_r)
    i = j = 0
    D = 0
    while i < len(xa) and j < len(xb):
        if xa[i] <= xb[j]:
            i += 1
        else:
            j += 1
        D = max(D, abs(i / len(xa) - j / len(xb)))
    ne = (len(xa) * len(xb)) / max(1, len(xa) + len(xb))
    lam = (math.sqrt(ne) + 0.12 + 0.11 / max(1e-9, math.sqrt(ne))) * D
    p = 0
    for k in range(1, 100):
        p += 2 * (-1) ** (k - 1) * math.exp(-2 * k * k * lam * lam)
    p = min(1, max(0, p))
    z2 = _zscore(jround(a["ge2"] * a["count"]), a["count"], b["ge2"]) if a["count"] else 0
    z10 = _zscore(jround(a["ge10"] * a["count"]), a["count"], b["ge10"]) if a["count"] else 0
    return {
        "slice": a, "overall": b, "ks": {"D": r4(D), "pValue": r4(p)}, "z": {"ge2": r2(z2), "ge10": r2(z10)},
        "verdict": "This range's distribution differs from the full history (KS p<0.01) — check for data issues or a regime change." if p < 0.01
        else "This range is statistically indistinguishable from the full history.",
        "hues": {"blue": sum(1 for x in slc if x.multiplier < 2), "purple": sum(1 for x in slc if 2 <= x.multiplier < 10), "pink": sum(1 for x in slc if x.multiplier >= 10)},
    }


investigateRange = investigate_range


# ------------------------------------------------------- shape projection

def _sign(x: float) -> float:
    if x > 0:
        return 1
    if x < 0:
        return -1
    return x  # ±0 / NaN like Math.sign


def name_shape(path) -> dict:
    n = len(path)
    if n < 3:
        return {"name": "Point", "family": "flat", "description": "Too short to shape."}
    end = path[-1] - path[0]
    mid = path[n // 2] - path[0]
    first_half = mid
    second_half = end - mid
    chop = 0
    for i in range(2, n):
        a = _sign(path[i] - path[i - 1])
        b = _sign(path[i - 1] - path[i - 2])
        if a != b:
            chop += 1
    chop_rate = chop / (n - 2)
    max_up = max(v - path[0] for v in path)
    min_dn = min(v - path[0] for v in path)
    scale = max(0.35, abs(max_up) + abs(min_dn)) / 2
    s = end / scale
    if max_up > 3 * max(0.5, abs(end)) and max_up > 1.2:
        return {"name": "Spike & Fade", "family": "spike", "description": "A single tall round lifts the path, then ordinary rounds bleed it back."}
    if first_half < -0.25 * scale and second_half > 0.35 * scale:
        return {"name": "V-Rebound", "family": "rebound", "description": "A dry dip followed by recovering rounds."}
    if first_half > 0.35 * scale and second_half < -0.25 * scale:
        return {"name": "Arch", "family": "arch", "description": "Early strength that rolls over into a dry finish."}
    if s > 0.9:
        return {"name": "Choppy Ascent" if chop_rate > 0.55 else "Rising Staircase", "family": "rise", "description": "Rounds clear the average more often than not — the path steps up."}
    if s < -0.9:
        return {"name": "Choppy Slide" if chop_rate > 0.55 else "Sliding Ramp", "family": "slide", "description": "A dry spell — rounds keep landing below the average."}
    if chop_rate > 0.6:
        return {"name": "Sawtooth Range", "family": "range", "description": "Alternating lifts and drops inside a band."}
    return {"name": "Flat Coil", "family": "flat", "description": "Sideways drift with no dominant direction."}


nameShape = name_shape


def _fmt_clock(ms: float, tz_offset_min: int = 120) -> str:
    return iso(int(ms + tz_offset_min * 60_000))[11:19]


def project_shape(rounds, opts: dict):
    W, H = opts["window"], opts["horizon"]
    n = len(rounds)
    if n < W + H + 200:
        return None
    cap = math.log(1000)
    x = [min(_ln(r.multiplier), cap) for r in rounds]
    mu = jsum(x) / n

    def path_of(end, length):
        out = [0]
        s = 0
        for i in range(end - length, end):
            s += x[i] - mu
            out.append(s)
        return out

    cur = path_of(n, W)

    def std(p):
        m = jsum(p) / len(p)
        sd = math.sqrt(jsum((b - m) ** 2 for b in p) / len(p)) or 1
        return [(v - m) / sd for v in p]

    cz = std(cur)
    lo = max(W, n - (opts.get("scanLimit") if opts.get("scanLimit") is not None else 60_000))
    cands = []
    last_cur = cur[-1]
    for e in range(lo, n - H):
        p = path_of(e, W)
        pz = std(p)
        d = 0
        for j in range(len(pz)):
            d += (pz[j] - cz[j]) ** 2
        d += 0.5 * (p[-1] - last_cur) ** 2
        cands.append((e, d))
    cands.sort(key=lambda c: c[1])
    K = min(opts["k"], len(cands))
    chosen = [c[0] for c in cands[:K]]
    cont = []
    for end in chosen:
        out, s = [], 0
        for h in range(H):
            s += x[end + h] - mu
            out.append(s)
        cont.append(out)
    last_level = cur[-1]
    path = []
    for h in range(H):
        col = sorted(c[h] for c in cont)
        path.append({"step": h + 1, "p25": r4(last_level + _quant(col, 0.25)), "p50": r4(last_level + _quant(col, 0.5)), "p75": r4(last_level + _quant(col, 0.75))})
    baseline_path = [r4(last_level)] * H
    cadence = opts["cadence"]
    last_r = rounds[-1]
    tz = opts.get("tzOffsetMin") if opts.get("tzOffsetMin") is not None else 120
    t = last_r.tsMs
    prev_m = last_r.multiplier
    decomputed = []
    for h in range(H):
        col = sorted(rounds[end + h].multiplier for end in chosen)
        p50 = _quant(col, 0.5)
        t += step_ms(cadence, prev_m)
        prev_m = p50
        decomputed.append({
            "step": h + 1, "etaMs": jround(t), "eta": _fmt_clock(t, tz),
            "p25": r2(_quant(col, 0.25)), "p50": r2(p50), "p75": r2(_quant(col, 0.75)),
            "pGe2": r4(sum(1 for v in col if v >= 2) / len(col)) if col else math.nan,
            "pGe10": r4(sum(1 for v in col if v >= 10) / len(col)) if col else math.nan,
            "hue": hue_of(p50),
        })
    etas = []
    for th in (2, 10, 100):
        p = sum(1 for r in rounds if r.multiplier >= th) / n
        firsts = []
        for end in chosen:
            f = None
            for h in range(H):
                if rounds[end + h].multiplier >= th:
                    f = h + 1
                    break
            firsts.append(f)
        within = [f for f in firsts if f is not None]
        p_within = len(within) / max(1, len(chosen))
        base_within = 1 - (1 - p) ** H
        ranked = sorted(math.inf if f is None else f for f in firsts)
        m50 = ranked[(len(ranked) - 1) // 2] if ranked else math.inf
        med = m50 if math.isfinite(m50) else None
        eta_ms = None
        if med is not None:
            eta_ms = decomputed[min(H - 1, max(0, int(jround(med)) - 1))]["etaMs"]
        etas.append({
            "threshold": th, "expectedRounds": med,
            "baselineRounds": max(1, math.ceil(math.log(0.5) / math.log(1 - p))) if 0 < p < 1 else 0,
            "meanWait": r2(1 / p) if p else 0, "etaMs": eta_ms, "eta": _fmt_clock(eta_ms, tz) if eta_ms else None,
            "pWithinHorizon": r4(p_within), "baselineWithinHorizon": r4(base_within),
        })
    named = name_shape([last_level] + [p["p50"] for p in path])
    spread = path[-1]["p75"] - path[-1]["p25"] if path else 1
    drift = path[-1]["p50"] - last_level if path else 0
    confidence = r4(max(0, min(1, abs(drift) / max(0.5, spread))))
    return {
        **named, "window": W, "horizon": H, "analogues": K,
        "currentShape": {**name_shape(cur), "path": [r4(v) for v in cur]},
        "path": path, "baselinePath": baseline_path, "rounds": decomputed, "etas": etas,
        "anchorTsMs": last_r.tsMs, "anchorRoundId": last_r.id, "drift": r4(drift), "confidence": confidence,
        "honesty": "Shape projections are analogue look-ups. Their skill is tracked against the flat (no-drift) path in the Chart-prediction ledger; on a fair RNG expect that skill to hover near zero.",
    }


projectShape = project_shape


def score_projection(stored: dict, realised, mu: float, start_level: float):
    H = min(len(stored["path"]), len(realised))
    if not H:
        return None
    s = start_level
    mae_m = mae_b = 0
    inside = 0
    actual = []
    cap = math.log(1000)
    for h in range(H):
        s += min(_ln(realised[h].multiplier), cap) - mu
        actual.append(r4(s))
        mae_m += abs(stored["path"][h]["p50"] - s)
        mae_b += abs(stored["baselinePath"][h] - s)
        if stored["path"][h]["p25"] <= s <= stored["path"][h]["p75"]:
            inside += 1
    mae_m /= H
    mae_b /= H
    return {"actual": actual, "maeModel": r4(mae_m), "maeBase": r4(mae_b), "skill": r4(1 - mae_m / mae_b if mae_b else 0), "iqrCoverage": r4(inside / H)}


scoreProjection = score_projection
