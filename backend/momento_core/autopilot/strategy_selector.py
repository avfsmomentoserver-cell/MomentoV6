"""
Strategy selection system for autopilot operations.

Selects optimal strategies based on market conditions and plugin signals.
"""

from typing import Dict, Any, List, Optional
from momento_core.autopilot.models import (
    AutopilotConfig,
    StrategyDecision,
    SignalEvent,
)


class StrategySelector:
    """Selects the best strategy based on current market conditions and plugin signals."""
    
    def __init__(self, config: AutopilotConfig):
        """Initialize strategy selector with configuration.
        
        Args:
            config: Autopilot configuration parameters
        """
        self.config = config
        self.signal_history: List[SignalEvent] = []
        
    def select_strategy(
        self,
        ceiling_analysis: Optional[Dict[str, Any]] = None,
        gap_analysis: Optional[Dict[str, Any]] = None,
        linguistic_data: Optional[Dict[str, Any]] = None
    ) -> StrategyDecision:
        """Select optimal strategy for current conditions.
        
        Args:
            ceiling_analysis: Optional ceiling analyzer results
            gap_analysis: Optional gap swing analyzer results
            linguistic_data: Optional linguistic analysis results
            
        Returns:
            StrategyDecision with selected strategy and confidence
        """
        signals = self._collect_signals(ceiling_analysis, gap_analysis, linguistic_data)
        strategy_scores = self._evaluate_strategies(signals)
        
        # Select best strategy
        best_strategy = max(strategy_scores.items(), key=lambda x: x[1]["score"])
        strategy_name = best_strategy[0]
        strategy_info = best_strategy[1]
        
        # Calculate alternative strategies
        alternatives = [
            {"name": name, "score": info["score"], "rationale": info["rationale"]}
            for name, info in strategy_scores.items()
            if name != strategy_name
        ]
        
        return StrategyDecision(
            selected_strategy=strategy_name,
            confidence=strategy_info["score"],
            rationale=strategy_info["rationale"],
            alternative_strategies=alternatives,
            expected_outcome=strategy_info.get("expected_outcome", {}),
        )
    
    def calculate_strategy_confidence(self, signals: List[SignalEvent]) -> float:
        """Calculate overall confidence in selected strategy.
        
        Args:
            signals: List of signal events from plugins
            
        Returns:
            Confidence score between 0 and 1
        """
        if not signals:
            return 0.0
        
        # Weight signals by source and confidence
        weighted_sum = 0.0
        total_weight = 0.0
        
        for signal in signals:
            weight = self._get_signal_weight(signal.source)
            weighted_sum += signal.value * signal.confidence * weight
            total_weight += weight
        
        if total_weight == 0:
            return 0.0
        
        return min(1.0, weighted_sum / total_weight)
    
    def _collect_signals(
        self,
        ceiling_analysis: Optional[Dict[str, Any]] = None,
        gap_analysis: Optional[Dict[str, Any]] = None,
        linguistic_data: Optional[Dict[str, Any]] = None
    ) -> List[SignalEvent]:
        """Collect and normalize signals from all enabled plugins.
        
        Args:
            ceiling_analysis: Ceiling analyzer results
            gap_analysis: Gap swing analyzer results
            linguistic_data: Linguistic analysis results
            
        Returns:
            List of normalized signal events
        """
        signals = []
        
        if self.config.enable_ceiling_analyzer and ceiling_analysis:
            signals.extend(self._parse_ceiling_signals(ceiling_analysis))
        
        if self.config.enable_gap_swing_analyzer and gap_analysis:
            signals.extend(self._parse_gap_signals(gap_analysis))
        
        if self.config.enable_linguistic_analysis and linguistic_data:
            signals.extend(self._parse_linguistic_signals(linguistic_data))
        
        # Store in history
        self.signal_history.extend(signals)
        
        return signals
    
    def _evaluate_strategies(self, signals: List[SignalEvent]) -> Dict[str, Dict[str, Any]]:
        """Evaluate each potential strategy based on signals.
        
        Args:
            signals: List of signal events
            
        Returns:
            Dictionary mapping strategy names to evaluation results
        """
        strategies = {
            "conservative": {
                "score": 0.0,
                "rationale": "",
                "expected_outcome": {"risk": "low", "return": "moderate"}
            },
            "balanced": {
                "score": 0.0,
                "rationale": "",
                "expected_outcome": {"risk": "medium", "return": "moderate"}
            },
            "aggressive": {
                "score": 0.0,
                "rationale": "",
                "expected_outcome": {"risk": "high", "return": "high"}
            },
        }
        
        # Evaluate each strategy based on signals
        for signal in signals:
            if signal.signal_type == "bullish":
                strategies["aggressive"]["score"] += signal.value * signal.confidence * 0.3
                strategies["balanced"]["score"] += signal.value * signal.confidence * 0.5
                strategies["conservative"]["score"] += signal.value * signal.confidence * 0.2
            elif signal.signal_type == "bearish":
                strategies["conservative"]["score"] += signal.value * signal.confidence * 0.5
                strategies["balanced"]["score"] += signal.value * signal.confidence * 0.3
                strategies["aggressive"]["score"] -= signal.value * signal.confidence * 0.2
            elif signal.signal_type == "neutral":
                strategies["balanced"]["score"] += signal.value * signal.confidence * 0.4
        
        # Normalize scores
        max_score = max(s["score"] for s in strategies.values()) if strategies else 1.0
        if max_score > 0:
            for strategy in strategies.values():
                strategy["score"] = strategy["score"] / max_score
        
        # Generate rationales
        for name, strategy in strategies.items():
            if strategy["score"] > 0.7:
                strategy["rationale"] = f"Strong {name} signals from multiple sources"
            elif strategy["score"] > 0.4:
                strategy["rationale"] = f"Moderate {name} signals detected"
            else:
                strategy["rationale"] = f"Weak {name} signals, consider alternative"
        
        return strategies
    
    def _get_signal_weight(self, source: str) -> float:
        """Get weight for signal source based on configuration.
        
        Args:
            source: Signal source name
            
        Returns:
            Weight value
        """
        weights = {
            "ceiling_analyzer": self.config.ceiling_analyzer_weight,
            "gap_swing_analyzer": self.config.gap_swing_analyzer_weight,
            "linguistic_analysis": self.config.linguistic_analysis_weight,
        }
        return weights.get(source, 0.3)
    
    def _parse_ceiling_signals(self, analysis: Dict[str, Any]) -> List[SignalEvent]:
        """Parse signals from ceiling analyzer.
        
        Args:
            analysis: Ceiling analyzer results
            
        Returns:
            List of signal events
        """
        signals = []
        # Extract ceiling-related signals
        if "ceiling_detected" in analysis:
            signals.append(SignalEvent(
                source="ceiling_analyzer",
                signal_type="bearish" if analysis.get("direction") == "descending" else "bullish",
                value=analysis.get("strength", 0.5),
                confidence=analysis.get("confidence", 0.5),
                timestamp=analysis.get("timestamp"),
                metadata={"analysis_type": "ceiling"}
            ))
        return signals
    
    def _parse_gap_signals(self, analysis: Dict[str, Any]) -> List[SignalEvent]:
        """Parse signals from gap swing analyzer.
        
        Args:
            analysis: Gap swing analyzer results
            
        Returns:
            List of signal events
        """
        signals = []
        # Extract gap-related signals
        if "gap_detected" in analysis:
            signals.append(SignalEvent(
                source="gap_swing_analyzer",
                signal_type="bullish" if analysis.get("direction") == "upward" else "bearish",
                value=analysis.get("magnitude", 0.5),
                confidence=analysis.get("confidence", 0.5),
                timestamp=analysis.get("timestamp"),
                metadata={"analysis_type": "gap"}
            ))
        return signals
    
    def _parse_linguistic_signals(self, analysis: Dict[str, Any]) -> List[SignalEvent]:
        """Parse signals from linguistic analysis.
        
        Args:
            analysis: Linguistic analysis results
            
        Returns:
            List of signal events
        """
        signals = []
        # Extract linguistic signals
        if "energy_level" in analysis:
            energy = analysis["energy_level"]
            if energy in ["Violent", "Exhaustion"]:
                signals.append(SignalEvent(
                    source="linguistic_analysis",
                    signal_type="bearish" if energy == "Exhaustion" else "bullish",
                    value=0.7,
                    confidence=analysis.get("confidence", 0.6),
                    timestamp=analysis.get("timestamp"),
                    metadata={"energy_level": energy}
                ))
        return signals
