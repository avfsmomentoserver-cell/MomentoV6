"""
Autopilot module for automated trading and prediction execution.

This module provides intelligent automation capabilities for the Momento/AVFS Core platform,
including risk management, strategy selection, and automated decision execution.
"""

from momento_core.autopilot.models import (
    AutopilotConfig,
    AutopilotDecision,
    AutopilotStatus,
    RiskAssessment,
    StrategyDecision,
)
from momento_core.autopilot.engine import AutopilotEngine
from momento_core.autopilot.risk_manager import RiskManager
from momento_core.autopilot.strategy_selector import StrategySelector

__all__ = [
    "AutopilotConfig",
    "AutopilotDecision", 
    "AutopilotStatus",
    "RiskAssessment",
    "StrategyDecision",
    "AutopilotEngine",
    "RiskManager",
    "StrategySelector",
]
