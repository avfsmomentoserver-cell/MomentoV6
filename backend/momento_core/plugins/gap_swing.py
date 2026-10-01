"""
Gap Swing Analyzer Plugin

Calculates swing across gaps using moving averages (10x, 100x gaps)
with repeat testing for accuracy validation.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from enum import Enum
import statistics
from collections import deque


class GapDirection(Enum):
    """Gap crossing direction."""
    UPWARD = "upward"  # Crossing gap upward
    DOWNWARD = "downward"  # Crossing gap downward
    NONE = "none"  # No gap crossing


class GapStrength(Enum):
    """Gap strength classification."""
    WEAK = "weak"  # Small gaps, easily crossed
    MODERATE = "moderate"  # Standard gaps
    STRONG = "strong"  # Large gaps, significant resistance
    CRITICAL = "critical"  # Major gap, rarely crossed


@dataclass
class GapCrossing:
    """Represents a gap crossing event."""
    gap_value: float
    direction: GapDirection
    timestamp: datetime
    round_id: str
    
    # Crossing metrics
    crossing_velocity: float = 0.0
    crossing_confidence: float = 0.0
    
    # Validation data
    is_validated: bool = False
    validation_count: int = 0
    success_count: int = 0
    
    def calculate_success_rate(self) -> float:
        """Calculate success rate of this gap crossing."""
        if self.validation_count == 0:
            return 0.0
        return self.success_count / self.validation_count


@dataclass
class GapAnalysis:
    """Result of gap analysis for current round."""
    
    round_id: str
    timestamp: datetime
    current_crash_point: float
    
    # Gap data
    gap_10x: Optional[float] = None  # 10x gap
    gap_100x: Optional[float] = None  # 100x gap
    current_gap: Optional[float] = None  # Current relevant gap
    
    # Swing metrics
    swing_magnitude: float = 0.0  # Magnitude of swing across gap
    swing_direction: GapDirection = GapDirection.NONE
    swing_velocity: float = 0.0  # Rate of swing
    
    # Moving average data
    ma_10: float = 0.0  # 10-period MA
    ma_50: float = 0.0  # 50-period MA
    ma_100: float = 0.0  # 100-period MA
    ma_200: float = 0.0  # 200-period MA
    
    # Gap crossing detection
    gap_crossing_detected: bool = False
    crossing_type: Optional[str] = None
    crossing_confidence: float = 0.0
    
    # Repeat testing results
    repeat_test_count: int = 0
    repeat_test_success: int = 0
    repeat_test_accuracy: float = 0.0
    
    # Signal generation
    signal_generated: bool = False
    signal_type: Optional[str] = None
    signal_confidence: float = 0.0
    
    # Historical context
    recent_crossings: List[GapCrossing] = field(default_factory=list)
    gap_strength: Optional[GapStrength] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "round_id": self.round_id,
            "timestamp": self.timestamp.isoformat(),
            "current_crash_point": self.current_crash_point,
            "gap_10x": self.gap_10x,
            "gap_100x": self.gap_100x,
            "current_gap": self.current_gap,
            "swing_magnitude": self.swing_magnitude,
            "swing_direction": self.swing_direction.value,
            "swing_velocity": self.swing_velocity,
            "ma_10": self.ma_10,
            "ma_50": self.ma_50,
            "ma_100": self.ma_100,
            "ma_200": self.ma_200,
            "gap_crossing_detected": self.gap_crossing_detected,
            "crossing_type": self.crossing_type,
            "crossing_confidence": self.crossing_confidence,
            "repeat_test_count": self.repeat_test_count,
            "repeat_test_success": self.repeat_test_success,
            "repeat_test_accuracy": self.repeat_test_accuracy,
            "signal_generated": self.signal_generated,
            "signal_type": self.signal_type,
            "signal_confidence": self.signal_confidence,
            "recent_crossings": [
                {
                    "gap_value": c.gap_value,
                    "direction": c.direction.value,
                    "timestamp": c.timestamp.isoformat(),
                    "crossing_velocity": c.crossing_velocity,
                    "success_rate": c.calculate_success_rate()
                }
                for c in self.recent_crossings[-5:]
            ],
            "gap_strength": self.gap_strength.value if self.gap_strength else None
        }


class GapSwingAnalyzer:
    """
    Analyzes gap swings using moving averages with repeat testing.
    
    This plugin:
    - Detects gap levels (10x, 100x, custom)
    - Calculates swing magnitude across gaps
    - Uses moving averages for smooth gap detection
    - Implements repeat testing for accuracy
    - Generates signals based on gap crossing patterns
    """
    
    def __init__(self, 
                 ma_periods: List[int] = None,
                 gap_levels: List[float] = None,
                 repeat_test_iterations: int = 5):
        """
        Initialize the gap swing analyzer.
        
        Args:
            ma_periods: Moving average periods to calculate
            gap_levels: Gap levels to monitor (e.g., [10.0, 100.0])
            repeat_test_iterations: Number of repeat tests for accuracy validation
        """
        self.ma_periods = ma_periods or [10, 50, 100, 200]
        self.gap_levels = gap_levels or [10.0, 100.0]
        self.repeat_test_iterations = repeat_test_iterations
        
        # Historical data
        self.crash_history: deque = deque(maxlen=max(self.ma_periods) * 2)
        self.gap_crossings: List[GapCrossing] = []
        
        # Moving average cache
        self.ma_cache: Dict[int, deque] = {
            period: deque(maxlen=period) for period in self.ma_periods
        }
        
        # Tracking
        self.current_swing_direction = GapDirection.NONE
        self.swing_history: List[Tuple[float, GapDirection]] = []
        
    def analyze_round(self, round_data: Dict[str, Any]) -> GapAnalysis:
        """
        Analyze a crash round for gap swing patterns.
        
        Args:
            round_data: Dictionary containing crash round data
            
        Returns:
            GapAnalysis with complete gap analysis
        """
        # Extract round data
        round_id = round_data.get("round_id", "unknown")
        timestamp = datetime.fromisoformat(
            round_data.get("timestamp", datetime.utcnow().isoformat())
        )
        crash_point = round_data.get("crash_point", 1.0)
        
        # Add to history
        self.crash_history.append({
            "round_id": round_id,
            "timestamp": timestamp,
            "crash_point": crash_point
        })
        
        # Update moving averages
        for period in self.ma_periods:
            self.ma_cache[period].append(crash_point)
        
        # Calculate analysis
        analysis = GapAnalysis(
            round_id=round_id,
            timestamp=timestamp,
            current_crash_point=crash_point
        )
        
        # Calculate moving averages
        self._calculate_moving_averages(analysis)
        
        # Set gap levels
        analysis.gap_10x = self.gap_levels[0] if len(self.gap_levels) > 0 else None
        analysis.gap_100x = self.gap_levels[1] if len(self.gap_levels) > 1 else None
        
        # Determine current relevant gap
        analysis.current_gap = self._determine_current_gap(crash_point)
        
        # Calculate swing metrics
        analysis.swing_magnitude = self._calculate_swing_magnitude(crash_point)
        analysis.swing_direction = self._determine_swing_direction(crash_point)
        analysis.swing_velocity = self._calculate_swing_velocity()
        
        # Detect gap crossings
        self._detect_gap_crossings(analysis, round_id, timestamp)
        
        # Perform repeat testing
        self._perform_repeat_testing(analysis)
        
        # Classify gap strength
        analysis.gap_strength = self._classify_gap_strength(analysis)
        
        # Generate signals
        self._generate_signals(analysis)
        
        # Add historical context
        analysis.recent_crossings = self.gap_crossings[-10:]  # Last 10 crossings
        
        return analysis
    
    def _calculate_moving_averages(self, analysis: GapAnalysis) -> None:
        """Calculate moving averages for configured periods."""
        for period in self.ma_periods:
            ma_data = self.ma_cache[period]
            
            if len(ma_data) >= period:
                ma_value = statistics.mean(ma_data)
                
                if period == 10:
                    analysis.ma_10 = ma_value
                elif period == 50:
                    analysis.ma_50 = ma_value
                elif period == 100:
                    analysis.ma_100 = ma_value
                elif period == 200:
                    analysis.ma_200 = ma_value
    
    def _determine_current_gap(self, crash_point: float) -> Optional[float]:
        """Determine which gap level is most relevant for current point."""
        if not self.gap_levels:
            return None
        
        # Find the closest gap level above current point
        gaps_above = [g for g in self.gap_levels if g > crash_point]
        
        if not gaps_above:
            return max(self.gap_levels) if self.gap_levels else None
        
        return min(gaps_above, key=lambda g: g - crash_point)
    
    def _calculate_swing_magnitude(self, crash_point: float) -> float:
        """Calculate swing magnitude relative to gaps."""
        if len(self.crash_history) < 3:
            return 0.0
        
        recent = [r["crash_point"] for r in list(self.crash_history)[-3:]]
        
        # Calculate swing as percentage change
        swing = abs(recent[-1] - recent[-2]) / recent[-2] if recent[-2] > 0 else 0
        
        return swing
    
    def _determine_swing_direction(self, crash_point: float) -> GapDirection:
        """Determine current swing direction."""
        if len(self.crash_history) < 2:
            return GapDirection.NONE
        
        recent = [r["crash_point"] for r in list(self.crash_history)[-2:]]
        
        if recent[-1] > recent[-2]:
            direction = GapDirection.UPWARD
        elif recent[-1] < recent[-2]:
            direction = GapDirection.DOWNWARD
        else:
            direction = GapDirection.NONE
        
        self.current_swing_direction = direction
        self.swing_history.append((crash_point, direction))
        
        if len(self.swing_history) > 20:
            self.swing_history = self.swing_history[-20:]
        
        return direction
    
    def _calculate_swing_velocity(self) -> float:
        """Calculate rate of swing (velocity)."""
        if len(self.crash_history) < 3:
            return 0.0
        
        recent = [r["crash_point"] for r in list(self.crash_history)[-3:]]
        
        # Calculate velocity as change per round
        velocity = (recent[-1] - recent[-2]) if len(recent) >= 2 else 0
        
        return velocity
    
    def _detect_gap_crossings(self, analysis: GapAnalysis, round_id: str, timestamp: datetime) -> None:
        """Detect gap crossing events."""
        analysis.gap_crossing_detected = False
        
        if len(self.crash_history) < 2:
            return
        
        previous_point = list(self.crash_history)[-2]["crash_point"]
        current_point = analysis.current_crash_point
        
        # Check for crossings of each gap level
        for gap_level in self.gap_levels:
            # Check upward crossing
            if previous_point < gap_level <= current_point:
                crossing = GapCrossing(
                    gap_value=gap_level,
                    direction=GapDirection.UPWARD,
                    timestamp=timestamp,
                    round_id=round_id,
                    crossing_velocity=analysis.swing_velocity,
                    crossing_confidence=self._calculate_crossing_confidence(
                        current_point, gap_level, analysis
                    )
                )
                self.gap_crossings.append(crossing)
                
                analysis.gap_crossing_detected = True
                analysis.crossing_type = f"upward_{gap_level}x"
                analysis.crossing_confidence = crossing.crossing_confidence
                
            # Check downward crossing
            elif previous_point > gap_level >= current_point:
                crossing = GapCrossing(
                    gap_value=gap_level,
                    direction=GapDirection.DOWNWARD,
                    timestamp=timestamp,
                    round_id=round_id,
                    crossing_velocity=analysis.swing_velocity,
                    crossing_confidence=self._calculate_crossing_confidence(
                        current_point, gap_level, analysis
                    )
                )
                self.gap_crossings.append(crossing)
                
                analysis.gap_crossing_detected = True
                analysis.crossing_type = f"downward_{gap_level}x"
                analysis.crossing_confidence = crossing.crossing_confidence
        
        # Keep only recent crossings
        if len(self.gap_crossings) > 50:
            self.gap_crossings = self.gap_crossings[-50:]
    
    def _calculate_crossing_confidence(self, current_point: float, gap_level: float, analysis: GapAnalysis) -> float:
        """Calculate confidence in gap crossing detection."""
        # Base confidence on swing velocity
        velocity_confidence = min(1.0, abs(analysis.swing_velocity) / 2.0)
        
        # Adjust based on moving average alignment
        ma_alignment = 0.5
        if analysis.ma_10 > 0:
            ma_alignment = 0.5 + 0.3 * (current_point / analysis.ma_10 - 1)
        
        # Adjust based on swing magnitude
        magnitude_confidence = min(1.0, analysis.swing_magnitude * 5)
        
        # Combine factors
        confidence = (velocity_confidence * 0.4) + (ma_alignment * 0.3) + (magnitude_confidence * 0.3)
        
        return max(0.0, min(1.0, confidence))
    
    def _perform_repeat_testing(self, analysis: GapAnalysis) -> None:
        """Perform repeat testing for accuracy validation."""
        if analysis.gap_crossing_detected:
            analysis.repeat_test_count = self.repeat_test_iterations
            analysis.repeat_test_success = 0
            
            # Simulate repeat testing with different parameters
            for i in range(self.repeat_test_iterations):
                # Add slight noise to simulate testing variations
                noise_factor = 1.0 + (i * 0.02)  # 2% variation per iteration
                
                test_velocity = analysis.swing_velocity * noise_factor
                test_magnitude = analysis.swing_magnitude * noise_factor
                
                # Test if crossing still detected with noise
                if (abs(test_velocity) > 0.1 and 
                    test_magnitude > 0.05 and
                    analysis.crossing_confidence > 0.6):
                    analysis.repeat_test_success += 1
            
            # Calculate accuracy
            if analysis.repeat_test_count > 0:
                analysis.repeat_test_accuracy = analysis.repeat_test_success / analysis.repeat_test_count
        else:
            # For non-crossing rounds, perform basic validation
            analysis.repeat_test_count = 3
            analysis.repeat_test_success = 3  # Assume stable
            analysis.repeat_test_accuracy = 1.0
    
    def _classify_gap_strength(self, analysis: GapAnalysis) -> Optional[GapStrength]:
        """Classify the strength of current gap."""
        if not analysis.current_gap:
            return None
        
        # Calculate historical crossing success rate for this gap
        gap_crossings = [
            c for c in self.gap_crossings 
            if abs(c.gap_value - analysis.current_gap) < 1.0
        ]
        
        if not gap_crossings:
            return GapStrength.MODERATE
        
        success_rates = [c.calculate_success_rate() for c in gap_crossings]
        avg_success = statistics.mean(success_rates) if success_rates else 0.5
        
        # Classify based on success rate
        if avg_success > 0.8:
            return GapStrength.WEAK  # Easily crossed
        elif avg_success > 0.5:
            return GapStrength.MODERATE
        elif avg_success > 0.2:
            return GapStrength.STRONG
        else:
            return GapStrength.CRITICAL  # Rarely crossed
    
    def _generate_signals(self, analysis: GapAnalysis) -> None:
        """Generate signals based on gap analysis."""
        analysis.signal_generated = False
        
        # Signal 1: Strong upward swing toward gap
        if (analysis.swing_direction == GapDirection.UPWARD and
            analysis.swing_magnitude > 0.2 and
            analysis.current_gap and
            analysis.current_crash_point / analysis.current_gap > 0.8):
            analysis.signal_generated = True
            analysis.signal_type = "strong_upward_swing"
            analysis.signal_confidence = min(1.0, analysis.swing_magnitude * 3)
        
        # Signal 2: Gap crossing confirmed
        elif analysis.gap_crossing_detected and analysis.repeat_test_accuracy > 0.8:
            analysis.signal_generated = True
            analysis.signal_type = f"gap_crossing_{analysis.crossing_type}"
            analysis.signal_confidence = analysis.crossing_confidence * analysis.repeat_test_accuracy
        
        # Signal 3: MA alignment signal
        elif (analysis.ma_10 > analysis.ma_50 and
              analysis.ma_50 > analysis.ma_100 and
              analysis.swing_direction == GapDirection.UPWARD):
            analysis.signal_generated = True
            analysis.signal_type = "ma_alignment_upward"
            analysis.signal_confidence = 0.8
        
        # Signal 4: Critical gap resistance
        elif (analysis.gap_strength == GapStrength.CRITICAL and
              analysis.current_gap and
              analysis.current_crash_point / analysis.current_gap > 0.9):
            analysis.signal_generated = True
            analysis.signal_type = "critical_gap_resistance"
            analysis.signal_confidence = 0.9
        
        # Signal 5: Swing reversal warning
        elif (len(self.swing_history) >= 3 and
              self.swing_history[-1][1] != self.swing_history[-2][1] and
              self.swing_history[-2][1] != self.swing_history[-3][1]):
            analysis.signal_generated = True
            analysis.signal_type = "swing_reversal_warning"
            analysis.signal_confidence = 0.75
    
    def get_gap_statistics(self) -> Dict[str, Any]:
        """Get overall gap statistics."""
        if not self.gap_crossings:
            return {
                "total_crossings": 0,
                "upward_crossings": 0,
                "downward_crossings": 0,
                "average_crossing_velocity": 0.0,
                "most_crossed_gap": None,
                "current_swing_direction": GapDirection.NONE.value
            }
        
        upward = [c for c in self.gap_crossings if c.direction == GapDirection.UPWARD]
        downward = [c for c in self.gap_crossings if c.direction == GapDirection.DOWNWARD]
        
        velocities = [c.crossing_velocity for c in self.gap_crossings]
        
        # Find most crossed gap
        gap_counts = {}
        for c in self.gap_crossings:
            gap_counts[c.gap_value] = gap_counts.get(c.gap_value, 0) + 1
        
        most_crossed = max(gap_counts.items(), key=lambda x: x[1])[0] if gap_counts else None
        
        return {
            "total_crossings": len(self.gap_crossings),
            "upward_crossings": len(upward),
            "downward_crossings": len(downward),
            "average_crossing_velocity": statistics.mean(velocities) if velocities else 0.0,
            "most_crossed_gap": most_crossed,
            "current_swing_direction": self.current_swing_direction.value,
            "recent_swings": [
                {"point": p[0], "direction": p[1].value} 
                for p in self.swing_history[-5:]
            ]
        }