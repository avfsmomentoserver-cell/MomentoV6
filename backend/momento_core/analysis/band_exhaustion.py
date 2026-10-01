"""
Band Exhaustion Analysis Module

Extends exhaustion logic to all multiplier bands with configurable thresholds.
Detects statistical saturation that triggers regime shifts and generates cluster signals.
"""

from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from collections import deque
import statistics
from datetime import datetime
import uuid


@dataclass
class BandExhaustionEvent:
    """Represents a band exhaustion event."""
    
    event_id: str
    timestamp: datetime
    band: str
    exhaustion_level: float  # 0.0 to 1.0
    window_percentage: float  # Percentage of rounds in this band
    threshold: float
    severity: str  # "mild", "moderate", "severe", "extreme"
    
    # Look-ahead analysis
    dominant_response_band: Optional[str] = None
    response_confidence: float = 0.0
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "event_id": self.event_id,
            "timestamp": self.timestamp.isoformat(),
            "band": self.band,
            "exhaustion_level": self.exhaustion_level,
            "window_percentage": self.window_percentage,
            "threshold": self.threshold,
            "severity": self.severity,
            "dominant_response_band": self.dominant_response_band,
            "response_confidence": self.response_confidence
        }


@dataclass
class NormalizationEvent:
    """Represents a band normalization event."""
    
    event_id: str
    timestamp: datetime
    band: str
    duration_seconds: float
    previous_severity: str
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "event_id": self.event_id,
            "timestamp": self.timestamp.isoformat(),
            "band": self.band,
            "duration_seconds": self.duration_seconds,
            "previous_severity": self.previous_severity
        }


@dataclass
class ClusterSignal:
    """Represents a trading signal based on cluster analysis."""
    
    signal_id: str
    timestamp: datetime
    signal_type: str  # "buy", "sell", "hold"
    target_band: str
    confidence: float
    pressure: float  # 0.0 to 1.0
    reasoning: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "signal_id": self.signal_id,
            "timestamp": self.timestamp.isoformat(),
            "signal_type": self.signal_type,
            "target_band": self.target_band,
            "confidence": self.confidence,
            "pressure": self.pressure,
            "reasoning": self.reasoning
        }


