"""
Risk management system for autopilot operations.

Handles position sizing, risk assessment, and limit enforcement.
"""

from typing import Dict, Any, Tuple, Optional
from momento_core.autopilot.models import (
    AutopilotConfig,
    AutopilotDecision,
    RiskAssessment,
    RiskLevel,
)


class RiskManager:
    """Risk management system for autopilot operations."""
    
    def __init__(self, config: AutopilotConfig):
        """Initialize risk manager with configuration.
        
        Args:
            config: Autopilot configuration parameters
        """
        self.config = config
        self.daily_pnl = 0.0
        self.consecutive_losses = 0
        self.daily_trades = 0
        
    def assess_position_risk(self, decision: AutopilotDecision) -> RiskAssessment:
        """Assess risk for proposed position.
        
        Args:
            decision: Proposed autopilot decision
            
        Returns:
            RiskAssessment with risk score and recommendations
        """
        # Calculate position risk as percentage of position size
        position_risk_pct = abs(decision.stop_loss - decision.entry_point) / decision.entry_point
        
        # Calculate portfolio risk based on position size
        portfolio_risk_pct = position_risk_pct * decision.position_size
        
        # Calculate overall risk score (0-1)
        risk_score = min(1.0, portfolio_risk_pct / self.config.max_risk_per_round)
        
        # Determine risk level
        if risk_score < 0.3:
            risk_level = RiskLevel.LOW
        elif risk_score < 0.6:
            risk_level = RiskLevel.MEDIUM
        elif risk_score < 0.8:
            risk_level = RiskLevel.HIGH
        else:
            risk_level = RiskLevel.CRITICAL
        
        # Generate warnings
        warnings = []
        if portfolio_risk_pct > self.config.max_risk_per_round:
            warnings.append(f"Position risk {portfolio_risk_pct:.2%} exceeds max {self.config.max_risk_per_round:.2%}")
        if decision.confidence < self.config.min_confidence_threshold:
            warnings.append(f"Decision confidence {decision.confidence:.2f} below threshold {self.config.min_confidence_threshold:.2f}")
        
        # Recommend position size based on risk
        recommended_size = self.calculate_position_size(
            decision.confidence,
            {"position_risk_pct": position_risk_pct}
        )
        
        return RiskAssessment(
            risk_score=risk_score,
            risk_level=risk_level,
            position_risk_pct=position_risk_pct,
            portfolio_risk_pct=portfolio_risk_pct,
            recommended_position_size=recommended_size,
            warnings=warnings,
        )
    
    def check_risk_limits(self) -> bool:
        """Check if current risk limits are exceeded.
        
        Returns:
            True if within limits, False if limits exceeded
        """
        # Check daily loss limit
        if self.daily_pnl < -self.config.daily_loss_limit:
            return False
        
        # Check consecutive losses
        if self.consecutive_losses >= self.config.max_consecutive_losses:
            return False
        
        return True
    
    def calculate_position_size(self, confidence: float, risk_params: Dict[str, Any]) -> float:
        """Calculate optimal position size based on risk parameters.
        
        Args:
            confidence: Decision confidence score
            risk_params: Additional risk parameters
            
        Returns:
            Calculated position size
        """
        position_risk_pct = risk_params.get("position_risk_pct", 0.02)
        
        if self.config.position_sizing_method == "fixed":
            return self.config.base_position_size
        
        elif self.config.position_sizing_method == "percentage":
            # Scale position by confidence and risk
            risk_adjusted_size = self.config.base_position_size * confidence
            max_size = self.config.max_risk_per_round / position_risk_pct if position_risk_pct > 0 else self.config.base_position_size
            return min(risk_adjusted_size, max_size)
        
        elif self.config.position_sizing_method == "kelly":
            # Kelly criterion: f* = (bp - q) / b
            # Simplified version using confidence as win probability
            win_prob = confidence
            loss_prob = 1 - win_prob
            avg_win_loss_ratio = 2.0  # Assume average win is 2x average loss
            
            kelly_fraction = (avg_win_loss_ratio * win_prob - loss_prob) / avg_win_loss_ratio
            kelly_fraction = max(0, min(kelly_fraction, 0.25))  # Cap at 25% for safety
            
            return self.config.base_position_size * kelly_fraction * 4  # Scale to base size
        
        else:
            return self.config.base_position_size
    
    def should_stop_trading(self) -> Tuple[bool, str]:
        """Determine if trading should be stopped due to risk limits.
        
        Returns:
            Tuple of (should_stop, reason)
        """
        if self.daily_pnl < -self.config.daily_loss_limit:
            return True, f"Daily loss limit exceeded: {self.daily_pnl:.2%} < -{self.config.daily_loss_limit:.2%}"
        
        if self.consecutive_losses >= self.config.max_consecutive_losses:
            return True, f"Consecutive losses limit reached: {self.consecutive_losses} >= {self.config.max_consecutive_losses}"
        
        return False, ""
    
    def update_daily_pnl(self, pnl: float) -> None:
        """Update daily P&L after a trade.
        
        Args:
            pnl: Profit or loss from trade (positive for profit, negative for loss)
        """
        self.daily_pnl += pnl
        self.daily_trades += 1
        
        if pnl < 0:
            self.consecutive_losses += 1
        else:
            self.consecutive_losses = 0
    
    def reset_daily_stats(self) -> None:
        """Reset daily statistics for new trading session."""
        self.daily_pnl = 0.0
        self.consecutive_losses = 0
        self.daily_trades = 0
