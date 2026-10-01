"""
Tests for autopilot module.

Tests the autopilot engine, risk manager, and strategy selector.
"""

import pytest
from datetime import datetime
from momento_core.autopilot.models import (
    AutopilotConfig,
    AutopilotDecision,
    AutopilotStatus,
    RiskLevel,
)
from momento_core.autopilot.engine import AutopilotEngine
from momento_core.autopilot.risk_manager import RiskManager
from momento_core.autopilot.strategy_selector import StrategySelector


class TestAutopilotConfig:
    """Test autopilot configuration validation."""
    
    def test_default_config(self):
        """Test default configuration creation."""
        config = AutopilotConfig()
        assert config.max_risk_per_round == 0.02
        assert config.daily_loss_limit == 0.10
        assert config.max_consecutive_losses == 5
        assert config.min_confidence_threshold == 0.75
    
    def test_config_validation_valid(self):
        """Test configuration validation with valid parameters."""
        config = AutopilotConfig(
            max_risk_per_round=0.05,
            daily_loss_limit=0.20,
            min_confidence_threshold=0.80
        )
        assert config.validate() is True
    
    def test_config_validation_invalid_risk(self):
        """Test configuration validation with invalid risk parameters."""
        config = AutopilotConfig(max_risk_per_round=0.15)  # Too high
        with pytest.raises(ValueError, match="max_risk_per_round"):
            config.validate()
    
    def test_config_validation_invalid_confidence(self):
        """Test configuration validation with invalid confidence threshold."""
        config = AutopilotConfig(min_confidence_threshold=1.5)  # Too high
        with pytest.raises(ValueError, match="min_confidence_threshold"):
            config.validate()


class TestRiskManager:
    """Test risk management functionality."""
    
    def test_risk_manager_initialization(self):
        """Test risk manager initialization."""
        config = AutopilotConfig()
        risk_manager = RiskManager(config)
        assert risk_manager.daily_pnl == 0.0
        assert risk_manager.consecutive_losses == 0
    
    def test_position_size_calculation_fixed(self):
        """Test position size calculation with fixed method."""
        config = AutopilotConfig(position_sizing_method="fixed", base_position_size=2.0)
        risk_manager = RiskManager(config)
        size = risk_manager.calculate_position_size(0.8, {"position_risk_pct": 0.02})
        assert size == 2.0
    
    def test_position_size_calculation_percentage(self):
        """Test position size calculation with percentage method."""
        config = AutopilotConfig(
            position_sizing_method="percentage",
            base_position_size=1.0,
            max_risk_per_round=0.02
        )
        risk_manager = RiskManager(config)
        size = risk_manager.calculate_position_size(0.8, {"position_risk_pct": 0.02})
        assert size <= 1.0
    
    def test_check_risk_limits_within_limits(self):
        """Test risk limit check when within limits."""
        config = AutopilotConfig()
        risk_manager = RiskManager(config)
        assert risk_manager.check_risk_limits() is True
    
    def test_check_risk_limits_exceeded(self):
        """Test risk limit check when limits exceeded."""
        config = AutopilotConfig(daily_loss_limit=0.10)
        risk_manager = RiskManager(config)
        risk_manager.daily_pnl = -0.15  # Exceeds daily loss limit
        assert risk_manager.check_risk_limits() is False
    
    def test_should_stop_trading_daily_loss(self):
        """Test stop trading condition due to daily loss."""
        config = AutopilotConfig(daily_loss_limit=0.10)
        risk_manager = RiskManager(config)
        risk_manager.daily_pnl = -0.12
        should_stop, reason = risk_manager.should_stop_trading()
        assert should_stop is True
        assert "Daily loss limit" in reason
    
    def test_should_stop_trading_consecutive_losses(self):
        """Test stop trading condition due to consecutive losses."""
        config = AutopilotConfig(max_consecutive_losses=5)
        risk_manager = RiskManager(config)
        risk_manager.consecutive_losses = 5
        should_stop, reason = risk_manager.should_stop_trading()
        assert should_stop is True
        assert "Consecutive losses" in reason
    
    def test_update_daily_pnl_profit(self):
        """Test daily P&L update with profit."""
        config = AutopilotConfig()
        risk_manager = RiskManager(config)
        risk_manager.update_daily_pnl(0.05)
        assert risk_manager.daily_pnl == 0.05
        assert risk_manager.consecutive_losses == 0
    
    def test_update_daily_pnl_loss(self):
        """Test daily P&L update with loss."""
        config = AutopilotConfig()
        risk_manager = RiskManager(config)
        risk_manager.update_daily_pnl(-0.03)
        assert risk_manager.daily_pnl == -0.03
        assert risk_manager.consecutive_losses == 1


