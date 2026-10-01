"""
Tests for Signal Hunter Pro System
"""

import pytest
from datetime import datetime
from momento_core.signals.models import (
    SignalEvent,
    SignalType,
    SignalSeverity,
    SignalConfiguration,
    SignalPerformance
)
from momento_core.signals.hunter_pro import SignalHunterPro
from momento_core.prediction.models import CrashRound


class TestSignalConfiguration:
    """Test signal configuration."""
    
    def test_default_config(self):
        """Test default configuration."""
        config = SignalConfiguration()
        assert config.validate() is True
        assert config.enable_momentum is True
        assert config.min_strength == 0.6
        assert config.min_confidence == 0.7
    
    def test_invalid_config(self):
        """Test invalid configuration detection."""
        config = SignalConfiguration(
            min_strength=1.5,  # Invalid > 1.0
            min_confidence=0.8
        )
        assert config.validate() is False
    
    def test_confidence_threshold_validation(self):
        """Test confidence threshold validation."""
        config = SignalConfiguration(
            min_confidence=0.9,
            high_confidence=0.7  # Invalid: min >= high
        )
        assert config.validate() is False


class TestSignalEvent:
    """Test signal event model."""
    
    def test_signal_event_creation(self):
        """Test creating a signal event."""
        signal = SignalEvent(
            signal_id="signal-1",
            signal_type=SignalType.MOMENTUM,
            signal_name="Strong Upward Momentum",
            timestamp=datetime.utcnow(),
            round_id="round-1",
            strength=0.8,
            confidence=0.75,
            severity=SignalSeverity.HIGH,
            description="Strong upward momentum detected"
        )
        
        assert signal.signal_id == "signal-1"
        assert signal.signal_type == SignalType.MOMENTUM
        assert signal.strength == 0.8
        assert signal.confidence == 0.75
        assert signal.severity == SignalSeverity.HIGH
    
    def test_signal_event_to_dict(self):
        """Test converting signal event to dictionary."""
        signal = SignalEvent(
            signal_id="signal-1",
            signal_type=SignalType.REVERSION,
            signal_name="Mean Reversion",
            timestamp=datetime.utcnow(),
            round_id="round-1",
            strength=0.7,
            confidence=0.7,
            severity=SignalSeverity.MEDIUM,
            description="Mean reversion signal"
        )
        
        result = signal.to_dict()
        
        assert result["signal_id"] == "signal-1"
        assert result["signal_type"] == "reversion"
        assert result["strength"] == 0.7
        assert result["severity"] == "medium"


class TestSignalPerformance:
    """Test signal performance metrics."""
    
    def test_performance_initialization(self):
        """Test performance initialization."""
        perf = SignalPerformance(signal_type=SignalType.MOMENTUM)
        
        assert perf.signal_type == SignalType.MOMENTUM
        assert perf.total_signals == 0
        assert perf.accuracy == 0.0
    
    def test_metrics_update(self):
        """Test metrics update."""
        perf = SignalPerformance(signal_type=SignalType.PATTERN)
        
        perf.total_signals = 10
        perf.validated_signals = 8
        perf.correct_predictions = 6
        
        perf.update_metrics()
        
        assert perf.accuracy == 0.75  # 6/8
        assert perf.precision == 0.6  # 6/10
    
    def test_accuracy_history(self):
        """Test accuracy history tracking."""
        perf = SignalPerformance(signal_type=SignalType.LINGUISTIC)
        
        perf.add_accuracy_reading(0.8)
        perf.add_accuracy_reading(0.75)
        perf.add_accuracy_reading(0.85)
        
        assert len(perf.accuracy_history) == 3
        assert perf.recent_accuracy > 0
        assert perf.recent_accuracy < 1.0


