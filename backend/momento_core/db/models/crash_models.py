"""
Crash Game Database Models

SQLAlchemy ORM models for crash game prediction system.
"""

from sqlalchemy import Float, Integer, String, JSON, Boolean, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime
from typing import Optional, Dict, Any

from momento_core.db.base import BaseModel, TimestampMixin


class CrashRound(BaseModel, TimestampMixin):
    """
    Represents a single crash game round.
    
    Stores raw round data along with linguistic analysis and prediction results.
    """
    
    __tablename__ = "crash_rounds"
    
    # Round identification
    round_id: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=False,
        doc="External round identifier from data source"
    )
    
    # Round data
    crash_point: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        doc="Final crash multiplier point"
    )
    
    duration_seconds: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        doc="Round duration in seconds"
    )
    
    multiplier_sequence: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        default=list,
        doc="Sequence of multipliers during the round"
    )
    
    color_sequence: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        default=list,
        doc="Sequence of color values during the round"
    )
    
    # Linguistic analysis
    linguistic_classification: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        doc="MomentoLinguistics 8-layer analysis results"
    )
    
    reverse_linguistic_analysis: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        doc="Reverse linguistic layers 9-12 analysis"
    )
    
    # Prediction data
    predicted_crash_point: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True,
        doc="Predicted crash point for this round"
    )
    
    prediction_confidence: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True,
        doc="Confidence score for the prediction (0.0-1.0)"
    )
    
    prediction_strategy: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        doc="Prediction strategy used"
    )
    
    # Severity classification
    severity: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="moderate",
        doc="Crash severity classification"
    )
    
    # Data source tracking
    data_source_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("data_sources.id"),
        nullable=True,
        doc="Foreign key to data source"
    )
    
    # Indexes for common queries
    __table_args__ = (
        Index("idx_crash_rounds_timestamp", "created_at"),
        Index("idx_crash_rounds_crash_point", "crash_point"),
        Index("idx_crash_rounds_severity", "severity"),
    )
    
    def __repr__(self) -> str:
        return f"<CrashRound(id={self.id}, round_id={self.round_id}, crash_point={self.crash_point})>"


class PredictionResult(BaseModel, TimestampMixin):
    """
    Stores prediction results and performance metrics.
    """
    
    __tablename__ = "prediction_results"
    
    # Identification
    prediction_id: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=False,
        doc="Unique prediction identifier"
    )
    
    round_id: Mapped[str] = mapped_column(
        String(255),
        ForeignKey("crash_rounds.round_id"),
        nullable=False,
        index=True,
        doc="Associated round identifier"
    )
    
    # Prediction data
    predicted_crash_point: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        doc="Predicted crash point"
    )
    
    confidence_interval_lower: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        doc="Lower bound of confidence interval"
    )
    
    confidence_interval_upper: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        doc="Upper bound of confidence interval"
    )
    
    confidence_score: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        doc="Confidence score (0.0-1.0)"
    )
    
    strategy: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        doc="Prediction strategy used"
    )
    
    # Feature analysis
    feature_importance: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        doc="Feature importance weights"
    )
    
    # Signal data
    signals_generated: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        doc="Signals generated during prediction"
    )
    
    # Actual results (filled after round completion)
    actual_crash_point: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True,
        doc="Actual crash point for validation"
    )
    
    prediction_error: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True,
        doc="Absolute prediction error"
    )
    
    accuracy: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True,
        doc="Prediction accuracy (0.0-1.0)"
    )
    
    # Status tracking
    is_completed: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        doc="Whether prediction has been validated"
    )
    
    # Indexes for performance queries
    __table_args__ = (
        Index("idx_prediction_results_round_id", "round_id"),
        Index("idx_prediction_results_timestamp", "created_at"),
        Index("idx_prediction_results_strategy", "strategy"),
        Index("idx_prediction_results_completed", "is_completed"),
    )
    
    def __repr__(self) -> str:
        return f"<PredictionResult(id={self.id}, prediction_id={self.prediction_id}, accuracy={self.accuracy})>"


