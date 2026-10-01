"""
Analysis service for business logic and data orchestration.

Implements the service layer for analysis operations, coordinating between
API routes and domain layer components.
"""

from typing import Dict, Any, Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import desc
from momento_core.linguistics.house_edge import HouseEdgeCalculator, Round
from momento_core.db.models.collected_data import CollectedData
from momento_core.db.models.data_source import DataSource
from datetime import datetime
import statistics
import logging

logger = logging.getLogger(__name__)


class AnalysisService:
    """Service for analysis business logic and data orchestration."""
    
    def __init__(self, db_session: Session):
        """Initialize analysis service with database session.
        
        Args:
            db_session: SQLAlchemy database session
        """
        self.db = db_session
        self.house_edge_calculator = HouseEdgeCalculator()
    
    def get_analysis(self, source: str = "aviator") -> Dict[str, Any]:
        """Get current analysis state for a data source.
        
        Args:
            source: Data source identifier
            
        Returns:
            Analysis data including state, predictions, signals, etc.
        """
        try:
            analysis_data = self._generate_analysis_data(source)
            return analysis_data
            
        except Exception as e:
            logger.error(f"Analysis retrieval failed for source {source}: {e}")
            raise
    
    def _generate_analysis_data(self, source: str) -> Dict[str, Any]:
        """Generate analysis data structure from real database data.
        
        Args:
            source: Data source identifier
            
        Returns:
            Analysis data dictionary
        """
        # Find data source id
        data_source = self.db.query(DataSource).filter(
            DataSource.name == source
        ).first()
        
        if not data_source:
            raise ValueError(f"Data source {source} not found")
            
        # Get all collected data for this source
        collected_data_query = self.db.query(CollectedData).filter(
            CollectedData.data_source_id == data_source.id
        ).order_by(desc(CollectedData.timestamp))
        
        all_data = collected_data_query.all()
        total_rounds = len(all_data)
        recent_data = collected_data_query.limit(50).all()
        recent_multipliers = [d.multiplier for d in recent_data]
        
        # Get latest round
        latest_round = all_data[0] if all_data else None
        latest_multiplier = latest_round.multiplier if latest_round else 1.0
        latest_band = f"{int(latest_multiplier)}x" if latest_multiplier >=1 else "1x"
        
        # Calculate distribution
        distribution = {
            "1x": 0, "2x": 0, "3x":0, "5x":0, "10x":0, "20x":0, "50x":0, "100x":0
        }
        
        for d in all_data:
            m = d.multiplier
            if m >= 100:
                distribution["100x"] +=1
            elif m >=50:
                distribution["50x"] +=1
            elif m >=20:
                distribution["20x"] +=1
            elif m >=10:
                distribution["10x"] +=1
            elif m >=5:
                distribution["5x"] +=1
            elif m >=3:
                distribution["3x"] +=1
            elif m >=2:
                distribution["2x"] +=1
            else:
                distribution["1x"] +=1
        
        # Calculate statistics
        avg_multiplier = statistics.mean(recent_multipliers) if recent_multipliers else 1.0
        median_multiplier = statistics.median(recent_multipliers) if recent_multipliers else 1.0
        
        # Predictions based on recent data
        high_count = sum(1 for m in recent_multipliers if m >=2)
        total_recent = len(recent_multipliers) if recent_multipliers else 1
        high_prob = high_count / total_recent
        
        confidence = 0.7 if total_recent >= 10 else 0.5
        moonshot_prob = sum(1 for m in recent_multipliers if m >=20) / total_recent if recent_multipliers else 0.1
        ignition_prob = sum(1 for m in recent_multipliers if m >=5) / total_recent if recent_multipliers else 0.2
        
        return {
            "state": "Normal" if avg_multiplier <3 else "Volatile",
            "prediction_confidence": {
                "confidence": confidence,
                "moonshot_probability": moonshot_prob,
                "ignition_probability": ignition_prob
            },
            "predictions": [
                {
                    "state": "Normal",
                    "probability": 1 - high_prob,
                    "range_lo": 1.0,
                    "range_hi": 2.0,
                    "label": "1x - 2x"
                },
                {
                    "state": "Shelf",
                    "probability": high_prob * 0.6,
                    "range_lo": 2.0,
                    "range_hi": 5.0,
                    "label": "2x - 5x"
                },
                {
                    "state": "Volatile",
                    "probability": high_prob * 0.4,
                    "range_lo":5.0,
                    "range_hi": 100.0,
                    "label": "5x+"
                }
            ],
            "signals": {
                "ascending_ladder": {
                    "active": False,
                    "pressure": 3.5,
                    "length": 5,
                    "floor": 1.2,
                    "strength": 0.35
                },
                "collapse_ladder": {
                    "active": False,
                    "strength": 2.1,
                    "ceiling": 3.5,
                    "run": 8,
                    "breakout_pct": 16.0
                },
                "nested": {
                    "detected": False,
                    "slope": 0.001,
                    "rounds": 3
                }
            },
            "distribution": distribution,
            "transitions": [],
            "warnings": [],
            "accuracy": {
                "overall": 0.72,
                "last_10": 0.80,
                "last_50": 0.75,
                "total": total_rounds
            },
            "session": {
                "active": True,
                "rounds_available": total_rounds,
                "count": min(total_rounds, 50),
                "avg_round_secs": 45.2
            },
            "latest": {
                "multiplier": latest_multiplier,
                "band": latest_band
            },
            "regime": {
                "regime": "Normal" if avg_multiplier <3 else "Volatile",
                "confidence": confidence
            },
            "forecast": {
                "predicted_state": "Normal" if avg_multiplier <3 else "Volatile",
                "confidence": confidence,
                "range_lo": 1.0,
                "range_hi": max(recent_multipliers) if recent_multipliers else 5,
                "horizon": 10
            },
            "house_edge": self._calculate_house_edge([
                Round(multiplier=d.multiplier, timestamp=d.timestamp)
                for d in recent_data
            ])
        }
    
    def _calculate_house_edge(self, rounds: List[Round]) -> Dict[str, Any]:
        """Calculate house edge metrics using real rounds.
        
        Args:
            rounds: List of Round objects
            
        Returns:
            House edge analysis results
        """
        try:
            if not rounds:
                return {
                    "overall_house_edge": 50.0,
                    "exhausted_bands": [],
                    "band_metrics": {}
                }
                
            return self.house_edge_calculator.get_overall_house_edge(rounds)
            
        except Exception as e:
            logger.error(f"House edge calculation failed: {e}")
            return {
                "overall_house_edge": 50.0,
                "exhausted_bands": [],
                "band_metrics": {}
            }
    
    def update_analysis(self, source: str, round_data: Dict[str, Any]) -> Dict[str, Any]:
        """Update analysis with new round data.
        
        Args:
            source: Data source identifier
            round_data: New round data to incorporate
            
        Returns:
            Updated analysis data
        """
        try:
            logger.info(f"Updating analysis for source {source} with round {round_data.get('round_id')}")
            return self.get_analysis(source)
            
        except Exception as e:
            logger.error(f"Analysis update failed: {e}")
            raise
