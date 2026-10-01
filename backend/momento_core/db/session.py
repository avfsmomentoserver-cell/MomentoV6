"""
Database session management for Momento Core.

Provides session factory, dependency injection for FastAPI, and database
initialization utilities.
"""

from contextlib import contextmanager
from typing import Generator
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from momento_core.db.base import Base
from momento_core.db.config import get_database_config


# Create engine and session factory
config = get_database_config()
engine = create_engine(config.database_url, **config.get_engine_kwargs())
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db_session() -> Generator[Session, None, None]:
    """
    Dependency injection for FastAPI to get database session.
    
    Yields:
        Session: SQLAlchemy database session
        
    Example:
        @app.get("/metrics")
        def get_metrics(db: Session = Depends(get_db_session)):
            return db.query(Metric).all()
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def get_db_context() -> Generator[Session, None, None]:
    """
    Context manager for database session usage outside FastAPI.
    
    Yields:
        Session: SQLAlchemy database session
        
    Example:
        with get_db_context() as db:
            metrics = db.query(Metric).all()
    """
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init_db() -> None:
    """
    Initialize database by creating all tables.
    
    This should be called on application startup to ensure all tables
    are created based on the ORM model definitions.
    """
    Base.metadata.create_all(bind=engine)


def drop_db() -> None:
    """
    Drop all database tables.
    
    WARNING: This will delete all data. Use only for testing or
    complete database resets.
    """
    Base.metadata.drop_all(bind=engine)
