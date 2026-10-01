"""
Instruction Generator for natural language guidance and coaching.

The InstructionGenerator provides human-readable messages that guide
users through their session with clear, actionable instructions.
"""

from typing import Dict, Any, Optional

from momento_core.orchestrator.models import (
    InstructionMessage,
    ExecutionPlan,
    OrchestratorState,
    ActionType,
)


class InstructionGenerator:
    """
    Generates natural language instructions for users.
    
    The instruction generator provides coaching and guidance in
    human-readable format, acting as a session coach that provides
    feedback on patience, discipline, and market conditions.
    """
    
    def __init__(self, db) -> None:
        """
        Initialize instruction generator with database session.
        
        Args:
            db: SQLAlchemy database session
        """
        self.db = db
    
    def generate_message(
        self,
        current_state: OrchestratorState,
        context: Optional[str] = None
    ) -> InstructionMessage:
        """
        Generate an instruction message based on current state.
        
        Args:
            current_state: Current orchestrator state
            context: Optional context for the message
            
        Returns:
            InstructionMessage: Generated instruction
        """
        execution_plan = current_state.execution_plan
        
        # Determine message type and content based on action
        if execution_plan.action == ActionType.WAIT:
            return self._generate_wait_message(current_state, context)
        elif execution_plan.action == ActionType.PLAY:
            return self._generate_play_message(current_state, context)
        elif execution_plan.action == ActionType.STOP:
            return self._generate_stop_message(current_state, context)
        else:
            return self._generate_default_message(current_state, context)
    
    def generate_plan_change_notification(
        self,
        old_plan: ExecutionPlan,
        new_plan: ExecutionPlan
    ) -> InstructionMessage:
        """
        Generate notification when execution plan changes.
        
        Args:
            old_plan: Previous execution plan
            new_plan: New execution plan
            
        Returns:
            InstructionMessage: Plan change notification
        """
        if old_plan.action != new_plan.action:
            return InstructionMessage(
                message_type="info",
                content=f"PLAN UPDATED: {old_plan.action.value.upper()} → {new_plan.action.value.upper()}. {new_plan.reason}",
                priority="high"
            )
        
        # Check if wait time changed
        if (old_plan.estimated_wait_rounds and new_plan.estimated_wait_rounds):
            old_wait = old_plan.estimated_wait_rounds
            new_wait = new_plan.estimated_wait_rounds
            if abs(old_wait - new_wait) > 2:
                return InstructionMessage(
                    message_type="info",
                    content=f"PLAN UPDATED: Wait time changed from {old_wait} to {new_wait} rounds. {new_plan.reason}",
                    priority="medium"
                )
        
        # Check if confidence changed significantly
        confidence_change = abs(old_plan.confidence - new_plan.confidence)
        if confidence_change > 0.1:
            direction = "increased" if new_plan.confidence > old_plan.confidence else "decreased"
            return InstructionMessage(
                message_type="info",
                content=f"PLAN UPDATED: Confidence {direction} to {new_plan.confidence:.0%}. {new_plan.reason}",
                priority="medium"
            )
        
        return InstructionMessage(
            message_type="info",
            content="Plan updated. See execution plan for details.",
            priority="low"
        )
    
    def _generate_wait_message(
        self,
        current_state: OrchestratorState,
        context: Optional[str]
    ) -> InstructionMessage:
        """
        Generate message for wait state.
        
        Args:
            current_state: Current orchestrator state
            context: Optional context
            
        Returns:
            InstructionMessage: Wait message
        """
        execution_plan = current_state.execution_plan
        patience_state = current_state.patience_state
        
        if patience_state:
            rounds_remaining = patience_state.rounds_remaining
            
            if rounds_remaining <= 3:
                return InstructionMessage(
                    message_type="guidance",
                    content=f"Good patience. Keep waiting. Only {rounds_remaining} rounds left.",
                    priority="medium"
                )
            elif rounds_remaining <= 7:
                return InstructionMessage(
                    message_type="guidance",
                    content=f"Maintain patience. {rounds_remaining} rounds until entry window.",
                    priority="medium"
                )
            else:
                return InstructionMessage(
                    message_type="guidance",
                    content=f"Market not ready. Wait {rounds_remaining} rounds for optimal entry.",
                    priority="low"
                )
        
        # Fallback without patience state
        return InstructionMessage(
            message_type="guidance",
            content=execution_plan.reason,
            priority="medium"
        )
    
    def _generate_play_message(
        self,
        current_state: OrchestratorState,
        context: Optional[str]
    ) -> InstructionMessage:
        """
        Generate message for play state.
        
        Args:
            current_state: Current orchestrator state
            context: Optional context
            
        Returns:
            InstructionMessage: Play message
        """
        execution_plan = current_state.execution_plan
        
        if execution_plan.maximum_attempts:
            return InstructionMessage(
                message_type="success",
                content=f"Entry window active. Execute plan: {execution_plan.maximum_attempts} attempts maximum.",
                priority="high"
            )
        
        return InstructionMessage(
            message_type="success",
            content="Entry window active. Execute plan.",
            priority="high"
        )
    
    def _generate_stop_message(
        self,
        current_state: OrchestratorState,
        context: Optional[str]
    ) -> InstructionMessage:
        """
        Generate message for stop state.
        
        Args:
            current_state: Current orchestrator state
            context: Optional context
            
        Returns:
            InstructionMessage: Stop message
        """
        session_status = current_state.session_status
        
        if "objective achieved" in session_status.reason.lower():
            return InstructionMessage(
                message_type="success",
                content=session_status.reason,
                priority="critical"
            )
        
        return InstructionMessage(
            message_type="warning",
            content=session_status.reason,
            priority="high"
        )
    
    def _generate_default_message(
        self,
        current_state: OrchestratorState,
        context: Optional[str]
    ) -> InstructionMessage:
        """
        Generate default message.
        
        Args:
            current_state: Current orchestrator state
            context: Optional context
            
        Returns:
            InstructionMessage: Default message
        """
        return InstructionMessage(
            message_type="info",
            content="Follow the execution plan.",
            priority="low"
        )
    
    def generate_discipline_feedback(
        self,
        action_taken: str,
        recommended_action: str,
        followed_plan: bool
    ) -> InstructionMessage:
        """
        Generate feedback on user discipline.
        
        Args:
            action_taken: Action the user took
            recommended_action: Action that was recommended
            followed_plan: Whether user followed the plan
            
        Returns:
            InstructionMessage: Discipline feedback
        """
        if followed_plan:
            if action_taken == "wait":
                return InstructionMessage(
                    message_type="success",
                    content="Excellent discipline. Skipped poor opportunity. Forecast quality improving.",
                    priority="medium"
                )
            else:
                return InstructionMessage(
                    message_type="success",
                    content="Good execution. Plan followed correctly.",
                    priority="medium"
                )
        else:
            return InstructionMessage(
                message_type="warning",
                content=f"Action deviated from plan. Recommended: {recommended_action}, Taken: {action_taken}",
                priority="high"
            )
    
    def generate_market_condition_message(
        self,
        speed_assessment: Dict[str, Any]
    ) -> InstructionMessage:
        """
        Generate message about market conditions.
        
        Args:
            speed_assessment: Speed assessment data
            
        Returns:
            InstructionMessage: Market condition message
        """
        classification = speed_assessment.get("market_classification", "normal")
        
        if classification == "chaotic":
            return InstructionMessage(
                message_type="error",
                content="Market unstable. Take a short break. Resume later.",
                priority="critical"
            )
        elif classification == "fast":
            return InstructionMessage(
                message_type="warning",
                content="Market speed elevated. Reduce exposure and increase caution.",
                priority="high"
            )
        else:
            return InstructionMessage(
                message_type="info",
                content="Market conditions normal.",
                priority="low"
            )
