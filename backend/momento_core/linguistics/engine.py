"""
MomentoLinguistics conversion engine.

Converts raw multiplier values into rich MomentoLinguistic semantic objects
across 8 linguistic layers following the project's linguistics specification.
"""

import math
from typing import Optional, Dict, Any, List
from momento_core.linguistics.models import (
    MomentoLinguisticObject,
    MarketClass,
    EnergyLevel,
    BehaviourType,
    ShapeType,
    MacroRegime
)


class MomentoLinguisticsEngine:
    """
    Engine for converting raw multipliers to MomentoLinguistic objects.
    
    Implements the 8-layer linguistic architecture for semantic market
    behavior classification and cross-engine communication standardization.
    """
    
    def __init__(self) -> None:
        """Initialize the MomentoLinguistics engine."""
        self._initialize_thresholds()
    
    def _initialize_thresholds(self) -> None:
        """Initialize classification thresholds for each layer."""
        # Layer 2: Market Classification thresholds
        self.market_thresholds = {
            MarketClass.BLUE: (1.0, 1.15),
            MarketClass.PURPLE: (1.15, 1.3),
            MarketClass.PINK: (1.3, 1.5),
            MarketClass.GOLD: (1.5, 2.0),
            MarketClass.EXTREME: (2.0, float('inf'))
        }
        
        # Layer 3: Energy Language thresholds
        self.energy_thresholds = {
            EnergyLevel.TINY_RELEASE: (1.0, 1.05),
            EnergyLevel.LIGHT_RELEASE: (1.05, 1.15),
            EnergyLevel.NORMAL_RELEASE: (1.15, 1.3),
            EnergyLevel.HEAVY_RELEASE: (1.3, 1.5),
            EnergyLevel.VIOLENT_RELEASE: (1.5, 2.0),
            EnergyLevel.EXHAUSTION: (2.0, 2.5),
            EnergyLevel.ENERGY_DEBT: (2.5, 3.0),
            EnergyLevel.ENERGY_RECOVERY: (3.0, float('inf'))
        }
    
    def convert(
        self,
        multiplier: float,
        timestamp: str,
        color: Optional[str] = None,
        previous_round: Optional[Dict[str, Any]] = None,
        recent_multipliers: Optional[List[float]] = None
    ) -> MomentoLinguisticObject:
        """
        Convert raw multiplier to MomentoLinguistic object.
        
        Args:
            multiplier: Raw multiplier value (e.g., 1.22)
            timestamp: UTC timestamp in ISO format
            color: RGB color representation
            previous_round: Optional previous round data for context
            recent_multipliers: Optional list of recent multipliers for shape detection
            
        Returns:
            MomentoLinguisticObject: Complete 8-layer semantic object
        """
        obj = MomentoLinguisticObject(
            multiplier=multiplier,
            timestamp=timestamp,
            color=color
        )
        
        # Layer 1: Point Representation (normalized to -100p to +100p space)
        obj.layer1_point = self._compute_point_representation(multiplier)
        
        # Layer 2: Market Classification
        obj.layer2_market = self._classify_market(multiplier)
        
        # Layer 3: Energy Language
        obj.layer3_energy = self._classify_energy(multiplier)
        
        # Layer 4: Behaviour Language
        obj.layer4_behaviour = self._classify_behaviour(multiplier, previous_round)
        
        # Layer 5: Point Language (semantic meaning)
        obj.layer5_point = self._compute_point_language(multiplier, obj.layer2_market)
        
        # Layer 6: Relationship Language
        obj.layer6_relationship = self._compute_relationship(multiplier, previous_round)
        
        # Layer 7: Gap Language
        obj.layer7_gap = self._compute_gap_analysis(multiplier, previous_round)
        
        # Layer 8: Shape Language
        obj.layer8_shape = self._classify_shape(recent_multipliers)
        
        # Macro Regime
        obj.macro_regime = self._classify_macro_regime(multiplier)
        
        return obj
    
    def _compute_point_representation(self, multiplier: float) -> float:
        """
        Compute Layer 1: Point Representation.
        
        Normalizes multiplier to -100p to +100p space where 1.0 = 0p.
        """
        # Logarithmic normalization: log(multiplier) * 100
        return math.log(multiplier) * 100
    
    def _classify_market(self, multiplier: float) -> MarketClass:
        """
        Compute Layer 2: Market Classification.
        
        Classifies multiplier into Blue, Purple, Pink, Gold, or Extreme.
        """
        for market_class, (min_val, max_val) in self.market_thresholds.items():
            if min_val <= multiplier < max_val:
                return market_class
        return MarketClass.EXTREME
    
    def _classify_energy(self, multiplier: float) -> EnergyLevel:
        """
        Compute Layer 3: Energy Language.
        
        Classifies energy level from Tiny Release to Energy Recovery.
        """
        for energy_level, (min_val, max_val) in self.energy_thresholds.items():
            if min_val <= multiplier < max_val:
                return energy_level
        return EnergyLevel.ENERGY_RECOVERY
    
    def _classify_behaviour(
        self,
        multiplier: float,
        previous_round: Optional[Dict[str, Any]]
    ) -> BehaviourType:
        """
        Compute Layer 4: Behaviour Language.
        
        Classifies behaviour based on current multiplier and previous context.
        """
        if previous_round is None:
            return BehaviourType.TRANSITION
        
        prev_multiplier = previous_round.get('multiplier', 1.0)
        change = multiplier - prev_multiplier
        
        if abs(change) < 0.05:
            return BehaviourType.STABILISATION
        elif change > 0.1:
            return BehaviourType.EXPANSION
        elif change < -0.1:
            return BehaviourType.COMPRESSION
        elif change > 0:
            return BehaviourType.HEATING
        else:
            return BehaviourType.COOLING
    
    def _compute_point_language(
        self,
        multiplier: float,
        market_class: Optional[MarketClass]
    ) -> str:
        """
        Compute Layer 5: Point Language.
        
        Provides semantic meaning and probability significance.
        """
        if market_class == MarketClass.BLUE:
            return "Baseline stability zone"
        elif market_class == MarketClass.PURPLE:
            return "Moderate activity with positive momentum"
        elif market_class == MarketClass.PINK:
            return "Elevated activity requiring attention"
        elif market_class == MarketClass.GOLD:
            return "High activity with significant probability"
        elif market_class == MarketClass.EXTREME:
            return "Extreme activity with outlier probability"
        else:
            return "Undefined state"
    
    def _compute_relationship(
        self,
        multiplier: float,
        previous_round: Optional[Dict[str, Any]]
    ) -> str:
        """
        Compute Layer 6: Relationship Language.
        
        Analyzes mirror, expansion, and compression patterns.
        """
        if previous_round is None:
            return "No previous context"
        
        prev_multiplier = previous_round.get('multiplier', 1.0)
        ratio = multiplier / prev_multiplier
        
        if 0.95 <= ratio <= 1.05:
            return "Mirror pattern - stability"
        elif ratio > 1.1:
            return f"Expansion pattern - {ratio:.2f}x growth"
        elif ratio < 0.9:
            return f"Compression pattern - {ratio:.2f}x contraction"
        else:
            return "Transitional pattern"
    
    def _compute_gap_analysis(
        self,
        multiplier: float,
        previous_round: Optional[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Compute Layer 7: Gap Language.
        
        Analyzes neighbour pair velocity and direction.
        """
        if previous_round is None:
            return {
                "velocity": 0.0,
                "direction": "none",
                "gap_size": 0.0
            }
        
        prev_multiplier = previous_round.get('multiplier', 1.0)
        velocity = multiplier - prev_multiplier
        direction = "up" if velocity > 0 else "down" if velocity < 0 else "flat"
        gap_size = abs(velocity)
        
        return {
            "velocity": velocity,
            "direction": direction,
            "gap_size": gap_size
        }
    
    def _classify_shape(
        self,
        recent_multipliers: Optional[List[float]]
    ) -> ShapeType:
        """
        Compute Layer 8: Shape Language.
        
        Identifies patterns like Mirror, Peak, Valley, Ladder, Wave.
        """
        if not recent_multipliers or len(recent_multipliers) < 3:
            return ShapeType.TRANSITION
        
        # Simple pattern detection
        recent = recent_multipliers[-5:] if len(recent_multipliers) >= 5 else recent_multipliers
        
        # Check for peak pattern
        if len(recent) >= 3:
            if recent[-2] > recent[-3] and recent[-2] > recent[-1]:
                return ShapeType.PEAK
            elif recent[-2] < recent[-3] and recent[-2] < recent[-1]:
                return ShapeType.VALLEY
        
        # Check for wave pattern
        if len(recent) >= 4:
            changes = [recent[i] - recent[i-1] for i in range(1, len(recent))]
            if all(c > 0 for c in changes[::2]) and all(c < 0 for c in changes[1::2]):
                return ShapeType.WAVE
            elif all(c < 0 for c in changes[::2]) and all(c > 0 for c in changes[1::2]):
                return ShapeType.WAVE
        
        # Check for ladder pattern (consistent directional movement)
        if len(recent) >= 3:
            changes = [recent[i] - recent[i-1] for i in range(1, len(recent))]
            if all(c > 0 for c in changes):
                return ShapeType.LADDER
            elif all(c < 0 for c in changes):
                return ShapeType.LADDER
        
        return ShapeType.TRANSITION
    
    def _classify_macro_regime(self, multiplier: float) -> MacroRegime:
        """
        Classify macro regime based on aggregate energy levels.
        
        Uses 5-phase energy classification for broader market context.
        """
        if multiplier < 1.1:
            return MacroRegime.POST_CRISIS
        elif multiplier < 1.25:
            return MacroRegime.EARLY_RECOVERY
        elif multiplier < 1.5:
            return MacroRegime.MATURE_EXPANSION
        elif multiplier < 2.0:
            return MacroRegime.LATE_CYCLE
        else:
            return MacroRegime.CRISIS_MELT_UP
