# ADR-0002: Decision Orchestrator Layer

## Status

Accepted

## Context

Momento was originally designed as a prediction platform that provided users with forecast data, confidence levels, and probability estimates. Users were expected to interpret these predictions and make their own execution decisions.

### Problem Statement

This approach led to several critical issues:

1. **Analysis Paralysis**: Users overwhelmed by raw prediction data
2. **Execution Mistakes**: Users entering too early, staying too long, over-staking
3. **Emotional Decisions**: Chasing losses, ignoring confidence thresholds, impatience
4. **Inconsistent Execution**: Even good predictions failed due to poor execution
5. **Cognitive Load**: Users had to think about when to act, how much to bet, when to stop

### Key Human Errors Observed

- Enter too early before conditions are optimal
- Stay too long after conditions deteriorate
- Increase bets emotionally after losses
- Ignore confidence thresholds
- Chase losses instead of following the plan
- Forget session goals and limits
- Overtrade due to boredom or impatience
- Misread probability and risk
- Become impatient during wait periods
- Become greedy when ahead
- Don't know when to stop

## Decision

Implement a **Decision Orchestrator Layer** that sits above the Forecast Engine and converts predictions into complete execution plans. The orchestrator follows the principle:

> **Don't predict, orchestrate.**

### Architecture

```
Collector → Feature Engine → DNA Engine → Forecast Engine → Risk Engine → 
Money Management → Execution Planner → Orchestrator → User
```

Prediction ends at the Forecast Engine. Everything after becomes instructions.

### Core Components

1. **OrchestratorEngine**: Central coordinator integrating all sub-engines
2. **ExecutionPlanner**: Converts forecasts to actionable plans (WAIT/PLAY/STOP)
3. **RiskManager**: 0-100 risk scoring with component analysis
4. **BankrollManager**: Balance tracking and limit enforcement
5. **SessionManager**: Session lifecycle control and recommendations
6. **PatienceEngine**: Wait time visualization and psychological support
7. **SpeedEngine**: Market chaos detection and speed assessment
8. **MistakePreventionEngine**: Action validation and pre-action checklists
9. **InstructionGenerator**: Natural language guidance and coaching

### User Experience Transformation

#### Before (Prediction App)
```
Confidence: 71%
ETA: 6 rounds
Probability: 0.68
```

#### After (Decision Orchestrator)
```
WAIT

Do not bet.

Estimated wait: 6-9 rounds

Reason: Compression not finished.

Next update: after every round.
```

#### When Entry Arrives
```
ACTION

Round Window: 1-3 rounds

Slot A
Bet: 0.50
Cashout: 4x
Priority: High

Slot B
Bet: 0.30
Cashout: 12x
Priority: Medium

Maximum attempts: 3

Then STOP.
```

### Key Features

#### 1. No Thinking Required
Users receive clear instructions, not raw data. The system tells them exactly what to do.

#### 2. Continuous Updating
Every round recalculates the plan. If conditions change:
```
PLAN UPDATED

Old entry: 2 rounds
New entry: 5 rounds

Reason: Large event reset market.
Continue waiting.
```

#### 3. Session Management
Inputs: balance, profit target, max loss, risk profile, time available, market speed, confidence, streak

Outputs: Continue, Pause, Wait, Increase patience, Reduce exposure, End session

Example:
```
Current Balance: $120
Today's Target: $15
Current Profit: $14

Recommendation: STOP

Today's objective achieved.
Risk of giving profit back is increasing.
Session Complete. ★★★★★
```

#### 4. Patience Engine
Addresses boredom during wait periods:
```
Patience Meter: ██████░░░░ 64%

Estimated Time: 2m 10s

Market not ready.
Current probability: 34%
Required: 68%

Wait.
```

#### 5. Speed Engine
Detects chaotic markets:
```
Fast Market

Reduce exposure.
Recommended: Half stake.
Increase wait window.
```

