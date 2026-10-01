"""
House Edge Calculation Module

Computes house edge statistics for different multiplier bands based on
the specifications in band_exhaustion_normalization.md.

Key Concepts:
- House edge baseline: ~50% for -2x outcomes in normal conditions
- Band exhaustion: When bands exceed 54% over 500-round sessions
- Different thresholds for different bands
"""

from typing import List, Dict, Optional
from dataclasses import dataclass
from enum import Enum


class Band(Enum):
    """Statistical bands for multiplier classification."""
    VERY_LOW = "very_low"      # 1.0 - 1.5x
    LOW = "low"                # 1.5 - 2.0x
    MEDIUM_LOW = "medium_low"  # 2.0 - 3.0x
    MEDIUM_HIGH = "medium_high"# 3.0 - 5.0x
    HIGH = "high"              # 5.0 - 10.0x
    VERY_HIGH = "very_high"    # 10.0 - 20.0x
    EXTREME = "extreme"        # 20.0x+


@dataclass
class HouseEdgeMetrics:
    """House edge metrics for a specific band."""
    band: str
    occurrence_rate: float
    expected_rate: float
    deviation: float
    is_exhausted: bool
    exhaustion_threshold: float
    severity: float = 0.0


@dataclass
class Round:
    """Round data for house edge calculation."""
    multiplier: float
    timestamp: Optional[str] = None


