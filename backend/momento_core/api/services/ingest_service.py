"""
Ingest service for data ingestion business logic.

Implements business logic for data ingestion, coordinating with
the Analysis module for processing.
"""

from sqlalchemy.orm import Session
from sqlalchemy import select
from momento_core.db.models.collected_data import CollectedData
from momento_core.db.models.data_source import DataSource
from momento_core.api.models.ingest import IngestPayload
from momento_core.api.routes.websocket import manager
from momento_core.api.services.analysis_service import AnalysisService
from momento_core.api.services.session_service import SessionService
import json


class IngestService:
    """Service for data ingestion business logic."""
    
    def __init__(self, db: Session) -> None:
        """
        Initialize ingest service with database session.
        
        Args:
            db: SQLAlchemy database session
        """
        self.db = db
    
    def ingest_data(self, payload: IngestPayload) -> CollectedData:
        """
        Ingest raw data from external sources.
        
        Validates the data source exists, stores the raw data, and
        marks it for processing by the Analysis module.
        
        Args:
            payload: Validated ingestion payload
            
        Returns:
            CollectedData: Created database record
            
        Raises:
            ValueError: If data source not found or validation fails
        """
        # Verify data source exists
        stmt = select(DataSource).where(DataSource.id == payload.data_source_id)
        data_source = self.db.execute(stmt).scalar_one_or_none()
        
        if not data_source:
            raise ValueError(f"Data source with ID {payload.data_source_id} not found")
        
        if not data_source.active:
            raise ValueError(f"Data source {data_source.name} is not active")
        
        # Create collected data record
        collected_data = CollectedData(
            data_source_id=payload.data_source_id,
            raw_data=json.dumps(payload.raw_data),
            timestamp=payload.timestamp,
            multiplier=payload.multiplier,
            color=payload.color,
            processed=False
        )
        
        # Save to database
        self.db.add(collected_data)
        self.db.commit()
        self.db.refresh(collected_data)

        # Notify connected clients of the new round and updated analysis.
        round_payload = {
            "id": str(collected_data.id),
            "multiplier": collected_data.multiplier,
            "color": collected_data.color,
            "timestamp": collected_data.timestamp,
            "band": f"{int(collected_data.multiplier)}x" if collected_data.multiplier >= 1 else "1x",
            "source": data_source.name,
        }

        analysis_service = AnalysisService(self.db)
        analysis_payload = analysis_service.get_analysis(data_source.name)

        manager.emit_message({"type": "round:new", "payload": round_payload})
        manager.emit_message({
            "type": "rounds:update",
            "payload": {"rounds": [round_payload], "source": data_source.name},
        })
        manager.emit_message({"type": "analysis:update", "payload": analysis_payload})
        # Compute and emit session summary (throttled)
        session_service = SessionService(self.db)
        session_service.emit_session_update(manager, data_source.name)
        
        return collected_data