#### 6. Risk Scoring (0-100)
Replaces simple low/medium/high:
```
Risk: 22 - Excellent
Recommended: Proceed.

or

Risk: 83 - Danger
Skip session.
```

#### 7. Mistake Prevention
Validates every action:
- Entry window check
- Stake size validation
- Confidence threshold enforcement
- Pre-action checklist

#### 8. Natural Language Coaching
```
Good patience. Keep waiting. Only 3 rounds left.

Excellent discipline. Skipped poor opportunity.
Forecast quality improving.

Market unstable. Take a short break.
```

#### 9. Adaptive UI
- Beginner: Shows WAIT or PLAY
- Intermediate: Shows Confidence, ETA, Risk
- Advanced: Shows everything

## Consequences

### Positive

1. **Eliminates Execution Mistakes**: System validates every action
2. **Reduces Cognitive Load**: Users don't need to interpret predictions
3. **Enforces Discipline**: System prevents emotional decisions
4. **Clear Guidance**: Natural language instructions are unambiguous
5. **Psychological Support**: Patience engine helps users wait
6. **Risk Management**: 0-100 scoring provides granular assessment
7. **Session Control**: Automatic limit enforcement prevents overtrading
8. **Continuous Updates**: Real-time plan adjustments
9. **Scalable Architecture**: Prediction engine evolves independently

### Negative

1. **Increased Complexity**: More components to maintain
2. **Dependency on Quality**: Orchestrator only as good as underlying predictions
3. **User Trust**: Users must trust the system's guidance
4. **Development Overhead**: Requires careful implementation and testing

### Risks

1. **Over-Reliance**: Users may become dependent on the system
2. ** False Confidence**: Good execution doesn't guarantee profits
3. **Edge Cases**: Unusual market conditions may break assumptions

### Mitigations

1. **Clear Communication**: System focuses on disciplined execution, not profit guarantees
2. **Transparency**: Users can see the reasoning behind recommendations
3. **Fallback Options**: Users can override system if needed (with warnings)
4. **Continuous Learning**: System improves based on user feedback and outcomes

## Implementation

### Directory Structure
```
core/momento_core/orchestrator/
├── __init__.py
├── models.py
├── orchestrator_engine.py
├── execution_planner.py
├── risk_manager.py
├── bankroll_manager.py
├── session_manager.py
├── patience_engine.py
├── speed_engine.py
├── mistake_prevention_engine.py
└── instruction_generator.py
```

### API Endpoints
- `POST /api/v1/orchestrator/process-forecast` - Process forecast into execution plan
- `POST /api/v1/orchestrator/update-round` - Update state on new round
- `POST /api/v1/orchestrator/validate-action` - Validate user action
- `POST /api/v1/orchestrator/checklist` - Get pre-action checklist
- `GET /api/v1/orchestrator/instruction` - Get coaching message
- `GET /api/v1/orchestrator/state` - Get current state
- `POST /api/v1/orchestrator/session/start` - Start new session

### Technology Stack
- Python 3.11+
- FastAPI for API endpoints
- Pydantic for data validation
- SQLAlchemy for database operations

## Alternatives Considered

### 1. Keep Prediction-Only Approach
**Rejected**: Users continued making execution mistakes despite good predictions.

### 2. Add Simple Alerts
**Rejected**: Alerts don't prevent mistakes, just warn about them.

### 3. Full Automation (Auto-Trading)
**Rejected**: Too risky, removes user agency, regulatory concerns.

### 4. Hybrid (Prediction + Optional Guidance)
**Rejected**: Users would likely ignore guidance when inconvenient.

## References

- Original design document: User specification on Decision Orchestrator
- Project architecture: `.kiro/steering/architecture.md`
- Coding standards: `.devin/CODING_STANDARDS.md`

## Decision Makers

- Product Owner: User specification
- Architecture: Momento Core team
- Implementation: Development team

## Date

2026-07-21
