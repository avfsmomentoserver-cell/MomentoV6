"""
Metrics retrieval route handlers.

Provides GET /metrics endpoint for retrieving computed metrics.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from momento_core.db.session import get_db_session
from momento_core.api.models.metrics import MetricsQuery, MetricsResponse, MetricData
from momento_core.api.services.metrics_service import MetricsService
from typing import Optional

router = APIRouter()


@router.get("/metrics", response_model=MetricsResponse)
def get_metrics(
    start_date: Optional[str] = Query(None, description="Start date in ISO format"),
    end_date: Optional[str] = Query(None, description="End date in ISO format"),
    metric_type: Optional[str] = Query(None, description="Filter by metric type"),
    metric_name: Optional[str] = Query(None, description="Filter by metric name"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of results"),
    db: Session = Depends(get_db_session)
) -> MetricsResponse:
    """
    Retrieve computed metrics from the database.
    
    This endpoint returns analysis results including statistical aggregations,
    trend indicators, and anomaly detection results.
    
    Args:
        start_date: Optional start date filter in ISO format
        end_date: Optional end date filter in ISO format
        metric_type: Optional filter by metric type
        metric_name: Optional filter by metric name
        limit: Maximum number of results to return (1-1000)
        db: Database session from dependency injection
        
    Returns:
        MetricsResponse: List of metric data points matching query parameters
        
    Raises:
        HTTPException: 400 if query parameters are invalid, 500 on server error
    """
    try:
        # Build query object
        query = MetricsQuery(
            start_date=start_date,
            end_date=end_date,
            metric_type=metric_type,
            metric_name=metric_name,
            limit=limit
        )
        
        # Delegate to service function for business logic
        metrics_service = MetricsService(db)
        result = metrics_service.get_metrics(query)
        
        return result
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Metrics retrieval failed: {str(e)}")
