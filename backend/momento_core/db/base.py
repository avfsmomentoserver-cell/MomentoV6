"""
SQLAlchemy base configuration for Momento Core.

Provides the declarative base for all ORM models and common database utilities.
"""

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from datetime import datetime
from typing import Any


class Base(DeclarativeBase):
    """Base class for all ORM models."""

    __abstract__ = True
    metadata = MetaData(
        naming_convention={
            "ix": "ix_%(column_0_label)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )

    def as_dict(self) -> dict[str, Any]:
        """Return a simple dict representation of the ORM object."""
        if not hasattr(self, "__table__"):
            return {}
        return {
            column.name: getattr(self, column.name)
            for column in self.__table__.columns
        }

    @classmethod
    def from_dict(cls, values: dict[str, Any]) -> "Base":
        """Build a model instance from a plain dictionary."""
        if not hasattr(cls, "__table__"):
            return cls()
        filtered = {
            key: value
            for key, value in values.items()
            if key in cls.__table__.columns
        }
        return cls(**filtered)


class TimestampMixin:
    """Mixin class for created_at and updated_at timestamps."""
    
    created_at: Mapped[datetime] = mapped_column(
        default=datetime.utcnow,
        nullable=False,
        doc="Timestamp when record was created"
    )
    
    updated_at: Mapped[datetime] = mapped_column(
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
        doc="Timestamp when record was last updated"
    )


class BaseModel(Base):
    """Base model with common fields for all entities."""
    
    __abstract__ = True
    
    id: Mapped[int] = mapped_column(
        primary_key=True,
        autoincrement=True,
        doc="Unique identifier for the record"
    )
    
    def __repr__(self) -> str:
        """String representation of the model."""
        class_name = self.__class__.__name__
        return f"<{class_name}(id={self.id})>"
    
    def to_dict(self) -> dict[str, Any]:
        """Convert model instance to dictionary."""
        result = {}
        for column in self.__table__.columns:
            value = getattr(self, column.name)
            if isinstance(value, datetime):
                value = value.isoformat()
            result[column.name] = value
        return result
