"""
Analysis retrieval route handlers.

Provides GET /analysis endpoint for retrieving current analysis state.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from momento_core.db.session import get_db_session
from momento_core.api.services.analysis_service import AnalysisService
from typing import Optional

router = APIRouter()

@router.get("/analysis")
def get_analysis(
    source: str = Query("aviator", description="Data source identifier"),
    db: Session = Depends(get_db_session)
):
    """
    Retrieve current analysis state.
    
    This endpoint returns the current analysis results including state,
    predictions, signals, and other computed metrics.
    
    Args:
        source: Data source identifier (default: "aviator")
        db: Database session from dependency injection
        
    Returns:
        Analysis data including state, predictions, signals, etc.
    """
    try:
        # Delegate to service layer for business logic
        analysis_service = AnalysisService(db)
        analysis_data = analysis_service.get_analysis(source)
        
        return analysis_data
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis retrieval failed: {str(e)}")