class SignalEvent(BaseModel, TimestampMixin):
    """
    Stores signal events from the Signal Hunter Pro system.
    """
    
    __tablename__ = "signal_events"
    
    # Identification
    signal_id: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=False,
        doc="Unique signal identifier"
    )
    
    round_id: Mapped[str] = mapped_column(
        String(255),
        ForeignKey("crash_rounds.round_id"),
        nullable=False,
        index=True,
        doc="Associated round identifier"
    )
    
    # Signal data
    signal_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        doc="Type of signal (momentum, reversion, exhaustion, pattern)"
    )
    
    signal_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        doc="Human-readable signal name"
    )
    
    severity: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        doc="Signal severity (low, medium, high, critical)"
    )
    
    # Signal metrics
    strength: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        doc="Signal strength (0.0-1.0)"
    )
    
    confidence: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        doc="Signal confidence (0.0-1.0)"
    )
    
    # Signal details
    signal_parameters: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        doc="Parameters used to generate the signal"
    )
    
    description: Mapped[Optional[str]] = mapped_column(
        String(1000),
        nullable=True,
        doc="Detailed signal description"
    )
    
    # Validation
    is_validated: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        doc="Whether signal has been validated"
    )
    
    validation_result: Mapped[Optional[bool]] = mapped_column(
        Boolean,
        nullable=True,
        doc="Whether signal prediction was correct"
    )
    
    # Indexes for signal queries
    __table_args__ = (
        Index("idx_signal_events_round_id", "round_id"),
        Index("idx_signal_events_type", "signal_type"),
        Index("idx_signal_events_severity", "severity"),
        Index("idx_signal_events_timestamp", "created_at"),
    )
    
    def __repr__(self) -> str:
        return f"<SignalEvent(id={self.id}, signal_type={self.signal_type}, strength={self.strength})>"


class PredictionPlugin(BaseModel, TimestampMixin):
    """
    Stores user-created prediction system modifications (plugins).
    """
    
    __tablename__ = "prediction_plugins"
    
    # Identification
    plugin_id: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=False,
        doc="Unique plugin identifier"
    )
    
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        doc="Plugin name"
    )
    
    version: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        doc="Plugin version"
    )
    
    author: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        doc="Plugin author"
    )
    
    description: Mapped[Optional[str]] = mapped_column(
        String(1000),
        nullable=True,
        doc="Plugin description"
    )
    
    # Plugin configuration
    plugin_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        doc="Plugin type (strategy, signal, modifier, hybrid)"
    )
    
    config_schema: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        doc="Plugin configuration schema"
    )
    
    default_config: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        doc="Default configuration values"
    )
    
    # Plugin code
    plugin_code: Mapped[Optional[str]] = mapped_column(
        String,
        nullable=True,
        doc="Plugin implementation code"
    )
    
    entry_point: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        doc="Plugin entry point function"
    )
    
    # Dependencies
    dependencies: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
        doc="Plugin dependencies"
    )
    
    # Status
    is_enabled: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        doc="Whether plugin is enabled"
    )
    
    is_valid: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        doc="Whether plugin configuration is valid"
    )
    
    # Performance tracking
    total_predictions: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
        doc="Total predictions made by this plugin"
    )
    
    successful_predictions: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
        doc="Successful predictions by this plugin"
    )
    
    # Indexes for plugin queries
    __table_args__ = (
        Index("idx_prediction_plugins_type", "plugin_type"),
        Index("idx_prediction_plugins_enabled", "is_enabled"),
        Index("idx_prediction_plugins_valid", "is_valid"),
    )
    
    def __repr__(self) -> str:
        return f"<PredictionPlugin(id={self.id}, name={self.name}, version={self.version})>"
    
    @property
    def success_rate(self) -> float:
        """Calculate plugin success rate."""
        if self.total_predictions == 0:
            return 0.0
        return self.successful_predictions / self.total_predictions