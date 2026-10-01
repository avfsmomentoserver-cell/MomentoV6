"""
Pluggable Orchestrator Manager

Manages the loading, initialization, and coordination of pluggable
orchestrator modules and strategies.
"""

import importlib
import inspect
from pathlib import Path
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from .interfaces import (
    OrchestratorContext,
    OrchestratorModule,
    OrchestratorModuleManifest,
    ExecutionStrategy,
    RiskStrategy,
    BankrollStrategy,
    SessionStrategy,
    PatienceStrategy,
    SpeedStrategy,
    MistakePreventionStrategy,
    InstructionStrategy,
)


class PluggableOrchestratorManager:
    """
    Manager for pluggable orchestrator system.

    This manager handles loading modules from the modules directory,
    initializing them with context, and coordinating their execution.
    """

    def __init__(self, db: Session, config: Dict[str, Any]) -> None:
        """
        Initialize the pluggable orchestrator manager.

        Args:
            db: Database session
            config: Application configuration
        """
        self.db = db
        self.config = config

        # Registry for loaded modules
        self._modules: Dict[str, OrchestratorModule] = {}

        # Registry for strategies by type
        self._strategies: Dict[str, Dict[str, Any]] = {
            "execution": {},
            "risk": {},
            "bankroll": {},
            "session": {},
            "patience": {},
            "speed": {},
            "mistake_prevention": {},
            "instruction": {},
        }

        # Service registry for modules
        self._service_registry: Dict[str, Any] = {}

        # Initialize context
        self._context = OrchestratorContext(
            config=config,
            db_session=db,
            logger=self._get_logger(),
            service_registry=self._service_registry,
            plugin_settings=config.get("orchestrator_plugins", {}),
        )

    def _get_logger(self) -> Any:
        """Get a logger instance."""
        # Simple logger implementation
        import logging

        logger = logging.getLogger(__name__)
        logger.setLevel(logging.INFO)
        return logger

    def register_service(self, name: str, service: Any) -> None:
        """Register a service for use by modules."""
        self._service_registry[name] = service

    def load_modules_from_directory(self, modules_dir: str) -> List[str]:
        """
        Load all orchestrator modules from a directory.

        Args:
            modules_dir: Path to modules directory

        Returns:
            List of loaded module names
        """
        loaded_modules = []
        modules_path = Path(modules_dir)

        if not modules_path.exists():
            self._context.logger.warning(f"Modules directory not found: {modules_dir}")
            return loaded_modules

        # Find all Python files in modules directory
        for module_file in modules_path.glob("*.py"):
            if module_file.name.startswith("_"):
                continue

            module_name = module_file.stem
            try:
                module = self._load_module_file(module_file, module_name)
                if module:
                    loaded_modules.append(module_name)
            except Exception as e:
                self._context.logger.error(f"Failed to load module {module_name}: {e}")

        self._context.logger.info(f"Loaded {len(loaded_modules)} orchestrator modules")
        return loaded_modules

    def _load_module_file(
        self, module_file: Path, module_name: str
    ) -> Optional[OrchestratorModule]:
        """
        Load a single module file.

        Args:
            module_file: Path to module file
            module_name: Name of the module

        Returns:
            Loaded module or None if failed
        """
        # Import the module
        spec = importlib.util.spec_from_file_location(module_name, module_file)
        if spec is None or spec.loader is None:
            return None

        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        # Find OrchestratorModule subclasses
        for name, obj in inspect.getmembers(module):
            if (
                inspect.isclass(obj)
                and issubclass(obj, OrchestratorModule)
                and obj is not OrchestratorModule
            ):

                # Instantiate the module
                manifest = (
                    obj._get_manifest() if hasattr(obj, "_get_manifest") else None
                )
                if not manifest:
                    # Create default manifest
                    manifest = OrchestratorModuleManifest(
                        name=module_name,
                        version="1.0.0",
                        author="Unknown",
                        description=f"Module {module_name}",
                        module_type="orchestrator",
                    )

                module_instance = obj(manifest)

                # Initialize the module
                module_instance.initialize(self._context)

                # Register the module
                self._modules[module_name] = module_instance

                # Register strategies from the module
                self._register_strategies_from_module(module_instance)

                self._context.logger.info(f"Loaded module: {module_name}")
                return module_instance

        return None

    def _register_strategies_from_module(self, module: OrchestratorModule) -> None:
        """Register all strategies from a module."""
        for strategy_type, strategy in module._strategies.items():
            if strategy_type in self._strategies:
                self._strategies[strategy_type][module.manifest.name] = strategy

    def get_module(self, name: str) -> Optional[OrchestratorModule]:
        """Get a loaded module by name."""
        return self._modules.get(name)

    def get_all_modules(self) -> Dict[str, OrchestratorModule]:
        """Get all loaded modules."""
        return self._modules.copy()

    def get_strategy(
        self,
        strategy_type: str,
        module_name: Optional[str] = None,
        session_config: Optional[Dict[str, Any]] = None,
    ) -> Optional[Any]:
        """
        Get a strategy of a specific type.

        Args:
            strategy_type: Type of strategy (execution, risk, etc.)
            module_name: Optional module name to get strategy from
            session_config: Optional session config for automatic strategy selection

        Returns:
            Strategy instance or None
        """
        if strategy_type not in self._strategies:
            return None

        if module_name:
            return self._strategies[strategy_type].get(module_name)

        # Auto-select based on session config
        if session_config:
            risk_profile = session_config.get("risk_profile", "default")
            if risk_profile in self._strategies[strategy_type]:
                return self._strategies[strategy_type].get(risk_profile)

        # Return first available strategy of this type
        strategies = list(self._strategies[strategy_type].values())
        return strategies[0] if strategies else None

    def get_all_strategies(self, strategy_type: str) -> Dict[str, Any]:
        """Get all strategies of a specific type."""
        return self._strategies.get(strategy_type, {}).copy()

    def process_forecast(
        self, forecast_data: Dict[str, Any], session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Process a forecast using loaded strategies.

        Args:
            forecast_data: Forecast data from prediction engine
            session_config: Current session configuration

        Returns:
            Complete orchestrator state
        """
        # Get strategies with auto-selection based on risk_profile
        execution_strategy = self.get_strategy(
            "execution", session_config=session_config
        )
        risk_strategy = self.get_strategy("risk", session_config=session_config)
        bankroll_strategy = self.get_strategy("bankroll", session_config=session_config)
        session_strategy = self.get_strategy("session", session_config=session_config)
        patience_strategy = self.get_strategy("patience", session_config=session_config)
        speed_strategy = self.get_strategy("speed", session_config=session_config)

        # Step 1: Create execution plan
        execution_plan = {}
        if execution_strategy:
            execution_plan = execution_strategy.create_execution_plan(
                forecast_data=forecast_data, session_config=session_config
            )

        # Step 2: Assess risk
        risk_assessment = {}
        if risk_strategy:
            risk_assessment = risk_strategy.assess_risk(
                forecast_data=forecast_data,
                execution_plan=execution_plan,
                session_config=session_config,
            )

        # Step 3: Get bankroll state
        bankroll_state = {}
        if bankroll_strategy:
            bankroll_state = bankroll_strategy.get_bankroll_state(
                session_config=session_config
            )

        # Step 4: Update session status
        session_status = {}
        if session_strategy:
            session_status = session_strategy.update_session_status(
                execution_plan=execution_plan,
                risk_assessment=risk_assessment,
                bankroll_state=bankroll_state,
                session_config=session_config,
            )

        # Step 5: Calculate patience if waiting
        patience_state = None
        if execution_plan.get("action") == "WAIT" and patience_strategy:
            patience_state = patience_strategy.calculate_patience(
                execution_plan=execution_plan, forecast_data=forecast_data
            )

        # Step 6: Assess speed
        speed_assessment = {}
        if speed_strategy:
            speed_assessment = speed_strategy.assess_speed(forecast_data=forecast_data)

        # Build complete state
        orchestrator_state = {
            "execution_plan": execution_plan,
            "risk_assessment": risk_assessment,
            "bankroll_state": bankroll_state,
            "session_status": session_status,
            "patience_state": patience_state,
            "speed_assessment": speed_assessment,
            "modules_used": list(self._modules.keys()),
            "last_updated": self._get_timestamp(),
        }

        return orchestrator_state

    def validate_action(
        self, proposed_action: Dict[str, Any], session_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Validate a user-proposed action.

        Args:
            proposed_action: Action the user wants to take
            session_config: Current session configuration

        Returns:
            Validation result
        """
        mistake_prevention = self.get_strategy("mistake_prevention")

        if not mistake_prevention:
            return {"valid": True, "warnings": [], "recommended_action": "WAIT"}

        # Create a minimal current state for validation
        current_state = {
            "execution_plan": {"action": "PLAY"},  # Default to allow
            "risk_assessment": {"risk_level": "MEDIUM"},
        }

        return mistake_prevention.validate_action(
            proposed_action=proposed_action,
            current_state=current_state,
            session_config=session_config,
        )

    def generate_checklist(self, session_config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generate a pre-action checklist.

        Args:
            session_config: Current session configuration

        Returns:
            Checklist items
        """
        mistake_prevention = self.get_strategy("mistake_prevention")

        if not mistake_prevention:
            return {"items": [], "complete": True}

        return mistake_prevention.generate_checklist(
            current_state={},  # Would need to track current state
            session_config=session_config,
        )

    def generate_instruction(self, context: Optional[str] = None) -> Dict[str, Any]:
        """
        Generate natural language instruction.

        Args:
            context: Optional context for the instruction

        Returns:
            Instruction message
        """
        instruction_strategy = self.get_strategy("instruction")

        if not instruction_strategy:
            return {"message": "No instruction available"}

        return instruction_strategy.generate_message(
            current_state={}, context=context  # Would need to track current state
        )

    def _get_timestamp(self) -> str:
        """Get current timestamp."""
        from datetime import datetime

        return datetime.utcnow().isoformat()

    def shutdown(self) -> None:
        """Shutdown all modules."""
        for module in self._modules.values():
            module.shutdown()

        self._modules.clear()
        for strategy_type in self._strategies:
            self._strategies[strategy_type].clear()

    def get_health_status(self) -> Dict[str, Any]:
        """Get health status of all modules."""
        health = {"modules": {}, "strategies": {}}

        for name, module in self._modules.items():
            health["modules"][name] = module.health()

        for strategy_type, strategies in self._strategies.items():
            health["strategies"][strategy_type] = list(strategies.keys())

        return health
