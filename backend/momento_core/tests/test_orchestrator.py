"""
Tests for the Decision Orchestrator layer.

Tests all orchestrator components including the main engine,
sub-engines, and API integration.
"""

import pytest
from sqlalchemy.orm import Session
from unittest.mock import Mock, MagicMock

from momento_core.orchestrator.orchestrator_engine import OrchestratorEngine
from momento_core.orchestrator.execution_planner import ExecutionPlanner
from momento_core.orchestrator.risk_manager import RiskManager
from momento_core.orchestrator.bankroll_manager import BankrollManager
from momento_core.orchestrator.session_manager import SessionManager
from momento_core.orchestrator.patience_engine import PatienceEngine
from momento_core.orchestrator.speed_engine import SpeedEngine
from momento_core.orchestrator.mistake_prevention_engine import MistakePreventionEngine
from momento_core.orchestrator.instruction_generator import InstructionGenerator
from momento_core.orchestrator.models import (
    ExecutionPlan,
    ActionType,
    RiskLevel,
    BetSlot,
)


@pytest.fixture
def mock_db():
    """Create a mock database session."""
    db = Mock(spec=Session)
    return db


@pytest.fixture
def sample_forecast_data():
    """Sample forecast data for testing."""
    return {
        "confidence_level": 0.75,
        "probability": 0.68,
        "phase": "expansion",
        "volatility": 0.45,
        "eta_rounds": 5
    }


@pytest.fixture
def sample_session_config():
    """Sample session configuration for testing."""
    return {
        "session_id": "test_session_123",
        "user_id": "test_user",
        "starting_balance": 100.0,
        "current_balance": 100.0,
        "daily_target": 15.0,
        "max_loss": 30.0,
        "risk_profile": "moderate",
        "max_stake_percent": 5.0,
        "min_confidence_threshold": 0.65,
        "max_patience_rounds": 20
    }


class TestExecutionPlanner:
    """Tests for ExecutionPlanner."""
    
    def test_create_wait_plan(self, mock_db, sample_forecast_data, sample_session_config):
        """Test creating a wait execution plan."""
        planner = ExecutionPlanner(mock_db)
        
        # Modify forecast to trigger wait
        sample_forecast_data["confidence_level"] = 0.55
        sample_forecast_data["probability"] = 0.40
        
        plan = planner.create_plan(sample_forecast_data, sample_session_config)
        
        assert plan.action == ActionType.WAIT
        assert plan.estimated_wait_rounds is not None
        assert plan.estimated_wait_rounds > 0
        assert plan.reason is not None
    
    def test_create_play_plan(self, mock_db, sample_forecast_data, sample_session_config):
        """Test creating a play execution plan."""
        planner = ExecutionPlanner(mock_db)
        
        plan = planner.create_plan(sample_forecast_data, sample_session_config)
        
        assert plan.action == ActionType.PLAY
        assert plan.round_window_start is not None
        assert plan.round_window_end is not None
        assert plan.bet_slots is not None
        assert len(plan.bet_slots) > 0
        assert plan.maximum_attempts is not None
    
    def test_bet_slots_conservative(self, mock_db, sample_forecast_data, sample_session_config):
        """Test bet slot calculation for conservative profile."""
        planner = ExecutionPlanner(mock_db)
        sample_session_config["risk_profile"] = "conservative"
        
        plan = planner.create_plan(sample_forecast_data, sample_session_config)
        
        assert len(plan.bet_slots) == 1
        assert plan.bet_slots[0].priority == "high"
    
    def test_bet_slots_aggressive(self, mock_db, sample_forecast_data, sample_session_config):
        """Test bet slot calculation for aggressive profile."""
        planner = ExecutionPlanner(mock_db)
        sample_session_config["risk_profile"] = "aggressive"
        
        plan = planner.create_plan(sample_forecast_data, sample_session_config)
        
        assert len(plan.bet_slots) == 3
        assert any(slot.priority == "low" for slot in plan.bet_slots)


