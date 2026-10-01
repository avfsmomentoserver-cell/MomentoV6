"""
Pydantic models for metrics endpoints.

Provides request and response schemas for the GET /metrics endpoint.
"""

from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class MetricData(BaseModel):
    """Individual metric data point."""
    
    id: int = Field(..., description="Metric ID")
    metric_type: str = Field(..., description="Type of metric")
    metric_name: str = Field(..., description="Name of the specific metric")
    value: float = Field(..., description="Computed metric value")
    unit: Optional[str] = Field(None, description="Unit of measurement")
    timestamp: str = Field(..., description="Timestamp when metric was computed")
    
    class Config:
        """Pydantic configuration."""
        schema_extra = {
            "example": {
                "id": 1,
                "metric_type": "aggregation",
                "metric_name": "moving_average",
                "value": 1.25,
                "unit": "multiplier",
                "timestamp": "2026-07-19T07:00:00Z"
            }
        }


class MetricsQuery(BaseModel):
    """Query parameters for metrics retrieval."""
    
    start_date: Optional[str] = Field(None, description="Start date in ISO format")
    end_date: Optional[str] = Field(None, description="End date in ISO format")
    metric_type: Optional[str] = Field(None, description="Filter by metric type")
    metric_name: Optional[str] = Field(None, description="Filter by metric name")
    limit: Optional[int] = Field(100, ge=1, le=1000, description="Maximum number of results")
    
    class Config:
        """Pydantic configuration."""
        schema_extra = {
            "example": {
                "start_date": "2026-07-01T00:00:00Z",
                "end_date": "2026-07-19T23:59:59Z",
                "metric_type": "aggregation",
                "metric_name": "moving_average",
                "limit": 100
            }
        }


class MetricsResponse(BaseModel):
    """Response for metrics query."""
    
    metrics: List[MetricData] = Field(..., description="List of metric data points")
    count: int = Field(..., description="Total number of metrics returned")
    query_params: MetricsQuery = Field(..., description="Query parameters used")
    
    class Config:
        """Pydantic configuration."""
        schema_extra = {
            "example": {
                "metrics": [
                    {
                        "id": 1,
                        "metric_type": "aggregation",
                        "metric_name": "moving_average",
                        "value": 1.25,
                        "unit": "multiplier",
                        "timestamp": "2026-07-19T07:00:00Z"
                    }
                ],
                "count": 1,
                "query_params": {
                    "start_date": "2026-07-01T00:00:00Z",
                    "end_date": "2026-07-19T23:59:59Z",
                    "metric_type": "aggregation",
                    "metric_name": "moving_average",
                    "limit": 100
                }
            }
        }
