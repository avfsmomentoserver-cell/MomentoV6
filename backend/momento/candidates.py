"""P6 candidate-engine adapters — register momento_core experts as shadow
candidate engines behind the blend admission gate.

Each adapter wraps a momento_core expert and exposes the extra-engine shape
that ``Core.gated_registry()`` consumes:

    {"key": str, "label": str, "prior": float, "predict": callable(rounds) -> list}

``predict(rounds)`` must return a 6-element probability distribution over the
BAND_EDGES bands (<1.5x, 1.5–2x, 2–5x, 5–10x, 10–100x, 100x+), normalised so
the elements sum to 1.  If the expert cannot produce a prediction (too few
rounds, sklearn missing, etc.) it returns the empirical baseline distribution
so the gate sees a valid, if uninformative, candidate.

All experts start in ``shadow`` state; they only enter the live blend if the
blend admission gate admits them (> 2 SE log-loss gain over baseline).

Performance: each provider caches its predict output on the Core instance,
keyed by round count, so repeated ``gated_registry()`` calls do not recompute.
Providers only process the last ``WINDOW`` rounds (not the full tape).
"""

from __future__ import annotations

import math
import logging
from datetime import datetime, timezone
from typing import Any, Callable

from .analysis import BAND_EDGES, BAND_LABELS, band_index

log = logging.getLogger("momento.candidates")

NB = len(BAND_LABELS)
WINDOW = 300  # max rounds each provider processes — keeps predictions fast


def _empirical(multipliers: list[float]) -> list[float]:
    """Empirical band distribution with Dirichlet-style smoothing."""
    counts = [1] * NB
    for m in multipliers[-6000:]:
        counts[band_index(m)] += 1
    s = sum(counts)
    return [c / s for c in counts]


def _point_to_dist(point: float, multipliers: list[float], concentration: float = 8.0) -> list[float]:
    """Convert a point prediction into a band distribution.

    Concentrates probability on the band containing the predicted point,
    with geometric decay to neighbours and a small empirical floor so the
    distribution is never degenerate.
    """
    if not math.isfinite(point) or point <= 0:
        return _empirical(multipliers)
    base = _empirical(multipliers)
    idx = band_index(point)
    out = [0.0] * NB
    for i in range(NB):
        d = abs(i - idx)
        out[i] = math.exp(-concentration * d)
    s = sum(out)
    return [(0.7 * out[i] / s + 0.3 * base[i]) for i in range(NB)]


def _recent_ms(rounds) -> list[float]:
    """Last WINDOW multipliers, excluding reconstructed rounds."""
    return [r.multiplier for r in rounds if r.origin != "reconstructed"][-WINDOW:]


def _cached(core, key: str, fn: Callable) -> Any:
    """Cache fn() on the core instance, keyed by (key, round_count).

    Recomputes only when the round count changes by >= 20.
    """
    cache = getattr(core, "_candidate_cache", None)
    if cache is None:
        cache = {}
        core._candidate_cache = cache  # type: ignore[attr-defined]
    n = len(core.rounds_for(None))
    entry = cache.get(key)
    if entry and abs(n - entry[0]) < 20:
        return entry[1]
    val = fn()
    cache[key] = (n, val)
    return val


# ------------------------------------------------------------------ providers


def percentile_provider(core) -> list[dict]:
    """Rolling-percentile snapshot engine (momento_core.prediction.percentile_service)."""
    try:
        from momento_core.prediction.percentile_service import PercentileService
    except ImportError:
        return []

    rounds = core.rounds_for(None)
    if len(rounds) < 60:
        return []

    def predict(rds):
        ms = _recent_ms(rds)
        if len(ms) < 60:
            return _empirical(ms)
        svc = PercentileService(window_size=min(500, len(ms)), min_sample_size=50)
        for m in ms:
            svc.add_value(m, datetime.now(timezone.utc))
        snap = svc.get_current_percentiles()
        if snap is None:
            return _empirical(ms)
        return _point_to_dist(snap.p50, ms, concentration=6.0)

    return [{
        "key": "mc_percentile",
        "label": "Rolling percentile (momento_core)",
        "prior": 0.3,
        "predict": predict,
    }]


