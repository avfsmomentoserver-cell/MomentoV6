# MomentoV6 Predictor Branch Documentation

## Overview

The `predictor` branch implements comprehensive AI-powered forecasting enhancements for the MomentoV6 research console. This branch integrates full-intelligence forecasting across all prediction systems, adds dynamic confidence-driven adjustments, and provides enhanced database context for AI queries.

## Table of Contents

1. [Entrim AI Integration](#entrim-ai-integration)
2. [Ask Momento Enhancement](#ask-momento-enhancement)
3. [ETA Intelligence Context](#eta-intelligence-context)
4. [Command Center Enhancements](#command-center-enhancements)
5. [Full Intelligence for Multi-Window Predictions](#full-intelligence-for-multi-window-predictions)
6. [ETA and Cone Spread Adjustments](#eta-and-cone-spread-adjustments)
7. [Dynamic Confidence-Driven Forecast](#dynamic-confidence-driven-forecast)
8. [Configuration](#configuration)
9. [System Services](#system-services)
10. [API Endpoints](#api-endpoints)

---

## Entrim AI Integration

### Purpose
Integrate Entrim AI as the primary AI provider for AI summaries and Ask Momento responses.

### Implementation

**Environment Configuration**
- API key stored in `/home/admin/V6/MomentoV6/functions/.env`
- Variable name: `ENTRIM_API_KEY`
- Base URL: `https://api.entrim.ai/v1` (default)
- Default model: `deepseek-ai/DeepSeek-V4-Flash`

**Code Changes**
- Modified `functions/local-dev.mjs` to load `.env` file using dotenv
- Updated systemd backend service to load environment from `.env` via `EnvironmentFile` directive
- AI summary code in `functions/v64routes.ts` checks `ENTRIM_API_KEY` first, then falls back to settings

**Fallback Behavior**
- Without API key: Returns deterministic fallback content
- On provider failure: Stores error status and fallback content

---

## Ask Momento Enhancement

### Purpose
Expand Ask Momento to use database context and broader research sources, removing the strict citation-only restriction.

### Implementation

**Backend Changes (`functions/v65routes.ts`)**
- Added database context to every AI query:
  - Platform statistics (total rounds, timestamps)
  - Current intelligence state (expected multiplier, range, confidence)
  - Recent rounds (last 10 rounds with multipliers)
  - Analysis data (pressure, moonshot indicators)
- Removed strict citation-only restriction
- Updated system prompt to allow answering from:
  - Documentation passages (with citations when used)
  - Database context
  - General knowledge for experimentation, testing, and research
- Increased max tokens from 700 to 1200 for more detailed answers

**Frontend Changes (`web-momento/src/pages/dashboard/Ask.tsx`)**
- Updated subtitle to reflect expanded capabilities
- Added new example questions:
  - "What's the current intelligence state?"
  - "How do I test a new strategy?"
  - "What patterns should I watch for?"

**Benefits**
- AI can now answer questions about live data and statistics
- Strategy testing and research queries are supported
- No longer limited to documentation-only responses

---

## ETA Intelligence Context

### Purpose
Add full-intelligence forecast context to ETA predictions for better decision support.

### Implementation

**Backend Changes**
- Modified `functions/v65.ts` `etaBoard()` to accept optional `intelligence` parameter
- Updated `functions/v65routes.ts` ETA endpoint to fetch full intelligence forecast and pass it to etaBoard
- Intelligence context included in ETA response data

**Frontend Changes (`web-momento/src/pages/dashboard/EtaBoard.tsx`)**
- Updated type definitions to include intelligence
- Enhanced ETA Board UI to display intelligence state and confidence alongside KM estimates

**Data Provided**
- State (e.g., "Exhaustion", "Moonshot")
- Confidence (0.0-1.0)
- Confidence label (HIGH/MEDIUM/LOW)
- Expected multiplier
- Range (lo/hi)
- Distribution and engine components
- Calibration metadata

---

## Command Center Enhancements

### Purpose
Add ETA and cone predictions to the Command Center for comprehensive forecasting view.

### Implementation

**Backend Changes (`functions/v65routes.ts`)**
- Enhanced `/api/v1/intelligence/cone` endpoint to include full intelligence context in response
- The cone now includes the intelligence forecast alongside cone data

**Frontend Changes (`web-momento/src/pages/dashboard/CommandCenter.tsx`)**
- Added ETA board query to fetch live ETA estimates
- Added intelligence cone query to fetch cone predictions with coverage metrics
- Added two new metric tiles:
  - **ETA 10×**: Shows median ETA estimate for hitting 10× with KM percentile
  - **Cone coverage**: Shows measured p25-p75 coverage of the forecast cone

**Metrics Displayed**
- ETA estimates for various thresholds
- Cone coverage metrics (p25p75, belowP90)
- Intelligence state and confidence

---

## Full Intelligence for Multi-Window Predictions

### Purpose
Use full intelligence forecast for scheduled multi-window predictions instead of simple pipeline model.

### Implementation

**Backend Changes (`functions/core.ts`)**
- Modified `accuracyTick()` to use full intelligence forecast instead of pipeline
- Scheduled predictions now use full-intelligence per-round probabilities from horizon outlook
- Model field in `scheduled_predictions` changes from `'pipeline'` to `'full-intelligence'`
- Components now include all 8 intelligence engines (baseline, percentile, markov, dna, band, ml, ensemble, signals)
- Ledger tracking updated to use actual model name instead of hardcoded `'pipeline'`
- Fallback to pipeline if full intelligence data is not available

**How It Works**
1. Fetches full intelligence forecast
2. Extracts per-round probabilities from horizon outlook for each threshold
3. Calculates window probability: `1 - (1 - perRound)^nRounds`
4. Stores with full intelligence components

**Benefits**
- More accurate multi-window predictions
- Better utilization of all 8 intelligence engines
- Consistent forecasting across all systems

---

## ETA and Cone Spread Adjustments

### Purpose
Use ETA median and cone spread to adjust next-round forecast expected value and range.

### Implementation

**Backend Changes (`functions/intelligence.ts`)**
- Added `etaMedian` and `coneSpread` options to `IntelOptions`
- Imported `quantileFromDist` from v65 for distribution quantile calculations

**ETA-Based Expected Adjustment**
- If ETA median < 3 rounds: Increase expected by 5%
- If ETA median > 15 rounds: Decrease expected by 5%
- Otherwise: No adjustment

**Cone Spread-Based Range Adjustment**
- Calculates cone spread from forecast distribution: `(p90 - p25) / p50`
- Normalized spread clamped to 0.8-2.0
- Higher spread = wider range, lower spread = narrower range
- Applied with 30% factor for conservative adjustment

**Backend Integration (`functions/core.ts`)**
- Modified `intelForecast()` to:
  - Calculate ETA median using `etaBoard()` for 10× threshold
  - Calculate cone spread from forecast distribution
  - Pass both values to full intelligence forecast
  - Re-forecast if cone spread differs significantly (>10%) from default

---

## Dynamic Confidence-Driven Forecast

### Purpose
Make Command Center forecast dynamic with aggressive confidence-weighted adjustments to expected value and range, incorporating distribution curve, band exhaustion, tail bias for moonshot states, and other factors.

### Implementation

**Backend Changes (`functions/intelligence.ts`)**

**A. Aggressive Confidence-Weighted Range Scaling**
```
rangeScale = 1.0 + (0.5 - confidence) * 0.6
tailAdjust = 1.0 + (tailLift - 0.5) * 0.3
exhaustionAdjust = top.state === "Exhaustion" ? 1.15 : 1.0
pressureAdjust = 1.0 + (press.overallPressure / 100) * 0.2
finalRangeScale = clamp(rangeScale * tailAdjust * exhaustionAdjust * pressureAdjust, 0.6, 1.8)
```

- HIGH confidence (≥0.66): Tighten range by 15-25%
- MEDIUM confidence (0.38-0.66): 0-15% adjustment
- LOW confidence (<0.38): Widen range by 30-50%

**B. Confidence-Driven Expected Adjustment with Tail Bias**

*Agreement Shift*
- Calculates weighted median from top-weighted components (weight > 15%)
- Shifts 0-40% toward agreement based on confidence
- LOW confidence = stronger shift toward agreed predictions

*Tail Bias*
- Moonshot/Ignition states: Upward bias based on tailLift (up to 30%)
- Collapse/Exhaustion states: Downward bias based on tailLift (up to 20%)
- Tail bias moderated by confidence: HIGH confidence = stronger tail bias

**C. Enhanced Single Band Calculation**
- Blends expected value with mode (most likely band from distribution)
- Factors in state bias (+0.3 for Moonshot/Ignition, -0.2 for Collapse/Exhaustion)
- Factors in tailLift bias
- Confidence determines trust in expected vs mode

**Response Fields Added**
- `rangeScale`: Final range scaling factor
- `agreementShift`: How much expected shifted toward agreement
- `tailBias`: Tail bias applied
- `bandContext`: {
    - tailLift
    - stateBias
    - tailBandBias
    - confidenceWeight
    - modeWeight
    - expectedBandIndex
    - modeBandIndex
    - computedBandIndex
  }

**Frontend Changes (`web-momento/src/pages/dashboard/CommandCenter.tsx`)**

**Visual Enhancements**
- Band computation context badges (tail lift, state bias, confidence weight)
- Color-coded range display based on confidence:
  - HIGH: Cyan (precise)
  - MEDIUM: Slate (neutral)
  - LOW: Orange (uncertain)
- Range scale indicator bar showing width relative to baseline
- Range scale factor display: "scale ×1.09"

**Smooth Transitions**
- 400ms transitions on all forecast values
- Distribution bars animate smoothly
- Confidence ring animates with 900ms duration

**Component Weight Display**
- Progress bars showing each component's weight
- Dominant components (>15% weight) highlighted in primary color
- Visual indication of engine dominance

**Type Changes (`web-momento/src/lib/types.ts`)**
- Added `rangeScale`, `agreementShift`, `tailBias` to `IntelligenceBlock`
- Added `bandContext` object with computation factors

---

## Configuration

### Environment Variables

**Required**
- `ENTRIM_API_KEY`: Entrim AI API key (stored in `.env` file)

**Optional Settings**
- `entrim_api_key`: Fallback API key from settings
- `entrim_base_url`: Custom API base URL (default: `https://api.entrim.ai/v1`)
- `entrim_model`: Custom model (default: `deepseek-ai/DeepSeek-V4-Flash`)

### .env File Location
- Path: `/home/admin/V6/MomentoV6/functions/.env`
- Loaded automatically by `local-dev.mjs` via dotenv
- Systemd backend service loads via `EnvironmentFile` directive

---

## System Services

### Systemd Units

**momento-backend.service**
- Port: 8000
- Description: MomentoV6 local backend (REST API + SQLite)
- Loads environment from `.env` file
- Enabled for auto-start on boot

**momento-console.service**
- Port: 8080
- Description: Vite development server for web console
- Enabled for auto-start on boot

**momento-feed.service**
- Description: File feed watcher for ~/Downloads
- Polls every 5 seconds for new data files
- Enabled for auto-start on boot

### Service Management

```bash
# Start all services
sudo systemctl start momento-backend.service momento-console.service momento-feed.service

# Stop all services
sudo systemctl stop momento-backend.service momento-console.service momento-feed.service

# Restart all services
sudo systemctl restart momento-backend.service momento-console.service momento-feed.service

# Check status
sudo systemctl status momento-backend.service
```

---

## API Endpoints

### Intelligence Forecast

**GET `/api/v1/pipeline/next-round`**
- Returns full-intelligence next-round forecast
- Includes dynamic range scaling and expected adjustments
- Response includes:
  - State, confidence, expected multiplier, range
  - Distribution, components, horizon outlook
  - Intelligence block with rangeScale, agreementShift, tailBias, bandContext

**GET `/api/v1/intelligence/forecast`**
- Alias for `/api/v1/pipeline/next-round`

**GET `/api/v1/pipeline/next-round/band`**
- Legacy band-only forecast (for comparison)

### ETA Board

**GET `/api/v1/eta/board`**
- Returns ETA estimates with survival analysis
- Includes intelligence context (state, confidence, expected, range)
- Response includes:
  - ETA median and p90 for each threshold
  - KM percentile, pressure, hazard model data
  - Calibration statistics

### Intelligence Cone

**GET `/api/v1/intelligence/cone?h=5`**
- Returns forecast cone with ETA markers
- Includes full intelligence context
- Response includes:
  - Cone data (p25, p50, p75, p90 for h horizons)
  - ETA markers for thresholds
  - Coverage metrics (p25p75, belowP90)
  - Intelligence forecast

### Analysis

**GET `/api/v1/analysis?source=all`**
- Returns comprehensive analysis data
- Includes exceedance, streaks, pressure, moonshot, shape

### Accuracy

**GET `/api/v1/accuracy/overview`**
- Returns accuracy engine statistics
- Includes open predictions, Brier score, skill vs baseline

**POST `/api/v1/accuracy/tick`**
- Triggers accuracy engine tick
- Resolves matured predictions
- Schedules new predictions with full intelligence

---

## Forecast Engines

### Built-in Engines (8)

1. **baseline** - Measured baseline (full history) - Prior: 1.0
2. **percentile** - Empirical percentiles (recent 500) - Prior: 0.8
3. **markov** - Markov state transitions (V5 7-state) - Prior: 0.9
4. **dna** - DNA analogue matching - Prior: 0.7
5. **band** - v6 band-partition model (tail-lift) - Prior: 0.9
6. **ml** - Logistic ML ensemble - Prior: 0.6
7. **ensemble** - v6 earned-weight per-round ensemble - Prior: 0.8
8. **signals** - Signal layer (pressure · moonshot · ladders · FX · momentum) - Prior: 0.6

### Custom Engines
- Registered via `/api/v1/engines` POST endpoint
- Start in "shadow" state (scored but no weight)
- Promoted to "live" after demonstrating skill
- Auto-demoted if skill CI drops below 0

### Weight System
- Bayesian mixture weights from trailing log-losses
- Posterior ∝ prior · e^(-n_eff · ΔL)
- Minimum floors: baseline 8%, all others 2%
- Effective sample capped at n_eff = min(60, sample_size)

---

## Data Flow

### Next-Round Forecast Flow

```
1. Round History
   ↓
2. Full Intelligence Forecast
   ├─ Calculate mixture from 8 engines
   ├─ Apply ETA adjustment (if available)
   ├─ Apply cone spread adjustment (if available)
   ├─ Calculate confidence
   ├─ Apply confidence-based range scaling
   ├─ Apply agreement shift (toward top components)
   ├─ Apply tail bias (state-dependent)
   └─ Compute enhanced band label
   ↓
3. Return forecast with intelligence context
```

### Multi-Window Prediction Flow

```
1. Accuracy Tick Triggered
   ↓
2. Fetch Full Intelligence Forecast
   ↓
3. Extract Horizon Outlook Probabilities
   ↓
4. Calculate Window Probabilities
   ↓
5. Store with Full Intelligence Components
   ↓
6. Resolve Matured Predictions
   ↓
7. Update Ledger (with model name)
```

### ETA Board Flow

```
1. Round History
   ↓
2. Calculate Gaps Between Thresholds
   ↓
3. Kaplan-Meier Survival Analysis
   ↓
4. Hazard Model Fitting
   ↓
5. Fetch Full Intelligence Forecast
   ↓
6. Add Intelligence Context to ETA Response
   ↓
7. Return ETA with State/Confidence
```

---

## Key Concepts

### Confidence Levels
- **HIGH** (≥0.66): Demonstrated out-of-sample skill (≥3% better than baseline)
- **MEDIUM** (0.38-0.66): Moderate conviction, calibration sample < 15 or skill < 3%
- **LOW** (<0.38): Low conviction, insufficient calibration data

### States (V5 State Machine)
- **Normal**: Balanced market conditions
- **Moonshot**: High tail probability, conditions building
- **Ignition**: Early moonshot phase
- **Collapse**: Sharp drop expected
- **Exhaustion**: Overdue thresholds, high pressure
- **Bait**: False signals possible
- **Shelf**: Flat/stable period

### Tail Lift
- Measures how much the model lifts tail probabilities
- High tail lift (>0.5): More moonshot weight
- Low tail lift (<0.5): More conservative
- Used in range scaling and expected adjustments

### Band Exhaustion
- Measures how overdue each threshold is
- Status: fresh, due, overdue
- Used in range scaling (exhausted = wider range)
- Affects ETA calculations

---

## Performance Considerations

### Backend
- Full intelligence forecast computed once per request
- ETA calculations cached for duration of tick
- Multi-window predictions scheduled per (window, threshold) pair
- Ledger updates after each resolution

### Frontend
- Refetch intervals:
  - Live mode: 4 seconds
  - Normal mode: 15 seconds
- Smooth transitions (400ms) prevent jarring updates
- Component weight bars animate smoothly

### Database
- SQLite with SQL.js
- All analysis functions are pure (no side effects)
- Historical data persists across service restarts

---

## Troubleshooting

### Entrim AI Not Working
- Check `.env` file exists in `/home/admin/V6/MomentoV6/functions/`
- Verify `ENTRIM_API_KEY` is set correctly
- Check systemd service logs: `sudo journalctl -u momento-backend.service -f`
- Verify network connectivity to `https://api.entrim.ai/v1`

### Forecast Not Updating
- Check if services are running: `sudo systemctl status momento-backend.service`
- Verify database has sufficient rounds (need ≥8 for forecast)
- Check for errors in browser console
- Verify accuracy tick is running (should fire every 60s)

### ETA Not Showing Intelligence Context
- Verify `intelligence` parameter is passed to `etaBoard()`
- Check endpoint response includes `intelligence` field
- Verify frontend type definitions are updated

### Range Not Adjusting
- Check if `rangeScale` is in intelligence response
- Verify confidence is ≥0.05 and ≤0.95
- Check tailLift is available from v6band
- Verify pressure data is available

---

## Future Enhancements

### Potential Improvements
1. Add real-time weight delta tracking between refreshes
2. Implement confidence-based animation speed variations
3. Add more sophisticated tail bias models
4. Implement regime-aware weight adjustments
5. Add custom engine performance tracking
6. Implement forecast comparison views (full-intelligence vs band-only)

### API Extensions
1. Add `/api/v1/intelligence/components` for detailed component analysis
2. Add `/api/v1/intelligence/history` for forecast history
3. Add `/api/v1/intelligence/calibration` for calibration data
4. Add streaming endpoint for real-time forecast updates

---

## Branch Information

**Branch Name**: `predictor`
**Base Branch**: Main (assumed)
**Remote**: `https://github.com/avfsmomentoserver-cell/MomentoV6.git`

### Commits
1. `291bb73` - Enhance Ask Momento with database context and remove citation restriction
2. `5c9374f` - Add intelligence context to ETA predictions
3. `953f77b` - Use full intelligence for scheduled multi-window predictions
4. `2edacae` - Add ETA and cone predictions to Command Center
5. `6454359` - Make Command Center forecast dynamic with confidence-driven adjustments

### Status
- All features implemented and tested
- Backend services running successfully
- Frontend displaying dynamic forecasts
- API endpoints returning correct data
- Ready for merge or further testing

---

## Contact

For questions or issues related to this branch, please refer to the project repository or contact the development team.

---

*Documentation generated on 2026-10-01*
