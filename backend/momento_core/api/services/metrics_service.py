"""
Metrics service for metrics retrieval business logic.

Implements business logic for metrics retrieval, coordinating with
the database layer to query analysis results.
"""

from sqlalchemy.orm import Session
from sqlalchemy import select, and_, or_
from datetime import datetime
from momento_core.db.models.metric import Metric
from momento_core.api.models.metrics import MetricsQuery, MetricsResponse, MetricData
from typing import Optional


class MetricsService:
    """Service for metrics retrieval business logic."""
    
    def __init__(self, db: Session) -> None:
        """
        Initialize metrics service with database session.
        
        Args:
            db: SQLAlchemy database session
        """
        self.db = db
    
    def get_metrics(self, query: MetricsQuery) -> MetricsResponse:
        """
        Retrieve metrics based on query parameters.
        
        Builds and executes a database query with optional filters
        for date range, metric type, and metric name.
        
        Args:
            query: Validated metrics query parameters
            
        Returns:
            MetricsResponse: List of metric data points matching query
            
        Raises:
            ValueError: If query parameters are invalid
        """
        # Build base query
        stmt = select(Metric)
        
        # Apply filters
        conditions = []
        
        if query.start_date:
            try:
                start_dt = datetime.fromisoformat(query.start_date.replace('Z', '+00:00'))
                conditions.append(Metric.created_at >= start_dt.isoformat())
            except ValueError:
                raise ValueError("Invalid start_date format, must be ISO 8601")
        
        if query.end_date:
            try:
                end_dt = datetime.fromisoformat(query.end_date.replace('Z', '+00:00'))
                conditions.append(Metric.created_at <= end_dt.isoformat())
            except ValueError:
                raise ValueError("Invalid end_date format, must be ISO 8601")
        
        if query.metric_type:
            conditions.append(Metric.metric_type == query.metric_type)
        
        if query.metric_name:
            conditions.append(Metric.metric_name == query.metric_name)
        
        if conditions:
            stmt = stmt.where(and_(*conditions))
        
        # Apply limit and ordering
        stmt = stmt.order_by(Metric.created_at.desc()).limit(query.limit)
        
        # Execute query
        results = self.db.execute(stmt).scalars().all()
        
        # Convert to response format
        metric_data = [
            MetricData(
                id=m.id,
                metric_type=m.metric_type,
                metric_name=m.metric_name,
                value=m.value,
                unit=m.unit,
                timestamp=m.created_at.isoformat() if m.created_at else ""
            )
            for m in results
        ]
        
        return MetricsResponse(
            metrics=metric_data,
            count=len(metric_data),
            query_params=query
        )
