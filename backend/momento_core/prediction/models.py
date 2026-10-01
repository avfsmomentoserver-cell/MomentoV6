"""
Crash Prediction Models

Data models for crash game prediction system.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Any
from enum import Enum


class PredictionStrategy(Enum):
    """Prediction strategy types."""
    MOMENTUM = "momentum"
    REVERSION = "reversion"
    PATTERN_RECOGNITION = "pattern_recognition"
    LINGUISTIC = "linguistic"
    HYBRID = "hybrid"


class CrashSeverity(Enum):
    """Crash severity classification."""
    TINY = "tiny"  # 1.0x - 1.5x
    LOW = "low"    # 1.5x - 2.0x
    MODERATE = "moderate"  # 2.0x - 5.0x
    HIGH = "high"  # 5.0x - 10.0x
    EXTREME = "extreme"  # 10.0x - 50.0x
    CRITICAL = "critical"  # 50.0x+


@dataclass
class CrashRound:
    """Represents a single crash game round."""
    
    round_id: str
    timestamp: datetime
    crash_point: float
    duration_seconds: float
    multiplier_sequence: List[float] = field(default_factory=list)
    color_sequence: List[str] = field(default_factory=list)
    
    # Linguistic analysis results
    linguistic_classification: Optional[Dict[str, Any]] = None
    reverse_linguistic_analysis: Optional[Dict[str, Any]] = None
    
    # Prediction data
    predicted_crash_point: Optional[float] = None
    prediction_confidence: Optional[float] = None
    prediction_strategy: Optional[PredictionStrategy] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "round_id": self.round_id,
            "timestamp": self.timestamp.isoformat(),
            "crash_point": self.crash_point,
            "duration_seconds": self.duration_seconds,
            "multiplier_sequence": self.multiplier_sequence,
            "color_sequence": self.color_sequence,
            "linguistic_classification": self.linguistic_classification,
            "reverse_linguistic_analysis": self.reverse_linguistic_analysis,
            "predicted_crash_point": self.predicted_crash_point,
            "prediction_confidence": self.prediction_confidence,
            "prediction_strategy": getattr(self.prediction_strategy, "value", self.prediction_strategy) if self.prediction_strategy else None
        }


@dataclass
class PredictionResult:
    """Result of a crash prediction."""
    
    prediction_id: str
    round_id: str
    timestamp: datetime
    predicted_crash_point: float
    confidence_interval: tuple[float, float]  # (lower, upper)
    confidence_score: float  # 0.0 to 1.0
    strategy: PredictionStrategy
    
    # Feature contributions
    feature_importance: Dict[str, float] = field(default_factory=dict)
    
    # Signal data
    signals_generated: List[Dict[str, Any]] = field(default_factory=list)
    
    # Actual result (filled after round completes)
    actual_crash_point: Optional[float] = None
    prediction_error: Optional[float] = None
    
    def calculate_accuracy(self) -> Optional[float]:
        """Calculate prediction accuracy."""
        if self.actual_crash_point is None:
            return None
        
        error = abs(self.actual_crash_point - self.predicted_crash_point)
        relative_error = error / self.actual_crash_point
        return max(0.0, 1.0 - relative_error)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "prediction_id": self.prediction_id,
            "round_id": self.round_id,
            "timestamp": self.timestamp.isoformat(),
            "predicted_crash_point": self.predicted_crash_point,
            "confidence_interval": self.confidence_interval,
            "confidence_score": self.confidence_score,
            "strategy": self.strategy.value,
            "feature_importance": self.feature_importance,
            "signals_generated": self.signals_generated,
            "actual_crash_point": self.actual_crash_point,
            "prediction_error": self.prediction_error,
            "accuracy": self.calculate_accuracy()
        }


@dataclass
class CrashPredictionConfig:
    """Configuration for crash prediction engine."""
    
    # Strategy weights
    momentum_weight: float = 0.3
    reversion_weight: float = 0.25
    pattern_weight: float = 0.25
    linguistic_weight: float = 0.2
    
    # Time windows
    short_window: int = 10  # rounds
    medium_window: int = 50  # rounds
    long_window: int = 200  # rounds
    
    # Confidence thresholds
    min_confidence: float = 0.6
    high_confidence: float = 0.8
    
    # Pattern recognition
    enable_pattern_recognition: bool = True
    pattern_similarity_threshold: float = 0.85
    
    # Linguistics
    enable_linguistic_analysis: bool = True
    enable_reverse_linguistics: bool = True
    
    # Real-time processing
    enable_real_time: bool = True
    max_processing_delay_ms: int = 100
    
    # Graphics and audio
    enable_live_graphics: bool = True
    enable_rhythmic_analysis: bool = True
    graphics_fps: int = 30
    
    def validate(self) -> bool:
        """Validate configuration parameters."""
        total_weight = (
            self.momentum_weight + 
            self.reversion_weight + 
            self.pattern_weight + 
            self.linguistic_weight
        )
        
        if abs(total_weight - 1.0) > 0.01:
            return False
        
        if not (0.0 <= self.min_confidence <= 1.0):
            return False
        
        if not (0.0 <= self.high_confidence <= 1.0):
            return False
        
        if self.min_confidence >= self.high_confidence:
            return False
        
        return True