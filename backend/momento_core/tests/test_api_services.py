"""
Tests for API services.

Tests business logic in service layer to ensure proper data validation,
database operations, and coordination with other modules.
"""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from momento_core.db.base import Base
from momento_core.db.models.collected_data import CollectedData
from momento_core.db.models.data_source import DataSource
from momento_core.api.models.ingest import IngestPayload
from momento_core.api.services.ingest_service import IngestService
from momento_core.api.services.metrics_service import MetricsService
from momento_core.api.services.forecast_service import ForecastService
from momento_core.api.models.metrics import MetricsQuery
from momento_core.api.models.forecasts import ForecastQuery
import json


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


class TestIngestService:
    """Tests for IngestService."""
    
    def test_ingest_data_success(self, db_session: Session) -> None:
        """Test successful data ingestion."""
        # Create data source
        source = DataSource(name="Test API", source_type="api", active=True)
        db_session.add(source)
        db_session.commit()
        
        # Create ingest service and ingest data
        payload = IngestPayload(
            data_source_id=source.id,
            raw_data={"value": 100},
            timestamp="2026-07-19T07:00:00Z",
            multiplier=1.22,
            color="rgb(52, 180, 255)"
        )
        
        service = IngestService(db_session)
        result = service.ingest_data(payload)
        
        assert result.id is not None
        assert result.data_source_id == source.id
        assert result.multiplier == 1.22
        assert result.processed is False
    
    def test_ingest_data_source_not_found(self, db_session: Session) -> None:
        """Test ingestion with non-existent data source."""
        payload = IngestPayload(
            data_source_id=999,
            raw_data={"value": 100},
            timestamp="2026-07-19T07:00:00Z",
            multiplier=1.22
        )
        
        service = IngestService(db_session)
        
        with pytest.raises(ValueError, match="Data source with ID 999 not found"):
            service.ingest_data(payload)
    
    def test_ingest_data_inactive_source(self, db_session: Session) -> None:
        """Test ingestion with inactive data source."""
        source = DataSource(name="Test API", source_type="api", active=False)
        db_session.add(source)
        db_session.commit()
        
        payload = IngestPayload(
            data_source_id=source.id,
            raw_data={"value": 100},
            timestamp="2026-07-19T07:00:00Z",
            multiplier=1.22
        )
        
        service = IngestService(db_session)
        
        with pytest.raises(ValueError, match="is not active"):
            service.ingest_data(payload)


class TestMetricsService:
    """Tests for MetricsService."""
    
    def test_get_metrics_empty(self, db_session: Session) -> None:
        """Test retrieving metrics when none exist."""
        query = MetricsQuery(limit=10)
        service = MetricsService(db_session)
        result = service.get_metrics(query)
        
        assert result.count == 0
        assert len(result.metrics) == 0
    
    def test_get_metrics_with_data(self, db_session: Session) -> None:
        """Test retrieving metrics with data in database."""
        # Create collected data and metric
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
        
        from momento_core.db.models.metric import Metric
        metric = Metric(
            collected_data_id=data.id,
            metric_type="aggregation",
            metric_name="moving_average",
            value=1.25,
            unit="multiplier"
        )
        db_session.add(metric)
        db_session.commit()
        
        # Retrieve metrics
        query = MetricsQuery(limit=10)
        service = MetricsService(db_session)
        result = service.get_metrics(query)
        
        assert result.count == 1
        assert len(result.metrics) == 1
        assert result.metrics[0].metric_name == "moving_average"
    
    def test_get_metrics_with_filters(self, db_session: Session) -> None:
        """Test retrieving metrics with type filter."""
        # Create data source and collected data
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
        
        # Create metrics of different types
        from momento_core.db.models.metric import Metric
        metric1 = Metric(
            collected_data_id=data.id,
            metric_type="aggregation",
            metric_name="moving_average",
            value=1.25
        )
        metric2 = Metric(
            collected_data_id=data.id,
            metric_type="trend",
            metric_name="linear_trend",
            value=0.05
        )
        db_session.add_all([metric1, metric2])
        db_session.commit()
        
        # Filter by metric type
        query = MetricsQuery(metric_type="aggregation", limit=10)
        service = MetricsService(db_session)
        result = service.get_metrics(query)
        
        assert result.count == 1
        assert result.metrics[0].metric_type == "aggregation"
    
    def test_get_metrics_invalid_date_format(self, db_session: Session) -> None:
        """Test retrieving metrics with invalid date format."""
        query = MetricsQuery(start_date="invalid-date", limit=10)
        service = MetricsService(db_session)
        
        with pytest.raises(ValueError, match="Invalid start_date format"):
            service.get_metrics(query)


