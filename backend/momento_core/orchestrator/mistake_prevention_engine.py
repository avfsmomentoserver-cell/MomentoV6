"""
Mistake Prevention Engine for action validation and safety checks.

The MistakePreventionEngine validates user actions before execution,
provides pre-action checklists, and prevents common mistakes.
"""

from typing import Dict, Any, List

from momento_core.orchestrator.models import (
    ActionValidation,
    PreActionChecklist,
    ChecklistItem,
    OrchestratorState,
    ActionType,
    ExecutionPlan,
)


class MistakePreventionEngine:
    """
    Validates actions and prevents common mistakes.

    The mistake prevention engine checks every proposed action against
    the current execution plan and risk parameters to prevent errors
    like entering too early, over-staking, or ignoring confidence.
    """

    def __init__(self, db) -> None:
        """
        Initialize mistake prevention engine with database session.

        Args:
            db: SQLAlchemy database session
        """
        self.db = db

    def validate_action(
        self,
        proposed_action: Dict[str, Any],
        current_state: OrchestratorState,
        session_config: Dict[str, Any],
    ) -> ActionValidation:
        """
        Validate a proposed user action.

        Args:
            proposed_action: Action the user wants to take
            current_state: Current orchestrator state
            session_config: Session configuration

        Returns:
            ActionValidation: Validation result with warnings
        """
        action_type = proposed_action.get("action")
        execution_plan = current_state.execution_plan

        # Initialize validation
        validation = ActionValidation(
            action_valid=True, warning_level="none", message="Action validated"
        )

        # Check if action matches plan
        if action_type != execution_plan.action:
            validation.action_valid = False
            validation.warning_level = "warning"
            validation.message = f"Action does not match plan. Plan recommends: {execution_plan.action.value}"

        # Check entry window
        if action_type == "play":
            entry_check = self._check_entry_window(proposed_action, execution_plan)
            if not entry_check["valid"]:
                validation.action_valid = False
                validation.warning_level = "warning"
                validation.message = entry_check["message"]
                validation.entry_window_active = False
                validation.confidence_impact = entry_check.get("confidence_impact")

        # Check stake size
        if action_type == "play":
            stake_check = self._check_stake_size(
                proposed_action, execution_plan, session_config
            )
            if not stake_check["valid"]:
                validation.warning_level = (
                    "error" if stake_check["severe"] else "warning"
                )
                validation.message = stake_check["message"]
                validation.stake_increase_percent = stake_check["increase_percent"]
                validation.risk_increase_percent = stake_check["risk_increase"]

        # Check confidence threshold
        confidence_check = self._check_confidence_threshold(
            proposed_action, execution_plan, session_config
        )
        if not confidence_check["valid"]:
            validation.action_valid = False
            validation.warning_level = "warning"
            validation.message = confidence_check["message"]

        return validation

    def generate_checklist(
        self, current_state: OrchestratorState, session_config: Dict[str, Any]
    ) -> PreActionChecklist:
        """
        Generate pre-action checklist.

        Args:
            current_state: Current orchestrator state
            session_config: Session configuration

        Returns:
            PreActionChecklist: Checklist with all items
        """
        items = [
            self._check_confidence_item(current_state, session_config),
            self._check_balance_item(current_state),
            self._check_session_item(current_state),
            self._check_loss_limit_item(current_state),
            self._check_entry_window_item(current_state),
            self._check_phase_item(current_state),
            self._check_risk_item(current_state),
            self._check_freshness_item(current_state),
        ]

        all_passed = all(item.passed for item in items)

        return PreActionChecklist(
            all_passed=all_passed, items=items, ready_to_proceed=all_passed
        )

    def _check_entry_window(
        self, proposed_action: Dict[str, Any], execution_plan: ExecutionPlan
    ) -> Dict[str, Any]:
        """
        Check if entry window is active.

        Args:
            proposed_action: Proposed action
            execution_plan: Current execution plan

        Returns:
            Dict with validation result
        """
        if execution_plan.action != ActionType.PLAY:
            return {"valid": True}

        # For now, assume entry window is valid if plan says play
        # In production, this would check specific round numbers
        return {"valid": True, "message": "Entry window active"}

    def _check_stake_size(
        self,
        proposed_action: Dict[str, Any],
        execution_plan: ExecutionPlan,
        session_config: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Check if stake size is appropriate.

        Args:
            proposed_action: Proposed action
            execution_plan: Current execution plan
            session_config: Session configuration

        Returns:
            Dict with validation result
        """
        proposed_stake = proposed_action.get("stake", 0)
        balance = session_config.get("current_balance", 100.0)
        max_stake_percent = session_config.get("max_stake_percent", 5.0)

        # Calculate recommended stake from plan
        recommended_stake = 0
        if execution_plan.bet_slots:
            recommended_stake = sum(slot.amount for slot in execution_plan.bet_slots)

        # Calculate maximum allowed stake
        max_allowed = balance * (max_stake_percent / 100.0)

        # Check if stake exceeds maximum
        if proposed_stake > max_allowed:
            increase_percent = (
                ((proposed_stake - recommended_stake) / recommended_stake * 100)
                if recommended_stake > 0
                else 100
            )
            risk_increase = increase_percent * 1.5  # Risk increases faster than stake

            return {
                "valid": False,
                "severe": proposed_stake > max_allowed * 2,
                "message": f"Unsafe. Recommended stake: {recommended_stake:.2f}, Entered: {proposed_stake:.2f}. Risk Increase: +{risk_increase:.0f}%",
                "increase_percent": increase_percent,
                "risk_increase": risk_increase,
            }

        # Check if stake significantly exceeds recommendation
        if recommended_stake > 0 and proposed_stake > recommended_stake * 1.5:
            increase_percent = (
                (proposed_stake - recommended_stake) / recommended_stake * 100
            )
            risk_increase = increase_percent * 1.2

            return {
                "valid": True,  # Allow but warn
                "severe": False,
                "message": f"Stake above recommendation. Recommended: {recommended_stake:.2f}, Entered: {proposed_stake:.2f}",
                "increase_percent": increase_percent,
                "risk_increase": risk_increase,
            }

        return {"valid": True}

    def _check_confidence_threshold(
        self,
        proposed_action: Dict[str, Any],
        execution_plan: ExecutionPlan,
        session_config: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Check if confidence meets threshold.

        Args:
            proposed_action: Proposed action
            execution_plan: Current execution plan
            session_config: Session configuration

        Returns:
            Dict with validation result
        """
        if proposed_action.get("action") != "play":
            return {"valid": True}

        min_confidence = session_config.get("min_confidence_threshold", 0.65)

        if execution_plan.confidence < min_confidence:
            return {
                "valid": False,
                "message": f"Confidence below threshold. Current: {execution_plan.confidence:.0%}, Required: {min_confidence:.0%}",
            }

        return {"valid": True}

    def _check_confidence_item(
        self, current_state: OrchestratorState, session_config: Dict[str, Any]
    ) -> ChecklistItem:
        """Check confidence threshold."""
        min_confidence = session_config.get("min_confidence_threshold", 0.65)
        passed = current_state.execution_plan.confidence >= min_confidence

        return ChecklistItem(
            item="Confidence above threshold",
            passed=passed,
            message=(
                f"Current: {current_state.execution_plan.confidence:.0%}, Required: {min_confidence:.0%}"
                if not passed
                else None
            ),
        )

    def _check_balance_item(self, current_state: OrchestratorState) -> ChecklistItem:
        """Check balance status."""
        passed = current_state.bankroll_state.current_balance > 0

        return ChecklistItem(
            item="Balance OK",
            passed=passed,
            message="Insufficient balance" if not passed else None,
        )

    def _check_session_item(self, current_state: OrchestratorState) -> ChecklistItem:
        """Check if session is active."""
        passed = current_state.session_status.state.value == "active"

        return ChecklistItem(
            item="Session active",
            passed=passed,
            message="Session not active" if not passed else None,
        )

    def _check_loss_limit_item(self, current_state: OrchestratorState) -> ChecklistItem:
        """Check if loss limit reached."""
        passed = True
        if current_state.bankroll_state.remaining_loss_allowance is not None:
            passed = current_state.bankroll_state.remaining_loss_allowance > 0

        return ChecklistItem(
            item="Loss limit not reached",
            passed=passed,
            message="Loss limit reached" if not passed else None,
        )

    def _check_entry_window_item(
        self, current_state: OrchestratorState
    ) -> ChecklistItem:
        """Check if entry window is active."""
        passed = current_state.execution_plan.action == ActionType.PLAY

        return ChecklistItem(
            item="Entry window active",
            passed=passed,
            message="Not in entry window" if not passed else None,
        )

    def _check_phase_item(self, current_state: OrchestratorState) -> ChecklistItem:
        """Check if market phase is confirmed."""
        # This would check against forecast data
        passed = True  # Placeholder

        return ChecklistItem(
            item="Phase confirmed",
            passed=passed,
            message="Phase not confirmed" if not passed else None,
        )

    def _check_risk_item(self, current_state: OrchestratorState) -> ChecklistItem:
        """Check if risk level is acceptable."""
        passed = current_state.risk_assessment.risk_level.value in [
            "excellent",
            "good",
            "moderate",
        ]

        return ChecklistItem(
            item="Risk level acceptable",
            passed=passed,
            message=(
                f"Risk level: {current_state.risk_assessment.risk_level.value}"
                if not passed
                else None
            ),
        )

    def _check_freshness_item(self, current_state: OrchestratorState) -> ChecklistItem:
        """Check if forecast is fresh."""
        # This would check forecast timestamp
        passed = True  # Placeholder

        return ChecklistItem(
            item="Forecast fresh",
            passed=passed,
            message="Forecast stale" if not passed else None,
        )
