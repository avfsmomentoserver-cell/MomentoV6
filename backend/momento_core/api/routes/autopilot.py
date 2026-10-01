"""
Autopilot route handlers.

Provides endpoints for autopilot activation, configuration, and monitoring.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from momento_core.db.session import get_db_session
from momento_core.autopilot.models import AutopilotConfig, AutopilotStatus
from momento_core.autopilot.engine import AutopilotEngine
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional, List
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

# Global autopilot engine instance (in production, use proper dependency injection)
_autopilot_engine: Optional[AutopilotEngine] = None


def get_autopilot_engine() -> AutopilotEngine:
    """Get or create the autopilot engine instance."""
    global _autopilot_engine
    if _autopilot_engine is None:
        _autopilot_engine = AutopilotEngine(AutopilotConfig())
    return _autopilot_engine


class AutopilotConfigRequest(BaseModel):
    """Request model for autopilot configuration."""
    
    # Risk management
    max_risk_per_round: float = Field(default=0.02, ge=0.0, le=0.10, description="Max risk per round (0-10%)")
    daily_loss_limit: float = Field(default=0.10, ge=0.0, le=0.50, description="Daily loss limit (0-50%)")
    max_consecutive_losses: int = Field(default=5, ge=1, le=20, description="Max consecutive losses")
    
    # Strategy selection
    enable_ceiling_analyzer: bool = Field(default=True, description="Enable ceiling analyzer")
    enable_gap_swing_analyzer: bool = Field(default=True, description="Enable gap swing analyzer")
    enable_linguistic_analysis: bool = Field(default=True, description="Enable linguistic analysis")
    
    # Execution parameters
    min_confidence_threshold: float = Field(default=0.75, ge=0.0, le=1.0, description="Min confidence threshold")
    execution_delay_ms: int = Field(default=100, ge=0, le=1000, description="Execution delay in milliseconds")
    
    # Position sizing
    base_position_size: float = Field(default=1.0, gt=0.0, description="Base position size")
    position_sizing_method: str = Field(default="fixed", description="Position sizing method")
    
    # Plugin weights
    ceiling_analyzer_weight: float = Field(default=0.4, ge=0.0, le=1.0, description="Ceiling analyzer weight")
    gap_swing_analyzer_weight: float = Field(default=0.3, ge=0.0, le=1.0, description="Gap swing analyzer weight")
    linguistic_analysis_weight: float = Field(default=0.3, ge=0.0, le=1.0, description="Linguistic analysis weight")
    
    def to_autopilot_config(self) -> AutopilotConfig:
        """Convert to AutopilotConfig model."""
        return AutopilotConfig(
            max_risk_per_round=self.max_risk_per_round,
            daily_loss_limit=self.daily_loss_limit,
            max_consecutive_losses=self.max_consecutive_losses,
            enable_ceiling_analyzer=self.enable_ceiling_analyzer,
            enable_gap_swing_analyzer=self.enable_gap_swing_analyzer,
            enable_linguistic_analysis=self.enable_linguistic_analysis,
            min_confidence_threshold=self.min_confidence_threshold,
            execution_delay_ms=self.execution_delay_ms,
            base_position_size=self.base_position_size,
            position_sizing_method=self.position_sizing_method,
            ceiling_analyzer_weight=self.ceiling_analyzer_weight,
            gap_swing_analyzer_weight=self.gap_swing_analyzer_weight,
            linguistic_analysis_weight=self.linguistic_analysis_weight,
        )


class RoundProcessRequest(BaseModel):
    """Request model for processing a round."""
    
    round_id: str = Field(..., description="Round identifier")
    multiplier: float = Field(..., gt=0.0, description="Round multiplier")
    timestamp: Optional[str] = Field(None, description="Round timestamp")
    linguistic_data: Optional[Dict[str, Any]] = Field(None, description="Linguistic analysis data")


@router.post("/autopilot/activate")
async def activate_autopilot(
    config: Optional[AutopilotConfigRequest] = None,
    db: Session = Depends(get_db_session)
):
    """Activate autopilot with given configuration.
    
    Args:
        config: Optional autopilot configuration
        db: Database session from dependency injection
        
    Returns:
        Activation confirmation with current status
    """
    try:
        engine = get_autopilot_engine()
        
        if config:
            engine.update_config(config.to_autopilot_config())
        
        engine.activate_autopilot()
        status = engine.get_status()
        
        return {
            "status": "success",
            "message": "Autopilot activated successfully",
            "autopilot_status": status.to_dict()
        }
        
    except Exception as e:
        logger.error(f"Autopilot activation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Autopilot activation failed: {str(e)}")


@router.post("/autopilot/deactivate")
async def deactivate_autopilot(db: Session = Depends(get_db_session)):
    """Deactivate autopilot.
    
    Args:
        db: Database session from dependency injection
        
    Returns:
        Deactivation confirmation
    """
    try:
        engine = get_autopilot_engine()
        engine.deactivate_autopilot()
        
        return {
            "status": "success",
            "message": "Autopilot deactivated successfully"
        }
        
    except Exception as e:
        logger.error(f"Autopilot deactivation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Autopilot deactivation failed: {str(e)}")


@router.get("/autopilot/status")
async def get_autopilot_status(db: Session = Depends(get_db_session)):
    """Get current autopilot status.
    
    Args:
        db: Database session from dependency injection
        
    Returns:
        Current autopilot status
    """
    try:
        engine = get_autopilot_engine()
        status = engine.get_status()
        
        return {
            "status": "success",
            "autopilot_status": status.to_dict()
        }
        
    except Exception as e:
        logger.error(f"Autopilot status retrieval failed: {e}")
        raise HTTPException(status_code=500, detail=f"Autopilot status retrieval failed: {str(e)}")


@router.get("/autopilot/decisions")
async def get_recent_decisions(
    limit: int = Query(10, ge=1, le=100, description="Number of recent decisions to return"),
    db: Session = Depends(get_db_session)
):
    """Get recent autopilot decisions.
    
    Args:
        limit: Maximum number of decisions to return
        db: Database session from dependency injection
        
    Returns:
        List of recent autopilot decisions
    """
    try:
        engine = get_autopilot_engine()
        decisions = engine.get_recent_decisions(limit)
        
        return {
            "status": "success",
            "decisions": decisions,
            "count": len(decisions)
        }
        
    except Exception as e:
        logger.error(f"Autopilot decisions retrieval failed: {e}")
        raise HTTPException(status_code=500, detail=f"Autopilot decisions retrieval failed: {str(e)}")


@router.post("/autopilot/config")
async def update_autopilot_config(
    config: AutopilotConfigRequest,
    db: Session = Depends(get_db_session)
):
    """Update autopilot configuration.
    
    Args:
        config: New autopilot configuration
        db: Database session from dependency injection
        
    Returns:
        Configuration update confirmation
    """
    try:
        engine = get_autopilot_engine()
        engine.update_config(config.to_autopilot_config())
        
        return {
            "status": "success",
            "message": "Autopilot configuration updated successfully",
            "config": config.dict()
        }
        
    except Exception as e:
        logger.error(f"Autopilot configuration update failed: {e}")
        raise HTTPException(status_code=500, detail=f"Autopilot configuration update failed: {str(e)}")


@router.post("/autopilot/process")
async def process_round(
    round_data: RoundProcessRequest,
    db: Session = Depends(get_db_session)
):
    """Process a crash round and get autopilot decision.
    
    Args:
        round_data: Round data to process
        db: Database session from dependency injection
        
    Returns:
        Autopilot decision for the round
    """
    try:
        engine = get_autopilot_engine()
        
        # Convert request to dict
        round_dict = round_data.dict()
        if round_data.timestamp:
            round_dict["timestamp"] = round_data.timestamp
        
        decision = engine.process_round(round_dict)
        
        return {
            "status": "success",
            "decision": decision.to_dict()
        }
        
    except RuntimeError as e:
        if "not active" in str(e):
            raise HTTPException(status_code=400, detail="Autopilot is not active. Activate it first.")
        raise
    except Exception as e:
        logger.error(f"Round processing failed: {e}")
        raise HTTPException(status_code=500, detail=f"Round processing failed: {str(e)}")


@router.post("/autopilot/trade-result")
async def record_trade_result(
    round_id: str,
    pnl: float,
    db: Session = Depends(get_db_session)
):
    """Record the result of a trade.
    
    Args:
        round_id: Round identifier
        pnl: Profit or loss (positive for profit, negative for loss)
        db: Database session from dependency injection
        
    Returns:
        Recording confirmation
    """
    try:
        engine = get_autopilot_engine()
        engine.record_trade_result(round_id, pnl)
        
        return {
            "status": "success",
            "message": f"Trade result recorded: {pnl:.2f}"
        }
        
    except Exception as e:
        logger.error(f"Trade result recording failed: {e}")
        raise HTTPException(status_code=500, detail=f"Trade result recording failed: {str(e)}")


@router.get("/autopilot/config")
async def get_autopilot_config(db: Session = Depends(get_db_session)):
    """Get current autopilot configuration.
    
    Args:
        db: Database session from dependency injection
        
    Returns:
        Current autopilot configuration
    """
    try:
        engine = get_autopilot_engine()
        
        return {
            "status": "success",
            "config": {
                "max_risk_per_round": engine.config.max_risk_per_round,
                "daily_loss_limit": engine.config.daily_loss_limit,
                "max_consecutive_losses": engine.config.max_consecutive_losses,
                "enable_ceiling_analyzer": engine.config.enable_ceiling_analyzer,
                "enable_gap_swing_analyzer": engine.config.enable_gap_swing_analyzer,
                "enable_linguistic_analysis": engine.config.enable_linguistic_analysis,
                "min_confidence_threshold": engine.config.min_confidence_threshold,
                "execution_delay_ms": engine.config.execution_delay_ms,
                "base_position_size": engine.config.base_position_size,
                "position_sizing_method": engine.config.position_sizing_method,
                "ceiling_analyzer_weight": engine.config.ceiling_analyzer_weight,
                "gap_swing_analyzer_weight": engine.config.gap_swing_analyzer_weight,
                "linguistic_analysis_weight": engine.config.linguistic_analysis_weight,
            }
        }
        
    except Exception as e:
        logger.error(f"Autopilot config retrieval failed: {e}")
        raise HTTPException(status_code=500, detail=f"Autopilot config retrieval failed: {str(e)}")