class HouseEdgeCalculator:
    """Calculator for house edge statistics and band exhaustion detection."""
    
    def __init__(self, window_size: int = 500):
        """
        Initialize house edge calculator.
        
        Args:
            window_size: Rolling window size for session analysis (default: 500)
        """
        self.window_size = window_size
        self.exhaustion_thresholds = {
            Band.VERY_LOW.value: 54.0,
            Band.LOW.value: 54.0,
            Band.MEDIUM_LOW.value: 52.0,
            Band.MEDIUM_HIGH.value: 48.0,
            Band.HIGH.value: 46.0,
            Band.VERY_HIGH.value: 44.0,
            Band.EXTREME.value: 40.0
        }
        self.expected_rates = {
            Band.VERY_LOW.value: 50.0,
            Band.LOW.value: 50.0,
            Band.MEDIUM_LOW.value: 50.0,
            Band.MEDIUM_HIGH.value: 50.0,
            Band.HIGH.value: 50.0,
            Band.VERY_HIGH.value: 50.0,
            Band.EXTREME.value: 50.0
        }
    
    def classify_band(self, multiplier: float) -> str:
        """
        Classify multiplier into statistical bands.
        
        Args:
            multiplier: Round multiplier value
            
        Returns:
            Band classification string
        """
        if multiplier < 1.0:
            return 'invalid'
        elif 1.0 <= multiplier < 1.5:
            return Band.VERY_LOW.value
        elif 1.5 <= multiplier < 2.0:
            return Band.LOW.value
        elif 2.0 <= multiplier < 3.0:
            return Band.MEDIUM_LOW.value
        elif 3.0 <= multiplier < 5.0:
            return Band.MEDIUM_HIGH.value
        elif 5.0 <= multiplier < 10.0:
            return Band.HIGH.value
        elif 10.0 <= multiplier < 20.0:
            return Band.VERY_HIGH.value
        else:
            return Band.EXTREME.value
    
    def compute_house_edge(
        self, 
        rounds: List[Round], 
        target_band: Optional[str] = None
    ) -> Dict[str, HouseEdgeMetrics]:
        """
        Compute house edge statistics for all or specific bands.
        
        Args:
            rounds: List of round data
            target_band: Optional specific band to analyze (if None, analyzes all)
            
        Returns:
            Dictionary mapping band names to HouseEdgeMetrics
        """
        if not rounds:
            return {}
        
        bands_to_analyze = [target_band] if target_band else [
            band.value for band in Band
        ]
        
        results = {}
        
        for band in bands_to_analyze:
            if band not in self.exhaustion_thresholds:
                continue
                
            metrics = self._compute_band_metrics(rounds, band)
            results[band] = metrics
        
        return results
    
    def _compute_band_metrics(self, rounds: List[Round], band: str) -> HouseEdgeMetrics:
        """
        Compute metrics for a specific band.
        
        Args:
            rounds: List of round data
            band: Band to analyze
            
        Returns:
            HouseEdgeMetrics for the band
        """
        # Filter rounds in target band
        target_rounds = [r for r in rounds if self.classify_band(r.multiplier) == band]
        
        if not target_rounds:
            return HouseEdgeMetrics(
                band=band,
                occurrence_rate=0.0,
                expected_rate=self.expected_rates.get(band, 50.0),
                deviation=-self.expected_rates.get(band, 50.0),
                is_exhausted=False,
                exhaustion_threshold=self.exhaustion_thresholds.get(band, 50.0)
            )
        
        # Calculate occurrence rate
        total_rounds = len(rounds)
        occurrence_rate = (len(target_rounds) / total_rounds) * 100
        
        # Get expected rate for this band
        expected_rate = self.expected_rates.get(band, 50.0)
        
        # Calculate deviation
        deviation = occurrence_rate - expected_rate
        
        # Get exhaustion threshold
        exhaustion_threshold = self.exhaustion_thresholds.get(band, 50.0)
        
        # Determine exhaustion
        is_exhausted = occurrence_rate > exhaustion_threshold
        
        # Calculate severity (0.0 to 1.0)
        if is_exhausted:
            max_deviation = 20.0  # 20% above threshold is extreme
            severity = min((occurrence_rate - exhaustion_threshold) / max_deviation, 1.0)
        else:
            severity = 0.0
        
        return HouseEdgeMetrics(
            band=band,
            occurrence_rate=occurrence_rate,
            expected_rate=expected_rate,
            deviation=deviation,
            is_exhausted=is_exhausted,
            exhaustion_threshold=exhaustion_threshold,
            severity=severity
        )
    
    def detect_exhaustion_events(self, rounds: List[Round]) -> List[Dict]:
        """
        Detect band exhaustion events across the session.
        
        Args:
            rounds: List of round data
            
        Returns:
            List of exhaustion event dictionaries
        """
        if len(rounds) < self.window_size:
            return []
        
        events = []
        
        # Analyze rolling windows
        for i in range(self.window_size, len(rounds) + 1):
            window = rounds[i - self.window_size:i]
            
            # Compute house edge for this window
            metrics = self.compute_house_edge(window)
            
            # Check for exhaustion in any band
            for band, metric in metrics.items():
                if metric.is_exhausted:
                    events.append({
                        'exhausted_band': band,
                        'exhaustion_percentage': metric.occurrence_rate,
                        'threshold': metric.exhaustion_threshold,
                        'window_start': i - self.window_size,
                        'window_end': i,
                        'severity': metric.severity,
                        'deviation': metric.deviation
                    })
        
        return events
    
    def get_overall_house_edge(self, rounds: List[Round]) -> Dict:
        """
        Get overall house edge summary for the session.
        
        Args:
            rounds: List of round data
            
        Returns:
            Dictionary with overall house edge statistics
        """
        if not rounds:
            return {
                'total_rounds': 0,
                'overall_house_edge': 0.0,
                'exhausted_bands': [],
                'band_metrics': {}
            }
        
        # Compute metrics for all bands
        band_metrics = self.compute_house_edge(rounds)
        
        # Calculate overall house edge (weighted average)
        total_weight = 0
        weighted_edge = 0.0
        
        for band, metric in band_metrics.items():
            weight = len([r for r in rounds if self.classify_band(r.multiplier) == band])
            total_weight += weight
            weighted_edge += metric.occurrence_rate * weight
        
        overall_house_edge = weighted_edge / total_weight if total_weight > 0 else 0.0
        
        # Identify exhausted bands
        exhausted_bands = [
            band for band, metric in band_metrics.items() 
            if metric.is_exhausted
        ]
        
        return {
            'total_rounds': len(rounds),
            'overall_house_edge': overall_house_edge,
            'exhausted_bands': exhausted_bands,
            'band_metrics': {
                band: {
                    'occurrence_rate': metric.occurrence_rate,
                    'expected_rate': metric.expected_rate,
                    'deviation': metric.deviation,
                    'is_exhausted': metric.is_exhausted,
                    'severity': metric.severity
                }
                for band, metric in band_metrics.items()
            }
        }