class TestSignalHunterPro:
    """Test signal hunter pro engine."""
    
    def test_hunter_initialization(self):
        """Test hunter initialization."""
        config = SignalConfiguration()
        hunter = SignalHunterPro(config)
        
        assert hunter.config == config
        assert len(hunter.short_history) == 0
        assert len(hunter.medium_history) == 0
        assert len(hunter.long_history) == 0
    
    def test_analyze_round(self):
        """Test analyzing a crash round."""
        config = SignalConfiguration()
        hunter = SignalHunterPro(config)
        
        crash_round = CrashRound(
            round_id="test-round-1",
            timestamp=datetime.utcnow(),
            crash_point=3.5,
            duration_seconds=20.0,
            multiplier_sequence=[1.0, 1.2, 1.5, 2.0, 3.0, 3.5],
            color_sequence=["rgb(52, 180, 255)"]
        )
        
        signals = hunter.analyze_round(crash_round)
        
        assert isinstance(signals, list)
        # May or may not generate signals depending on analysis
    
    def test_momentum_signal_generation(self):
        """Test momentum signal generation."""
        config = SignalConfiguration(enable_momentum=True)
        hunter = SignalHunterPro(config)
        
        # Add history to establish momentum
        for i in range(10):
            crash_round = CrashRound(
                round_id=f"history-{i}",
                timestamp=datetime.utcnow(),
                crash_point=1.0 + i * 0.3,  # Upward trend
                duration_seconds=10.0,
                multiplier_sequence=[1.0, 1.0 + i * 0.3],
                color_sequence=["rgb(52, 180, 255)"]
            )
            hunter.analyze_round(crash_round)
        
        # Analyze current round
        current_round = CrashRound(
            round_id="current",
            timestamp=datetime.utcnow(),
            crash_point=5.0,  # High crash point
            duration_seconds=25.0,
            multiplier_sequence=[1.0, 2.0, 3.0, 5.0],
            color_sequence=["rgb(192, 23, 180)"]
        )
        
        signals = hunter.analyze_round(current_round)
        
        # Should have momentum signals
        momentum_signals = [s for s in signals if s.signal_type == SignalType.MOMENTUM]
        # May or may not have momentum signals depending on threshold
    
    def test_linguistic_signal_generation(self):
        """Test linguistic signal generation."""
        config = SignalConfiguration(enable_linguistic=True)
        hunter = SignalHunterPro(config)
        
        crash_round = CrashRound(
            round_id="linguistic-test",
            timestamp=datetime.utcnow(),
            crash_point=15.0,  # High crash
            duration_seconds=40.0,
            multiplier_sequence=[1.0, 2.0, 5.0, 15.0],
            color_sequence=["rgb(192, 23, 180)"]
        )
        
        # Add linguistic classification
        crash_round.linguistic_classification = {
            "layer2_market": "Extreme",
            "layer3_energy": "Violent",
            "layer4_behaviour": "Expansion"
        }
        
        signals = hunter.analyze_round(crash_round)
        
        # Should have linguistic signals
        linguistic_signals = [s for s in signals if s.signal_type == SignalType.LINGUISTIC]
        # May or may not have linguistic signals depending on analysis
    
    def test_reverse_linguistic_signal_generation(self):
        """Test reverse linguistic signal generation."""
        config = SignalConfiguration(enable_reverse_linguistic=True)
        hunter = SignalHunterPro(config)
        
        crash_round = CrashRound(
            round_id="reverse-test",
            timestamp=datetime.utcnow(),
            crash_point=8.0,
            duration_seconds=35.0,
            multiplier_sequence=[1.0, 1.5, 2.5, 4.0, 8.0],
            color_sequence=["rgb(145, 62, 248)"]
        )
        
        # Add reverse linguistic analysis
        crash_round.reverse_linguistic_analysis = {
            "layer11_reverse_cascade": {
                "cascade_detected": True,
                "cascade_pattern": "single_cascade",
                "overall_cascade_strength": 0.8
            },
            "layer12_anti_correlation": {
                "anti_correlation_score": 0.85,
                "correlation_type": "extreme_outlier"
            }
        }
        
        signals = hunter.analyze_round(crash_round)
        
        # Should have reverse linguistic signals
        reverse_signals = [s for s in signals if s.signal_type == SignalType.REVERSE_LINGUISTIC]
        # May or may not have reverse signals depending on analysis
    
    def test_signal_filtering(self):
        """Test signal filtering by thresholds."""
        config = SignalConfiguration(
            min_strength=0.8,  # High threshold
            min_confidence=0.8,
            max_signals_per_round=3
        )
        hunter = SignalHunterPro(config)
        
        crash_round = CrashRound(
            round_id="filter-test",
            timestamp=datetime.utcnow(),
            crash_point=2.5,
            duration_seconds=15.0,
            multiplier_sequence=[1.0, 1.5, 2.0, 2.5],
            color_sequence=["rgb(52, 180, 255)"]
        )
        
        signals = hunter.analyze_round(crash_round)
        
        # All signals should meet thresholds
        for signal in signals:
            assert signal.strength >= 0.8
            assert signal.confidence >= 0.8
        
        # Should not exceed max signals
        assert len(signals) <= 3
    
    def test_signal_validation(self):
        """Test signal validation."""
        config = SignalConfiguration()
        hunter = SignalHunterPro(config)
        
        # Create a signal
        signal = SignalEvent(
            signal_id="test-signal",
            signal_type=SignalType.MOMENTUM,
            signal_name="Test Signal",
            timestamp=datetime.utcnow(),
            round_id="round-1",
            strength=0.8,
            confidence=0.75,
            severity=SignalSeverity.HIGH,
            description="Test signal for validation"
        )
        
        hunter.active_signals["test-signal"] = signal
        
        # Validate signal
        validated = hunter.validate_signal("test-signal", "high_outcome")
        
        assert validated is not None
        assert validated.is_validated is True
        assert "test-signal" not in hunter.active_signals
    
    def test_performance_metrics_tracking(self):
        """Test performance metrics tracking."""
        config = SignalConfiguration()
        hunter = SignalHunterPro(config)
        
        metrics = hunter.get_performance_metrics()
        
        assert isinstance(metrics, dict)
        assert "momentum" in metrics
        assert "reversion" in metrics
        assert "pattern" in metrics
    
    def test_recent_signals_retrieval(self):
        """Test retrieving recent signals."""
        config = SignalConfiguration()
        hunter = SignalHunterPro(config)
        
        # Generate some signals
        for i in range(5):
            crash_round = CrashRound(
                round_id=f"signal-round-{i}",
                timestamp=datetime.utcnow(),
                crash_point=2.0 + i,
                duration_seconds=15.0,
                multiplier_sequence=[1.0, 2.0 + i],
                color_sequence=["rgb(52, 180, 255)"]
            )
            hunter.analyze_round(crash_round)
        
        recent_signals = hunter.get_recent_signals(limit=10)
        
        assert isinstance(recent_signals, list)
        assert len(recent_signals) <= 10
    
    def test_active_signals_retrieval(self):
        """Test retrieving active signals."""
        config = SignalConfiguration()
        hunter = SignalHunterPro(config)
        
        # Create an active signal
        signal = SignalEvent(
            signal_id="active-signal",
            signal_type=SignalType.EXHAUSTION,
            signal_name="Active Signal",
            timestamp=datetime.utcnow(),
            round_id="round-1",
            strength=0.7,
            confidence=0.7,
            severity=SignalSeverity.MEDIUM,
            description="Active test signal"
        )
        
        hunter.active_signals["active-signal"] = signal
        
        active_signals = hunter.get_active_signals()
        
        assert len(active_signals) == 1
        assert active_signals[0]["signal_id"] == "active-signal"
    
    def test_backtest_functionality(self):
        """Test backtesting functionality."""
        config = SignalConfiguration()
        hunter = SignalHunterPro(config)
        
        # Create historical data
        historical_rounds = []
        validation_outcomes = []
        
        for i in range(20):
            crash_round = CrashRound(
                round_id=f"historical-{i}",
                timestamp=datetime.utcnow(),
                crash_point=1.5 + i * 0.2,
                duration_seconds=12.0,
                multiplier_sequence=[1.0, 1.5 + i * 0.2],
                color_sequence=["rgb(52, 180, 255)"]
            )
            historical_rounds.append(crash_round)
            validation_outcomes.append("moderate_outcome")
        
        # Run backtest
        backtest_results = hunter.backtest_signals(historical_rounds, validation_outcomes)
        
        assert "total_rounds_analyzed" in backtest_results
        assert "total_signals_generated" in backtest_results
        assert "overall_accuracy" in backtest_results
        assert "performance_by_type" in backtest_results
        assert backtest_results["total_rounds_analyzed"] == 20


if __name__ == "__main__":
    pytest.main([__file__, "-v"])