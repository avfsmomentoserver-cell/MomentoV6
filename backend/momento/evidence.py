"""P8 evidence report — walk-forward backtests on synthetic tapes.

Generates two synthetic tapes (iid and drift), runs every candidate engine
through a walk-forward backtest, and reports per-candidate:

  - sample count
  - mean log-loss delta vs baseline
  - standard error and 95% confidence interval
  - gate verdict (admitted / excluded / insufficient-data)
  - admission state

The report is honest: "not admitted" is a valid, expected result for most
candidates on iid data (where there is no real signal to exploit).
"""

from __future__ import annotations

import json
import math
import random
from datetime import datetime, timezone
from typing import Any

from .analysis import BAND_EDGES, BAND_LABELS, band_index
from .calibration import CAL_NB, log_loss, sanitize_dist
from .engine_gate import blend_admission

NB = len(BAND_LABELS)


def _empirical(multipliers: list[float]) -> list[float]:
    counts = [1] * NB
    for m in multipliers:
        counts[band_index(m)] += 1
    s = sum(counts)
    return [c / s for c in counts]


def _normalize(d: list) -> list:
    s = sum(d)
    return [c / s for c in d] if s > 0 else _empirical([])


def generate_iid_tape(n: int = 3000, seed: int = 42) -> list[float]:
    """IID tape: each round drawn independently from a fixed geometric distribution."""
    rng = random.Random(seed)
    return [max(1.0, round(0.97 / (1 - rng.random()), 2)) for _ in range(n)]


def generate_drift_tape(n: int = 3000, seed: int = 42) -> list[float]:
    """Drift tape: the underlying distribution shifts halfway through."""
    rng = random.Random(seed)
    out = []
    half = n // 2
    for i in range(n):
        p = 0.97 if i < half else 0.92  # second half has heavier tails
        out.append(max(1.0, round(p / (1 - rng.random()), 2)))
    return out


def _round_list_to_rounds(multipliers: list[float]):
    """Wrap multipliers in lightweight objects with .multiplier and .origin."""
    class _R:
        __slots__ = ("multiplier", "origin", "id")
        def __init__(self, m, i):
            self.multiplier = m
            self.origin = "observed"
            self.id = i
    return [_R(m, i) for i, m in enumerate(multipliers)]


def walk_forward_backtest(
    tape: list[float],
    candidate_predict: callable,
    train_size: int = 200,
    step: int = 20,
) -> dict:
    """Walk-forward backtest for a single candidate engine.

    Splits the tape into train/test windows of `train_size` rounds, stepping
    by `step` rounds.  For each window:
    1. Train: build the empirical baseline on the train window
    2. Predict: run the candidate's predict() on the train rounds
    3. Score: log-loss of both baseline and candidate on the next actual round

    Returns mean log-loss for baseline and candidate, the per-round gain
    distribution, SE, and 95% CI.
    """
    rounds = _round_list_to_rounds(tape)
    baseline_losses = []
    candidate_losses = []
    gains = []

    for start in range(0, len(tape) - train_size - 1, step):
        train = rounds[start:start + train_size]
        actual = tape[start + train_size]

        ms = [r.multiplier for r in train]
        base_dist = _empirical(ms)

        try:
            cand_dist = candidate_predict(train)
            if cand_dist is None or len(cand_dist) != NB:
                cand_dist = base_dist
            cand_dist = _normalize(cand_dist)
        except Exception:
            cand_dist = base_dist

        bl = log_loss(base_dist, actual)
        cl = log_loss(cand_dist, actual)
        baseline_losses.append(bl)
        candidate_losses.append(cl)
        gains.append(bl - cl)  # positive = candidate beats baseline

    n = len(gains)
    if n == 0:
        return {"sample": 0, "baselineLoss": None, "candidateLoss": None,
                "meanGain": None, "se": None, "ci95": None, "admitted": False,
                "status": "insufficient-data"}

    mean_gain = sum(gains) / n
    se = math.sqrt(sum((g - mean_gain) ** 2 for g in gains) / max(1, n - 1) / n) if n > 1 else math.inf
    ci_lo = mean_gain - 1.96 * se if math.isfinite(se) else None
    ci_hi = mean_gain + 1.96 * se if math.isfinite(se) else None

    # Gate verdict: gain > 0 AND gain > 2*SE
    admitted = mean_gain > 0 and mean_gain > 2 * se if math.isfinite(se) else False

    return {
        "sample": n,
        "baselineLoss": round(sum(baseline_losses) / n, 6),
        "candidateLoss": round(sum(candidate_losses) / n, 6),
        "meanGain": round(mean_gain, 6),
        "se": round(se, 6) if math.isfinite(se) else -1,
        "ci95": [round(ci_lo, 6), round(ci_hi, 6)] if ci_lo is not None else None,
        "admitted": admitted,
        "status": "admitted" if admitted else ("excluded" if n >= 100 else "insufficient-data"),
    }


