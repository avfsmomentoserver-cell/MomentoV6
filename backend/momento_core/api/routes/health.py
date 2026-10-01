"""
Health check route handlers.

Provides GET /health endpoint for monitoring application health.
"""

from fastapi import APIRouter
from datetime import datetime
from typing import Dict, Any

router = APIRouter()


@router.get("/health")
def health_check() -> Dict[str, Any]:
    """
    Health check endpoint for monitoring.
    
    Returns the current health status of the application and timestamp.
    This endpoint is used by load balancers and monitoring systems to
    verify the application is running correctly.
    
    Returns:
        Dict containing status and timestamp
        
    Example:
        {
            "status": "healthy",
            "timestamp": "2026-07-19T07:00:00Z"
        }
    """
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }
