# ADR-0003: Pluggable Orchestrator Architecture

## Status

Accepted

## Context

After implementing the initial Decision Orchestrator layer (ADR-0002), the system had a monolithic architecture where all orchestrator components were tightly coupled within a single module. This created several limitations:

### Problem Statement

1. **Rigid Architecture**: Adding new strategies required modifying core code
2. **Limited Extensibility**: Third-party developers couldn't easily add custom strategies
3. **Testing Challenges**: Difficult to test individual strategies in isolation
4. **Deployment Complexity**: All strategies had to be deployed together
5. **Configuration Inflexibility**: Couldn't easily enable/disable specific strategies
6. **Version Coupling**: Changes to one strategy affected the entire system

### Key Limitations

- Execution, risk, bankroll, session, patience, speed, mistake prevention, and instruction strategies were all hardcoded
- No mechanism for hot-swapping strategies at runtime
- No way to have multiple implementations of the same strategy type
- Tight coupling between strategies and the orchestrator engine
- No plugin system for external contributions

## Decision

Implement a **Pluggable Orchestrator Architecture** that transforms the orchestrator from a monolithic system into a plugin-based architecture with dynamic module loading and strategy registration.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    PluggableOrchestratorManager              │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              Module Registry                          │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │  │
│  │  │ default_mod  │  │ custom_mod   │  │ future_mod  │ │  │
│  │  └──────────────┘  └──────────────┘  └─────────────┘ │  │
│  └─────────────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              Strategy Registry                          │  │
│  │  execution:  {default: ..., custom: ...}                │  │
│  │  risk:       {default: ..., custom: ...}                │  │
│  │  bankroll:   {default: ..., custom: ...}                │  │
│  │  session:    {default: ..., custom: ...}                │  │
│  │  patience:   {default: ..., custom: ...}                │  │
│  │  speed:      {default: ..., custom: ...}                │  │
│  │  mistake_prevention: {default: ..., custom: ...}         │  │
│  │  instruction: {default: ..., custom: ...}               │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    OrchestratorContext                       │
│  - config: Dict[str, Any]                                    │
│  - db_session: Session                                       │
│  - logger: Logger                                            │
│  - service_registry: Dict[str, Any]                         │
│  - plugin_settings: Dict[str, Any]                          │
└─────────────────────────────────────────────────────────────┘
```

### Core Components

1. **OrchestratorContext**: Runtime context provided to all plugins
   - Configuration access
   - Database session
   - Logger
   - Service registry
   - Plugin-specific settings

2. **OrchestratorModuleManifest**: Metadata for modules
   - Name, version, author
   - Description and capabilities
   - Dependencies and settings schema
   - Enabled/disabled status

3. **Strategy Interfaces**: Abstract base classes for each strategy type
   - `ExecutionStrategy`: Create execution plans
   - `RiskStrategy`: Assess risk
   - `BankrollStrategy`: Manage bankroll
   - `SessionStrategy`: Manage sessions
   - `PatienceStrategy`: Calculate patience
   - `SpeedStrategy`: Assess market speed
   - `MistakePreventionStrategy`: Validate actions
   - `InstructionStrategy`: Generate instructions

4. **OrchestratorModule**: Complete module combining multiple strategies
   - Can implement multiple strategy types
   - Lifecycle management (initialize/shutdown)
   - Health monitoring
   - Strategy registration

5. **PluggableOrchestratorManager**: Central coordinator
   - Dynamic module loading from directory
   - Strategy registration and retrieval
   - Service registry for inter-module communication
   - Health monitoring
   - Request routing to appropriate strategies

### Module Loading

Modules are discovered and loaded dynamically from the `orchestrator_pluggable/modules/` directory:

```python
manager = PluggableOrchestratorManager(db, config)
manager.load_modules_from_directory('orchestrator_pluggable/modules')
```

Each module file:
1. Is imported as a Python module
2. Scanned for `OrchestratorModule` subclasses
3. Instantiated with its manifest
4. Initialized with orchestrator context
5. Strategies are registered in the strategy registry

### Strategy Selection

The manager selects strategies based on module name or returns the first available:

```python
# Get specific module's strategy
strategy = manager.get_strategy('execution', 'custom_module')

# Get first available strategy
strategy = manager.get_strategy('execution')
```

### Default Module

A `default_module.py` provides reference implementations of all strategies:
- `DefaultExecutionStrategy`: Standard execution planning
- `DefaultRiskStrategy`: Basic risk assessment
- `DefaultBankrollStrategy`: Simple bankroll management
- `DefaultSessionStrategy`: Standard session control
- `DefaultPatienceStrategy`: Basic patience calculation
- `DefaultSpeedStrategy`: Simple speed assessment
- `DefaultMistakePreventionStrategy`: Standard validation
- `DefaultInstructionStrategy`: Basic instruction generation

## Consequences

### Positive

1. **Extensibility**: New strategies can be added without modifying core code
2. **Modularity**: Each strategy is independently testable and deployable
3. **Flexibility**: Multiple implementations of the same strategy type can coexist
4. **Hot-Swapping**: Strategies can be enabled/disabled via configuration
5. **Third-Party Contributions**: External developers can create custom modules
6. **Isolation**: Strategy failures don't affect the entire system
7. **Configuration**: Per-strategy settings via plugin settings
8. **Health Monitoring**: Individual strategy health can be monitored
9. **Service Registry**: Strategies can share services via registry
10. **Backward Compatibility**: Default module maintains existing behavior

### Negative

1. **Complexity**: More moving parts and abstractions
2. **Discovery**: Need to understand plugin system to extend
3. **Debugging**: More complex call chains through plugin system
4. **Performance**: Dynamic loading adds minimal overhead
5. **Dependency Management**: Modules may have conflicting dependencies

### Risks

1. **Module Conflicts**: Multiple modules may provide conflicting strategies
2. **Version Compatibility**: Module API changes may break existing modules
3. **Security**: Loading external modules requires trust verification
4. **Testing**: Need to test all module combinations

### Mitigations

1. **Clear Documentation**: Comprehensive guide for module development
2. **Versioning**: Module manifest includes version and dependencies
3. **Validation**: Module loading includes validation and error handling
4. **Sandboxing**: Consider sandboxing for third-party modules
5. **Health Checks**: Regular health monitoring of all modules
6. **Fallback**: Default module always available as fallback

## Implementation

### Directory Structure
```
core/momento_core/orchestrator_pluggable/
├── __init__.py
├── interfaces.py          # Strategy interfaces and base classes
├── manager.py             # PluggableOrchestratorManager
└── modules/
    ├── __init__.py
    └── default_module.py  # Default implementations
```

### API Integration

API routes updated to use `PluggableOrchestratorManager`:

```python
@router.post("/orchestrator/process-forecast")
def process_forecast(
    forecast_data: Dict[str, Any],
    session_config: Dict[str, Any],
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    manager = get_orchestrator_manager(db)
    return manager.process_forecast(forecast_data, session_config)
```

### New Endpoint

Added health check endpoint for monitoring:

```python
@router.get("/orchestrator/health")
def get_health_status(db: Session = Depends(get_db_session)) -> Dict[str, Any]:
    manager = get_orchestrator_manager(db)
    return manager.get_health_status()
```

### Module Development

Creating a custom module:

```python
from momento_core.orchestrator_pluggable.interfaces import (
    OrchestratorModule,
    OrchestratorModuleManifest,
    OrchestratorContext,
    ExecutionStrategy
)

class CustomExecutionStrategy(ExecutionStrategy):
    def initialize(self, context: OrchestratorContext) -> None:
        self.context = context
    
    def create_execution_plan(self, forecast_data, session_config):
        # Custom implementation
        return {"action": "PLAY", "reason": "Custom logic"}

class CustomModule(OrchestratorModule):
    @staticmethod
    def _get_manifest():
        return OrchestratorModuleManifest(
            name='custom',
            version='1.0.0',
            author='Custom Author',
            description='Custom orchestrator module',
            module_type='orchestrator'
        )
    
    def initialize(self, context: OrchestratorContext) -> None:
        self.context = context
        strategy = CustomExecutionStrategy(self.manifest)
        strategy.initialize(context)
        self.register_strategy('execution', strategy)
```

## Migration Path

### Phase 1: Pluggable Infrastructure (Completed)
- Implement interfaces and manager
- Create default module with existing strategies
- Update API routes to use manager
- Add health check endpoint

### Phase 2: Module Development (Future)
- Create specialized modules for different use cases
- Implement configuration-driven module loading
- Add module validation and security checks

### Phase 3: Ecosystem (Future)
- Module marketplace or registry
- Module versioning and dependency management
- Hot-reloading capabilities
- Module performance monitoring

## Alternatives Considered

### 1. Keep Monolithic Architecture
**Rejected**: Too rigid, doesn't support extensibility requirements

### 2. Configuration-Based Strategy Selection
**Rejected**: Still requires all strategies to be loaded, limited flexibility

### 3. Microservices Architecture
**Rejected**: Overkill for current needs, adds network complexity

### 4. Dependency Injection Framework
**Rejected**: Adds dependency on external framework, custom solution sufficient

## References

- ADR-0002: Decision Orchestrator Layer
- Project architecture: `.kiro/steering/architecture.md`
- Coding standards: `.devin/CODING_STANDARDS.md`
- Plugin design patterns: Industry best practices

## Decision Makers

- Product Owner: User specification for pluggable architecture
- Architecture: Momento Core team
- Implementation: Development team

## Date

2026-07-23