def run_evidence_report(core=None) -> dict:
    """Run the full P8 evidence report.

    Tests every registered candidate engine (and the core mixture components)
    on both iid and drift synthetic tapes.  Returns a structured report.

    If `core` is provided, uses its registered candidates; otherwise creates a
    temporary Core with seeded data to register the candidates.
    """
    # Get candidate engines
    candidates = []
    if core is not None:
        reg = core.gated_registry()
        for e in reg["extras"]:
            candidates.append({"key": e["key"], "label": e["label"], "predict": e["predict"]})
    else:
        # Create a temporary Core with seeded data to register candidates
        import tempfile, os
        from momento.storage import Database
        from app.core import Core
        os.environ.setdefault("MOMENTO_CANDIDATES", "1")
        db = Database(tempfile.mktemp(suffix=".db"))
        core = Core(db, calibrate_on_boot=False)
        # Seed enough rounds for all providers to activate
        from momento.evidence import generate_iid_tape
        tape = generate_iid_tape(400)
        rows = [{"ts_ms": 1000 + i * 500, "multiplier": m} for i, m in enumerate(tape)]
        core.ingest_rounds("evidence", "api", rows, "observed")
        reg = core.gated_registry()
        for e in reg["extras"]:
            candidates.append({"key": e["key"], "label": e["label"], "predict": e["predict"]})

    tapes = {
        "iid": generate_iid_tape(),
        "drift": generate_drift_tape(),
    }

    results = {}
    for tape_name, tape in tapes.items():
        results[tape_name] = []
        for cand in candidates:
            bt = walk_forward_backtest(tape, cand["predict"])
            results[tape_name].append({
                "key": cand["key"],
                "label": cand["label"],
                **bt,
            })

    # Also test the baseline (empirical) as a reference
    for tape_name in tapes:
        results[tape_name].insert(0, {
            "key": "baseline",
            "label": "Empirical baseline",
            "sample": len(tapes[tape_name]) // 20,
            "baselineLoss": 0,
            "candidateLoss": 0,
            "meanGain": 0,
            "se": 0,
            "ci95": [0, 0],
            "admitted": True,
            "status": "always",
        })

    return {
        "version": "evidence-v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "tapes": {
            "iid": {"rounds": len(tapes["iid"]), "description": "IID geometric, fixed distribution"},
            "drift": {"rounds": len(tapes["drift"]), "description": "Distribution shift at midpoint"},
        },
        "results": results,
        "summary": _summarize(results),
    }


def _summarize(results: dict) -> dict:
    """One-line summary per candidate per tape."""
    out = {}
    for tape_name, entries in results.items():
        out[tape_name] = []
        for e in entries:
            if e["key"] == "baseline":
                continue
            gain = e.get("meanGain", 0) or 0
            se = e.get("se", 0) or 0
            status = e.get("status", "unknown")
            out[tape_name].append({
                "key": e["key"],
                "label": e["label"],
                "sample": e.get("sample", 0),
                "meanGain": gain,
                "se": se,
                "admitted": e.get("admitted", False),
                "status": status,
            })
    return out


def format_report_text(report: dict) -> str:
    """Format the evidence report as a Markdown table for docs."""
    lines = []
    lines.append("# P8 Evidence Report — Walk-Forward Backtests\n")
    lines.append(f"Generated: {report['generated_at']}\n")
    lines.append(f"Version: {report['version']}\n")

    for tape_name in ("iid", "drift"):
        tape = report["tapes"][tape_name]
        entries = report["results"][tape_name]
        lines.append(f"\n## {tape_name.upper()} tape ({tape['rounds']} rounds)\n")
        lines.append(f"*{tape['description']}*\n")
        lines.append("| Engine | Sample | Baseline LL | Candidate LL | Mean Gain | SE | 95% CI | Verdict |")
        lines.append("|---|---|---|---|---|---|---|---|")
        for e in entries:
            ci = e.get("ci95")
            ci_str = f"[{ci[0]:.4f}, {ci[1]:.4f}]" if ci else "—"
            gain = e.get("meanGain")
            gain_str = f"{gain:+.4f}" if gain is not None else "—"
            se = e.get("se")
            se_str = f"{se:.4f}" if se is not None and se >= 0 else "—"
            bl = e.get("baselineLoss")
            cl = e.get("candidateLoss")
            bl_str = f"{bl:.4f}" if bl is not None else "—"
            cl_str = f"{cl:.4f}" if cl is not None else "—"
            status = e.get("status", "unknown")
            icon = "✓ admitted" if e.get("admitted") else ("— excluded" if status == "excluded" else "? insufficient")
            lines.append(f"| {e['label']} | {e.get('sample', 0)} | {bl_str} | {cl_str} | {gain_str} | {se_str} | {ci_str} | {icon} |")

    lines.append("\n## Interpretation\n")
    lines.append("On the **iid tape**, no engine should demonstrate real skill — the distribution")
    lines.append("is memoryless, so past rounds carry no information about the next.  Any engine")
    lines.append("that shows a positive gain here is likely overfitting; the blend gate's 2-SE")
    lines.append("threshold controls the false-positive rate.\n")
    lines.append("On the **drift tape**, the distribution shifts at the midpoint.  Engines that")
    lines.append("adapt to recent history (rolling percentile, Chart Lab analogues) may show")
    lines.append("genuine skill in the second half.  The gate still requires > 2 SE to admit.\n")
    lines.append('"Not admitted" is a valid, expected result for most candidates.')

    return "\n".join(lines)
