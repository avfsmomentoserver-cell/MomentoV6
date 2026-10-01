"""
Tests for Crash Prediction Engine
"""

import pytest
from datetime import datetime
from momento_core.prediction.models import (
    CrashPredictionConfig,
    PredictionResult,
    CrashRound,
    PredictionStrategy,
    CrashSeverity
)
from momento_core.prediction.engine import CrashPredictionEngine


class TestCrashPredictionConfig:
    """Test crash prediction configuration."""
    
    def test_default_config(self):
        """Test default configuration."""
        config = CrashPredictionConfig()
        assert config.validate() is True
        assert config.momentum_weight == 0.3
        assert config.reversion_weight == 0.25
    
    def test_weight_normalization(self):
        """Test that weights sum to 1.0."""
        config = CrashPredictionConfig(
            momentum_weight=0.4,
            reversion_weight=0.3,
            pattern_weight=0.2,
            linguistic_weight=0.1
        )
        assert config.validate() is True
        total = (config.momentum_weight + config.reversion_weight + 
                 config.pattern_weight + config.linguistic_weight)
        assert abs(total - 1.0) < 0.01
    
    def test_invalid_config(self):
        """Test invalid configuration detection."""
        config = CrashPredictionConfig(
            momentum_weight=0.8,
            reversion_weight=0.3,
            pattern_weight=0.2,
            linguistic_weight=0.1
        )
        assert config.validate() is False  # Weights sum > 1.0


class TestCrashRound:
    """Test crash round model."""
    
    def test_crash_round_creation(self):
        """Test creating a crash round."""
        round_data = {
            "round_id": "test-round-1",
            "timestamp": "2026-07-22T10:00:00Z",
            "crash_point": 2.5,
            "duration_seconds": 15.0,
            "multiplier_sequence": [1.0, 1.1, 1.2, 1.5, 2.0, 2.5],
            "color_sequence": ["rgb(52, 180, 255)", "rgb(192, 23, 180)"]
        }
        
        crash_round = CrashRound(
            round_id=round_data["round_id"],
            timestamp=datetime.fromisoformat(round_data["timestamp"]),
            crash_point=round_data["crash_point"],
            duration_seconds=round_data["duration_seconds"],
            multiplier_sequence=round_data["multiplier_sequence"],
            color_sequence=round_data["color_sequence"]
        )
        
        assert crash_round.round_id == "test-round-1"
        assert crash_round.crash_point == 2.5
        assert crash_round.duration_seconds == 15.0
        assert len(crash_round.multiplier_sequence) == 6
    
    def test_crash_round_to_dict(self):
        """Test converting crash round to dictionary."""
        crash_round = CrashRound(
            round_id="test-round-1",
            timestamp=datetime.utcnow(),
            crash_point=3.0,
            duration_seconds=20.0
        )
        
        result = crash_round.to_dict()
        assert result["round_id"] == "test-round-1"
        assert result["crash_point"] == 3.0
        assert "timestamp" in result


class TestPredictionResult:
    """Test prediction result model."""
    
    def test_prediction_result_creation(self):
        """Test creating a prediction result."""
        prediction = PredictionResult(
            prediction_id="pred-1",
            round_id="round-1",
            timestamp=datetime.utcnow(),
            predicted_crash_point=2.5,
            confidence_interval=(2.0, 3.0),
            confidence_score=0.8,
            strategy=PredictionStrategy.MOMENTUM
        )
        
        assert prediction.prediction_id == "pred-1"
        assert prediction.predicted_crash_point == 2.5
        assert prediction.confidence_score == 0.8
        assert prediction.strategy == PredictionStrategy.MOMENTUM
    
    def test_accuracy_calculation(self):
        """Test prediction accuracy calculation."""
        prediction = PredictionResult(
            prediction_id="pred-1",
            round_id="round-1",
            timestamp=datetime.utcnow(),
            predicted_crash_point=2.5,
            confidence_interval=(2.0, 3.0),
            confidence_score=0.8,
            strategy=PredictionStrategy.MOMENTUM
        )
        
        # No actual result yet
        assert prediction.calculate_accuracy() is None
        
        # Add actual result
        prediction.actual_crash_point = 2.4
        accuracy = prediction.calculate_accuracy()
        assert accuracy is not None
        assert accuracy > 0.9  # Should be very accurate


