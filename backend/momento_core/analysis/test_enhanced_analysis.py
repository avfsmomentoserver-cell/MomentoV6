"""
Integration Test for Enhanced Analysis Module

Tests the integration of all enhanced analysis components:
- MomentoScaler
- BandExhaustionAnalyzer
- StreakDetector
- TimeSeriesAnalyzer
"""

import sys
import os

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

from datetime import datetime, timedelta
import random

from momento_core.analysis.momento_scaler import MomentoScaler
from momento_core.analysis.band_exhaustion import BandExhaustionAnalyzer
from momento_core.analysis.streak_detection import StreakDetector
from momento_core.analysis.time_series import TimeSeriesAnalyzer


def generate_mock_rounds(count: int = 200) -> list:
    """Generate mock round data for testing."""
    rounds = []
    base_time = datetime.now()

    multipliers = [1.0, 1.5, 2.0, 3.0, 5.0, 10.0, 20.0, 50.0, 100.0]
    weights = [0.45, 0.25, 0.15, 0.08, 0.05, 0.015, 0.005, 0.0005, 0.0005]

    for i in range(count):
        multiplier = random.choices(multipliers, weights=weights)[0]
        timestamp = base_time - timedelta(seconds=i * 45)
        rounds.append({"multiplier": multiplier, "timestamp": timestamp})

    return rounds


def test_momento_scaler():
    """Test MomentoScaler integration."""
    print("\n=== Testing MomentoScaler ===")

    scaler = MomentoScaler(threshold=5.0)

    # Test with sample data
    test_values = [1.0, 1.5, 2.0, 3.0, 5.0, 10.0, 20.0, 50.0, 100.0]
    scaled = scaler.scale(test_values)
    inverse = scaler.inverse_scale(scaled)

    # Validate
    max_error = max(abs(t - i) for t, i in zip(test_values, inverse))
    print(f"✓ Scaling accuracy: {(1 - max_error) * 100:.6f}%")

    # Test band ranges
    band_ranges = scaler.get_band_ranges()
    print(f"✓ Band ranges calculated: {len(band_ranges)} bands")

    return True


def test_band_exhaustion_analyzer():
    """Test BandExhaustionAnalyzer integration."""
    print("\n=== Testing BandExhaustionAnalyzer ===")

    analyzer = BandExhaustionAnalyzer(window_size=500)

    # Process rounds
    rounds = generate_mock_rounds(200)
    for round_data in rounds:
        result = analyzer.analyze_round(
            round_data["multiplier"], round_data["timestamp"]
        )

    # Get summary
    summary = analyzer.get_exhaustion_summary()
    print(f"✓ Current regime: {summary['current_regime']}")
    print(f"✓ Total rounds processed: {len(analyzer.round_history)}")
    print(f"✓ Exhaustion events: {summary['total_exhaustion_events']}")

    return True


def test_streak_detector():
    """Test StreakDetector integration."""
    print("\n=== Testing StreakDetector ===")

    detector = StreakDetector(history_window=200)

    # Process rounds
    rounds = generate_mock_rounds(200)
    for round_data in rounds:
        result = detector.analyze_round(
            round_data["multiplier"], round_data["timestamp"]
        )

    # Get summary
    summary = detector.get_pattern_summary()
    print(f"✓ Total patterns detected: {summary['total_patterns']}")
    print(f"✓ Validation accuracy: {summary['validation_accuracy']:.2%}")
    print(f"✓ Pending validations: {summary['pending_validations']}")

    return True


def test_time_series_analyzer():
    """Test TimeSeriesAnalyzer integration."""
    print("\n=== Testing TimeSeriesAnalyzer ===")

    analyzer = TimeSeriesAnalyzer()

    # Process rounds
    rounds = generate_mock_rounds(200)
    for i, round_data in enumerate(rounds):
        try:
            result = analyzer.analyze_round(
                round_data["multiplier"], round_data["timestamp"]
            )
        except Exception as e:
            print(f"✗ Error at round {i}: {e}")
            raise

    # Get summary
    summary = analyzer.get_summary()
    print(f"✓ Total rounds processed: {summary['round_count']}")
    print(f"✓ Window analyses: {summary['window_analyses_count']}")
    print(f"✓ Momentum indicators: {summary['momentum_indicators_count']}")
    print(f"✓ Volatility measurements: {summary['volatility_measurements_count']}")
    print(f"✓ Trend analyses: {summary['trend_analyses_count']}")

    if summary["latest_trend"]:
        print(f"✓ Latest trend: {summary['latest_trend']['score_direction']}")

    return True


def test_integrated_analysis():
    """Test all components working together."""
    print("\n=== Testing Integrated Analysis ===")

    # Initialize all analyzers
    scaler = MomentoScaler(threshold=5.0)
    band_analyzer = BandExhaustionAnalyzer(window_size=500)
    streak_detector = StreakDetector(history_window=200)
    time_series_analyzer = TimeSeriesAnalyzer()

    # Process rounds through all analyzers
    rounds = generate_mock_rounds(200)
    results = []

    for round_data in rounds:
        multiplier = round_data["multiplier"]
        timestamp = round_data["timestamp"]

        # Scale multiplier
        scaled = scaler.scale(multiplier)

        # Analyze with band exhaustion
        band_result = band_analyzer.analyze_round(multiplier, timestamp)

        # Analyze with streak detector
        streak_result = streak_detector.analyze_round(multiplier, timestamp)

        # Analyze with time series
        ts_result = time_series_analyzer.analyze_round(multiplier, timestamp)

        # Combine results
        combined_result = {
            "multiplier": multiplier,
            "scaled": scaled,
            "band_exhaustion": band_result,
            "streak_detection": streak_result,
            "time_series": ts_result,
        }

        results.append(combined_result)

    print(f"✓ Processed {len(results)} rounds through all analyzers")

    # Get final summaries
    band_summary = band_analyzer.get_exhaustion_summary()
    streak_summary = streak_detector.get_pattern_summary()
    ts_summary = time_series_analyzer.get_summary()

    print(f"✓ Band exhaustion regime: {band_summary['current_regime']}")
    print(f"✓ Streak patterns detected: {streak_summary['total_patterns']}")
    print(f"✓ Time series rounds: {ts_summary['round_count']}")

    return True


def main():
    """Run all integration tests."""
    print("=" * 60)
    print("Enhanced Analysis Module Integration Tests")
    print("=" * 60)
    print(f"Test time: {datetime.now().isoformat()}")

    tests = [
        ("MomentoScaler", test_momento_scaler),
        ("BandExhaustionAnalyzer", test_band_exhaustion_analyzer),
        ("StreakDetector", test_streak_detector),
        ("TimeSeriesAnalyzer", test_time_series_analyzer),
        ("Integrated Analysis", test_integrated_analysis),
    ]

    passed = 0
    failed = 0

    for test_name, test_func in tests:
        try:
            if test_func():
                passed += 1
                print(f"✓ {test_name} PASSED")
            else:
                failed += 1
                print(f"✗ {test_name} FAILED")
        except Exception as e:
            failed += 1
            print(f"✗ {test_name} FAILED: {e}")

    print("\n" + "=" * 60)
    print(f"Test Summary: {passed} passed, {failed} failed")
    print("=" * 60)

    return failed == 0


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
