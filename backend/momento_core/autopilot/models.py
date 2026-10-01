"""
Data models for autopilot system.

Defines configuration, decision, and status models for automated trading operations.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional
from enum import Enum


class AutopilotAction(Enum):
    """Possible autopilot actions for a round."""
    ENTER = "enter"
    EXIT = "exit"
    HOLD = "hold"
    SKIP = "skip"


class RiskLevel(Enum):
    """Risk level categories."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class PositionSizingMethod(Enum):
    """Position sizing calculation methods."""
    FIXED = "fixed"
    KELLY = "kelly"
    PERCENTAGE = "percentage"


@dataclass
class AutopilotConfig:
    """Autopilot configuration parameters."""
    
    # Risk management
    max_risk_per_round: float = 0.02  # 2% max risk per round
    daily_loss_limit: float = 0.10  # 10% daily loss limit
    max_consecutive_losses: int = 5
    
    # Strategy selection
    enable_ceiling_analyzer: bool = True
    enable_gap_swing_analyzer: bool = True
    enable_linguistic_analysis: bool = True
    
    # Execution parameters
    min_confidence_threshold: float = 0.75
    execution_delay_ms: int = 100
    
    # Position sizing
    base_position_size: float = 1.0
    position_sizing_method: str = "fixed"  # fixed, kelly, percentage
    
    # Plugin weights
    ceiling_analyzer_weight: float = 0.4
    gap_swing_analyzer_weight: float = 0.3
    linguistic_analysis_weight: float = 0.3
    
    def validate(self) -> bool:
        """Validate configuration parameters."""
        if not 0 < self.max_risk_per_round <= 0.10:
            raise ValueError("max_risk_per_round must be between 0 and 0.10")
        if not 0 < self.daily_loss_limit <= 0.50:
            raise ValueError("daily_loss_limit must be between 0 and 0.50")
        if not 0 < self.min_confidence_threshold <= 1.0:
            raise ValueError("min_confidence_threshold must be between 0 and 1")
        if self.position_sizing_method not in ["fixed", "kelly", "percentage"]:
            raise ValueError("position_sizing_method must be fixed, kelly, or percentage")
        return True


@dataclass
class AutopilotDecision:
    """Autopilot decision for current round."""
    
    round_id: str
    timestamp: datetime
    action: str  # "enter", "exit", "hold", "skip"
    position_size: float
    entry_point: float
    exit_point: float
    stop_loss: float
    confidence: float
    
    # Decision rationale
    primary_signal: str
    contributing_signals: List[str] = field(default_factory=list)
    risk_assessment: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert decision to dictionary for API responses."""
        return {
            "round_id": self.round_id,
            "timestamp": self.timestamp.isoformat(),
            "action": self.action,
            "position_size": self.position_size,
            "entry_point": self.entry_point,
            "exit_point": self.exit_point,
            "stop_loss": self.stop_loss,
            "confidence": self.confidence,
            "primary_signal": self.primary_signal,
            "contributing_signals": self.contributing_signals,
            "risk_assessment": self.risk_assessment,
        }


@dataclass
class AutopilotStatus:
    """Current autopilot status."""
    
    is_active: bool
    current_position: Optional[float]
    daily_pnl: float
    total_trades: int
    win_rate: float
    risk_level: str
    last_decision: Optional[AutopilotDecision] = None
    consecutive_losses: int = 0
    daily_trades: int = 0
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert status to dictionary for API responses."""
        return {
            "is_active": self.is_active,
            "current_position": self.current_position,
            "daily_pnl": self.daily_pnl,
            "total_trades": self.total_trades,
            "win_rate": self.win_rate,
            "risk_level": self.risk_level,
            "last_decision": self.last_decision.to_dict() if self.last_decision else None,
            "consecutive_losses": self.consecutive_losses,
            "daily_trades": self.daily_trades,
        }


@dataclass
class RiskAssessment:
    """Risk assessment for a proposed decision."""
    
    risk_score: float  # 0-1 scale
    risk_level: RiskLevel
    position_risk_pct: float
    portfolio_risk_pct: float
    recommended_position_size: float
    warnings: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert assessment to dictionary."""
        return {
            "risk_score": self.risk_score,
            "risk_level": self.risk_level.value,
            "position_risk_pct": self.position_risk_pct,
            "portfolio_risk_pct": self.portfolio_risk_pct,
            "recommended_position_size": self.recommended_position_size,
            "warnings": self.warnings,
        }


@dataclass
class StrategyDecision:
    """Strategy selection decision."""
    
    selected_strategy: str
    confidence: float
    rationale: str
    alternative_strategies: List[Dict[str, Any]] = field(default_factory=list)
    expected_outcome: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert decision to dictionary."""
        return {
            "selected_strategy": self.selected_strategy,
            "confidence": self.confidence,
            "rationale": self.rationale,
            "alternative_strategies": self.alternative_strategies,
            "expected_outcome": self.expected_outcome,
        }


@dataclass
class SignalEvent:
    """Signal event from analysis plugins."""
    
    source: str  # Plugin name
    signal_type: str
    value: float
    confidence: float
    timestamp: datetime
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert signal to dictionary."""
        return {
            "source": self.source,
            "signal_type": self.signal_type,
            "value": self.value,
            "confidence": self.confidence,
            "timestamp": self.timestamp.isoformat(),
            "metadata": self.metadata,
        }