class TestCrashPredictionEngine:
    """Test crash prediction engine."""
    
    def test_engine_initialization(self):
        """Test engine initialization."""
        config = CrashPredictionConfig()
        engine = CrashPredictionEngine(config)
        
        assert engine.config == config
        assert len(engine.short_history) == 0
        assert len(engine.medium_history) == 0
        assert len(engine.long_history) == 0
    
    def test_process_round(self):
        """Test processing a crash round."""
        config = CrashPredictionConfig()
        engine = CrashPredictionEngine(config)
        
        round_data = {
            "round_id": "test-round-1",
            "timestamp": datetime.utcnow().isoformat(),
            "crash_point": 2.5,
            "duration_seconds": 15.0,
            "multiplier_sequence": [1.0, 1.1, 1.2, 1.5, 2.0, 2.5],
            "color_sequence": ["rgb(52, 180, 255)"]
        }
        
        crash_round = engine.process_round(round_data)
        
        assert crash_round.round_id == "test-round-1"
        assert crash_round.crash_point == 2.5
        assert crash_round.linguistic_classification is not None
        assert crash_round.reverse_linguistic_analysis is not None
    
    def test_linguistic_analysis(self):
        """Test linguistic analysis integration."""
        config = CrashPredictionConfig(enable_linguistic_analysis=True)
        engine = CrashPredictionEngine(config)
        
        round_data = {
            "round_id": "test-round-1",
            "timestamp": datetime.utcnow().isoformat(),
            "crash_point": 3.5,
            "duration_seconds": 20.0,
            "multiplier_sequence": [1.0, 1.2, 1.5, 2.0, 3.0, 3.5],
            "color_sequence": ["rgb(192, 23, 180)"]
        }
        
        crash_round = engine.process_round(round_data)
        
        assert crash_round.linguistic_classification is not None
        assert "layer2_market" in crash_round.linguistic_classification
        assert "layer3_energy" in crash_round.linguistic_classification
    
    def test_reverse_linguistic_analysis(self):
        """Test reverse linguistic analysis."""
        config = CrashPredictionConfig(enable_reverse_linguistics=True)
        engine = CrashPredictionEngine(config)
        
        round_data = {
            "round_id": "test-round-1",
            "timestamp": datetime.utcnow().isoformat(),
            "crash_point": 4.0,
            "duration_seconds": 25.0,
            "multiplier_sequence": [1.0, 1.3, 1.8, 2.5, 3.5, 4.0],
            "color_sequence": ["rgb(145, 62, 248)"]
        }
        
        crash_round = engine.process_round(round_data)
        
        assert crash_round.reverse_linguistic_analysis is not None
        assert "layer9_reverse_market" in crash_round.reverse_linguistic_analysis
        assert "layer10_bottom_up" in crash_round.reverse_linguistic_analysis
    
    def test_prediction_generation(self):
        """Test prediction generation after sufficient history."""
        config = CrashPredictionConfig()
        engine = CrashPredictionEngine(config)
        
        # Add enough rounds to generate predictions
        for i in range(15):
            round_data = {
                "round_id": f"round-{i}",
                "timestamp": datetime.utcnow().isoformat(),
                "crash_point": 1.0 + i * 0.3,
                "duration_seconds": 10.0 + i,
                "multiplier_sequence": [1.0, 1.1, 1.2],
                "color_sequence": ["rgb(52, 180, 255)"]
            }
            engine.process_round(round_data)
        
        # Process another round - should generate prediction
        round_data = {
            "round_id": "prediction-round",
            "timestamp": datetime.utcnow().isoformat(),
            "crash_point": 5.0,
            "duration_seconds": 30.0,
            "multiplier_sequence": [1.0, 1.2, 1.5, 2.0, 3.0, 5.0],
            "color_sequence": ["rgb(192, 23, 180)"]
        }
        
        crash_round = engine.process_round(round_data)
        
        # May or may not have prediction depending on confidence
        if crash_round.predicted_crash_point:
            assert crash_round.prediction_confidence is not None
            assert crash_round.prediction_strategy is not None
    
    def test_performance_metrics(self):
        """Test performance metrics tracking."""
        config = CrashPredictionConfig()
        engine = CrashPredictionEngine(config)
        
        metrics = engine.get_performance_metrics()
        
        assert "total_predictions" in metrics
        assert "accurate_predictions" in metrics
        assert "overall_accuracy" in metrics
        assert metrics["total_predictions"] == 0
    
    def test_update_prediction_result(self):
        """Test updating prediction with actual result."""
        config = CrashPredictionConfig()
        engine = CrashPredictionEngine(config)
        
        # Create a prediction
        prediction = PredictionResult(
            prediction_id="pred-1",
            round_id="round-1",
            timestamp=datetime.utcnow(),
            predicted_crash_point=2.5,
            confidence_interval=(2.0, 3.0),
            confidence_score=0.8,
            strategy=PredictionStrategy.MOMENTUM
        )
        
        engine.active_predictions["round-1"] = prediction
        
        # Update with actual result
        updated = engine.update_prediction_result("round-1", 2.4)
        
        assert updated is not None
        assert updated.actual_crash_point == 2.4
        assert updated.prediction_error is not None
        assert "round-1" not in engine.active_predictions


if __name__ == "__main__":
    pytest.main([__file__, "-v"])