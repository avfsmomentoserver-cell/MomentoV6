"""
Crash Prediction Engine

Core prediction engine for crash games with multi-factor analysis,
real-time processing, and live graphics capabilities.
"""

import uuid
from datetime import datetime
from typing import Dict, List, Optional, Any
from collections import deque
import statistics

from momento_core.prediction.models import (
    CrashPredictionConfig,
    PredictionResult,
    CrashRound,
    PredictionStrategy,
    CrashSeverity
)
from momento_core.linguistics import MomentoLinguisticsEngine, ReverseLinguisticsEngine


class CrashPredictionEngine:
    """
    Real-time crash game prediction engine.
    
    Combines multiple prediction strategies:
    - Momentum analysis
    - Mean reversion
    - Pattern recognition
    - Linguistic analysis (including reverse layers)
    """
    
    def __init__(self, config: Optional[CrashPredictionConfig] = None):
        """Initialize prediction engine with configuration."""
        self.config = config or CrashPredictionConfig()
        
        if not self.config.validate():
            raise ValueError("Invalid prediction configuration")
        
        # Initialize linguistics engines
        self.linguistics_engine = MomentoLinguisticsEngine()
        self.reverse_linguistics_engine = ReverseLinguisticsEngine()
        
        # Round history for pattern analysis
        self.short_history: deque = deque(maxlen=self.config.short_window)
        self.medium_history: deque = deque(maxlen=self.config.medium_window)
        self.long_history: deque = deque(maxlen=self.config.long_window)
        
        # Prediction cache
        self.active_predictions: Dict[str, PredictionResult] = {}
        
        # Performance metrics
        self.total_predictions = 0
        self.accurate_predictions = 0
        self.accuracy_history: List[float] = []
    
    def process_round(self, round_data: Dict[str, Any]) -> CrashRound:
        """
        Process a new crash round and generate prediction.
        
        Args:
            round_data: Raw round data from collector
            
        Returns:
            CrashRound with analysis and prediction
        """
        # Create crash round object
        crash_round = self._create_crash_round(round_data)
        
        # Perform linguistic analysis
        if self.config.enable_linguistic_analysis:
            crash_round.linguistic_classification = self._analyze_linguistics(crash_round)
            
            if self.config.enable_reverse_linguistics:
                crash_round.reverse_linguistic_analysis = self._analyze_reverse_linguistics(crash_round)
        
        # Add to history
        self._add_to_history(crash_round)
        
        # Generate prediction for next round
        prediction = self._generate_prediction(crash_round)
        
        if prediction:
            crash_round.predicted_crash_point = prediction.predicted_crash_point
            crash_round.prediction_confidence = prediction.confidence_score
            crash_round.prediction_strategy = prediction.strategy
            self.active_predictions[prediction.round_id] = prediction
        
        return crash_round
    
    def _create_crash_round(self, round_data: Dict[str, Any]) -> CrashRound:
        """Create CrashRound from raw data."""
        return CrashRound(
            round_id=round_data.get("round_id", str(uuid.uuid4())),
            timestamp=datetime.fromisoformat(round_data.get("timestamp", datetime.utcnow().isoformat())),
            crash_point=round_data.get("crash_point", 1.0),
            duration_seconds=round_data.get("duration_seconds", 0.0),
            multiplier_sequence=round_data.get("multiplier_sequence", []),
            color_sequence=round_data.get("color_sequence", [])
        )
    
    def _analyze_linguistics(self, crash_round: CrashRound) -> Dict[str, Any]:
        """Perform MomentoLinguistics analysis on crash round."""
        linguistic_obj = self.linguistics_engine.convert(
            multiplier=crash_round.crash_point,
            timestamp=crash_round.timestamp.isoformat(),
            color=crash_round.color_sequence[-1] if crash_round.color_sequence else "rgb(52, 180, 255)"
        )
        
        return {
            "layer0_raw": linguistic_obj.layer0_raw,
            "layer1_point": linguistic_obj.layer1_point,
            "layer2_market": linguistic_obj.layer2_market,
            "layer3_energy": linguistic_obj.layer3_energy,
            "layer4_behaviour": linguistic_obj.layer4_behaviour,
            "layer5_point": linguistic_obj.layer5_point,
            "layer6_relationship": linguistic_obj.layer6_relationship,
            "layer7_gap": linguistic_obj.layer7_gap,
            "layer8_shape": linguistic_obj.layer8_shape
        }
    
    def _analyze_reverse_linguistics(self, crash_round: CrashRound) -> Dict[str, Any]:
        """Perform reverse linguistic analysis using ReverseLinguisticsEngine."""
        reverse_obj = self.reverse_linguistics_engine.analyze(
            multiplier=crash_round.crash_point,
            timestamp=crash_round.timestamp,
            sequence=crash_round.multiplier_sequence
        )
        
        return reverse_obj.to_dict()
    
    def _add_to_history(self, crash_round: CrashRound) -> None:
        """Add round to history buffers."""
        self.short_history.append(crash_round)
        self.medium_history.append(crash_round)
        self.long_history.append(crash_round)
    
    def _generate_prediction(self, current_round: CrashRound) -> Optional[PredictionResult]:
        """Generate prediction for next round using multi-strategy approach."""
        if len(self.short_history) < 5:
            return None
        
        # Get predictions from each strategy
        momentum_pred = self._momentum_strategy()
        reversion_pred = self._reversion_strategy()
        pattern_pred = self._pattern_strategy() if self.config.enable_pattern_recognition else None
        linguistic_pred = self._linguistic_strategy() if self.config.enable_linguistic_analysis else None
        
        # Combine predictions using weighted average
        predictions = []
        weights = []
        
        if momentum_pred:
            predictions.append(momentum_pred)
            weights.append(self.config.momentum_weight)
        
        if reversion_pred:
            predictions.append(reversion_pred)
            weights.append(self.config.reversion_weight)
        
        if pattern_pred:
            predictions.append(pattern_pred)
            weights.append(self.config.pattern_weight)
        
        if linguistic_pred:
            predictions.append(linguistic_pred)
            weights.append(self.config.linguistic_weight)
        
        if not predictions:
            return None
        
        # Weighted average
        weighted_pred = sum(p * w for p, w in zip(predictions, weights)) / sum(weights)
        
        # Calculate confidence based on strategy agreement
        if len(predictions) > 1:
            std_dev = statistics.stdev(predictions)
            confidence = max(0.0, 1.0 - (std_dev / weighted_pred))
        else:
            confidence = 0.5
        
        # Apply confidence threshold
        if confidence < self.config.min_confidence:
            return None
        
        # Determine dominant strategy
        strategy = self._determine_dominant_strategy(predictions, weights)
        
        # Create prediction result
        next_round_id = str(uuid.uuid4())
        confidence_interval = (
            weighted_pred * (1 - confidence * 0.3),
            weighted_pred * (1 + confidence * 0.3)
        )
        
        return PredictionResult(
            prediction_id=str(uuid.uuid4()),
            round_id=next_round_id,
            timestamp=datetime.utcnow(),
            predicted_crash_point=weighted_pred,
            confidence_interval=confidence_interval,
            confidence_score=confidence,
            strategy=strategy,
            feature_importance=self._calculate_feature_importance()
        )
    
    def _momentum_strategy(self) -> Optional[float]:
        """Momentum-based prediction."""
        if len(self.short_history) < 3:
            return None
        
        recent = [r.crash_point for r in list(self.short_history)[-5:]]
        
        # Calculate momentum
        if len(recent) >= 2:
            momentum = (recent[-1] - recent[-2]) / recent[-2]
            
            # Predict continuation or reversal based on momentum strength
            if abs(momentum) < 0.1:
                # Low momentum - predict mean reversion
                return statistics.mean(recent)
            elif momentum > 0:
                # Positive momentum - predict continuation
                return recent[-1] * (1 + momentum * 0.5)
            else:
                # Negative momentum - predict further decline
                return max(1.0, recent[-1] * (1 + momentum * 0.3))
        
        return statistics.mean(recent)
    
    def _reversion_strategy(self) -> Optional[float]:
        """Mean reversion prediction."""
        if len(self.medium_history) < 10:
            return None
        
        crashes = [r.crash_point for r in self.medium_history]
        mean_crash = statistics.mean(crashes)
        median_crash = statistics.median(crashes)
        
        recent = crashes[-5:]
        recent_avg = statistics.mean(recent)
        
        # If recent crashes are above mean, predict reversion downward
        if recent_avg > mean_crash * 1.2:
            return mean_crash * 0.9
        # If recent crashes are below mean, predict reversion upward
        elif recent_avg < mean_crash * 0.8:
            return mean_crash * 1.1
        else:
            return mean_crash
    
    def _pattern_strategy(self) -> Optional[float]:
        """Pattern recognition prediction."""
        if len(self.long_history) < 20:
            return None
        
        # Look for repeating patterns in recent history
        recent_sequence = [r.crash_point for r in list(self.long_history)[-10:]]
        
        # Simple pattern: check for alternating high/low pattern
        if len(recent_sequence) >= 4:
            highs = [x for x in recent_sequence if x > 2.0]
            lows = [x for x in recent_sequence if x <= 2.0]
            
            if len(highs) > len(lows):
                # More highs recently - predict low next
                return 1.5
            elif len(lows) > len(highs):
                # More lows recently - predict high next
                return 3.0
        
        return statistics.mean(recent_sequence)
    
    def _linguistic_strategy(self) -> Optional[float]:
        """Linguistic-based prediction using MomentoLinguistics."""
        if len(self.short_history) < 3:
            return None
        
        recent_rounds = list(self.short_history)[-5:]
        
        # Analyze linguistic patterns
        purple_count = 0
        gold_count = 0
        extreme_count = 0
        
        for round_data in recent_rounds:
            if round_data.linguistic_classification:
                market = round_data.linguistic_classification.get("layer2_market", "")
                market = str(getattr(market, "value", market) or "")
                if "Purple" in market:
                    purple_count += 1
                if "Gold" in market:
                    gold_count += 1
                if "Extreme" in market:
                    extreme_count += 1
        
        # Predict based on linguistic patterns
        if extreme_count >= 2:
            # Recent extremes - predict moderation
            return 2.0
        elif gold_count >= 3:
            # Many gold rounds - predict higher
            return 5.0
        elif purple_count >= 3:
            # Many purple rounds - predict moderate
            return 3.0
        else:
            # Default to recent average
            return statistics.mean([r.crash_point for r in recent_rounds])
    
    def _determine_dominant_strategy(self, predictions: List[float], weights: List[float]) -> PredictionStrategy:
        """Determine which strategy contributed most to final prediction."""
        weighted_contributions = [p * w for p, w in zip(predictions, weights)]
        max_contribution = max(weighted_contributions)
        max_index = weighted_contributions.index(max_contribution)
        
        strategies = [
            PredictionStrategy.MOMENTUM,
            PredictionStrategy.REVERSION,
            PredictionStrategy.PATTERN_RECOGNITION,
            PredictionStrategy.LINGUISTIC
        ]
        
        return strategies[max_index] if max_index < len(strategies) else PredictionStrategy.HYBRID
    
    def _calculate_feature_importance(self) -> Dict[str, float]:
        """Calculate feature importance for the prediction."""
        return {
            "momentum": self.config.momentum_weight,
            "reversion": self.config.reversion_weight,
            "pattern": self.config.pattern_weight,
            "linguistic": self.config.linguistic_weight
        }
    
    def update_prediction_result(self, round_id: str, actual_crash_point: float) -> Optional[PredictionResult]:
        """Update prediction with actual result."""
        if round_id not in self.active_predictions:
            return None
        
        prediction = self.active_predictions[round_id]
        prediction.actual_crash_point = actual_crash_point
        prediction.prediction_error = abs(actual_crash_point - prediction.predicted_crash_point)
        
        # Update accuracy metrics
        self.total_predictions += 1
        accuracy = prediction.calculate_accuracy()
        if accuracy and accuracy > 0.7:  # 70% accuracy threshold
            self.accurate_predictions += 1
        
        if accuracy:
            self.accuracy_history.append(accuracy)
        
        # Remove from active predictions
        del self.active_predictions[round_id]
        
        return prediction
    
    def get_performance_metrics(self) -> Dict[str, Any]:
        """Get prediction performance metrics."""
        overall_accuracy = (
            self.accurate_predictions / self.total_predictions
            if self.total_predictions > 0 else 0.0
        )
        
        avg_accuracy = (
            statistics.mean(self.accuracy_history)
            if self.accuracy_history else 0.0
        )
        
        return {
            "total_predictions": self.total_predictions,
            "accurate_predictions": self.accurate_predictions,
            "overall_accuracy": overall_accuracy,
            "average_accuracy": avg_accuracy,
            "active_predictions": len(self.active_predictions),
            "history_sizes": {
                "short": len(self.short_history),
                "medium": len(self.medium_history),
                "long": len(self.long_history)
            }
        }