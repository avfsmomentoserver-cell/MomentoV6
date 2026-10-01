"""
MomentoScaler - Fixed Threshold Hybrid Scaling for Multiplier Visualization

Implements hybrid scaling with fixed threshold at 5.0x:
- Linear scaling for 1x-5x (common range, precise reading)
- Logarithmic scaling for >5x (outlier treatment)

Based on point distribution analysis showing 85% of data in 1x-5x range.
"""

import numpy as np
from typing import Union, Tuple, List, Dict, Any
import math


class MomentoScaler:
    """
    Fixed threshold hybrid scaling for multiplier visualization.

    Uses linear scaling for common range (1x-5x) and logarithmic scaling
    for outliers (>5x) to provide precision where needed while covering
    the full range of possible values.
    """

    def __init__(self, threshold: float = 5.0):
        """
        Initialize the MomentoScaler.

        Args:
            threshold: Fixed threshold for switching between linear and log scaling
                      (default: 5.0, based on data distribution analysis)
        """
        self.threshold = threshold
        self.log_threshold = math.log(threshold)

    def scale(
        self, values: Union[float, np.ndarray, List[float]]
    ) -> Union[float, np.ndarray]:
        """
        Scale value(s) using hybrid scaling.

        Args:
            values: Single value or array of values to scale

        Returns:
            Scaled value(s) with linear scaling below threshold,
            logarithmic scaling above threshold
        """
        is_scalar = isinstance(values, (int, float))
        values_array = np.array(values) if not is_scalar else np.array([values])

        # Linear scaling for values <= threshold
        linear_mask = values_array <= self.threshold
        linear_scaled = values_array[linear_mask]

        # Logarithmic scaling for values > threshold
        log_mask = values_array > self.threshold
        log_scaled = values_array[log_mask]

        # Apply linear scaling (identity for linear range)
        linear_result = linear_scaled

        # Apply logarithmic scaling with continuity at threshold
        # Formula: threshold + log(value/threshold)
        log_result = self.threshold + np.log(log_scaled / self.threshold)

        # Combine results
        result = np.zeros_like(values_array)
        result[linear_mask] = linear_result
        result[log_mask] = log_result

        return result[0] if is_scalar else result

    def inverse_scale(
        self, scaled_values: Union[float, np.ndarray, List[float]]
    ) -> Union[float, np.ndarray]:
        """
        Inverse scale value(s) back to original multiplier values.

        Args:
            scaled_values: Scaled value(s) to convert back

        Returns:
            Original multiplier value(s)
        """
        is_scalar = isinstance(scaled_values, (int, float))
        scaled_array = (
            np.array(scaled_values) if not is_scalar else np.array([scaled_values])
        )

        # Linear inverse for values <= threshold
        linear_mask = scaled_array <= self.threshold
        linear_inverse = scaled_array[linear_mask]

        # Logarithmic inverse for values > threshold
        log_mask = scaled_array > self.threshold
        log_inverse = scaled_array[log_mask]

        # Apply linear inverse (identity)
        linear_result = linear_inverse

        # Apply logarithmic inverse
        # Formula: threshold * exp(value - threshold)
        log_result = self.threshold * np.exp(log_inverse - self.threshold)

        # Combine results
        result = np.zeros_like(scaled_array)
        result[linear_mask] = linear_result
        result[log_mask] = log_result

        return result[0] if is_scalar else result

    def get_scaled_range(
        self, min_value: float, max_value: float
    ) -> Tuple[float, float]:
        """
        Get the scaled range for a given min/max value pair.

        Args:
            min_value: Minimum multiplier value
            max_value: Maximum multiplier value

        Returns:
            Tuple of (scaled_min, scaled_max)
        """
        scaled_min = self.scale(min_value)
        scaled_max = self.scale(max_value)
        return (scaled_min, scaled_max)

    def get_band_ranges(self) -> Dict[str, Tuple[float, float]]:
        """
        Get scaled ranges for standard multiplier bands.

        Returns:
            Dictionary mapping band names to (scaled_min, scaled_max) tuples
        """
        bands = {
            "1x": (1.0, 1.5),
            "2x": (1.5, 2.5),
            "3x": (2.5, 4.0),
            "5x": (4.0, 7.0),
            "10x": (7.0, 15.0),
            "20x": (15.0, 30.0),
            "50x": (30.0, 75.0),
            "100x": (75.0, 150.0),
        }

        scaled_bands = {}
        for band_name, (min_val, max_val) in bands.items():
            scaled_bands[band_name] = self.get_scaled_range(min_val, max_val)

        return scaled_bands

    def validate_scaling(self, test_values: List[float]) -> Dict[str, Any]:
        """
        Validate scaling accuracy by testing inverse transformation.

        Args:
            test_values: List of values to test scaling accuracy

        Returns:
            Dictionary with validation results including max error and accuracy
        """
        max_error = 0.0
        errors = []

        for value in test_values:
            scaled = self.scale(value)
            inverse = self.inverse_scale(scaled)
            error = abs(value - inverse)
            errors.append(error)
            max_error = max(max_error, error)

        mean_error = np.mean(errors)
        accuracy = (1 - mean_error) * 100

        return {
            "max_error": max_error,
            "mean_error": mean_error,
            "accuracy": accuracy,
            "errors": errors,
            "test_values": test_values,
        }


def create_momento_scaler(threshold: float = 5.0) -> MomentoScaler:
    """
    Factory function to create a MomentoScaler instance.

    Args:
        threshold: Fixed threshold for hybrid scaling (default: 5.0)

    Returns:
        Configured MomentoScaler instance
    """
    return MomentoScaler(threshold=threshold)


# Example usage and testing
if __name__ == "__main__":
    # Create scaler
    scaler = create_momento_scaler(threshold=5.0)

    # Test scaling
    test_values = [1.0, 1.5, 2.0, 3.0, 5.0, 10.0, 20.0, 50.0, 100.0]
    print("Original values:", test_values)

    scaled = scaler.scale(test_values)
    print("Scaled values:", scaled)

    inverse = scaler.inverse_scale(scaled)
    print("Inverse scaled:", inverse)

    # Validate
    validation = scaler.validate_scaling(test_values)
    print(f"\nValidation accuracy: {validation['accuracy']:.6f}%")
    print(f"Max error: {validation['max_error']:.10f}")

    # Get band ranges
    band_ranges = scaler.get_band_ranges()
    print("\nBand ranges (scaled):")
    for band, (min_scaled, max_scaled) in band_ranges.items():
        print(f"  {band}: {min_scaled:.2f} - {max_scaled:.2f}")