class TestForecastService:
    """Tests for ForecastService."""
    
    def test_get_forecasts_empty(self, db_session: Session) -> None:
        """Test retrieving forecasts when none exist."""
        query = ForecastQuery(limit=10)
        service = ForecastService(db_session)
        result = service.get_forecasts(query)
        
        assert result.count == 0
        assert len(result.forecasts) == 0
    
    def test_get_forecasts_with_data(self, db_session: Session) -> None:
        """Test retrieving forecasts with data in database."""
        # Create forecast result
        from momento_core.db.models.forecast_result import ForecastResult
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
        
        # Retrieve forecasts
        query = ForecastQuery(limit=10)
        service = ForecastService(db_session)
        result = service.get_forecasts(query)
        
        assert result.count == 1
        assert len(result.forecasts) == 1
        assert result.forecasts[0].model_type == "arima"
    
    def test_get_forecasts_with_model_filter(self, db_session: Session) -> None:
        """Test retrieving forecasts with model type filter."""
        # Create forecasts of different types
        from momento_core.db.models.forecast_result import ForecastResult
        forecast1 = ForecastResult(
            model_type="arima",
            horizon_periods=10,
            confidence_level=0.95,
            predictions=json.dumps([{"timestamp": "2026-07-20T00:00:00Z", "value": 1.25}]),
            accuracy_score=0.92,
            training_duration_seconds=2.5
        )
        forecast2 = ForecastResult(
            model_type="prophet",
            horizon_periods=15,
            confidence_level=0.90,
            predictions=json.dumps([{"timestamp": "2026-07-20T00:00:00Z", "value": 1.30}]),
            accuracy_score=0.88,
            training_duration_seconds=3.0
        )
        db_session.add_all([forecast1, forecast2])
        db_session.commit()
        
        # Filter by model type
        query = ForecastQuery(model_type="arima", limit=10)
        service = ForecastService(db_session)
        result = service.get_forecasts(query)
        
        assert result.count == 1
        assert result.forecasts[0].model_type == "arima"
    
    def test_get_forecasts_with_horizon_filter(self, db_session: Session) -> None:
        """Test retrieving forecasts with horizon filter."""
        # Create forecasts with different horizons
        from momento_core.db.models.forecast_result import ForecastResult
        forecast1 = ForecastResult(
            model_type="arima",
            horizon_periods=5,
            confidence_level=0.95,
            predictions=json.dumps([{"timestamp": "2026-07-20T00:00:00Z", "value": 1.25}]),
            accuracy_score=0.92,
            training_duration_seconds=2.5
        )
        forecast2 = ForecastResult(
            model_type="arima",
            horizon_periods=15,
            confidence_level=0.95,
            predictions=json.dumps([{"timestamp": "2026-07-20T00:00:00Z", "value": 1.30}]),
            accuracy_score=0.88,
            training_duration_seconds=3.0
        )
        db_session.add_all([forecast1, forecast2])
        db_session.commit()
        
        # Filter by horizon
        query = ForecastQuery(min_horizon=10, max_horizon=20, limit=10)
        service = ForecastService(db_session)
        result = service.get_forecasts(query)
        
        assert result.count == 1
        assert result.forecasts[0].horizon_periods == 15