class TestStrategySelector:
    """Test strategy selection functionality."""
    
    def test_strategy_selector_initialization(self):
        """Test strategy selector initialization."""
        config = AutopilotConfig()
        selector = StrategySelector(config)
        assert selector.config == config
    
    def test_select_strategy_no_signals(self):
        """Test strategy selection with no signals."""
        config = AutopilotConfig()
        selector = StrategySelector(config)
        decision = selector.select_strategy()
        assert decision.selected_strategy in ["conservative", "balanced", "aggressive"]
        assert 0 <= decision.confidence <= 1
    
    def test_calculate_strategy_confidence_no_signals(self):
        """Test confidence calculation with no signals."""
        config = AutopilotConfig()
        selector = StrategySelector(config)
        confidence = selector.calculate_strategy_confidence([])
        assert confidence == 0.0


class TestAutopilotEngine:
    """Test autopilot engine functionality."""
    
    def test_engine_initialization(self):
        """Test autopilot engine initialization."""
        config = AutopilotConfig()
        engine = AutopilotEngine(config)
        assert engine.is_active is False
        assert engine.current_position is None
        assert engine.total_trades == 0
    
    def test_activate_autopilot(self):
        """Test autopilot activation."""
        config = AutopilotConfig()
        engine = AutopilotEngine(config)
        engine.activate_autopilot()
        assert engine.is_active is True
    
    def test_deactivate_autopilot(self):
        """Test autopilot deactivation."""
        config = AutopilotConfig()
        engine = AutopilotEngine(config)
        engine.activate_autopilot()
        engine.deactivate_autopilot()
        assert engine.is_active is False
    
    def test_process_round_inactive(self):
        """Test round processing when autopilot is inactive."""
        config = AutopilotConfig()
        engine = AutopilotEngine(config)
        round_data = {"round_id": "test-1", "multiplier": 1.5}
        with pytest.raises(RuntimeError, match="not active"):
            engine.process_round(round_data)
    
    def test_process_round_active(self):
        """Test round processing when autopilot is active."""
        config = AutopilotConfig(min_confidence_threshold=0.5)
        engine = AutopilotEngine(config)
        engine.activate_autopilot()
        round_data = {
            "round_id": "test-1",
            "multiplier": 1.5,
            "timestamp": datetime.utcnow().isoformat()
        }
        decision = engine.process_round(round_data)
        assert decision.round_id == "test-1"
        assert decision.action in ["enter", "exit", "hold", "skip"]
        assert 0 <= decision.confidence <= 1
    
    def test_get_status(self):
        """Test getting autopilot status."""
        config = AutopilotConfig()
        engine = AutopilotEngine(config)
        status = engine.get_status()
        assert isinstance(status, AutopilotStatus)
        assert status.is_active is False
        assert status.total_trades == 0
    
    def test_get_status_active(self):
        """Test getting autopilot status when active."""
        config = AutopilotConfig()
        engine = AutopilotEngine(config)
        engine.activate_autopilot()
        status = engine.get_status()
        assert status.is_active is True
    
    def test_update_config(self):
        """Test updating autopilot configuration."""
        config = AutopilotConfig()
        engine = AutopilotEngine(config)
        new_config = AutopilotConfig(max_risk_per_round=0.05)
        engine.update_config(new_config)
        assert engine.config.max_risk_per_round == 0.05
    
    def test_get_recent_decisions_empty(self):
        """Test getting recent decisions when none exist."""
        config = AutopilotConfig()
        engine = AutopilotEngine(config)
        decisions = engine.get_recent_decisions(10)
        assert decisions == []
    
    def test_get_recent_decisions_with_data(self):
        """Test getting recent decisions with data."""
        config = AutopilotConfig(min_confidence_threshold=0.5)
        engine = AutopilotEngine(config)
        engine.activate_autopilot()
        
        # Process some rounds
        for i in range(5):
            round_data = {
                "round_id": f"test-{i}",
                "multiplier": 1.5 + i * 0.1,
                "timestamp": datetime.utcnow().isoformat()
            }
            engine.process_round(round_data)
        
        decisions = engine.get_recent_decisions(10)
        assert len(decisions) == 5
    
    def test_record_trade_result(self):
        """Test recording trade results."""
        config = AutopilotConfig()
        engine = AutopilotEngine(config)
        engine.record_trade_result("test-1", 0.05)
        assert engine.total_trades == 1
        assert engine.winning_trades == 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
