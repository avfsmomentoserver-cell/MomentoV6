"""
API routes for the Decision Orchestrator layer.

Provides endpoints for processing forecasts, validating actions,
and retrieving orchestrator state using the pluggable system.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Dict, Any, Optional
from pathlib import Path

from momento_core.db.session import get_db_session
from momento_core.orchestrator_pluggable.manager import PluggableOrchestratorManager

router = APIRouter()

# Global manager instance (in production, use dependency injection)
_manager_instance = None


def get_orchestrator_manager(
    db: Session = Depends(get_db_session),
) -> PluggableOrchestratorManager:
    """Get or create the orchestrator manager instance."""
    global _manager_instance
    if _manager_instance is None:
        config = {}
        _manager_instance = PluggableOrchestratorManager(db, config)
        # Load default modules
        modules_dir = (
            Path(__file__).parent.parent.parent / "orchestrator_pluggable" / "modules"
        )
        _manager_instance.load_modules_from_directory(str(modules_dir))
    return _manager_instance


@router.post("/orchestrator/process-forecast")
def process_forecast(
    forecast_data: Dict[str, Any],
    session_config: Dict[str, Any],
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """
    Process a forecast and generate complete orchestrator state.

    This endpoint takes forecast data from the prediction engine and
    converts it into a complete execution plan with risk assessment,
    bankroll state, and session recommendations using the pluggable system.

    Args:
        forecast_data: Forecast data from prediction engine
        session_config: Session configuration parameters
        db: Database session

    Returns:
        Dict: Complete orchestrator state with execution plan
    """
    try:
        manager = get_orchestrator_manager(db)
        state = manager.process_forecast(forecast_data, session_config)
        return state
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/orchestrator/update-round")
def update_on_round(
    round_data: Dict[str, Any], db: Session = Depends(get_db_session)
) -> Dict[str, Any]:
    """
    Update orchestrator state when a new round arrives.

    This endpoint is called after each round to recalculate the state
    and update the execution plan if conditions have changed.

    Args:
        round_data: Data from the completed round
        db: Database session

    Returns:
        Dict: Updated orchestrator state
    """
    try:
        manager = get_orchestrator_manager(db)
        # For now, treat round data as forecast data
        state = manager.process_forecast(round_data, {})
        return state
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/orchestrator/validate-action")
def validate_action(
    proposed_action: Dict[str, Any],
    session_config: Dict[str, Any],
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """
    Validate a user-proposed action before execution.

    This endpoint prevents common mistakes by checking against the current
    execution plan and risk parameters using the pluggable system.

    Args:
        proposed_action: Action the user wants to take
        session_config: Current session configuration
        db: Database session

    Returns:
        Dict: Validation result with warnings
    """
    try:
        manager = get_orchestrator_manager(db)
        validation = manager.validate_action(proposed_action, session_config)
        return validation
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/orchestrator/checklist")
def get_pre_action_checklist(
    session_config: Dict[str, Any], db: Session = Depends(get_db_session)
) -> Dict[str, Any]:
    """
    Generate a pre-action checklist for the user.

    This endpoint provides a clear checklist that must be satisfied before
    taking any action, reducing the chance of mistakes.

    Args:
        session_config: Current session configuration
        db: Database session

    Returns:
        Dict: Checklist with all items and status
    """
    try:
        manager = get_orchestrator_manager(db)
        checklist = manager.generate_checklist(session_config)
        return checklist
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/orchestrator/instruction")
def get_instruction_message(
    context: Optional[str] = None, db: Session = Depends(get_db_session)
) -> Dict[str, Any]:
    """
    Generate a natural language instruction message for the user.

    This endpoint provides coaching and guidance in human-readable format.

    Args:
        context: Optional context for the instruction
        db: Database session

    Returns:
        Dict: Instruction message with content and metadata
    """
    try:
        manager = get_orchestrator_manager(db)
        message = manager.generate_instruction(context)
        return message
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/orchestrator/health")
def get_health_status(db: Session = Depends(get_db_session)) -> Dict[str, Any]:
    """
    Get the health status of the pluggable orchestrator system.

    This endpoint returns information about loaded modules and strategies.

    Args:
        db: Database session

    Returns:
        Dict: Health status of all modules and strategies
    """
    try:
        manager = get_orchestrator_manager(db)
        health = manager.get_health_status()
        return health
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/orchestrator/session/start")
def start_session(
    session_config: Dict[str, Any], db: Session = Depends(get_db_session)
) -> Dict[str, Any]:
    """
    Start a new session with the given configuration.

    This endpoint initializes a new session and returns the initial state.

    Args:
        session_config: Session configuration parameters
        db: Database session

    Returns:
        Dict: Initial orchestrator state for the session
    """
    try:
        manager = get_orchestrator_manager(db)
        # Initialize with minimal forecast data to create initial state
        initial_forecast = {
            "confidence_level": 0.5,
            "probability": 0.5,
            "phase": "unknown",
            "volatility": 0.5,
        }
        state = manager.process_forecast(initial_forecast, session_config)
        return state
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
