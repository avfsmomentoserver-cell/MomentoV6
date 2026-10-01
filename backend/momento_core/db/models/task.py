"""
Task model for asynchronous job tracking.

Represents background tasks for long-running operations like
forecast generation and bulk analysis.
"""

from sqlalchemy import String, Text, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column
from momento_core.db.base import BaseModel, TimestampMixin
from typing import Optional


class Task(BaseModel, TimestampMixin):
    """
    Background task for long-running operations.
    
    This table tracks asynchronous tasks such as forecast generation
    and bulk analysis operations, enabling status monitoring and
    result retrieval.
    
    Attributes:
        id: Unique identifier
        task_type: Type of task (forecast, analysis, etc.)
        status: Current status (pending, running, completed, failed)
        result: JSON string containing task result (if completed)
        error_message: Error message if task failed
        started_at: Timestamp when task started processing
        completed_at: Timestamp when task completed
    """
    
    __tablename__ = "tasks"
    
    task_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        doc="Type of task (forecast, analysis, etc.)"
    )
    
    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="pending",
        index=True,
        doc="Current status (pending, running, completed, failed)"
    )
    
    result: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        doc="JSON string containing task result (if completed)"
    )
    
    error_message: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        doc="Error message if task failed"
    )
    
    started_at: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        doc="UTC timestamp when task started processing"
    )
    
    completed_at: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        doc="UTC timestamp when task completed"
    )
    
    # Indexes for common query patterns
    __table_args__ = (
        Index("idx_tasks_type_status", "task_type", "status"),
        Index("idx_tasks_created_at_status", "created_at", "status"),
    )
    
    def __repr__(self) -> str:
        """String representation of Task."""
        return f"<Task(id={self.id}, type={self.task_type}, status={self.status})>"
