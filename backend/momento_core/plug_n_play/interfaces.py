from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class PluginManifest:
    """Metadata describing a pluggable Momento Core plugin."""

    name: str
    version: str
    author: str
    description: str
    plugin_type: str
    entrypoint: str
    enabled: bool = True
    capabilities: List[str] = field(default_factory=list)
    settings_schema: Optional[Dict[str, Any]] = None
    dependencies: List[str] = field(default_factory=list)


class PluginContext:
    """Runtime context provided to plugins by the receiver."""

    def __init__(
        self,
        config: Dict[str, Any],
        logger: Any,
        service_registry: Dict[str, Any],
        plugin_settings: Dict[str, Any],
    ) -> None:
        self.config = config
        self.logger = logger
        self.services = service_registry
        self.settings = plugin_settings

    def get_service(self, name: str) -> Any:
        return self.services.get(name)

    def get_setting(self, key: str, default: Any = None) -> Any:
        return self.settings.get(key, default)


class BasePlugin(ABC):
    """Base plugin contract for Momento Core plugins."""

    manifest: PluginManifest

    def __init__(self, manifest: PluginManifest) -> None:
        self.manifest = manifest

    @abstractmethod
    def initialize(self, context: PluginContext) -> None:
        """Initialize the plugin with the provided runtime context."""

    def shutdown(self) -> None:
        """Clean up plugin resources before shutdown."""
        return None

    def health(self) -> Dict[str, Any]:
        """Return plugin health/state information."""
        return {
            "name": self.manifest.name,
            "version": self.manifest.version,
            "enabled": self.manifest.enabled,
            "status": "ok",
        }

    def capabilities(self) -> List[str]:
        """Return a list of plugin capabilities."""
        return self.manifest.capabilities


class UIPlugin(BasePlugin):
    """Plugin type for UI contributions."""

    @abstractmethod
    def ui_payload(self) -> Dict[str, Any]:
        """Return UI metadata to be consumed by the dashboard."""


class PredictionPlugin(BasePlugin):
    """Plugin type for prediction and forecast contributions."""

    @abstractmethod
    def predict(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Run a prediction using plugin logic."""


class SignalPlugin(BasePlugin):
    """Plugin type for signal generation."""

    @abstractmethod
    def evaluate(self, event: Dict[str, Any]) -> Dict[str, Any]:
        """Evaluate a signal from incoming event data."""


class WidgetPlugin(BasePlugin):
    """Plugin type for dashboard widgets."""

    @abstractmethod
    def widget_manifest(self) -> Dict[str, Any]:
        """Return widget metadata and configuration."""


class SettingsPlugin(BasePlugin):
    """Plugin type for runtime settings."""

    @abstractmethod
    def settings_manifest(self) -> Dict[str, Any]:
        """Return runtime settings schema and defaults."""
