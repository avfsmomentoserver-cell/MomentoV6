"""
Aggressive Orchestrator Module

Implements aggressive strategies for high-risk tolerance users with lower
confidence thresholds, larger bet sizes, and higher risk acceptance.
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


class AggressiveExecutionStrategy(ExecutionStrategy):
    """Aggressive execution planning with lower confidence thresholds."""
    
    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context
        self.min_confidence_threshold = 0.55  # Lower than default (0.65)
        self.min_probability_threshold = 0.50  # Lower than default (0.50)
    
    def create_execution_plan(
        self,
        forecast_data: Dict[str, Any],
        session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Create execution plan with aggressive thresholds."""
        predictions = forecast_data.get('predictions', [])
        confidence = forecast_data.get('prediction_confidence', {})
        
        if not predictions:
            return {
                'action': 'WAIT',
                'reason': 'No predictions available',
                'confidence': 0.0,
                'estimated_wait_rounds': 5
            }
        
        top_prediction = predictions[0] if predictions else None
        
        if not top_prediction:
            return {
                'action': 'WAIT',
                'reason': 'No valid prediction',
                'confidence': 0.0,
                'estimated_wait_rounds': 5
            }
        
        probability = top_prediction.get('probability', 0.0)
        range_hi = top_prediction.get('range_hi', 2.0)
        confidence_value = confidence.get('confidence', probability)
        
        # Aggressive thresholds - play with lower confidence
        if probability < self.min_probability_threshold or confidence_value < self.min_confidence_threshold:
            action = 'WAIT'
            reason = 'Insufficient confidence even for aggressive strategy'
            estimated_wait = 5
        elif range_hi <= 2.0:
            action = 'BET_LOW'
            reason = 'Aggressive play on low range'
            estimated_wait = 0
        elif range_hi <= 5.0:
            action = 'BET_MEDIUM'
            reason = 'Aggressive play on medium range'
            estimated_wait = 0
        elif range_hi <= 10.0:
            action = 'BET_HIGH'
            reason = 'Aggressive play on high range'
            estimated_wait = 0
        else:
            action = 'BET_VERY_HIGH'
            reason = 'Aggressive play on very high range'
            estimated_wait = 0
        
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
            'strategy': 'aggressive'
        }


