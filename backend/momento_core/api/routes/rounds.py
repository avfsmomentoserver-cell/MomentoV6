"""
Rounds retrieval route handlers.

Provides GET /rounds endpoint for retrieving historical round data.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Body
from sqlalchemy.orm import Session
from momento_core.db.session import get_db_session
from typing import Optional, Dict, Any
from datetime import datetime

from momento_core.api.services.rounds_service import RoundsService

router = APIRouter()


@router.get("/rounds")
def get_rounds(
    source: str = Query("aviator", description="Data source identifier"),
    limit: int = Query(
        100, ge=1, le=1000, description="Maximum number of rounds to return"
    ),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    db: Session = Depends(get_db_session),
):
    """
    Retrieve historical round data (limited to 1000 rounds).

    This endpoint returns recent rounds with multipliers, colors, and timestamps.

    Args:
        source: Data source identifier (default: "aviator")
        limit: Maximum number of rounds to return (1-1000)
        offset: Offset for pagination (default 0)
        db: Database session from dependency injection

    Returns:
        List of rounds with multiplier, color, timestamp, and pagination info
    """
    try:
        service = RoundsService(db)
        return service.get_rounds(source=source, limit=limit, offset=offset)

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Rounds retrieval failed: {str(e)}"
        )


@router.get("/rounds/historical")
def get_historical_rounds(
    source: str = Query("aviator", description="Data source identifier"),
    limit: int = Query(
        10000,
        ge=1,
        le=100000,
        description="Maximum number of rounds to return (unlimited for Bird Eye)",
    ),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    db: Session = Depends(get_db_session),
):
    """
    Retrieve unlimited historical round data for Bird Eye visualization.

    This endpoint returns historical rounds with multipliers, colors, and timestamps,
    designed for the Bird Eye page that needs to visualize data beyond the 60 round cap.

    Args:
        source: Data source identifier (default: "aviator")
        limit: Maximum number of rounds to return (1-100000, default 10000)
        offset: Offset for pagination (default 0)
        db: Database session from dependency injection

    Returns:
        List of rounds with multiplier, color, timestamp, and pagination info
    """
    try:
        service = RoundsService(db)
        return service.get_rounds(source=source, limit=limit, offset=offset)

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Historical rounds retrieval failed: {str(e)}"
        )


@router.post("/rounds")
def add_round(
    round_data: Dict[str, Any] = Body(...),
    source: str = Query("aviator", description="Data source identifier"),
    db: Session = Depends(get_db_session),
):
    """
    Add a new round to the database.

    This endpoint ingests a single round of data with linguistic analysis.

    Args:
        round_data: Round data (must include timestamp and multiplier)
        source: Data source identifier (default: "aviator")
        db: Database session from dependency injection

    Returns:
        The created round data with linguistic analysis
    """
    try:
        service = RoundsService(db)
        return service.add_round(source=source, round_data=round_data)

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Round addition failed: {str(e)}"
        )
