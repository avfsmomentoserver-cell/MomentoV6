"""
Tests for Gap Swing Analyzer Plugin
"""

import pytest
from datetime import datetime, timedelta
from momento_core.plugins.gap_swing import (
    GapSwingAnalyzer,
    GapAnalysis,
    GapCrossing,
    GapDirection,
    GapStrength
)


class TestGapCrossing:
    """Test GapCrossing model."""
    
    def test_gap_crossing_creation(self):
        """Test creating a gap crossing."""
        crossing = GapCrossing(
            gap_value=10.0,
            direction=GapDirection.UPWARD,
            timestamp=datetime.utcnow(),
            round_id="test-round",
            crossing_velocity=0.5,
            crossing_confidence=0.8
        )
        
        assert crossing.gap_value == 10.0
        assert crossing.direction == GapDirection.UPWARD
        assert crossing.round_id == "test-round"
        assert crossing.crossing_velocity == 0.5
        assert crossing.crossing_confidence == 0.8
    
    def test_success_rate_calculation(self):
        """Test success rate calculation."""
        crossing = GapCrossing(
            gap_value=10.0,
            direction=GapDirection.UPWARD,
            timestamp=datetime.utcnow(),
            round_id="test-round",
            validation_count=10,
            success_count=7
        )
        
        success_rate = crossing.calculate_success_rate()
        assert success_rate == 0.7
    
    def test_success_rate_no_validations(self):
        """Test success rate with no validations."""
        crossing = GapCrossing(
            gap_value=10.0,
            direction=GapDirection.UPWARD,
            timestamp=datetime.utcnow(),
            round_id="test-round",
            validation_count=0,
            success_count=0
        )
        
        success_rate = crossing.calculate_success_rate()
        assert success_rate == 0.0


class TestGapAnalysis:
    """Test GapAnalysis model."""
    
    def test_gap_analysis_creation(self):
        """Test creating a gap analysis."""
        analysis = GapAnalysis(
            round_id="test-round",
            timestamp=datetime.utcnow(),
            current_crash_point=5.0
        )
        
        assert analysis.round_id == "test-round"
        assert analysis.current_crash_point == 5.0
        assert analysis.gap_crossing_detected is False
        assert analysis.signal_generated is False
    
    def test_gap_analysis_to_dict(self):
        """Test converting analysis to dictionary."""
        analysis = GapAnalysis(
            round_id="test-round",
            timestamp=datetime.utcnow(),
            current_crash_point=5.0,
            gap_10x=10.0,
            gap_100x=100.0,
            swing_magnitude=0.3,
            swing_direction=GapDirection.UPWARD
        )
        
        result = analysis.to_dict()
        
        assert result["round_id"] == "test-round"
        assert result["current_crash_point"] == 5.0
        assert result["gap_10x"] == 10.0
        assert result["gap_100x"] == 100.0
        assert result["swing_magnitude"] == 0.3
        assert result["swing_direction"] == "upward"


