"""
Momento Core - The intelligent heart of the Momento/AVFS Core platform.

This package contains the core prediction engines, analytics modules, and data
processing pipelines that transform raw market data into actionable insights
and forecasts.

Core Architecture:
- Database: SQLAlchemy ORM models and session management
- API: FastAPI routes and business logic services
- Analysis: Statistical processing and metric computation
- Forecast: Predictive modeling and time series forecasting
- Linguistics: MomentoLinguistics semantic integration
"""

__version__ = "1.0.0"
__author__ = "Momento/AVFS Core Team"

from momento_core.db.base import Base
from momento_core.db.session import get_db_session, init_db

__all__ = [
    "Base",
    "get_db_session", 
    "init_db",
]
