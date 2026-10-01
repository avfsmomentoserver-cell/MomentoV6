"""
Analysis Module

Round analysis and statistical decomposition for crash games.
"""

from momento_core.analysis.round_analyzer import RoundAnalyzer
from momento_core.analysis.momento_scaler import MomentoScaler, create_momento_scaler
from momento_core.analysis.band_exhaustion import BandExhaustionAnalyzer
from momento_core.analysis.streak_detection import StreakDetector
from momento_core.analysis.time_series import TimeSeriesAnalyzer

# Optional plotly integration
try:
    from momento_core.analysis.plotly_integration import (
        PlotlyVisualizer,
        create_visualizer,
    )

    PLOTLY_AVAILABLE = True
except ImportError:
    PLOTLY_AVAILABLE = False
    PlotlyVisualizer = None
    create_visualizer = None

__all__ = [
    "RoundAnalyzer",
    "MomentoScaler",
    "create_momento_scaler",
    "BandExhaustionAnalyzer",
    "StreakDetector",
    "TimeSeriesAnalyzer",
]

if PLOTLY_AVAILABLE:
    __all__.extend(["PlotlyVisualizer", "create_visualizer"])