class TestRiskManager:
    """Tests for RiskManager."""
    
    def test_risk_assessment_calculation(self, mock_db, sample_forecast_data, sample_session_config):
        """Test comprehensive risk assessment."""
        manager = RiskManager(mock_db)
        
        # Create a mock execution plan
        execution_plan = ExecutionPlan(
            action=ActionType.PLAY,
            confidence=0.75,
            reason="Test"
        )
        
        assessment = manager.assess_risk(sample_forecast_data, execution_plan, sample_session_config)
        
        assert 0 <= assessment.risk_score <= 100
        assert assessment.risk_level in RiskLevel
        assert len(assessment.factors) > 0
        assert assessment.recommendation is not None
    
    def test_low_confidence_risk(self, mock_db):
        """Test risk calculation with low confidence."""
        manager = RiskManager(mock_db)
        
        forecast_data = {"confidence_level": 0.3}
        risk = manager._calculate_confidence_risk(forecast_data)
        
        assert risk > 50  # High risk for low confidence
    
    def test_high_volatility_risk(self, mock_db):
        """Test risk calculation with high volatility."""
        manager = RiskManager(mock_db)
        
        forecast_data = {"volatility": 0.9}
        risk = manager._calculate_volatility_risk(forecast_data)
        
        assert risk > 70  # High risk for high volatility


class TestBankrollManager:
    """Tests for BankrollManager."""
    
    def test_bankroll_state_calculation(self, mock_db, sample_session_config):
        """Test bankroll state calculation."""
        manager = BankrollManager(mock_db)
        
        state = manager.get_state(sample_session_config)
        
        assert state.starting_balance == 100.0
        assert state.current_balance == 100.0
        assert state.current_profit == 0.0
        assert state.drawdown_amount == 0.0
    
    def test_profit_calculation(self, mock_db, sample_session_config):
        """Test profit calculation with positive balance."""
        manager = BankrollManager(mock_db)
        sample_session_config["current_balance"] = 120.0
        
        state = manager.get_state(sample_session_config)
        
        assert state.current_profit == 20.0
        assert state.peak_balance == 120.0
    
    def test_loss_calculation(self, mock_db, sample_session_config):
        """Test loss calculation with negative balance."""
        manager = BankrollManager(mock_db)
        sample_session_config["current_balance"] = 85.0
        
        state = manager.get_state(sample_session_config)
        
        assert state.current_profit == -15.0
        assert state.drawdown_amount == 15.0
    
    def test_daily_target_progress(self, mock_db, sample_session_config):
        """Test daily target progress calculation."""
        manager = BankrollManager(mock_db)
        sample_session_config["current_balance"] = 115.0
        
        state = manager.get_state(sample_session_config)
        
        assert state.daily_target_progress is not None
        assert state.daily_target_progress >= 100  # 15 profit on 15 target = exactly reached
    
    def test_limit_checking(self, mock_db, sample_session_config):
        """Test limit checking."""
        manager = BankrollManager(mock_db)
        sample_session_config["current_balance"] = 115.0
        
        state = manager.get_state(sample_session_config)
        limits = manager.check_limits(state)
        
        assert limits["daily_target_reached"] == True
        assert limits["should_stop"] == True


class TestSessionManager:
    """Tests for SessionManager."""
    
    def test_session_start(self, mock_db, sample_session_config):
        """Test starting a new session."""
        manager = SessionManager(mock_db)
        
        status = manager.start_session(sample_session_config)
        
        assert status.state.value == "active"
        assert status.rounds_played == 0
        assert status.rounds_waited == 0
    
    def test_session_update_with_limits_reached(self, mock_db, sample_session_config):
        """Test session update when limits are reached."""
        manager = SessionManager(mock_db)
        
        # Mock execution plan and risk assessment
        execution_plan = ExecutionPlan(action=ActionType.PLAY, confidence=0.75, reason="Test")
        risk_assessment = MagicMock()
        risk_assessment.risk_level.value = "excellent"
        
        # Set balance to exceed daily target
        sample_session_config["current_balance"] = 120.0
        
        bankroll_manager = BankrollManager(mock_db)
        bankroll_state = bankroll_manager.get_state(sample_session_config)
        
        status = manager.update_status(execution_plan, risk_assessment, bankroll_state, sample_session_config)
        
        assert status.state.value == "completed"
        assert status.recommendation == ActionType.STOP


class TestPatienceEngine:
    """Tests for PatienceEngine."""
    
    def test_patience_calculation(self, mock_db, sample_forecast_data):
        """Test patience state calculation."""
        engine = PatienceEngine(mock_db)
        
        execution_plan = ExecutionPlan(
            action=ActionType.WAIT,
            confidence=0.75,
            reason="Test",
            estimated_wait_rounds=7,
            required_probability=0.65
        )
        
        patience_state = engine.calculate_patience(execution_plan, sample_forecast_data)
        
        assert 0 <= patience_state.patience_percent <= 100
        assert patience_state.rounds_remaining == 7
        assert patience_state.message is not None
    
    def test_patience_message_generation(self, mock_db, sample_forecast_data):
        """Test patience message generation for different patience levels."""
        engine = PatienceEngine(mock_db)
        
        # High patience (long wait)
        execution_plan = ExecutionPlan(
            action=ActionType.WAIT,
            confidence=0.75,
            reason="Test",
            estimated_wait_rounds=15,
            required_probability=0.65
        )
        
        patience_state = engine.calculate_patience(execution_plan, sample_forecast_data)
        assert "Wait" in patience_state.message or "ready" in patience_state.message.lower()


