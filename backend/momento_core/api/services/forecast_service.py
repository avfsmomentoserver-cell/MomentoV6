"""
Forecast service for forecast retrieval business logic.

Implements business logic for forecast retrieval, coordinating with
the database layer to query forecast results.
"""

from sqlalchemy.orm import Session
from sqlalchemy import select, and_, or_
from momento_core.db.models.forecast_result import ForecastResult
from momento_core.api.models.forecasts import ForecastQuery, ForecastResponse, ForecastData
import json
from typing import Optional


class ForecastService:
    """Service for forecast retrieval business logic."""
    
    def __init__(self, db: Session) -> None:
        """
        Initialize forecast service with database session.
        
        Args:
            db: SQLAlchemy database session
        """
        self.db = db
    
    def get_forecasts(self, query: ForecastQuery) -> ForecastResponse:
        """
        Retrieve forecasts based on query parameters.
        
        Builds and executes a database query with optional filters
        for model type, horizon, and confidence level.
        
        Args:
            query: Validated forecast query parameters
            
        Returns:
            ForecastResponse: List of forecast results matching query
            
        Raises:
            ValueError: If query parameters are invalid
        """
        # Build base query
        stmt = select(ForecastResult)
        
        # Apply filters
        conditions = []
        
        if query.model_type:
            conditions.append(ForecastResult.model_type == query.model_type)
        
        if query.min_horizon:
            conditions.append(ForecastResult.horizon_periods >= query.min_horizon)
        
        if query.max_horizon:
            conditions.append(ForecastResult.horizon_periods <= query.max_horizon)
        
        if query.min_confidence:
            conditions.append(ForecastResult.confidence_level >= query.min_confidence)
        
        if conditions:
            stmt = stmt.where(and_(*conditions))
        
        # Apply limit and ordering
        stmt = stmt.order_by(ForecastResult.created_at.desc()).limit(query.limit)
        
        # Execute query
        results = self.db.execute(stmt).scalars().all()
        
        # Convert to response format
        forecast_data = []
        for f in results:
            try:
                predictions = json.loads(f.predictions)
            except json.JSONDecodeError:
                predictions = []
            
            forecast_data.append(
                ForecastData(
                    id=f.id,
                    model_type=f.model_type,
                    horizon_periods=f.horizon_periods,
                    confidence_level=f.confidence_level,
                    predictions=predictions,
                    accuracy_score=f.accuracy_score,
                    training_duration_seconds=f.training_duration_seconds,
                    created_at=f.created_at.isoformat() if f.created_at else ""
                )
            )
        
        return ForecastResponse(
            forecasts=forecast_data,
            count=len(forecast_data),
            query_params=query
        )
