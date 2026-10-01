"""
FastAPI application initialization for Momento Core.

Creates and configures the FastAPI application with middleware,
CORS settings, and route registration.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from momento_core.api.routes.ingest import router as ingest_router
from momento_core.api.routes.metrics import router as metrics_router
from momento_core.api.routes.forecasts import router as forecasts_router
from momento_core.api.routes.health import router as health_router
from momento_core.api.routes.websocket import router as websocket_router
from momento_core.api.routes.analysis import router as analysis_router
from momento_core.api.routes.rounds import router as rounds_router
from momento_core.api.routes.house_edge import router as house_edge_router
from momento_core.api.routes.orchestrator import router as orchestrator_router
from momento_core.api.routes.ml_predictions import router as ml_predictions_router
from momento_core.api.routes.ceiling_analyzer import router as ceiling_analyzer_router
from momento_core.api.routes.gap_swing_analyzer import (
    router as gap_swing_analyzer_router,
)
from momento_core.api.routes.autopilot import router as autopilot_router
from momento_core.api.routes.inventory import router as inventory_router
from momento_core.db.session import init_db


def create_app() -> FastAPI:
    """
    Create and configure the FastAPI application.

    Returns:
        FastAPI: Configured FastAPI application instance

    Example:
        app = create_app()
        uvicorn.run(app, host="0.0.0.0", port=8000)
    """
    app = FastAPI(
        title="Momento Core API",
        description="Modular analytics and forecasting platform API",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
    )

    # Configure CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Configure appropriately for production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register routes
    app.include_router(ingest_router, prefix="/api/v1", tags=["ingest"])
    app.include_router(metrics_router, prefix="/api/v1", tags=["metrics"])
    app.include_router(forecasts_router, prefix="/api/v1", tags=["forecasts"])
    app.include_router(health_router, prefix="/api/v1", tags=["health"])
    app.include_router(analysis_router, prefix="/api/v1", tags=["analysis"])
    app.include_router(rounds_router, prefix="/api/v1", tags=["rounds"])
    app.include_router(house_edge_router, prefix="/api/v1", tags=["house_edge"])
    app.include_router(orchestrator_router, prefix="/api/v1", tags=["orchestrator"])
    app.include_router(ml_predictions_router, prefix="/api/v1", tags=["ml_predictions"])
    app.include_router(
        ceiling_analyzer_router, prefix="/api/v1", tags=["ceiling_analyzer"]
    )
    app.include_router(
        gap_swing_analyzer_router, prefix="/api/v1", tags=["gap_swing_analyzer"]
    )
    app.include_router(autopilot_router, prefix="/api/v1", tags=["autopilot"])
    app.include_router(inventory_router, prefix="/api/v1", tags=["inventory"])
    app.include_router(websocket_router, tags=["websocket"])

    # Startup event to initialize database
    @app.on_event("startup")
    async def startup_event():
        """Initialize database on application startup."""
        init_db()

    return app


# Create application instance for import
app = create_app()
