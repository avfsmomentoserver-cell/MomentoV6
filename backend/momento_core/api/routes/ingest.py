"""
Data ingestion route handlers.

Provides POST /ingest endpoint for receiving data from the Collector module.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from momento_core.db.session import get_db_session
from momento_core.db.models.collected_data import CollectedData
from momento_core.db.models.data_source import DataSource
from momento_core.api.models.ingest import IngestPayload, IngestResponse
from momento_core.api.services.ingest_service import IngestService
import json

router = APIRouter()


@router.post("/ingest", response_model=IngestResponse, status_code=201)
def ingest_data(
    payload: IngestPayload,
    db: Session = Depends(get_db_session)
) -> IngestResponse:
    """
    Ingest raw data from external sources.
    
    This endpoint receives validated data from the Collector module,
    stores it in the database, and triggers analysis processing.
    
    Args:
        payload: Validated ingestion payload with data source, raw data, and metadata
        db: Database session from dependency injection
        
    Returns:
        IngestResponse: Confirmation with ingestion ID and status
        
    Raises:
        HTTPException: 400 if validation fails, 404 if data source not found, 500 on server error
    """
    try:
        # Delegate to service function for business logic
        ingest_service = IngestService(db)
        result = ingest_service.ingest_data(payload)
        
        return IngestResponse(
            ingestion_id=result.id,
            status="success",
            message="Data ingested successfully",
            processed=result.processed
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {str(e)}")
