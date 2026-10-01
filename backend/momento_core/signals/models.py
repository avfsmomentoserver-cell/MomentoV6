"""
Signal Hunter Pro Models

Data models for advanced signal detection system.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Any
from enum import Enum


class SignalType(Enum):
    """Signal type classifications."""
    MOMENTUM = "momentum"
    REVERSION = "reversion"
    EXHAUSTION = "exhaustion"
    PATTERN = "pattern"
    LINGUISTIC = "linguistic"
    REVERSE_LINGUISTIC = "reverse_linguistic"
    CASCADE = "cascade"
    ANTI_CORRELATION = "anti_correlation"
    HYBRID = "hybrid"


class SignalSeverity(Enum):
    """Signal severity levels."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class SignalEvent:
    """Represents a detected signal event."""
    
    signal_id: str
    signal_type: SignalType
    signal_name: str
    timestamp: datetime
    round_id: str
    
    # Signal metrics
    strength: float  # 0.0 to 1.0
    confidence: float  # 0.0 to 1.0
    severity: SignalSeverity
    
    # Signal data
    signal_parameters: Dict[str, Any] = field(default_factory=dict)
    description: str = ""
    
    # Signal context
    crash_point: Optional[float] = None
    predicted_outcome: Optional[str] = None
    
    # Validation
    is_validated: bool = False
    validation_result: Optional[bool] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "signal_id": self.signal_id,
            "signal_type": self.signal_type.value,
            "signal_name": self.signal_name,
            "timestamp": self.timestamp.isoformat(),
            "round_id": self.round_id,
            "strength": self.strength,
            "confidence": self.confidence,
            "severity": self.severity.value,
            "signal_parameters": self.signal_parameters,
            "description": self.description,
            "crash_point": self.crash_point,
            "predicted_outcome": self.predicted_outcome,
            "is_validated": self.is_validated,
            "validation_result": self.validation_result
        }


@dataclass
class SignalConfiguration:
    """Configuration for signal detection system."""
    
    # Signal type enablement
    enable_momentum: bool = True
    enable_reversion: bool = True
    enable_exhaustion: bool = True
    enable_pattern: bool = True
    enable_linguistic: bool = True
    enable_reverse_linguistic: bool = True
    enable_cascade: bool = True
    enable_anti_correlation: bool = True
    
    # Thresholds
    min_strength: float = 0.6
    min_confidence: float = 0.7
    high_confidence: float = 0.85
    
    # Time windows
    short_window: int = 10  # rounds
    medium_window: int = 50  # rounds
    long_window: int = 200  # rounds
    
    # Pattern recognition
    pattern_similarity_threshold: float = 0.8
    min_pattern_length: int = 5
    
    # Signal filtering
    max_signals_per_round: int = 10
    signal_cooldown_rounds: int = 3
    
    # Validation
    enable_auto_validation: bool = True
    validation_window: int = 5  # rounds
    
    def validate(self) -> bool:
        """Validate configuration parameters."""
        if not (0.0 <= self.min_strength <= 1.0):
            return False
        if not (0.0 <= self.min_confidence <= 1.0):
            return False
        if not (0.0 <= self.high_confidence <= 1.0):
            return False
        if self.min_confidence >= self.high_confidence:
            return False
        if self.max_signals_per_round < 1:
            return False
        return True


@dataclass
class SignalPerformance:
    """Performance metrics for signal types."""
    
    signal_type: SignalType
    total_signals: int = 0
    validated_signals: int = 0
    correct_predictions: int = 0
    
    # Performance metrics
    accuracy: float = 0.0
    precision: float = 0.0
    recall: float = 0.0
    
    # Recent performance
    recent_accuracy: float = 0.0
    accuracy_history: List[float] = field(default_factory=list)
    
    def update_metrics(self) -> None:
        """Update performance metrics."""
        if self.validated_signals > 0:
            self.accuracy = self.correct_predictions / self.validated_signals
        
        if self.total_signals > 0:
            self.precision = self.correct_predictions / self.total_signals
        
        # Recall would need total possible signals - placeholder
        self.recall = self.accuracy  # Simplified
    
    def add_accuracy_reading(self, accuracy: float) -> None:
        """Add accuracy reading to history."""
        self.accuracy_history.append(accuracy)
        if len(self.accuracy_history) > 20:
            self.accuracy_history = self.accuracy_history[-20:]
        
        # Calculate recent accuracy
        if self.accuracy_history:
            self.recent_accuracy = sum(self.accuracy_history) / len(self.accuracy_history)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "signal_type": self.signal_type.value,
            "total_signals": self.total_signals,
            "validated_signals": self.validated_signals,
            "correct_predictions": self.correct_predictions,
            "accuracy": self.accuracy,
            "precision": self.precision,
            "recall": self.recall,
            "recent_accuracy": self.recent_accuracy,
            "accuracy_history": self.accuracy_history[-10:]  # Last 10 readings
        }