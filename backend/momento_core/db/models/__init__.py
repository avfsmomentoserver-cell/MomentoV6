"""
SQLAlchemy ORM models for Momento Core.

Defines all database entities following the project's data model conventions:
- snake_case table names (plural)
- id primary key (auto-increment)
- created_at and updated_at timestamps
- Foreign keys following <table_singular>_id convention
"""

from momento_core.db.models.collected_data import CollectedData
from momento_core.db.models.metric import Metric
from momento_core.db.models.forecast_result import ForecastResult
from momento_core.db.models.data_source import DataSource
from momento_core.db.models.user import User
from momento_core.db.models.task import Task
from momento_core.db.models.crash_models import (
    CrashRound,
    PredictionResult,
    SignalEvent,
    PredictionPlugin
)

__all__ = [
    "CollectedData",
    "Metric", 
    "ForecastResult",
    "DataSource",
    "User",
    "Task",
    "CrashRound",
    "PredictionResult",
    "SignalEvent",
    "PredictionPlugin",
]
