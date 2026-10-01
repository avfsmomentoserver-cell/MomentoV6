"""
Forecast retrieval route handlers.

Provides GET /forecasts endpoint for retrieving forecast results.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from momento_core.db.session import get_db_session
from momento_core.api.models.forecasts import ForecastQuery, ForecastResponse
from momento_core.api.services.forecast_service import ForecastService
from typing import Optional

router = APIRouter()


@router.get("/forecasts", response_model=ForecastResponse)
def get_forecasts(
    model_type: Optional[str] = Query(None, description="Filter by model type"),
    min_horizon: Optional[int] = Query(None, ge=1, description="Minimum horizon periods"),
    max_horizon: Optional[int] = Query(None, ge=1, description="Maximum horizon periods"),
    min_confidence: Optional[float] = Query(None, ge=0.5, le=0.99, description="Minimum confidence level"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of results"),
    db: Session = Depends(get_db_session)
) -> ForecastResponse:
    """
    Retrieve forecast results from the database.
    
    This endpoint returns predictive model outputs including forecasted values,
    confidence intervals, and model metadata.
    
    Args:
        model_type: Optional filter by model type (arima, prophet, etc.)
        min_horizon: Optional minimum horizon periods filter
        max_horizon: Optional maximum horizon periods filter
        min_confidence: Optional minimum confidence level filter (0.5-0.99)
        limit: Maximum number of results to return (1-1000)
        db: Database session from dependency injection
        
    Returns:
        ForecastResponse: List of forecast results matching query parameters
        
    Raises:
        HTTPException: 400 if query parameters are invalid, 500 on server error
    """
    try:
        # Build query object
        query = ForecastQuery(
            model_type=model_type,
            min_horizon=min_horizon,
            max_horizon=max_horizon,
            min_confidence=min_confidence,
            limit=limit
        )
        
        # Delegate to service function for business logic
        forecast_service = ForecastService(db)
        result = forecast_service.get_forecasts(query)
        
        return result
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Forecast retrieval failed: {str(e)}")
