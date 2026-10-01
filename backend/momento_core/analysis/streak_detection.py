"""
Streak Detection Module

Detects specific streak patterns that predict moonshots and mega spikes.
Based on observed patterns in crash game data.
"""

from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from collections import deque
from datetime import datetime
import uuid
import statistics


@dataclass
class StreakPattern:
    """Represents a detected streak pattern."""
    
    pattern_id: str
    pattern_name: str
    timestamp: datetime
    confidence: float  # 0.0 to 1.0
    prediction: str  # "moonshot", "mega_spike", etc.
    prediction_horizon: int  # rounds
    
    # Pattern details
    streak_length: int
    trigger_value: float
    values: List[float] = field(default_factory=list)
    
    # Validation
    validated: bool = False
    actual_outcome: Optional[float] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "pattern_id": self.pattern_id,
            "pattern_name": self.pattern_name,
            "timestamp": self.timestamp.isoformat(),
            "confidence": self.confidence,
            "prediction": self.prediction,
            "prediction_horizon": self.prediction_horizon,
            "streak_length": self.streak_length,
            "trigger_value": self.trigger_value,
            "values": self.values,
            "validated": self.validated,
            "actual_outcome": self.actual_outcome
        }


class StreakDetector:
    """
    Detects streak patterns that predict moonshots and mega spikes.
    
    Patterns:
    1. Low multiplier streak → moonshot (1x + 9 continuous similar → moonshot within 10r)
    2. Multi-band transition → moonshot (6-9x → 2-4x → 1x-2x → 9x with gaps ≤3r)
    3. High multiplier density → moonshot (10x+ in 100r window, avg 5-10x)
    4. Moonshot cluster → mega spike (10-30x cluster → 100x-30000x within 20r)
    """
    
    def __init__(self, history_window: int = 200):
        """
        Initialize streak detector.
        
        Args:
            history_window: Size of history window for pattern detection
        """
        self.history_window = history_window
        self.multiplier_history: deque = deque(maxlen=history_window * 2)
        self.timestamp_history: deque = deque(maxlen=history_window * 2)
        
        # Detected patterns
        self.detected_patterns: List[StreakPattern] = []
        
        # Pattern configurations
        self.pattern_configs = {
            "low_multiplier_streak": {
                "confidence": 0.7,
                "min_length": 10,
                "prediction_horizon": 10,
                "trigger_range": (1.0, 1.5),
                "similar_range": (1.0, 2.0)
            },
            "multi_band_transition": {
                "confidence": 0.65,
                "prediction_horizon": 10,
                "bands": [(6.0, 9.0), (2.0, 4.0), (1.0, 2.0), (9.0, float('inf'))],
                "max_gap": 3,
                "min_total_length": 3
            },
            "high_multiplier_density": {
                "confidence": 0.75,
                "prediction_horizon": 10,
                "window_size": 100,
                "min_multiplier": 10.0,
                "avg_range": (5.0, 10.0),
                "max_gap": 10
            },
            "moonshot_cluster": {
                "confidence": 0.8,
                "prediction_horizon": 20,
                "cluster_range": (10.0, 30.0),
                "mega_spike_range": (100.0, 30000.0),
                "historical_lookback": 20
            }
        }
    
    def analyze_round(self, multiplier: float, timestamp: datetime) -> Dict[str, Any]:
        """
        Analyze a round for streak patterns.
        
        Args:
            multiplier: Round multiplier value
            timestamp: Round timestamp
            
        Returns:
            Analysis results with detected patterns and predictions
        """
        # Add to history
        self.multiplier_history.append(multiplier)
        self.timestamp_history.append(timestamp)
        
        # Detect patterns
        new_patterns = []
        
        # Pattern 1: Low multiplier streak
        pattern1 = self._detect_low_multiplier_streak(timestamp)
        if pattern1:
            new_patterns.append(pattern1)
        
        # Pattern 2: Multi-band transition
        pattern2 = self._detect_multi_band_transition(timestamp)
        if pattern2:
            new_patterns.append(pattern2)
        
        # Pattern 3: High multiplier density
        pattern3 = self._detect_high_multiplier_density(timestamp)
        if pattern3:
            new_patterns.append(pattern3)
        
        # Pattern 4: Moonshot cluster
        pattern4 = self._detect_moonshot_cluster(timestamp)
        if pattern4:
            new_patterns.append(pattern4)
        
        # Store patterns
        for pattern in new_patterns:
            self.detected_patterns.append(pattern)
        
        # Validate previous predictions
        self._validate_predictions(multiplier)
        
        return {
            "new_patterns": [p.to_dict() for p in new_patterns],
            "total_patterns_detected": len(self.detected_patterns),
            "pending_predictions": len([p for p in self.detected_patterns if not p.validated]),
            "validation_accuracy": self._calculate_accuracy()
        }
    
    def _detect_low_multiplier_streak(self, timestamp: datetime) -> Optional[StreakPattern]:
        """Detect Pattern 1: Low multiplier streak → moonshot."""
        config = self.pattern_configs["low_multiplier_streak"]
        
        if len(self.multiplier_history) < config["min_length"]:
            return None
        
        recent_multipliers = list(self.multiplier_history)[-config["min_length"]:]
        
        # Check for 1x trigger followed by similar values
        if recent_multipliers[0] < config["trigger_range"][1]:
            similar_count = 0
            for val in recent_multipliers[1:]:
                if config["similar_range"][0] <= val <= config["similar_range"][1]:
                    similar_count += 1
            
            if similar_count >= config["min_length"] - 1:
                return StreakPattern(
                    pattern_id=str(uuid.uuid4()),
                    pattern_name="low_multiplier_streak",
                    timestamp=timestamp,
                    confidence=config["confidence"],
                    prediction="moonshot",
                    prediction_horizon=config["prediction_horizon"],
                    streak_length=config["min_length"],
                    trigger_value=recent_multipliers[0],
                    values=recent_multipliers
                )
        
        return None
    
    def _detect_multi_band_transition(self, timestamp: datetime) -> Optional[StreakPattern]:
        """Detect Pattern 2: Multi-band transition → moonshot."""
        config = self.pattern_configs["multi_band_transition"]
        
        if len(self.multiplier_history) < 20:
            return None
        
        recent_multipliers = list(self.multiplier_history)[-20:]
        
        # Look for sequence: 6-9x → 2-4x → 1x-2x → 9x
        bands = config["bands"]
        max_gap = config["max_gap"]
        
        # Find starting point in first band
        for i, val in enumerate(recent_multipliers):
            if bands[0][0] <= val < bands[0][1]:
                # Check for transition through bands
                sequence_indices = [i]
                current_idx = i + 1
                
                for band_idx in range(1, len(bands)):
                    found = False
                    gap_count = 0
                    
                    while current_idx < len(recent_multipliers) and gap_count <= max_gap:
                        if bands[band_idx][0] <= recent_multipliers[current_idx] < bands[band_idx][1]:
                            sequence_indices.append(current_idx)
                            found = True
                            break
                        current_idx += 1
                        gap_count += 1
                    
                    if not found:
                        break
                
                # Check if complete sequence found
                if len(sequence_indices) == len(bands):
                    total_length = sequence_indices[-1] - sequence_indices[0] + 1
                    if total_length >= config["min_total_length"]:
                        return StreakPattern(
                            pattern_id=str(uuid.uuid4()),
                            pattern_name="multi_band_transition",
                            timestamp=timestamp,
                            confidence=config["confidence"],
                            prediction="moonshot",
                            prediction_horizon=config["prediction_horizon"],
                            streak_length=total_length,
                            trigger_value=recent_multipliers[sequence_indices[0]],
                            values=[recent_multipliers[idx] for idx in sequence_indices]
                        )
        
        return None
    
    def _detect_high_multiplier_density(self, timestamp: datetime) -> Optional[StreakPattern]:
        """Detect Pattern 3: High multiplier density → moonshot."""
        config = self.pattern_configs["high_multiplier_density"]
        
        if len(self.multiplier_history) < config["window_size"]:
            return None
        
        window = list(self.multiplier_history)[-config["window_size"]:]
        
        # Find 10x+ multipliers
        high_multipliers = [
            (i, val) for i, val in enumerate(window)
            if val >= config["min_multiplier"]
        ]
        
        if len(high_multipliers) < 3:
            return None
        
        # Check gaps between high multipliers
        valid_sequence = []
        for i in range(len(high_multipliers) - 1):
            idx1, val1 = high_multipliers[i]
            idx2, val2 = high_multipliers[i + 1]
            gap = idx2 - idx1
            
            if gap <= config["max_gap"]:
                valid_sequence.append(val1)
        
        if len(valid_sequence) >= 2:
            # Calculate average
            avg_multiplier = statistics.mean(valid_sequence + [high_multipliers[-1][1]])
            
            if config["avg_range"][0] <= avg_multiplier <= config["avg_range"][1]:
                return StreakPattern(
                    pattern_id=str(uuid.uuid4()),
                    pattern_name="high_multiplier_density",
                    timestamp=timestamp,
                    confidence=config["confidence"],
                    prediction="moonshot",
                    prediction_horizon=config["prediction_horizon"],
                    streak_length=len(valid_sequence),
                    trigger_value=valid_sequence[0] if valid_sequence else 0,
                    values=valid_sequence
                )
        
        return None
    
    def _detect_moonshot_cluster(self, timestamp: datetime) -> Optional[StreakPattern]:
        """Detect Pattern 4: Moonshot cluster → mega spike."""
        config = self.pattern_configs["moonshot_cluster"]
        
        if len(self.multiplier_history) < config["historical_lookback"] + 10:
            return None
        
        recent = list(self.multiplier_history)[-config["historical_lookback"]:]
        
        # Find moonshots in cluster range
        moonshots = [val for val in recent if config["cluster_range"][0] <= val < config["cluster_range"][1]]
        
        if len(moonshots) >= 2:
            # Check historical context for mega spikes
            historical = list(self.multiplier_history)[:-config["historical_lookback"]]
            mega_spikes = [val for val in historical if val >= config["mega_spike_range"][0]]
            
            if mega_spikes:
                return StreakPattern(
                    pattern_id=str(uuid.uuid4()),
                    pattern_name="moonshot_cluster",
                    timestamp=timestamp,
                    confidence=config["confidence"],
                    prediction="mega_spike",
                    prediction_horizon=config["prediction_horizon"],
                    streak_length=len(moonshots),
                    trigger_value=moonshots[0],
                    values=moonshots
                )
        
        return None
    
    def _validate_predictions(self, current_multiplier: float) -> None:
        """Validate pending predictions against current outcome."""
        for pattern in self.detected_patterns:
            if not pattern.validated:
                # Check if prediction horizon has passed
                pattern_idx = self.detected_patterns.index(pattern)
                rounds_since = len(self.multiplier_history) - pattern_idx - 1
                
                if rounds_since >= pattern.prediction_horizon:
                    pattern.validated = True
                    pattern.actual_outcome = current_multiplier
    
    def _calculate_accuracy(self) -> float:
        """Calculate prediction accuracy."""
        validated = [p for p in self.detected_patterns if p.validated]
        
        if not validated:
            return 0.0
        
        # Simple accuracy: count if prediction direction was correct
        correct = 0
        for pattern in validated:
            if pattern.prediction == "moonshot":
                if pattern.actual_outcome and pattern.actual_outcome >= 5.0:
                    correct += 1
            elif pattern.prediction == "mega_spike":
                if pattern.actual_outcome and pattern.actual_outcome >= 100.0:
                    correct += 1
        
        return correct / len(validated) if validated else 0.0
    
    def get_pattern_summary(self) -> Dict[str, Any]:
        """Get summary of detected patterns."""
        pattern_counts = {}
        for pattern in self.detected_patterns:
            pattern_counts[pattern.pattern_name] = pattern_counts.get(pattern.pattern_name, 0) + 1
        
        return {
            "total_patterns": len(self.detected_patterns),
            "patterns_by_type": pattern_counts,
            "validation_accuracy": self._calculate_accuracy(),
            "pending_validations": len([p for p in self.detected_patterns if not p.validated])
        }
