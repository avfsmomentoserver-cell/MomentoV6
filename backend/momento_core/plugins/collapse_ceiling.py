"""
Collapse Ceiling & Ascend Power Analyzer Plugin

Analyzes current crash points relative to historical ceilings, calculates
clearance distances, ascend power, and detects ceiling direction patterns.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Any
from enum import Enum
import statistics
from collections import deque


class CeilingDirection(Enum):
    """Ceiling direction patterns."""
    ASCENDING = "ascending"  # Ceiling is moving up
    DESCENDING = "descending"  # Ceiling is moving down
    STABLE = "stable"  # Ceiling is relatively stable
    VOLATILE = "volatile"  # Rapid ceiling changes


class CeilingStrength(Enum):
    """Ceiling strength classification."""
    WEAK = "weak"  # Easily breached
    MODERATE = "moderate"  # Some resistance
    STRONG = "strong"  # High resistance
    IMPENETRABLE = "impenetrable"  # Historically unbreakable


@dataclass
class CeilingPoint:
    """Represents a detected ceiling point."""
    value: float
    timestamp: datetime
    attempts: int = 0  # How many times this ceiling was tested
    breaches: int = 0  # How many times it was breached
    strength: CeilingStrength = CeilingStrength.MODERATE
    
    def calculate_breach_rate(self) -> float:
        """Calculate historical breach rate."""
        if self.attempts == 0:
            return 0.0
        return self.breaches / self.attempts


@dataclass
class CeilingAnalysis:
    """Result of ceiling analysis for current round."""
    
    round_id: str
    timestamp: datetime
    current_crash_point: float
    
    # Ceiling data
    nearest_ceiling: Optional[float] = None
    ceiling_distance: Optional[float] = None  # Distance from current to ceiling
    ceiling_direction: CeilingDirection = CeilingDirection.STABLE
    ceiling_strength: Optional[CeilingStrength] = None
    
    # Ascend power metrics
    ascend_power: float = 0.0  # 0.0 to 1.0, momentum toward ceiling
    ascend_velocity: float = 0.0  # Rate of approach to ceiling
    ascend_acceleration: float = 0.0  # Change in velocity
    
    # Clearance metrics
    clearance_ratio: float = 0.0  # Current / ceiling ratio
    clearance_percentile: float = 0.0  # Historical percentile
    
    # Signal generation
    signal_generated: bool = False
    signal_type: Optional[str] = None
    signal_confidence: float = 0.0
    
    # Historical context
    historical_ceilings: List[CeilingPoint] = field(default_factory=list)
    recent_approaches: List[float] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "round_id": self.round_id,
            "timestamp": self.timestamp.isoformat(),
            "current_crash_point": self.current_crash_point,
            "nearest_ceiling": self.nearest_ceiling,
            "ceiling_distance": self.ceiling_distance,
            "ceiling_direction": self.ceiling_direction.value,
            "ceiling_strength": self.ceiling_strength.value if self.ceiling_strength else None,
            "ascend_power": self.ascend_power,
            "ascend_velocity": self.ascend_velocity,
            "ascend_acceleration": self.ascend_acceleration,
            "clearance_ratio": self.clearance_ratio,
            "clearance_percentile": self.clearance_percentile,
            "signal_generated": self.signal_generated,
            "signal_type": self.signal_type,
            "signal_confidence": self.signal_confidence,
            "historical_ceilings": [
                {
                    "value": c.value,
                    "timestamp": c.timestamp.isoformat(),
                    "attempts": c.attempts,
                    "breaches": c.breaches,
                    "strength": c.strength.value
                }
                for c in self.historical_ceilings
            ],
            "recent_approaches": self.recent_approaches[-10:]  # Last 10 approaches
        }


class CollapseCeilingAnalyzer:
    """
    Analyzes collapse ceilings and ascend power for crash prediction.
    
    This plugin:
    - Detects historical ceiling points from crash data
    - Calculates current clearance from nearest ceiling
    - Measures ascend power (momentum toward ceiling)
    - Determines ceiling direction (ascending/descending/stable)
    - Generates signals based on ceiling breach patterns
    """
    
    def __init__(self, window_size: int = 50, ceiling_threshold: float = 0.8):
        """
        Initialize the ceiling analyzer.
        
        Args:
            window_size: Number of rounds to analyze for ceiling detection
            ceiling_threshold: Minimum ratio to consider a point as ceiling
        """
        self.window_size = window_size
        self.ceiling_threshold = ceiling_threshold
        
        # Historical data
        self.crash_history: deque = deque(maxlen=window_size * 2)
        self.detected_ceilings: List[CeilingPoint] = []
        
        # Tracking
        self.current_ceiling_direction = CeilingDirection.STABLE
        self.ceiling_direction_history: List[CeilingDirection] = []
        
    def analyze_round(self, round_data: Dict[str, Any]) -> CeilingAnalysis:
        """
        Analyze a crash round for ceiling patterns.
        
        Args:
            round_data: Dictionary containing crash round data
            
        Returns:
            CeilingAnalysis with complete ceiling analysis
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
        
        # Detect/update ceilings
        self._update_ceilings(crash_point, timestamp)
        
        # Find nearest ceiling
        nearest_ceiling = self._find_nearest_ceiling(crash_point)
        
        # Calculate analysis metrics
        analysis = CeilingAnalysis(
            round_id=round_id,
            timestamp=timestamp,
            current_crash_point=crash_point
        )
        
        if nearest_ceiling:
            analysis.nearest_ceiling = nearest_ceiling.value
            analysis.ceiling_distance = nearest_ceiling.value - crash_point
            analysis.ceiling_strength = nearest_ceiling.strength
            analysis.clearance_ratio = crash_point / nearest_ceiling.value
            
            # Calculate ascend power
            analysis.ascend_power = self._calculate_ascend_power(crash_point, nearest_ceiling)
            analysis.ascend_velocity = self._calculate_ascend_velocity(crash_point, nearest_ceiling)
            analysis.ascend_acceleration = self._calculate_ascend_acceleration()
            
            # Calculate percentile
            analysis.clearance_percentile = self._calculate_clearance_percentile(
                crash_point, nearest_ceiling.value
            )
        
        # Determine ceiling direction
        analysis.ceiling_direction = self._determine_ceiling_direction()
        
        # Generate signals
        self._generate_signals(analysis)
        
        # Add historical context
        analysis.historical_ceilings = self.detected_ceilings[-10:]  # Last 10 ceilings
        analysis.recent_approaches = self._get_recent_approaches()
        
        return analysis
    
    def _update_ceilings(self, crash_point: float, timestamp: datetime) -> None:
        """Update ceilings with the new round, then detect new ceilings.

        Every round that reaches 90% of a known ceiling is an attempt on it, and
        a round at or above the ceiling is a breach. Detection only adds new
        ceilings (re-scanning the window must not re-count old attempts).
        """
        for ceiling in self.detected_ceilings:
            if crash_point >= ceiling.value * 0.9:
                ceiling.attempts += 1
                if crash_point >= ceiling.value:
                    ceiling.breaches += 1
                self._reclassify(ceiling)

        if len(self.crash_history) < 10:
            return

        recent_points = [r["crash_point"] for r in list(self.crash_history)[-self.window_size:]]
        mean_recent = statistics.mean(recent_points)
        for i in range(2, len(recent_points) - 2):
            v = recent_points[i]
            if (v > recent_points[i-1] and v > recent_points[i-2] and
                    v > recent_points[i+1] and v > recent_points[i+2] and
                    v > mean_recent * self.ceiling_threshold):
                if any(abs(c.value - v) < 0.1 for c in self.detected_ceilings):
                    continue
                new_ceiling = CeilingPoint(value=v, timestamp=timestamp, attempts=1, breaches=0)
                self._classify_ceiling_strength(new_ceiling)
                self.detected_ceilings.append(new_ceiling)

        if len(self.detected_ceilings) > 20:
            self.detected_ceilings = self.detected_ceilings[-20:]

    @staticmethod
    def _strength_for_rate(rate: float) -> CeilingStrength:
        if rate > 0.7:
            return CeilingStrength.WEAK
        if rate > 0.4:
            return CeilingStrength.MODERATE
        if rate > 0.1:
            return CeilingStrength.STRONG
        return CeilingStrength.IMPENETRABLE

    def _reclassify(self, ceiling: CeilingPoint) -> None:
        """Own breach rate once the ceiling has enough attempts."""
        if ceiling.attempts >= 5:
            ceiling.strength = self._strength_for_rate(ceiling.calculate_breach_rate())

    def _classify_ceiling_strength(self, ceiling: CeilingPoint) -> None:
        """Classify ceiling strength based on historical data."""
        if len(self.detected_ceilings) < 3:
            ceiling.strength = CeilingStrength.MODERATE
            return
        
        # Calculate average breach rate for similar ceilings
        tol = max(0.5, 0.05 * ceiling.value)
        similar_ceilings = [
            c for c in self.detected_ceilings
            if c is not ceiling and abs(c.value - ceiling.value) <= tol and c.attempts > 0
        ]
        
        if similar_ceilings:
            avg_breach_rate = statistics.mean([
                c.calculate_breach_rate() for c in similar_ceilings
            ])
            
            ceiling.strength = self._strength_for_rate(avg_breach_rate)
        else:
            ceiling.strength = CeilingStrength.MODERATE
    
    def _find_nearest_ceiling(self, crash_point: float) -> Optional[CeilingPoint]:
        """Find the nearest ceiling above current crash point."""
        ceilings_above = [
            c for c in self.detected_ceilings 
            if c.value > crash_point
        ]
        
        if not ceilings_above:
            return None
        
        return min(ceilings_above, key=lambda c: c.value - crash_point)
    
    def _calculate_ascend_power(self, crash_point: float, ceiling: CeilingPoint) -> float:
        """Calculate ascend power (0.0 to 1.0)."""
        if len(self.crash_history) < 5:
            return 0.0
        
        recent = [r["crash_point"] for r in list(self.crash_history)[-5:]]
        
        # Calculate momentum
        momentum = (recent[-1] - recent[0]) / recent[0] if recent[0] > 0 else 0
        
        # Calculate proximity to ceiling
        proximity = 1.0 - (ceiling.value - crash_point) / ceiling.value
        
        # Combine momentum and proximity
        ascend_power = (momentum * 0.6) + (proximity * 0.4)
        
        return max(0.0, min(1.0, ascend_power))
    
    def _calculate_ascend_velocity(self, crash_point: float, ceiling: CeilingPoint) -> float:
        """Calculate rate of approach to ceiling."""
        if len(self.crash_history) < 3:
            return 0.0
        
        recent = [r["crash_point"] for r in list(self.crash_history)[-3:]]
        
        # Calculate velocity as change per round
        velocity = (recent[-1] - recent[-2]) if len(recent) >= 2 else 0
        
        return velocity
    
    def _calculate_ascend_acceleration(self) -> float:
        """Calculate change in ascend velocity."""
        if len(self.crash_history) < 4:
            return 0.0
        
        recent = [r["crash_point"] for r in list(self.crash_history)[-4:]]
        
        # Calculate acceleration
        velocities = []
        for i in range(1, len(recent)):
            velocities.append(recent[i] - recent[i-1])
        
        if len(velocities) < 2:
            return 0.0
        
        acceleration = velocities[-1] - velocities[-2]
        
        return acceleration
    
    def _calculate_clearance_percentile(self, crash_point: float, ceiling: float) -> float:
        """Calculate historical percentile of current clearance."""
        if len(self.crash_history) < 10:
            return 0.5
        
        # Calculate historical clearance ratios
        ratios = []
        for r in self.crash_history:
            if r["crash_point"] < ceiling:
                ratios.append(r["crash_point"] / ceiling)
        
        if not ratios:
            return 0.5
        
        current_ratio = crash_point / ceiling
        
        # Calculate percentile
        percentile = sum(1 for r in ratios if r <= current_ratio) / len(ratios)
        
        return percentile
    
    def _determine_ceiling_direction(self) -> CeilingDirection:
        """Determine current ceiling direction."""
        if len(self.detected_ceilings) < 3:
            return CeilingDirection.STABLE
        
        recent_ceilings = self.detected_ceilings[-5:]
        
        # Calculate trend
        values = [c.value for c in recent_ceilings]
        
        if len(values) < 3:
            return CeilingDirection.STABLE
        
        # Calculate linear trend
        x = list(range(len(values)))
        mean_x = statistics.mean(x)
        mean_y = statistics.mean(values)
        
        numerator = sum((xi - mean_x) * (yi - mean_y) for xi, yi in zip(x, values))
        denominator = sum((xi - mean_x) ** 2 for xi in x)
        
        if denominator == 0:
            return CeilingDirection.STABLE
        
        slope = numerator / denominator
        
        # Determine direction based on slope
        if slope > 0.05:
            direction = CeilingDirection.ASCENDING
        elif slope < -0.05:
            direction = CeilingDirection.DESCENDING
        else:
            direction = CeilingDirection.STABLE
        
        # Volatility = scatter around the trend line, relative to the level
        # (a clean ascending ladder is a trend, not volatility)
        intercept = mean_y - slope * mean_x
        resid = [yi - (intercept + slope * xi) for xi, yi in zip(x, values)]
        resid_sd = statistics.pstdev(resid)
        if mean_y > 0 and resid_sd / mean_y > 0.15:
            direction = CeilingDirection.VOLATILE
        
        # Update history
        self.current_ceiling_direction = direction
        self.ceiling_direction_history.append(direction)
        
        if len(self.ceiling_direction_history) > 10:
            self.ceiling_direction_history = self.ceiling_direction_history[-10:]
        
        return direction
    
    def _generate_signals(self, analysis: CeilingAnalysis) -> None:
        """Generate signals based on ceiling analysis."""
        analysis.signal_generated = False
        
        if not analysis.nearest_ceiling:
            return
        
        # Signal 1: Ceiling approach warning
        if analysis.clearance_ratio > 0.9 and analysis.ascend_power > 0.7:
            analysis.signal_generated = True
            analysis.signal_type = "ceiling_approach_warning"
            analysis.signal_confidence = min(1.0, analysis.ascend_power + 0.2)
        
        # Signal 2: Ceiling breach imminent
        elif analysis.clearance_ratio > 0.95 and analysis.ascend_velocity > 0.5:
            analysis.signal_generated = True
            analysis.signal_type = "ceiling_breach_imminent"
            analysis.signal_confidence = 0.9
        
        # Signal 3: Strong ceiling resistance
        elif (analysis.ceiling_strength in [CeilingStrength.STRONG, CeilingStrength.IMPENETRABLE] and
              analysis.clearance_ratio > 0.85):
            analysis.signal_generated = True
            analysis.signal_type = "strong_ceiling_resistance"
            analysis.signal_confidence = 0.8
        
        # Signal 4: Ascending ceiling opportunity
        elif (analysis.ceiling_direction == CeilingDirection.ASCENDING and
              analysis.ascend_power > 0.6):
            analysis.signal_generated = True
            analysis.signal_type = "ascending_ceiling_opportunity"
            analysis.signal_confidence = 0.75
    
    def _get_recent_approaches(self) -> List[float]:
        """Get recent approach distances to ceilings."""
        if len(self.crash_history) < 5:
            return []
        
        approaches = []
        recent_rounds = list(self.crash_history)[-10:]
        
        for round_data in recent_rounds:
            crash_point = round_data["crash_point"]
            nearest = self._find_nearest_ceiling(crash_point)
            
            if nearest:
                approaches.append(nearest.value - crash_point)
        
        return approaches
    
    def get_ceiling_statistics(self) -> Dict[str, Any]:
        """Get overall ceiling statistics."""
        if not self.detected_ceilings:
            return {
                "total_ceilings": 0,
                "average_ceiling": 0.0,
                "strongest_ceiling": None,
                "weakest_ceiling": None,
                "current_direction": CeilingDirection.STABLE.value
            }
        
        values = [c.value for c in self.detected_ceilings]
        
        return {
            "total_ceilings": len(self.detected_ceilings),
            "average_ceiling": statistics.mean(values),
            "highest_ceiling": max(values),
            "lowest_ceiling": min(values),
            "strongest_ceiling": min(
                self.detected_ceilings,
                key=lambda c: c.calculate_breach_rate()
            ).value if self.detected_ceilings else None,
            "weakest_ceiling": max(
                self.detected_ceilings,
                key=lambda c: c.calculate_breach_rate()
            ).value if self.detected_ceilings else None,
            "current_direction": self.current_ceiling_direction.value,
            "direction_history": [d.value for d in self.ceiling_direction_history[-5:]]
        }