def crash_prediction_provider(core) -> list[dict]:
    """CrashPredictionEngine (momento_core.prediction.engine).

    Feeds the last WINDOW rounds through the engine's process_round pipeline
    and uses the last prediction's predicted_crash_point to build a band
    distribution.  Results are cached on the Core instance.
    """
    try:
        from momento_core.prediction.engine import CrashPredictionEngine
        from momento_core.prediction.models import CrashPredictionConfig
    except ImportError:
        return []

    rounds = core.rounds_for(None)
    if len(rounds) < 80:
        return []

    def _compute():
        import io, contextlib
        ms = _recent_ms(core.rounds_for(None))
        if len(ms) < 80:
            return None
        eng = CrashPredictionEngine(CrashPredictionConfig())
        last_point = None
        with contextlib.redirect_stderr(io.StringIO()):
            for i, m in enumerate(ms):
                rd = {"round_id": str(i), "crash_point": m, "multiplier": m, "timestamp": datetime.now(timezone.utc).isoformat()}
                cr = eng.process_round(rd)
                if cr.predicted_crash_point:
                    last_point = cr.predicted_crash_point
        return last_point

    def predict(rds):
        ms = _recent_ms(rds)
        if len(ms) < 80:
            return _empirical(ms)
        point = _cached(core, "mc_crash", _compute)
        if point is None or not math.isfinite(point):
            return _empirical(ms)
        return _point_to_dist(point, ms, concentration=5.0)

    return [{
        "key": "mc_crash",
        "label": "Crash prediction engine (momento_core)",
        "prior": 0.25,
        "predict": predict,
    }]


def ml_provider(core) -> list[dict]:
    """MLPredictionEngine (momento_core.prediction.ml_engine) — lazy, optional.

    Only registered if sklearn is importable.  Trains once on the current tape
    and caches the model; retrain only when the tape grows by 50+ rounds.
    """
    try:
        from momento_core.prediction.ml_engine import MLPredictionEngine
    except ImportError:
        return []
    try:
        import sklearn  # noqa: F401
    except ImportError:
        return []

    rounds = core.rounds_for(None)
    if len(rounds) < 200:
        return []

    def _compute():
        import io, contextlib
        ms = _recent_ms(core.rounds_for(None))
        if len(ms) < 200:
            return None
        eng = MLPredictionEngine(model_type="random_forest", mode="regression")
        rd_dicts = [{"round_id": str(i), "crash_point": m, "multiplier": m, "timestamp": datetime.now(timezone.utc).isoformat()} for i, m in enumerate(ms)]
        with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
            eng.train(rd_dicts)
        return eng

    def predict(rds):
        ms = _recent_ms(rds)
        if len(ms) < 200:
            return _empirical(ms)
        try:
            model = _cached(core, "mc_ml", _compute)
            if model is None:
                return _empirical(ms)
            rd_dicts = [{"round_id": str(i), "crash_point": m, "multiplier": m, "timestamp": datetime.now(timezone.utc).isoformat()} for i, m in enumerate(ms)]
            point = model.predict(rd_dicts[-50:])
            if point is None or not math.isfinite(point) or point <= 0:
                return _empirical(ms)
            return _point_to_dist(point, ms, concentration=4.0)
        except Exception:
            return _empirical(ms)

    return [{
        "key": "mc_ml",
        "label": "ML next-round (momento_core, sklearn)",
        "prior": 0.2,
        "predict": predict,
    }]