class TestSpeedEngine:
    """Tests for SpeedEngine."""
    
    def test_speed_assessment_normal_market(self, mock_db):
        """Test speed assessment for normal market."""
        engine = SpeedEngine(mock_db)
        
        forecast_data = {
            "rounds_per_minute": 6.0,
            "volatility": 0.4,
            "noise_level": 0.3
        }
        
        assessment = engine.assess_speed(forecast_data)
        
        assert assessment.market_classification == "normal"
        assert "normal" in assessment.recommendation.lower()
    
    def test_speed_assessment_fast_market(self, mock_db):
        """Test speed assessment for fast market."""
        engine = SpeedEngine(mock_db)
        
        forecast_data = {
            "rounds_per_minute": 7.5,
            "volatility": 0.65,
            "noise_level": 0.5
        }
        
        assessment = engine.assess_speed(forecast_data)
        
        assert assessment.market_classification == "fast"
        assert "reduce" in assessment.recommendation.lower()
    
    def test_speed_assessment_chaotic_market(self, mock_db):
        """Test speed assessment for chaotic market."""
        engine = SpeedEngine(mock_db)
        
        forecast_data = {
            "rounds_per_minute": 9.0,
            "volatility": 0.8,
            "noise_level": 0.75
        }
        
        assessment = engine.assess_speed(forecast_data)
        
        assert assessment.market_classification == "chaotic"
        assert "skip" in assessment.recommendation.lower() or "chaotic" in assessment.recommendation.lower()


class TestMistakePreventionEngine:
    """Tests for MistakePreventionEngine."""
    
    def test_action_validation_valid(self, mock_db, sample_session_config):
        """Test validation of valid action."""
        engine = MistakePreventionEngine(mock_db)
        
        # Mock current state
        current_state = MagicMock()
        current_state.execution_plan.action = ActionType.PLAY
        current_state.execution_plan.confidence = 0.75
        current_state.execution_plan.bet_slots = [BetSlot(slot_id="A", amount=0.50, cashout_target=2.0, priority="high")]
        
        proposed_action = {"action": "play", "stake": 0.50}
        
        validation = engine.validate_action(proposed_action, current_state, sample_session_config)
        
        assert validation.action_valid == True
    
    def test_action_validation_early_entry(self, mock_db, sample_session_config):
        """Test validation of early entry attempt."""
        engine = MistakePreventionEngine(mock_db)
        
        # Mock current state with wait plan
        current_state = MagicMock()
        current_state.execution_plan.action = ActionType.WAIT
        current_state.execution_plan.confidence = 0.55
        
        proposed_action = {"action": "play"}
        
        validation = engine.validate_action(proposed_action, current_state, sample_session_config)
        
        assert validation.action_valid == False
        assert validation.warning_level in ["warning", "error"]
    
    def test_action_validation_over_stake(self, mock_db, sample_session_config):
        """Test validation of excessive stake."""
        engine = MistakePreventionEngine(mock_db)
        
        # Mock current state
        current_state = MagicMock()
        current_state.execution_plan.action = ActionType.PLAY
        current_state.execution_plan.confidence = 0.75
        current_state.execution_plan.bet_slots = [BetSlot(slot_id="A", amount=0.50, cashout_target=2.0, priority="high")]
        
        proposed_action = {"action": "play", "stake": 10.0}  # Way too high
        
        validation = engine.validate_action(proposed_action, current_state, sample_session_config)
        
        assert validation.warning_level in ["warning", "error"]
        assert validation.stake_increase_percent is not None
    
    def test_checklist_generation(self, mock_db, sample_session_config):
        """Test pre-action checklist generation."""
        engine = MistakePreventionEngine(mock_db)
        
        # Mock current state
        current_state = MagicMock()
        current_state.execution_plan.action = ActionType.PLAY
        current_state.execution_plan.confidence = 0.75
        current_state.bankroll_state.current_balance = 100.0
        current_state.session_status.state.value = "active"
        current_state.bankroll_state.remaining_loss_allowance = 20.0
        current_state.risk_assessment.risk_level.value = "good"
        
        checklist = engine.generate_checklist(current_state, sample_session_config)
        
        assert len(checklist.items) == 8  # 8 checklist items
        assert checklist.all_passed == True


