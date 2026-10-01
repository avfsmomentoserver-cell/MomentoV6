"""
Time Series Analysis Module

Provides multi-scale time series analysis with momentum indicators,
volatility measurement, and trend detection for crash game data.
"""

from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from collections import deque
from datetime import datetime
import statistics
import numpy as np
from scipy import stats


@dataclass
class WindowAnalysis:
    """Analysis results for a specific time window."""

    window_name: str
    window_size: int
    timestamp: datetime

    # Statistics
    mean: float
    std: float
    min: float
    max: float
    median: float

    # Trend
    trend_direction: str  # "up", "down", "sideways"
    trend_strength: float  # 0.0 to 1.0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "window_name": self.window_name,
            "window_size": self.window_size,
            "timestamp": self.timestamp.isoformat(),
            "mean": self.mean,
            "std": self.std,
            "min": self.min,
            "max": self.max,
            "median": self.median,
            "trend_direction": self.trend_direction,
            "trend_strength": self.trend_strength,
        }


@dataclass
class MomentumIndicator:
    """Momentum indicator for a specific period."""

    period_name: str
    period: int
    timestamp: datetime

    # Momentum values
    momentum: float
    rate_of_change: float
    acceleration: float

    # Signal
    signal: str  # "bullish", "bearish", "neutral"
    strength: float  # 0.0 to 1.0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "period_name": self.period_name,
            "period": self.period,
            "timestamp": self.timestamp.isoformat(),
            "momentum": self.momentum,
            "rate_of_change": self.rate_of_change,
            "acceleration": self.acceleration,
            "signal": self.signal,
            "strength": self.strength,
        }


@dataclass
class VolatilityMeasurement:
    """Volatility measurement for a specific window."""

    window_name: str
    window_size: int
    timestamp: datetime

    # Volatility metrics
    volatility: float
    historical_volatility: float
    volatility_ratio: float

    # Classification
    regime: str  # "low", "normal", "high", "extreme"

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "window_name": self.window_name,
            "window_size": self.window_size,
            "timestamp": self.timestamp.isoformat(),
            "volatility": self.volatility,
            "historical_volatility": self.historical_volatility,
            "volatility_ratio": self.volatility_ratio,
            "regime": self.regime,
        }


@dataclass
class TrendAnalysis:
    """Comprehensive trend analysis with combined score."""

    timestamp: datetime

    # Combined multiplier score
    combined_score: float
    score_direction: (
        str  # "strong_up", "moderate_up", "sideways", "moderate_down", "strong_down"
    )

    # Regression metrics
    slope: float
    r_squared: float
    stability: float

    # Trend components
    direction: float  # -1, 0, or 1
    strength: float  # 0.0 to 1.0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "timestamp": self.timestamp.isoformat(),
            "combined_score": self.combined_score,
            "score_direction": self.score_direction,
            "slope": self.slope,
            "r_squared": self.r_squared,
            "stability": self.stability,
            "direction": self.direction,
            "strength": self.strength,
        }


