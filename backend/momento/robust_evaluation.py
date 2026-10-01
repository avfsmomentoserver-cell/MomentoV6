"""Locked chronological holdout evidence — port of robust-evaluation.ts.

Answers one question only: does the published forecast beat the historical
band frequencies on an untouched final holdout? "demonstrated-skill" needs the
paired log-loss gain above ``minSeMultiple`` SE and positive mean Brier skill.
"""

from __future__ import annotations

import math

from .analysis import band_index
from .calibration import (
    CAL_NB, apply_distribution, fit_recalibrator, identity_recalibrator, log_loss, map_level,
    quantile_at, range_profile, sanitize_dist, survival_at,
)
from .jsutil import js_str, jsum, to_fixed

PUBLIC_THRESHOLDS = (2, 5, 10, 20, 50, 100)
EVIDENCE_VERSION = "robust-evidence-v1"


def _mean(xs) -> float:
    return jsum(xs) / len(xs) if xs else 0


def _clamp01(x: float) -> float:
    return min(1 - 1e-6, max(1e-6, x))


def _r6(x):
    if x is None or not isinstance(x, (int, float)) or not math.isfinite(x):
        return None
    return math.floor(x * 1e6 + 0.5) / 1e6


def _standard_error(xs: list) -> float:
    if len(xs) < 2:
        return math.inf
    m = _mean(xs)
    v = jsum((x - m) ** 2 for x in xs) / (len(xs) - 1)
    return math.sqrt(v / len(xs))


def clean_samples(inp) -> list:
    out = []
    for s in inp or []:
        if not s:
            continue
        d = sanitize_dist(s.get("dist"))
        a = s.get("actual")
        if d and isinstance(a, (int, float)) and math.isfinite(a) and a >= 1:
            out.append({"dist": d, "actual": a})
    return out


cleanSamples = clean_samples


def baseline_distribution(train) -> list:
    counts = [1] * CAL_NB
    for s in train:
        counts[band_index(s["actual"])] += 1
    total = sum(counts)
    return [c / total for c in counts]


baselineDistribution = baseline_distribution


def _threshold_row(holdout, published, threshold, base):
    p = [survival_at(d, threshold) for d in published]
    y = [1 if s["actual"] >= threshold else 0 for s in holdout]
    brier = _mean([(v - y[i]) ** 2 for i, v in enumerate(p)])
    baseline_brier = None if base is None else _mean([(base - v) ** 2 for v in y])
    return {
        "threshold": threshold,
        "sample": len(holdout),
        "predicted": _mean(p),
        "observed": _mean(y),
        "brier": brier,
        "baselineBrier": baseline_brier,
        "brierSkillPct": ((baseline_brier - brier) / baseline_brier) * 100 if baseline_brier is not None and baseline_brier > 0 else None,
    }


def _interval_coverage(holdout, published, rc, lo=0.25, hi=0.75):
    if not holdout:
        return None
    q_lo = map_level(rc, lo)
    q_hi = map_level(rc, hi)
    inside = 0
    for i, s in enumerate(holdout):
        a = quantile_at(published[i], q_lo)
        b = quantile_at(published[i], q_hi)
        if a <= s["actual"] <= b:
            inside += 1
    return inside / len(holdout)


