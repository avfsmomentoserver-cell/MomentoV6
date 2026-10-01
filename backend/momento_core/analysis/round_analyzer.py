"""
Round Analyzer Engine

Comprehensive round-by-round analysis with temporal pattern recognition,
statistical scoring, and linguistic annotation for crash games.
"""

import uuid
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from collections import deque
import statistics
from dataclasses import dataclass, field

from momento_core.prediction.models import CrashRound, CrashSeverity


@dataclass
class RoundScore:
    """Statistical score for a crash round."""
    
    round_id: str
    timestamp: datetime
    
    # Basic metrics
    crash_point: float
    duration: float
    
    # Statistical scores
    volatility_score: float  # 0.0-1.0
    momentum_score: float    # 0.0-1.0
    pattern_score: float     # 0.0-1.0
    linguistic_score: float # 0.0-1.0
    
    # Composite score
    composite_score: float   # 0.0-1.0
    
    # Classification
    severity: CrashSeverity
    round_type: str         # "instant", "rapid", "moderate", "extended", "extreme"
    
    # Linguistic annotation
    linguistic_tags: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "round_id": self.round_id,
            "timestamp": self.timestamp.isoformat(),
            "crash_point": self.crash_point,
            "duration": self.duration,
            "volatility_score": self.volatility_score,
            "momentum_score": self.momentum_score,
            "pattern_score": self.pattern_score,
            "linguistic_score": self.linguistic_score,
            "composite_score": self.composite_score,
            "severity": self.severity.value,
            "round_type": self.round_type,
            "linguistic_tags": self.linguistic_tags
        }


@dataclass
class TemporalPattern:
    """Temporal pattern detected across round boundaries."""
    
    pattern_id: str
    pattern_type: str  # "streak", "oscillation", "trend", "cluster"
    
    start_round_id: str
    end_round_id: str
    round_count: int
    
    # Pattern characteristics
    avg_crash_point: float
    crash_point_range: Tuple[float, float]
    
    # Pattern strength
    strength: float  # 0.0-1.0
    confidence: float  # 0.0-1.0
    
    # Linguistic pattern
    linguistic_signature: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "pattern_id": self.pattern_id,
            "pattern_type": self.pattern_type,
            "start_round_id": self.start_round_id,
            "end_round_id": self.end_round_id,
            "round_count": self.round_count,
            "avg_crash_point": self.avg_crash_point,
            "crash_point_range": self.crash_point_range,
            "strength": self.strength,
            "confidence": self.confidence,
            "linguistic_signature": self.linguistic_signature
        }


