"""
Pydantic models for data ingestion endpoints.

Provides request and response schemas for the POST /ingest endpoint.
"""

from pydantic import BaseModel, Field, validator
from typing import Optional, Any
from datetime import datetime


class IngestPayload(BaseModel):
    """Request payload for data ingestion."""
    
    data_source_id: int = Field(..., gt=0, description="ID of the data source")
    raw_data: dict[str, Any] = Field(..., description="Raw data payload")
    timestamp: str = Field(..., description="UTC timestamp in ISO format")
    multiplier: float = Field(..., gt=0, description="Raw multiplier value")
    color: Optional[str] = Field(None, description="RGB color representation")
    
    @validator('timestamp')
    def validate_timestamp(cls, v: str) -> str:
        """Validate timestamp is in ISO format."""
        try:
            datetime.fromisoformat(v.replace('Z', '+00:00'))
            return v
        except ValueError:
            raise ValueError("Timestamp must be in ISO 8601 format")
    
    @validator('color')
    def validate_color(cls, v: Optional[str]) -> Optional[str]:
        """Validate color format if provided."""
        if v is not None:
            if not v.startswith('rgb(') or not v.endswith(')'):
                raise ValueError("Color must be in RGB format: rgb(r, g, b)")
        return v
    
    class Config:
        """Pydantic configuration."""
        schema_extra = {
            "example": {
                "data_source_id": 1,
                "raw_data": {"value": 100, "metadata": {"source": "api"}},
                "timestamp": "2026-07-19T07:00:00Z",
                "multiplier": 1.22,
                "color": "rgb(52, 180, 255)"
            }
        }


class IngestResponse(BaseModel):
    """Response for successful data ingestion."""
    
    ingestion_id: int = Field(..., description="ID of the created collected data record")
    status: str = Field(default="success", description="Ingestion status")
    message: str = Field(..., description="Status message")
    processed: bool = Field(default=False, description="Whether data has been processed")
    
    class Config:
        """Pydantic configuration."""
        schema_extra = {
            "example": {
                "ingestion_id": 123,
                "status": "success",
                "message": "Data ingested successfully",
                "processed": False
            }
        }
