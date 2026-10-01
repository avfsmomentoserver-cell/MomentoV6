"""
Patience Engine for wait time visualization and psychological support.

The PatienceEngine helps users wait by providing visual feedback on
patience progress and estimated wait times.
"""

from typing import Dict, Any

from momento_core.orchestrator.models import (
    PatienceState,
    ExecutionPlan,
)


class PatienceEngine:
    """
    Manages patience state for wait periods.
    
    The patience engine addresses the psychological challenge of waiting
    by providing clear visual feedback on progress and estimated time
    remaining. This reduces the temptation to enter early due to boredom.
    """
    
    def __init__(self, db) -> None:
        """
        Initialize patience engine with database session.
        
        Args:
            db: SQLAlchemy database session
        """
        self.db = db
    
    def calculate_patience(
        self,
        execution_plan: ExecutionPlan,
        forecast_data: Dict[str, Any]
    ) -> PatienceState:
        """
        Calculate patience state for wait periods.
        
        Args:
            execution_plan: Current execution plan
            forecast_data: Forecast data
            
        Returns:
            PatienceState: Current patience state
        """
        if not execution_plan.estimated_wait_rounds:
            # Default patience state if no wait estimate
            return PatienceState(
                patience_percent=50,
                estimated_time_remaining_seconds=60,
                rounds_remaining=5,
                current_probability=forecast_data.get("probability", 0.5),
                required_probability=0.65,
                message="Market not ready. Wait."
            )
        
        total_rounds = execution_plan.estimated_wait_rounds
        current_probability = forecast_data.get("probability", 0.5)
        required_probability = execution_plan.required_probability or 0.65
        
        # Calculate patience percent (inverse of progress)
        # Higher percent = more patience needed
        patience_percent = self._calculate_patience_percent(
            current_probability,
            required_probability,
            total_rounds
        )
        
        # Calculate time remaining
        estimated_time_remaining = total_rounds * 18  # ~18 seconds per round
        
        # Generate message
        message = self._generate_patience_message(
            patience_percent,
            current_probability,
            required_probability,
            total_rounds
        )
        
        return PatienceState(
            patience_percent=patience_percent,
            estimated_time_remaining_seconds=estimated_time_remaining,
            rounds_remaining=total_rounds,
            current_probability=current_probability,
            required_probability=required_probability,
            message=message
        )
    
    def _calculate_patience_percent(
        self,
        current_probability: float,
        required_probability: float,
        rounds_remaining: int
    ) -> int:
        """
        Calculate patience percentage.
        
        Higher percent = more patience needed (market not ready).
        Lower percent = almost ready to enter.
        
        Args:
            current_probability: Current success probability
            required_probability: Required probability for entry
            rounds_remaining: Rounds remaining before entry
            
        Returns:
            int: Patience percentage (0-100)
        """
        # Base patience on probability gap
        probability_gap = required_probability - current_probability
        probability_percent = (probability_gap / required_probability) * 100
        
        # Adjust based on rounds remaining
        # More rounds = higher patience needed
        rounds_factor = min(rounds_remaining / 20.0, 1.0) * 30
        
        # Combine factors
        patience = min(probability_percent + rounds_factor, 100)
        
        return int(max(patience, 0))
    
    def _generate_patience_message(
        self,
        patience_percent: int,
        current_probability: float,
        required_probability: float,
        rounds_remaining: int
    ) -> str:
        """
        Generate human-readable patience message.
        
        Args:
            patience_percent: Patience percentage
            current_probability: Current probability
            required_probability: Required probability
            rounds_remaining: Rounds remaining
            
        Returns:
            str: Patience message
        """
        if patience_percent >= 80:
            return "Market not ready. Wait."
        if rounds_remaining >= 10 and patience_percent < 50:
            # probability is close but the window is still far: never say "prepare"
            return f"Wait. Probability is close, entry window in {rounds_remaining} rounds."
        elif patience_percent >= 50:
            return f"Market warming up. {rounds_remaining} rounds remaining."
        elif patience_percent >= 20:
            return f"Almost ready. {rounds_remaining} rounds remaining."
        else:
            return "Entry window approaching. Prepare."
