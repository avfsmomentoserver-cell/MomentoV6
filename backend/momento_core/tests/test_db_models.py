"""
Tests for database models.

Tests SQLAlchemy ORM models to ensure proper field definitions,
relationships, and constraints following project conventions.
"""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from momento_core.db.base import Base
from momento_core.db.models.collected_data import CollectedData
from momento_core.db.models.metric import Metric
from momento_core.db.models.forecast_result import ForecastResult
from momento_core.db.models.data_source import DataSource
from momento_core.db.models.user import User
from momento_core.db.models.task import Task
from datetime import datetime


@pytest.fixture
def in_memory_db():
    """Create in-memory SQLite database for testing."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    return engine


@pytest.fixture
def db_session(in_memory_db):
    """Create database session for testing."""
    from sqlalchemy.orm import sessionmaker
    SessionLocal = sessionmaker(bind=in_memory_db)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


class TestDataSource:
    """Tests for DataSource model."""
    
    def test_create_data_source(self, db_session: Session) -> None:
        """Test creating a data source."""
        source = DataSource(
            name="Test API",
            source_type="api",
            endpoint_url="https://api.example.com",
            active=True,
            polling_interval_seconds=300
        )
        db_session.add(source)
        db_session.commit()
        
        assert source.id is not None
        assert source.name == "Test API"
        assert source.source_type == "api"
        assert source.active is True
    
    def test_data_source_timestamps(self, db_session: Session) -> None:
        """Test that timestamps are auto-populated."""
        source = DataSource(
            name="Test Source",
            source_type="file"
        )
        db_session.add(source)
        db_session.commit()
        
        assert source.created_at is not None
        assert source.updated_at is not None


class TestCollectedData:
    """Tests for CollectedData model."""
    
    def test_create_collected_data(self, db_session: Session) -> None:
        """Test creating collected data."""
        # Create data source first
        source = DataSource(name="Test Source", source_type="api")
        db_session.add(source)
        db_session.commit()
        
        # Create collected data
        data = CollectedData(
            data_source_id=source.id,
            raw_data='{"value": 100}',
            timestamp="2026-07-19T07:00:00Z",
            multiplier=1.22,
            color="rgb(52, 180, 255)",
            processed=False
        )
        db_session.add(data)
        db_session.commit()
        
        assert data.id is not None
        assert data.multiplier == 1.22
        assert data.processed is False
    
    def test_collected_data_relationship(self, db_session: Session) -> None:
        """Test relationship with data source."""
        source = DataSource(name="Test Source", source_type="api")
        db_session.add(source)
        db_session.commit()
        
        data = CollectedData(
            data_source_id=source.id,
            raw_data='{"value": 100}',
            timestamp="2026-07-19T07:00:00Z",
            multiplier=1.22
        )
        db_session.add(data)
        db_session.commit()
        
        assert data.data_source.name == "Test Source"


class TestMetric:
    """Tests for Metric model."""
    
    def test_create_metric(self, db_session: Session) -> None:
        """Test creating a metric."""
        # Create collected data first
        source = DataSource(name="Test Source", source_type="api")
        db_session.add(source)
        db_session.commit()
        
        data = CollectedData(
            data_source_id=source.id,
            raw_data='{"value": 100}',
            timestamp="2026-07-19T07:00:00Z",
            multiplier=1.22
        )
        db_session.add(data)
        db_session.commit()
        
        # Create metric
        metric = Metric(
            collected_data_id=data.id,
            metric_type="aggregation",
            metric_name="moving_average",
            value=1.25,
            unit="multiplier"
        )
        db_session.add(metric)
        db_session.commit()
        
        assert metric.id is not None
        assert metric.metric_type == "aggregation"
        assert metric.value == 1.25


class TestForecastResult:
    """Tests for ForecastResult model."""
    
    def test_create_forecast_result(self, db_session: Session) -> None:
        """Test creating a forecast result."""
        import json
        
        forecast = ForecastResult(
            model_type="arima",
            horizon_periods=10,
            confidence_level=0.95,
            predictions=json.dumps([
                {"timestamp": "2026-07-20T00:00:00Z", "value": 1.25}
            ]),
            accuracy_score=0.92,
            training_duration_seconds=2.5
        )
        db_session.add(forecast)
        db_session.commit()
        
        assert forecast.id is not None
        assert forecast.model_type == "arima"
        assert forecast.horizon_periods == 10
        assert forecast.confidence_level == 0.95


class TestUser:
    """Tests for User model."""
    
    def test_create_user(self, db_session: Session) -> None:
        """Test creating a user."""
        user = User(
            username="testuser",
            email="test@example.com",
            hashed_password="hashed_password_here",
            full_name="Test User",
            active=True
        )
        db_session.add(user)
        db_session.commit()
        
        assert user.id is not None
        assert user.username == "testuser"
        assert user.email == "test@example.com"
        assert user.active is True


class TestTask:
    """Tests for Task model."""
    
    def test_create_task(self, db_session: Session) -> None:
        """Test creating a task."""
        task = Task(
            task_type="forecast",
            status="pending"
        )
        db_session.add(task)
        db_session.commit()
        
        assert task.id is not None
        assert task.task_type == "forecast"
        assert task.status == "pending"
    
    def test_task_status_update(self, db_session: Session) -> None:
        """Test updating task status."""
        task = Task(task_type="forecast", status="pending")
        db_session.add(task)
        db_session.commit()
        
        task.status = "running"
        task.started_at = datetime.utcnow().isoformat()
        db_session.commit()
        
        assert task.status == "running"
        assert task.started_at is not None
