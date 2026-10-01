# Momento Core Plugin Receiver Specification

## Purpose

Define the pluggable receiver architecture for `momento_core` to support external plugin packages that can bring:

- UI contributions
- prediction engines
- signal generators
- dashboard widgets
- runtime settings and configuration

This spec documents the receiver design, plugin manifest, extension points, discovery model, and integration with the existing core architecture.

## Scope

Applicable to:

- `core/momento_core/plug_n_play`
- `core/momento_core/plugins`
- `core/momento_core/api`
- plugin-enabled dashboards and services

## Requirements

1. **Core stability**: Core remains stable; plugins add behavior through documented extension points.
2. **Explicit plugin contracts**: Every plugin must declare its capabilities and entrypoint via a manifest.
3. **Discovery & lifecycle**: The receiver must discover, validate, initialize, and manage plugins.
4. **Scoped runtime context**: Plugins receive a limited `PluginContext` rather than direct core internals.
5. **Multiple plugin categories**: UI, prediction, signal, widget, and settings.
6. **Runtime control**: Enable/disable plugins and expose health/status.
7. **Manifest validation**: Validate plugin metadata on load.
8. **No direct database writes**: Plugins write through service APIs or core-managed tables.

## Architecture Overview

```
Core App
  ├─ API Routes
  │   ├─ /api/v1/plugins
  │   ├─ /api/v1/ingest
  │   └─ /api/v1/forecasts
  ├─ Service Layer
  │   ├─ IngestService
  │   ├─ ForecastService
  │   ├─ PluginService
  │   └─ SignalService
  ├─ Plug-n-Play Receiver
  │   ├─ PluginManager
  │   ├─ PluginContext
  │   ├─ PluginManifest
  │   ├─ BasePlugin
  │   └─ plugin registry
  └─ Plugins
      ├─ ui_plugin
      ├─ prediction_plugin
      ├─ signal_plugin
      └─ settings_plugin
```

## Plugin Manifest

A plugin manifest defines the metadata and capabilities for each plugin.

### Manifest schema

- `name` (string) - unique plugin name
- `version` (string) - semantic version
- `author` (string)
- `description` (string)
- `plugin_type` (string) - one of `ui`, `prediction`, `signal`, `widget`, `settings`, `hybrid`
- `entrypoint` (string) - importable module path
- `enabled` (boolean)
- `capabilities` (array of strings)
- `settings_schema` (object, optional)
- `dependencies` (array of strings, optional)

### Example

```json
{
  "name": "simple-signal-plugin",
  "version": "0.1.0",
  "author": "Momento Team",
  "description": "Detects custom streak signals from collected events.",
  "plugin_type": "signal",
  "entrypoint": "momento_core.plugins.simple_signal",
  "enabled": true,
  "capabilities": ["signal_evaluation"],
  "settings_schema": {
    "threshold": {"type": "number", "default": 5},
    "window_size": {"type": "integer", "default": 12}
  }
}
```

## Plugin Interfaces

### `BasePlugin`

- `initialize(context)`
- `shutdown()`
- `health()`
- `capabilities()`

### UIPlugin

- `ui_payload()` returns dashboard metadata

### PredictionPlugin

- `predict(payload)` returns forecast result data

### SignalPlugin

- `evaluate(event)` returns signal output

### WidgetPlugin

- `widget_manifest()` returns widget metadata

### SettingsPlugin

- `settings_manifest()` returns schema/defaults

## Plugin Discovery

### Sources

- Python entry points group `momento_core.plugins`
- Internal namespace package `momento_core.plugins`
- External directory configured via `MOMENTO_PLUGIN_PATH`

### Discovery process

1. Enumerate entry points.
2. Enumerate internal namespace packages.
3. Enumerate configured plugin folder files.
4. Validate plugin manifest metadata.
5. Load plugin module and instantiate plugin class.
6. Initialize with `PluginContext`.

## Plugin Lifecycle

### Load

- Discover plugin
- Validate manifest
- Import entrypoint module
- Instantiate `Plugin` class
- Call `initialize(context)`
- Register plugin in registry

### Run

- Plugin contributes capabilities to core flows
- Core routes and services can query plugin metadata and health
- Prediction plugins can be invoked by forecast orchestration
- Signal plugins can be invoked by analysis/event pipelines
- UI/widget plugins can be surfaced to dashboard clients

### Unload

- Call `shutdown()`
- Remove from registry
- Persist disabled state if configured

## Integration Points

### API

Add plugin management endpoints under `/api/v1/plugins`:

- `GET /api/v1/plugins`
- `GET /api/v1/plugins/{name}`
- `POST /api/v1/plugins/{name}/enable`
- `POST /api/v1/plugins/{name}/disable`
- `GET /api/v1/plugins/{name}/health`
- `GET /api/v1/plugins/ui`

### Dashboard

- Use plugin UI metadata to render dynamic widgets and panels
- Expose plugin settings to dashboard settings UI

### Forecast Engine

- Register prediction plugins with forecast routing
- Allow forecast pipeline to select plugin by `predictor_id`
- Persist plugin-generated predictions in forecast store

### Signal Engine

- Call signal plugins from analysis or event processing
- Store plugin signal outputs in a dedicated `plugin_signals` table
- Publish plugin signal metadata to dashboards

## Runtime Config

### Environment variables

- `MOMENTO_PLUGIN_PATH` - external plugin directory
- `MOMENTO_PLUGIN_DISCOVERY` - `entrypoints|namespace|path|all`
- `MOMENTO_PLUGIN_ENABLED` - comma-separated plugin names enabled by default

### Settings store

- Plugin settings are stored in core configuration
- Settings manifest exposes schema and defaults
- Settings UI retrieves plugin settings from plugin API

## Security and Governance

- Validate plugin manifest strictly
- Restrict plugin capabilities to defined categories
- Isolate plugin failures from core
- Log plugin errors and load failures
- Avoid arbitrary execution unless plugin is explicitly trusted

## Examples of Plugin Uses

### UI Plugin

- adds a custom dashboard panel for plugin-specific visualizations
- provides `ui.payload()` metadata and render hints

### Prediction Plugin

- adds a new forecast algorithm
- receives historical event payloads
- returns predictions with confidence intervals

### Signal Plugin

- evaluates incoming event streams
- produces named signals and severity levels
- can be used by strategy or alerting systems

### Widget Plugin

- exposes dashboard widget metadata
- provides `widget_manifest()` and data schema

### Settings Plugin

- exposes runtime configuration to the dashboard
- provides settings schema and defaults

## Implementation Guidance

- Prefer metadata-driven registration rather than ad-hoc plugin code.
- Keep the plugin host lightweight and focused on orchestration.
- Use `PluginContext` to prevent direct access to internal core models.
- Store plugin metadata and health for observability.

## Next Steps

1. Add plugin API routes and service support.
2. Add plugin manifest validation.
3. Implement sample plugins in `core/momento_core/plugins/`.
4. Wire prediction and signal plugin hooks into forecast and analysis flows.
5. Build dashboard integration for plugin UI metadata.
