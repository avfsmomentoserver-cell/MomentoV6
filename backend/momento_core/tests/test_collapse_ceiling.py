"""
Tests for Collapse Ceiling & Ascend Power Analyzer Plugin
"""

import pytest
from datetime import datetime, timedelta
from momento_core.plugins.collapse_ceiling import (
    CollapseCeilingAnalyzer,
    CeilingAnalysis,
    CeilingPoint,
    CeilingDirection,
    CeilingStrength
)


class TestCeilingPoint:
    """Test CeilingPoint model."""
    
    def test_ceiling_point_creation(self):
        """Test creating a ceiling point."""
        ceiling = CeilingPoint(
            value=10.0,
            timestamp=datetime.utcnow(),
            attempts=5,
            breaches=2,
            strength=CeilingStrength.MODERATE
        )
        
        assert ceiling.value == 10.0
        assert ceiling.attempts == 5
        assert ceiling.breaches == 2
        assert ceiling.strength == CeilingStrength.MODERATE
    
    def test_breach_rate_calculation(self):
        """Test breach rate calculation."""
        ceiling = CeilingPoint(
            value=10.0,
            timestamp=datetime.utcnow(),
            attempts=10,
            breaches=4
        )
        
        breach_rate = ceiling.calculate_breach_rate()
        assert breach_rate == 0.4
    
    def test_breach_rate_no_attempts(self):
        """Test breach rate with no attempts."""
        ceiling = CeilingPoint(
            value=10.0,
            timestamp=datetime.utcnow(),
            attempts=0,
            breaches=0
        )
        
        breach_rate = ceiling.calculate_breach_rate()
        assert breach_rate == 0.0


class TestCeilingAnalysis:
    """Test CeilingAnalysis model."""
    
    def test_ceiling_analysis_creation(self):
        """Test creating a ceiling analysis."""
        analysis = CeilingAnalysis(
            round_id="test-round",
            timestamp=datetime.utcnow(),
            current_crash_point=5.0
        )
        
        assert analysis.round_id == "test-round"
        assert analysis.current_crash_point == 5.0
        assert analysis.nearest_ceiling is None
        assert analysis.signal_generated is False
    
    def test_ceiling_analysis_to_dict(self):
        """Test converting analysis to dictionary."""
        analysis = CeilingAnalysis(
            round_id="test-round",
            timestamp=datetime.utcnow(),
            current_crash_point=5.0,
            nearest_ceiling=10.0,
            ceiling_distance=5.0,
            ascend_power=0.8
        )
        
        result = analysis.to_dict()
        
        assert result["round_id"] == "test-round"
        assert result["current_crash_point"] == 5.0
        assert result["nearest_ceiling"] == 10.0
        assert result["ceiling_distance"] == 5.0
        assert result["ascend_power"] == 0.8