class TimeSeriesAnalyzer:
    """
    Multi-scale time series analyzer for crash game data.

    Features:
    - Multiple window sizes (micro, short, medium, long, session)
    - Momentum indicators (immediate, short, medium, long)
    - Volatility measurement (multi-scale)
    - Combined multiplier score with log-transformed regression
    """

    def __init__(self):
        """Initialize time series analyzer."""
        # Window configurations
        self.windows = {
            "micro": {"size": 10, "frequency": 1},
            "short": {"size": 20, "frequency": 1},
            "medium": {"size": 50, "frequency": 5},
            "long": {"size": 100, "frequency": 10},
            "session": {"size": 500, "frequency": 50},
        }

        # Momentum periods
        self.momentum_periods = {
            "immediate": {"period": 3, "frequency": 1},
            "short": {"period": 5, "frequency": 1},
            "medium": {"period": 10, "frequency": 3},
            "long": {"period": 20, "frequency": 5},
        }

        # Volatility windows
        self.volatility_windows = {
            "immediate": {"size": 5, "frequency": 1},
            "short": {"size": 10, "frequency": 1},
            "medium": {"size": 20, "frequency": 3},
            "long": {"size": 50, "frequency": 5},
        }

        # Data storage
        self.multiplier_history: deque = deque(maxlen=1000)
        self.timestamp_history: deque = deque(maxlen=1000)

        # Analysis results
        self.window_analyses: Dict[str, List[WindowAnalysis]] = {
            name: [] for name in self.windows
        }
        self.momentum_indicators: Dict[str, List[MomentumIndicator]] = {
            name: [] for name in self.momentum_periods
        }
        self.volatility_measurements: Dict[str, List[VolatilityMeasurement]] = {
            name: [] for name in self.volatility_windows
        }
        self.trend_analyses: List[TrendAnalysis] = []

        # Update counters
        self.round_count = 0

    def analyze_round(self, multiplier: float, timestamp: datetime) -> Dict[str, Any]:
        """
        Analyze a round with time series analysis.

        Args:
            multiplier: Round multiplier value
            timestamp: Round timestamp

        Returns:
            Comprehensive time series analysis results
        """
        # Add to history
        self.multiplier_history.append(multiplier)
        self.timestamp_history.append(timestamp)
        self.round_count += 1

        # Perform analyses based on frequency
        window_results = {}
        momentum_results = {}
        volatility_results = {}

        # Window analysis
        for window_name, config in self.windows.items():
            if self.round_count % config["frequency"] == 0:
                analysis = self._analyze_window(window_name, config["size"], timestamp)
                if analysis:
                    self.window_analyses[window_name].append(analysis)
                    window_results[window_name] = analysis.to_dict()

        # Momentum analysis
        for period_name, config in self.momentum_periods.items():
            if self.round_count % config["frequency"] == 0:
                indicator = self._calculate_momentum(
                    period_name, config["period"], timestamp
                )
                if indicator:
                    self.momentum_indicators[period_name].append(indicator)
                    momentum_results[period_name] = indicator.to_dict()

        # Volatility analysis
        for window_name, config in self.volatility_windows.items():
            if self.round_count % config["frequency"] == 0:
                measurement = self._calculate_volatility(
                    window_name, config["size"], timestamp
                )
                if measurement:
                    self.volatility_measurements[window_name].append(measurement)
                    volatility_results[window_name] = measurement.to_dict()

        # Trend analysis (every round)
        trend_analysis = self._analyze_trend(timestamp)
        if trend_analysis:
            self.trend_analyses.append(trend_analysis)

        return {
            "window_analysis": window_results,
            "momentum_analysis": momentum_results,
            "volatility_analysis": volatility_results,
            "trend_analysis": trend_analysis.to_dict() if trend_analysis else None,
            "round_count": self.round_count,
        }

    def _analyze_window(
        self, window_name: str, window_size: int, timestamp: datetime
    ) -> Optional[WindowAnalysis]:
        """Analyze a specific time window."""
        if len(self.multiplier_history) < window_size:
            return None

        window = list(self.multiplier_history)[-window_size:]

        # Calculate statistics
        mean = statistics.mean(window)
        std = statistics.stdev(window) if len(window) > 1 else 0.0
        min_val = min(window)
        max_val = max(window)
        median = statistics.median(window)

        # Calculate trend
        x = list(range(len(window)))
        y = window

        try:
            slope, _, r_value, _, _ = stats.linregress(x, y)
            r_squared = r_value**2

            if slope > 0.01:
                trend_direction = "up"
            elif slope < -0.01:
                trend_direction = "down"
            else:
                trend_direction = "sideways"

            trend_strength = min(1.0, abs(slope) * 10)
        except:
            trend_direction = "sideways"
            trend_strength = 0.0

        return WindowAnalysis(
            window_name=window_name,
            window_size=window_size,
            timestamp=timestamp,
            mean=mean,
            std=std,
            min=min_val,
            max=max_val,
            median=median,
            trend_direction=trend_direction,
            trend_strength=trend_strength,
        )

    def _calculate_momentum(
        self, period_name: str, period: int, timestamp: datetime
    ) -> Optional[MomentumIndicator]:
        """Calculate momentum indicator for a specific period."""
        if len(self.multiplier_history) < period + 1:
            return None

        recent = list(self.multiplier_history)[-period - 1 :]

        # Calculate momentum (current - previous)
        momentum = recent[-1] - recent[0]

        # Calculate rate of change
        rate_of_change = momentum / recent[0] if recent[0] > 0 else 0.0

        # Calculate acceleration (change in momentum)
        if len(recent) >= period + 2:
            prev_momentum = recent[-2] - recent[-period - 2]
            acceleration = momentum - prev_momentum
        else:
            acceleration = 0.0

        # Determine signal
        if momentum > 0.5:
            signal = "bullish"
            strength = min(1.0, momentum / 5.0)
        elif momentum < -0.5:
            signal = "bearish"
            strength = min(1.0, abs(momentum) / 5.0)
        else:
            signal = "neutral"
            strength = 0.0

        return MomentumIndicator(
            period_name=period_name,
            period=period,
            timestamp=timestamp,
            momentum=momentum,
            rate_of_change=rate_of_change,
            acceleration=acceleration,
            signal=signal,
            strength=strength,
        )

    def _calculate_volatility(
        self, window_name: str, window_size: int, timestamp: datetime
    ) -> Optional[VolatilityMeasurement]:
        """Calculate volatility measurement for a specific window."""
        if len(self.multiplier_history) < window_size:
            return None

        window = list(self.multiplier_history)[-window_size:]

        # Calculate current volatility
        if len(window) > 1:
            volatility = statistics.stdev(window)
        else:
            volatility = 0.0

        # Calculate historical volatility (longer window)
        if len(self.multiplier_history) >= window_size * 2:
            historical_window = list(self.multiplier_history)[
                -window_size * 2 : -window_size
            ]
            if len(historical_window) > 1:
                historical_volatility = statistics.stdev(historical_window)
            else:
                historical_volatility = 0.0
        else:
            historical_volatility = volatility

        # Calculate volatility ratio
        volatility_ratio = (
            volatility / historical_volatility if historical_volatility > 0 else 1.0
        )

        # Classify regime
        if volatility_ratio < 0.5:
            regime = "low"
        elif volatility_ratio < 1.5:
            regime = "normal"
        elif volatility_ratio < 2.5:
            regime = "high"
        else:
            regime = "extreme"

        return VolatilityMeasurement(
            window_name=window_name,
            window_size=window_size,
            timestamp=timestamp,
            volatility=volatility,
            historical_volatility=historical_volatility,
            volatility_ratio=volatility_ratio,
            regime=regime,
        )

    def _analyze_trend(self, timestamp: datetime) -> Optional[TrendAnalysis]:
        """Analyze trend with combined multiplier score."""
        if len(self.multiplier_history) < 10:
            return None

        window = list(self.multiplier_history)[
            -min(50, len(self.multiplier_history)) :
        ]  # Use available rounds
        x = list(range(len(window)))

        # Log-transform multipliers to handle exponential distribution
        log_multipliers = np.log(np.array(window))

        try:
            # Linear regression on log-transformed data
            slope, intercept, r_value, p_value, std_err = stats.linregress(
                x, log_multipliers
            )
            r_squared = r_value**2

            # Calculate stability (inverse of volatility)
            if len(window) > 1:
                volatility = statistics.stdev(log_multipliers)
                stability = 1.0 / (1.0 + volatility)
            else:
                stability = 1.0

            # Calculate direction
            if slope > 0.001:
                direction = 1
            elif slope < -0.001:
                direction = -1
            else:
                direction = 0

            # Calculate strength
            strength = r_squared

            # Combined score: direction * strength * stability * 100
            combined_score = direction * strength * stability * 100

            # Score direction classification
            if combined_score >= 50:
                score_direction = "strong_up"
            elif combined_score >= 20:
                score_direction = "moderate_up"
            elif combined_score <= -50:
                score_direction = "strong_down"
            elif combined_score <= -20:
                score_direction = "moderate_down"
            else:
                score_direction = "sideways"

            return TrendAnalysis(
                timestamp=timestamp,
                combined_score=combined_score,
                score_direction=score_direction,
                slope=slope,
                r_squared=r_squared,
                stability=stability,
                direction=direction,
                strength=strength,
            )
        except:
            return None

    def get_summary(self) -> Dict[str, Any]:
        """Get summary of time series analysis."""
        return {
            "round_count": self.round_count,
            "window_analyses_count": {
                name: len(analyses) for name, analyses in self.window_analyses.items()
            },
            "momentum_indicators_count": {
                name: len(indicators)
                for name, indicators in self.momentum_indicators.items()
            },
            "volatility_measurements_count": {
                name: len(measurements)
                for name, measurements in self.volatility_measurements.items()
            },
            "trend_analyses_count": len(self.trend_analyses),
            "latest_trend": (
                self.trend_analyses[-1].to_dict() if self.trend_analyses else None
            ),
        }