class RoundAnalyzer:
    """
    Comprehensive round analysis engine.
    
    Provides:
    - Round-by-round statistical scoring
    - Temporal pattern recognition across round boundaries
    - Linguistic annotation and classification
    - Comparative metrics and historical analysis
    - Round replay with predictive overlay
    """
    
    def __init__(self, history_window: int = 200):
        """Initialize round analyzer with history window."""
        self.history_window = history_window
        self.round_history: deque = deque(maxlen=history_window)
        self.round_scores: Dict[str, RoundScore] = {}
        self.temporal_patterns: List[TemporalPattern] = []
        
        # Statistical baselines
        self.baseline_crash_point: Optional[float] = None
        self.baseline_duration: Optional[float] = None
        self.baseline_volatility: Optional[float] = None
    
    def analyze_round(self, crash_round: CrashRound) -> RoundScore:
        """
        Perform comprehensive analysis on a crash round.
        
        Args:
            crash_round: Crash round to analyze
            
        Returns:
            RoundScore with comprehensive analysis
        """
        # Calculate statistical scores
        volatility_score = self._calculate_volatility_score(crash_round)
        momentum_score = self._calculate_momentum_score(crash_round)
        pattern_score = self._calculate_pattern_score(crash_round)
        linguistic_score = self._calculate_linguistic_score(crash_round)
        
        # Calculate composite score
        composite_score = (
            volatility_score * 0.25 +
            momentum_score * 0.25 +
            pattern_score * 0.25 +
            linguistic_score * 0.25
        )
        
        # Classify round
        severity = self._classify_severity(crash_round.crash_point)
        round_type = self._classify_round_type(crash_round)
        
        # Generate linguistic tags
        linguistic_tags = self._generate_linguistic_tags(crash_round, composite_score)
        
        # Create round score
        round_score = RoundScore(
            round_id=crash_round.round_id,
            timestamp=crash_round.timestamp,
            crash_point=crash_round.crash_point,
            duration=crash_round.duration_seconds,
            volatility_score=volatility_score,
            momentum_score=momentum_score,
            pattern_score=pattern_score,
            linguistic_score=linguistic_score,
            composite_score=composite_score,
            severity=severity,
            round_type=round_type,
            linguistic_tags=linguistic_tags
        )
        
        # Store results
        self.round_scores[crash_round.round_id] = round_score
        self.round_history.append(crash_round)
        
        # Update baselines
        self._update_baselines()
        
        # Detect temporal patterns
        self._detect_temporal_patterns()
        
        return round_score
    
    def _calculate_volatility_score(self, crash_round: CrashRound) -> float:
        """Calculate volatility score based on multiplier sequence."""
        sequence = crash_round.multiplier_sequence
        
        if len(sequence) < 2:
            return 0.5  # Default for insufficient data
        
        # Calculate price changes
        changes = []
        for i in range(1, len(sequence)):
            if sequence[i-1] > 0:
                change = abs(sequence[i] - sequence[i-1]) / sequence[i-1]
                changes.append(change)
        
        if not changes:
            return 0.5
        
        # Volatility based on standard deviation of changes
        volatility = statistics.stdev(changes) if len(changes) > 1 else 0.0
        
        # Normalize to 0-1 range (assuming reasonable volatility range)
        normalized_volatility = min(1.0, volatility / 0.5)
        
        return normalized_volatility
    
    def _calculate_momentum_score(self, crash_round: CrashRound) -> float:
        """Calculate momentum score based on recent round history."""
        if len(self.round_history) < 3:
            return 0.5
        
        recent_rounds = list(self.round_history)[-5:]
        recent_crashes = [r.crash_point for r in recent_rounds]
        
        # Calculate trend
        if len(recent_crashes) >= 2:
            # Simple linear regression slope
            n = len(recent_crashes)
            x = list(range(n))
            y = recent_crashes
            
            sum_x = sum(x)
            sum_y = sum(y)
            sum_xy = sum(xi * yi for xi, yi in zip(x, y))
            sum_x2 = sum(xi * xi for xi in x)
            
            denominator = n * sum_x2 - sum_x * sum_x
            if denominator != 0:
                slope = (n * sum_xy - sum_x * sum_y) / denominator
                # Normalize slope to 0-1 range
                momentum = min(1.0, max(0.0, 0.5 + slope * 0.1))
                return momentum
        
        return 0.5
    
    def _calculate_pattern_score(self, crash_round: CrashRound) -> float:
        """Calculate pattern score based on sequence patterns."""
        sequence = crash_round.multiplier_sequence
        
        if len(sequence) < 5:
            return 0.5
        
        # Look for common patterns
        pattern_count = 0
        
        # Acceleration pattern (increasing rate of change)
        if self._detect_acceleration(sequence):
            pattern_count += 1
        
        # Deceleration pattern (decreasing rate of change)
        if self._detect_deceleration(sequence):
            pattern_count += 1
        
        # Oscillation pattern
        if self._detect_oscillation(sequence):
            pattern_count += 1
        
        # Staircase pattern
        if self._detect_staircase(sequence):
            pattern_count += 1
        
        # Normalize to 0-1 range
        pattern_score = min(1.0, pattern_count / 3.0)
        
        return pattern_score
    
    def _detect_acceleration(self, sequence: List[float]) -> bool:
        """Detect acceleration pattern in sequence."""
        if len(sequence) < 3:
            return False
        
        changes = []
        for i in range(1, len(sequence)):
            if sequence[i-1] > 0:
                change = (sequence[i] - sequence[i-1]) / sequence[i-1]
                changes.append(change)
        
        if len(changes) < 2:
            return False
        
        # Check if changes are increasing
        return all(changes[i] < changes[i+1] for i in range(len(changes)-1))
    
    def _detect_deceleration(self, sequence: List[float]) -> bool:
        """Detect deceleration pattern in sequence."""
        if len(sequence) < 3:
            return False
        
        changes = []
        for i in range(1, len(sequence)):
            if sequence[i-1] > 0:
                change = (sequence[i] - sequence[i-1]) / sequence[i-1]
                changes.append(change)
        
        if len(changes) < 2:
            return False
        
        # Check if changes are decreasing
        return all(changes[i] > changes[i+1] for i in range(len(changes)-1))
    
    def _detect_oscillation(self, sequence: List[float]) -> bool:
        """Detect oscillation pattern in sequence."""
        if len(sequence) < 4:
            return False
        
        # Count direction changes
        direction_changes = 0
        for i in range(2, len(sequence)):
            if (sequence[i] > sequence[i-1] and sequence[i-1] < sequence[i-2]) or \
               (sequence[i] < sequence[i-1] and sequence[i-1] > sequence[i-2]):
                direction_changes += 1
        
        # Oscillation if multiple direction changes
        return direction_changes >= 2
    
    def _detect_staircase(self, sequence: List[float]) -> bool:
        """Detect staircase pattern (plateaus followed by jumps)."""
        if len(sequence) < 4:
            return False
        
        plateaus = 0
        for i in range(1, len(sequence)):
            # Check for plateau (similar values)
            if abs(sequence[i] - sequence[i-1]) < 0.05:
                plateaus += 1
        
        return plateaus >= 2
    
    def _calculate_linguistic_score(self, crash_round: CrashRound) -> float:
        """Calculate linguistic score based on MomentoLinguistics analysis."""
        if not crash_round.linguistic_classification:
            return 0.5
        
        classification = crash_round.linguistic_classification
        
        # Higher score for more extreme/interesting classifications
        score = 0.5
        
        # Check market classification (Layer 2)
        market = classification.get("layer2_market", "")
        if "Extreme" in market or "Gold" in market:
            score += 0.3
        elif "Purple" in market:
            score += 0.2
        elif "Pink" in market:
            score += 0.1
        
        # Check energy level (Layer 3)
        energy = classification.get("layer3_energy", "")
        if "Violent" in energy or "Exhaustion" in energy:
            score += 0.2
        elif "Recovery" in energy:
            score += 0.1
        
        # Normalize to 0-1 range
        return min(1.0, score)
    
    def _classify_severity(self, crash_point: float) -> CrashSeverity:
        """Classify crash point severity."""
        if crash_point <= 1.5:
            return CrashSeverity.TINY
        elif crash_point <= 2.0:
            return CrashSeverity.LOW
        elif crash_point <= 5.0:
            return CrashSeverity.MODERATE
        elif crash_point <= 10.0:
            return CrashSeverity.HIGH
        elif crash_point <= 50.0:
            return CrashSeverity.EXTREME
        else:
            return CrashSeverity.CRITICAL
    
    def _classify_round_type(self, crash_round: CrashRound) -> str:
        """Classify round type based on characteristics."""
        crash_point = crash_round.crash_point
        duration = crash_round.duration_seconds
        
        if crash_point <= 1.1:
            return "instant"
        elif crash_point <= 2.0 and duration < 5:
            return "rapid"
        elif crash_point <= 5.0:
            return "moderate"
        elif crash_point <= 20.0 and duration > 30:
            return "extended"
        elif crash_point > 20.0:
            return "extreme"
        else:
            return "standard"
    
    def _generate_linguistic_tags(self, crash_round: CrashRound, composite_score: float) -> List[str]:
        """Generate linguistic tags for the round."""
        tags = []
        
        # Add severity tag
        tags.append(f"severity:{self._classify_severity(crash_round.crash_point).value}")
        
        # Add round type tag
        tags.append(f"type:{self._classify_round_type(crash_round)}")
        
        # Add composite score tag
        if composite_score >= 0.8:
            tags.append("high_interest")
        elif composite_score >= 0.6:
            tags.append("moderate_interest")
        else:
            tags.append("low_interest")
        
        # Add linguistic classification tags
        if crash_round.linguistic_classification:
            market = crash_round.linguistic_classification.get("layer2_market", "")
            energy = crash_round.linguistic_classification.get("layer3_energy", "")
            
            if market:
                tags.append(f"market:{market.lower()}")
            if energy:
                tags.append(f"energy:{energy.lower()}")
        
        return tags
    
    def _update_baselines(self) -> None:
        """Update statistical baselines from history."""
        if len(self.round_history) < 10:
            return
        
        crashes = [r.crash_point for r in self.round_history]
        durations = [r.duration_seconds for r in self.round_history]
        
        self.baseline_crash_point = statistics.mean(crashes)
        self.baseline_duration = statistics.mean(durations)
        
        # Calculate baseline volatility
        all_volatilities = []
        for round_data in self.round_history:
            vol = self._calculate_volatility_score(round_data)
            all_volatilities.append(vol)
        
        self.baseline_volatility = statistics.mean(all_volatilities)
    
    def _detect_temporal_patterns(self) -> None:
        """Detect temporal patterns across round boundaries."""
        if len(self.round_history) < 10:
            return
        
        recent_rounds = list(self.round_history)[-20:]
        
        # Detect streaks
        self._detect_streaks(recent_rounds)
        
        # Detect oscillations
        self._detect_oscillations(recent_rounds)
        
        # Detect trends
        self._detect_trends(recent_rounds)
    
    def _detect_streaks(self, rounds: List[CrashRound]) -> None:
        """Detect streak patterns in crash points."""
        crashes = [r.crash_point for r in rounds]
        
        # High streak (consecutive high crashes)
        high_streak = 0
        for crash in crashes:
            if crash > 5.0:
                high_streak += 1
            else:
                if high_streak >= 3:
                    self._add_temporal_pattern(
                        "streak", "high_crash_streak", 
                        rounds[0].round_id, rounds[-1].round_id,
                        len(rounds), crashes
                    )
                high_streak = 0
        
        # Low streak (consecutive low crashes)
        low_streak = 0
        for crash in crashes:
            if crash < 2.0:
                low_streak += 1
            else:
                if low_streak >= 3:
                    self._add_temporal_pattern(
                        "streak", "low_crash_streak",
                        rounds[0].round_id, rounds[-1].round_id,
                        len(rounds), crashes
                    )
                low_streak = 0
    
    def _detect_oscillations(self, rounds: List[CrashRound]) -> None:
        """Detect oscillation patterns."""
        crashes = [r.crash_point for r in rounds]
        
        if len(crashes) < 5:
            return
        
        # Count direction changes
        direction_changes = 0
        for i in range(2, len(crashes)):
            if (crashes[i] > crashes[i-1] and crashes[i-1] < crashes[i-2]) or \
               (crashes[i] < crashes[i-1] and crashes[i-1] > crashes[i-2]):
                direction_changes += 1
        
        if direction_changes >= 3:
            self._add_temporal_pattern(
                "oscillation", "multi_direction_oscillation",
                rounds[0].round_id, rounds[-1].round_id,
                len(rounds), crashes
            )
    
    def _detect_trends(self, rounds: List[CrashRound]) -> None:
        """Detect trend patterns."""
        crashes = [r.crash_point for r in rounds]
        
        if len(crashes) < 5:
            return
        
        # Calculate trend direction
        first_half = crashes[:len(crashes)//2]
        second_half = crashes[len(crashes)//2:]
        
        first_avg = statistics.mean(first_half)
        second_avg = statistics.mean(second_half)
        
        if second_avg > first_avg * 1.5:
            self._add_temporal_pattern(
                "trend", "upward_trend",
                rounds[0].round_id, rounds[-1].round_id,
                len(rounds), crashes
            )
        elif second_avg < first_avg * 0.7:
            self._add_temporal_pattern(
                "trend", "downward_trend",
                rounds[0].round_id, rounds[-1].round_id,
                len(rounds), crashes
            )
    
    def _add_temporal_pattern(
        self,
        pattern_type: str,
        pattern_name: str,
        start_round_id: str,
        end_round_id: str,
        round_count: int,
        crashes: List[float]
    ) -> None:
        """Add a temporal pattern to the patterns list."""
        pattern = TemporalPattern(
            pattern_id=str(uuid.uuid4()),
            pattern_type=pattern_type,
            start_round_id=start_round_id,
            end_round_id=end_round_id,
            round_count=round_count,
            avg_crash_point=statistics.mean(crashes),
            crash_point_range=(min(crashes), max(crashes)),
            strength=0.7,  # Placeholder - could be calculated more precisely
            confidence=0.6  # Placeholder - could be calculated more precisely
        )
        
        self.temporal_patterns.append(pattern)
        
        # Keep only recent patterns
        if len(self.temporal_patterns) > 50:
            self.temporal_patterns = self.temporal_patterns[-50:]
    
    def get_comparative_metrics(self, round_id: str) -> Optional[Dict[str, Any]]:
        """Get comparative metrics for a specific round."""
        if round_id not in self.round_scores:
            return None
        
        round_score = self.round_scores[round_id]
        
        if not self.baseline_crash_point:
            return {
                "round_score": round_score.to_dict(),
                "baseline_available": False
            }
        
        # Calculate comparative metrics
        crash_deviation = (round_score.crash_point - self.baseline_crash_point) / self.baseline_crash_point
        duration_deviation = (round_score.duration - self.baseline_duration) / self.baseline_duration if self.baseline_duration else 0.0
        
        return {
            "round_score": round_score.to_dict(),
            "baseline_available": True,
            "comparative_metrics": {
                "crash_point_baseline": self.baseline_crash_point,
                "crash_point_deviation": crash_deviation,
                "duration_baseline": self.baseline_duration,
                "duration_deviation": duration_deviation,
                "volatility_baseline": self.baseline_volatility,
                "volatility_deviation": round_score.volatility_score - (self.baseline_volatility or 0.5)
            }
        }
    
    def get_round_replay_data(self, round_id: str) -> Optional[Dict[str, Any]]:
        """Get data for round replay with predictive overlay."""
        if round_id not in self.round_scores:
            return None
        
        # Find the round in history
        crash_round = None
        for round_data in self.round_history:
            if round_data.round_id == round_id:
                crash_round = round_data
                break
        
        if not crash_round:
            return None
        
        round_score = self.round_scores[round_id]
        
        return {
            "round_data": crash_round.to_dict(),
            "round_score": round_score.to_dict(),
            "predictive_overlay": {
                "predicted_crash": crash_round.predicted_crash_point,
                "prediction_confidence": crash_round.prediction_confidence,
                "prediction_strategy": crash_round.prediction_strategy
            },
            "linguistic_timeline": self._generate_linguistic_timeline(crash_round)
        }
    
    def _generate_linguistic_timeline(self, crash_round: CrashRound) -> List[Dict[str, Any]]:
        """Generate linguistic annotation timeline for the round."""
        timeline = []
        
        if not crash_round.multiplier_sequence:
            return timeline
        
        # Create timeline points at regular intervals
        sequence = crash_round.multiplier_sequence
        if len(sequence) < 2:
            return timeline
        
        # Sample points (max 20 points)
        sample_interval = max(1, len(sequence) // 20)
        
        for i in range(0, len(sequence), sample_interval):
            point = {
                "index": i,
                "multiplier": sequence[i],
                "timestamp": i * (crash_round.duration_seconds / len(sequence)),
                "linguistic_state": self._get_linguistic_state_at_point(sequence, i)
            }
            timeline.append(point)
        
        return timeline
    
    def _get_linguistic_state_at_point(self, sequence: List[float], index: int) -> str:
        """Get linguistic state at a specific point in the sequence."""
        if index >= len(sequence):
            return "unknown"
        
        value = sequence[index]
        
        # Simple linguistic classification
        if value <= 1.1:
            return "instant_crash_zone"
        elif value <= 1.5:
            return "rapid_decline_zone"
        elif value <= 2.0:
            return "fast_fall_zone"
        elif value <= 5.0:
            return "moderate_descent_zone"
        elif value <= 10.0:
            return "gradual_decline_zone"
        else:
            return "extended_plateau_zone"
    
    def get_temporal_patterns(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get recent temporal patterns."""
        patterns = self.temporal_patterns[-limit:]
        return [pattern.to_dict() for pattern in patterns]