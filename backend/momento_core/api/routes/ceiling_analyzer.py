"""
Ceiling Analyzer route handlers.

Provides endpoints for collapse ceiling analysis and ascend power calculations.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from momento_core.db.session import get_db_session
from momento_core.plugins.collapse_ceiling import CollapseCeilingAnalyzer, CeilingDirection, CeilingStrength
from datetime import datetime
from typing import Optional, Dict, Any

router = APIRouter()

# Global analyzer instance (in production, this would be managed properly)
ceiling_analyzer = CollapseCeilingAnalyzer()

@router.get("/ceiling-analyzer/analysis")
def get_ceiling_analysis(
    round_data: Optional[Dict[str, Any]] = None,
    db: Session = Depends(get_db_session)
):
    """
    Get current ceiling analysis for a crash round.
    
    Args:
        round_data: Optional round data to analyze
        db: Database session from dependency injection
        
    Returns:
        Ceiling analysis results including ceiling detection, ascend power, and signals
    """
    try:
        # If no round data provided, use simulated data
        if not round_data:
            round_data = {
                "round_id": f"round-{datetime.utcnow().timestamp()}",
                "timestamp": datetime.utcnow().isoformat(),
                "crash_point": 1.0 + hash(datetime.utcnow().timestamp()) % 100 / 10.0
            }
        
        # Perform analysis
        analysis = ceiling_analyzer.analyze_round(round_data)
        
        return analysis.to_dict()
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ceiling analysis failed: {str(e)}")

@router.get("/ceiling-analyzer/statistics")
def get_ceiling_statistics(db: Session = Depends(get_db_session)):
    """
    Get overall ceiling statistics.
    
    Args:
        db: Database session from dependency injection
        
    Returns:
        Ceiling statistics including total ceilings, averages, and direction trends
    """
    try:
        stats = ceiling_analyzer.get_ceiling_statistics()
        return stats
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ceiling statistics retrieval failed: {str(e)}")

@router.post("/ceiling-analyzer/configure")
def configure_ceiling_analyzer(
    config: Dict[str, Any],
    db: Session = Depends(get_db_session)
):
    """
    Configure ceiling analyzer parameters.
    
    Args:
        config: Configuration parameters (window_size, ceiling_threshold, etc.)
        db: Database session from dependency injection
        
    Returns:
        Configuration confirmation
    """
    try:
        # Update analyzer configuration
        if "window_size" in config:
            ceiling_analyzer.window_size = config["window_size"]
        if "ceiling_threshold" in config:
            ceiling_analyzer.ceiling_threshold = config["ceiling_threshold"]
        
        return {
            "status": "success",
            "message": "Ceiling analyzer configured successfully",
            "config": {
                "window_size": ceiling_analyzer.window_size,
                "ceiling_threshold": ceiling_analyzer.ceiling_threshold
            }
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Configuration failed: {str(e)}")

@router.post("/ceiling-analyzer/reset")
def reset_ceiling_analyzer(db: Session = Depends(get_db_session)):
    """
    Reset ceiling analyzer state.
    
    Args:
        db: Database session from dependency injection
        
    Returns:
        Reset confirmation
    """
    try:
        # Create new analyzer instance
        global ceiling_analyzer
        ceiling_analyzer = CollapseCeilingAnalyzer()
        
        return {
            "status": "success",
            "message": "Ceiling analyzer reset successfully"
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reset failed: {str(e)}")