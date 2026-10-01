"""
Default Orchestrator Module

Implements the standard orchestrator strategies using the existing
orchestrator components as a reference implementation.
"""

from typing import Dict, Any, Optional
from momento_core.orchestrator_pluggable.interfaces import (
    OrchestratorModule,
    OrchestratorModuleManifest,
    OrchestratorContext,
    ExecutionStrategy,
    RiskStrategy,
    BankrollStrategy,
    SessionStrategy,
    PatienceStrategy,
    SpeedStrategy,
    MistakePreventionStrategy,
    InstructionStrategy,
)


class DefaultExecutionStrategy(ExecutionStrategy):
    """Default execution planning strategy."""

    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context

    def create_execution_plan(
        self, forecast_data: Dict[str, Any], session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Create execution plan from forecast data."""
        # Extract key information from forecast
        predictions = forecast_data.get("predictions", [])
        confidence = forecast_data.get("prediction_confidence", {})

        if not predictions:
            return {
                "action": "WAIT",
                "reason": "No predictions available",
                "confidence": 0.0,
                "estimated_wait_rounds": 10,
            }

        # Get top prediction
        top_prediction = predictions[0] if predictions else None

        if not top_prediction:
            return {
                "action": "WAIT",
                "reason": "No valid prediction",
                "confidence": 0.0,
                "estimated_wait_rounds": 10,
            }

        # Determine action based on prediction
        probability = top_prediction.get("probability", 0.0)
        range_hi = top_prediction.get("range_hi", 2.0)

        if probability < 0.3:
            action = "WAIT"
            reason = "Low confidence prediction"
            estimated_wait = 15
        elif probability < 0.5:
            action = "WAIT"
            reason = "Moderate confidence - observe"
            estimated_wait = 5
        elif range_hi <= 2.0:
            action = "BET_LOW"
            reason = "High confidence low range"
            estimated_wait = 0
        elif range_hi <= 5.0:
            action = "BET_MEDIUM"
            reason = "High confidence medium range"
            estimated_wait = 0
        else:
            action = "BET_HIGH"
            reason = "High confidence high range"
            estimated_wait = 0

        return {
            "action": action,
            "reason": reason,
            "confidence": confidence.get("confidence", probability),
            "probability": probability,
            "range_lo": top_prediction.get("range_lo", 1.0),
            "range_hi": range_hi,
            "label": top_prediction.get("label", "Unknown"),
            "estimated_wait_rounds": estimated_wait if action == "WAIT" else 0,
            "multiplier_target": (top_prediction.get("range_lo", 1.0) + range_hi) / 2,
        }


class DefaultRiskStrategy(RiskStrategy):
    """Default risk assessment strategy."""

    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context

    def assess_risk(
        self,
        forecast_data: Dict[str, Any],
        execution_plan: Dict[str, Any],
        session_config: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Assess risk for the current situation."""
        # Calculate risk score based on multiple factors
        risk_factors = []

        # Factor 1: Prediction confidence
        confidence = execution_plan.get("confidence", 0.0)
        if confidence < 0.3:
            risk_factors.append(
                {"name": "low_confidence", "severity": "high", "value": 0.7}
            )
        elif confidence < 0.5:
            risk_factors.append(
                {"name": "moderate_confidence", "severity": "medium", "value": 0.4}
            )

        # Factor 2: Market volatility (from signals)
        signals = forecast_data.get("signals", {})
        if signals.get("collapse_ladder", {}).get("active", False):
            risk_factors.append(
                {"name": "collapse_ladder", "severity": "high", "value": 0.8}
            )
        if signals.get("ascending_ladder", {}).get("active", False):
            risk_factors.append(
                {"name": "ascending_ladder", "severity": "low", "value": 0.2}
            )

        # Factor 3: Session status
        session_rounds = session_config.get("rounds_available", 0)
        if session_rounds < 50:
            risk_factors.append(
                {"name": "insufficient_data", "severity": "medium", "value": 0.5}
            )

        # Calculate overall risk score
        total_risk = sum(f["value"] for f in risk_factors)
        risk_score = min(total_risk, 1.0)

        # Determine risk level
        if risk_score < 0.3:
            risk_level = "LOW"
        elif risk_score < 0.6:
            risk_level = "MEDIUM"
        else:
            risk_level = "HIGH"

        return {
            "risk_score": risk_score,
            "risk_level": risk_level,
            "risk_factors": risk_factors,
            "recommended_action": self._get_risk_recommendation(
                risk_level, execution_plan
            ),
            "max_bet_size": self._calculate_max_bet_size(risk_score, session_config),
        }

    def _get_risk_recommendation(
        self, risk_level: str, execution_plan: Dict[str, Any]
    ) -> str:
        """Get risk-based recommendation."""
        if risk_level == "HIGH":
            return "WAIT - High risk conditions"
        elif risk_level == "MEDIUM":
            if execution_plan.get("action") == "BET_HIGH":
                return "REDUCE - Consider lower bet"
            return "PROCEED - With caution"
        else:
            return "PROCEED - Favorable conditions"

    def _calculate_max_bet_size(
        self, risk_score: float, session_config: Dict[str, Any]
    ) -> float:
        """Calculate maximum recommended bet size."""
        base_bet = session_config.get("base_bet", 1.0)
        risk_multiplier = 1.0 - risk_score
        return base_bet * risk_multiplier


class DefaultBankrollStrategy(BankrollStrategy):
    """Default bankroll management strategy."""

    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context

    def get_bankroll_state(self, session_config: Dict[str, Any]) -> Dict[str, Any]:
        """Get current bankroll state."""
        # In a real implementation, this would query the database
        return {
            "total_bankroll": session_config.get("total_bankroll", 1000.0),
            "available_bankroll": session_config.get("available_bankroll", 1000.0),
            "session_profit": session_config.get("session_profit", 0.0),
            "session_loss": session_config.get("session_loss", 0.0),
            "current_session_bets": session_config.get("current_session_bets", 0),
            "win_rate": session_config.get("win_rate", 0.5),
            "avg_bet_size": session_config.get("avg_bet_size", 1.0),
            "bankroll_health": self._calculate_bankroll_health(session_config),
        }

    def update_bankroll(
        self, action: Dict[str, Any], result: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update bankroll after action execution."""
        # In a real implementation, this would update the database
        bet_amount = action.get("bet_amount", 0.0)
        multiplier = result.get("multiplier", 0.0)

        if multiplier >= action.get("target_multiplier", 2.0):
            profit = bet_amount * (multiplier - 1)
            outcome = "WIN"
        else:
            profit = -bet_amount
            outcome = "LOSS"

        return {
            "profit": profit,
            "outcome": outcome,
            "new_bankroll": self._calculate_new_bankroll(profit),
            "session_updated": True,
        }

    def _calculate_bankroll_health(self, session_config: Dict[str, Any]) -> str:
        """Calculate bankroll health status."""
        profit = session_config.get("session_profit", 0.0)
        loss = session_config.get("session_loss", 0.0)

        if profit > loss * 2:
            return "EXCELLENT"
        elif profit > loss:
            return "GOOD"
        elif profit > 0:
            return "FAIR"
        else:
            return "POOR"

    def _calculate_new_bankroll(self, profit: float) -> float:
        """Calculate new bankroll after profit/loss."""
        # Simplified calculation
        return 1000.0 + profit  # Would use actual bankroll in real implementation


class DefaultSessionStrategy(SessionStrategy):
    """Default session management strategy."""

    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context

    def update_session_status(
        self,
        execution_plan: Dict[str, Any],
        risk_assessment: Dict[str, Any],
        bankroll_state: Dict[str, Any],
        session_config: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Update session status based on current state."""
        risk_level = risk_assessment.get("risk_level", "MEDIUM")
        bankroll_health = bankroll_state.get("bankroll_health", "FAIR")

        # Determine session status
        if risk_level == "HIGH" or bankroll_health == "POOR":
            session_state = "PAUSE"
            reason = "High risk or poor bankroll health"
        elif risk_level == "MEDIUM" and bankroll_health == "FAIR":
            session_state = "CAUTION"
            reason = "Moderate conditions"
        else:
            session_state = "ACTIVE"
            reason = "Favorable conditions"

        return {
            "session_id": session_config.get("session_id", "default"),
            "session_state": session_state,
            "reason": reason,
            "active": session_state == "ACTIVE",
            "rounds_available": session_config.get("rounds_available", 0),
            "session_duration": session_config.get("session_duration", 0),
            "recommendations": self._get_session_recommendations(
                session_state, risk_level
            ),
        }

    def _get_session_recommendations(self, session_state: str, risk_level: str) -> list:
        """Get session-based recommendations."""
        recommendations = []

        if session_state == "PAUSE":
            recommendations.append("Stop betting and observe market")
            recommendations.append("Wait for conditions to improve")
        elif session_state == "CAUTION":
            recommendations.append("Reduce bet sizes")
            recommendations.append("Focus on high-confidence predictions")
        else:
            recommendations.append("Proceed with normal strategy")
            recommendations.append("Monitor for regime changes")

        return recommendations


class DefaultPatienceStrategy(PatienceStrategy):
    """Default patience calculation strategy."""

    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context

    def calculate_patience(
        self, execution_plan: Dict[str, Any], forecast_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Calculate patience state for waiting periods."""
        estimated_wait = execution_plan.get("estimated_wait_rounds", 10)

        # Calculate patience based on market conditions
        signals = forecast_data.get("signals", {})
        ladder_active = signals.get("ascending_ladder", {}).get("active", False)

        if ladder_active:
            patience_multiplier = 1.5  # More patient during ladder
        else:
            patience_multiplier = 1.0

        adjusted_wait = int(estimated_wait * patience_multiplier)

        return {
            "wait_rounds_remaining": adjusted_wait,
            "total_wait_rounds": adjusted_wait,
            "patience_level": self._calculate_patience_level(adjusted_wait),
            "reason": self._get_patience_reason(ladder_active),
            "progress": 0.0,
        }

    def _calculate_patience_level(self, wait_rounds: int) -> str:
        """Calculate patience level based on wait time."""
        if wait_rounds <= 5:
            return "LOW"
        elif wait_rounds <= 15:
            return "MEDIUM"
        else:
            return "HIGH"

    def _get_patience_reason(self, ladder_active: bool) -> str:
        """Get reason for patience calculation."""
        if ladder_active:
            return "Ladder pattern detected - extended patience"
        return "Standard wait period"


class DefaultSpeedStrategy(SpeedStrategy):
    """Default speed assessment strategy."""

    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context

    def assess_speed(self, forecast_data: Dict[str, Any]) -> Dict[str, Any]:
        """Assess current market speed conditions."""
        session = forecast_data.get("session", {})
        avg_round_secs = session.get("avg_round_secs", 45.0)

        # Determine speed category
        if avg_round_secs < 30:
            speed = "FAST"
            speed_factor = 1.5
        elif avg_round_secs < 45:
            speed = "NORMAL"
            speed_factor = 1.0
        elif avg_round_secs < 60:
            speed = "SLOW"
            speed_factor = 0.75
        else:
            speed = "VERY_SLOW"
            speed_factor = 0.5

        return {
            "speed": speed,
            "avg_round_secs": avg_round_secs,
            "speed_factor": speed_factor,
            "rounds_per_minute": 60.0 / avg_round_secs,
            "recommendation": self._get_speed_recommendation(speed),
        }

    def _get_speed_recommendation(self, speed: str) -> str:
        """Get speed-based recommendation."""
        if speed == "FAST":
            return "Reduce bet frequency - market moving quickly"
        elif speed == "VERY_SLOW":
            return "Consider extending wait periods"
        else:
            return "Normal timing appropriate"


class DefaultMistakePreventionStrategy(MistakePreventionStrategy):
    """Default mistake prevention strategy."""

    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context

    def validate_action(
        self,
        proposed_action: Dict[str, Any],
        current_state: Dict[str, Any],
        session_config: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Validate a user-proposed action."""
        warnings = []
        valid = True

        action_type = proposed_action.get("action")
        bet_amount = proposed_action.get("bet_amount", 0)

        # Check 1: Bet amount validation
        available_bankroll = session_config.get("available_bankroll", 0)
        if bet_amount > available_bankroll:
            warnings.append("Bet amount exceeds available bankroll")
            valid = False

        # Check 2: Action timing validation
        if (
            current_state.get("execution_plan", {}).get("action") == "WAIT"
            and action_type == "BET"
        ):
            warnings.append("Execution plan recommends waiting")
            valid = False

        # Check 3: Risk level validation
        if (
            current_state.get("risk_assessment", {}).get("risk_level") == "HIGH"
            and action_type == "BET"
        ):
            warnings.append("High risk conditions - betting not recommended")
            valid = False

        return {
            "valid": valid,
            "warnings": warnings,
            "recommended_action": current_state.get("execution_plan", {}).get(
                "action", "WAIT"
            ),
        }

    def generate_checklist(
        self, current_state: Dict[str, Any], session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Generate a pre-action checklist."""
        checklist = [
            {"item": "Review execution plan", "completed": False, "required": True},
            {"item": "Check risk assessment", "completed": False, "required": True},
            {
                "item": "Verify bankroll availability",
                "completed": False,
                "required": True,
            },
            {"item": "Confirm bet amount", "completed": False, "required": True},
            {"item": "Review session status", "completed": False, "required": False},
        ]

        return {
            "items": checklist,
            "complete": False,
            "total_items": len(checklist),
            "required_items": sum(1 for item in checklist if item["required"]),
        }


class DefaultInstructionStrategy(InstructionStrategy):
    """Default instruction generation strategy."""

    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context

    def generate_message(
        self, current_state: Dict[str, Any], context: Optional[str] = None
    ) -> Dict[str, Any]:
        """Generate natural language instruction message."""
        execution_plan = current_state.get("execution_plan", {})
        risk_assessment = current_state.get("risk_assessment", {})

        action = execution_plan.get("action", "WAIT")
        reason = execution_plan.get("reason", "No specific reason")
        confidence = execution_plan.get("confidence", 0.0)

        # Generate message based on action
        if action == "WAIT":
            message = f"Wait for better conditions. {reason}"
            tone = "cautious"
        elif action == "BET_LOW":
            message = f"Consider a low-range bet. Confidence: {confidence:.0%}"
            tone = "optimistic"
        elif action == "BET_MEDIUM":
            message = (
                f"Good opportunity for medium-range bet. Confidence: {confidence:.0%}"
            )
            tone = "confident"
        elif action == "BET_HIGH":
            message = f"High-range opportunity. Confidence: {confidence:.0%}"
            tone = "excited"
        else:
            message = "No specific instruction available"
            tone = "neutral"

        # Add risk context
        if risk_assessment.get("risk_level") == "HIGH":
            message += " High risk detected - proceed with caution."

        return {
            "message": message,
            "tone": tone,
            "action": action,
            "confidence": confidence,
            "context": context,
            "timestamp": self._get_timestamp(),
        }

    def _get_timestamp(self) -> str:
        """Get current timestamp."""
        from datetime import datetime

        return datetime.utcnow().isoformat()


class DefaultOrchestratorModule(OrchestratorModule):
    """Default orchestrator module with all standard strategies."""

    @staticmethod
    def _get_manifest() -> OrchestratorModuleManifest:
        """Get the module manifest."""
        return OrchestratorModuleManifest(
            name="default",
            version="1.0.0",
            author="Momento Core",
            description="Default orchestrator with standard strategies",
            module_type="orchestrator",
            capabilities=[
                "execution",
                "risk",
                "bankroll",
                "session",
                "patience",
                "speed",
                "mistake_prevention",
                "instruction",
            ],
        )

    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the module and all strategies."""
        self.context = context

        # Create and register all strategies
        execution = DefaultExecutionStrategy(self.manifest)
        execution.initialize(context)
        self.register_strategy("execution", execution)

        risk = DefaultRiskStrategy(self.manifest)
        risk.initialize(context)
        self.register_strategy("risk", risk)

        bankroll = DefaultBankrollStrategy(self.manifest)
        bankroll.initialize(context)
        self.register_strategy("bankroll", bankroll)

        session = DefaultSessionStrategy(self.manifest)
        session.initialize(context)
        self.register_strategy("session", session)

        patience = DefaultPatienceStrategy(self.manifest)
        patience.initialize(context)
        self.register_strategy("patience", patience)

        speed = DefaultSpeedStrategy(self.manifest)
        speed.initialize(context)
        self.register_strategy("speed", speed)

        mistake = DefaultMistakePreventionStrategy(self.manifest)
        mistake.initialize(context)
        self.register_strategy("mistake_prevention", mistake)

        instruction = DefaultInstructionStrategy(self.manifest)
        instruction.initialize(context)
        self.register_strategy("instruction", instruction)

    def health(self) -> Dict[str, Any]:
        """Return module health information."""
        return {
            "name": self.manifest.name,
            "version": self.manifest.version,
            "enabled": self.manifest.enabled,
            "status": "ok",
            "strategies": list(self._strategies.keys()),
        }