def evaluate_locked_holdout(inp, options: dict | None = None) -> dict:
    options = options or {}
    all_s = clean_samples(inp)
    rejected = len(inp or []) - len(all_s)
    hf = options.get("holdoutFraction")
    fraction = min(0.5, max(0.05, 0.2 if hf is None else hf))
    cut = math.floor(len(all_s) * (1 - fraction))
    train = all_s[:cut]
    holdout = all_s[cut:]
    min_train = options.get("minTrainingSample", 100)
    min_hold = options.get("minHoldoutSample", 50)
    prof = range_profile(options.get("rangeProfile"))

    if len(train) < min_train or len(holdout) < min_hold:
        rc = identity_recalibrator("Locked holdout not evaluated: insufficient resolved forecasts.", len(all_s))
        raw = [s["dist"] for s in holdout]
        return {
            "status": "insufficient-data",
            "reason": f"Locked holdout requires {min_train} training and {min_hold} holdout forecasts; found {len(train)} and {len(holdout)}.",
            "trainingSample": len(train), "holdoutSample": len(holdout), "rejectedSample": rejected,
            "rawLogLoss": None, "calibratedLogLoss": None, "baselineLogLoss": None,
            "logLossImprovementPct": None, "baselineSkillPct": None, "baselineGainSe": None,
            "meanBrierSkillPct": None, "coverage50": None, "rangeCoverage": None,
            "rangeProfile": prof["name"], "rangeNominal": prof["nominal"],
            "recalibrator": rc, "baselineDistribution": None,
            "thresholds": [_threshold_row(holdout, raw, t, None) for t in PUBLIC_THRESHOLDS],
        }

    rc = fit_recalibrator(train, options)
    base_dist = baseline_distribution(train)
    published = [apply_distribution(s["dist"], rc) for s in holdout]
    raw_losses = [log_loss(s["dist"], s["actual"]) for s in holdout]
    pub_losses = [log_loss(d, holdout[i]["actual"]) for i, d in enumerate(published)]
    base_losses = [log_loss(base_dist, s["actual"]) for s in holdout]
    raw = _mean(raw_losses)
    pub = _mean(pub_losses)
    base = _mean(base_losses)
    gains = [b - pub_losses[i] for i, b in enumerate(base_losses)]
    gain = _mean(gains)
    se = _standard_error(gains)
    rows = [_threshold_row(holdout, published, t, _clamp01(_mean([1 if s["actual"] >= t else 0 for s in train]))) for t in PUBLIC_THRESHOLDS]
    skill_rows = [r for r in rows if r["brierSkillPct"] is not None]
    mean_skill = _mean([r["brierSkillPct"] for r in skill_rows]) if skill_rows else 0
    se_multiple = options.get("minSeMultiple", 1)
    min_brier = options.get("minimumBrierSkillPct", 0)
    beats = gain > 0 and gain > se_multiple * se
    demonstrated = beats and mean_skill > min_brier
    detail = (
        f"published log loss {to_fixed(pub, 5)} vs baseline {to_fixed(base, 5)} "
        f"(gain {to_fixed(gain, 5)} ± {to_fixed(se, 5) if math.isfinite(se) else '∞'} SE), "
        f"mean threshold Brier skill {to_fixed(mean_skill, 2)}% on {len(holdout)} untouched rounds"
    )
    return {
        "status": "demonstrated-skill" if demonstrated else "no-demonstrated-skill",
        "reason": (f"Published forecast beat the unconditional baseline on the locked holdout: {detail}." if demonstrated
                   else f"No demonstrated skill over historical band frequencies on the locked holdout: {detail}."),
        "trainingSample": len(train),
        "holdoutSample": len(holdout),
        "rejectedSample": rejected,
        "rawLogLoss": raw,
        "calibratedLogLoss": pub,
        "baselineLogLoss": base,
        "logLossImprovementPct": ((raw - pub) / raw) * 100 if raw > 0 else None,
        "baselineSkillPct": ((base - pub) / base) * 100 if base > 0 else None,
        "baselineGainSe": se if math.isfinite(se) else None,
        "meanBrierSkillPct": mean_skill,
        "coverage50": _interval_coverage(holdout, published, rc),
        "rangeCoverage": _interval_coverage(holdout, published, rc, prof["lo"], prof["hi"]),
        "rangeProfile": prof["name"],
        "rangeNominal": prof["nominal"],
        "recalibrator": rc,
        "baselineDistribution": base_dist,
        "thresholds": rows,
    }


evaluateLockedHoldout = evaluate_locked_holdout


def summarize_evidence(ev: dict, live: dict, meta: dict) -> dict:
    return {
        "version": EVIDENCE_VERSION,
        "status": ev["status"],
        "reason": ev["reason"],
        "dataCutoffMs": meta.get("dataCutoffMs"),
        "ledgerWindow": meta.get("ledgerWindow"),
        "trainingSample": ev["trainingSample"],
        "holdoutSample": ev["holdoutSample"],
        "rejectedSample": ev["rejectedSample"],
        "recalibrationActive": live.get("active"),
        "quantileRecalibrationActive": live.get("quantileActive"),
        "recalibrationReason": live.get("reason"),
        "logLoss": {"raw": _r6(ev["rawLogLoss"]), "published": _r6(ev["calibratedLogLoss"]), "baseline": _r6(ev["baselineLogLoss"])},
        "baselineSkillPct": _r6(ev["baselineSkillPct"]),
        "meanBrierSkillPct": _r6(ev["meanBrierSkillPct"]),
        "coverage50": _r6(ev["coverage50"]),
        "rangeCoverage": _r6(ev["rangeCoverage"]),
        "rangeProfile": ev["rangeProfile"],
        "rangeNominal": ev["rangeNominal"],
        "thresholds": [
            {"threshold": t["threshold"], "predicted": _r6(t["predicted"]) or 0, "observed": _r6(t["observed"]) or 0, "brierSkillPct": _r6(t["brierSkillPct"])}
            for t in ev["thresholds"]
        ],
        "confidenceGated": False,
        "confidenceLabelUngated": None,
    }


summarizeEvidence = summarize_evidence


def unavailable_evidence(reason: str, meta: dict) -> dict:
    ev = evaluate_locked_holdout([])
    return {**summarize_evidence(ev, identity_recalibrator(reason), meta), "reason": reason}


unavailableEvidence = unavailable_evidence


def gate_confidence(forecast: dict, evidence: dict, enabled: bool = True) -> dict:
    gated = bool(enabled) and evidence["status"] != "demonstrated-skill" and forecast.get("confidenceLabel") != "LOW"
    return {
        "forecast": {**forecast, "confidenceLabel": "LOW"} if gated else forecast,
        "evidence": {**evidence, "confidenceGated": gated, "confidenceLabelUngated": forecast.get("confidenceLabel")},
    }


gateConfidence = gate_confidence
