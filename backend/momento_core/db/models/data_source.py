"""
DataSource model for external data source configuration.

Represents external data sources from which raw data is collected,
including API endpoints, file sources, and scheduled data feeds.
"""

from sqlalchemy import String, Text, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from momento_core.db.base import BaseModel, TimestampMixin
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from momento_core.db.models.collected_data import CollectedData


class DataSource(BaseModel, TimestampMixin):
    """
    External data source configuration.
    
    This table stores configuration for external data sources including
    API endpoints, file sources, and scheduled data feeds.
    
    Attributes:
        id: Unique identifier
        name: Human-readable name of the data source
        source_type: Type of source (api, file, scheduled)
        endpoint_url: URL endpoint for API sources
        config: JSON string with source-specific configuration
        active: Whether the source is currently active
        polling_interval_seconds: Interval for scheduled polling
    """
    
    __tablename__ = "data_sources"
    
    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        unique=True,
        index=True,
        doc="Human-readable name of the data source"
    )
    
    source_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        doc="Type of source (api, file, scheduled)"
    )
    
    endpoint_url: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
        doc="URL endpoint for API sources"
    )
    
    config: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        doc="JSON string with source-specific configuration (API keys, headers, etc.)"
    )
    
    active: Mapped[bool] = mapped_column(
        default=True,
        nullable=False,
        index=True,
        doc="Whether the source is currently active"
    )
    
    polling_interval_seconds: Mapped[Optional[int]] = mapped_column(
        nullable=True,
        doc="Interval in seconds for scheduled polling"
    )
    
    # Relationships
    collected_data: Mapped[list["CollectedData"]] = relationship(
        back_populates="data_source",
        cascade="all, delete-orphan",
        foreign_keys="CollectedData.data_source_id"
    )
    
    # Indexes for common query patterns
    __table_args__ = (
        Index("idx_data_sources_type_active", "source_type", "active"),
    )
    
    def __repr__(self) -> str:
        """String representation of DataSource."""
        return f"<DataSource(id={self.id}, name={self.name}, type={self.source_type}, active={self.active})>"
