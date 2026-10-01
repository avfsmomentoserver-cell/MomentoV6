"""Momento Core plug-and-play receiver package.

This package provides a plugin host for loading and managing extension plugins
that can contribute UI, prediction, signal, widget, and settings capabilities.
"""

from momento_core.plug_n_play.manager import PluginManager
from momento_core.plug_n_play.interfaces import BasePlugin, PluginContext, PluginManifest

__all__ = [
    "PluginManager",
    "BasePlugin",
    "PluginContext",
    "PluginManifest",
]