class BandExhaustionAnalyzer:
    """
    Analyzes band exhaustion across all multiplier bands.
    
    Features:
    - Rolling window analysis for all 8 bands
    - Configurable thresholds per band
    - Real-time regime classification
    - Cluster signal generation
    - Normalization detection
    """
    
    def __init__(self, window_size: int = 500):
        """
        Initialize band exhaustion analyzer.
        
        Args:
            window_size: Size of rolling window for analysis (default: 500)
        """
        self.window_size = window_size
        self.round_history: deque = deque(maxlen=window_size * 2)  # Keep extra for look-ahead
        
        # Band definitions
        self.bands = {
            "very_low": (1.0, 1.5),
            "low": (1.5, 2.0),
            "medium_low": (2.0, 3.0),
            "medium": (3.0, 5.0),
            "medium_high": (5.0, 10.0),
            "high": (10.0, 20.0),
            "very_high": (20.0, 50.0),
            "extreme": (50.0, float('inf'))
        }
        
        # Exhaustion thresholds (based on 50% equilibrium)
        self.thresholds = {
            "very_low": 0.54,
            "low": 0.54,
            "medium_low": 0.52,
            "medium": 0.50,
            "medium_high": 0.48,
            "high": 0.46,
            "very_high": 0.44,
            "extreme": 0.40
        }
        
        # Equilibrium rates (50% baseline)
        self.equilibrium_rates = {band: 0.50 for band in self.bands}
        
        # Normalization range (±5% of equilibrium)
        self.normalization_range = 0.05
        
        # Event tracking
        self.exhaustion_events: List[BandExhaustionEvent] = []
        self.normalization_events: List[NormalizationEvent] = []
        self.cluster_signals: List[ClusterSignal] = []
        
        # Current state
        self.current_exhaustion: Dict[str, Optional[BandExhaustionEvent]] = {
            band: None for band in self.bands
        }
        self.exhaustion_start_times: Dict[str, Optional[datetime]] = {
            band: None for band in self.bands
        }
        
        # Regime classification
        self.current_regime = "NORMAL"
        self.regime_history: List[Tuple[datetime, str]] = []
    
    def analyze_round(self, multiplier: float, timestamp: datetime) -> Dict[str, Any]:
        """
        Analyze a round for band exhaustion.
        
        Args:
            multiplier: Round multiplier value
            timestamp: Round timestamp
            
        Returns:
            Analysis results with exhaustion status and signals
        """
        # Add to history
        self.round_history.append({"multiplier": multiplier, "timestamp": timestamp})
        
        # Calculate band distribution in window
        band_distribution = self._calculate_band_distribution()
        
        # Check for exhaustion
        new_exhaustions = self._detect_exhaustion(band_distribution, timestamp)
        
        # Check for normalization
        new_normalizations = self._detect_normalization(band_distribution, timestamp)
        
        # Update regime
        self._update_regime(band_distribution)
        
        # Generate cluster signals
        new_signals = self._generate_cluster_signals(band_distribution, timestamp)
        
        # Return analysis results
        return {
            "band_distribution": band_distribution,
            "new_exhaustions": [e.to_dict() for e in new_exhaustions],
            "new_normalizations": [n.to_dict() for n in new_normalizations],
            "new_signals": [s.to_dict() for s in new_signals],
            "current_regime": self.current_regime,
            "exhausted_bands": [band for band, event in self.current_exhaustion.items() if event is not None]
        }
    
    def _calculate_band_distribution(self) -> Dict[str, float]:
        """Calculate percentage distribution of bands in current window."""
        if len(self.round_history) < self.window_size:
            window = list(self.round_history)
        else:
            window = list(self.round_history)[-self.window_size:]
        
        if not window:
            return {band: 0.0 for band in self.bands}
        
        # Count rounds in each band
        band_counts = {band: 0 for band in self.bands}
        for round_data in window:
            multiplier = round_data["multiplier"]
            for band, (min_val, max_val) in self.bands.items():
                if min_val <= multiplier < max_val:
                    band_counts[band] += 1
                    break
        
        # Calculate percentages
        total = len(window)
        distribution = {
            band: (count / total) if total > 0 else 0.0
            for band, count in band_counts.items()
        }
        
        return distribution
    
    def _detect_exhaustion(
        self,
        distribution: Dict[str, float],
        timestamp: datetime
    ) -> List[BandExhaustionEvent]:
        """Detect band exhaustion events."""
        new_events = []
        
        for band, percentage in distribution.items():
            threshold = self.thresholds[band]
            
            # Check if band exceeds threshold
            if percentage >= threshold:
                # Calculate exhaustion level
                deviation = percentage - threshold
                max_deviation = 1.0 - threshold
                exhaustion_level = min(1.0, deviation / max_deviation) if max_deviation > 0 else 1.0
                
                # Determine severity
                if exhaustion_level >= 0.8:
                    severity = "extreme"
                elif exhaustion_level >= 0.6:
                    severity = "severe"
                elif exhaustion_level >= 0.4:
                    severity = "moderate"
                else:
                    severity = "mild"
                
                # Check if this is a new exhaustion (not already exhausted)
                if self.current_exhaustion[band] is None:
                    event = BandExhaustionEvent(
                        event_id=str(uuid.uuid4()),
                        timestamp=timestamp,
                        band=band,
                        exhaustion_level=exhaustion_level,
                        window_percentage=percentage,
                        threshold=threshold,
                        severity=severity
                    )
                    
                    # Analyze look-ahead response
                    dominant_response = self._analyze_dominant_response(band)
                    event.dominant_response_band = dominant_response
                    event.response_confidence = 0.7  # Placeholder
                    
                    self.current_exhaustion[band] = event
                    self.exhaustion_start_times[band] = timestamp
                    self.exhaustion_events.append(event)
                    new_events.append(event)
                else:
                    # Update existing exhaustion
                    self.current_exhaustion[band].exhaustion_level = exhaustion_level
                    self.current_exhaustion[band].window_percentage = percentage
                    self.current_exhaustion[band].severity = severity
        
        return new_events
    
    def _detect_normalization(
        self,
        distribution: Dict[str, float],
        timestamp: datetime
    ) -> List[NormalizationEvent]:
        """Detect band normalization events."""
        new_events = []
        
        for band, percentage in distribution.items():
            equilibrium = self.equilibrium_rates[band]
            normal_min = equilibrium - self.normalization_range
            normal_max = equilibrium + self.normalization_range
            
            # Check if band is in normal range and was previously exhausted
            if normal_min <= percentage <= normal_max:
                if self.current_exhaustion[band] is not None:
                    # Calculate duration
                    start_time = self.exhaustion_start_times[band]
                    duration = (timestamp - start_time).total_seconds()
                    
                    event = NormalizationEvent(
                        event_id=str(uuid.uuid4()),
                        timestamp=timestamp,
                        band=band,
                        duration_seconds=duration,
                        previous_severity=self.current_exhaustion[band].severity
                    )
                    
                    self.normalization_events.append(event)
                    new_events.append(event)
                    
                    # Clear exhaustion state
                    self.current_exhaustion[band] = None
                    self.exhaustion_start_times[band] = None
        
        return new_events
    
    def _analyze_dominant_response(self, exhausted_band: str) -> Optional[str]:
        """Analyze dominant response band after exhaustion."""
        if len(self.round_history) < self.window_size + 100:
            return None
        
        # Get look-ahead window (next 100 rounds after exhaustion point)
        window = list(self.round_history)
        exhaustion_index = len(window) - self.window_size
        look_ahead = window[exhaustion_index:exhaustion_index + 100]
        
        if not look_ahead:
            return None
        
        # Count bands in look-ahead
        band_counts = {band: 0 for band in self.bands}
        for round_data in look_ahead:
            multiplier = round_data["multiplier"]
            for band, (min_val, max_val) in self.bands.items():
                if min_val <= multiplier < max_val:
                    band_counts[band] += 1
                    break
        
        # Find dominant band
        dominant_band = max(band_counts, key=band_counts.get)
        if band_counts[dominant_band] > 0:
            return dominant_band
        
        return None
    
    def _update_regime(self, distribution: Dict[str, float]) -> None:
        """Update market regime based on band distribution."""
        exhausted_bands = [
            band for band, event in self.current_exhaustion.items()
            if event is not None
        ]
        
        if not exhausted_bands:
            new_regime = "NORMAL"
        elif "very_low" in exhausted_bands or "low" in exhausted_bands:
            new_regime = "LOW_BAND_EXHAUSTION"
        elif "medium_low" in exhausted_bands or "medium" in exhausted_bands:
            new_regime = "MIDDLE_BAND_EXHAUSTION"
        elif "medium_high" in exhausted_bands or "high" in exhausted_bands:
            new_regime = "HIGH_BAND_EXHAUSTION"
        else:
            new_regime = "EXTREME_BAND_EXHAUSTION"
        
        if new_regime != self.current_regime:
            self.regime_history.append((datetime.now(), new_regime))
            self.current_regime = new_regime
    
    def _generate_cluster_signals(
        self,
        distribution: Dict[str, float],
        timestamp: datetime
    ) -> List[ClusterSignal]:
        """Generate cluster signals based on exhaustion analysis."""
        signals = []
        
        exhausted_bands = [
            band for band, event in self.current_exhaustion.items()
            if event is not None and event.exhaustion_level >= 0.6
        ]
        
        for band in exhausted_bands:
            event = self.current_exhaustion[band]
            
            # Generate signal based on exhaustion
            if event.dominant_response_band:
                signal = ClusterSignal(
                    signal_id=str(uuid.uuid4()),
                    timestamp=timestamp,
                    signal_type="buy",  # Simplified - would need more logic
                    target_band=event.dominant_response_band,
                    confidence=event.response_confidence,
                    pressure=event.exhaustion_level,
                    reasoning=[
                        f"{band} band exhausted at {event.window_percentage:.1%}",
                        f"Severity: {event.severity}",
                        f"Historical response: {event.dominant_response_band}"
                    ]
                )
                signals.append(signal)
        
        return signals
    
    def get_exhaustion_summary(self) -> Dict[str, Any]:
        """Get summary of current exhaustion state."""
        return {
            "current_regime": self.current_regime,
            "exhausted_bands": {
                band: event.to_dict() if event else None
                for band, event in self.current_exhaustion.items()
            },
            "total_exhaustion_events": len(self.exhaustion_events),
            "total_normalization_events": len(self.normalization_events),
            "total_cluster_signals": len(self.cluster_signals),
            "regime_history": [(ts.isoformat(), regime) for ts, regime in self.regime_history[-10:]]
        }
