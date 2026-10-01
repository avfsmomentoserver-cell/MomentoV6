"""
Pluggable Orchestrator System

A modular, extensible orchestrator system that allows different
orchestrator components to be plugged in as modules.
"""

from .interfaces import (
    OrchestratorPlugin,
    OrchestratorContext,
    OrchestratorModule,
    ExecutionStrategy,
    RiskStrategy,
    BankrollStrategy
)
from .manager import PluggableOrchestratorManager

__all__ = [
    'OrchestratorPlugin',
    'OrchestratorContext', 
    'OrchestratorModule',
    'ExecutionStrategy',
    'RiskStrategy',
    'BankrollStrategy',
    'PluggableOrchestratorManager'
]