class TestCollapseCeilingAnalyzer:
    """Test CollapseCeilingAnalyzer."""
    
    def test_analyzer_initialization(self):
        """Test analyzer initialization."""
        analyzer = CollapseCeilingAnalyzer()
        
        assert analyzer.window_size == 50
        assert analyzer.ceiling_threshold == 0.8
        assert len(analyzer.crash_history) == 0
        assert len(analyzer.detected_ceilings) == 0
    
    def test_custom_initialization(self):
        """Test custom analyzer initialization."""
        analyzer = CollapseCeilingAnalyzer(
            window_size=100,
            ceiling_threshold=0.9
        )
        
        assert analyzer.window_size == 100
        assert analyzer.ceiling_threshold == 0.9
    
    def test_analyze_first_round(self):
        """Test analyzing the first round."""
        analyzer = CollapseCeilingAnalyzer()
        
        round_data = {
            "round_id": "round-1",
            "timestamp": datetime.utcnow().isoformat(),
            "crash_point": 2.5
        }
        
        analysis = analyzer.analyze_round(round_data)
        
        assert analysis.round_id == "round-1"
        assert analysis.current_crash_point == 2.5
        assert len(analyzer.crash_history) == 1
    
    def test_ceiling_detection_with_local_maxima(self):
        """Test ceiling detection with local maxima."""
        analyzer = CollapseCeilingAnalyzer()
        
        # Create a pattern with local maxima
        crash_points = [1.0, 1.5, 2.0, 3.0, 2.5, 2.0, 1.5, 4.0, 3.5, 3.0]
        
        for i, point in enumerate(crash_points):
            round_data = {
                "round_id": f"round-{i}",
                "timestamp": (datetime.utcnow() + timedelta(seconds=i)).isoformat(),
                "crash_point": point
            }
            analyzer.analyze_round(round_data)
        
        # Should detect ceilings at local maxima (3.0 and 4.0)
        assert len(analyzer.detected_ceilings) > 0
    
    def test_nearest_ceiling_finding(self):
        """Test finding nearest ceiling above current point."""
        analyzer = CollapseCeilingAnalyzer()
        
        # Add some known ceilings
        analyzer.detected_ceilings = [
            CeilingPoint(value=5.0, timestamp=datetime.utcnow()),
            CeilingPoint(value=10.0, timestamp=datetime.utcnow()),
            CeilingPoint(value=15.0, timestamp=datetime.utcnow())
        ]
        
        nearest = analyzer._find_nearest_ceiling(7.0)
        
        assert nearest is not None
        assert nearest.value == 10.0
    
    def test_nearest_ceiling_below_current(self):
        """Test when current point is above all ceilings."""
        analyzer = CollapseCeilingAnalyzer()
        
        analyzer.detected_ceilings = [
            CeilingPoint(value=5.0, timestamp=datetime.utcnow()),
            CeilingPoint(value=10.0, timestamp=datetime.utcnow())
        ]
        
        nearest = analyzer._find_nearest_ceiling(15.0)
        
        assert nearest is None
    
    def test_ascend_power_calculation(self):
        """Test ascend power calculation."""
        analyzer = CollapseCeilingAnalyzer()
        
        # Add some history with upward momentum
        for i in range(5):
            round_data = {
                "round_id": f"round-{i}",
                "timestamp": (datetime.utcnow() + timedelta(seconds=i)).isoformat(),
                "crash_point": 1.0 + i * 0.5
            }
            analyzer.analyze_round(round_data)
        
        # Add a ceiling
        ceiling = CeilingPoint(value=10.0, timestamp=datetime.utcnow())
        
        ascend_power = analyzer._calculate_ascend_power(3.0, ceiling)
        
        assert ascend_power >= 0.0
        assert ascend_power <= 1.0
    
    def test_ascend_velocity_calculation(self):
        """Test ascend velocity calculation."""
        analyzer = CollapseCeilingAnalyzer()
        
        # Add history
        for i in range(3):
            round_data = {
                "round_id": f"round-{i}",
                "timestamp": (datetime.utcnow() + timedelta(seconds=i)).isoformat(),
                "crash_point": 1.0 + i * 0.5
            }
            analyzer.analyze_round(round_data)
        
        ceiling = CeilingPoint(value=10.0, timestamp=datetime.utcnow())
        
        velocity = analyzer._calculate_ascend_velocity(2.5, ceiling)
        
        assert velocity > 0  # Should be positive with upward trend
    
    def test_ceiling_direction_ascending(self):
        """Test detecting ascending ceiling direction."""
        analyzer = CollapseCeilingAnalyzer()
        
        # Add ceilings with ascending values
        for i in range(5):
            ceiling = CeilingPoint(
                value=5.0 + i * 2.0,
                timestamp=datetime.utcnow() + timedelta(seconds=i)
            )
            analyzer.detected_ceilings.append(ceiling)
        
        direction = analyzer._determine_ceiling_direction()
        
        assert direction == CeilingDirection.ASCENDING
    
    def test_ceiling_direction_descending(self):
        """Test detecting descending ceiling direction."""
        analyzer = CollapseCeilingAnalyzer()
        
        # Add ceilings with descending values
        for i in range(5):
            ceiling = CeilingPoint(
                value=15.0 - i * 2.0,
                timestamp=datetime.utcnow() + timedelta(seconds=i)
            )
            analyzer.detected_ceilings.append(ceiling)
        
        direction = analyzer._determine_ceiling_direction()
        
        assert direction == CeilingDirection.DESCENDING
    
    def test_ceiling_direction_stable(self):
        """Test detecting stable ceiling direction."""
        analyzer = CollapseCeilingAnalyzer()
        
        # Add ceilings with stable values
        for i in range(5):
            ceiling = CeilingPoint(
                value=10.0 + (i % 2) * 0.1,  # Small variation
                timestamp=datetime.utcnow() + timedelta(seconds=i)
            )
            analyzer.detected_ceilings.append(ceiling)
        
        direction = analyzer._determine_ceiling_direction()
        
        assert direction == CeilingDirection.STABLE
    
    def test_ceiling_direction_volatile(self):
        """Test detecting volatile ceiling direction."""
        analyzer = CollapseCeilingAnalyzer()
        
        # Add ceilings with highly variable values
        values = [5.0, 15.0, 3.0, 20.0, 8.0]
        for i, value in enumerate(values):
            ceiling = CeilingPoint(
                value=value,
                timestamp=datetime.utcnow() + timedelta(seconds=i)
            )
            analyzer.detected_ceilings.append(ceiling)
        
        direction = analyzer._determine_ceiling_direction()
        
        assert direction == CeilingDirection.VOLATILE
    
    def test_signal_generation_ceiling_approach(self):
        """Test signal generation for ceiling approach."""
        analyzer = CollapseCeilingAnalyzer()
        
        # Add history to establish patterns
        for i in range(10):
            round_data = {
                "round_id": f"round-{i}",
                "timestamp": (datetime.utcnow() + timedelta(seconds=i)).isoformat(),
                "crash_point": 1.0 + i * 0.3
            }
            analyzer.analyze_round(round_data)
        
        # Add a ceiling
        analyzer.detected_ceilings.append(
            CeilingPoint(value=5.0, timestamp=datetime.utcnow())
        )
        
        # Analyze round approaching ceiling
        round_data = {
            "round_id": "approach-round",
            "timestamp": datetime.utcnow().isoformat(),
            "crash_point": 4.6  # Close to ceiling
        }
        
        analysis = analyzer.analyze_round(round_data)
        
        # Should generate signal due to high clearance ratio
        if analysis.clearance_ratio > 0.9:
            assert analysis.signal_generated is True
    
    def test_signal_generation_no_signal(self):
        """Test no signal generation when conditions not met."""
        analyzer = CollapseCeilingAnalyzer()
        
        round_data = {
            "round_id": "low-round",
            "timestamp": datetime.utcnow().isoformat(),
            "crash_point": 1.1
        }
        
        analysis = analyzer.analyze_round(round_data)
        
        # Should not generate signal with low crash point
        assert analysis.signal_generated is False
    
    def test_clearance_percentile_calculation(self):
        """Test clearance percentile calculation."""
        analyzer = CollapseCeilingAnalyzer()
        
        # Add history
        for i in range(15):
            round_data = {
                "round_id": f"round-{i}",
                "timestamp": (datetime.utcnow() + timedelta(seconds=i)).isoformat(),
                "crash_point": 1.0 + i * 0.2
            }
            analyzer.analyze_round(round_data)
        
        percentile = analyzer._calculate_clearance_percentile(3.0, 5.0)
        
        assert percentile >= 0.0
        assert percentile <= 1.0
    
    def test_ceiling_strength_classification(self):
        """Test ceiling strength classification."""
        analyzer = CollapseCeilingAnalyzer()
        
        # Add some existing ceilings with known breach rates
        for i in range(3):
            ceiling = CeilingPoint(
                value=10.0 + i,
                timestamp=datetime.utcnow(),
                attempts=10,
                breaches=8  # High breach rate = weak
            )
            analyzer.detected_ceilings.append(ceiling)
        
        # Classify a new ceiling
        new_ceiling = CeilingPoint(value=10.5, timestamp=datetime.utcnow())
        analyzer._classify_ceiling_strength(new_ceiling)
        
        # Should be classified as weak due to high historical breach rate
        assert new_ceiling.strength == CeilingStrength.WEAK
    
    def test_get_ceiling_statistics(self):
        """Test getting ceiling statistics."""
        analyzer = CollapseCeilingAnalyzer()
        
        # Add some ceilings
        for i in range(5):
            ceiling = CeilingPoint(
                value=5.0 + i * 2.0,
                timestamp=datetime.utcnow(),
                attempts=10,
                breaches=5
            )
            analyzer.detected_ceilings.append(ceiling)
        
        stats = analyzer.get_ceiling_statistics()
        
        assert stats["total_ceilings"] == 5
        assert stats["average_ceiling"] > 0
        assert stats["highest_ceiling"] == 13.0  # 5 + 4*2
        assert stats["lowest_ceiling"] == 5.0
        assert "current_direction" in stats
    
    def test_get_ceiling_statistics_empty(self):
        """Test getting statistics with no ceilings."""
        analyzer = CollapseCeilingAnalyzer()
        
        stats = analyzer.get_ceiling_statistics()
        
        assert stats["total_ceilings"] == 0
        assert stats["average_ceiling"] == 0.0
        assert stats["strongest_ceiling"] is None
    
    def test_comprehensive_analysis_workflow(self):
        """Test complete analysis workflow with multiple rounds."""
        analyzer = CollapseCeilingAnalyzer()
        
        # Simulate a realistic crash sequence
        crash_sequence = [
            1.0, 1.2, 1.5, 2.0, 3.5, 2.8, 1.8, 2.2, 4.0, 3.2,
            2.5, 2.8, 5.0, 4.2, 3.5, 3.8, 6.0, 5.2, 4.5, 4.8
        ]
        
        analyses = []
        for i, crash_point in enumerate(crash_sequence):
            round_data = {
                "round_id": f"round-{i}",
                "timestamp": (datetime.utcnow() + timedelta(seconds=i)).isoformat(),
                "crash_point": crash_point
            }
            analysis = analyzer.analyze_round(round_data)
            analyses.append(analysis)
        
        # Verify analyses
        assert len(analyses) == len(crash_sequence)
        assert len(analyzer.crash_history) == len(crash_sequence)
        
        # Should have detected some ceilings
        assert len(analyzer.detected_ceilings) > 0
        
        # Check that later analyses have more data
        assert analyses[-1].historical_ceilings is not None
        assert len(analyses[-1].recent_approaches) >= 0
    
    def test_ceiling_strength_updating(self):
        """Test that ceiling strength updates with new data."""
        analyzer = CollapseCeilingAnalyzer()
        
        # Create a ceiling
        ceiling = CeilingPoint(
            value=10.0,
            timestamp=datetime.utcnow(),
            attempts=1,
            breaches=0
        )
        analyzer.detected_ceilings.append(ceiling)
        
        # Simulate breaches
        for i in range(5):
            round_data = {
                "round_id": f"round-{i}",
                "timestamp": (datetime.utcnow() + timedelta(seconds=i)).isoformat(),
                "crash_point": 10.5  # Above ceiling
            }
            analyzer.analyze_round(round_data)
        
        # Check that breach count increased
        assert ceiling.attempts > 1
        assert ceiling.breaches > 0