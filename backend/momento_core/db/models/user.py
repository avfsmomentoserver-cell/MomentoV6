"""
User model for platform users.

Represents users of the Momento platform for authentication,
authorization, and user-specific data isolation.
"""

from sqlalchemy import String, Index
from sqlalchemy.orm import Mapped, mapped_column
from momento_core.db.base import BaseModel, TimestampMixin
from typing import Optional


class User(BaseModel, TimestampMixin):
    """
    Platform user account.
    
    This table stores user information for authentication and authorization.
    In production, row-level security policies will be configured to ensure
    users can only access their own data.
    
    Attributes:
        id: Unique identifier
        username: Unique username for login
        email: Unique email address
        hashed_password: Bcrypt-hashed password
        full_name: User's full name
        active: Whether the user account is active
    """
    
    __tablename__ = "users"
    
    username: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        unique=True,
        index=True,
        doc="Unique username for login"
    )
    
    email: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        unique=True,
        index=True,
        doc="Unique email address"
    )
    
    hashed_password: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        doc="Bcrypt-hashed password"
    )
    
    full_name: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        doc="User's full name"
    )
    
    active: Mapped[bool] = mapped_column(
        default=True,
        nullable=False,
        index=True,
        doc="Whether the user account is active"
    )
    
    # Indexes for common query patterns
    __table_args__ = (
        Index("idx_users_username_active", "username", "active"),
        Index("idx_users_email_active", "email", "active"),
    )
    
    def __repr__(self) -> str:
        """String representation of User."""
        return f"<User(id={self.id}, username={self.username}, email={self.email})>"
