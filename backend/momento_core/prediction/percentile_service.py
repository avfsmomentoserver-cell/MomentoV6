"""
Robust Percentile Service

Provides percentile-based analysis with small sample bias correction,
regime-aware calculations, and snapshot management for the forecast engine.
"""

from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from collections import deque
from datetime import datetime
import statistics
import numpy as np


@dataclass
class PercentileSnapshot:
    """Snapshot of percentile distribution at a point in time."""
    
    snapshot_id: str
    timestamp: datetime
    sample_size: int
    
    # Percentile values
    p5: float
    p10: float
    p25: float
    p50: float
    p75: float
    p90: float
    p95: float
    p99: float
    
    # Statistics
    mean: float
    std: float
    min: float
    max: float
    
    # Regime context
    regime: str
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "snapshot_id": self.snapshot_id,
            "timestamp": self.timestamp.isoformat(),
            "sample_size": self.sample_size,
            "p5": self.p5,
            "p10": self.p10,
            "p25": self.p25,
            "p50": self.p50,
            "p75": self.p75,
            "p90": self.p90,
            "p95": self.p95,
            "p99": self.p99,
            "mean": self.mean,
            "std": self.std,
            "min": self.min,
            "max": self.max,
            "regime": self.regime
        }


@dataclass
class PercentileAnalysis:
    """Analysis result for a value against percentile distribution."""
    
    value: float
    percentile: float
    percentile_rank: str  # "very_low", "low", "medium", "high", "very_high"
    
    # Context
    sample_size: int
    regime: str
    
    # Bias correction
    bias_corrected: bool
    correction_factor: float
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "value": self.value,
            "percentile": self.percentile,
            "percentile_rank": self.percentile_rank,
            "sample_size": self.sample_size,
            "regime": self.regime,
            "bias_corrected": self.bias_corrected,
            "correction_factor": self.correction_factor
        }


