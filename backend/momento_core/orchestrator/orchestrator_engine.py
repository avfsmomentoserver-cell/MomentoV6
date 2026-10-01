"""
Core Orchestrator Engine for decision execution and guidance.

The OrchestratorEngine sits above the Forecast Engine and coordinates
all sub-engines to convert predictions into actionable execution plans.
"""

from typing import Optional, Dict, Any
from datetime import datetime
from sqlalchemy.orm import Session

from momento_core.orchestrator.models import (
    OrchestratorState,
    ExecutionPlan,
    RiskAssessment,
    BankrollState,
    SessionStatus,
    ActionType,
    SessionState,
)
from momento_core.orchestrator.execution_planner import ExecutionPlanner
from momento_core.orchestrator.risk_manager import RiskManager
from momento_core.orchestrator.bankroll_manager import BankrollManager
from momento_core.orchestrator.session_manager import SessionManager
from momento_core.orchestrator.patience_engine import PatienceEngine
from momento_core.orchestrator.speed_engine import SpeedEngine
from momento_core.orchestrator.mistake_prevention_engine import MistakePreventionEngine
from momento_core.orchestrator.instruction_generator import InstructionGenerator


class OrchestratorEngine:
    """
    Main orchestrator engine that coordinates all decision-making components.
    
    This engine serves as the central coordinator, integrating forecasts from
    the prediction engine with risk management, bankroll management, and session
    management to produce clear, actionable guidance for users.
    
    The orchestrator follows the principle: "Don't predict, orchestrate."
    It converts raw predictions into complete execution plans that eliminate
    human error through clear instructions and validation.
    """
    
    def __init__(self, db: Session) -> None:
        """
        Initialize the orchestrator engine with database session.
        
        Args:
            db: SQLAlchemy database session
        """
        self.db = db
        
        # Initialize sub-engines
        self.execution_planner = ExecutionPlanner(db)
        self.risk_manager = RiskManager(db)
        self.bankroll_manager = BankrollManager(db)
        self.session_manager = SessionManager(db)
        self.patience_engine = PatienceEngine(db)
        self.speed_engine = SpeedEngine(db)
        self.mistake_prevention = MistakePreventionEngine(db)
        self.instruction_generator = InstructionGenerator(db)
        
        # Track current state
        self._current_state: Optional[OrchestratorState] = None
    
    def process_forecast(
        self,
        forecast_data: Dict[str, Any],
        session_config: Dict[str, Any]
    ) -> OrchestratorState:
        """
        Process a forecast and generate complete orchestrator state.
        
        This is the main entry point for the orchestrator. It takes forecast
        data from the prediction engine and converts it into a complete
        execution plan with all supporting information.
        
        Args:
            forecast_data: Forecast data from prediction engine
            session_config: Current session configuration
            
        Returns:
            OrchestratorState: Complete orchestrator state with execution plan
        """
        # Step 1: Generate execution plan from forecast
        execution_plan = self.execution_planner.create_plan(
            forecast_data=forecast_data,
            session_config=session_config
        )
        
        # Step 2: Assess risk
        risk_assessment = self.risk_manager.assess_risk(
            forecast_data=forecast_data,
            execution_plan=execution_plan,
            session_config=session_config
        )
        
        # Step 3: Update bankroll state
        bankroll_state = self.bankroll_manager.get_state(
            session_config=session_config
        )
        
        # Step 4: Update session status
        session_status = self.session_manager.update_status(
            execution_plan=execution_plan,
            risk_assessment=risk_assessment,
            bankroll_state=bankroll_state,
            session_config=session_config
        )
        
        # Step 5: Generate patience state if waiting
        patience_state = None
        if execution_plan.action == ActionType.WAIT:
            patience_state = self.patience_engine.calculate_patience(
                execution_plan=execution_plan,
                forecast_data=forecast_data
            )
        
        # Step 6: Generate speed assessment
        speed_assessment = self.speed_engine.assess_speed(
            forecast_data=forecast_data
        )
        
        # Step 7: Build complete state
        orchestrator_state = OrchestratorState(
            execution_plan=execution_plan,
            risk_assessment=risk_assessment,
            bankroll_state=bankroll_state,
            session_status=session_status,
            patience_state=patience_state,
            speed_assessment=speed_assessment,
            last_updated=datetime.utcnow().isoformat()
        )
        
        # Cache current state
        self._current_state = orchestrator_state
        
        return orchestrator_state
    
    def update_on_round(self, round_data: Dict[str, Any]) -> OrchestratorState:
        """
        Update orchestrator state when a new round arrives.
        
        This method is called after each round to recalculate the state
        and update the execution plan if conditions have changed.
        
        Args:
            round_data: Data from the completed round
            
        Returns:
            OrchestratorState: Updated orchestrator state
        """
        if not self._current_state:
            raise ValueError("No current state. Call process_forecast first.")
        
        # Get session config from current state
        session_config = self._get_session_config_from_state()
        
        # Re-process with updated data
        updated_state = self.process_forecast(
            forecast_data=round_data,
            session_config=session_config
        )
        
        # Check if plan changed significantly
        plan_changed = self._detect_plan_change(
            self._current_state.execution_plan,
            updated_state.execution_plan
        )
        
        if plan_changed:
            # Generate notification about plan change
            notification = self.instruction_generator.generate_plan_change_notification(
                old_plan=self._current_state.execution_plan,
                new_plan=updated_state.execution_plan
            )
            # Could emit this via websocket or store for UI
        
        return updated_state
    
    def validate_action(
        self,
        proposed_action: Dict[str, Any],
        session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Validate a user-proposed action before execution.
        
        This prevents common mistakes by checking against the current
        execution plan and risk parameters.
        
        Args:
            proposed_action: Action the user wants to take
            session_config: Current session configuration
            
        Returns:
            Dict with validation result and any warnings
        """
        if not self._current_state:
            raise ValueError("No current state. Call process_forecast first.")
        
        return self.mistake_prevention.validate_action(
            proposed_action=proposed_action,
            current_state=self._current_state,
            session_config=session_config
        )
    
    def generate_pre_action_checklist(
        self,
        session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Generate a pre-action checklist for the user.
        
        This provides a clear checklist that must be satisfied before
        taking any action, reducing the chance of mistakes.
        
        Args:
            session_config: Current session configuration
            
        Returns:
            Dict with checklist items and overall status
        """
        if not self._current_state:
            raise ValueError("No current state. Call process_forecast first.")
        
        return self.mistake_prevention.generate_checklist(
            current_state=self._current_state,
            session_config=session_config
        )
    
    def get_instruction_message(
        self,
        context: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Generate a natural language instruction message for the user.
        
        This provides coaching and guidance in human-readable format.
        
        Args:
            context: Optional context for the instruction
            
        Returns:
            Dict with message content and metadata
        """
        if not self._current_state:
            raise ValueError("No current state. Call process_forecast first.")
        
        return self.instruction_generator.generate_message(
            current_state=self._current_state,
            context=context
        )
    
    def _get_session_config_from_state(self) -> Dict[str, Any]:
        """Extract session config from current state."""
        # This would be expanded to properly reconstruct config
        # For now, return minimal config
        return {
            "session_id": self._current_state.session_status.session_id,
            "user_id": "user",  # Would come from actual state
        }
    
    def _detect_plan_change(
        self,
        old_plan: ExecutionPlan,
        new_plan: ExecutionPlan
    ) -> bool:
        """
        Detect if the execution plan has changed significantly.
        
        Args:
            old_plan: Previous execution plan
            new_plan: New execution plan
            
        Returns:
            bool: True if plan changed significantly
        """
        # Check if action type changed
        if old_plan.action != new_plan.action:
            return True
        
        # Check if wait time changed significantly (>20%)
        if (old_plan.estimated_wait_rounds and new_plan.estimated_wait_rounds):
            change_percent = abs(
                old_plan.estimated_wait_rounds - new_plan.estimated_wait_rounds
            ) / old_plan.estimated_wait_rounds
            if change_percent > 0.2:
                return True
        
        # Check if confidence changed significantly (>10%)
        confidence_change = abs(old_plan.confidence - new_plan.confidence)
        if confidence_change > 0.1:
            return True
        
        return False
    
    def get_current_state(self) -> Optional[OrchestratorState]:
        """
        Get the current orchestrator state.
        
        Returns:
            Optional[OrchestratorState]: Current state if available
        """
        return self._current_state