class TestInstructionGenerator:
    """Tests for InstructionGenerator."""
    
    def test_wait_message_generation(self, mock_db, sample_forecast_data):
        """Test generation of wait instruction message."""
        generator = InstructionGenerator(mock_db)
        
        # Mock current state
        current_state = MagicMock()
        current_state.execution_plan.action = ActionType.WAIT
        current_state.execution_plan.reason = "Compression not finished"
        current_state.patience_state = MagicMock()
        current_state.patience_state.rounds_remaining = 5
        
        message = generator.generate_message(current_state)
        
        assert message.message_type == "guidance"
        assert message.content is not None
    
    def test_play_message_generation(self, mock_db):
        """Test generation of play instruction message."""
        generator = InstructionGenerator(mock_db)
        
        # Mock current state
        current_state = MagicMock()
        current_state.execution_plan.action = ActionType.PLAY
        current_state.execution_plan.maximum_attempts = 3
        
        message = generator.generate_message(current_state)
        
        assert message.message_type == "success"
    
    def test_plan_change_notification(self, mock_db):
        """Test plan change notification."""
        generator = InstructionGenerator(mock_db)
        
        old_plan = ExecutionPlan(action=ActionType.WAIT, confidence=0.55, reason="Old")
        new_plan = ExecutionPlan(action=ActionType.PLAY, confidence=0.75, reason="New")
        
        notification = generator.generate_plan_change_notification(old_plan, new_plan)
        
        assert notification.message_type == "info"
        assert "updated" in notification.content.lower()
    
    def test_discipline_feedback_positive(self, mock_db):
        """Test positive discipline feedback."""
        generator = InstructionGenerator(mock_db)
        
        feedback = generator.generate_discipline_feedback(
            action_taken="wait",
            recommended_action="wait",
            followed_plan=True
        )
        
        assert feedback.message_type == "success"
        assert "discipline" in feedback.content.lower() or "excellent" in feedback.content.lower()


class TestOrchestratorEngine:
    """Tests for the main OrchestratorEngine."""
    
    def test_forecast_processing(self, mock_db, sample_forecast_data, sample_session_config):
        """Test processing forecast into orchestrator state."""
        orchestrator = OrchestratorEngine(mock_db)
        
        state = orchestrator.process_forecast(sample_forecast_data, sample_session_config)
        
        assert state.execution_plan is not None
        assert state.risk_assessment is not None
        assert state.bankroll_state is not None
        assert state.session_status is not None
    
    def test_round_update(self, mock_db, sample_forecast_data, sample_session_config):
        """Test updating state on new round."""
        orchestrator = OrchestratorEngine(mock_db)
        
        # Initial processing
        orchestrator.process_forecast(sample_forecast_data, sample_session_config)
        
        # Update with new round data
        new_round_data = sample_forecast_data.copy()
        new_round_data["confidence_level"] = 0.80
        
        updated_state = orchestrator.update_on_round(new_round_data)
        
        assert updated_state is not None
        assert updated_state.execution_plan.confidence == 0.80
    
    def test_action_validation_integration(self, mock_db, sample_forecast_data, sample_session_config):
        """Test action validation through orchestrator."""
        orchestrator = OrchestratorEngine(mock_db)
        
        # Process forecast first
        orchestrator.process_forecast(sample_forecast_data, sample_session_config)
        
        # Validate action
        proposed_action = {"action": "play", "stake": 0.50}
        validation = orchestrator.validate_action(proposed_action, sample_session_config)
        
        assert validation is not None
    
    def test_checklist_generation_integration(self, mock_db, sample_forecast_data, sample_session_config):
        """Test checklist generation through orchestrator."""
        orchestrator = OrchestratorEngine(mock_db)
        
        # Process forecast first
        orchestrator.process_forecast(sample_forecast_data, sample_session_config)
        
        # Generate checklist
        checklist = orchestrator.generate_pre_action_checklist(sample_session_config)
        
        assert checklist is not None
        assert len(checklist.items) > 0
    
    def test_instruction_generation_integration(self, mock_db, sample_forecast_data, sample_session_config):
        """Test instruction generation through orchestrator."""
        orchestrator = OrchestratorEngine(mock_db)
        
        # Process forecast first
        orchestrator.process_forecast(sample_forecast_data, sample_session_config)
        
        # Generate instruction
        instruction = orchestrator.get_instruction_message()
        
        assert instruction is not None
        assert instruction.content is not None
