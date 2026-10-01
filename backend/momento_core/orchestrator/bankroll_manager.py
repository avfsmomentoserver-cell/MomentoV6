"""
Bankroll Manager for balance tracking and limit enforcement.

The BankrollManager tracks balance state, enforces limits, and provides
clear guidance on remaining loss allowance and target progress.
"""

from typing import Dict, Any, Optional

from momento_core.orchestrator.models import BankrollState


class BankrollManager:
    """
    Manages bankroll state and limit enforcement.
    
    The bankroll manager tracks starting balance, current balance, peak,
    drawdown, and limits to provide users with clear guidance on their
    financial state and remaining allowance.
    """
    
    def __init__(self, db) -> None:
        """
        Initialize bankroll manager with database session.
        
        Args:
            db: SQLAlchemy database session
        """
        self.db = db
    
    def get_state(self, session_config: Dict[str, Any]) -> BankrollState:
        """
        Get current bankroll state.
        
        Args:
            session_config: Session configuration with balance info
            
        Returns:
            BankrollState: Current bankroll state
        """
        starting_balance = session_config.get("starting_balance", 100.0)
        current_balance = session_config.get("current_balance", starting_balance)
        daily_target = session_config.get("daily_target")
        max_loss = session_config.get("max_loss")
        
        # Calculate derived metrics
        peak_balance = max(starting_balance, current_balance, session_config.get("peak_balance", starting_balance))
        current_profit = current_balance - starting_balance
        drawdown_amount = peak_balance - current_balance
        drawdown_percent = (drawdown_amount / peak_balance * 100) if peak_balance > 0 else 0
        
        # Calculate target progress
        daily_target_progress = None
        if daily_target and daily_target > 0:
            daily_target_progress = (current_profit / daily_target) * 100
        
        # Calculate remaining loss allowance
        remaining_loss_allowance = None
        if max_loss:
            remaining_loss_allowance = max_loss - abs(min(0, current_profit))
        
        return BankrollState(
            starting_balance=starting_balance,
            current_balance=current_balance,
            peak_balance=peak_balance,
            current_profit=current_profit,
            drawdown_amount=drawdown_amount,
            drawdown_percent=drawdown_percent,
            daily_target=daily_target,
            daily_target_progress=daily_target_progress,
            max_loss_allowed=max_loss,
            remaining_loss_allowance=remaining_loss_allowance
        )
    
    def update_balance(
        self,
        session_config: Dict[str, Any],
        new_balance: float
    ) -> BankrollState:
        """
        Update balance and recalculate state.
        
        Args:
            session_config: Session configuration
            new_balance: New balance after round
            
        Returns:
            BankrollState: Updated bankroll state
        """
        session_config["current_balance"] = new_balance
        return self.get_state(session_config)
    
    def check_limits(self, bankroll_state: BankrollState) -> Dict[str, Any]:
        """
        Check if any limits have been reached.
        
        Args:
            bankroll_state: Current bankroll state
            
        Returns:
            Dict with limit check results
        """
        limits = {
            "daily_target_reached": False,
            "max_loss_reached": False,
            "should_stop": False,
            "reason": None
        }
        
        # Check if daily target reached
        if bankroll_state.daily_target and bankroll_state.current_profit >= bankroll_state.daily_target:
            limits["daily_target_reached"] = True
            limits["should_stop"] = True
            limits["reason"] = "Daily target achieved"
        
        # Check if max loss reached
        if bankroll_state.max_loss_allowed and bankroll_state.remaining_loss_allowance <= 0:
            limits["max_loss_reached"] = True
            limits["should_stop"] = True
            limits["reason"] = "Maximum loss limit reached"
        
        return limits
    
    def get_safe_loss_amount(self, bankroll_state: BankrollState) -> Optional[float]:
        """
        Get the amount that can be safely lost before stop loss.
        
        Args:
            bankroll_state: Current bankroll state
            
        Returns:
            Optional[float]: Safe loss amount, or None if no limit set
        """
        return bankroll_state.remaining_loss_allowance
