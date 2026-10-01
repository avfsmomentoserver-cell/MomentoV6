"""
CollectedData model for raw ingested data.

Represents raw data records ingested from external sources before analysis
and processing. This follows the immutable raw events principle - raw data
is never edited, corrections are recorded separately.
"""

from sqlalchemy import String, Float, Text, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from momento_core.db.base import BaseModel, TimestampMixin
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from momento_core.db.models.data_source import DataSource
    from momento_core.db.models.metric import Metric


class CollectedData(BaseModel, TimestampMixin):
    """
    Raw data collected from external sources.
    
    This table stores immutable raw event data. Corrections are recorded
    separately to enable replay, auditing, calibration, and learning.
    
    Attributes:
        id: Unique identifier
        data_source_id: Foreign key to data source
        raw_data: JSON string containing the raw data payload
        timestamp: UTC timestamp of when the data was recorded
        multiplier: Raw multiplier value (e.g., 1.22x)
        color: RGB color representation
        processed: Whether this data has been analyzed
        data_source: Relationship to DataSource
    """
    
    __tablename__ = "collected_data"
    
    data_source_id: Mapped[int] = mapped_column(
        ForeignKey("data_sources.id"),
        nullable=False,
        index=True,
        doc="Foreign key to the data source this data came from"
    )
    
    raw_data: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        doc="JSON string containing the raw data payload"
    )
    
    timestamp: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        doc="UTC timestamp in ISO format when data was recorded"
    )
    
    multiplier: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        doc="Raw multiplier value (e.g., 1.22x)"
    )
    
    color: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        doc="RGB color representation (e.g., 'rgb(52, 180, 255)')"
    )
    
    processed: Mapped[bool] = mapped_column(
        default=False,
        nullable=False,
        index=True,
        doc="Whether this data has been analyzed and processed"
    )
    
    # Relationships
    data_source: Mapped["DataSource"] = relationship(
        back_populates="collected_data"
    )
    
    metrics: Mapped[list["Metric"]] = relationship(
        back_populates="collected_data",
        cascade="all, delete-orphan"
    )
    
    # Indexes for common query patterns
    __table_args__ = (
        Index("idx_collected_data_timestamp_processed", "timestamp", "processed"),
        Index("idx_collected_data_source_timestamp", "data_source_id", "timestamp"),
    )
    
    def __repr__(self) -> str:
        """String representation of CollectedData."""
        return f"<CollectedData(id={self.id}, timestamp={self.timestamp}, multiplier={self.multiplier})>"
