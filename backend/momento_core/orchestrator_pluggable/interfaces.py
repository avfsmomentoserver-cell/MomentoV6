"""
Pluggable Orchestrator Interfaces

Defines the contracts for pluggable orchestrator components.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from datetime import datetime


@dataclass
class OrchestratorContext:
    """Runtime context provided to orchestrator plugins."""
    
    config: Dict[str, Any]
    db_session: Any
    logger: Any
    service_registry: Dict[str, Any]
    plugin_settings: Dict[str, Any]
    
    def get_service(self, name: str) -> Any:
        """Get a service from the registry."""
        return self.service_registry.get(name)
    
    def get_setting(self, key: str, default: Any = None) -> Any:
        """Get a plugin setting."""
        return self.plugin_settings.get(key, default)


@dataclass
class OrchestratorModuleManifest:
    """Metadata for orchestrator modules."""
    
    name: str
    version: str
    author: str
    description: str
    module_type: str
    enabled: bool = True
    capabilities: List[str] = field(default_factory=list)
    dependencies: List[str] = field(default_factory=list)
    settings_schema: Optional[Dict[str, Any]] = None


class OrchestratorPlugin(ABC):
    """Base plugin contract for orchestrator components."""
    
    manifest: OrchestratorModuleManifest
    
    def __init__(self, manifest: OrchestratorModuleManifest) -> None:
        self.manifest = manifest
    
    @abstractmethod
    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the plugin with runtime context."""
    
    def shutdown(self) -> None:
        """Clean up plugin resources."""
        return None
    
    def health(self) -> Dict[str, Any]:
        """Return plugin health information."""
        return {
            "name": self.manifest.name,
            "version": self.manifest.version,
            "enabled": self.manifest.enabled,
            "status": "ok"
        }


class ExecutionStrategy(OrchestratorPlugin):
    """Plugin type for execution planning strategies."""
    
    @abstractmethod
    def create_execution_plan(
        self,
        forecast_data: Dict[str, Any],
        session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Create an execution plan from forecast data."""


class RiskStrategy(OrchestratorPlugin):
    """Plugin type for risk assessment strategies."""
    
    @abstractmethod
    def assess_risk(
        self,
        forecast_data: Dict[str, Any],
        execution_plan: Dict[str, Any],
        session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Assess risk for the current situation."""


class BankrollStrategy(OrchestratorPlugin):
    """Plugin type for bankroll management strategies."""
    
    @abstractmethod
    def get_bankroll_state(
        self,
        session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Get current bankroll state."""
    
    @abstractmethod
    def update_bankroll(
        self,
        action: Dict[str, Any],
        result: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update bankroll after action execution."""


class SessionStrategy(OrchestratorPlugin):
    """Plugin type for session management strategies."""
    
    @abstractmethod
    def update_session_status(
        self,
        execution_plan: Dict[str, Any],
        risk_assessment: Dict[str, Any],
        bankroll_state: Dict[str, Any],
        session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update session status based on current state."""


class PatienceStrategy(OrchestratorPlugin):
    """Plugin type for patience calculation strategies."""
    
    @abstractmethod
    def calculate_patience(
        self,
        execution_plan: Dict[str, Any],
        forecast_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Calculate patience state for waiting periods."""


class SpeedStrategy(OrchestratorPlugin):
    """Plugin type for speed assessment strategies."""
    
    @abstractmethod
    def assess_speed(
        self,
        forecast_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Assess current market speed conditions."""


class MistakePreventionStrategy(OrchestratorPlugin):
    """Plugin type for mistake prevention strategies."""
    
    @abstractmethod
    def validate_action(
        self,
        proposed_action: Dict[str, Any],
        current_state: Dict[str, Any],
        session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Validate a user-proposed action."""
    
    @abstractmethod
    def generate_checklist(
        self,
        current_state: Dict[str, Any],
        session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Generate a pre-action checklist."""


class InstructionStrategy(OrchestratorPlugin):
    """Plugin type for instruction generation strategies."""
    
    @abstractmethod
    def generate_message(
        self,
        current_state: Dict[str, Any],
        context: Optional[str] = None
    ) -> Dict[str, Any]:
        """Generate natural language instruction message."""


class OrchestratorModule(ABC):
    """
    Complete orchestrator module that combines multiple strategies.
    
    A module can provide implementations for multiple strategy types
    to create a complete orchestrator behavior.
    """
    
    manifest: OrchestratorModuleManifest
    
    def __init__(self, manifest: OrchestratorModuleManifest) -> None:
        self.manifest = manifest
        self._strategies: Dict[str, OrchestratorPlugin] = {}
    
    @abstractmethod
    def initialize(self, context: OrchestratorContext) -> None:
        """Initialize the module and all its strategies."""
    
    def register_strategy(self, strategy_type: str, strategy: OrchestratorPlugin) -> None:
        """Register a strategy implementation."""
        self._strategies[strategy_type] = strategy
    
    def get_strategy(self, strategy_type: str) -> Optional[OrchestratorPlugin]:
        """Get a registered strategy."""
        return self._strategies.get(strategy_type)
    
    def shutdown(self) -> None:
        """Shutdown all strategies."""
        for strategy in self._strategies.values():
            strategy.shutdown()
