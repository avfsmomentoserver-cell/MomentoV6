"""
Conservative Orchestrator Module

Implements conservative strategies for risk-averse users with higher
confidence thresholds, smaller bet sizes, and stricter risk controls.
"""

from typing import Dict, Any, Optional
from datetime import datetime
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
    InstructionStrategy
)


class ConservativeExecutionStrategy(ExecutionStrategy):
    """Conservative execution planning with higher confidence thresholds."""
    
    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context
        self.min_confidence_threshold = 0.75  # Higher than default (0.65)
        self.min_probability_threshold = 0.65  # Higher than default (0.50)
    
    def create_execution_plan(
        self,
        forecast_data: Dict[str, Any],
        session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Create execution plan with conservative thresholds."""
        predictions = forecast_data.get('predictions', [])
        confidence = forecast_data.get('prediction_confidence', {})
        
        if not predictions:
            return {
                'action': 'WAIT',
                'reason': 'No predictions available',
                'confidence': 0.0,
                'estimated_wait_rounds': 20
            }
        
        top_prediction = predictions[0] if predictions else None
        
        if not top_prediction:
            return {
                'action': 'WAIT',
                'reason': 'No valid prediction',
                'confidence': 0.0,
                'estimated_wait_rounds': 20
            }
        
        probability = top_prediction.get('probability', 0.0)
        range_hi = top_prediction.get('range_hi', 2.0)
        confidence_value = confidence.get('confidence', probability)
        
        # Conservative thresholds - only play with high confidence
        if probability < self.min_probability_threshold or confidence_value < self.min_confidence_threshold:
            action = 'WAIT'
            reason = 'Insufficient confidence for conservative strategy'
            estimated_wait = 20
        elif range_hi <= 2.0:
            action = 'BET_LOW'
            reason = 'High confidence low range - conservative play'
            estimated_wait = 0
        elif range_hi <= 3.0:
            action = 'BET_LOW'
            reason = 'Moderate range - conservative play'
            estimated_wait = 0
        else:
            action = 'WAIT'
            reason = 'Range too high for conservative strategy'
            estimated_wait = 15
        
        return {
            'action': action,
            'reason': reason,
            'confidence': confidence_value,
            'probability': probability,
            'range_lo': top_prediction.get('range_lo', 1.0),
            'range_hi': range_hi,
            'label': top_prediction.get('label', 'Unknown'),
            'estimated_wait_rounds': estimated_wait if action == 'WAIT' else 0,
            'multiplier_target': (top_prediction.get('range_lo', 1.0) + range_hi) / 2,
            'strategy': 'conservative'
        }


class ConservativeRiskStrategy(RiskStrategy):
    """Conservative risk assessment with stricter scoring."""
    
    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context
    
    def assess_risk(
        self,
        forecast_data: Dict[str, Any],
        execution_plan: Dict[str, Any],
        session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Assess risk with conservative thresholds."""
        confidence = execution_plan.get('confidence', 0.5)
        probability = execution_plan.get('probability', 0.5)
        range_hi = execution_plan.get('range_hi', 2.0)
        
        # Conservative risk calculation
        risk_score = 0.0
        
        # Confidence risk (higher weight for conservative)
        if confidence < 0.75:
            risk_score += 40
        elif confidence < 0.85:
            risk_score += 20
        else:
            risk_score += 5
        
        # Probability risk
        if probability < 0.65:
            risk_score += 30
        elif probability < 0.75:
            risk_score += 15
        else:
            risk_score += 5
        
        # Range risk (conservative prefers lower ranges)
        if range_hi > 5.0:
            risk_score += 30
        elif range_hi > 3.0:
            risk_score += 15
        else:
            risk_score += 5
        
        # Determine risk level
        if risk_score < 20:
            risk_level = 'EXCELLENT'
        elif risk_score < 40:
            risk_level = 'GOOD'
        elif risk_score < 60:
            risk_level = 'MODERATE'
        elif risk_score < 80:
            risk_level = 'ELEVATED'
        else:
            risk_level = 'DANGER'
        
        # Conservative recommendations
        if risk_level in ['DANGER', 'ELEVATED']:
            recommended_action = 'SKIP - Conservative threshold exceeded'
            max_bet_size = 0.0
        elif risk_level == 'MODERATE':
            recommended_action = 'PROCEED - With caution'
            max_bet_size = 0.25
        else:
            recommended_action = 'PROCEED - Within conservative limits'
            max_bet_size = 0.5
        
        return {
            'risk_score': risk_score,
            'risk_level': risk_level,
            'risk_factors': [
                {'name': 'confidence_risk', 'severity': 'high' if confidence < 0.75 else 'low', 'value': confidence},
                {'name': 'probability_risk', 'severity': 'high' if probability < 0.65 else 'low', 'value': probability},
                {'name': 'range_risk', 'severity': 'high' if range_hi > 3.0 else 'low', 'value': range_hi}
            ],
            'recommended_action': recommended_action,
            'max_bet_size': max_bet_size,
            'strategy': 'conservative'
        }


class ConservativeBankrollStrategy(BankrollStrategy):
    """Conservative bankroll management with stricter limits."""
    
    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context
    
    def get_bankroll_state(
        self,
        session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Get bankroll state with conservative limits."""
        starting_balance = session_config.get('starting_balance', 1000.0)
        current_balance = session_config.get('current_balance', starting_balance)
        
        # Conservative limits
        daily_target = starting_balance * 0.05  # 5% target (lower than default)
        max_loss = starting_balance * 0.02  # 2% loss limit (lower than default)
        
        current_profit = current_balance - starting_balance
        drawdown = max(0, starting_balance - current_balance)
        
        # Conservative bankroll health
        if current_profit >= daily_target:
            bankroll_health = 'EXCELLENT'
        elif current_profit > 0:
            bankroll_health = 'GOOD'
        elif drawdown < max_loss * 0.5:
            bankroll_health = 'MODERATE'
        else:
            bankroll_health = 'POOR'
        
        return {
            'total_bankroll': starting_balance,
            'available_bankroll': current_balance,
            'session_profit': current_profit,
            'session_loss': drawdown,
            'current_session_bets': 0,
            'win_rate': 0.5,
            'avg_bet_size': 0.5,  # Conservative bet size
            'bankroll_health': bankroll_health,
            'daily_target': daily_target,
            'max_loss': max_loss,
            'remaining_loss_allowance': max_loss - drawdown,
            'strategy': 'conservative'
        }
    
    def update_bankroll(
        self,
        action: Dict[str, Any],
        result: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update bankroll after action."""
        # Placeholder for bankroll updates
        return {'updated': True}


class ConservativeSessionStrategy(SessionStrategy):
    """Conservative session management with stricter stopping rules."""
    
    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context
    
    def update_session_status(
        self,
        execution_plan: Dict[str, Any],
        risk_assessment: Dict[str, Any],
        bankroll_state: Dict[str, Any],
        session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update session status with conservative rules."""
        risk_level = risk_assessment.get('risk_level', 'MODERATE')
        bankroll_health = bankroll_state.get('bankroll_health', 'MODERATE')
        current_profit = bankroll_state.get('session_profit', 0.0)
        daily_target = bankroll_state.get('daily_target', 50.0)
        
        # Conservative session rules
        if risk_level in ['DANGER', 'ELEVATED']:
            session_state = 'STOP'
            reason = 'Risk level too high for conservative strategy'
            active = False
        elif bankroll_health == 'POOR':
            session_state = 'STOP'
            reason = 'Bankroll health poor - conservative limit reached'
            active = False
        elif current_profit >= daily_target:
            session_state = 'COMPLETE'
            reason = 'Daily target achieved - conservative goal met'
            active = False
        elif risk_level == 'MODERATE':
            session_state = 'PAUSE'
            reason = 'Moderate risk - conservative caution'
            active = False
        else:
            session_state = 'ACTIVE'
            reason = 'Conditions acceptable for conservative play'
            active = True
        
        return {
            'session_id': session_config.get('session_id', 'unknown'),
            'session_state': session_state,
            'reason': reason,
            'active': active,
            'rounds_available': 10 if active else 0,
            'session_duration': 0,
            'recommendations': [
                'Use conservative bet sizes (0.25-0.5% of bankroll)',
                'Stop immediately if risk level exceeds MODERATE',
                'Achieve daily target and stop'
            ],
            'strategy': 'conservative'
        }


class ConservativePatienceStrategy(PatienceStrategy):
    """Conservative patience calculation with longer wait times."""
    
    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context
    
    def calculate_patience(
        self,
        execution_plan: Dict[str, Any],
        forecast_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Calculate patience with conservative wait times."""
        estimated_wait = execution_plan.get('estimated_wait_rounds', 10)
        required_confidence = 0.75  # Conservative threshold
        
        # Conservative patience calculation
        patience_percent = 0.0
        if estimated_wait > 0:
            patience_percent = min(100, (estimated_wait / 20) * 100)
        
        # Conservative messages
        if patience_percent < 30:
            message = 'Conservative strategy: Wait for better conditions'
        elif patience_percent < 60:
            message = 'Conservative strategy: Patience required - high confidence needed'
        else:
            message = 'Conservative strategy: Almost ready - verify confidence'
        
        return {
            'patience_percent': patience_percent,
            'rounds_remaining': estimated_wait,
            'estimated_time_seconds': estimated_wait * 45,
            'required_confidence': required_confidence,
            'message': message,
            'strategy': 'conservative'
        }


class ConservativeSpeedStrategy(SpeedStrategy):
    """Conservative speed assessment with stricter market evaluation."""
    
    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context
    
    def assess_speed(
        self,
        forecast_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Assess speed with conservative thresholds."""
        # Conservative speed assessment
        avg_round_secs = 45.0  # Default
        speed_factor = 1.0
        rounds_per_minute = 60 / avg_round_secs
        
        # Conservative classification
        if rounds_per_minute > 1.5:
            speed = 'FAST'
            recommendation = 'CONSERVATIVE: Market too fast - skip session'
        elif rounds_per_minute > 1.2:
            speed = 'MODERATE'
            recommendation = 'CONSERVATIVE: Proceed with caution'
        else:
            speed = 'SLOW'
            recommendation = 'CONSERVATIVE: Normal timing appropriate'
        
        return {
            'speed': speed,
            'avg_round_secs': avg_round_secs,
            'speed_factor': speed_factor,
            'rounds_per_minute': rounds_per_minute,
            'recommendation': recommendation,
            'strategy': 'conservative'
        }


class ConservativeMistakePreventionStrategy(MistakePreventionStrategy):
    """Conservative mistake prevention with stricter validation."""
    
    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context
        self.max_bet_percent = 0.5  # Conservative limit
    
    def validate_action(
        self,
        proposed_action: Dict[str, Any],
        current_state: Dict[str, Any],
        session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Validate action with conservative rules."""
        warnings = []
        valid = True
        
        action_type = proposed_action.get("action")
        bet_amount = proposed_action.get("bet_amount", 0)
        
        # Conservative bet amount validation
        available_bankroll = session_config.get("available_bankroll", 0)
        max_allowed = available_bankroll * (self.max_bet_percent / 100)
        
        if bet_amount > max_allowed:
            warnings.append(f"Conservative: Bet exceeds {self.max_bet_percent}% limit")
            valid = False
        
        if bet_amount > available_bankroll:
            warnings.append("Bet amount exceeds available bankroll")
            valid = False
        
        # Conservative timing validation
        if (
            current_state.get("execution_plan", {}).get("action") == "WAIT"
            and action_type == "BET"
        ):
            warnings.append("Conservative: Execution plan recommends waiting")
            valid = False
        
        # Conservative risk validation
        risk_level = current_state.get("risk_assessment", {}).get("risk_level", "MODERATE")
        if risk_level in ["ELEVATED", "DANGER"]:
            warnings.append(f"Conservative: Risk level {risk_level} too high")
            valid = False
        elif risk_level == "MODERATE":
            warnings.append("Conservative: Risk level MODERATE - caution advised")
        
        return {
            "valid": valid,
            "warnings": warnings,
            "recommended_action": current_state.get("execution_plan", {}).get("action", "WAIT"),
            "strategy": "conservative"
        }
    
    def generate_checklist(
        self,
        current_state: Dict[str, Any],
        session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Generate conservative checklist."""
        items = [
            {"item": "Confidence >= 75% (conservative threshold)", "completed": False, "required": True},
            {"item": "Risk level <= MODERATE", "completed": False, "required": True},
            {"item": "Bankroll health >= MODERATE", "completed": False, "required": True},
            {"item": "Bet size <= 0.5% of bankroll", "completed": False, "required": True},
            {"item": "Market speed not FAST", "completed": False, "required": True},
            {"item": "Daily target not exceeded", "completed": False, "required": True},
            {"item": "Session state ACTIVE", "completed": False, "required": True},
            {"item": "Execution plan action is PLAY", "completed": False, "required": True}
        ]
        
        return {
            "items": items,
            "complete": all(item["completed"] for item in items),
            "strategy": "conservative"
        }


class ConservativeInstructionStrategy(InstructionStrategy):
    """Conservative instruction generation with cautious messaging."""
    
    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context
    
    def generate_message(
        self,
        current_state: Dict[str, Any],
        context: Optional[str] = None
    ) -> Dict[str, Any]:
        """Generate conservative instruction message."""
        execution_plan = current_state.get("execution_plan", {})
        action = execution_plan.get("action", "WAIT")
        
        if action == "WAIT":
            message = "Conservative strategy: Wait for higher confidence conditions before acting."
            message_type = "guidance"
        elif action == "PLAY":
            message = "Conservative strategy: Proceed with caution. Use minimum bet size."
            message_type = "success"
        else:
            message = "Conservative strategy: Stop and reassess conditions."
            message_type = "warning"
        
        return {
            "message": message,
            "message_type": message_type,
            "strategy": "conservative"
        }


class ConservativeOrchestratorModule(OrchestratorModule):
    """Conservative orchestrator module for risk-averse users."""
    
    @staticmethod
    def _get_manifest() -> OrchestratorModuleManifest:
        """Get the module manifest."""
        return OrchestratorModuleManifest(
            name='conservative',
            version='1.0.0',
            author='Momento Core',
            description='Conservative orchestrator with higher confidence thresholds and stricter risk controls',
            module_type='orchestrator',
            capabilities=['execution', 'risk', 'bankroll', 'session', 'patience', 'speed', 'mistake_prevention', 'instruction'],
            dependencies=[]
        )
    
    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the module and all strategies."""
        self.context = context
        
        # Create and register all conservative strategies
        execution = ConservativeExecutionStrategy(self.manifest)
        execution.initialize(context)
        self.register_strategy('execution', execution)
        
        risk = ConservativeRiskStrategy(self.manifest)
        risk.initialize(context)
        self.register_strategy('risk', risk)
        
        bankroll = ConservativeBankrollStrategy(self.manifest)
        bankroll.initialize(context)
        self.register_strategy('bankroll', bankroll)
        
        session = ConservativeSessionStrategy(self.manifest)
        session.initialize(context)
        self.register_strategy('session', session)
        
        patience = ConservativePatienceStrategy(self.manifest)
        patience.initialize(context)
        self.register_strategy('patience', patience)
        
        speed = ConservativeSpeedStrategy(self.manifest)
        speed.initialize(context)
        self.register_strategy('speed', speed)
        
        mistake = ConservativeMistakePreventionStrategy(self.manifest)
        mistake.initialize(context)
        self.register_strategy('mistake_prevention', mistake)
        
        instruction = ConservativeInstructionStrategy(self.manifest)
        instruction.initialize(context)
        self.register_strategy('instruction', instruction)
    
    def health(self) -> Dict[str, Any]:
        """Return module health information."""
        return {
            "name": self.manifest.name,
            "version": self.manifest.version,
            "enabled": self.manifest.enabled,
            "status": "ok",
            "strategies": list(self._strategies.keys()),
            "risk_profile": "conservative"
        }
