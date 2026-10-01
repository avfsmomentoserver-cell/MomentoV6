"""
FastAPI route handlers for Momento Core API.

Provides route handlers for all API endpoints following the project's
convention of delegating business logic to service functions.
"""

from momento_core.api.routes.ingest import router as ingest_router
from momento_core.api.routes.metrics import router as metrics_router
from momento_core.api.routes.forecasts import router as forecasts_router
from momento_core.api.routes.health import router as health_router

__all__ = [
    "ingest_router",
    "metrics_router",
    "forecasts_router", 
    "health_router",
]
