"""
MomentoLinguistics data models.

Defines the data structures for MomentoLinguistic semantic objects
across 8 linguistic layers plus macro regime classification.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Dict, Any, List


class MarketClass(Enum):
    """Layer 2: Market Classification."""
    BLUE = "Blue"
    PURPLE = "Purple"
    PINK = "Pink"
    GOLD = "Gold"
    EXTREME = "Extreme"


class EnergyLevel(Enum):
    """Layer 3: Energy Language."""
    TINY_RELEASE = "Tiny Release"
    LIGHT_RELEASE = "Light Release"
    NORMAL_RELEASE = "Normal Release"
    HEAVY_RELEASE = "Heavy Release"
    VIOLENT_RELEASE = "Violent Release"
    EXHAUSTION = "Exhaustion"
    ENERGY_DEBT = "Energy Debt"
    ENERGY_RECOVERY = "Energy Recovery"


class BehaviourType(Enum):
    """Layer 4: Behaviour Language."""
    TRANSITION = "Transition"
    COMPRESSION = "Compression"
    EXPANSION = "Expansion"
    RECOVERY = "Recovery"
    COOLING = "Cooling"
    HEATING = "Heating"
    ACCUMULATION = "Accumulation"
    DISTRIBUTION = "Distribution"
    STABILISATION = "Stabilisation"
    EXHAUSTION = "Exhaustion"
    RESET = "Reset"
    IMPULSE = "Impulse"
    CONTINUATION = "Continuation"
    REVERSAL = "Reversal"


class ShapeType(Enum):
    """Layer 8: Shape Language."""
    TRANSITION = "Transition"
    MIRROR = "Mirror"
    PEAK = "Peak"
    VALLEY = "Valley"
    MOUNTAIN = "Mountain"
    PLATEAU = "Plateau"
    LADDER = "Ladder"
    STAIRCASE = "Staircase"
    SPIKE = "Spike"
    WAVE = "Wave"
    SAW = "Saw"
    DOUBLE_PEAK = "Double Peak"
    TRIPLE_PEAK = "Triple Peak"
    ALTERNATING = "Alternating"
    COMPRESSION_FUNNEL = "Compression Funnel"


class MacroRegime(Enum):
    """Macro Regime: 5-Phase Energy Classification."""
    POST_CRISIS = "Post-Crisis"
    EARLY_RECOVERY = "Early Recovery"
    MATURE_EXPANSION = "Mature Expansion"
    LATE_CYCLE = "Late Cycle"
    CRISIS_MELT_UP = "Crisis / Melt-Up"


@dataclass
class MomentoLinguisticObject:
    """
    Complete MomentoLinguistic semantic object across 8 layers.
    
    Converts raw multiplier values into rich semantic representations
    for market behavior analysis and cross-engine communication.
    
    Attributes:
        multiplier: Raw multiplier value (preserved)
        timestamp: UTC timestamp of the observation
        color: RGB color representation
        layer0_raw: Layer 0 - Raw Observation (preserved multiplier)
        layer1_point: Layer 1 - Point Representation (normalized space)
        layer2_market: Layer 2 - Market Classification
        layer3_energy: Layer 3 - Energy Language
        layer4_behaviour: Layer 4 - Behaviour Language
        layer5_point: Layer 5 - Point Language (semantic meaning)
        layer6_relationship: Layer 6 - Relationship Language
        layer7_gap: Layer 7 - Gap Language (neighbour analysis)
        layer8_shape: Layer 8 - Shape Language
        macro_regime: Macro regime classification
        metadata: Additional metadata and confidence scores
    """
    
    multiplier: float
    timestamp: str
    color: Optional[str] = None
    
    # Layer 0: Raw Observation
    layer0_raw: float = field(init=False)
    
    # Layer 1: Point Representation
    layer1_point: Optional[float] = None
    
    # Layer 2: Market Classification
    layer2_market: Optional[MarketClass] = None
    
    # Layer 3: Energy Language
    layer3_energy: Optional[EnergyLevel] = None
    
    # Layer 4: Behaviour Language
    layer4_behaviour: Optional[BehaviourType] = None
    
    # Layer 5: Point Language
    layer5_point: Optional[str] = None
    
    # Layer 6: Relationship Language
    layer6_relationship: Optional[str] = None
    
    # Layer 7: Gap Language
    layer7_gap: Optional[Dict[str, Any]] = None
    
    # Layer 8: Shape Language
    layer8_shape: Optional[ShapeType] = None
    
    # Macro Regime
    macro_regime: Optional[MacroRegime] = None
    
    # Metadata
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def __post_init__(self) -> None:
        """Initialize layer 0 with raw multiplier."""
        self.layer0_raw = self.multiplier
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary representation."""
        return {
            "multiplier": self.multiplier,
            "timestamp": self.timestamp,
            "color": self.color,
            "layer0_raw": self.layer0_raw,
            "layer1_point": self.layer1_point,
            "layer2_market": self.layer2_market.value if self.layer2_market else None,
            "layer3_energy": self.layer3_energy.value if self.layer3_energy else None,
            "layer4_behaviour": self.layer4_behaviour.value if self.layer4_behaviour else None,
            "layer5_point": self.layer5_point,
            "layer6_relationship": self.layer6_relationship,
            "layer7_gap": self.layer7_gap,
            "layer8_shape": self.layer8_shape.value if self.layer8_shape else None,
            "macro_regime": self.macro_regime.value if self.macro_regime else None,
            "metadata": self.metadata
        }