class AggressiveRiskStrategy(RiskStrategy):
    """Aggressive risk assessment with more lenient scoring."""
    
    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context
    
    def assess_risk(
        self,
        forecast_data: Dict[str, Any],
        execution_plan: Dict[str, Any],
        session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Assess risk with aggressive thresholds."""
        confidence = execution_plan.get('confidence', 0.5)
        probability = execution_plan.get('probability', 0.5)
        range_hi = execution_plan.get('range_hi', 2.0)
        
        # Aggressive risk calculation
        risk_score = 0.0
        
        # Confidence risk (lower weight for aggressive)
        if confidence < 0.55:
            risk_score += 20
        elif confidence < 0.65:
            risk_score += 10
        else:
            risk_score += 2
        
        # Probability risk
        if probability < 0.50:
            risk_score += 15
        elif probability < 0.60:
            risk_score += 8
        else:
            risk_score += 2
        
        # Range risk (aggressive accepts higher ranges)
        if range_hi > 10.0:
            risk_score += 20
        elif range_hi > 5.0:
            risk_score += 10
        else:
            risk_score += 2
        
        # Determine risk level
        if risk_score < 10:
            risk_level = 'EXCELLENT'
        elif risk_score < 25:
            risk_level = 'GOOD'
        elif risk_score < 45:
            risk_level = 'MODERATE'
        elif risk_score < 65:
            risk_level = 'ELEVATED'
        else:
            risk_level = 'DANGER'
        
        # Aggressive recommendations
        if risk_level == 'DANGER':
            recommended_action = 'CAUTION - High risk even for aggressive'
            max_bet_size = 1.0
        elif risk_level == 'ELEVATED':
            recommended_action = 'PROCEED - Elevated risk acceptable'
            max_bet_size = 1.5
        else:
            recommended_action = 'PROCEED - Within aggressive limits'
            max_bet_size = 2.0
        
        return {
            'risk_score': risk_score,
            'risk_level': risk_level,
            'risk_factors': [
                {'name': 'confidence_risk', 'severity': 'low' if confidence > 0.55 else 'medium', 'value': confidence},
                {'name': 'probability_risk', 'severity': 'low' if probability > 0.50 else 'medium', 'value': probability},
                {'name': 'range_risk', 'severity': 'low' if range_hi < 5.0 else 'medium', 'value': range_hi}
            ],
            'recommended_action': recommended_action,
            'max_bet_size': max_bet_size,
            'strategy': 'aggressive'
        }


class AggressiveBankrollStrategy(BankrollStrategy):
    """Aggressive bankroll management with higher limits."""
    
    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context
    
    def get_bankroll_state(
        self,
        session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Get bankroll state with aggressive limits."""
        starting_balance = session_config.get('starting_balance', 1000.0)
        current_balance = session_config.get('current_balance', starting_balance)
        
        # Aggressive limits
        daily_target = starting_balance * 0.15  # 15% target (higher than default)
        max_loss = starting_balance * 0.10  # 10% loss limit (higher than default)
        
        current_profit = current_balance - starting_balance
        drawdown = max(0, starting_balance - current_balance)
        
        # Aggressive bankroll health
        if current_profit >= daily_target:
            bankroll_health = 'EXCELLENT'
        elif current_profit > 0:
            bankroll_health = 'GOOD'
        elif drawdown < max_loss * 0.7:
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
            'avg_bet_size': 2.0,  # Aggressive bet size
            'bankroll_health': bankroll_health,
            'daily_target': daily_target,
            'max_loss': max_loss,
            'remaining_loss_allowance': max_loss - drawdown,
            'strategy': 'aggressive'
        }
    
    def update_bankroll(
        self,
        action: Dict[str, Any],
        result: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update bankroll after action."""
        # Placeholder for bankroll updates
        return {'updated': True}


class AggressiveSessionStrategy(SessionStrategy):
    """Aggressive session management with more permissive rules."""
    
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
        """Update session status with aggressive rules."""
        risk_level = risk_assessment.get('risk_level', 'MODERATE')
        bankroll_health = bankroll_state.get('bankroll_health', 'MODERATE')
        current_profit = bankroll_state.get('session_profit', 0.0)
        daily_target = bankroll_state.get('daily_target', 150.0)
        
        # Aggressive session rules
        if risk_level == 'DANGER':
            session_state = 'PAUSE'
            reason = 'Risk level DANGER - even aggressive strategy pauses'
            active = False
        elif bankroll_health == 'POOR':
            session_state = 'PAUSE'
            reason = 'Bankroll health poor - aggressive limit reached'
            active = False
        elif current_profit >= daily_target:
            session_state = 'COMPLETE'
            reason = 'Daily target achieved - aggressive goal met'
            active = False
        elif risk_level == 'ELEVATED':
            session_state = 'ACTIVE'
            reason = 'Elevated risk acceptable for aggressive strategy'
            active = True
        else:
            session_state = 'ACTIVE'
            reason = 'Conditions excellent for aggressive play'
            active = True
        
        return {
            'session_id': session_config.get('session_id', 'unknown'),
            'session_state': session_state,
            'reason': reason,
            'active': active,
            'rounds_available': 20 if active else 0,
            'session_duration': 0,
            'recommendations': [
                'Use aggressive bet sizes (1.0-2.0% of bankroll)',
                'Accept elevated risk levels',
                'Aim for higher daily targets (15%)',
                'Stop only at DANGER risk level'
            ],
            'strategy': 'aggressive'
        }


class AggressivePatienceStrategy(PatienceStrategy):
    """Aggressive patience calculation with shorter wait times."""
    
    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context
    
    def calculate_patience(
        self,
        execution_plan: Dict[str, Any],
        forecast_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Calculate patience with aggressive wait times."""
        estimated_wait = execution_plan.get('estimated_wait_rounds', 5)
        required_confidence = 0.55  # Aggressive threshold
        
        # Aggressive patience calculation
        patience_percent = 0.0
        if estimated_wait > 0:
            patience_percent = min(100, (estimated_wait / 10) * 100)
        
        # Aggressive messages
        if patience_percent < 30:
            message = 'Aggressive strategy: Short wait - opportunity may arise soon'
        elif patience_percent < 60:
            message = 'Aggressive strategy: Moderate wait - monitor closely'
        else:
            message = 'Aggressive strategy: Almost ready - prepare to act'
        
        return {
            'patience_percent': patience_percent,
            'rounds_remaining': estimated_wait,
            'estimated_time_seconds': estimated_wait * 45,
            'required_confidence': required_confidence,
            'message': message,
            'strategy': 'aggressive'
        }


class AggressiveSpeedStrategy(SpeedStrategy):
    """Aggressive speed assessment with more permissive market evaluation."""
    
    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context
    
    def assess_speed(
        self,
        forecast_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Assess speed with aggressive thresholds."""
        # Aggressive speed assessment
        avg_round_secs = 45.0  # Default
        speed_factor = 1.0
        rounds_per_minute = 60 / avg_round_secs
        
        # Aggressive classification
        if rounds_per_minute > 2.0:
            speed = 'FAST'
            recommendation = 'AGGRESSIVE: Market fast - proceed with caution'
        elif rounds_per_minute > 1.5:
            speed = 'MODERATE'
            recommendation = 'AGGRESSIVE: Good speed for opportunities'
        else:
            speed = 'SLOW'
            recommendation = 'AGGRESSIVE: Normal timing - good for analysis'
        
        return {
            'speed': speed,
            'avg_round_secs': avg_round_secs,
            'speed_factor': speed_factor,
            'rounds_per_minute': rounds_per_minute,
            'recommendation': recommendation,
            'strategy': 'aggressive'
        }


class AggressiveMistakePreventionStrategy(MistakePreventionStrategy):
    """Aggressive mistake prevention with more permissive validation."""
    
    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context
        self.max_bet_percent = 2.0  # Aggressive limit
    
    def validate_action(
        self,
        proposed_action: Dict[str, Any],
        current_state: Dict[str, Any],
        session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Validate action with aggressive rules."""
        warnings = []
        valid = True
        
        action_type = proposed_action.get("action")
        bet_amount = proposed_action.get("bet_amount", 0)
        
        # Aggressive bet amount validation
        available_bankroll = session_config.get("available_bankroll", 0)
        max_allowed = available_bankroll * (self.max_bet_percent / 100)
        
        if bet_amount > max_allowed:
            warnings.append(f"Aggressive: Bet exceeds {self.max_bet_percent}% limit")
            valid = False
        
        if bet_amount > available_bankroll:
            warnings.append("Bet amount exceeds available bankroll")
            valid = False
        
        # Aggressive timing validation
        if (
            current_state.get("execution_plan", {}).get("action") == "WAIT"
            and action_type == "BET"
        ):
            warnings.append("Aggressive: Execution plan recommends waiting - proceed with caution")
            # Aggressive allows this but warns
        
        # Aggressive risk validation
        risk_level = current_state.get("risk_assessment", {}).get("risk_level", "MODERATE")
        if risk_level == "DANGER":
            warnings.append("Aggressive: Risk level DANGER - strongly advise against")
            valid = False
        elif risk_level == "ELEVATED":
            warnings.append("Aggressive: Risk level ELEVATED - acceptable for aggressive strategy")
        
        return {
            "valid": valid,
            "warnings": warnings,
            "recommended_action": current_state.get("execution_plan", {}).get("action", "PLAY"),
            "strategy": "aggressive"
        }
    
    def generate_checklist(
        self,
        current_state: Dict[str, Any],
        session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Generate aggressive checklist."""
        items = [
            {"item": "Confidence >= 55% (aggressive threshold)", "completed": False, "required": True},
            {"item": "Risk level != DANGER", "completed": False, "required": True},
            {"item": "Bankroll health >= MODERATE", "completed": False, "required": True},
            {"item": "Bet size <= 2.0% of bankroll", "completed": False, "required": True},
            {"item": "Market speed acceptable", "completed": False, "required": True},
            {"item": "Daily target not exceeded", "completed": False, "required": True},
            {"item": "Session state ACTIVE", "completed": False, "required": True},
            {"item": "Execution plan action is PLAY or WAIT", "completed": False, "required": True}
        ]
        
        return {
            "items": items,
            "complete": all(item["completed"] for item in items),
            "strategy": "aggressive"
        }


class AggressiveInstructionStrategy(InstructionStrategy):
    """Aggressive instruction generation with bold messaging."""
    
    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the strategy."""
        self.context = context
    
    def generate_message(
        self,
        current_state: Dict[str, Any],
        context: Optional[str] = None
    ) -> Dict[str, Any]:
        """Generate aggressive instruction message."""
        execution_plan = current_state.get("execution_plan", {})
        action = execution_plan.get("action", "WAIT")
        
        if action == "WAIT":
            message = "Aggressive strategy: Wait for moderate conditions, then act decisively."
            message_type = "guidance"
        elif action == "PLAY":
            message = "Aggressive strategy: Execute with confidence. Use larger bet sizes for higher targets."
            message_type = "success"
        else:
            message = "Aggressive strategy: Reassess quickly and prepare for next opportunity."
            message_type = "warning"
        
        return {
            "message": message,
            "message_type": message_type,
            "strategy": "aggressive"
        }


class AggressiveOrchestratorModule(OrchestratorModule):
    """Aggressive orchestrator module for high-risk tolerance users."""
    
    @staticmethod
    def _get_manifest() -> OrchestratorModuleManifest:
        """Get the module manifest."""
        return OrchestratorModuleManifest(
            name='aggressive',
            version='1.0.0',
            author='Momento Core',
            description='Aggressive orchestrator with lower confidence thresholds and higher risk acceptance',
            module_type='orchestrator',
            capabilities=['execution', 'risk', 'bankroll', 'session', 'patience', 'speed', 'mistake_prevention', 'instruction'],
            dependencies=[]
        )
    
    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the module and all strategies."""
        self.context = context
        
        # Create and register all aggressive strategies
        execution = AggressiveExecutionStrategy(self.manifest)
        execution.initialize(context)
        self.register_strategy('execution', execution)
        
        risk = AggressiveRiskStrategy(self.manifest)
        risk.initialize(context)
        self.register_strategy('risk', risk)
        
        bankroll = AggressiveBankrollStrategy(self.manifest)
        bankroll.initialize(context)
        self.register_strategy('bankroll', bankroll)
        
        session = AggressiveSessionStrategy(self.manifest)
        session.initialize(context)
        self.register_strategy('session', session)
        
        patience = AggressivePatienceStrategy(self.manifest)
        patience.initialize(context)
        self.register_strategy('patience', patience)
        
        speed = AggressiveSpeedStrategy(self.manifest)
        speed.initialize(context)
        self.register_strategy('speed', speed)
        
        mistake = AggressiveMistakePreventionStrategy(self.manifest)
        mistake.initialize(context)
        self.register_strategy('mistake_prevention', mistake)
        
        instruction = AggressiveInstructionStrategy(self.manifest)
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
            "risk_profile": "aggressive"
        }
