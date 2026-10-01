"""
Pydantic models for forecast endpoints.

Provides request and response schemas for the GET /forecasts endpoint.
"""

from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class ForecastData(BaseModel):
    """Individual forecast data point."""
    
    id: int = Field(..., description="Forecast ID")
    model_type: str = Field(..., description="Type of forecasting model")
    horizon_periods: int = Field(..., description="Number of periods predicted")
    confidence_level: float = Field(..., description="Confidence level for intervals")
    predictions: List[dict] = Field(..., description="Prediction points with timestamps and values")
    accuracy_score: Optional[float] = Field(None, description="Model accuracy score if evaluated")
    training_duration_seconds: float = Field(..., description="Time taken to train the model")
    created_at: str = Field(..., description="Timestamp when forecast was created")
    
    class Config:
        """Pydantic configuration."""
        schema_extra = {
            "example": {
                "id": 1,
                "model_type": "arima",
                "horizon_periods": 10,
                "confidence_level": 0.95,
                "predictions": [
                    {"timestamp": "2026-07-20T00:00:00Z", "value": 1.25, "confidence_lower": 1.20, "confidence_upper": 1.30}
                ],
                "accuracy_score": 0.92,
                "training_duration_seconds": 2.5,
                "created_at": "2026-07-19T07:00:00Z"
            }
        }


class ForecastQuery(BaseModel):
    """Query parameters for forecast retrieval."""
    
    model_type: Optional[str] = Field(None, description="Filter by model type")
    min_horizon: Optional[int] = Field(None, ge=1, description="Minimum horizon periods")
    max_horizon: Optional[int] = Field(None, ge=1, description="Maximum horizon periods")
    min_confidence: Optional[float] = Field(None, ge=0.5, le=0.99, description="Minimum confidence level")
    limit: Optional[int] = Field(100, ge=1, le=1000, description="Maximum number of results")
    
    class Config:
        """Pydantic configuration."""
        schema_extra = {
            "example": {
                "model_type": "arima",
                "min_horizon": 5,
                "max_horizon": 20,
                "min_confidence": 0.90,
                "limit": 100
            }
        }


class ForecastResponse(BaseModel):
    """Response for forecast query."""
    
    forecasts: List[ForecastData] = Field(..., description="List of forecast results")
    count: int = Field(..., description="Total number of forecasts returned")
    query_params: ForecastQuery = Field(..., description="Query parameters used")
    
    class Config:
        """Pydantic configuration."""
        schema_extra = {
            "example": {
                "forecasts": [
                    {
                        "id": 1,
                        "model_type": "arima",
                        "horizon_periods": 10,
                        "confidence_level": 0.95,
                        "predictions": [
                            {"timestamp": "2026-07-20T00:00:00Z", "value": 1.25, "confidence_lower": 1.20, "confidence_upper": 1.30}
                        ],
                        "accuracy_score": 0.92,
                        "training_duration_seconds": 2.5,
                        "created_at": "2026-07-19T07:00:00Z"
                    }
                ],
                "count": 1,
                "query_params": {
                    "model_type": "arima",
                    "min_horizon": 5,
                    "max_horizon": 20,
                    "min_confidence": 0.90,
                    "limit": 100
                }
            }
        }
