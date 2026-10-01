"""
Main autopilot engine for automated trading operations.

Coordinates all prediction plugins, executes automated strategies, and manages risk.
"""

import threading
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime
from momento_core.autopilot.models import (
    AutopilotConfig,
    AutopilotDecision,
    AutopilotStatus,
    AutopilotAction,
)
from momento_core.autopilot.risk_manager import RiskManager
from momento_core.autopilot.strategy_selector import StrategySelector
from momento_core.plugins.collapse_ceiling import CollapseCeilingAnalyzer
from momento_core.plugins.gap_swing import GapSwingAnalyzer

logger = logging.getLogger(__name__)


class AutopilotEngine:
    """Main autopilot engine that coordinates all prediction plugins and executes automated strategies."""
    
    def __init__(self, config: AutopilotConfig):
        """Initialize autopilot engine with configuration.
        
        Args:
            config: Autopilot configuration parameters
        """
        config.validate()
        self.config = config
        self.risk_manager = RiskManager(config)
        self.strategy_selector = StrategySelector(config)
        
        # Initialize plugins
        self.ceiling_analyzer = CollapseCeilingAnalyzer() if config.enable_ceiling_analyzer else None
        self.gap_swing_analyzer = GapSwingAnalyzer() if config.enable_gap_swing_analyzer else None
        
        # Engine state
        self.is_active = False
        self.current_position: Optional[float] = None
        self.total_trades = 0
        self.winning_trades = 0
        self.decision_history: List[AutopilotDecision] = []
        self.last_decision: Optional[AutopilotDecision] = None
        
        # Thread safety
        self._lock = threading.Lock()
        
        logger.info("Autopilot engine initialized with config")
    
    def activate_autopilot(self) -> None:
        """Activate autopilot mode."""
        with self._lock:
            if self.is_active:
                logger.warning("Autopilot already active")
                return
            
            self.is_active = True
            self.risk_manager.reset_daily_stats()
            logger.info("Autopilot activated")
    
    def deactivate_autopilot(self) -> None:
        """Deactivate autopilot mode."""
        with self._lock:
            if not self.is_active:
                logger.warning("Autopilot already inactive")
                return
            
            self.is_active = False
            # Close any open positions
            if self.current_position is not None:
                logger.info(f"Closing position {self.current_position} on deactivation")
                self.current_position = None
            
            logger.info("Autopilot deactivated")
    
    def process_round(self, round_data: Dict[str, Any]) -> AutopilotDecision:
        """Process a crash round and make automated decision.
        
        Args:
            round_data: Round data including multiplier, timestamp, etc.
            
        Returns:
            AutopilotDecision with action, confidence, and parameters
        """
        with self._lock:
            if not self.is_active:
                raise RuntimeError("Autopilot is not active")
            
            # Check risk limits before processing
            should_stop, reason = self.risk_manager.should_stop_trading()
            if should_stop:
                logger.warning(f"Stopping trading: {reason}")
                self.is_active = False  # lock already held; deactivate inline
                self.current_position = None
                return self._record(self._create_skip_decision(round_data, reason))
            
            try:
                # Collect analysis from enabled plugins
                ceiling_analysis = None
                gap_analysis = None
                
                if self.ceiling_analyzer:
                    ceiling_analysis = self.ceiling_analyzer.analyze_round(round_data).to_dict()
                
                if self.gap_swing_analyzer:
                    gap_analysis = self.gap_swing_analyzer.analyze_round(round_data).to_dict()
                
                # Select strategy
                strategy_decision = self.strategy_selector.select_strategy(
                    ceiling_analysis=ceiling_analysis,
                    gap_analysis=gap_analysis,
                    linguistic_data=round_data.get("linguistic_data")
                )
                
                # Make decision based on strategy and confidence
                decision = self._make_decision(round_data, strategy_decision)
                
                # Assess risk
                risk_assessment = self.risk_manager.assess_position_risk(decision)
                decision.risk_assessment = risk_assessment.to_dict()
                
                # Check if decision meets risk criteria
                if risk_assessment.risk_level.value in ["high", "critical"]:
                    logger.warning(f"High risk decision: {risk_assessment.risk_level.value}")
                    if risk_assessment.risk_score > 0.8:
                        decision = self._create_skip_decision(round_data, "Risk too high")
                
                self._record(decision)
                logger.info(f"Decision made: {decision.action} with confidence {decision.confidence:.2f}")
                return decision
                
            except Exception as e:
                logger.error(f"Error processing round: {e}")
                return self._record(self._create_skip_decision(round_data, f"Processing error: {str(e)}"))
    
    def _record(self, decision: AutopilotDecision) -> AutopilotDecision:
        """Every decision (trade, skip or error) is kept so the history is a complete audit trail."""
        self.last_decision = decision
        self.decision_history.append(decision)
        if len(self.decision_history) > 100:  # Keep last 100 decisions
            self.decision_history.pop(0)
        return decision

    def get_status(self) -> AutopilotStatus:
        """Get current autopilot status.
        
        Returns:
            AutopilotStatus with current state information
        """
        with self._lock:
            win_rate = self.winning_trades / self.total_trades if self.total_trades > 0 else 0.0
            
            # Determine risk level based on daily P&L
            if self.risk_manager.daily_pnl < -self.config.daily_loss_limit * 0.5:
                risk_level = "critical"
            elif self.risk_manager.daily_pnl < -self.config.daily_loss_limit * 0.25:
                risk_level = "high"
            elif self.risk_manager.consecutive_losses >= self.config.max_consecutive_losses * 0.5:
                risk_level = "medium"
            else:
                risk_level = "low"
            
            return AutopilotStatus(
                is_active=self.is_active,
                current_position=self.current_position,
                daily_pnl=self.risk_manager.daily_pnl,
                total_trades=self.total_trades,
                win_rate=win_rate,
                risk_level=risk_level,
                last_decision=self.last_decision,
                consecutive_losses=self.risk_manager.consecutive_losses,
                daily_trades=self.risk_manager.daily_trades,
            )
    
    def update_config(self, config: AutopilotConfig) -> None:
        """Update autopilot configuration.
        
        Args:
            config: New configuration parameters
        """
        with self._lock:
            config.validate()
            self.config = config
            self.risk_manager = RiskManager(config)
            self.strategy_selector = StrategySelector(config)
            logger.info("Autopilot configuration updated")
    
    def get_recent_decisions(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get recent autopilot decisions.
        
        Args:
            limit: Maximum number of decisions to return
            
        Returns:
            List of decision dictionaries
        """
        with self._lock:
            recent = self.decision_history[-limit:] if self.decision_history else []
            return [decision.to_dict() for decision in recent]
    
    def _make_decision(self, round_data: Dict[str, Any], strategy_decision) -> AutopilotDecision:
        """Make trading decision based on strategy and round data.
        
        Args:
            round_data: Current round data
            strategy_decision: Strategy selection from strategy selector
            
        Returns:
            AutopilotDecision with action and parameters
        """
        round_id = round_data.get("round_id", f"round-{datetime.utcnow().timestamp()}")
        multiplier = round_data.get("multiplier", 1.0)
        timestamp = datetime.utcnow()
        
        # Determine action based on strategy confidence
        if strategy_decision.confidence < self.config.min_confidence_threshold:
            action = AutopilotAction.SKIP.value
            position_size = 0.0
        elif strategy_decision.selected_strategy == "conservative":
            action = AutopilotAction.HOLD.value
            position_size = self.risk_manager.calculate_position_size(
                strategy_decision.confidence * 0.7,  # Reduce size for conservative
                {"position_risk_pct": 0.01}
            )
        elif strategy_decision.selected_strategy == "aggressive":
            action = AutopilotAction.ENTER.value
            position_size = self.risk_manager.calculate_position_size(
                strategy_decision.confidence,
                {"position_risk_pct": 0.03}
            )
        else:  # balanced
            action = AutopilotAction.ENTER.value if strategy_decision.confidence > 0.6 else AutopilotAction.HOLD.value
            position_size = self.risk_manager.calculate_position_size(
                strategy_decision.confidence,
                {"position_risk_pct": 0.02}
            )
        
        # Calculate entry, exit, and stop loss points
        entry_point = multiplier
        if action == AutopilotAction.ENTER.value:
            exit_point = multiplier * (1 + strategy_decision.confidence * 0.5)
            stop_loss = multiplier * (1 - 0.1)  # 10% stop loss
        else:
            exit_point = multiplier
            stop_loss = multiplier
        
        return AutopilotDecision(
            round_id=round_id,
            timestamp=timestamp,
            action=action,
            position_size=position_size,
            entry_point=entry_point,
            exit_point=exit_point,
            stop_loss=stop_loss,
            confidence=strategy_decision.confidence,
            primary_signal=strategy_decision.selected_strategy,
            contributing_signals=[strategy_decision.rationale],
            risk_assessment={},
        )
    
    def _create_skip_decision(self, round_data: Dict[str, Any], reason: str) -> AutopilotDecision:
        """Create a skip decision with given reason.
        
        Args:
            round_data: Current round data
            reason: Reason for skipping
            
        Returns:
            AutopilotDecision with skip action
        """
        round_id = round_data.get("round_id", f"round-{datetime.utcnow().timestamp()}")
        multiplier = round_data.get("multiplier", 1.0)
        
        return AutopilotDecision(
            round_id=round_id,
            timestamp=datetime.utcnow(),
            action=AutopilotAction.SKIP.value,
            position_size=0.0,
            entry_point=multiplier,
            exit_point=multiplier,
            stop_loss=multiplier,
            confidence=0.0,
            primary_signal="skip",
            contributing_signals=[reason],
            risk_assessment={"skip_reason": reason},
        )
    
    def record_trade_result(self, round_id: str, pnl: float) -> None:
        """Record the result of a trade.
        
        Args:
            round_id: Round identifier
            pnl: Profit or loss (positive for profit, negative for loss)
        """
        with self._lock:
            self.total_trades += 1
            if pnl > 0:
                self.winning_trades += 1
            
            self.risk_manager.update_daily_pnl(pnl)
            logger.info(f"Trade result recorded: {pnl:.2f} for round {round_id}")
