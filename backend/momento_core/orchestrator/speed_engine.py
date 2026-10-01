"""
Speed Engine for market chaos detection and speed assessment.

The SpeedEngine measures market speed, latency, volatility, and chaos
to provide recommendations on position sizing and wait windows.
"""

from typing import Dict, Any, List, Optional

from momento_core.orchestrator.models import SpeedAssessment


class SpeedEngine:
    """
    Assesses market speed and chaos levels.
    
    The speed engine measures rounds per minute, latency, volatility,
    phase changes, noise, and cluster density to determine if the market
    is normal, fast, or chaotic, and provides appropriate recommendations.
    """
    
    def __init__(self, db) -> None:
        """
        Initialize speed engine with database session.
        
        Args:
            db: SQLAlchemy database session
        """
        self.db = db
    
    def assess_speed(self, forecast_data: Dict[str, Any]) -> SpeedAssessment:
        """
        Assess current market speed and chaos level.
        
        Args:
            forecast_data: Forecast data with market metrics
            
        Returns:
            SpeedAssessment: Speed assessment with recommendations
        """
        # Extract or calculate metrics
        rounds_per_minute = self._get_rounds_per_minute(forecast_data)
        latency_ms = self._get_latency(forecast_data)
        volatility_score = self._calculate_volatility_score(forecast_data)
        phase_change_detected = self._detect_phase_change(forecast_data)
        noise_level = self._calculate_noise_level(forecast_data)
        cluster_density = self._calculate_cluster_density(forecast_data)
        
        # Determine market classification
        market_classification = self._classify_market(
            rounds_per_minute=rounds_per_minute,
            volatility_score=volatility_score,
            noise_level=noise_level
        )
        
        # Generate recommendation
        recommendation = self._generate_recommendation(market_classification)
        
        return SpeedAssessment(
            rounds_per_minute=rounds_per_minute,
            latency_ms=latency_ms,
            volatility_score=volatility_score,
            phase_change_detected=phase_change_detected,
            noise_level=noise_level,
            cluster_density=cluster_density,
            market_classification=market_classification,
            recommendation=recommendation
        )
    
    def _get_rounds_per_minute(self, forecast_data: Dict[str, Any]) -> float:
        """
        Get or calculate rounds per minute.
        
        Args:
            forecast_data: Forecast data
            
        Returns:
            float: Rounds per minute
        """
        # Check if provided in forecast
        rpm = forecast_data.get("rounds_per_minute")
        if rpm:
            return rpm
        
        # Calculate from recent round data if available
        recent_rounds = forecast_data.get("recent_rounds", [])
        if len(recent_rounds) >= 2:
            timestamps = [r.get("timestamp") for r in recent_rounds if r.get("timestamp")]
            if len(timestamps) >= 2:
                # Calculate from time window
                # This is simplified - would need proper datetime parsing
                return 6.0  # Default assumption
        
        # Default to normal speed
        return 6.0
    
    def _get_latency(self, forecast_data: Dict[str, Any]) -> Optional[float]:
        """
        Get average latency in milliseconds.
        
        Args:
            forecast_data: Forecast data
            
        Returns:
            Optional[float]: Latency in milliseconds
        """
        return forecast_data.get("latency_ms")
    
    def _calculate_volatility_score(self, forecast_data: Dict[str, Any]) -> int:
        """
        Calculate volatility score (0-100).
        
        Args:
            forecast_data: Forecast data
            
        Returns:
            int: Volatility score
        """
        volatility = forecast_data.get("volatility", 0.5)
        return int(volatility * 100)
    
    def _detect_phase_change(self, forecast_data: Dict[str, Any]) -> bool:
        """
        Detect if a phase change has occurred.
        
        Args:
            forecast_data: Forecast data
            
        Returns:
            bool: True if phase change detected
        """
        current_phase = forecast_data.get("phase")
        previous_phase = forecast_data.get("previous_phase")
        
        return bool(current_phase and previous_phase and current_phase != previous_phase)
    
    def _calculate_noise_level(self, forecast_data: Dict[str, Any]) -> int:
        """
        Calculate noise level (0-100).
        
        Args:
            forecast_data: Forecast data
            
        Returns:
            int: Noise level
        """
        # Use volatility as proxy for noise if not directly provided
        noise = forecast_data.get("noise_level")
        if noise:
            return int(noise * 100)
        
        # Fallback to volatility
        volatility = forecast_data.get("volatility", 0.5)
        return int(volatility * 100)
    
    def _calculate_cluster_density(self, forecast_data: Dict[str, Any]) -> float:
        """
        Calculate cluster density (0-1).
        
        Args:
            forecast_data: Forecast data
            
        Returns:
            float: Cluster density
        """
        # This would analyze the clustering of similar outcomes
        # For now, use a simplified approach
        density = forecast_data.get("cluster_density", 0.5)
        return float(density)
    
    def _classify_market(
        self,
        rounds_per_minute: float,
        volatility_score: int,
        noise_level: int
    ) -> str:
        """
        Classify market as normal, fast, or chaotic.
        
        Args:
            rounds_per_minute: Current rounds per minute
            volatility_score: Volatility score (0-100)
            noise_level: Noise level (0-100)
            
        Returns:
            str: Market classification
        """
        # High speed + high volatility + high noise = chaotic
        if (rounds_per_minute > 8.0 and
            volatility_score > 70 and
            noise_level > 70):
            return "chaotic"
        
        # Elevated speed or volatility = fast
        if rounds_per_minute > 7.0 or volatility_score > 60:
            return "fast"
        
        # Normal conditions
        return "normal"
    
    def _generate_recommendation(self, market_classification: str) -> str:
        """
        Generate recommendation based on market classification.
        
        Args:
            market_classification: Market classification
            
        Returns:
            str: Recommendation message
        """
        if market_classification == "chaotic":
            return "Market too chaotic. Skip session or wait for stabilization."
        elif market_classification == "fast":
            return "Fast market. Reduce exposure. Recommended half stake. Increase wait window."
        else:  # normal
            return "Market conditions normal. Proceed with standard parameters."
