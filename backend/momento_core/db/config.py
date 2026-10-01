"""
Database configuration for Momento Core.

Manages database connection strings and environment-specific configuration
for local (SQLite) and production (Supabase/PostgreSQL) environments.
"""

import os
from typing import Optional
from functools import lru_cache


class DatabaseConfig:
    """Database configuration settings."""
    
    def __init__(self) -> None:
        """Initialize database configuration from environment variables."""
        self.environment = os.getenv("ENVIRONMENT", "local")
        self.database_url = self._get_database_url()
        self.pool_size = int(os.getenv("DB_POOL_SIZE", "5"))
        self.max_overflow = int(os.getenv("DB_MAX_OVERFLOW", "10"))
        self.pool_timeout = int(os.getenv("DB_POOL_TIMEOUT", "30"))
        self.pool_recycle = int(os.getenv("DB_POOL_RECYCLE", "3600"))
        
    def _get_database_url(self) -> str:
        """Get database URL based on environment."""
        if self.environment == "production":
            # Production: Supabase/PostgreSQL
            db_url = os.getenv("DATABASE_URL")
            if not db_url:
                raise ValueError("DATABASE_URL environment variable must be set in production")
            return db_url
        else:
            # Local: SQLite
            db_path = os.getenv("SQLITE_DB_PATH", "avfs.db")
            return f"sqlite:///{db_path}"
    
    def get_engine_kwargs(self) -> dict:
        """Get SQLAlchemy engine keyword arguments based on environment."""
        if self.environment == "production":
            return {
                "pool_size": self.pool_size,
                "max_overflow": self.max_overflow,
                "pool_timeout": self.pool_timeout,
                "pool_recycle": self.pool_recycle,
                "pool_pre_ping": True,
            }
        else:
            # SQLite doesn't support connection pooling
            return {
                "connect_args": {"check_same_thread": False},
            }


@lru_cache
def get_database_config() -> DatabaseConfig:
    """Get cached database configuration instance."""
    return DatabaseConfig()


def get_database_url() -> str:
    """Get database URL for current environment."""
    return get_database_config().database_url
