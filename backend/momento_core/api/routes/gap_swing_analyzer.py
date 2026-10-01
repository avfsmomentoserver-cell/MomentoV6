"""
Gap Swing Analyzer route handlers.

Provides endpoints for gap swing analysis with moving averages and repeat testing.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from momento_core.db.session import get_db_session
from momento_core.plugins.gap_swing import GapSwingAnalyzer, GapDirection, GapStrength
from datetime import datetime
from typing import Optional, Dict, Any, List

router = APIRouter()

# Global analyzer instance (in production, this would be managed properly)
gap_swing_analyzer = GapSwingAnalyzer()

@router.get("/gap-swing-analyzer/analysis")
def get_gap_swing_analysis(
    round_data: Optional[Dict[str, Any]] = None,
    db: Session = Depends(get_db_session)
):
    """
    Get current gap swing analysis for a crash round.
    
    Args:
        round_data: Optional round data to analyze
        db: Database session from dependency injection
        
    Returns:
        Gap swing analysis results including moving averages, gap crossings, and signals
    """
    try:
        # If no round data provided, use simulated data
        if not round_data:
            round_data = {
                "round_id": f"round-{datetime.utcnow().timestamp()}",
                "timestamp": datetime.utcnow().isoformat(),
                "crash_point": 1.0 + hash(datetime.utcnow().timestamp()) % 150 / 10.0
            }
        
        # Perform analysis
        analysis = gap_swing_analyzer.analyze_round(round_data)
        
        return analysis.to_dict()
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gap swing analysis failed: {str(e)}")

@router.get("/gap-swing-analyzer/statistics")
def get_gap_swing_statistics(db: Session = Depends(get_db_session)):
    """
    Get overall gap swing statistics.
    
    Args:
        db: Database session from dependency injection
        
    Returns:
        Gap swing statistics including crossing counts, velocities, and swing patterns
    """
    try:
        stats = gap_swing_analyzer.get_gap_statistics()
        return stats
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gap swing statistics retrieval failed: {str(e)}")

@router.post("/gap-swing-analyzer/configure")
def configure_gap_swing_analyzer(
    config: Dict[str, Any],
    db: Session = Depends(get_db_session)
):
    """
    Configure gap swing analyzer parameters.
    
    Args:
        config: Configuration parameters (ma_periods, gap_levels, repeat_test_iterations, etc.)
        db: Database session from dependency injection
        
    Returns:
        Configuration confirmation
    """
    try:
        # Update analyzer configuration
        if "ma_periods" in config:
            gap_swing_analyzer.ma_periods = config["ma_periods"]
        if "gap_levels" in config:
            gap_swing_analyzer.gap_levels = config["gap_levels"]
        if "repeat_test_iterations" in config:
            gap_swing_analyzer.repeat_test_iterations = config["repeat_test_iterations"]
        
        return {
            "status": "success",
            "message": "Gap swing analyzer configured successfully",
            "config": {
                "ma_periods": gap_swing_analyzer.ma_periods,
                "gap_levels": gap_swing_analyzer.gap_levels,
                "repeat_test_iterations": gap_swing_analyzer.repeat_test_iterations
            }
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Configuration failed: {str(e)}")

@router.post("/gap-swing-analyzer/reset")
def reset_gap_swing_analyzer(db: Session = Depends(get_db_session)):
    """
    Reset gap swing analyzer state.
    
    Args:
        db: Database session from dependency injection
        
    Returns:
        Reset confirmation
    """
    try:
        # Create new analyzer instance
        global gap_swing_analyzer
        gap_swing_analyzer = GapSwingAnalyzer()
        
        return {
            "status": "success",
            "message": "Gap swing analyzer reset successfully"
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reset failed: {str(e)}")

@router.get("/gap-swing-analyzer/historical-crossings")
def get_historical_crossings(
    limit: int = Query(10, description="Number of recent crossings to return"),
    db: Session = Depends(get_db_session)
):
    """
    Get historical gap crossing events.
    
    Args:
        limit: Maximum number of crossings to return
        db: Database session from dependency injection
        
    Returns:
        Historical gap crossing data
    """
    try:
        crossings = gap_swing_analyzer.gap_crossings[-limit:] if gap_swing_analyzer.gap_crossings else []
        
        return {
            "crossings": [
                {
                    "gap_value": crossing.gap_value,
                    "direction": crossing.direction.value,
                    "timestamp": crossing.timestamp.isoformat(),
                    "round_id": crossing.round_id,
                    "crossing_velocity": crossing.crossing_velocity,
                    "crossing_confidence": crossing.crossing_confidence,
                    "success_rate": crossing.calculate_success_rate()
                }
                for crossing in crossings
            ],
            "total_count": len(gap_swing_analyzer.gap_crossings)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Historical crossings retrieval failed: {str(e)}")