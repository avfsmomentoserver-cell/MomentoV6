"""
Signal Hunter Pro Engine

Advanced signal detection system for crash games with multi-strategy
signal generation, confidence scoring, and backtesting capabilities.
"""

import uuid
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from collections import deque
import statistics

from momento_core.signals.models import (
    SignalEvent,
    SignalType,
    SignalSeverity,
    SignalConfiguration,
    SignalPerformance
)
from momento_core.prediction.models import CrashRound


class SignalHunterPro:
    """
    Advanced signal detection engine for crash games.
    
    Implements multi-strategy signal generation:
    - Momentum signals
    - Mean reversion signals
    - Exhaustion signals
    - Pattern recognition signals
    - Linguistic signals
    - Reverse linguistic signals
    - Cascade signals
    - Anti-correlation signals
    """
    
    def __init__(self, config: Optional[SignalConfiguration] = None):
        """Initialize signal hunter with configuration."""
        self.config = config or SignalConfiguration()
        
        if not self.config.validate():
            raise ValueError("Invalid signal configuration")
        
        # Round history for signal detection
        self.short_history: deque = deque(maxlen=self.config.short_window)
        self.medium_history: deque = deque(maxlen=self.config.medium_window)
        self.long_history: deque = deque(maxlen=self.config.long_window)
        
        # Signal tracking
        self.active_signals: Dict[str, SignalEvent] = {}
        self.signal_history: List[SignalEvent] = []
        
        # Performance tracking by signal type
        self.performance_metrics: Dict[SignalType, SignalPerformance] = {
            signal_type: SignalPerformance(signal_type=signal_type)
            for signal_type in SignalType
        }
        
        # Signal cooldown tracking
        self.last_signal_round: Dict[SignalType, str] = {}
    
    def analyze_round(self, crash_round: CrashRound) -> List[SignalEvent]:
        """
        Analyze a crash round and generate signals.
        
        Args:
            crash_round: Crash round to analyze
            
        Returns:
            List of generated signals
        """
        generated_signals = []
        
        # Add to history
        self._add_to_history(crash_round)
        
        # Generate signals based on enabled strategies
        if self.config.enable_momentum:
            momentum_signals = self._generate_momentum_signals(crash_round)
            generated_signals.extend(momentum_signals)
        
        if self.config.enable_reversion:
            reversion_signals = self._generate_reversion_signals(crash_round)
            generated_signals.extend(reversion_signals)
        
        if self.config.enable_exhaustion:
            exhaustion_signals = self._generate_exhaustion_signals(crash_round)
            generated_signals.extend(exhaustion_signals)
        
        if self.config.enable_pattern:
            pattern_signals = self._generate_pattern_signals(crash_round)
            generated_signals.extend(pattern_signals)
        
        if self.config.enable_linguistic:
            linguistic_signals = self._generate_linguistic_signals(crash_round)
            generated_signals.extend(linguistic_signals)
        
        if self.config.enable_reverse_linguistic:
            reverse_linguistic_signals = self._generate_reverse_linguistic_signals(crash_round)
            generated_signals.extend(reverse_linguistic_signals)
        
        if self.config.enable_cascade:
            cascade_signals = self._generate_cascade_signals(crash_round)
            generated_signals.extend(cascade_signals)
        
        if self.config.enable_anti_correlation:
            anti_correlation_signals = self._generate_anti_correlation_signals(crash_round)
            generated_signals.extend(anti_correlation_signals)
        
        # Filter signals by thresholds and limits
        filtered_signals = self._filter_signals(generated_signals)
        
        # Store signals
        for signal in filtered_signals:
            self.active_signals[signal.signal_id] = signal
            self.signal_history.append(signal)
            self.last_signal_round[signal.signal_type] = crash_round.round_id
        
        return filtered_signals
    
    def _add_to_history(self, crash_round: CrashRound) -> None:
        """Add round to history buffers."""
        self.short_history.append(crash_round)
        self.medium_history.append(crash_round)
        self.long_history.append(crash_round)
    
    def _generate_momentum_signals(self, crash_round: CrashRound) -> List[SignalEvent]:
        """Generate momentum-based signals."""
        signals = []
        
        if len(self.short_history) < 5:
            return signals
        
        recent_rounds = list(self.short_history)[-5:]
        recent_crashes = [r.crash_point for r in recent_rounds]
        
        # Calculate momentum
        if len(recent_crashes) >= 3:
            # Recent trend
            recent_trend = (recent_crashes[-1] - recent_crashes[-3]) / recent_crashes[-3]
            
            # Strong upward momentum
            if recent_trend > 0.5:
                signal = self._create_signal(
                    signal_type=SignalType.MOMENTUM,
                    signal_name="strong_upward_momentum",
                    strength=0.8,
                    confidence=0.75,
                    severity=SignalSeverity.HIGH,
                    crash_round=crash_round,
                    description="Strong upward momentum detected in recent rounds",
                    signal_parameters={
                        "trend": recent_trend,
                        "recent_crashes": recent_crashes[-3:]
                    }
                )
                signals.append(signal)
            
            # Strong downward momentum
            elif recent_trend < -0.3:
                signal = self._create_signal(
                    signal_type=SignalType.MOMENTUM,
                    signal_name="strong_downward_momentum",
                    strength=0.7,
                    confidence=0.7,
                    severity=SignalSeverity.MEDIUM,
                    crash_round=crash_round,
                    description="Strong downward momentum detected",
                    signal_parameters={
                        "trend": recent_trend,
                        "recent_crashes": recent_crashes[-3:]
                    }
                )
                signals.append(signal)
        
        return signals
    
    def _generate_reversion_signals(self, crash_round: CrashRound) -> List[SignalEvent]:
        """Generate mean reversion signals."""
        signals = []
        
        if len(self.medium_history) < 10:
            return signals
        
        crashes = [r.crash_point for r in self.medium_history]
        mean_crash = statistics.mean(crashes)
        std_dev = statistics.stdev(crashes) if len(crashes) > 1 else 0.0
        
        # Check for extreme deviation (potential reversion)
        if std_dev > 0:
            z_score = (crash_round.crash_point - mean_crash) / std_dev
            
            # High deviation - potential reversion
            if abs(z_score) > 1.5:
                direction = "downward" if z_score > 0 else "upward"
                signal = self._create_signal(
                    signal_type=SignalType.REVERSION,
                    signal_name=f"mean_reversion_{direction}",
                    strength=min(0.9, abs(z_score) / 2.0),
                    confidence=0.7,
                    severity=SignalSeverity.HIGH if abs(z_score) > 2.0 else SignalSeverity.MEDIUM,
                    crash_round=crash_round,
                    description=f"Crash point {direction} deviation from mean suggests reversion",
                    signal_parameters={
                        "z_score": z_score,
                        "mean_crash": mean_crash,
                        "std_dev": std_dev
                    }
                )
                signals.append(signal)
        
        return signals
    
    def _generate_exhaustion_signals(self, crash_round: CrashRound) -> List[SignalEvent]:
        """Generate exhaustion signals based on linguistic analysis."""
        signals = []
        
        if not crash_round.linguistic_classification:
            return signals
        
        classification = crash_round.linguistic_classification
        energy = classification.get("layer3_energy", "")
        
        # Check for exhaustion patterns
        if "Exhaustion" in energy:
            signal = self._create_signal(
                signal_type=SignalType.EXHAUSTION,
                signal_name="energy_exhaustion",
                strength=0.8,
                confidence=0.75,
                severity=SignalSeverity.HIGH,
                crash_round=crash_round,
                description="Energy exhaustion detected - potential reversal point",
                signal_parameters={
                    "energy_level": energy,
                    "market_classification": classification.get("layer2_market", "")
                }
            )
            signals.append(signal)
        
        # Check for violent energy (potential continuation)
        if "Violent" in energy:
            signal = self._create_signal(
                signal_type=SignalType.EXHAUSTION,
                signal_name="violent_energy",
                strength=0.7,
                confidence=0.65,
                severity=SignalSeverity.MEDIUM,
                crash_round=crash_round,
                description="Violent energy detected - strong momentum continuation",
                signal_parameters={
                    "energy_level": energy,
                    "market_classification": classification.get("layer2_market", "")
                }
            )
            signals.append(signal)
        
        return signals
    
    def _generate_pattern_signals(self, crash_round: CrashRound) -> List[SignalEvent]:
        """Generate pattern recognition signals."""
        signals = []
        
        if len(self.long_history) < 20:
            return signals
        
        recent_rounds = list(self.long_history)[-20:]
        recent_crashes = [r.crash_point for r in recent_rounds]
        
        # Detect streak patterns
        high_streak = 0
        low_streak = 0
        
        for crash in recent_crashes:
            if crash > 5.0:
                high_streak += 1
                low_streak = 0
            elif crash < 2.0:
                low_streak += 1
                high_streak = 0
            else:
                high_streak = 0
                low_streak = 0
            
            # Signal on streak completion
            if high_streak >= 3:
                signal = self._create_signal(
                    signal_type=SignalType.PATTERN,
                    signal_name="high_crash_streak",
                    strength=0.7,
                    confidence=0.6,
                    severity=SignalSeverity.MEDIUM,
                    crash_round=crash_round,
                    description=f"High crash streak of {high_streak} detected",
                    signal_parameters={
                        "streak_length": high_streak,
                        "streak_type": "high"
                    }
                )
                signals.append(signal)
                high_streak = 0  # Reset to avoid duplicate signals
            
            if low_streak >= 3:
                signal = self._create_signal(
                    signal_type=SignalType.PATTERN,
                    signal_name="low_crash_streak",
                    strength=0.7,
                    confidence=0.6,
                    severity=SignalSeverity.MEDIUM,
                    crash_round=crash_round,
                    description=f"Low crash streak of {low_streak} detected",
                    signal_parameters={
                        "streak_length": low_streak,
                        "streak_type": "low"
                    }
                )
                signals.append(signal)
                low_streak = 0  # Reset to avoid duplicate signals
        
        return signals
    
    def _generate_linguistic_signals(self, crash_round: CrashRound) -> List[SignalEvent]:
        """Generate signals based on MomentoLinguistics analysis."""
        signals = []
        
        if not crash_round.linguistic_classification:
            return signals
        
        classification = crash_round.linguistic_classification
        market = classification.get("layer2_market", "")
        behaviour = classification.get("layer4_behaviour", "")
        
        # Extreme market classification signal
        if "Extreme" in market or "Gold" in market:
            signal = self._create_signal(
                signal_type=SignalType.LINGUISTIC,
                signal_name="extreme_market_classification",
                strength=0.8,
                confidence=0.8,
                severity=SignalSeverity.HIGH,
                crash_round=crash_round,
                description=f"Extreme market classification: {market}",
                signal_parameters={
                    "market_classification": market,
                    "behaviour": behaviour
                }
            )
            signals.append(signal)
        
        # Compression/Expansion signals
        if "Compression" in behaviour:
            signal = self._create_signal(
                signal_type=SignalType.LINGUISTIC,
                signal_name="compression_pattern",
                strength=0.6,
                confidence=0.65,
                severity=SignalSeverity.MEDIUM,
                crash_round=crash_round,
                description="Compression pattern detected - potential expansion",
                signal_parameters={
                    "behaviour": behaviour,
                    "market": market
                }
            )
            signals.append(signal)
        
        return signals
    
    def _generate_reverse_linguistic_signals(self, crash_round: CrashRound) -> List[SignalEvent]:
        """Generate signals based on reverse linguistic analysis."""
        signals = []
        
        if not crash_round.reverse_linguistic_analysis:
            return signals
        
        reverse_analysis = crash_round.reverse_linguistic_analysis
        
        # Check cascade detection
        cascade_data = reverse_analysis.get("layer11_reverse_cascade", {})
        if cascade_data.get("cascade_detected"):
            signal = self._create_signal(
                signal_type=SignalType.REVERSE_LINGUISTIC,
                signal_name="reverse_cascade_detected",
                strength=0.8,
                confidence=0.75,
                severity=SignalSeverity.HIGH,
                crash_round=crash_round,
                description="Reverse cascade pattern detected - strong reversal signal",
                signal_parameters={
                    "cascade_pattern": cascade_data.get("cascade_pattern"),
                    "cascade_count": cascade_data.get("cascade_count"),
                    "cascade_strength": cascade_data.get("overall_cascade_strength")
                }
            )
            signals.append(signal)
        
        # Check anti-correlation
        anti_corr_data = reverse_analysis.get("layer12_anti_correlation", {})
        anti_corr_score = anti_corr_data.get("anti_correlation_score", 0.0)
        
        if anti_corr_score > 0.7:
            signal = self._create_signal(
                signal_type=SignalType.REVERSE_LINGUISTIC,
                signal_name="strong_anti_correlation",
                strength=anti_corr_score,
                confidence=anti_corr_score,
                severity=SignalSeverity.HIGH if anti_corr_score > 0.8 else SignalSeverity.MEDIUM,
                crash_round=crash_round,
                description="Strong anti-correlation with historical patterns",
                signal_parameters={
                    "anti_correlation_score": anti_corr_score,
                    "correlation_type": anti_corr_data.get("correlation_type"),
                    "directional_signal": anti_corr_data.get("directional_signal")
                }
            )
            signals.append(signal)
        
        return signals
    
    def _generate_cascade_signals(self, crash_round: CrashRound) -> List[SignalEvent]:
        """Generate cascade detection signals."""
        signals = []
        
        sequence = crash_round.multiplier_sequence
        if len(sequence) < 5:
            return signals
        
        # Look for cascade patterns in the sequence
        drops = []
        for i in range(1, len(sequence)):
            if sequence[i] < sequence[i-1] * 0.9:  # 10% drop
                drops.append(i)
        
        # Multiple drops indicate cascade
        if len(drops) >= 3:
            signal = self._create_signal(
                signal_type=SignalType.CASCADE,
                signal_name="multi_drop_cascade",
                strength=0.7,
                confidence=0.7,
                severity=SignalSeverity.MEDIUM,
                crash_round=crash_round,
                description=f"Multiple drop cascade detected ({len(drops)} significant drops)",
                signal_parameters={
                    "drop_count": len(drops),
                    "drop_positions": drops[:5],
                    "sequence_length": len(sequence)
                }
            )
            signals.append(signal)
        
        return signals
    
    def _generate_anti_correlation_signals(self, crash_round: CrashRound) -> List[SignalEvent]:
        """Generate anti-correlation signals."""
        signals = []
        
        if len(self.long_history) < 20:
            return signals
        
        historical_crashes = [r.crash_point for r in self.long_history]
        historical_crashes.append(crash_round.crash_point)
        
        # Calculate correlation with recent history
        recent_history = historical_crashes[-10:]
        if len(recent_history) >= 5:
            # Simple anti-correlation check
            avg_recent = statistics.mean(recent_history[:-1])
            current = crash_round.crash_point
            
            # If current is very different from recent average
            if current > avg_recent * 2 or current < avg_recent * 0.5:
                signal = self._create_signal(
                    signal_type=SignalType.ANTI_CORRELATION,
                    signal_name="extreme_anti_correlation",
                    strength=0.8,
                    confidence=0.7,
                    severity=SignalSeverity.HIGH,
                    crash_round=crash_round,
                    description="Current crash point shows extreme anti-correlation with recent history",
                    signal_parameters={
                        "current_crash": current,
                        "recent_average": avg_recent,
                        "deviation_ratio": current / avg_recent if avg_recent > 0 else 0.0
                    }
                )
                signals.append(signal)
        
        return signals
    
    def _create_signal(
        self,
        signal_type: SignalType,
        signal_name: str,
        strength: float,
        confidence: float,
        severity: SignalSeverity,
        crash_round: CrashRound,
        description: str,
        signal_parameters: Dict[str, Any]
    ) -> SignalEvent:
        """Create a signal event."""
        return SignalEvent(
            signal_id=str(uuid.uuid4()),
            signal_type=signal_type,
            signal_name=signal_name,
            timestamp=datetime.utcnow(),
            round_id=crash_round.round_id,
            strength=strength,
            confidence=confidence,
            severity=severity,
            signal_parameters=signal_parameters,
            description=description,
            crash_point=crash_round.crash_point
        )
    
    def _filter_signals(self, signals: List[SignalEvent]) -> List[SignalEvent]:
        """Filter signals based on configuration thresholds."""
        filtered = []
        
        for signal in signals:
            # Apply strength threshold
            if signal.strength < self.config.min_strength:
                continue
            
            # Apply confidence threshold
            if signal.confidence < self.config.min_confidence:
                continue
            
            # Apply cooldown check
            last_round = self.last_signal_round.get(signal.signal_type)
            if last_round == signal.round_id:
                continue  # Skip if same signal type already generated for this round
            
            filtered.append(signal)
        
        # Limit signals per round
        if len(filtered) > self.config.max_signals_per_round:
            # Sort by strength and confidence, keep top signals
            filtered.sort(key=lambda s: (s.strength + s.confidence) / 2, reverse=True)
            filtered = filtered[:self.config.max_signals_per_round]
        
        return filtered
    
    def validate_signal(self, signal_id: str, actual_outcome: str) -> Optional[SignalEvent]:
        """
        Validate a signal against actual outcome.
        
        Args:
            signal_id: Signal to validate
            actual_outcome: Actual outcome description
            
        Returns:
            Updated signal event if found
        """
        if signal_id not in self.active_signals:
            return None
        
        signal = self.active_signals[signal_id]
        signal.is_validated = True
        
        # Simple validation logic (can be enhanced)
        signal.validation_result = self._determine_validation_result(signal, actual_outcome)
        
        # Update performance metrics
        perf = self.performance_metrics[signal.signal_type]
        perf.total_signals += 1
        perf.validated_signals += 1
        
        if signal.validation_result:
            perf.correct_predictions += 1
        
        perf.update_metrics()
        
        # Remove from active signals
        del self.active_signals[signal_id]
        
        return signal
    
    def _determine_validation_result(self, signal: SignalEvent, actual_outcome: str) -> bool:
        """Determine if signal prediction was correct."""
        # Simplified validation - can be enhanced with actual outcome analysis
        if "high" in signal.signal_name and "high" in actual_outcome.lower():
            return True
        elif "low" in signal.signal_name and "low" in actual_outcome.lower():
            return True
        elif "reversion" in signal.signal_name:
            # Reversion signals are harder to validate
            return "reversed" in actual_outcome.lower()
        
        return False
    
    def get_performance_metrics(self) -> Dict[str, Any]:
        """Get performance metrics for all signal types."""
        return {
            signal_type.value: perf.to_dict()
            for signal_type, perf in self.performance_metrics.items()
        }
    
    def get_recent_signals(self, limit: int = 20) -> List[Dict[str, Any]]:
        """Get recent signals."""
        recent = self.signal_history[-limit:]
        return [signal.to_dict() for signal in recent]
    
    def get_active_signals(self) -> List[Dict[str, Any]]:
        """Get currently active (unvalidated) signals."""
        return [signal.to_dict() for signal in self.active_signals.values()]
    
    def backtest_signals(
        self,
        historical_rounds: List[CrashRound],
        validation_outcomes: List[str]
    ) -> Dict[str, Any]:
        """
        Backtest signal performance on historical data.
        
        Args:
            historical_rounds: Historical crash rounds
            validation_outcomes: Actual outcomes for validation
            
        Returns:
            Backtest performance metrics
        """
        # Reset performance metrics
        for perf in self.performance_metrics.values():
            perf.total_signals = 0
            perf.validated_signals = 0
            perf.correct_predictions = 0
            perf.accuracy_history = []
        
        # Clear history
        self.short_history.clear()
        self.medium_history.clear()
        self.long_history.clear()
        self.signal_history.clear()
        self.active_signals.clear()
        
        # Process historical rounds
        all_signals = []
        for i, round_data in enumerate(historical_rounds):
            signals = self.analyze_round(round_data)
            all_signals.extend(signals)
            
            # Validate signals if outcome available
            if i < len(validation_outcomes):
                for signal in signals:
                    self.validate_signal(signal.signal_id, validation_outcomes[i])
        
        # Calculate overall metrics
        total_signals = len(all_signals)
        validated_signals = sum(
            1 for perf in self.performance_metrics.values()
            for perf in [perf]
        )
        
        overall_accuracy = 0.0
        if validated_signals > 0:
            total_correct = sum(
                perf.correct_predictions
                for perf in self.performance_metrics.values()
            )
            overall_accuracy = total_correct / validated_signals
        
        return {
            "total_rounds_analyzed": len(historical_rounds),
            "total_signals_generated": total_signals,
            "validated_signals": validated_signals,
            "overall_accuracy": overall_accuracy,
            "performance_by_type": self.get_performance_metrics(),
            "signal_distribution": self._get_signal_distribution(all_signals)
        }
    
    def _get_signal_distribution(self, signals: List[SignalEvent]) -> Dict[str, int]:
        """Get distribution of signal types."""
        distribution = {}
        for signal in signals:
            signal_type = signal.signal_type.value
            distribution[signal_type] = distribution.get(signal_type, 0) + 1
        return distribution