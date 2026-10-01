"""
Plugin Inventory API routes

Provides endpoints for managing and monitoring analysis plugins.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Dict, Any, List, Optional
from datetime import datetime

from momento_core.db.session import get_db_session

router = APIRouter()

# Mock plugin database (in production, this would be in the database)
_plugin_db = {
    "collapse-ceiling-analyzer": {
        "id": "collapse-ceiling-analyzer",
        "name": "Collapse Ceiling Analyzer",
        "version": "1.0.0",
        "author": "Momento Core",
        "description": "Analyzes collapse ceilings and ascend power with ceiling direction detection",
        "category": "analysis",
        "status": "active",
        "enabled": True,
        "config": {
            "window_size": 50,
            "ceiling_threshold": 0.8
        },
        "last_used": datetime.utcnow().isoformat(),
        "performance": {
            "accuracy": 0.82,
            "processing_time": 15,
            "signal_count": 24
        }
    },
    "gap-swing-analyzer": {
        "id": "gap-swing-analyzer",
        "name": "Gap Swing Analyzer",
        "version": "1.0.0",
        "author": "Momento Core",
        "description": "Calculates swing across gaps using moving averages with repeat testing",
        "category": "analysis",
        "status": "active",
        "enabled": True,
        "config": {
            "ma_periods": [10, 50, 100, 200],
            "gap_levels": [10.0, 100.0],
            "repeat_test_iterations": 5
        },
        "last_used": datetime.utcnow().isoformat(),
        "performance": {
            "accuracy": 0.78,
            "processing_time": 22,
            "signal_count": 31
        }
    },
    "signal-hunter-pro": {
        "id": "signal-hunter-pro",
        "name": "Signal Hunter Pro",
        "version": "2.1.0",
        "author": "Momento Core",
        "description": "Advanced signal detection with multiple strategies",
        "category": "signal",
        "status": "active",
        "enabled": True,
        "config": {
            "enable_momentum": True,
            "enable_reversion": True,
            "min_confidence": 0.7
        },
        "last_used": datetime.utcnow().isoformat(),
        "performance": {
            "accuracy": 0.75,
            "processing_time": 18,
            "signal_count": 156
        }
    },
    "crash-prediction-engine": {
        "id": "crash-prediction-engine",
        "name": "Crash Prediction Engine",
        "version": "3.0.0",
        "author": "Momento Core",
        "description": "Core prediction engine with multi-factor analysis",
        "category": "prediction",
        "status": "active",
        "enabled": True,
        "config": {
            "momentum_weight": 0.3,
            "reversion_weight": 0.25,
            "pattern_weight": 0.25,
            "linguistic_weight": 0.2
        },
        "last_used": datetime.utcnow().isoformat(),
        "performance": {
            "accuracy": 0.72,
            "processing_time": 89,
            "signal_count": 1247
        }
    },
    "momento-linguistics": {
        "id": "momento-linguistics",
        "name": "Momento Linguistics",
        "version": "1.5.0",
        "author": "Momento Core",
        "description": "Linguistic analysis and classification system",
        "category": "analysis",
        "status": "active",
        "enabled": True,
        "config": {
            "enable_linguistic_analysis": True,
            "enable_reverse_linguistics": True
        },
        "last_used": datetime.utcnow().isoformat(),
        "performance": {
            "accuracy": 0.68,
            "processing_time": 12,
            "signal_count": 89
        }
    },
    "orchestrator-engine": {
        "id": "orchestrator-engine",
        "name": "Decision Orchestrator",
        "version": "2.0.0",
        "author": "Momento Core",
        "description": "Automated decision execution and guidance system",
        "category": "orchestrator",
        "status": "active",
        "enabled": True,
        "config": {
            "risk_tolerance": "moderate",
            "base_bet": 1.0
        },
        "last_used": datetime.utcnow().isoformat(),
        "performance": {
            "accuracy": 0.85,
            "processing_time": 45,
            "signal_count": 67
        }
    }
}


@router.get("/inventory/plugins")
def get_all_plugins(db: Session = Depends(get_db_session)) -> Dict[str, Any]:
    """
    Get all registered plugins.
    
    Returns:
        Dict with list of all plugins and their status
    """
    try:
        plugins = list(_plugin_db.values())
        return {
            "plugins": plugins,
            "total_count": len(plugins),
            "active_count": sum(1 for p in plugins if p["status"] == "active"),
            "enabled_count": sum(1 for p in plugins if p["enabled"])
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get plugins: {str(e)}")


@router.get("/inventory/plugins/{plugin_id}")
def get_plugin(plugin_id: str, db: Session = Depends(get_db_session)) -> Dict[str, Any]:
    """
    Get specific plugin details.
    
    Args:
        plugin_id: ID of the plugin to retrieve
        
    Returns:
        Dict with plugin details
    """
    try:
        if plugin_id not in _plugin_db:
            raise HTTPException(status_code=404, detail=f"Plugin {plugin_id} not found")
        
        return _plugin_db[plugin_id]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get plugin: {str(e)}")


@router.post("/inventory/plugins/{plugin_id}/toggle")
def toggle_plugin(plugin_id: str, db: Session = Depends(get_db_session)) -> Dict[str, Any]:
    """
    Toggle plugin enabled/disabled status.
    
    Args:
        plugin_id: ID of the plugin to toggle
        
    Returns:
        Dict with updated plugin status
    """
    try:
        if plugin_id not in _plugin_db:
            raise HTTPException(status_code=404, detail=f"Plugin {plugin_id} not found")
        
        plugin = _plugin_db[plugin_id]
        plugin["enabled"] = not plugin["enabled"]
        plugin["status"] = "active" if plugin["enabled"] else "inactive"
        plugin["last_used"] = datetime.utcnow().isoformat()
        
        return {
            "status": "success",
            "message": f"Plugin {plugin_id} {'enabled' if plugin['enabled'] else 'disabled'}",
            "plugin": plugin
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to toggle plugin: {str(e)}")


@router.put("/inventory/plugins/{plugin_id}/config")
def update_plugin_config(
    plugin_id: str,
    config: Dict[str, Any],
    db: Session = Depends(get_db_session)
) -> Dict[str, Any]:
    """
    Update plugin configuration.
    
    Args:
        plugin_id: ID of the plugin to configure
        config: New configuration parameters
        
    Returns:
        Dict with updated plugin configuration
    """
    try:
        if plugin_id not in _plugin_db:
            raise HTTPException(status_code=404, detail=f"Plugin {plugin_id} not found")
        
        plugin = _plugin_db[plugin_id]
        plugin["config"].update(config)
        plugin["last_used"] = datetime.utcnow().isoformat()
        
        return {
            "status": "success",
            "message": f"Plugin {plugin_id} configuration updated",
            "plugin": plugin
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update plugin config: {str(e)}")


@router.get("/inventory/statistics")
def get_inventory_statistics(db: Session = Depends(get_db_session)) -> Dict[str, Any]:
    """
    Get overall inventory statistics.
    
    Returns:
        Dict with inventory statistics
    """
    try:
        plugins = list(_plugin_db.values())
        
        # Calculate statistics
        total_plugins = len(plugins)
        active_plugins = sum(1 for p in plugins if p["status"] == "active")
        enabled_plugins = sum(1 for p in plugins if p["enabled"])
        
        # Calculate category breakdown
        categories = {}
        for plugin in plugins:
            category = plugin["category"]
            categories[category] = categories.get(category, 0) + 1
        
        # Calculate average performance
        avg_accuracy = sum(p["performance"]["accuracy"] for p in plugins) / total_plugins if total_plugins > 0 else 0
        avg_processing_time = sum(p["performance"]["processing_time"] for p in plugins) / total_plugins if total_plugins > 0 else 0
        total_signals = sum(p["performance"]["signal_count"] for p in plugins)
        
        return {
            "total_plugins": total_plugins,
            "active_plugins": active_plugins,
            "enabled_plugins": enabled_plugins,
            "category_breakdown": categories,
            "average_accuracy": avg_accuracy,
            "average_processing_time": avg_processing_time,
            "total_signals_generated": total_signals
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get statistics: {str(e)}")