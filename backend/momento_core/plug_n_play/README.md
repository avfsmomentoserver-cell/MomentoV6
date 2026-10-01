# Momento Core Plug-n-Play Receiver

## Goal

Implement a pluggable receiver architecture for `momento_core` so external plugin packages can extend the platform with:

- UI contributions
- Prediction engines and forecast algorithms
- Signal generators and pattern detectors
- Dashboard widgets
- Runtime settings and configuration panels

This should behave like a modular extension system—similar to a VS Code extension host or Chrome extension model—while keeping the core stable and secure.

## Principles

1. **Core Stability First**
   - Core remains independent; plugins add capabilities through well-defined extension points.

2. **Explicit Contracts**
   - Plugin manifest metadata and capability interfaces define what plugins can do.

3. **Dynamic Discovery**
   - The receiver discovers plugins at startup or runtime via package namespace and plugin directories.

4. **Scoped Access**
   - Plugins operate through a managed `PluginContext`; they do not access internal core internals directly.

5. **Composable Extensions**
   - Multiple plugin types can coexist: UI, prediction, signal, widget, and settings.

6. **Runtime Control**
   - Plugins can be enabled, disabled, and configured without changing core code.

## Architecture

### Central Receiver

The receiver is a central plugin host in `momento_core.plug_n_play` that:

- loads plugin manifests
- validates plugin metadata
- initializes plugin instances
- registers plugin capabilities with the host
- exposes plugin health/config state to the core API

### Extension Points

#### UI Extensions

Plugins can supply UI metadata and route descriptors that the dashboard can consume.

- `ui.cards`
- `ui.panels`
- `ui.routes`
- `ui.widgets`

#### Prediction Extensions

Plugins can register forecast or prediction engines:

- `predictor_id`
- `model_type`
- `run_prediction(data)`
- `confidence_interval`

#### Signal Extensions

Plugins can define signal generators and pattern detectors that consume collected event data:

- `signal_id`
- `signal_name`
- `evaluate(data)`
- `severity`

#### Widget Extensions

Plugins can expose dashboard widget metadata and data adapters:

- `widget_id`
- `widget_type`
- `data_schema`
- `render_hint`

#### Settings Extensions

Plugins can publish runtime settings schemas and configuration defaults:

- `settings_key`
- `settings_schema`
- `default_values`
- `ui_title`

## Plugin Manifest

Every plugin should expose a manifest describing:

- `name`
- `version`
- `author`
- `description`
- `plugin_type` (ui, prediction, signal, widget, settings, hybrid)
- `entrypoint` (module path)
- `capabilities`
- `enabled`
- `settings_schema`
- `dependencies`

The receiver validates this manifest before loading the plugin.

## Plugin Interface

Plugins implement a base interface with lifecycle hooks:

- `initialize(context)`
- `shutdown()`
- `register()`
- `health()`

Category-specific interfaces extend the base plugin contract.

## Discovery and Loading

### Discovery sources

- Internal namespaced plugin package: `momento_core.plugins`
- External plugin directories configured by env var: `MOMENTO_PLUGIN_PATH`
- Python entry points: `momento_core.plugins`

### Loading strategy

1. discover available plugins
2. validate each plugin manifest
3. instantiate plugin class
4. initialize with `PluginContext`
5. register capabilities
6. expose plugin metadata to core services

## Plugin Context

The receiver provides a limited `PluginContext` containing:

- database session provider
- service registry reference
- configuration API
- logging facility
- event hooks for lifecycle and data updates

Plugins receive context, not raw core internals.

## Integration with Core

### API

The receiver should expose APIs for:

- listing installed plugins
- plugin health/status
- loading/unloading plugins
- plugin settings

This can be served by FastAPI routes under `/api/v1/plugins`.

### Data

The receiver also centralizes plugin-driven data contributions:

- prediction outputs saved to forecast stores
- signal outputs saved to signal tables or event logs
- UI metadata served to dashboard clients
- settings persisted in core configuration

## Implementation Plan

### Phase 1: Foundation

- Create `plug_n_play` package and plugin registry
- Define `PluginManifest`, `PluginContext`, and `BasePlugin`
- Implement plugin discovery and dynamic loader
- Provide plugin manifest validation
- Add plugin health and registration logic

### Phase 2: Extension Points

- Implement UI plugin registration contract
- Implement prediction plugin contract
- Implement signal plugin contract
- Implement widget plugin contract
- Implement settings plugin contract

### Phase 3: Core Integration

- Add plugin API endpoints to `momento_core.api`
- Integrate plugin UI metadata into dashboard payloads
- Wire prediction plugins into forecast execution
- Wire signal plugins into analysis pipeline
- Expose plugin settings through config UI and runtime API

### Phase 4: Sample Plugins

- Create sample `ui_plugin` that registers a dashboard panel
- Create sample `prediction_plugin` with a simple linear model
- Create sample `signal_plugin` that detects streaks
- Create sample `settings_plugin` with dynamic config schema

### Phase 5: Safety and Governance

- Add plugin manifest validation and capability whitelisting
- Add enable/disable controls for plugins
- Add plugin logging and error isolation
- Document plugin installation and lifecycle

## Recommended File Layout

```
core/momento_core/plug_n_play/
├── __init__.py
├── interfaces.py
├── manager.py
├── README.md
├── plugins/  # optional internal plugin packages
│   └── __init__.py
```

## Notes

- Keep plugin contributions declarative through metadata.
- Avoid direct core model imports in plugins; use context helpers instead.
- Treat the receiver as the single entry point for all plugin integrations.
- Design plugin interfaces with clear separation of concerns so new types can be added later.

## Next Deliverables

- `core/momento_core/plug_n_play/manager.py` plugin host implementation
- `core/momento_core/plug_n_play/interfaces.py` plugin contract definitions
- `core/momento_core/plug_n_play/README.md` plan and extension guide
- `core/momento_core/plugins/__init__.py` namespace for internal plugins
