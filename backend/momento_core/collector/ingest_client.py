"""
Ingest client for momento_core API.

Handles ingestion of new rounds into the momento_core system via the
Backend API following the project's architectural constraints.
"""

import logging
import json
from typing import Dict, Any, Optional
from momento_core.api.models.ingest import IngestPayload
from momento_core.db.session import get_db_context
from momento_core.db.models.collected_data import CollectedData
from momento_core.db.models.data_source import DataSource
from momento_core.linguistics import MomentoLinguisticsEngine

logger = logging.getLogger(__name__)


class IngestClient:
    """
    Client for ingesting rounds into momento_core.
    
    Converts momentoV1 round data to momento_core format and stores
    it via the Backend API service layer, respecting architectural
    constraints (no direct database writes).
    """
    
    def __init__(self, source_name: str = "momentoV1") -> None:
        """
        Initialize ingest client.
        
        Args:
            source_name: Name for the data source in momento_core
        """
        self.source_name = source_name
        self.linguistics_engine = MomentoLinguisticsEngine()
        self._ensure_data_source()
    
    def _ensure_data_source(self) -> None:
        """Ensure data source exists in momento_core database."""
        with get_db_context() as db:
            from sqlalchemy import select
            stmt = select(DataSource).where(DataSource.name == self.source_name)
            source = db.execute(stmt).scalar_one_or_none()
            
            if not source:
                logger.info(f"Creating data source: {self.source_name}")
                source = DataSource(
                    name=self.source_name,
                    source_type="database",
                    active=True,
                    config=json.dumps({"type": "sqlite_watcher", "path": "/home/pirates/collectors/Avfs_Core/avfs/database/avfs.db"})
                )
                db.add(source)
                db.commit()
    
    def _get_data_source_id(self) -> int:
        """Get the data source ID for momentoV1."""
        with get_db_context() as db:
            from sqlalchemy import select
            stmt = select(DataSource).where(DataSource.name == self.source_name)
            source = db.execute(stmt).scalar_one_or_none()
            
            if not source:
                raise ValueError(f"Data source {self.source_name} not found")
            
            return source.id
    
    def ingest_round(self, round_data: Dict[str, Any]) -> Optional[CollectedData]:
        """
        Ingest a single round into momento_core.
        
        Args:
            round_data: Round data from momentoV1 database
            
        Returns:
            Created CollectedData record or None if already exists
        """
        try:
            # Check if round already exists (prevent duplicates)
            if self._round_exists(round_data):
                logger.debug(f"Round {round_data['id']} already exists, skipping")
                return None
            
            # Convert momentoV1 format to momento_core format
            payload = self._convert_to_payload(round_data)
            
            # Store via service layer (respects architectural constraints)
            with get_db_context() as db:
                from momento_core.api.services.ingest_service import IngestService
                service = IngestService(db)
                result = service.ingest_data(payload)
                # return a usable object after the session closes
                db.commit()
                db.refresh(result)
                if result.data_source is not None:
                    db.refresh(result.data_source)
                db.expunge_all()
                
                logger.info(f"Successfully ingested round {round_data['id']} into momento_core")
                return result
                
        except Exception as e:
            logger.error(f"Error ingesting round {round_data.get('id')}: {e}")
            return None
    
    def _round_exists(self, round_data: Dict[str, Any]) -> bool:
        """Check if round already exists in momento_core."""
        with get_db_context() as db:
            from sqlalchemy import select
            # Check for existing record with same timestamp and multiplier
            stmt = select(CollectedData).where(
                CollectedData.timestamp == round_data['timestamp'],
                CollectedData.multiplier == round_data['multiplier']
            )
            existing = db.execute(stmt).scalar_one_or_none()
            return existing is not None
    
    def _convert_to_payload(self, round_data: Dict[str, Any]) -> IngestPayload:
        """
        Convert momentoV1 round data to momento_core IngestPayload.
        
        Args:
            round_data: Round data from momentoV1 database
            
        Returns:
            IngestPayload for momento_core API
        """
        # Get data source ID
        data_source_id = self._get_data_source_id()
        
        # Prepare raw data payload
        raw_data = {
            "id": round_data["id"],
            "timestamp": round_data["timestamp"],
            "multiplier": round_data["multiplier"],
            "color": round_data["color"],
            "source_file": round_data.get("source_file"),
            "source": round_data.get("source", "aviator"),
            "created_at": round_data.get("created_at")
        }
        
        # Create IngestPayload
        payload = IngestPayload(
            data_source_id=data_source_id,
            raw_data=raw_data,
            timestamp=round_data["timestamp"],
            multiplier=round_data["multiplier"],
            color=round_data["color"]
        )
        
        return payload
    
    def ingest_with_linguistics(self, round_data: Dict[str, Any]) -> Optional[CollectedData]:
        """
        Ingest round with MomentoLinguistics analysis.
        
        Args:
            round_data: Round data from momentoV1 database or downloaded files
            
        Returns:
            Created CollectedData record with linguistic analysis
        """
        import uuid
        # Generate an id if one doesn't exist
        round_id = round_data.get("id") or str(uuid.uuid4())
        # Create a copy of the round data with id if needed
        safe_round_data = {**round_data, "id": round_id}
        
        # Perform MomentoLinguistics conversion first
        try:
            linguistic_obj = self.linguistics_engine.convert(
                multiplier=safe_round_data["multiplier"],
                timestamp=safe_round_data["timestamp"],
                color=safe_round_data["color"]
            )
            logger.info(f"Linguistic analysis completed for round {round_id}")
        except Exception as e:
            logger.error(f"Error performing linguistic analysis: {e}")
            linguistic_obj = None
        
        # Prepare raw data with linguistic analysis
        raw_data = {
            "id": round_id,
            "timestamp": safe_round_data["timestamp"],
            "multiplier": safe_round_data["multiplier"],
            "color": safe_round_data["color"],
            "source_file": safe_round_data.get("source_file"),
            "source": safe_round_data.get("source", "aviator"),
            "created_at": safe_round_data.get("created_at")
        }
        
        if linguistic_obj:
            raw_data["linguistics"] = linguistic_obj.to_dict()
        
        # Ingest with enhanced raw data
        try:
            data_source_id = self._get_data_source_id()
            
            # Check if round already exists
            if self._round_exists_by_timestamp(safe_round_data["timestamp"], safe_round_data["multiplier"]):
                logger.debug(f"Round {round_id} already exists, skipping")
                return None
            
            # Create IngestPayload with linguistic data
            payload = IngestPayload(
                data_source_id=data_source_id,
                raw_data=raw_data,
                timestamp=safe_round_data["timestamp"],
                multiplier=safe_round_data["multiplier"],
                color=safe_round_data["color"]
            )
            
            # Store via service layer
            with get_db_context() as db:
                from momento_core.api.services.ingest_service import IngestService
                service = IngestService(db)
                result = service.ingest_data(payload)
                db.commit()
                db.refresh(result)
                if result.data_source is not None:
                    db.refresh(result.data_source)
                db.expunge_all()
                
                logger.info(f"Successfully ingested round {round_id} with linguistic analysis")
                return result
                
        except Exception as e:
            logger.error(f"Error ingesting round {round_id}: {e}")
            return None
    
    def _round_exists_by_timestamp(self, timestamp: str, multiplier: float) -> bool:
        """Check if round already exists by timestamp and multiplier."""
        with get_db_context() as db:
            from sqlalchemy import select
            stmt = select(CollectedData).where(
                CollectedData.timestamp == timestamp,
                CollectedData.multiplier == multiplier
            )
            existing = db.execute(stmt).scalar_one_or_none()
            return existing is not None
