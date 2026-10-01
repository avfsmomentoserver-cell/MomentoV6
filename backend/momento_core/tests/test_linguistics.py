"""
Tests for MomentoLinguistics integration.

Tests the MomentoLinguistics engine to ensure proper conversion
of raw multipliers to semantic objects across 8 linguistic layers.
"""

import pytest
from momento_core.linguistics.engine import MomentoLinguisticsEngine
from momento_core.linguistics.models import (
    MomentoLinguisticObject,
    MarketClass,
    EnergyLevel,
    BehaviourType,
    ShapeType,
    MacroRegime
)


class TestMomentoLinguisticsEngine:
    """Tests for MomentoLinguistics engine."""
    
    @pytest.fixture
    def engine(self) -> MomentoLinguisticsEngine:
        """Create MomentoLinguistics engine instance."""
        return MomentoLinguisticsEngine()
    
    def test_convert_basic(self, engine: MomentoLinguisticsEngine) -> None:
        """Test basic conversion of multiplier to linguistic object."""
        obj = engine.convert(
            multiplier=1.22,
            timestamp="2026-07-19T07:00:00Z",
            color="rgb(52, 180, 255)"
        )
        
        assert isinstance(obj, MomentoLinguisticObject)
        assert obj.multiplier == 1.22
        assert obj.timestamp == "2026-07-19T07:00:00Z"
        assert obj.color == "rgb(52, 180, 255)"
    
    def test_layer0_raw_observation(self, engine: MomentoLinguisticsEngine) -> None:
        """Test Layer 0: Raw Observation is preserved."""
        obj = engine.convert(
            multiplier=1.5,
            timestamp="2026-07-19T07:00:00Z"
        )
        
        assert obj.layer0_raw == 1.5
    
    def test_layer1_point_representation(self, engine: MomentoLinguisticsEngine) -> None:
        """Test Layer 1: Point Representation normalization."""
        obj = engine.convert(
            multiplier=1.22,
            timestamp="2026-07-19T07:00:00Z"
        )
        
        assert obj.layer1_point is not None
        # Should be normalized to logarithmic space
        assert isinstance(obj.layer1_point, float)
    
    def test_layer2_market_classification(self, engine: MomentoLinguisticsEngine) -> None:
        """Test Layer 2: Market Classification."""
        # Test Blue classification (1.0 - 1.15)
        obj_blue = engine.convert(multiplier=1.1, timestamp="2026-07-19T07:00:00Z")
        assert obj_blue.layer2_market == MarketClass.BLUE
        
        # Test Purple classification (1.15 - 1.3)
        obj_purple = engine.convert(multiplier=1.22, timestamp="2026-07-19T07:00:00Z")
        assert obj_purple.layer2_market == MarketClass.PURPLE
        
        # Test Pink classification (1.3 - 1.5)
        obj_pink = engine.convert(multiplier=1.4, timestamp="2026-07-19T07:00:00Z")
        assert obj_pink.layer2_market == MarketClass.PINK
        
        # Test Gold classification (1.5 - 2.0)
        obj_gold = engine.convert(multiplier=1.75, timestamp="2026-07-19T07:00:00Z")
        assert obj_gold.layer2_market == MarketClass.GOLD
        
        # Test Extreme classification (2.0+)
        obj_extreme = engine.convert(multiplier=2.5, timestamp="2026-07-19T07:00:00Z")
        assert obj_extreme.layer2_market == MarketClass.EXTREME
    
    def test_layer3_energy_language(self, engine: MomentoLinguisticsEngine) -> None:
        """Test Layer 3: Energy Language classification."""
        # Test Tiny Release
        obj_tiny = engine.convert(multiplier=1.03, timestamp="2026-07-19T07:00:00Z")
        assert obj_tiny.layer3_energy == EnergyLevel.TINY_RELEASE
        
        # Test Normal Release
        obj_normal = engine.convert(multiplier=1.22, timestamp="2026-07-19T07:00:00Z")
        assert obj_normal.layer3_energy == EnergyLevel.NORMAL_RELEASE
        
        # Test Violent Release
        obj_violent = engine.convert(multiplier=1.75, timestamp="2026-07-19T07:00:00Z")
        assert obj_violent.layer3_energy == EnergyLevel.VIOLENT_RELEASE
    
    def test_layer4_behaviour_language(self, engine: MomentoLinguisticsEngine) -> None:
        """Test Layer 4: Behaviour Language classification."""
        # Test without previous context (should return Transition)
        obj_no_context = engine.convert(multiplier=1.22, timestamp="2026-07-19T07:00:00Z")
        assert obj_no_context.layer4_behaviour == BehaviourType.TRANSITION
        
        # Test with expansion (significant increase)
        obj_expansion = engine.convert(
            multiplier=1.3,
            timestamp="2026-07-19T07:00:00Z",
            previous_round={"multiplier": 1.1}
        )
        assert obj_expansion.layer4_behaviour == BehaviourType.EXPANSION
        
        # Test with compression (significant decrease)
        obj_compression = engine.convert(
            multiplier=1.1,
            timestamp="2026-07-19T07:00:00Z",
            previous_round={"multiplier": 1.3}
        )
        assert obj_compression.layer4_behaviour == BehaviourType.COMPRESSION
    
    def test_layer5_point_language(self, engine: MomentoLinguisticsEngine) -> None:
        """Test Layer 5: Point Language semantic meaning."""
        obj_blue = engine.convert(multiplier=1.1, timestamp="2026-07-19T07:00:00Z")
        assert "Baseline stability" in obj_blue.layer5_point
        
        obj_extreme = engine.convert(multiplier=2.5, timestamp="2026-07-19T07:00:00Z")
        assert "Extreme" in obj_extreme.layer5_point
    
    def test_layer6_relationship_language(self, engine: MomentoLinguisticsEngine) -> None:
        """Test Layer 6: Relationship Language."""
        # Test mirror pattern (minimal change)
        obj_mirror = engine.convert(
            multiplier=1.21,
            timestamp="2026-07-19T07:00:00Z",
            previous_round={"multiplier": 1.20}
        )
        assert "Mirror" in obj_mirror.layer6_relationship
        
        # Test expansion pattern
        obj_expansion = engine.convert(
            multiplier=1.5,
            timestamp="2026-07-19T07:00:00Z",
            previous_round={"multiplier": 1.0}
        )
        assert "Expansion" in obj_expansion.layer6_relationship
    
    def test_layer7_gap_analysis(self, engine: MomentoLinguisticsEngine) -> None:
        """Test Layer 7: Gap Language analysis."""
        obj = engine.convert(
            multiplier=1.3,
            timestamp="2026-07-19T07:00:00Z",
            previous_round={"multiplier": 1.2}
        )
        
        assert obj.layer7_gap is not None
        assert "velocity" in obj.layer7_gap
        assert "direction" in obj.layer7_gap
        assert "gap_size" in obj.layer7_gap
        assert obj.layer7_gap["direction"] == "up"
    
    def test_layer8_shape_language(self, engine: MomentoLinguisticsEngine) -> None:
        """Test Layer 8: Shape Language classification."""
        # Test with insufficient data (should return Transition)
        obj_no_data = engine.convert(
            multiplier=1.22,
            timestamp="2026-07-19T07:00:00Z",
            recent_multipliers=[1.2]
        )
        assert obj_no_data.layer8_shape == ShapeType.TRANSITION
        
        # Test peak pattern
        obj_peak = engine.convert(
            multiplier=1.3,
            timestamp="2026-07-19T07:00:00Z",
            recent_multipliers=[1.1, 1.2, 1.3, 1.25]
        )
        assert obj_peak.layer8_shape == ShapeType.PEAK
        
        # Test valley pattern
        obj_valley = engine.convert(
            multiplier=1.2,
            timestamp="2026-07-19T07:00:00Z",
            recent_multipliers=[1.3, 1.25, 1.2, 1.25]
        )
        assert obj_valley.layer8_shape == ShapeType.VALLEY
    
    def test_macro_regime_classification(self, engine: MomentoLinguisticsEngine) -> None:
        """Test macro regime classification."""
        obj_post_crisis = engine.convert(multiplier=1.05, timestamp="2026-07-19T07:00:00Z")
        assert obj_post_crisis.macro_regime == MacroRegime.POST_CRISIS
        
        obj_early_recovery = engine.convert(multiplier=1.2, timestamp="2026-07-19T07:00:00Z")
        assert obj_early_recovery.macro_regime == MacroRegime.EARLY_RECOVERY
        
        obj_mature_expansion = engine.convert(multiplier=1.4, timestamp="2026-07-19T07:00:00Z")
        assert obj_mature_expansion.macro_regime == MacroRegime.MATURE_EXPANSION
        
        obj_late_cycle = engine.convert(multiplier=1.75, timestamp="2026-07-19T07:00:00Z")
        assert obj_late_cycle.macro_regime == MacroRegime.LATE_CYCLE
        
        obj_crisis = engine.convert(multiplier=2.5, timestamp="2026-07-19T07:00:00Z")
        assert obj_crisis.macro_regime == MacroRegime.CRISIS_MELT_UP
    
    def test_to_dict_conversion(self, engine: MomentoLinguisticsEngine) -> None:
        """Test conversion to dictionary representation."""
        obj = engine.convert(
            multiplier=1.22,
            timestamp="2026-07-19T07:00:00Z",
            color="rgb(52, 180, 255)"
        )
        
        obj_dict = obj.to_dict()
        
        assert isinstance(obj_dict, dict)
        assert obj_dict["multiplier"] == 1.22
        assert obj_dict["timestamp"] == "2026-07-19T07:00:00Z"
        assert obj_dict["color"] == "rgb(52, 180, 255)"
        assert "layer0_raw" in obj_dict
        assert "layer1_point" in obj_dict
        assert "layer2_market" in obj_dict