def signal_hunter_provider(core) -> list[dict]:
    """SignalHunterPro (momento_core.signals.hunter_pro).

    Uses the signal distribution from the hunter's recent signals to shift
    the empirical baseline toward bands implied by active signal types.
    """
    try:
        from momento_core.signals.hunter_pro import SignalHunterPro
        from momento_core.signals.models import SignalConfiguration
        from momento_core.prediction.models import CrashRound
    except ImportError:
        return []

    rounds = core.rounds_for(None)
    if len(rounds) < 80:
        return []

    def _compute():
        ms = _recent_ms(core.rounds_for(None))
        if len(ms) < 80:
            return {}
        hunter = SignalHunterPro(SignalConfiguration())
        signal_counts: dict[str, int] = {}
        for i, m in enumerate(ms):
            cr = CrashRound(
                round_id=str(i),
                crash_point=m,
                timestamp=datetime.now(timezone.utc),
                duration_seconds=0.0,
            )
            signals = hunter.analyze_round(cr)
            for sig in signals:
                sig_type = sig.signal_type.value if hasattr(sig.signal_type, "value") else str(sig.signal_type)
                signal_counts[sig_type] = signal_counts.get(sig_type, 0) + 1
        return signal_counts

    def predict(rds):
        ms = _recent_ms(rds)
        if len(ms) < 80:
            return _empirical(ms)
        signal_counts = _cached(core, "mc_signals", _compute)
        base = _empirical(ms)
        if not signal_counts:
            return base

        high_shift = signal_counts.get("ignition", 0) + signal_counts.get("moonshot", 0)
        low_shift = signal_counts.get("collapse", 0) + signal_counts.get("bait", 0)
        total = sum(signal_counts.values()) or 1
        high_w = min(0.3, high_shift / total * 0.4)
        low_w = min(0.3, low_shift / total * 0.4)

        out = list(base)
        if high_w > 0:
            shift = out[0] * high_w + out[1] * high_w * 0.5
            out[0] -= shift
            out[1] -= shift * 0.5
            out[3] += shift * 0.3
            out[4] += shift * 0.4
            out[5] += shift * 0.3
        if low_w > 0:
            shift = (out[3] + out[4] + out[5]) * low_w
            out[3] -= shift * 0.4
            out[4] -= shift * 0.3
            out[5] -= shift * 0.3
            out[0] += shift * 0.6
            out[1] += shift * 0.4

        s = sum(out)
        return [c / s for c in out] if s > 0 else base

    return [{
        "key": "mc_signals",
        "label": "Signal hunter (momento_core)",
        "prior": 0.2,
        "predict": predict,
    }]


def band_exhaustion_provider(core) -> list[dict]:
    """BandExhaustionAnalyzer (momento_core.analysis.band_exhaustion)."""
    try:
        from momento_core.analysis.band_exhaustion import BandExhaustionAnalyzer
    except ImportError:
        return []

    rounds = core.rounds_for(None)
    if len(rounds) < 100:
        return []

    def _compute():
        ms = _recent_ms(core.rounds_for(None))
        if len(ms) < 100:
            return None
        analyzer = BandExhaustionAnalyzer(window_size=min(500, len(ms)))
        last_event = None
        for m in ms:
            result = analyzer.analyze_round(m, datetime.now(timezone.utc))
            if result.get("exhaustion_detected") or result.get("normalization_detected"):
                last_event = result
        return last_event

    def predict(rds):
        ms = _recent_ms(rds)
        if len(ms) < 100:
            return _empirical(ms)
        last_event = _cached(core, "mc_band_exhaust", _compute)
        base = _empirical(ms)
        if last_event is None:
            return base

        if last_event.get("exhaustion_detected"):
            band = last_event.get("exhausted_band", "")
            if "10" in str(band) or "100" in str(band):
                shift = base[4] * 0.3 + base[5] * 0.3
                base[4] -= shift * 0.5
                base[5] -= shift * 0.5
                base[0] += shift * 0.4
                base[1] += shift * 0.3
                base[2] += shift * 0.3
        elif last_event.get("normalization_detected"):
            shift = (base[0] + base[5]) * 0.15
            base[0] -= shift * 0.5
            base[5] -= shift * 0.5
            base[2] += shift * 0.4
            base[3] += shift * 0.4

        s = sum(base)
        return [c / s for c in base] if s > 0 else _empirical(ms)

    return [{
        "key": "mc_band_exhaust",
        "label": "Band exhaustion (momento_core)",
        "prior": 0.2,
        "predict": predict,
    }]


