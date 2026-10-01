"""
Session Manager for session lifecycle control and recommendations.

The SessionManager tracks session state, provides session-level
recommendations, and enforces session limits.
"""

from typing import Dict, Any, Optional
from datetime import datetime, timedelta

from momento_core.orchestrator.models import (
    SessionStatus,
    SessionState,
    ActionType,
    ExecutionPlan,
    RiskAssessment,
    BankrollState,
)


class SessionManager:
    """
    Manages session lifecycle and provides session-level recommendations.
    
    The session manager coordinates with bankroll and risk managers to
    provide clear guidance on whether to continue, pause, or stop a session.
    """
    
    def __init__(self, db) -> None:
        """
        Initialize session manager with database session.
        
        Args:
            db: SQLAlchemy database session
        """
        self.db = db
    
    def update_status(
        self,
        execution_plan: ExecutionPlan,
        risk_assessment: RiskAssessment,
        bankroll_state: BankrollState,
        session_config: Dict[str, Any]
    ) -> SessionStatus:
        """
        Update session status based on current conditions.
        
        Args:
            execution_plan: Current execution plan
            risk_assessment: Current risk assessment
            bankroll_state: Current bankroll state
            session_config: Session configuration
            
        Returns:
            SessionStatus: Updated session status
        """
        session_id = session_config.get("session_id", "default")
        
        # Check limits
        limit_check = self._check_limits(bankroll_state, session_config)
        
        if limit_check["should_stop"]:
            return SessionStatus(
                session_id=session_id,
                state=SessionState.COMPLETED,
                recommendation=ActionType.STOP,
                reason=limit_check["reason"],
                rounds_played=session_config.get("rounds_played", 0),
                rounds_waited=session_config.get("rounds_waited", 0),
                session_duration_seconds=session_config.get("session_duration_seconds", 0),
                win_rate=session_config.get("win_rate"),
                total_profit=bankroll_state.current_profit
            )
        
        # Check risk level
        if risk_assessment.risk_level.value == "danger":
            return SessionStatus(
                session_id=session_id,
                state=SessionState.PAUSED,
                recommendation=ActionType.PAUSE,
                reason="Risk level too high - take a break",
                rounds_played=session_config.get("rounds_played", 0),
                rounds_waited=session_config.get("rounds_waited", 0),
                session_duration_seconds=session_config.get("session_duration_seconds", 0),
                win_rate=session_config.get("win_rate"),
                total_profit=bankroll_state.current_profit
            )
        
        # Check time limit
        if self._check_time_limit(session_config):
            return SessionStatus(
                session_id=session_id,
                state=SessionState.COMPLETED,
                recommendation=ActionType.STOP,
                reason="Time limit reached",
                rounds_played=session_config.get("rounds_played", 0),
                rounds_waited=session_config.get("rounds_waited", 0),
                session_duration_seconds=session_config.get("session_duration_seconds", 0),
                win_rate=session_config.get("win_rate"),
                total_profit=bankroll_state.current_profit
            )
        
        # Default to active with plan recommendation
        return SessionStatus(
            session_id=session_id,
            state=SessionState.ACTIVE,
            recommendation=execution_plan.action,
            reason=execution_plan.reason,
            rounds_played=session_config.get("rounds_played", 0),
            rounds_waited=session_config.get("rounds_waited", 0),
            session_duration_seconds=session_config.get("session_duration_seconds", 0),
            win_rate=session_config.get("win_rate"),
            total_profit=bankroll_state.current_profit
        )
    
    def _check_limits(
        self,
        bankroll_state: BankrollState,
        session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Check if session limits have been reached.
        
        Args:
            bankroll_state: Current bankroll state
            session_config: Session configuration
            
        Returns:
            Dict with limit check results
        """
        result = {
            "should_stop": False,
            "reason": None
        }
        
        # Check daily target
        if bankroll_state.daily_target and bankroll_state.current_profit >= bankroll_state.daily_target:
            result["should_stop"] = True
            result["reason"] = (
                f"Today's objective achieved. Risk of giving profit back is increasing. "
                f"Session Complete. ★★★★★"
            )
        
        # Check max loss
        if bankroll_state.max_loss_allowed and bankroll_state.remaining_loss_allowance <= 0:
            result["should_stop"] = True
            result["reason"] = "Maximum loss limit reached for today"
        
        return result
    
    def _check_time_limit(self, session_config: Dict[str, Any]) -> bool:
        """
        Check if time limit has been reached.
        
        Args:
            session_config: Session configuration
            
        Returns:
            bool: True if time limit reached
        """
        time_available = session_config.get("time_available_minutes")
        if not time_available:
            return False
        
        session_duration = session_config.get("session_duration_seconds", 0)
        session_duration_minutes = session_duration / 60
        
        return session_duration_minutes >= time_available
    
    def start_session(self, session_config: Dict[str, Any]) -> SessionStatus:
        """
        Initialize a new session.
        
        Args:
            session_config: Session configuration
            
        Returns:
            SessionStatus: Initial session status
        """
        session_id = session_config.get("session_id", f"session_{datetime.utcnow().timestamp()}")
        
        return SessionStatus(
            session_id=session_id,
            state=SessionState.ACTIVE,
            recommendation=ActionType.WAIT,
            reason="Session started - awaiting analysis",
            rounds_played=0,
            rounds_waited=0,
            session_duration_seconds=0,
            win_rate=None,
            total_profit=0.0
        )