class PercentileService:
    """
    Robust percentile service with small sample bias correction.
    
    Features:
    - Small sample bias correction using bootstrapping
    - Regime-aware percentile calculations
    - Snapshot management for historical comparison
    - Rolling window analysis
    """
    
    def __init__(self, window_size: int = 1000, min_sample_size: int = 50):
        """
        Initialize percentile service.
        
        Args:
            window_size: Size of rolling window for analysis
            min_sample_size: Minimum sample size for reliable percentiles
        """
        self.window_size = window_size
        self.min_sample_size = min_sample_size
        
        # Data storage
        self.value_history: deque = deque(maxlen=window_size)
        self.timestamp_history: deque = deque(maxlen=window_size)
        
        # Snapshots
        self.snapshots: List[PercentileSnapshot] = []
        self.snapshot_interval = 100  # Create snapshot every 100 rounds
        self.round_count = 0
        
        # Current regime
        self.current_regime = "NORMAL"
        
        # Bootstrap parameters
        self.bootstrap_iterations = 1000
        self.bootstrap_sample_size = 100
    
    def add_value(self, value: float, timestamp: datetime, regime: str = "NORMAL") -> None:
        """
        Add a value to the history.
        
        Args:
            value: Value to add
            timestamp: Timestamp of the value
            regime: Current market regime
        """
        self.value_history.append(value)
        self.timestamp_history.append(timestamp)
        self.current_regime = regime
        self.round_count += 1
        
        # Create snapshot at intervals
        if self.round_count % self.snapshot_interval == 0:
            self._create_snapshot()
    
    def calculate_percentile(
        self,
        value: float,
        regime: Optional[str] = None,
        use_bias_correction: bool = True
    ) -> Optional[PercentileAnalysis]:
        """
        Calculate percentile rank for a value.
        
        Args:
            value: Value to analyze
            regime: Regime to use for calculation (default: current)
            use_bias_correction: Whether to apply small sample bias correction
            
        Returns:
            PercentileAnalysis or None if insufficient data
        """
        if len(self.value_history) < self.min_sample_size:
            return None
        
        target_regime = regime or self.current_regime
        
        # Get values for the specified regime
        if regime is not None:
            values = self._get_regime_values(regime)
            if len(values) < self.min_sample_size:
                # Fall back to all values
                values = list(self.value_history)
        else:
            values = list(self.value_history)
        
        if len(values) < self.min_sample_size:
            return None
        
        # Calculate percentile
        if use_bias_correction and len(values) < 200:
            percentile = self._calculate_bootstrap_percentile(value, values)
            bias_corrected = True
            correction_factor = self._calculate_correction_factor(len(values))
        else:
            percentile = self._calculate_standard_percentile(value, values)
            bias_corrected = False
            correction_factor = 1.0
        
        # Determine rank
        percentile_rank = self._get_percentile_rank(percentile)
        
        return PercentileAnalysis(
            value=value,
            percentile=percentile,
            percentile_rank=percentile_rank,
            sample_size=len(values),
            regime=target_regime,
            bias_corrected=bias_corrected,
            correction_factor=correction_factor
        )
    
    def get_current_percentiles(self) -> Optional[PercentileSnapshot]:
        """
        Get current percentile distribution.
        
        Returns:
            PercentileSnapshot or None if insufficient data
        """
        if len(self.value_history) < self.min_sample_size:
            return None
        
        values = list(self.value_history)
        
        # Calculate percentiles
        p5 = np.percentile(values, 5)
        p10 = np.percentile(values, 10)
        p25 = np.percentile(values, 25)
        p50 = np.percentile(values, 50)
        p75 = np.percentile(values, 75)
        p90 = np.percentile(values, 90)
        p95 = np.percentile(values, 95)
        p99 = np.percentile(values, 99)
        
        # Calculate statistics
        mean = statistics.mean(values)
        std = statistics.stdev(values) if len(values) > 1 else 0.0
        min_val = min(values)
        max_val = max(values)
        
        return PercentileSnapshot(
            snapshot_id=str(len(self.snapshots)),
            timestamp=datetime.now(),
            sample_size=len(values),
            p5=p5,
            p10=p10,
            p25=p25,
            p50=p50,
            p75=p75,
            p90=p90,
            p95=p95,
            p99=p99,
            mean=mean,
            std=std,
            min=min_val,
            max=max_val,
            regime=self.current_regime
        )
    
    def _calculate_standard_percentile(self, value: float, values: List[float]) -> float:
        """Calculate standard percentile using numpy."""
        return np.percentile(values, np.searchsorted(np.sort(values), value) / len(values) * 100)
    
    def _calculate_bootstrap_percentile(self, value: float, values: List[float]) -> float:
        """
        Calculate percentile using bootstrapping for small sample bias correction.
        
        Bootstrapping helps reduce bias in percentile estimates for small samples.
        """
        percentiles = []
        
        for _ in range(self.bootstrap_iterations):
            # Resample with replacement
            bootstrap_sample = np.random.choice(values, size=min(self.bootstrap_sample_size, len(values)), replace=True)
            
            # Calculate percentile for this sample
            percentile = self._calculate_standard_percentile(value, bootstrap_sample.tolist())
            percentiles.append(percentile)
        
        # Return median of bootstrap percentiles
        return statistics.median(percentiles)
    
    def _calculate_correction_factor(self, sample_size: int) -> float:
        """
        Calculate correction factor based on sample size.
        
        Smaller samples get larger correction factors.
        """
        if sample_size >= 200:
            return 1.0
        elif sample_size >= 100:
            return 1.05
        elif sample_size >= 50:
            return 1.1
        else:
            return 1.2
    
    def _get_percentile_rank(self, percentile: float) -> str:
        """Convert percentile to rank category."""
        if percentile < 10:
            return "very_low"
        elif percentile < 25:
            return "low"
        elif percentile < 75:
            return "medium"
        elif percentile < 90:
            return "high"
        else:
            return "very_high"
    
    def _get_regime_values(self, regime: str) -> List[float]:
        """Get values for a specific regime from snapshots."""
        regime_values = []
        
        for snapshot in self.snapshots:
            if snapshot.regime == regime:
                # Use snapshot percentiles to estimate distribution
                # This is a simplified approach - in production, you'd store actual values per regime
                pass
        
        # For now, return all values (regime-specific filtering would require more complex storage)
        return list(self.value_history)
    
    def _create_snapshot(self) -> None:
        """Create a percentile snapshot."""
        snapshot = self.get_current_percentiles()
        if snapshot:
            self.snapshots.append(snapshot)
            
            # Keep only recent snapshots
            if len(self.snapshots) > 100:
                self.snapshots = self.snapshots[-100:]
    
    def get_percentile_change(
        self,
        value: float,
        snapshot_id: int
    ) -> Optional[Dict[str, Any]]:
        """
        Calculate how percentile rank has changed since a snapshot.
        
        Args:
            value: Value to analyze
            snapshot_id: ID of snapshot to compare against
            
        Returns:
            Dictionary with change information or None
        """
        if snapshot_id >= len(self.snapshots):
            return None
        
        old_snapshot = self.snapshots[snapshot_id]
        current_analysis = self.calculate_percentile(value)
        
        if not current_analysis:
            return None
        
        # Estimate old percentile from snapshot
        old_percentile = self._estimate_percentile_from_snapshot(value, old_snapshot)
        
        return {
            "value": value,
            "old_percentile": old_percentile,
            "current_percentile": current_analysis.percentile,
            "change": current_analysis.percentile - old_percentile,
            "snapshot_id": snapshot_id,
            "snapshot_timestamp": old_snapshot.timestamp.isoformat()
        }
    
    def _estimate_percentile_from_snapshot(self, value: float, snapshot: PercentileSnapshot) -> float:
        """Estimate percentile from snapshot percentiles."""
        percentiles = [5, 10, 25, 50, 75, 90, 95, 99]
        values = [snapshot.p5, snapshot.p10, snapshot.p25, snapshot.p50,
                 snapshot.p75, snapshot.p90, snapshot.p95, snapshot.p99]
        
        # Linear interpolation
        for i in range(len(values) - 1):
            if values[i] <= value <= values[i + 1]:
                # Interpolate between percentiles
                ratio = (value - values[i]) / (values[i + 1] - values[i])
                return percentiles[i] + ratio * (percentiles[i + 1] - percentiles[i])
        
        # Extrapolate if outside range
        if value < values[0]:
            return 0.0
        else:
            return 100.0
    
    def get_summary(self) -> Dict[str, Any]:
        """Get summary of percentile service state."""
        current_percentiles = self.get_current_percentiles()
        
        return {
            "total_values": len(self.value_history),
            "total_snapshots": len(self.snapshots),
            "current_regime": self.current_regime,
            "round_count": self.round_count,
            "current_percentiles": current_percentiles.to_dict() if current_percentiles else None
        }
