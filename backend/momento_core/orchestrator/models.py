"""
Pydantic models for orchestrator data structures.

Defines request/response schemas for the Decision Orchestrator layer,
including execution plans, risk assessments, and session state.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import datetime
from enum import Enum


class ActionType(str, Enum):
    """Types of actions the orchestrator can recommend."""
    WAIT = "wait"
    PLAY = "play"
    STOP = "stop"
    PAUSE = "pause"
    REDUCE_EXPOSURE = "reduce_exposure"
    INCREASE_PATIENCE = "increase_patience"


class RiskLevel(str, Enum):
    """Risk classification levels."""
    EXCELLENT = "excellent"
    GOOD = "good"
    MODERATE = "moderate"
    ELEVATED = "elevated"
    DANGER = "danger"


class SessionState(str, Enum):
    """Session lifecycle states."""
    ACTIVE = "active"
    PAUSED = "paused"
    STOPPED = "stopped"
    COMPLETED = "completed"


class BetSlot(BaseModel):
    """Individual bet slot configuration."""
    
    slot_id: str = Field(..., description="Slot identifier (A, B, C, etc.)")
    amount: float = Field(..., gt=0, description="Bet amount")
    cashout_target: float = Field(..., gt=1.0, description="Target cashout multiplier")
    priority: Literal["high", "medium", "low"] = Field(..., description="Priority level")
    
    class Config:
        schema_extra = {
            "example": {
                "slot_id": "A",
                "amount": 0.50,
                "cashout_target": 4.0,
                "priority": "high"
            }
        }


class ExecutionPlan(BaseModel):
    """Complete execution plan for user action."""
    
    action: ActionType = Field(..., description="Recommended action")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence in this plan")
    reason: str = Field(..., description="Human-readable reason for the action")
    
    # Wait-specific fields
    estimated_wait_rounds: Optional[int] = Field(None, ge=0, description="Estimated rounds to wait")
    estimated_wait_seconds: Optional[int] = Field(None, ge=0, description="Estimated seconds to wait")
    current_probability: Optional[float] = Field(None, ge=0.0, le=1.0, description="Current success probability")
    required_probability: Optional[float] = Field(None, ge=0.0, le=1.0, description="Required probability for entry")
    
    # Play-specific fields
    round_window_start: Optional[int] = Field(None, ge=1, description="Start of entry round window")
    round_window_end: Optional[int] = Field(None, ge=1, description="End of entry round window")
    bet_slots: Optional[List[BetSlot]] = Field(None, description="Bet configurations")
    maximum_attempts: Optional[int] = Field(None, ge=1, description="Maximum attempts before stopping")
    stop_after_attempts: bool = Field(False, description="Whether to stop after max attempts")
    
    # Re-evaluation fields
    reevaluate_after_rounds: Optional[int] = Field(None, ge=1, description="Rounds before re-evaluation")
    expected_confidence: Optional[float] = Field(None, ge=0.0, le=1.0, description="Expected confidence at entry")
    estimated_success: Optional[Literal["low", "medium", "high"]] = Field(None, description="Estimated success level")
    estimated_duration_seconds: Optional[int] = Field(None, ge=0, description="Estimated mission duration")
    
    # Metadata
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat(), description="Plan creation timestamp")
    plan_version: int = Field(1, description="Plan version for tracking updates")
    
    class Config:
        schema_extra = {
            "example": {
                "action": "wait",
                "confidence": 0.72,
                "reason": "Compression not finished",
                "estimated_wait_rounds": 7,
                "estimated_wait_seconds": 126,
                "current_probability": 0.34,
                "required_probability": 0.68,
                "created_at": "2026-07-21T23:25:00Z"
            }
        }


class RiskAssessment(BaseModel):
    """Risk assessment with 0-100 scoring."""
    
    risk_score: int = Field(..., ge=0, le=100, description="Risk score (0-100)")
    risk_level: RiskLevel = Field(..., description="Risk classification")
    factors: List[str] = Field(..., description="List of risk factors contributing to score")
    recommendation: str = Field(..., description="Human-readable recommendation")
    
    # Component scores
    confidence_risk: Optional[int] = Field(None, ge=0, le=100, description="Risk from low confidence")
    volatility_risk: Optional[int] = Field(None, ge=0, le=100, description="Risk from market volatility")
    exposure_risk: Optional[int] = Field(None, ge=0, le=100, description="Risk from position size")
    streak_risk: Optional[int] = Field(None, ge=0, le=100, description="Risk from current streak")
    
    class Config:
        schema_extra = {
            "example": {
                "risk_score": 22,
                "risk_level": "excellent",
                "factors": ["High confidence forecast", "Low volatility", "Conservative position sizing"],
                "recommendation": "Proceed with caution",
                "confidence_risk": 15,
                "volatility_risk": 20,
                "exposure_risk": 25,
                "streak_risk": 10
            }
        }


class BankrollState(BaseModel):
    """Current bankroll and limit state."""
    
    starting_balance: float = Field(..., ge=0, description="Session starting balance")
    current_balance: float = Field(..., ge=0, description="Current balance")
    peak_balance: float = Field(..., ge=0, description="Highest balance achieved")
    current_profit: float = Field(..., description="Current profit (positive or negative)")
    drawdown_amount: float = Field(..., ge=0, description="Current drawdown from peak")
    drawdown_percent: float = Field(..., ge=0, le=100, description="Drawdown as percentage")
    
    # Limits
    daily_target: Optional[float] = Field(None, gt=0, description="Daily profit target")
    daily_target_progress: Optional[float] = Field(None, description="Progress toward daily target (%; >100 = exceeded, <0 = behind)")
    max_loss_allowed: Optional[float] = Field(None, gt=0, description="Maximum allowed loss")
    remaining_loss_allowance: Optional[float] = Field(None, ge=0, description="Remaining loss allowance")
    
    class Config:
        schema_extra = {
            "example": {
                "starting_balance": 100.0,
                "current_balance": 120.0,
                "peak_balance": 125.0,
                "current_profit": 20.0,
                "drawdown_amount": 5.0,
                "drawdown_percent": 4.0,
                "daily_target": 15.0,
                "daily_target_progress": 133.33,
                "max_loss_allowed": 30.0,
                "remaining_loss_allowance": 10.0
            }
        }


class SessionConfig(BaseModel):
    """Session configuration parameters."""
    
    user_id: str = Field(..., description="User identifier")
    session_id: str = Field(..., description="Session identifier")
    
    # Financial parameters
    starting_balance: float = Field(..., gt=0, description="Starting balance")
    daily_target: Optional[float] = Field(None, gt=0, description="Daily profit target")
    max_loss: Optional[float] = Field(None, gt=0, description="Maximum loss limit")
    
    # Risk parameters
    risk_profile: Literal["conservative", "moderate", "aggressive"] = Field("moderate", description="Risk tolerance")
    max_stake_percent: float = Field(5.0, gt=0, le=100, description="Maximum stake as % of balance")
    
    # Time parameters
    time_available_minutes: Optional[int] = Field(None, gt=0, description="Available time in minutes")
    
    # Strategy parameters
    min_confidence_threshold: float = Field(0.65, ge=0.5, le=0.99, description="Minimum confidence for entry")
    max_patience_rounds: int = Field(20, ge=1, description="Maximum rounds to wait before forcing action")
    
    class Config:
        schema_extra = {
            "example": {
                "user_id": "user_123",
                "session_id": "session_456",
                "starting_balance": 100.0,
                "daily_target": 15.0,
                "max_loss": 30.0,
                "risk_profile": "moderate",
                "max_stake_percent": 5.0,
                "time_available_minutes": 60,
                "min_confidence_threshold": 0.65,
                "max_patience_rounds": 20
            }
        }


class SessionStatus(BaseModel):
    """Current session status and recommendation."""
    
    session_id: str = Field(..., description="Session identifier")
    state: SessionState = Field(..., description="Current session state")
    recommendation: ActionType = Field(..., description="Recommended action")
    reason: str = Field(..., description="Reason for recommendation")
    
    # Progress tracking
    rounds_played: int = Field(0, ge=0, description="Rounds played in session")
    rounds_waited: int = Field(0, ge=0, description="Rounds waited in session")
    session_duration_seconds: int = Field(0, ge=0, description="Session duration in seconds")
    
    # Performance
    win_rate: Optional[float] = Field(None, ge=0, le=1, description="Session win rate")
    total_profit: Optional[float] = Field(None, description="Total session profit")
    
    class Config:
        schema_extra = {
            "example": {
                "session_id": "session_456",
                "state": "active",
                "recommendation": "stop",
                "reason": "Today's objective achieved. Risk of giving profit back is increasing.",
                "rounds_played": 15,
                "rounds_waited": 23,
                "session_duration_seconds": 1800,
                "win_rate": 0.73,
                "total_profit": 14.0
            }
        }


class PatienceState(BaseModel):
    """Patience engine state for wait visualization."""
    
    patience_percent: int = Field(..., ge=0, le=100, description="Patience meter percentage")
    estimated_time_remaining_seconds: int = Field(..., ge=0, description="Estimated time remaining")
    rounds_remaining: int = Field(..., ge=0, description="Rounds remaining before entry")
    current_probability: float = Field(..., ge=0, le=1, description="Current success probability")
    required_probability: float = Field(..., ge=0, le=1, description="Required probability for entry")
    message: str = Field(..., description="Human-readable patience message")
    
    class Config:
        schema_extra = {
            "example": {
                "patience_percent": 64,
                "estimated_time_remaining_seconds": 130,
                "rounds_remaining": 7,
                "current_probability": 0.34,
                "required_probability": 0.68,
                "message": "Market not ready. Wait."
            }
        }


class SpeedAssessment(BaseModel):
    """Market speed/chaos assessment."""
    
    rounds_per_minute: float = Field(..., ge=0, description="Current rounds per minute")
    latency_ms: Optional[float] = Field(None, ge=0, description="Average latency in milliseconds")
    volatility_score: int = Field(..., ge=0, le=100, description="Volatility score (0-100)")
    phase_change_detected: bool = Field(False, description="Whether phase change detected")
    noise_level: int = Field(..., ge=0, le=100, description="Noise level (0-100)")
    cluster_density: float = Field(..., ge=0, le=1, description="Cluster density (0-1)")
    
    # Recommendation
    market_classification: Literal["normal", "fast", "chaotic"] = Field(..., description="Market speed classification")
    recommendation: str = Field(..., description="Speed-based recommendation")
    
    class Config:
        schema_extra = {
            "example": {
                "rounds_per_minute": 8.5,
                "latency_ms": 45.0,
                "volatility_score": 72,
                "phase_change_detected": True,
                "noise_level": 65,
                "cluster_density": 0.78,
                "market_classification": "fast",
                "recommendation": "Reduce exposure. Recommended half stake. Increase wait window."
            }
        }


class ActionValidation(BaseModel):
    """Validation result for user action."""
    
    action_valid: bool = Field(..., description="Whether the action is valid")
    warning_level: Literal["none", "info", "warning", "error"] = Field(..., description="Warning level")
    message: str = Field(..., description="Human-readable message")
    
    # Specific validations
    entry_window_active: Optional[bool] = Field(None, description="Whether entry window is active")
    confidence_impact: Optional[dict] = Field(None, description="Confidence impact if action taken")
    stake_increase_percent: Optional[float] = Field(None, description="Stake increase percentage")
    risk_increase_percent: Optional[float] = Field(None, description="Risk increase percentage")
    
    class Config:
        schema_extra = {
            "example": {
                "action_valid": False,
                "warning_level": "warning",
                "message": "Entry window NOT reached. Recommendation: Cancel bet.",
                "entry_window_active": False,
                "confidence_impact": {"before": 0.73, "after": 0.39},
                "stake_increase_percent": 300.0,
                "risk_increase_percent": 240.0
            }
        }


class ChecklistItem(BaseModel):
    """Individual checklist item."""
    
    item: str = Field(..., description="Checklist item description")
    passed: bool = Field(..., description="Whether item passed")
    message: Optional[str] = Field(None, description="Additional message if failed")


class PreActionChecklist(BaseModel):
    """Pre-action checklist validation."""
    
    all_passed: bool = Field(..., description="Whether all items passed")
    items: List[ChecklistItem] = Field(..., description="List of checklist items")
    ready_to_proceed: bool = Field(..., description="Whether ready to proceed with action")
    
    class Config:
        schema_extra = {
            "example": {
                "all_passed": True,
                "items": [
                    {"item": "Confidence above threshold", "passed": True},
                    {"item": "Balance OK", "passed": True},
                    {"item": "Session active", "passed": True},
                    {"item": "Loss limit not reached", "passed": True},
                    {"item": "Entry window active", "passed": True},
                    {"item": "Phase confirmed", "passed": True},
                    {"item": "DNA match acceptable", "passed": True},
                    {"item": "Forecast fresh", "passed": True}
                ],
                "ready_to_proceed": True
            }
        }


class InstructionMessage(BaseModel):
    """Natural language instruction message."""
    
    message_type: Literal["guidance", "warning", "error", "success", "info"] = Field(..., description="Message type")
    content: str = Field(..., description="Message content")
    priority: Literal["low", "medium", "high", "critical"] = Field(..., description="Message priority")
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat(), description="Message timestamp")
    
    class Config:
        schema_extra = {
            "example": {
                "message_type": "guidance",
                "content": "Good patience. Keep waiting. Only 3 rounds left.",
                "priority": "medium",
                "timestamp": "2026-07-21T23:25:00Z"
            }
        }


class OrchestratorState(BaseModel):
    """Complete orchestrator state."""
    
    execution_plan: ExecutionPlan = Field(..., description="Current execution plan")
    risk_assessment: RiskAssessment = Field(..., description="Current risk assessment")
    bankroll_state: BankrollState = Field(..., description="Current bankroll state")
    session_status: SessionStatus = Field(..., description="Current session status")
    patience_state: Optional[PatienceState] = Field(None, description="Patience state if waiting")
    speed_assessment: Optional[SpeedAssessment] = Field(None, description="Speed assessment if available")
    checklist: Optional[PreActionChecklist] = Field(None, description="Pre-action checklist if applicable")
    
    # Metadata
    last_updated: str = Field(default_factory=lambda: datetime.utcnow().isoformat(), description="Last update timestamp")
    state_version: int = Field(1, description="State version for tracking updates")
    
    class Config:
        schema_extra = {
            "example": {
                "execution_plan": {
                    "action": "wait",
                    "confidence": 0.72,
                    "reason": "Compression not finished"
                },
                "risk_assessment": {
                    "risk_score": 22,
                    "risk_level": "excellent",
                    "recommendation": "Proceed"
                },
                "bankroll_state": {
                    "current_balance": 120.0,
                    "current_profit": 20.0
                },
                "session_status": {
                    "state": "active",
                    "recommendation": "continue"
                },
                "last_updated": "2026-07-21T23:25:00Z"
            }
        }
