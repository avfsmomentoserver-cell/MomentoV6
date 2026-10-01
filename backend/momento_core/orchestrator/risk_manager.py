"""
Risk Manager for comprehensive risk assessment and scoring.

The RiskManager calculates a 0-100 risk score and provides clear
recommendations based on multiple risk factors.
"""

from typing import Dict, Any, List, Optional

from momento_core.orchestrator.models import (
    RiskAssessment,
    RiskLevel,
    ExecutionPlan,
)


class RiskManager:
    """
    Manages risk assessment with 0-100 scoring.
    
    The risk manager evaluates multiple factors to produce a comprehensive
    risk score and clear recommendation. This replaces simple low/medium/high
    classifications with a granular 0-100 scale.
    """
    
    def __init__(self, db) -> None:
        """
        Initialize risk manager with database session.
        
        Args:
            db: SQLAlchemy database session
        """
        self.db = db
    
    def assess_risk(
        self,
        forecast_data: Dict[str, Any],
        execution_plan: ExecutionPlan,
        session_config: Dict[str, Any]
    ) -> RiskAssessment:
        """
        Perform comprehensive risk assessment.
        
        Args:
            forecast_data: Forecast data from prediction engine
            execution_plan: Current execution plan
            session_config: Session configuration
            
        Returns:
            RiskAssessment: Comprehensive risk assessment
        """
        # Calculate component risk scores
        confidence_risk = self._calculate_confidence_risk(forecast_data)
        volatility_risk = self._calculate_volatility_risk(forecast_data)
        exposure_risk = self._calculate_exposure_risk(execution_plan, session_config)
        streak_risk = self._calculate_streak_risk(session_config)
        
        # Calculate overall risk score (weighted average)
        risk_score = self._calculate_overall_risk(
            confidence_risk=confidence_risk,
            volatility_risk=volatility_risk,
            exposure_risk=exposure_risk,
            streak_risk=streak_risk
        )
        
        # Determine risk level
        risk_level = self._determine_risk_level(risk_score)
        
        # Generate factors list
        factors = self._generate_risk_factors(
            confidence_risk=confidence_risk,
            volatility_risk=volatility_risk,
            exposure_risk=exposure_risk,
            streak_risk=streak_risk
        )
        
        # Generate recommendation
        recommendation = self._generate_recommendation(
            risk_score=risk_score,
            risk_level=risk_level,
            execution_plan=execution_plan
        )
        
        return RiskAssessment(
            risk_score=risk_score,
            risk_level=risk_level,
            factors=factors,
            recommendation=recommendation,
            confidence_risk=confidence_risk,
            volatility_risk=volatility_risk,
            exposure_risk=exposure_risk,
            streak_risk=streak_risk
        )
    
    def _calculate_confidence_risk(self, forecast_data: Dict[str, Any]) -> int:
        """
        Calculate risk from forecast confidence.
        
        Lower confidence = higher risk.
        
        Args:
            forecast_data: Forecast data
            
        Returns:
            int: Confidence risk score (0-100)
        """
        confidence = forecast_data.get("confidence_level", 0.5)
        
        # Invert confidence to get risk (1.0 confidence = 0 risk)
        risk = (1.0 - confidence) * 100
        
        # Add penalty for very low confidence
        if confidence < 0.5:
            risk += 20
        
        return min(int(risk), 100)
    
    def _calculate_volatility_risk(self, forecast_data: Dict[str, Any]) -> int:
        """
        Calculate risk from market volatility.
        
        Higher volatility = higher risk.
        
        Args:
            forecast_data: Forecast data
            
        Returns:
            int: Volatility risk score (0-100)
        """
        volatility = forecast_data.get("volatility", 0.5)
        
        # Scale volatility to 0-100
        risk = volatility * 100
        
        # Add penalty for extreme volatility
        if volatility > 0.8:
            risk += 15
        
        return min(int(risk), 100)
    
    def _calculate_exposure_risk(
        self,
        execution_plan: ExecutionPlan,
        session_config: Dict[str, Any]
    ) -> int:
        """
        Calculate risk from position size/exposure.
        
        Args:
            execution_plan: Current execution plan
            session_config: Session configuration
            
        Returns:
            int: Exposure risk score (0-100)
        """
        if execution_plan.action != "play" or not execution_plan.bet_slots:
            return 0  # No exposure if not playing
        
        # Calculate total exposure
        total_exposure = sum(slot.amount for slot in execution_plan.bet_slots)
        balance = session_config.get("starting_balance", 100.0)
        max_stake_percent = session_config.get("max_stake_percent", 5.0)
        
        # Calculate exposure as percentage of balance
        exposure_percent = (total_exposure / balance) * 100
        
        # Risk increases with exposure beyond recommended
        if exposure_percent <= max_stake_percent:
            risk = exposure_percent * 2  # Low risk for conservative sizing
        else:
            # Penalty for exceeding recommended stake
            excess = exposure_percent - max_stake_percent
            risk = (max_stake_percent * 2) + (excess * 5)
        
        return min(int(risk), 100)
    
    def _calculate_streak_risk(self, session_config: Dict[str, Any]) -> int:
        """
        Calculate risk from current streak.
        
        Losing streaks increase risk due to emotional factors.
        
        Args:
            session_config: Session configuration
            
        Returns:
            int: Streak risk score (0-100)
        """
        current_streak = session_config.get("current_streak", 0)
        
        if current_streak >= 0:
            # Winning or neutral streak - low risk
            return 0
        else:
            # Losing streak - risk increases with magnitude
            loss_magnitude = abs(current_streak)
            risk = min(loss_magnitude * 15, 100)
            
            # Add penalty for extended losing streaks
            if loss_magnitude >= 3:
                risk += 20
            
            return min(int(risk), 100)
    
    def _calculate_overall_risk(
        self,
        confidence_risk: int,
        volatility_risk: int,
        exposure_risk: int,
        streak_risk: int
    ) -> int:
        """
        Calculate overall risk score from components.
        
        Uses weighted average with confidence having highest weight.
        
        Args:
            confidence_risk: Risk from confidence
            volatility_risk: Risk from volatility
            exposure_risk: Risk from exposure
            streak_risk: Risk from streak
            
        Returns:
            int: Overall risk score (0-100)
        """
        # Weightings: confidence is most important
        weights = {
            "confidence": 0.35,
            "volatility": 0.25,
            "exposure": 0.25,
            "streak": 0.15
        }
        
        overall = (
            confidence_risk * weights["confidence"] +
            volatility_risk * weights["volatility"] +
            exposure_risk * weights["exposure"] +
            streak_risk * weights["streak"]
        )
        
        return int(round(overall))
    
    def _determine_risk_level(self, risk_score: int) -> RiskLevel:
        """
        Determine risk level from score.
        
        Args:
            risk_score: Overall risk score (0-100)
            
        Returns:
            RiskLevel: Categorical risk level
        """
        if risk_score <= 20:
            return RiskLevel.EXCELLENT
        elif risk_score <= 40:
            return RiskLevel.GOOD
        elif risk_score <= 60:
            return RiskLevel.MODERATE
        elif risk_score <= 80:
            return RiskLevel.ELEVATED
        else:
            return RiskLevel.DANGER
    
    def _generate_risk_factors(
        self,
        confidence_risk: int,
        volatility_risk: int,
        exposure_risk: int,
        streak_risk: int
    ) -> List[str]:
        """
        Generate human-readable risk factors.
        
        Args:
            confidence_risk: Risk from confidence
            volatility_risk: Risk from volatility
            exposure_risk: Risk from exposure
            streak_risk: Risk from streak
            
        Returns:
            List of risk factor descriptions
        """
        factors = []
        
        if confidence_risk <= 20:
            factors.append("High confidence forecast")
        elif confidence_risk >= 60:
            factors.append("Low confidence forecast")
        
        if volatility_risk <= 30:
            factors.append("Low volatility")
        elif volatility_risk >= 70:
            factors.append("High market volatility")
        
        if exposure_risk <= 30:
            factors.append("Conservative position sizing")
        elif exposure_risk >= 70:
            factors.append("Aggressive position sizing")
        
        if streak_risk <= 20:
            factors.append("No concerning streak")
        elif streak_risk >= 60:
            factors.append("Extended losing streak")
        
        return factors
    
    def _generate_recommendation(
        self,
        risk_score: int,
        risk_level: RiskLevel,
        execution_plan: ExecutionPlan
    ) -> str:
        """
        Generate human-readable recommendation.
        
        Args:
            risk_score: Overall risk score
            risk_level: Risk level
            execution_plan: Current execution plan
            
        Returns:
            str: Recommendation message
        """
        if risk_level == RiskLevel.EXCELLENT:
            return "Proceed with confidence"
        elif risk_level == RiskLevel.GOOD:
            return "Proceed with normal caution"
        elif risk_level == RiskLevel.MODERATE:
            return "Proceed with reduced position size"
        elif risk_level == RiskLevel.ELEVATED:
            return "Consider waiting or reducing exposure significantly"
        else:  # DANGER
            if execution_plan.action == "play":
                return "Skip session - risk too high"
            else:
                return "Continue waiting - conditions unsafe"
