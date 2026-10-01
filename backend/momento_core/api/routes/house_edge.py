"""
House Edge API Routes

Provides endpoints for house edge calculations and band exhaustion detection.
"""

from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel

from momento_core.linguistics.house_edge import HouseEdgeCalculator, Round


router = APIRouter()


class RoundInput(BaseModel):
    """Input model for round data."""
    multiplier: float
    timestamp: Optional[str] = None


class HouseEdgeResponse(BaseModel):
    """Response model for house edge metrics."""
    band: str
    occurrence_rate: float
    expected_rate: float
    deviation: float
    is_exhausted: bool
    exhaustion_threshold: float
    severity: float


class OverallHouseEdgeResponse(BaseModel):
    """Response model for overall house edge summary."""
    total_rounds: int
    overall_house_edge: float
    exhausted_bands: List[str]
    band_metrics: dict


class ExhaustionEventResponse(BaseModel):
    """Response model for exhaustion events."""
    exhausted_band: str
    exhaustion_percentage: float
    threshold: float
    window_start: int
    window_end: int
    severity: float
    deviation: float


@router.post("/house_edge/compute")
def compute_house_edge(
    rounds: List[RoundInput],
    target_band: Optional[str] = Query(None, description="Specific band to analyze")
) -> dict:
    """
    Compute house edge statistics for round data.
    
    Args:
        rounds: List of round data with multipliers
        target_band: Optional specific band to analyze (if None, analyzes all)
        
    Returns:
        Dictionary mapping band names to house edge metrics
    """
    try:
        # Convert input to Round objects
        round_objects = [
            Round(multiplier=r.multiplier, timestamp=r.timestamp)
            for r in rounds
        ]
        
        # Initialize calculator
        calculator = HouseEdgeCalculator()
        
        # Compute house edge
        metrics = calculator.compute_house_edge(round_objects, target_band)
        
        # Convert to response format
        response = {
            band: {
                'occurrence_rate': metric.occurrence_rate,
                'expected_rate': metric.expected_rate,
                'deviation': metric.deviation,
                'is_exhausted': metric.is_exhausted,
                'exhaustion_threshold': metric.exhaustion_threshold,
                'severity': metric.severity
            }
            for band, metric in metrics.items()
        }
        
        return response
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"House edge computation failed: {str(e)}")


@router.post("/house_edge/overall")
def get_overall_house_edge(rounds: List[RoundInput]) -> OverallHouseEdgeResponse:
    """
    Get overall house edge summary for the session.
    
    Args:
        rounds: List of round data with multipliers
        
    Returns:
        Overall house edge statistics including exhausted bands
    """
    try:
        # Convert input to Round objects
        round_objects = [
            Round(multiplier=r.multiplier, timestamp=r.timestamp)
            for r in rounds
        ]
        
        # Initialize calculator
        calculator = HouseEdgeCalculator()
        
        # Get overall house edge
        summary = calculator.get_overall_house_edge(round_objects)
        
        return OverallHouseEdgeResponse(**summary)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Overall house edge computation failed: {str(e)}")


@router.post("/house_edge/exhaustion_events")
def detect_exhaustion_events(
    rounds: List[RoundInput],
    window_size: int = Query(500, ge=100, le=2000, description="Window size for rolling analysis")
) -> List[ExhaustionEventResponse]:
    """
    Detect band exhaustion events across the session.
    
    Args:
        rounds: List of round data with multipliers
        window_size: Rolling window size for analysis (default: 500)
        
    Returns:
        List of exhaustion events detected
    """
    try:
        # Convert input to Round objects
        round_objects = [
            Round(multiplier=r.multiplier, timestamp=r.timestamp)
            for r in rounds
        ]
        
        # Initialize calculator with custom window size
        calculator = HouseEdgeCalculator(window_size=window_size)
        
        # Detect exhaustion events
        events = calculator.detect_exhaustion_events(round_objects)
        
        return [ExhaustionEventResponse(**event) for event in events]
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Exhaustion detection failed: {str(e)}")


@router.get("/house_edge/bands")
def get_available_bands() -> dict:
    """
    Get available statistical bands and their thresholds.
    
    Returns:
        Dictionary of bands with their exhaustion thresholds and expected rates
    """
    try:
        calculator = HouseEdgeCalculator()
        
        return {
            'bands': {
                band: {
                    'exhaustion_threshold': threshold,
                    'expected_rate': calculator.expected_rates.get(band, 50.0)
                }
                for band, threshold in calculator.exhaustion_thresholds.items()
            },
            'window_size': calculator.window_size
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get band information: {str(e)}")
