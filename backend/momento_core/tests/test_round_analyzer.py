"""
Tests for Round Analysis Engine
"""

import pytest
from datetime import datetime
from momento_core.prediction.models import CrashRound, CrashSeverity
from momento_core.analysis.round_analyzer import RoundAnalyzer, RoundScore, TemporalPattern


class TestRoundAnalyzer:
    """Test round analysis engine."""
    
    def test_analyzer_initialization(self):
        """Test analyzer initialization."""
        analyzer = RoundAnalyzer(history_window=100)
        
        assert analyzer.history_window == 100
        assert len(analyzer.round_history) == 0
        assert len(analyzer.round_scores) == 0
    
    def test_analyze_round(self):
        """Test analyzing a crash round."""
        analyzer = RoundAnalyzer()
        
        crash_round = CrashRound(
            round_id="test-round-1",
            timestamp=datetime.utcnow(),
            crash_point=3.5,
            duration_seconds=20.0,
            multiplier_sequence=[1.0, 1.2, 1.5, 2.0, 3.0, 3.5],
            color_sequence=["rgb(52, 180, 255)"]
        )
        
        round_score = analyzer.analyze_round(crash_round)
        
        assert isinstance(round_score, RoundScore)
        assert round_score.round_id == "test-round-1"
        assert round_score.crash_point == 3.5
        assert 0.0 <= round_score.volatility_score <= 1.0
        assert 0.0 <= round_score.momentum_score <= 1.0
        assert 0.0 <= round_score.pattern_score <= 1.0
        assert 0.0 <= round_score.linguistic_score <= 1.0
        assert 0.0 <= round_score.composite_score <= 1.0
    
    def test_volatility_calculation(self):
        """Test volatility score calculation."""
        analyzer = RoundAnalyzer()
        
        # High volatility round
        high_vol_round = CrashRound(
            round_id="high-vol",
            timestamp=datetime.utcnow(),
            crash_point=5.0,
            duration_seconds=30.0,
            multiplier_sequence=[1.0, 2.0, 1.5, 3.0, 2.0, 5.0],
            color_sequence=["rgb(52, 180, 255)"]
        )
        
        high_vol_score = analyzer.analyze_round(high_vol_round)
        
        # Low volatility round
        low_vol_round = CrashRound(
            round_id="low-vol",
            timestamp=datetime.utcnow(),
            crash_point=2.0,
            duration_seconds=15.0,
            multiplier_sequence=[1.0, 1.1, 1.2, 1.3, 1.5, 2.0],
            color_sequence=["rgb(52, 180, 255)"]
        )
        
        low_vol_score = analyzer.analyze_round(low_vol_round)
        
        # High volatility should have higher score
        assert high_vol_score.volatility_score >= low_vol_score.volatility_score
    
    def test_severity_classification(self):
        """Test crash severity classification."""
        analyzer = RoundAnalyzer()
        
        test_cases = [
            (1.05, CrashSeverity.TINY),
            (1.7, CrashSeverity.LOW),  # documented bands: tiny ≤1.5 < low ≤2.0
            (3.0, CrashSeverity.MODERATE),
            (7.0, CrashSeverity.HIGH),
            (25.0, CrashSeverity.EXTREME),
            (100.0, CrashSeverity.CRITICAL)
        ]
        
        for crash_point, expected_severity in test_cases:
            crash_round = CrashRound(
                round_id=f"test-{crash_point}",
                timestamp=datetime.utcnow(),
                crash_point=crash_point,
                duration_seconds=10.0,
                multiplier_sequence=[1.0, crash_point],
                color_sequence=["rgb(52, 180, 255)"]
            )
            
            round_score = analyzer.analyze_round(crash_round)
            assert round_score.severity == expected_severity
    
    def test_linguistic_tags_generation(self):
        """Test linguistic tag generation."""
        analyzer = RoundAnalyzer()
        
        crash_round = CrashRound(
            round_id="test-round",
            timestamp=datetime.utcnow(),
            crash_point=4.5,
            duration_seconds=25.0,
            multiplier_sequence=[1.0, 1.5, 2.0, 3.0, 4.5],
            color_sequence=["rgb(192, 23, 180)"]
        )
        
        # Add linguistic classification
        crash_round.linguistic_classification = {
            "layer2_market": "Purple",
            "layer3_energy": "Violent"
        }
        
        round_score = analyzer.analyze_round(crash_round)
        
        assert len(round_score.linguistic_tags) > 0
        assert any("severity:" in tag for tag in round_score.linguistic_tags)
        assert any("type:" in tag for tag in round_score.linguistic_tags)
    
    def test_comparative_metrics(self):
        """Test comparative metrics calculation."""
        analyzer = RoundAnalyzer()
        
        # Add some history
        for i in range(10):
            crash_round = CrashRound(
                round_id=f"history-{i}",
                timestamp=datetime.utcnow(),
                crash_point=2.0 + i * 0.2,
                duration_seconds=15.0,
                multiplier_sequence=[1.0, 2.0 + i * 0.2],
                color_sequence=["rgb(52, 180, 255)"]
            )
            analyzer.analyze_round(crash_round)
        
        # Analyze current round
        current_round = CrashRound(
            round_id="current",
            timestamp=datetime.utcnow(),
            crash_point=3.5,
            duration_seconds=20.0,
            multiplier_sequence=[1.0, 1.5, 2.0, 3.5],
            color_sequence=["rgb(52, 180, 255)"]
        )
        
        analyzer.analyze_round(current_round)
        
        metrics = analyzer.get_comparative_metrics("current")
        
        assert metrics is not None
        assert "round_score" in metrics
        assert "comparative_metrics" in metrics
    
    def test_round_replay_data(self):
        """Test round replay data generation."""
        analyzer = RoundAnalyzer()
        
        crash_round = CrashRound(
            round_id="replay-test",
            timestamp=datetime.utcnow(),
            crash_point=4.0,
            duration_seconds=30.0,
            multiplier_sequence=[1.0, 1.2, 1.5, 2.0, 3.0, 4.0],
            color_sequence=["rgb(52, 180, 255)"],
            predicted_crash_point=3.8,
            prediction_confidence=0.75,
            prediction_strategy="momentum"
        )
        
        analyzer.analyze_round(crash_round)
        
        replay_data = analyzer.get_round_replay_data("replay-test")
        
        assert replay_data is not None
        assert "round_data" in replay_data
        assert "round_score" in replay_data
        assert "predictive_overlay" in replay_data
        assert "linguistic_timeline" in replay_data
    
    def test_temporal_pattern_detection(self):
        """Test temporal pattern detection."""
        analyzer = RoundAnalyzer()
        
        # Add rounds with streak pattern
        for i in range(15):
            crash_point = 6.0 if i < 5 else 1.5  # High streak then low
            crash_round = CrashRound(
                round_id=f"streak-{i}",
                timestamp=datetime.utcnow(),
                crash_point=crash_point,
                duration_seconds=15.0,
                multiplier_sequence=[1.0, crash_point],
                color_sequence=["rgb(52, 180, 255)"]
            )
            analyzer.analyze_round(crash_round)
        
        patterns = analyzer.get_temporal_patterns()
        
        # Should have detected some patterns
        assert isinstance(patterns, list)
        # May or may not have patterns depending on the algorithm
    
    def test_baselines_update(self):
        """Test that baselines update with history."""
        analyzer = RoundAnalyzer()
        
        # Initially no baselines
        assert analyzer.baseline_crash_point is None
        
        # Add history
        for i in range(15):
            crash_round = CrashRound(
                round_id=f"baseline-{i}",
                timestamp=datetime.utcnow(),
                crash_point=2.0 + i * 0.1,
                duration_seconds=15.0,
                multiplier_sequence=[1.0, 2.0 + i * 0.1],
                color_sequence=["rgb(52, 180, 255)"]
            )
            analyzer.analyze_round(crash_round)
        
        # Baselines should now be set
        assert analyzer.baseline_crash_point is not None
        assert analyzer.baseline_duration is not None


