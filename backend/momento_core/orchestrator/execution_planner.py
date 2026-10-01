"""
Execution Planner for converting predictions into actionable plans.

The ExecutionPlanner takes forecast data and converts it into clear,
actionable execution plans that tell users exactly what to do.
"""

from typing import Dict, Any, Optional, List
from datetime import datetime

from momento_core.orchestrator.models import (
    ExecutionPlan,
    ActionType,
    BetSlot,
    SessionConfig,
)


class ExecutionPlanner:
    """
    Converts forecast predictions into actionable execution plans.
    
    The planner follows the principle that users should not need to think
    about predictions. Instead, they receive clear instructions like:
    - "WAIT 7 rounds"
    - "PLAY Slot A: 0.50 @ 4x"
    
    This eliminates analysis paralysis and execution mistakes.
    """
    
    def __init__(self, db) -> None:
        """
        Initialize execution planner with database session.
        
        Args:
            db: SQLAlchemy database session
        """
        self.db = db
    
    def create_plan(
        self,
        forecast_data: Dict[str, Any],
        session_config: Dict[str, Any]
    ) -> ExecutionPlan:
        """
        Create an execution plan from forecast data.
        
        Args:
            forecast_data: Forecast data from prediction engine
            session_config: Session configuration parameters
            
        Returns:
            ExecutionPlan: Actionable execution plan
        """
        # Extract key forecast parameters
        confidence = self._extract_confidence(forecast_data)
        probability = self._extract_probability(forecast_data)
        phase = self._extract_phase(forecast_data)
        volatility = self._extract_volatility(forecast_data)
        
        # Get session parameters
        min_confidence = session_config.get("min_confidence_threshold", 0.65)
        max_patience = session_config.get("max_patience_rounds", 20)
        
        # Determine action type
        action = self._determine_action(
            confidence=confidence,
            probability=probability,
            phase=phase,
            min_confidence=min_confidence
        )
        
        # Build plan based on action type
        if action == ActionType.WAIT:
            return self._build_wait_plan(
                forecast_data=forecast_data,
                confidence=confidence,
                probability=probability,
                min_confidence=min_confidence,
                max_patience=max_patience
            )
        elif action == ActionType.PLAY:
            return self._build_play_plan(
                forecast_data=forecast_data,
                session_config=session_config,
                confidence=confidence
            )
        elif action == ActionType.STOP:
            return self._build_stop_plan(
                forecast_data=forecast_data,
                reason="Session conditions not met for safe play"
            )
        else:
            # Default to wait for safety
            return self._build_wait_plan(
                forecast_data=forecast_data,
                confidence=confidence,
                probability=probability,
                min_confidence=min_confidence,
                max_patience=max_patience
            )
    
    def _determine_action(
        self,
        confidence: float,
        probability: float,
        phase: str,
        min_confidence: float
    ) -> ActionType:
        """
        Determine the appropriate action based on forecast parameters.
        
        Args:
            confidence: Forecast confidence level
            probability: Current success probability
            phase: Market phase
            min_confidence: Minimum confidence threshold
            
        Returns:
            ActionType: Recommended action
        """
        # Check if confidence meets threshold
        if confidence < min_confidence:
            return ActionType.WAIT
        
        # Check if probability is sufficient
        if probability < 0.5:
            return ActionType.WAIT
        
        # Check phase conditions
        if phase in ["compression", "recovery"]:
            return ActionType.WAIT
        
        # If all conditions met, recommend play
        return ActionType.PLAY
    
    def _build_wait_plan(
        self,
        forecast_data: Dict[str, Any],
        confidence: float,
        probability: float,
        min_confidence: float,
        max_patience: int
    ) -> ExecutionPlan:
        """
        Build a WAIT execution plan.
        
        Args:
            forecast_data: Forecast data
            confidence: Current confidence
            probability: Current probability
            min_confidence: Required confidence
            max_patience: Maximum patience rounds
            
        Returns:
            ExecutionPlan: Wait plan with details
        """
        # Estimate wait time from forecast
        estimated_rounds = self._estimate_wait_rounds(forecast_data, max_patience)
        estimated_seconds = self._rounds_to_seconds(estimated_rounds)
        
        # Determine reason for waiting
        reason = self._determine_wait_reason(forecast_data, probability, min_confidence)
        
        return ExecutionPlan(
            action=ActionType.WAIT,
            confidence=confidence,
            reason=reason,
            estimated_wait_rounds=estimated_rounds,
            estimated_wait_seconds=estimated_seconds,
            current_probability=probability,
            required_probability=min_confidence,
            reevaluate_after_rounds=min(estimated_rounds, 5),
            created_at=datetime.utcnow().isoformat()
        )
    
    def _build_play_plan(
        self,
        forecast_data: Dict[str, Any],
        session_config: Dict[str, Any],
        confidence: float
    ) -> ExecutionPlan:
        """
        Build a PLAY execution plan with bet slots.
        
        Args:
            forecast_data: Forecast data
            session_config: Session configuration
            confidence: Current confidence
            
        Returns:
            ExecutionPlan: Play plan with bet configurations
        """
        # Determine round window
        round_window = self._determine_round_window(forecast_data)
        
        # Calculate bet slots based on risk profile
        bet_slots = self._calculate_bet_slots(
            forecast_data=forecast_data,
            session_config=session_config,
            confidence=confidence
        )
        
        # Determine maximum attempts
        max_attempts = self._determine_max_attempts(
            session_config=session_config,
            confidence=confidence
        )
        
        # Estimate success level
        estimated_success = self._estimate_success_level(confidence)
        
        # Estimate duration
        estimated_duration = self._estimate_mission_duration(
            max_attempts=max_attempts,
            round_window=round_window
        )
        
        return ExecutionPlan(
            action=ActionType.PLAY,
            confidence=confidence,
            reason="Entry conditions met",
            round_window_start=round_window["start"],
            round_window_end=round_window["end"],
            bet_slots=bet_slots,
            maximum_attempts=max_attempts,
            stop_after_attempts=True,
            reevaluate_after_rounds=3,
            expected_confidence=confidence,
            estimated_success=estimated_success,
            estimated_duration_seconds=estimated_duration,
            created_at=datetime.utcnow().isoformat()
        )
    
    def _build_stop_plan(
        self,
        forecast_data: Dict[str, Any],
        reason: str
    ) -> ExecutionPlan:
        """
        Build a STOP execution plan.
        
        Args:
            forecast_data: Forecast data
            reason: Reason for stopping
            
        Returns:
            ExecutionPlan: Stop plan
        """
        return ExecutionPlan(
            action=ActionType.STOP,
            confidence=0.0,
            reason=reason,
            created_at=datetime.utcnow().isoformat()
        )
    
    def _extract_confidence(self, forecast_data: Dict[str, Any]) -> float:
        """Extract confidence from forecast data."""
        return forecast_data.get("confidence_level", 0.5)
    
    def _extract_probability(self, forecast_data: Dict[str, Any]) -> float:
        """Extract probability from forecast data."""
        return forecast_data.get("probability", 0.5)
    
    def _extract_phase(self, forecast_data: Dict[str, Any]) -> str:
        """Extract market phase from forecast data."""
        return forecast_data.get("phase", "unknown")
    
    def _extract_volatility(self, forecast_data: Dict[str, Any]) -> float:
        """Extract volatility from forecast data."""
        return forecast_data.get("volatility", 0.5)
    
    def _estimate_wait_rounds(
        self,
        forecast_data: Dict[str, Any],
        max_patience: int
    ) -> int:
        """Estimate rounds to wait before entry."""
        # Use forecast ETA if available
        eta_rounds = forecast_data.get("eta_rounds")
        if eta_rounds:
            return min(eta_rounds, max_patience)
        
        # Default to moderate wait
        return min(7, max_patience)
    
    def _rounds_to_seconds(self, rounds: int) -> int:
        """Convert rounds to estimated seconds (assuming ~18s per round)."""
        return rounds * 18
    
    def _determine_wait_reason(
        self,
        forecast_data: Dict[str, Any],
        probability: float,
        min_confidence: float
    ) -> str:
        """Determine human-readable reason for waiting."""
        phase = self._extract_phase(forecast_data)
        
        if phase == "compression":
            return "Compression not finished"
        elif phase == "recovery":
            return "Market in recovery phase"
        elif probability < min_confidence:
            return f"Probability too low ({probability:.0%} vs {min_confidence:.0%} required)"
        else:
            return "Entry conditions not met"
    
    def _determine_round_window(self, forecast_data: Dict[str, Any]) -> Dict[str, int]:
        """Determine the round window for entry."""
        eta_rounds = forecast_data.get("eta_rounds", 3)
        
        return {
            "start": max(1, eta_rounds - 1),
            "end": eta_rounds + 2
        }
    
    def _calculate_bet_slots(
        self,
        forecast_data: Dict[str, Any],
        session_config: Dict[str, Any],
        confidence: float
    ) -> List[BetSlot]:
        """
        Calculate bet slot configurations.
        
        Args:
            forecast_data: Forecast data
            session_config: Session configuration
            confidence: Current confidence
            
        Returns:
            List of BetSlot configurations
        """
        risk_profile = session_config.get("risk_profile", "moderate")
        balance = session_config.get("starting_balance", 100.0)
        max_stake_percent = session_config.get("max_stake_percent", 5.0)
        
        # Calculate base stake
        base_stake = balance * (max_stake_percent / 100.0)
        
        # Adjust based on confidence
        confidence_multiplier = 0.5 + (confidence * 0.5)  # 0.5 to 1.0
        adjusted_stake = base_stake * confidence_multiplier
        
        # Create slots based on risk profile
        if risk_profile == "conservative":
            return [
                BetSlot(
                    slot_id="A",
                    amount=round(adjusted_stake, 2),
                    cashout_target=2.0,
                    priority="high"
                )
            ]
        elif risk_profile == "moderate":
            return [
                BetSlot(
                    slot_id="A",
                    amount=round(adjusted_stake * 0.6, 2),
                    cashout_target=2.0,
                    priority="high"
                ),
                BetSlot(
                    slot_id="B",
                    amount=round(adjusted_stake * 0.4, 2),
                    cashout_target=5.0,
                    priority="medium"
                )
            ]
        else:  # aggressive
            return [
                BetSlot(
                    slot_id="A",
                    amount=round(adjusted_stake * 0.5, 2),
                    cashout_target=2.0,
                    priority="high"
                ),
                BetSlot(
                    slot_id="B",
                    amount=round(adjusted_stake * 0.3, 2),
                    cashout_target=5.0,
                    priority="medium"
                ),
                BetSlot(
                    slot_id="C",
                    amount=round(adjusted_stake * 0.2, 2),
                    cashout_target=10.0,
                    priority="low"
                )
            ]
    
    def _determine_max_attempts(
        self,
        session_config: Dict[str, Any],
        confidence: float
    ) -> int:
        """Determine maximum attempts before stopping."""
        risk_profile = session_config.get("risk_profile", "moderate")
        
        base_attempts = {
            "conservative": 2,
            "moderate": 3,
            "aggressive": 4
        }
        
        # Adjust based on confidence
        if confidence > 0.8:
            return base_attempts[risk_profile] + 1
        elif confidence < 0.6:
            return max(1, base_attempts[risk_profile] - 1)
        
        return base_attempts[risk_profile]
    
    def _estimate_success_level(self, confidence: float) -> str:
        """Estimate success level from confidence."""
        if confidence >= 0.8:
            return "high"
        elif confidence >= 0.65:
            return "medium"
        else:
            return "low"
    
    def _estimate_mission_duration(
        self,
        max_attempts: int,
        round_window: Dict[str, int]
    ) -> int:
        """Estimate mission duration in seconds."""
        window_size = round_window["end"] - round_window["start"] + 1
        total_rounds = window_size * max_attempts
        return total_rounds * 18  # ~18 seconds per round
