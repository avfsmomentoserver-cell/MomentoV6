from __future__ import annotations

import importlib
import importlib.metadata
import os
import pkgutil
from typing import Any, Dict, List, Optional, Type

from momento_core.plug_n_play.interfaces import BasePlugin, PluginContext, PluginManifest


class PluginManager:
    """Manages discovery, loading, and lifecycle of Momento Core plugins."""

    def __init__(self, config: Dict[str, Any], logger: Any) -> None:
        self.config = config
        self.logger = logger
        self.plugins: List[BasePlugin] = []
        self.plugin_registry: Dict[str, BasePlugin] = {}

    def discover_plugins(self) -> List[str]:
        """Discover available plugin entry points and internal plugin packages."""
        discovered: List[str] = []

        # Discover plugins registered as Python entry points
        for entry_point in importlib.metadata.entry_points(group='momento_core.plugins'):
            discovered.append(entry_point.value)

        # Discover internal plugin packages under the momento_core.plugins namespace
        for finder, name, ispkg in pkgutil.iter_modules(importlib.import_module('momento_core.plugins').__path__):
            if ispkg:
                discovered.append(f'momento_core.plugins.{name}')

        # Discover plugins from configured external plugin path
        plugin_path = os.getenv('MOMENTO_PLUGIN_PATH')
        if plugin_path and os.path.isdir(plugin_path):
            for item in os.listdir(plugin_path):
                if item.endswith('.py') or os.path.isdir(os.path.join(plugin_path, item)):
                    discovered.append(os.path.splitext(item)[0])

        return discovered

    def load_plugin(self, entrypoint: str, plugin_manifest: PluginManifest) -> Optional[BasePlugin]:
        """Load a plugin by entrypoint and validate its manifest."""
        try:
            module = importlib.import_module(entrypoint)
            plugin_class = getattr(module, 'Plugin', None)
            if not plugin_class or not issubclass(plugin_class, BasePlugin):
                self.logger.warning(f'Plugin entrypoint {entrypoint} does not expose a BasePlugin subclass')
                return None

            plugin = plugin_class(plugin_manifest)
            context = PluginContext(
                config=self.config,
                logger=self.logger,
                service_registry={},
                plugin_settings={}
            )
            plugin.initialize(context)
            self.register_plugin(plugin)
            return plugin
        except Exception as exc:
            self.logger.error(f'Failed to load plugin {entrypoint}: {exc}')
            return None

    def register_plugin(self, plugin: BasePlugin) -> None:
        """Register a loaded plugin and make it available to the core."""
        self.plugins.append(plugin)
        self.plugin_registry[plugin.manifest.name] = plugin
        self.logger.info(f'Registered plugin: {plugin.manifest.name}')

    def unload_plugin(self, name: str) -> None:
        """Unload a plugin by name."""
        plugin = self.plugin_registry.pop(name, None)
        if plugin:
            plugin.shutdown()
            self.plugins.remove(plugin)
            self.logger.info(f'Unloaded plugin: {name}')

    def plugin_health(self) -> List[Dict[str, Any]]:
        """Return health status for all loaded plugins."""
        return [plugin.health() for plugin in self.plugins]

    def get_plugin(self, name: str) -> Optional[BasePlugin]:
        return self.plugin_registry.get(name)

    def plugin_manifests(self) -> List[Dict[str, Any]]:
        return [plugin.manifest.__dict__ for plugin in self.plugins]