class TestGapSwingAnalyzer:
    """Test GapSwingAnalyzer."""
    
    def test_analyzer_initialization(self):
        """Test analyzer initialization."""
        analyzer = GapSwingAnalyzer()
        
        assert analyzer.ma_periods == [10, 50, 100, 200]
        assert analyzer.gap_levels == [10.0, 100.0]
        assert analyzer.repeat_test_iterations == 5
        assert len(analyzer.crash_history) == 0
        assert len(analyzer.gap_crossings) == 0
    
    def test_custom_initialization(self):
        """Test custom analyzer initialization."""
        analyzer = GapSwingAnalyzer(
            ma_periods=[5, 20, 50],
            gap_levels=[5.0, 20.0, 50.0],
            repeat_test_iterations=10
        )
        
        assert analyzer.ma_periods == [5, 20, 50]
        assert analyzer.gap_levels == [5.0, 20.0, 50.0]
        assert analyzer.repeat_test_iterations == 10
    
    def test_analyze_first_round(self):
        """Test analyzing the first round."""
        analyzer = GapSwingAnalyzer()
        
        round_data = {
            "round_id": "round-1",
            "timestamp": datetime.utcnow().isoformat(),
            "crash_point": 2.5
        }
        
        analysis = analyzer.analyze_round(round_data)
        
        assert analysis.round_id == "round-1"
        assert analysis.current_crash_point == 2.5
        assert len(analyzer.crash_history) == 1
    
    def test_moving_average_calculation(self):
        """Test moving average calculation."""
        analyzer = GapSwingAnalyzer()
        
        # Add enough data for MA calculation
        for i in range(15):
            round_data = {
                "round_id": f"round-{i}",
                "timestamp": (datetime.utcnow() + timedelta(seconds=i)).isoformat(),
                "crash_point": 1.0 + i * 0.1
            }
            analyzer.analyze_round(round_data)
        
        # Get latest analysis
        analysis = analyzer.analyze_round({
            "round_id": "latest",
            "timestamp": datetime.utcnow().isoformat(),
            "crash_point": 2.5
        })
        
        # Should have calculated MA10
        assert analysis.ma_10 > 0
    
    def test_moving_average_200_period(self):
        """Test 200-period moving average calculation."""
        analyzer = GapSwingAnalyzer()
        
        # Add 250 rounds of data
        for i in range(250):
            round_data = {
                "round_id": f"round-{i}",
                "timestamp": (datetime.utcnow() + timedelta(seconds=i)).isoformat(),
                "crash_point": 1.0 + i * 0.01
            }
            analyzer.analyze_round(round_data)
        
        # Get latest analysis
        analysis = analyzer.analyze_round({
            "round_id": "latest",
            "timestamp": datetime.utcnow().isoformat(),
            "crash_point": 3.5
        })
        
        # Should have calculated MA200
        assert analysis.ma_200 > 0
        assert analysis.ma_10 > analysis.ma_200  # in an upward trend the short MA leads the long MA
    
    def test_current_gap_determination(self):
        """Test determining current relevant gap."""
        analyzer = GapSwingAnalyzer()
        
        # Test with crash point below all gaps
        gap = analyzer._determine_current_gap(5.0)
        assert gap == 10.0  # Should return 10x gap
        
        # Test with crash point between gaps
        gap = analyzer._determine_current_gap(50.0)
        assert gap == 100.0  # Should return 100x gap
        
        # Test with crash point above all gaps
        gap = analyzer._determine_current_gap(150.0)
        assert gap == 100.0  # Should return highest gap
    
    def test_swing_magnitude_calculation(self):
        """Test swing magnitude calculation."""
        analyzer = GapSwingAnalyzer()
        
        # Add history with variation
        for i, point in enumerate([1.0, 1.5, 2.0, 1.8, 2.5]):
            round_data = {
                "round_id": f"round-{i}",
                "timestamp": (datetime.utcnow() + timedelta(seconds=i)).isoformat(),
                "crash_point": point
            }
            analyzer.analyze_round(round_data)
        
        magnitude = analyzer._calculate_swing_magnitude(2.5)
        
        assert magnitude >= 0.0
        assert magnitude <= 1.0
    
    def test_swing_direction_upward(self):
        """Test detecting upward swing direction."""
        analyzer = GapSwingAnalyzer()
        
        # Add upward trend
        for i in range(3):
            round_data = {
                "round_id": f"round-{i}",
                "timestamp": (datetime.utcnow() + timedelta(seconds=i)).isoformat(),
                "crash_point": 1.0 + i * 0.5
            }
            analyzer.analyze_round(round_data)
        
        direction = analyzer._determine_swing_direction(2.5)
        
        assert direction == GapDirection.UPWARD
    
    def test_swing_direction_downward(self):
        """Test detecting downward swing direction."""
        analyzer = GapSwingAnalyzer()
        
        # Add downward trend
        for i in range(3):
            round_data = {
                "round_id": f"round-{i}",
                "timestamp": (datetime.utcnow() + timedelta(seconds=i)).isoformat(),
                "crash_point": 3.0 - i * 0.5
            }
            analyzer.analyze_round(round_data)
        
        direction = analyzer._determine_swing_direction(1.5)
        
        assert direction == GapDirection.DOWNWARD
    
    def test_swing_velocity_calculation(self):
        """Test swing velocity calculation."""
        analyzer = GapSwingAnalyzer()
        
        # Add history
        for i in range(3):
            round_data = {
                "round_id": f"round-{i}",
                "timestamp": (datetime.utcnow() + timedelta(seconds=i)).isoformat(),
                "crash_point": 1.0 + i * 0.5
            }
            analyzer.analyze_round(round_data)
        
        velocity = analyzer._calculate_swing_velocity()
        
        assert velocity > 0  # Should be positive with upward trend
    
    def test_gap_crossing_detection_upward(self):
        """Test upward gap crossing detection."""
        analyzer = GapSwingAnalyzer()
        
        # Add history below 10x gap
        analyzer.crash_history.append({
            "round_id": "round-1",
            "timestamp": datetime.utcnow(),
            "crash_point": 9.5
        })
        
        # Analyze round that crosses 10x gap
        round_data = {
            "round_id": "round-2",
            "timestamp": datetime.utcnow().isoformat(),
            "crash_point": 10.5
        }
        
        analysis = analyzer.analyze_round(round_data)
        
        assert analysis.gap_crossing_detected is True
        assert analysis.crossing_type == "upward_10.0x"
    
    def test_gap_crossing_detection_downward(self):
        """Test downward gap crossing detection."""
        analyzer = GapSwingAnalyzer()
        
        # Add history above 10x gap
        analyzer.crash_history.append({
            "round_id": "round-1",
            "timestamp": datetime.utcnow(),
            "crash_point": 10.5
        })
        
        # Analyze round that crosses below 10x gap
        round_data = {
            "round_id": "round-2",
            "timestamp": datetime.utcnow().isoformat(),
            "crash_point": 9.5
        }
        
        analysis = analyzer.analyze_round(round_data)
        
        assert analysis.gap_crossing_detected is True
        assert analysis.crossing_type == "downward_10.0x"
    
    def test_gap_crossing_detection_100x(self):
        """Test 100x gap crossing detection."""
        analyzer = GapSwingAnalyzer()
        
        # Add history below 100x gap
        analyzer.crash_history.append({
            "round_id": "round-1",
            "timestamp": datetime.utcnow(),
            "crash_point": 95.0
        })
        
        # Analyze round that crosses 100x gap
        round_data = {
            "round_id": "round-2",
            "timestamp": datetime.utcnow().isoformat(),
            "crash_point": 105.0
        }
        
        analysis = analyzer.analyze_round(round_data)
        
        assert analysis.gap_crossing_detected is True
        assert analysis.crossing_type == "upward_100.0x"
    
    def test_crossing_confidence_calculation(self):
        """Test crossing confidence calculation."""
        analyzer = GapSwingAnalyzer()
        
        # Add some history
        for i in range(10):
            round_data = {
                "round_id": f"round-{i}",
                "timestamp": (datetime.utcnow() + timedelta(seconds=i)).isoformat(),
                "crash_point": 1.0 + i * 0.5
            }
            analyzer.analyze_round(round_data)
        
        # Calculate confidence for a potential crossing
        analysis = analyzer.analyze_round({
            "round_id": "test",
            "timestamp": datetime.utcnow().isoformat(),
            "crash_point": 6.0
        })
        
        confidence = analyzer._calculate_crossing_confidence(6.0, 10.0, analysis)
        
        assert confidence >= 0.0
        assert confidence <= 1.0
    
    def test_repeat_testing_with_crossing(self):
        """Test repeat testing with gap crossing."""
        analyzer = GapSwingAnalyzer()
        
        # Setup for crossing
        analyzer.crash_history.append({
            "round_id": "round-1",
            "timestamp": datetime.utcnow(),
            "crash_point": 9.5
        })
        
        # Analyze crossing round
        round_data = {
            "round_id": "round-2",
            "timestamp": datetime.utcnow().isoformat(),
            "crash_point": 10.5
        }
        
        analysis = analyzer.analyze_round(round_data)
        
        if analysis.gap_crossing_detected:
            assert analysis.repeat_test_count == analyzer.repeat_test_iterations
            assert analysis.repeat_test_accuracy >= 0.0
            assert analysis.repeat_test_accuracy <= 1.0
    
    def test_repeat_testing_without_crossing(self):
        """Test repeat testing without gap crossing."""
        analyzer = GapSwingAnalyzer()
        
        round_data = {
            "round_id": "round-1",
            "timestamp": datetime.utcnow().isoformat(),
            "crash_point": 2.5
        }
        
        analysis = analyzer.analyze_round(round_data)
        
        assert analysis.repeat_test_count == 3  # Basic validation
        assert analysis.repeat_test_accuracy == 1.0  # Assume stable
    
    def test_gap_strength_classification_weak(self):
        """Test gap strength classification - weak."""
        analyzer = GapSwingAnalyzer()
        
        # Add crossings with high success rate
        for i in range(5):
            crossing = GapCrossing(
                gap_value=10.0,
                direction=GapDirection.UPWARD,
                timestamp=datetime.utcnow(),
                round_id=f"round-{i}",
                validation_count=10,
                success_count=9  # 90% success rate
            )
            analyzer.gap_crossings.append(crossing)
        
        analysis = analyzer.analyze_round({
            "round_id": "test",
            "timestamp": datetime.utcnow().isoformat(),
            "crash_point": 5.0
        })
        
        strength = analyzer._classify_gap_strength(analysis)
        
        assert strength == GapStrength.WEAK
    
    def test_gap_strength_classification_critical(self):
        """Test gap strength classification - critical."""
        analyzer = GapSwingAnalyzer()
        
        # Add crossings with low success rate
        for i in range(5):
            crossing = GapCrossing(
                gap_value=10.0,
                direction=GapDirection.UPWARD,
                timestamp=datetime.utcnow(),
                round_id=f"round-{i}",
                validation_count=10,
                success_count=1  # 10% success rate
            )
            analyzer.gap_crossings.append(crossing)
        
        analysis = analyzer.analyze_round({
            "round_id": "test",
            "timestamp": datetime.utcnow().isoformat(),
            "crash_point": 5.0
        })
        
        strength = analyzer._classify_gap_strength(analysis)
        
        assert strength == GapStrength.CRITICAL
    
    def test_signal_generation_strong_upward_swing(self):
        """Test signal generation for strong upward swing."""
        analyzer = GapSwingAnalyzer()
        
        # Add history with strong upward momentum
        for i in range(10):
            round_data = {
                "round_id": f"round-{i}",
                "timestamp": (datetime.utcnow() + timedelta(seconds=i)).isoformat(),
                "crash_point": 1.0 + i * 0.8  # Strong upward trend
            }
            analyzer.analyze_round(round_data)
        
        # Analyze round near gap
        analysis = analyzer.analyze_round({
            "round_id": "swing-round",
            "timestamp": datetime.utcnow().isoformat(),
            "crash_point": 9.0  # Close to 10x gap
        })
        
        # Should generate signal due to strong upward swing
        if analysis.swing_magnitude > 0.2 and analysis.current_crash_point / analysis.current_gap > 0.8:
            assert analysis.signal_generated is True
            assert analysis.signal_type == "strong_upward_swing"
    
    def test_signal_generation_gap_crossing_confirmed(self):
        """Test signal generation for confirmed gap crossing."""
        analyzer = GapSwingAnalyzer()
        
        # Setup for crossing
        analyzer.crash_history.append({
            "round_id": "round-1",
            "timestamp": datetime.utcnow(),
            "crash_point": 9.5
        })
        
        # Analyze crossing round
        analysis = analyzer.analyze_round({
            "round_id": "round-2",
            "timestamp": datetime.utcnow().isoformat(),
            "crash_point": 10.5
        })
        
        if analysis.gap_crossing_detected and analysis.repeat_test_accuracy > 0.8:
            assert analysis.signal_generated is True
            assert "gap_crossing" in analysis.signal_type
    
    def test_signal_generation_ma_alignment(self):
        """Test signal generation for MA alignment."""
        analyzer = GapSwingAnalyzer()
        
        # Add data to create MA alignment (MA10 > MA50 > MA100)
        for i in range(150):
            # Strong upward trend then stabilization
            if i < 100:
                crash_point = 1.0 + i * 0.05
            else:
                crash_point = 6.0 + (i - 100) * 0.02
            
            round_data = {
                "round_id": f"round-{i}",
                "timestamp": (datetime.utcnow() + timedelta(seconds=i)).isoformat(),
                "crash_point": crash_point
            }
            analyzer.analyze_round(round_data)
        
        # Analyze with upward swing
        analysis = analyzer.analyze_round({
            "round_id": "ma-round",
            "timestamp": datetime.utcnow().isoformat(),
            "crash_point": 7.5
        })
        
        # May generate MA alignment signal if conditions met
        if (analysis.ma_10 > analysis.ma_50 and
            analysis.ma_50 > analysis.ma_100 and
            analysis.swing_direction == GapDirection.UPWARD):
            assert analysis.signal_generated is True
            assert analysis.signal_type == "ma_alignment_upward"
    
    def test_signal_generation_swing_reversal(self):
        """Test signal generation for swing reversal."""
        analyzer = GapSwingAnalyzer()
        
        # Add oscillating data
        oscillating_points = [2.0, 3.0, 2.5, 3.5, 2.8]
        for i, point in enumerate(oscillating_points):
            round_data = {
                "round_id": f"round-{i}",
                "timestamp": (datetime.utcnow() + timedelta(seconds=i)).isoformat(),
                "crash_point": point
            }
            analyzer.analyze_round(round_data)
        
        # Analyze another reversal
        analysis = analyzer.analyze_round({
            "round_id": "reversal-round",
            "timestamp": datetime.utcnow().isoformat(),
            "crash_point": 3.2
        })
        
        # May generate reversal signal if pattern detected
        if len(analyzer.swing_history) >= 3:
            recent_directions = [s[1] for s in analyzer.swing_history[-3:]]
            if recent_directions[0] != recent_directions[1] and recent_directions[1] != recent_directions[2]:
                assert analysis.signal_generated is True
                assert analysis.signal_type == "swing_reversal_warning"
    
    def test_get_gap_statistics(self):
        """Test getting gap statistics."""
        analyzer = GapSwingAnalyzer()
        
        # Add some crossings
        for i in range(5):
            crossing = GapCrossing(
                gap_value=10.0,
                direction=GapDirection.UPWARD if i % 2 == 0 else GapDirection.DOWNWARD,
                timestamp=datetime.utcnow(),
                round_id=f"round-{i}",
                crossing_velocity=0.5 + i * 0.1
            )
            analyzer.gap_crossings.append(crossing)
        
        stats = analyzer.get_gap_statistics()
        
        assert stats["total_crossings"] == 5
        assert stats["upward_crossings"] == 3
        assert stats["downward_crossings"] == 2
        assert stats["average_crossing_velocity"] > 0
        assert stats["most_crossed_gap"] == 10.0
    
    def test_get_gap_statistics_empty(self):
        """Test getting statistics with no crossings."""
        analyzer = GapSwingAnalyzer()
        
        stats = analyzer.get_gap_statistics()
        
        assert stats["total_crossings"] == 0
        assert stats["upward_crossings"] == 0
        assert stats["downward_crossings"] == 0
        assert stats["average_crossing_velocity"] == 0.0
        assert stats["most_crossed_gap"] is None
    
    def test_comprehensive_analysis_workflow(self):
        """Test complete analysis workflow with multiple rounds."""
        analyzer = GapSwingAnalyzer()
        
        # Simulate a realistic crash sequence with gap crossings
        crash_sequence = [
            1.0, 1.5, 2.0, 3.0, 5.0, 8.0, 9.5, 10.5, 12.0, 11.0,  # Cross 10x
            9.0, 8.0, 7.0, 6.0, 5.0, 4.0, 3.0, 2.0, 1.5, 1.0
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
        
        # Should have detected gap crossings
        assert len(analyzer.gap_crossings) > 0
        
        # Check that gap crossings were detected
        crossing_count = sum(1 for a in analyses if a.gap_crossing_detected)
        assert crossing_count > 0
    
    def test_multiple_gap_levels(self):
        """Test with multiple gap levels."""
        analyzer = GapSwingAnalyzer(gap_levels=[5.0, 10.0, 20.0, 50.0])
        
        # Test gap determination for different levels
        assert analyzer._determine_current_gap(3.0) == 5.0
        assert analyzer._determine_current_gap(7.0) == 10.0
        assert analyzer._determine_current_gap(15.0) == 20.0
        assert analyzer._determine_current_gap(40.0) == 50.0
        assert analyzer._determine_current_gap(60.0) == 50.0  # Above all gaps
    
    def test_swing_history_tracking(self):
        """Test swing history tracking."""
        analyzer = GapSwingAnalyzer()
        
        # Add oscillating data
        for i in range(25):
            point = 2.0 + (i % 3) * 1.0  # Oscillate between 2.0, 3.0, 4.0
            round_data = {
                "round_id": f"round-{i}",
                "timestamp": (datetime.utcnow() + timedelta(seconds=i)).isoformat(),
                "crash_point": point
            }
            analyzer.analyze_round(round_data)
        
        # Check swing history
        assert len(analyzer.swing_history) > 0
        assert len(analyzer.swing_history) <= 20  # Should be limited to 20
        
        # Check that swing history contains tuples
        assert all(isinstance(item, tuple) and len(item) == 2 for item in analyzer.swing_history)