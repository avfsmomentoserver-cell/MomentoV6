"""P6 candidate-engine adapters — register momento_core experts as shadow
candidate engines behind the blend admission gate.

Each adapter wraps a momento_core expert and exposes the extra-engine shape
that ``Core.gated_registry()`` consumes:

    {"key": str, "label": str, "prior": float, "predict": callable(rounds) -> list}

``predict(rounds)`` must return a 6-element probability distribution over the
BAND_EDGES bands (<1.5x, 1.5–2x, 2–5x, 5–10x, 10–100x, 100x+), normalised so
the elements sum to 1.  If the expert cannot produce a prediction (too few
rounds, sklearn missing, etc.) it returns the empirical baseline distribution.

**Purity contract:** ``predict(rds)`` computes ONLY from ``rds`` — the rounds
window passed in.  It never calls ``core.rounds_for(None)`` or peeks at the
full tape, so walk-forward calibration and P8 evidence backtests see only the
data available at that point in time (no future leakage).

All experts start in ``shadow`` state; they only enter the live blend if the
blend admission gate admits them (> 2 SE log-loss gain over baseline).
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
    counts = [1] * NB
    for m in multipliers[-6000:]:
        counts[band_index(m)] += 1
    s = sum(counts)
    return [c / s for c in counts]


def _point_to_dist(point: float, multipliers: list[float], concentration: float = 8.0) -> list[float]:
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
    return [r.multiplier for r in rounds if r.origin != "reconstructed"][-WINDOW:]


# Per-provider cache keyed by a fingerprint of the passed rds window —
# NOT by core.rounds_for(None).  Maintains purity while avoiding redundant
# computation.  The fingerprint includes round count, first/last multiplier,
# and a hash of the last 20 multipliers to distinguish different tapes.
_cache: dict[str, tuple[Any, Any]] = {}


def _fingerprint(rounds) -> tuple:
    ms = _recent_ms(rounds)
    n = len(ms)
    last = ms[-1] if ms else 0.0
    first = ms[0] if ms else 0.0
    tail = tuple(ms[-20:])  # last 20 multipliers as a tuple
    return (n, first, last, hash(tail))


def _cached(key: str, rounds, fn: Callable) -> Any:
    fp = _fingerprint(rounds)
    entry = _cache.get(key)
    if entry and entry[0] == fp:
        return entry[1]
    val = fn()
    _cache[key] = (fp, val)
    return val


def reset_cache() -> None:
    _cache.clear()


# ------------------------------------------------------------------ providers


def _percentile_predict(rds) -> list[float]:
    try:
        from momento_core.prediction.percentile_service import PercentileService
    except ImportError:
        return _empirical(_recent_ms(rds))
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


def percentile_provider(core) -> list[dict]:
    try:
        from momento_core.prediction.percentile_service import PercentileService  # noqa: F401
    except ImportError:
        return []
    if len(core.rounds_for(None)) < 60:
        return []
    def predict(rds):
        return _cached("mc_percentile", rds, lambda: _percentile_predict(rds))
    return [{"key": "mc_percentile", "label": "Rolling percentile (momento_core)", "prior": 0.3, "predict": predict}]


def _crash_predict(rds) -> list[float]:
    import io, contextlib
    try:
        from momento_core.prediction.engine import CrashPredictionEngine
        from momento_core.prediction.models import CrashPredictionConfig
    except ImportError:
        return _empirical(_recent_ms(rds))
    ms = _recent_ms(rds)
    if len(ms) < 80:
        return _empirical(ms)
    try:
        eng = CrashPredictionEngine(CrashPredictionConfig())
        last_point = None
        with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
            for i, m in enumerate(ms):
                rd = {"round_id": str(i), "crash_point": m, "multiplier": m, "timestamp": datetime.now(timezone.utc).isoformat()}
                cr = eng.process_round(rd)
                if cr.predicted_crash_point:
                    last_point = cr.predicted_crash_point
        if last_point is None or not math.isfinite(last_point):
            return _empirical(ms)
        return _point_to_dist(last_point, ms, concentration=5.0)
    except Exception:
        return _empirical(ms)


def crash_prediction_provider(core) -> list[dict]:
    try:
        from momento_core.prediction.engine import CrashPredictionEngine  # noqa: F401
        from momento_core.prediction.models import CrashPredictionConfig  # noqa: F401
    except ImportError:
        return []
    if len(core.rounds_for(None)) < 80:
        return []
    def predict(rds):
        return _cached("mc_crash", rds, lambda: _crash_predict(rds))
    return [{"key": "mc_crash", "label": "Crash prediction engine (momento_core)", "prior": 0.25, "predict": predict}]


def _ml_predict(rds) -> list[float]:
    import io, contextlib
    try:
        from momento_core.prediction.ml_engine import MLPredictionEngine
    except ImportError:
        return _empirical(_recent_ms(rds))
    ms = _recent_ms(rds)
    if len(ms) < 200:
        return _empirical(ms)
    try:
        eng = MLPredictionEngine(model_type="random_forest", mode="regression")
        rd_dicts = [{"round_id": str(i), "crash_point": m, "multiplier": m, "timestamp": datetime.now(timezone.utc).isoformat()} for i, m in enumerate(ms)]
        with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
            eng.train(rd_dicts)
        point = eng.predict(rd_dicts[-50:])
        if point is None or not math.isfinite(point) or point <= 0:
            return _empirical(ms)
        return _point_to_dist(point, ms, concentration=4.0)
    except Exception:
        return _empirical(ms)


def ml_provider(core) -> list[dict]:
    try:
        from momento_core.prediction.ml_engine import MLPredictionEngine  # noqa: F401
    except ImportError:
        return []
    try:
        import sklearn  # noqa: F401
    except ImportError:
        return []
    if len(core.rounds_for(None)) < 200:
        return []
    def predict(rds):
        return _cached("mc_ml", rds, lambda: _ml_predict(rds))
    return [{"key": "mc_ml", "label": "ML next-round (momento_core, sklearn)", "prior": 0.2, "predict": predict}]


def _signal_hunter_predict(rds) -> list[float]:
    try:
        from momento_core.signals.hunter_pro import SignalHunterPro
        from momento_core.signals.models import SignalConfiguration
        from momento_core.prediction.models import CrashRound
    except ImportError:
        return _empirical(_recent_ms(rds))
    ms = _recent_ms(rds)
    if len(ms) < 80:
        return _empirical(ms)
    try:
        hunter = SignalHunterPro(SignalConfiguration())
        signal_counts: dict[str, int] = {}
        for i, m in enumerate(ms):
            cr = CrashRound(round_id=str(i), crash_point=m, timestamp=datetime.now(timezone.utc), duration_seconds=0.0)
            signals = hunter.analyze_round(cr)
            for sig in signals:
                sig_type = sig.signal_type.value if hasattr(sig.signal_type, "value") else str(sig.signal_type)
                signal_counts[sig_type] = signal_counts.get(sig_type, 0) + 1
    except Exception:
        return _empirical(ms)
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
        out[0] -= shift; out[1] -= shift * 0.5
        out[3] += shift * 0.3; out[4] += shift * 0.4; out[5] += shift * 0.3
    if low_w > 0:
        shift = (out[3] + out[4] + out[5]) * low_w
        out[3] -= shift * 0.4; out[4] -= shift * 0.3; out[5] -= shift * 0.3
        out[0] += shift * 0.6; out[1] += shift * 0.4
    s = sum(out)
    return [c / s for c in out] if s > 0 else base


def signal_hunter_provider(core) -> list[dict]:
    try:
        from momento_core.signals.hunter_pro import SignalHunterPro  # noqa: F401
        from momento_core.signals.models import SignalConfiguration  # noqa: F401
        from momento_core.prediction.models import CrashRound  # noqa: F401
    except ImportError:
        return []
    if len(core.rounds_for(None)) < 80:
        return []
    def predict(rds):
        return _cached("mc_signals", rds, lambda: _signal_hunter_predict(rds))
    return [{"key": "mc_signals", "label": "Signal hunter (momento_core)", "prior": 0.2, "predict": predict}]


def _band_exhaustion_predict(rds) -> list[float]:
    try:
        from momento_core.analysis.band_exhaustion import BandExhaustionAnalyzer
    except ImportError:
        return _empirical(_recent_ms(rds))
    ms = _recent_ms(rds)
    if len(ms) < 100:
        return _empirical(ms)
    try:
        analyzer = BandExhaustionAnalyzer(window_size=min(500, len(ms)))
        last_event = None
        for m in ms:
            result = analyzer.analyze_round(m, datetime.now(timezone.utc))
            if result.get("exhaustion_detected") or result.get("normalization_detected"):
                last_event = result
    except Exception:
        return _empirical(ms)
    base = _empirical(ms)
    if last_event is None:
        return base
    if last_event.get("exhaustion_detected"):
        band = last_event.get("exhausted_band", "")
        if "10" in str(band) or "100" in str(band):
            shift = base[4] * 0.3 + base[5] * 0.3
            base[4] -= shift * 0.5; base[5] -= shift * 0.5
            base[0] += shift * 0.4; base[1] += shift * 0.3; base[2] += shift * 0.3
    elif last_event.get("normalization_detected"):
        shift = (base[0] + base[5]) * 0.15
        base[0] -= shift * 0.5; base[5] -= shift * 0.5
        base[2] += shift * 0.4; base[3] += shift * 0.4
    s = sum(base)
    return [c / s for c in base] if s > 0 else _empirical(ms)


def band_exhaustion_provider(core) -> list[dict]:
    try:
        from momento_core.analysis.band_exhaustion import BandExhaustionAnalyzer  # noqa: F401
    except ImportError:
        return []
    if len(core.rounds_for(None)) < 100:
        return []
    def predict(rds):
        return _cached("mc_band_exhaust", rds, lambda: _band_exhaustion_predict(rds))
    return [{"key": "mc_band_exhaust", "label": "Band exhaustion (momento_core)", "prior": 0.2, "predict": predict}]


def _collapse_ceiling_predict(rds) -> list[float]:
    try:
        from momento_core.plugins.collapse_ceiling import CollapseCeilingAnalyzer
    except ImportError:
        return _empirical(_recent_ms(rds))
    ms = _recent_ms(rds)
    if len(ms) < 80:
        return _empirical(ms)
    try:
        analyzer = CollapseCeilingAnalyzer(window_size=min(50, len(ms)), ceiling_threshold=0.8)
        last_dir = None
        for i, m in enumerate(ms):
            rd = {"round_id": str(i), "crash_point": m, "multiplier": m, "timestamp": datetime.now(timezone.utc).isoformat()}
            analysis = analyzer.analyze_round(rd)
            last_dir = analysis.ceiling_direction.value if hasattr(analysis.ceiling_direction, "value") else str(analysis.ceiling_direction)
    except Exception:
        return _empirical(ms)
    base = _empirical(ms)
    if last_dir == "ascending":
        shift = base[0] * 0.2 + base[1] * 0.15
        base[0] -= shift * 0.6; base[1] -= shift * 0.4
        base[3] += shift * 0.3; base[4] += shift * 0.4; base[5] += shift * 0.3
    elif last_dir == "descending":
        shift = (base[3] + base[4] + base[5]) * 0.15
        base[3] -= shift * 0.4; base[4] -= shift * 0.3; base[5] -= shift * 0.3
        base[0] += shift * 0.5; base[1] += shift * 0.3; base[2] += shift * 0.2
    s = sum(base)
    return [c / s for c in base] if s > 0 else _empirical(ms)


def collapse_ceiling_provider(core) -> list[dict]:
    try:
        from momento_core.plugins.collapse_ceiling import CollapseCeilingAnalyzer  # noqa: F401
    except ImportError:
        return []
    if len(core.rounds_for(None)) < 80:
        return []
    def predict(rds):
        return _cached("mc_ceiling", rds, lambda: _collapse_ceiling_predict(rds))
    return [{"key": "mc_ceiling", "label": "Collapse ceiling (momento_core)", "prior": 0.2, "predict": predict}]


def _gap_swing_predict(rds) -> list[float]:
    try:
        from momento_core.plugins.gap_swing import GapSwingAnalyzer
    except ImportError:
        return _empirical(_recent_ms(rds))
    ms = _recent_ms(rds)
    if len(ms) < 80:
        return _empirical(ms)
    try:
        analyzer = GapSwingAnalyzer()
        last_dir = None
        for i, m in enumerate(ms):
            rd = {"round_id": str(i), "crash_point": m, "multiplier": m, "timestamp": datetime.now(timezone.utc).isoformat()}
            analysis = analyzer.analyze_round(rd)
            last_dir = analysis.swing_direction.value if hasattr(analysis.swing_direction, "value") else str(analysis.swing_direction)
    except Exception:
        return _empirical(ms)
    base = _empirical(ms)
    if last_dir == "upward":
        shift = base[0] * 0.15 + base[1] * 0.1
        base[0] -= shift * 0.6; base[1] -= shift * 0.4
        base[3] += shift * 0.3; base[4] += shift * 0.4; base[5] += shift * 0.3
    elif last_dir == "downward":
        shift = (base[3] + base[4] + base[5]) * 0.12
        base[3] -= shift * 0.4; base[4] -= shift * 0.3; base[5] -= shift * 0.3
        base[0] += shift * 0.5; base[1] += shift * 0.3; base[2] += shift * 0.2
    s = sum(base)
    return [c / s for c in base] if s > 0 else _empirical(ms)


def gap_swing_provider(core) -> list[dict]:
    try:
        from momento_core.plugins.gap_swing import GapSwingAnalyzer  # noqa: F401
    except ImportError:
        return []
    if len(core.rounds_for(None)) < 80:
        return []
    def predict(rds):
        return _cached("mc_gap_swing", rds, lambda: _gap_swing_predict(rds))
    return [{"key": "mc_gap_swing", "label": "Gap swing (momento_core)", "prior": 0.2, "predict": predict}]


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
    """Register all momento_core expert candidate providers on a Core instance."""
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