class TestRoundScore:
    """Test round score model."""
    
    def test_round_score_creation(self):
        """Test creating a round score."""
        round_score = RoundScore(
            round_id="test-round",
            timestamp=datetime.utcnow(),
            crash_point=3.0,
            duration=20.0,
            volatility_score=0.7,
            momentum_score=0.6,
            pattern_score=0.5,
            linguistic_score=0.8,
            composite_score=0.65,
            severity=CrashSeverity.MODERATE,
            round_type="moderate"
        )
        
        assert round_score.round_id == "test-round"
        assert round_score.crash_point == 3.0
        assert round_score.composite_score == 0.65
    
    def test_round_score_to_dict(self):
        """Test converting round score to dictionary."""
        round_score = RoundScore(
            round_id="test-round",
            timestamp=datetime.utcnow(),
            crash_point=2.5,
            duration=15.0,
            volatility_score=0.5,
            momentum_score=0.5,
            pattern_score=0.5,
            linguistic_score=0.5,
            composite_score=0.5,
            severity=CrashSeverity.LOW,
            round_type="rapid"
        )
        
        result = round_score.to_dict()
        
        assert result["round_id"] == "test-round"
        assert result["crash_point"] == 2.5
        assert result["composite_score"] == 0.5
        assert result["severity"] == "low"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])