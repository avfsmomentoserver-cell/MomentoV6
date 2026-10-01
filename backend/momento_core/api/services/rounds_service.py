"""
Rounds service for managing rounds data and business logic.

Implements the service layer for rounds operations, coordinating between
API routes and database layer.
"""

from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from datetime import datetime
import logging
import json

from momento_core.db.models.collected_data import CollectedData
from momento_core.db.models.data_source import DataSource
from momento_core.api.routes.websocket import manager
from momento_core.api.services.analysis_service import AnalysisService
from momento_core.api.services.session_service import SessionService

logger = logging.getLogger(__name__)


class RoundsService:
    """Service for rounds business logic and data management."""
    
    def __init__(self, db_session: Session):
        """Initialize rounds service with database session.
        
        Args:
            db_session: SQLAlchemy database session
        """
        self.db = db_session
    
    def get_rounds(
        self,
        source: str = "aviator",
        limit: int = 100,
        offset: int = 0
    ) -> Dict[str, Any]:
        """Get rounds data for a data source.
        
        Args:
            source: Data source identifier
            limit: Maximum number of rounds to return
            offset: Number of rounds to skip
            
        Returns:
            Rounds data including list of rounds and metadata
        """
        try:
            # Find data source by name
            data_source = self.db.query(DataSource).filter(
                DataSource.name == source
            ).first()
            
            if not data_source:
                # If no data source found, just return empty array
                return {"rounds": [], "total": 0, "limit": limit, "offset": offset}
            
            # Query collected data from this source
            query = self.db.query(CollectedData).filter(
                CollectedData.data_source_id == data_source.id
            ).order_by(desc(CollectedData.timestamp))
            
            # Get total count
            total = query.count()
            
            # Apply pagination
            collected_data = query.offset(offset).limit(limit).all()
            
            # Convert to rounds format
            rounds = []
            for cd in collected_data:
                # Determine color based on multiplier
                if cd.multiplier >= 2.0:
                    color = "red"
                else:
                    color = "green"
                
                # Determine band
                band = f"{int(cd.multiplier)}x" if cd.multiplier >= 1 else "1x"
                
                rounds.append({
                    "id": str(cd.id),
                    "multiplier": cd.multiplier,
                    "color": color,
                    "timestamp": cd.timestamp,
                    "band": band,
                })
            
            return {
                "rounds": rounds,
                "total": total,
                "limit": limit,
                "offset": offset
            }
            
        except Exception as e:
            logger.error(f"Rounds retrieval failed for source {source}: {e}")
            raise
    
    def get_round_by_id(self, round_id: str, source: str = "aviator") -> Optional[Dict[str, Any]]:
        """Get a specific round by ID.
        
        Args:
            round_id: Round identifier
            source: Data source identifier
            
        Returns:
            Round data
        """
        try:
            # Find data source by name
            data_source = self.db.query(DataSource).filter(
                DataSource.name == source
            ).first()
            
            if not data_source:
                return None
            
            # Query collected data
            cd = self.db.query(CollectedData).filter(
                CollectedData.id == int(round_id),
                CollectedData.data_source_id == data_source.id
            ).first()
            
            if not cd:
                return None
            
            # Determine color based on multiplier
            if cd.multiplier >= 2.0:
                color = "red"
            else:
                color = "green"
            
            # Determine band
            band = f"{int(cd.multiplier)}x" if cd.multiplier >= 1 else "1x"
            
            return {
                "id": str(cd.id),
                "multiplier": cd.multiplier,
                "color": color,
                "timestamp": cd.timestamp,
                "band": band,
            }
            
        except Exception as e:
            logger.error(f"Round retrieval failed for {round_id}: {e}")
            raise
    
    def add_round(self, source: str, round_data: Dict[str, Any]) -> Dict[str, Any]:
        """Add a new round to the database.

        Args:
            source: Data source identifier
            round_data: Round data to add (must include multiplier and timestamp)

        Returns:
            Created round data with linguistic analysis
        """
        try:
            # Get data source ID
            data_source = self.db.query(DataSource).filter(
                DataSource.name == source
            ).first()
            if not data_source:
                raise ValueError(f"Data source {source} not found")

            # Prepare ingest payload
            from momento_core.api.models.ingest import IngestPayload
            from momento_core.api.services.ingest_service import IngestService
            from momento_core.linguistics import MomentoLinguisticsEngine

            multiplier = round_data.get("multiplier", 1.0)
            timestamp = round_data.get("timestamp", datetime.utcnow().isoformat())
            color = round_data.get("color")

            ingest_payload = IngestPayload(
                data_source_id=data_source.id,
                raw_data=round_data,
                timestamp=timestamp,
                multiplier=multiplier,
                color=color
            )

            # Ingest the data
            ingest_service = IngestService(self.db)
            collected_data = ingest_service.ingest_data(ingest_payload)

            # Run linguistic analysis
            linguistics_engine = MomentoLinguisticsEngine()
            linguistic_object = linguistics_engine.convert(
                multiplier=multiplier,
                timestamp=timestamp,
                color=color
            )

            # Convert linguistic object to a dict
            linguistic_analysis = linguistic_object.to_dict()

            # Update raw_data with linguistic analysis
            updated_raw_data = {
                **round_data,
                "linguistics": linguistic_analysis
            }
            collected_data.raw_data = json.dumps(updated_raw_data)
            self.db.commit()
            self.db.refresh(collected_data)

            # Determine color and band for response
            if multiplier >= 2.0:
                color_response = "red"
            else:
                color_response = "green"
            band = f"{int(multiplier)}x" if multiplier >= 1 else "1x"

            round_payload = {
                "id": str(collected_data.id),
                "multiplier": collected_data.multiplier,
                "color": color_response,
                "timestamp": collected_data.timestamp,
                "band": band,
                "source": source,
            }

            analysis_service = AnalysisService(self.db)
            analysis_payload = analysis_service.get_analysis(source)

            manager.emit_message({"type": "round:new", "payload": round_payload})
            manager.emit_message({
                "type": "rounds:update",
                "payload": {"rounds": [round_payload], "source": source},
            })
            manager.emit_message({"type": "analysis:update", "payload": analysis_payload})

            # Compute and emit session summary (throttled)
            session_service = SessionService(self.db)
            session_service.emit_session_update(manager, source)

            return {
                "id": str(collected_data.id),
                "multiplier": collected_data.multiplier,
                "color": color_response,
                "timestamp": collected_data.timestamp,
                "band": band,
                "linguistics": linguistic_analysis
            }

        except Exception as e:
            logger.error(f"Round addition failed: {e}")
            raise
    
    def get_rounds_statistics(self, source: str = "aviator") -> Dict[str, Any]:
        """Get statistics for rounds data.
        
        Args:
            source: Data source identifier
            
        Returns:
            Rounds statistics
        """
        try:
            # Find data source by name
            data_source = self.db.query(DataSource).filter(
                DataSource.name == source
            ).first()
            
            if not data_source:
                return {
                    "total_rounds": 0,
                    "avg_multiplier": 0.0,
                    "max_multiplier": 0.0,
                    "min_multiplier": 0.0,
                    "source": source
                }
            
            # Calculate statistics
            stats = self.db.query(
                func.count(CollectedData.id).label("total"),
                func.avg(CollectedData.multiplier).label("avg_mult"),
                func.max(CollectedData.multiplier).label("max_mult"),
                func.min(CollectedData.multiplier).label("min_mult")
            ).filter(CollectedData.data_source_id == data_source.id).first()
            
            return {
                "total_rounds": stats.total or 0,
                "avg_multiplier": float(stats.avg_mult or 0.0),
                "max_multiplier": float(stats.max_mult or 0.0),
                "min_multiplier": float(stats.min_mult or 0.0),
                "source": source
            }
            
        except Exception as e:
            logger.error(f"Rounds statistics calculation failed: {e}")
            raise