def collapse_ceiling_provider(core) -> list[dict]:
    """CollapseCeilingAnalyzer (momento_core.plugins.collapse_ceiling)."""
    try:
        from momento_core.plugins.collapse_ceiling import CollapseCeilingAnalyzer
    except ImportError:
        return []

    rounds = core.rounds_for(None)
    if len(rounds) < 80:
        return []

    def _compute():
        ms = _recent_ms(core.rounds_for(None))
        if len(ms) < 80:
            return None
        analyzer = CollapseCeilingAnalyzer(window_size=min(50, len(ms)), ceiling_threshold=0.8)
        last_dir = None
        for i, m in enumerate(ms):
            rd = {"round_id": str(i), "crash_point": m, "multiplier": m, "timestamp": datetime.now(timezone.utc).isoformat()}
            analysis = analyzer.analyze_round(rd)
            last_dir = analysis.ceiling_direction.value if hasattr(analysis.ceiling_direction, "value") else str(analysis.ceiling_direction)
        return last_dir

    def predict(rds):
        ms = _recent_ms(rds)
        if len(ms) < 80:
            return _empirical(ms)
        last_dir = _cached(core, "mc_ceiling", _compute)
        base = _empirical(ms)
        if last_dir == "ascending":
            shift = base[0] * 0.2 + base[1] * 0.15
            base[0] -= shift * 0.6
            base[1] -= shift * 0.4
            base[3] += shift * 0.3
            base[4] += shift * 0.4
            base[5] += shift * 0.3
        elif last_dir == "descending":
            shift = (base[3] + base[4] + base[5]) * 0.15
            base[3] -= shift * 0.4
            base[4] -= shift * 0.3
            base[5] -= shift * 0.3
            base[0] += shift * 0.5
            base[1] += shift * 0.3
            base[2] += shift * 0.2

        s = sum(base)
        return [c / s for c in base] if s > 0 else _empirical(ms)

    return [{
        "key": "mc_ceiling",
        "label": "Collapse ceiling (momento_core)",
        "prior": 0.2,
        "predict": predict,
    }]


def gap_swing_provider(core) -> list[dict]:
    """GapSwingAnalyzer (momento_core.plugins.gap_swing)."""
    try:
        from momento_core.plugins.gap_swing import GapSwingAnalyzer
    except ImportError:
        return []

    rounds = core.rounds_for(None)
    if len(rounds) < 80:
        return []

    def _compute():
        ms = _recent_ms(core.rounds_for(None))
        if len(ms) < 80:
            return None
        analyzer = GapSwingAnalyzer()
        last_dir = None
        for i, m in enumerate(ms):
            rd = {"round_id": str(i), "crash_point": m, "multiplier": m, "timestamp": datetime.now(timezone.utc).isoformat()}
            analysis = analyzer.analyze_round(rd)
            last_dir = analysis.swing_direction.value if hasattr(analysis.swing_direction, "value") else str(analysis.swing_direction)
        return last_dir

    def predict(rds):
        ms = _recent_ms(rds)
        if len(ms) < 80:
            return _empirical(ms)
        last_dir = _cached(core, "mc_gap_swing", _compute)
        base = _empirical(ms)
        if last_dir == "upward":
            shift = base[0] * 0.15 + base[1] * 0.1
            base[0] -= shift * 0.6
            base[1] -= shift * 0.4
            base[3] += shift * 0.3
            base[4] += shift * 0.4
            base[5] += shift * 0.3
        elif last_dir == "downward":
            shift = (base[3] + base[4] + base[5]) * 0.12
            base[3] -= shift * 0.4
            base[4] -= shift * 0.3
            base[5] -= shift * 0.3
            base[0] += shift * 0.5
            base[1] += shift * 0.3
            base[2] += shift * 0.2

        s = sum(base)
        return [c / s for c in base] if s > 0 else _empirical(ms)

    return [{
        "key": "mc_gap_swing",
        "label": "Gap swing (momento_core)",
        "prior": 0.2,
        "predict": predict,
    }]


# ------------------------------------------------------------------ registry

ALL_PROVIDERS: list[Callable] = [
    percentile_provider,
    crash_prediction_provider,
    ml_provider,
    signal_hunter_provider,
    band_exhaustion_provider,
    collapse_ceiling_provider,
    gap_swing_provider,
]


def register_candidates(core) -> None:
    """Register all momento_core expert candidate providers on a Core instance.

    Skipped if the ``momento_core_candidates`` setting is "0" or if
    ``MOMENTO_CANDIDATES`` env var is "0".
    """
    import os
    if os.environ.get("MOMENTO_CANDIDATES", "1") == "0":
        log.info("momento_core candidates disabled by MOMENTO_CANDIDATES=0")
        return
    if core.setting("momento_core_candidates") == "0":
        log.info("momento_core candidates disabled by setting")
        return
    for provider in ALL_PROVIDERS:
        core.extra_candidates.append(provider)
    log.info("registered %d momento_core candidate providers", len(ALL_PROVIDERS))
