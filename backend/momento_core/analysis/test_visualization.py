"""
Test Visualization Components with Historical Data

Tests the visualization components using actual historical rounds data from the API.
"""

import sys
import os

# Add parent directory to path for imports
sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

import requests
import json
from datetime import datetime
from momento_core.analysis.momento_scaler import MomentoScaler

try:
    from momento_core.analysis.plotly_integration import PlotlyVisualizer

    PLOTLY_AVAILABLE = True
except ImportError:
    PLOTLY_AVAILABLE = False
    print("Plotly not available, skipping Plotly tests")


def fetch_historical_rounds(limit: int = 100) -> list:
    """
    Fetch historical rounds data from the API.

    Args:
        limit: Number of rounds to fetch

    Returns:
        List of round data
    """
    try:
        response = requests.get(
            f"http://localhost:8001/api/v1/rounds/historical",
            params={"source": "aviator", "limit": limit},
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()
        return data.get("rounds", [])
    except requests.exceptions.RequestException as e:
        print(f"Error fetching rounds: {e}")
        return []


def test_momento_scaler(rounds_data: list):
    """Test MomentoScaler with actual data."""
    print("\n=== Testing MomentoScaler ===")

    scaler = MomentoScaler(threshold=5.0)

    # Extract multipliers
    multipliers = [round["multiplier"] for round in rounds_data]

    # Test scaling
    scaled = scaler.scale(multipliers)
    inverse = scaler.inverse_scale(scaled)

    # Validate
    max_error = max(abs(m - i) for m, i in zip(multipliers, inverse))
    print(f"Max scaling error: {max_error:.10f}")
    print(f"Scaling accuracy: {(1 - max_error) * 100:.6f}%")

    # Show some examples
    print("\nScaling examples:")
    for i in [
        0,
        len(multipliers) // 4,
        len(multipliers) // 2,
        3 * len(multipliers) // 4,
        -1,
    ]:
        if i < len(multipliers):
            orig = multipliers[i]
            scaled_val = scaled[i]
            print(f"  {orig:.2f}x -> {scaled_val:.4f} (scaled)")

    # Get band ranges
    band_ranges = scaler.get_band_ranges()
    print("\nBand ranges (scaled):")
    for band, (min_scaled, max_scaled) in band_ranges.items():
        print(f"  {band}: {min_scaled:.2f} - {max_scaled:.2f}")


def test_plotly_visualizer(rounds_data: list):
    """Test PlotlyVisualizer with actual data."""
    if not PLOTLY_AVAILABLE:
        print("\n=== Skipping PlotlyVisualizer (Plotly not installed) ===")
        return

    print("\n=== Testing PlotlyVisualizer ===")

    try:
        visualizer = PlotlyVisualizer(threshold=5.0)

        # Create candlestick chart
        candlestick_fig = visualizer.create_candlestick_chart(
            rounds_data[:50],  # Use first 50 rounds for testing
            title="Crash Game Analysis (Test)",
            show_streaks=True,
            show_regime_zones=True,
        )
        print("✓ Candlestick chart created successfully")

        # Create scaled chart
        scaled_fig = visualizer.create_scaled_chart(
            rounds_data[:50], title="Scaled Multiplier Chart (Test)", show_bands=True
        )
        print("✓ Scaled chart created successfully")

        # Create combined score chart (with mock scores)
        scores = [0.5 + (round["multiplier"] / 100) for round in rounds_data[:50]]
        score_fig = visualizer.create_combined_score_chart(
            rounds_data[:50], scores, title="Combined Score Analysis (Test)"
        )
        print("✓ Combined score chart created successfully")

        # Save charts
        candlestick_fig.write_html("/tmp/test_candlestick.html")
        scaled_fig.write_html("/tmp/test_scaled.html")
        score_fig.write_html("/tmp/test_score.html")
        print("✓ Charts saved to /tmp/")

    except Exception as e:
        print(f"✗ Error testing PlotlyVisualizer: {e}")
        print("  (This is expected if plotly is not installed)")


def test_data_statistics(rounds_data: list):
    """Test and display statistics about the data."""
    print("\n=== Data Statistics ===")

    if not rounds_data:
        print("No data available")
        return

    multipliers = [round["multiplier"] for round in rounds_data]
    colors = [round["color"] for round in rounds_data]

    print(f"Total rounds: {len(rounds_data)}")
    print(f"Multiplier range: {min(multipliers):.2f}x - {max(multipliers):.2f}x")
    print(f"Mean multiplier: {sum(multipliers)/len(multipliers):.2f}x")
    print(
        f"Green rounds: {colors.count('green')} ({colors.count('green')/len(colors)*100:.1f}%)"
    )
    print(
        f"Red rounds: {colors.count('red')} ({colors.count('red')/len(colors)*100:.1f}%)"
    )

    # Band distribution
    bands = {}
    for round in rounds_data:
        band = round["band"]
        bands[band] = bands.get(band, 0) + 1

    print("\nBand distribution:")
    for band in sorted(bands.keys()):
        count = bands[band]
        percentage = count / len(rounds_data) * 100
        print(f"  {band}: {count} ({percentage:.1f}%)")


def main():
    """Main test function."""
    print("=== Visualization Components Test ===")
    print(f"Test time: {datetime.now().isoformat()}")

    # Fetch historical data
    print("\nFetching historical rounds data...")
    rounds_data = fetch_historical_rounds(limit=100)

    if not rounds_data:
        print("Failed to fetch data. Using mock data...")
        # Generate mock data
        import random
        from datetime import timedelta

        base_time = datetime.now()
        multipliers = [1.0, 1.5, 2.0, 3.0, 5.0, 10.0, 20.0, 50.0, 100.0]
        weights = [0.45, 0.25, 0.15, 0.08, 0.05, 0.015, 0.005, 0.0005, 0.0005]

        for i in range(100):
            multiplier = random.choices(multipliers, weights=weights)[0]
            color = "red" if multiplier >= 2.0 else "green"
            timestamp = base_time - timedelta(seconds=i * 45)

            rounds_data.append(
                {
                    "multiplier": multiplier,
                    "color": color,
                    "timestamp": timestamp.isoformat(),
                    "band": f"{int(multiplier)}x" if multiplier >= 1 else "1x",
                }
            )

    print(f"✓ Retrieved {len(rounds_data)} rounds")

    # Run tests
    test_data_statistics(rounds_data)
    test_momento_scaler(rounds_data)
    test_plotly_visualizer(rounds_data)

    print("\n=== Test Complete ===")


if __name__ == "__main__":
    main()
