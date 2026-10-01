"""
Reverse Linguistic Layers

Extends MomentoLinguistics with layers 9-12 for inverted market analysis.
Provides bottom-up reconstruction, reverse cascade detection, and anti-correlation semantics.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime
import statistics


@dataclass
class ReverseLinguisticObject:
    """
    Reverse linguistic analysis object for crash games.
    
    Contains layers 9-12 for inverted market perspective analysis.
    """
    
    # Original data
    multiplier: float
    timestamp: datetime
    sequence: List[float] = field(default_factory=list)
    
    # Layer 9: Reverse Market Classification
    layer9_reverse_market: str = ""  # inverted crash state classification
    
    # Layer 10: Bottom-up Reconstruction
    layer10_bottom_up: Dict[str, Any] = field(default_factory=dict)
    
    # Layer 11: Reverse Cascade Detection
    layer11_reverse_cascade: Dict[str, Any] = field(default_factory=dict)
    
    # Layer 12: Anti-correlation Semantics
    layer12_anti_correlation: Dict[str, Any] = field(default_factory=dict)
    
    # Composite reverse analysis
    reverse_signature: str = ""  # Overall reverse pattern signature
    reverse_confidence: float = 0.0  # Confidence in reverse analysis
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "multiplier": self.multiplier,
            "timestamp": self.timestamp.isoformat(),
            "layer9_reverse_market": self.layer9_reverse_market,
            "layer10_bottom_up": self.layer10_bottom_up,
            "layer11_reverse_cascade": self.layer11_reverse_cascade,
            "layer12_anti_correlation": self.layer12_anti_correlation,
            "reverse_signature": self.reverse_signature,
            "reverse_confidence": self.reverse_confidence
        }


class ReverseLinguisticsEngine:
    """
    Engine for reverse linguistic analysis (layers 9-12).
    
    Provides inverted market perspective analysis for crash games:
    - Layer 9: Reverse Market Classification
    - Layer 10: Bottom-up Reconstruction  
    - Layer 11: Reverse Cascade Detection
    - Layer 12: Anti-correlation Semantics
    """
    
    def __init__(self):
        """Initialize reverse linguistics engine."""
        # Historical baselines for comparison
        self.history_buffer: List[float] = []
        self.max_history = 200
        
        # Pattern recognition cache
        self.reverse_patterns: Dict[str, int] = {}
    
    def analyze(
        self,
        multiplier: float,
        timestamp: datetime,
        sequence: Optional[List[float]] = None
    ) -> ReverseLinguisticObject:
        """
        Perform reverse linguistic analysis.
        
        Args:
            multiplier: Crash point multiplier
            timestamp: Round timestamp
            sequence: Optional multiplier sequence for advanced analysis
            
        Returns:
            ReverseLinguisticObject with layers 9-12 analysis
        """
        sequence = sequence or []
        
        # Create reverse linguistic object
        reverse_obj = ReverseLinguisticObject(
            multiplier=multiplier,
            timestamp=timestamp,
            sequence=sequence
        )
        
        # Layer 9: Reverse Market Classification
        reverse_obj.layer9_reverse_market = self._classify_reverse_market(multiplier)
        
        # Layer 10: Bottom-up Reconstruction
        reverse_obj.layer10_bottom_up = self._reconstruct_bottom_up(sequence, multiplier)
        
        # Layer 11: Reverse Cascade Detection
        reverse_obj.layer11_reverse_cascade = self._detect_reverse_cascade(sequence)
        
        # Layer 12: Anti-correlation Semantics
        reverse_obj.layer12_anti_correlation = self._analyze_anti_correlation(multiplier)
        
        # Generate composite analysis
        reverse_obj.reverse_signature = self._generate_reverse_signature(reverse_obj)
        reverse_obj.reverse_confidence = self._calculate_reverse_confidence(reverse_obj)
        
        # Update history
        self._update_history(multiplier)
        
        return reverse_obj
    
    def _classify_reverse_market(self, multiplier: float) -> str:
        """
        Layer 9: Reverse Market Classification.
        
        Classifies crash point from inverted perspective:
        - instant_crash: Multiplier <= 1.1 (immediate reversal opportunity)
        - rapid_decline: 1.1 < Multiplier <= 1.5 (fast reversal potential)
        - fast_fall: 1.5 < Multiplier <= 2.0 (strong reversal signal)
        - moderate_descent: 2.0 < Multiplier <= 5.0 (moderate reversal)
        - gradual_decline: 5.0 < Multiplier <= 10.0 (weak reversal)
        - slow_bleed: 10.0 < Multiplier <= 50.0 (extended opportunity)
        - extended_plateau: Multiplier > 50.0 (extreme opportunity)
        """
        if multiplier <= 1.1:
            return "instant_crash"
        elif multiplier <= 1.5:
            return "rapid_decline"
        elif multiplier <= 2.0:
            return "fast_fall"
        elif multiplier <= 5.0:
            return "moderate_descent"
        elif multiplier <= 10.0:
            return "gradual_decline"
        elif multiplier <= 50.0:
            return "slow_bleed"
        else:
            return "extended_plateau"
    
    def _reconstruct_bottom_up(self, sequence: List[float], final_multiplier: float) -> Dict[str, Any]:
        """
        Layer 10: Bottom-up Reconstruction.
        
        Reconstructs the round from bottom-up perspective, identifying
        valleys, recovery potential, and reconstruction patterns.
        """
        if not sequence:
            return {
                "reconstruction_type": "insufficient_data",
                "reconstruction_quality": "none"
            }
        
        # Find valley points (local minima)
        valleys = []
        for i in range(1, len(sequence) - 1):
            if sequence[i] < sequence[i-1] and sequence[i] < sequence[i+1]:
                valleys.append({
                    "index": i,
                    "value": sequence[i],
                    "depth": (sequence[i-1] - sequence[i]) / sequence[i-1] if sequence[i-1] > 0 else 0.0
                })
        
        # Find peak points (local maxima)
        peaks = []
        for i in range(1, len(sequence) - 1):
            if sequence[i] > sequence[i-1] and sequence[i] > sequence[i+1]:
                peaks.append({
                    "index": i,
                    "value": sequence[i],
                    "height": (sequence[i] - sequence[i-1]) / sequence[i-1] if sequence[i-1] > 0 else 0.0
                })
        
        # Calculate recovery potential
        recovery_potential = self._calculate_recovery_potential(sequence)
        
        # Analyze reconstruction pattern
        reconstruction_pattern = self._classify_reconstruction_pattern(valleys, peaks, sequence)
        
        return {
            "reconstruction_type": "valley_based",
            "reconstruction_quality": reconstruction_pattern["quality"],
            "valley_count": len(valleys),
            "peak_count": len(peaks),
            "significant_valleys": [v for v in valleys if v["depth"] > 0.1],
            "significant_peaks": [p for p in peaks if p["height"] > 0.1],
            "lowest_point": min(sequence),
            "highest_point": max(sequence),
            "recovery_potential": recovery_potential,
            "reconstruction_pattern": reconstruction_pattern["pattern"],
            "final_multiplier": final_multiplier
        }
    
    def _calculate_recovery_potential(self, sequence: List[float]) -> float:
        """Calculate recovery potential from sequence."""
        if len(sequence) < 2:
            return 0.0
        
        # Count recoveries (drops followed by rises)
        recoveries = 0
        for i in range(1, len(sequence) - 1):
            if sequence[i] < sequence[i-1] and sequence[i+1] > sequence[i]:
                recoveries += 1
        
        # Normalize to 0-1 range
        recovery_rate = recoveries / len(sequence)
        return min(1.0, recovery_rate * 2)  # Amplify the signal
    
    def _classify_reconstruction_pattern(
        self,
        valleys: List[Dict[str, Any]],
        peaks: List[Dict[str, Any]],
        sequence: List[float]
    ) -> Dict[str, str]:
        """Classify the reconstruction pattern."""
        if not valleys and not peaks:
            return {"quality": "flat", "pattern": "linear"}
        
        if len(valleys) > len(peaks) * 2:
            return {"quality": "valley_dominated", "pattern": "valley_reconstruction"}
        elif len(peaks) > len(valleys) * 2:
            return {"quality": "peak_dominated", "pattern": "peak_reconstruction"}
        elif abs(len(valleys) - len(peaks)) <= 1:
            return {"quality": "balanced", "pattern": "oscillating_reconstruction"}
        else:
            return {"quality": "mixed", "pattern": "complex_reconstruction"}
    
    def _detect_reverse_cascade(self, sequence: List[float]) -> Dict[str, Any]:
        """
        Layer 11: Reverse Cascade Detection.
        
        Detects reverse cascade patterns (high-to-low decline patterns)
        that indicate strong reversal opportunities.
        """
        if len(sequence) < 3:
            return {
                "cascade_detected": False,
                "reason": "insufficient_data"
            }
        
        # Look for high-to-low cascades
        cascades = []
        current_cascade = []
        
        for i in range(len(sequence) - 1):
            # Detect significant drop (5% threshold)
            if sequence[i+1] < sequence[i] * 0.95:
                current_cascade.append(i)
            else:
                if len(current_cascade) >= 3:
                    cascades.append(self._analyze_cascade(sequence, current_cascade))
                current_cascade = []
        
        # Check for final cascade
        if len(current_cascade) >= 3:
            cascades.append(self._analyze_cascade(sequence, current_cascade))
        
        # Classify overall cascade pattern
        cascade_pattern = self._classify_cascade_pattern(cascades, sequence)
        
        return {
            "cascade_detected": len(cascades) > 0,
            "cascade_count": len(cascades),
            "cascades": cascades[:5],  # Top 5 cascades
            "cascade_pattern": cascade_pattern,
            "overall_cascade_strength": self._calculate_cascade_strength(cascades)
        }
    
    def _analyze_cascade(self, sequence: List[float], cascade_indices: List[int]) -> Dict[str, Any]:
        """Analyze a single cascade."""
        if not cascade_indices:
            return {}
        
        start_idx = cascade_indices[0]
        end_idx = cascade_indices[-1]
        
        start_val = sequence[start_idx]
        end_val = sequence[end_idx]
        drop_percentage = (start_val - end_val) / start_val if start_val > 0 else 0.0
        
        # Calculate cascade severity
        if drop_percentage > 0.5:
            severity = "severe"
        elif drop_percentage > 0.3:
            severity = "moderate"
        elif drop_percentage > 0.1:
            severity = "mild"
        else:
            severity = "minimal"
        
        return {
            "start_index": start_idx,
            "end_index": end_idx,
            "length": len(cascade_indices),
            "start_value": start_val,
            "end_value": end_val,
            "drop_percentage": drop_percentage,
            "severity": severity,
            "indices": cascade_indices
        }
    
    def _classify_cascade_pattern(self, cascades: List[Dict[str, Any]], sequence: List[float]) -> str:
        """Classify the overall cascade pattern."""
        if not cascades:
            return "no_cascade"
        
        if len(cascades) >= 3:
            return "multi_cascade"
        elif len(cascades) == 2:
            return "double_cascade"
        else:
            return "single_cascade"
    
    def _calculate_cascade_strength(self, cascades: List[Dict[str, Any]]) -> float:
        """Calculate overall cascade strength."""
        if not cascades:
            return 0.0
        
        total_drop = sum(c.get("drop_percentage", 0) for c in cascades)
        avg_drop = total_drop / len(cascades)
        
        return min(1.0, avg_drop)
    
    def _analyze_anti_correlation(self, multiplier: float) -> Dict[str, Any]:
        """
        Layer 12: Anti-correlation Semantics.
        
        Analyzes anti-correlation patterns with historical data to identify
        inverse relationship signals.
        """
        if len(self.history_buffer) < 10:
            return {
                "anti_correlation": "insufficient_history",
                "confidence": 0.0
            }
        
        recent_history = self.history_buffer[-20:]
        recent_history.append(multiplier)
        
        # Calculate statistical measures
        avg_crash = statistics.mean(recent_history)
        median_crash = statistics.median(recent_history)
        std_dev = statistics.stdev(recent_history) if len(recent_history) > 1 else 0.0
        
        # Calculate z-score (how unusual is current multiplier)
        z_score = (multiplier - avg_crash) / std_dev if std_dev > 0 else 0.0
        
        # Calculate anti-correlation score
        anti_correlation_score = 0.0
        correlation_type = "normal"
        
        if abs(z_score) > 2.0:
            # Very unusual - strong anti-correlation signal
            anti_correlation_score = 0.9
            correlation_type = "extreme_outlier"
        elif abs(z_score) > 1.5:
            # Unusual - moderate anti-correlation signal
            anti_correlation_score = 0.7
            correlation_type = "outlier"
        elif abs(z_score) > 1.0:
            # Somewhat unusual - weak anti-correlation signal
            anti_correlation_score = 0.5
            correlation_type = "deviation"
        else:
            # Normal - no anti-correlation signal
            anti_correlation_score = 0.1
            correlation_type = "normal"
        
        # Calculate directional anti-correlation
        if multiplier > avg_crash * 2:
            directional_signal = "strong_high_anti_correlation"
        elif multiplier > avg_crash * 1.5:
            directional_signal = "moderate_high_anti_correlation"
        elif multiplier < avg_crash * 0.5:
            directional_signal = "strong_low_anti_correlation"
        elif multiplier < avg_crash * 0.75:
            directional_signal = "moderate_low_anti_correlation"
        else:
            directional_signal = "no_directional_signal"
        
        return {
            "anti_correlation_score": anti_correlation_score,
            "correlation_type": correlation_type,
            "directional_signal": directional_signal,
            "z_score": z_score,
            "deviation_from_mean": (multiplier - avg_crash) / avg_crash if avg_crash > 0 else 0.0,
            "historical_mean": avg_crash,
            "historical_median": median_crash,
            "historical_std_dev": std_dev,
            "confidence": anti_correlation_score
        }
    
    def _generate_reverse_signature(self, reverse_obj: ReverseLinguisticObject) -> str:
        """Generate composite reverse pattern signature."""
        components = []
        
        # Add reverse market classification
        components.append(f"RM:{reverse_obj.layer9_reverse_market}")
        
        # Add reconstruction pattern
        if reverse_obj.layer10_bottom_up:
            pattern = reverse_obj.layer10_bottom_up.get("reconstruction_pattern", "unknown")
            components.append(f"RP:{pattern}")
        
        # Add cascade pattern
        if reverse_obj.layer11_reverse_cascade:
            cascade_pattern = reverse_obj.layer11_reverse_cascade.get("cascade_pattern", "no_cascade")
            components.append(f"CP:{cascade_pattern}")
        
        # Add anti-correlation type
        if reverse_obj.layer12_anti_correlation:
            corr_type = reverse_obj.layer12_anti_correlation.get("correlation_type", "normal")
            components.append(f"AC:{corr_type}")
        
        return "|".join(components)
    
    def _calculate_reverse_confidence(self, reverse_obj: ReverseLinguisticObject) -> float:
        """Calculate confidence in reverse analysis."""
        confidence_factors = []
        
        # Confidence from anti-correlation analysis
        if reverse_obj.layer12_anti_correlation:
            ac_confidence = reverse_obj.layer12_anti_correlation.get("confidence", 0.0)
            confidence_factors.append(ac_confidence)
        
        # Confidence from cascade detection
        if reverse_obj.layer11_reverse_cascade:
            cascade_strength = reverse_obj.layer11_reverse_cascade.get("overall_cascade_strength", 0.0)
            confidence_factors.append(cascade_strength)
        
        # Confidence from reconstruction quality
        if reverse_obj.layer10_bottom_up:
            recovery_potential = reverse_obj.layer10_bottom_up.get("recovery_potential", 0.0)
            confidence_factors.append(recovery_potential)
        
        if not confidence_factors:
            return 0.5
        
        return statistics.mean(confidence_factors)
    
    def _update_history(self, multiplier: float) -> None:
        """Update history buffer with new multiplier."""
        self.history_buffer.append(multiplier)
        if len(self.history_buffer) > self.max_history:
            self.history_buffer = self.history_buffer[-self.max_history:]
    
    def get_reverse_pattern_frequency(self) -> Dict[str, int]:
        """Get frequency of reverse patterns in history."""
        return self.reverse_patterns.copy()
    
    def reset_history(self) -> None:
        """Reset history buffer."""
        self.history_buffer = []
        self.reverse_patterns = {}