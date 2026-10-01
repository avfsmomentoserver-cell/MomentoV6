"""
API layer for Momento Core.

Provides FastAPI routes, business logic services, and Pydantic models
for request/response validation following the project's API conventions.
"""

from momento_core.api.main import create_app
from momento_core.api.routes.ingest import router as ingest_router
from momento_core.api.routes.metrics import router as metrics_router
from momento_core.api.routes.forecasts import router as forecasts_router
from momento_core.api.routes.health import router as health_router

__all__ = [
    "create_app",
    "ingest_router",
    "metrics_router", 
    "forecasts_router",
    "health_router",
]
