# MomentoV6 Intel Branch Documentation

## Overview

The `intel` branch salvages intelligence that existed in other routes/modules but was not contributing directly to the published forecast, and integrates it into a unified platform-driven forecast and range system.

### Objective

Transform scattered intelligence from:
- V6.4 deep jobs (DNA, linguistics, shape)
- V6.5 research features (regime, evidence)
- Analysis functions (shape, linguistics, pressure, moonshot)
- FX functions (volatility, trend, breakout, support)

Into a single unified forecast that:
- Uses all relevant intelligence in a calibrated mixture
- Derives expected value, range, quantiles, and reach from one distribution
- Applies range adjustments based on regime, trend, and signal context
- Maintains evidence gating and calibration validation
- Preserves existing data and database state

### Key Changes

1. **Three new distribution engines added to forecast mixture**:
   - `linguistics`: Multi-layer linguistic token distribution
   - `shape`: Shape projection distribution (trend/acceleration)
   - `fxRegime`: FX regime distribution (volatility + trend + mean reversion)

2. **Simplified DNA integration**: Original `dna` engine retained (not duplicated as `dnaPattern`)

3. **Range adjustment layer**: Volatility regime, breakout, and trend-based range scaling

4. **Frontend updates**: Command Center displays new engine data and range adjustments

## Architecture and Data Flow

### Forecast Generation Flow

```
1. Load engine states (live/shadow/demoted)
2. Load calibration ledger and recalibrator
3. Load point/range settings
4. Call fullIntelligenceForecast()
   ├─ Calculate per-engine distributions
   │  ├─ baseline: Historical band frequencies
   │  ├─ percentile: Empirical percentiles
   │  ├─ markov: Markov state transitions
   │  ├─ dna: DNA analogue matching
   │  ├─ band: Band-partition model
   │  ├─ ml: Logistic ML ensemble
   │  ├─ ensemble: Earned-weight ensemble
   │  ├─ signals: Signal layer
   │  ├─ linguistics: NEW - Token distribution
   │  ├─ shape: NEW - Shape projection
   │  └─ fxRegime: NEW - FX regime aggregation
   ├─ Apply earned weights from calibration
   ├─ Build calibrated mixture
   ├─ Apply range adjustments (regime, breakout, trend)
   ├─ Derive expected, range, quantiles, reach
   └─ Apply evidence gating
5. Cache and return forecast
```

### Component Registry

The forecast uses 11 components (10 from original robust + 3 new intel engines):

```typescript
export const COMPONENTS = [
  "baseline",
  "percentile",
  "markov",
  "dna",
  "band",
  "ml",
  "ensemble",
  "signals",
  "linguistics",    // NEW
  "shape",          // NEW
  "fxRegime",       // NEW
] as const;
```

Engine states control participation:
- `live`: Full weight in mixture
- `shadow`: Scored but zero weight (testing phase)
- `demoted`: Floor weight only

## Salvaged Intelligence Sources

### V6.4 Deep Jobs

**DNA Scan (`functions/v64.ts`)**
- Encodes rounds as DNA sequences (chroma/hue, tempo, band)
- Scans for k-mer patterns
- Maps patterns to historical outcomes
- **Integration**: Original `dna` engine already in forecast (not duplicated)

**Linguistics V2 (`functions/v64.ts`, `functions/analysis.ts`)**
- Multi-layer tokenization:
  - Band layer: <1.5x, 1.5-2x, 2-5x, 5-10x, 10-100x, 100x+
  - Chroma/hue layer: Dust, Rose, Gold, Jade, Sky, Plasma, Void
  - Streak layer: consecutive band outcomes
  - Transition layer: band-to-band transitions
  - Momentum layer: 3-round direction
  - Pressure layer: order flow bias
  - Shape layer: trend/acceleration classification
- **Integration**: New `linguistics` distribution engine maps recent tokens to band probabilities

**Shape Projection (`functions/v64.ts`, `functions/analysis.ts`)**
- Classifies recent trajectory: flat, rising, falling, arch, ramp, collapse
- Projects forward continuation
- Scores shape quality
- **Integration**: New `shape` distribution engine maps shape regimes to band probabilities

### V6.5 Research Features

**Regime Detection (`functions/v65.ts`)**
- Detects compressed vs expanded volatility regimes
- Tracks trend direction
- **Integration**: Used in range adjustment layer (regimeScale)

**Evidence Ledger (`functions/robust-evaluation.ts`)**
- Locked-holdout evaluation
- Demonstrated skill testing
- **Integration**: Already part of robust branch, preserved

### Analysis Functions

**Shape Analysis (`functions/analysis.ts`)**
- `shape(rounds, window)`: Classifies trajectory
- Returns classification, slope, acceleration, spread
- **Integration**: Used by `shapeDistribution` and range adjustments

**Linguistics (`functions/analysis.ts`)**
- `linguistics(rounds, depth)`: Multi-layer tokenization
- Returns recent tokens, token frequencies, layer statistics
- **Integration**: Used by `linguisticsTokenDistribution`

**Pressure (`functions/analysis.ts`)**
- Order flow bias calculation
- **Integration**: Part of signals layer (existing)

**Moonshot Scanner (`functions/analysis.ts`)**
- Detects moonshot conditions
- **Integration**: Part of signals layer (existing)

### FX Functions

**Volatility Profile (`functions/fx.ts`)**
- `volatilityProfile(rounds)`: Detects compressed/expanded regime
- Returns regime, volatility percentile, note
- **Integration**: Used by `fxDistribution` and range adjustments

**Trend Quality (`functions/fx.ts`)**
- `trendQuality(rounds)`: Detects trending vs ranging
- Returns direction, efficiency, classification
- **Integration**: Used by `fxDistribution` and range adjustments

**Mean Reversion (`functions/fx.ts`)**
- `meanReversion(rounds)`: Hurst exponent, z-score
- Returns reversion strength, interpretation
- **Integration**: Used by `fxDistribution`

**Order Flow (`functions/fx.ts`)**
- `orderFlow(rounds)`: Pressure bias
- Returns current z-score, note
- **Integration**: Used by `fxDistribution`

**Breakout (`functions/fx.ts`)**
- `breakout(rounds)`: Compression detection
- Returns compression percentile, break rates
- **Integration**: Used by `fxDistribution` and range adjustments

**Support Density (`functions/fx.ts`)**
- `supportDensity(rounds)`: Support/resistance levels
- **Integration**: Available but not currently used (commented out)

**Event Risk (`functions/fx.ts`)**
- `eventRisk(rounds)`: Anomaly detection
- **Integration**: Used by `fxDistribution`

**Correlation (`functions/fx.ts`)**
- `correlationEngine(rounds)`: Correlation structure
- **Integration**: Used by `fxDistribution`

## New Distribution Engines

### 1. Linguistics Distribution (`functions/analysis.ts`)

```typescript
export function linguisticsTokenDistribution(rounds: Round[]): number[]
```

**Methodology**:
1. Calculate baseline band shares from recent rounds
2. If insufficient data (<50 rounds), return baseline
3. Generate linguistic tokens from recent rounds (multi-layer)
4. Map recent tokens to historical band outcomes
5. Apply support-aware smoothing toward baseline
6. Return normalized six-band distribution

**Token Layers**:
- Band: <1.5x, 1.5-2x, 2-5x, 5-10x, 10-100x, 100x+
- Chroma: Dust, Rose, Gold, Jade, Sky, Plasma, Void
- Streak: consecutive band counts
- Transition: band-to-band changes
- Momentum: 3-round direction (up/down/flat)
- Pressure: order flow bias
- Shape: trajectory classification

**Prior**: 0.75 (moderate confidence)
**Current state**: Integrated into mixture, earned weight based on calibration

### 2. Shape Distribution (`functions/analysis.ts`)

```typescript
export function shapeDistribution(rounds: Round[]): number[]
```

**Methodology**:
1. Calculate baseline band shares
2. Classify recent trajectory (last 80 rounds)
3. Map shape classification to historical band frequencies
4. Apply smoothing based on sample size
5. Return normalized six-band distribution

**Shape Classifications**:
- flat: No clear direction
- rising: Positive slope, low acceleration
- falling: Negative slope, low acceleration
- arch: Positive then negative (peak)
- ramp: Accelerating upward
- collapse: Accelerating downward

**Prior**: 0.65 (lower confidence, more exploratory)
**Current state**: Integrated into mixture, earned weight based on calibration

### 3. FX Regime Distribution (`functions/fx.ts`)

```typescript
export function fxDistribution(rounds: Round[]): number[]
```

**Methodology**:
1. Call all FX signal functions:
   - `volatilityProfile()`: Compressed/expanded regime
   - `trendQuality()`: Trend direction and efficiency
   - `meanReversion()`: Hurst exponent, reversion strength
   - `orderFlow()`: Pressure bias
   - `breakout()`: Compression and break rates
   - `eventRisk()`: Anomaly detection
   - `correlationEngine()`: Correlation structure
2. Aggregate signals into a composite tilt score
3. Apply tilt to baseline distribution using exponential weighting
4. Normalize and return six-band distribution

**Signal Contributions**:
- Volatility regime: Compressed → wider range, Expanded → narrower range
- Trend direction: Up → upside bias, Down → downside bias
- Mean reversion: Extreme reversion → toward center
- Order flow: Positive flow → upside bias
- Breakout: High compression → upside bias if break likely
- Event risk: Anomalies → toward baseline
- Correlation: Structure dependence → adjust by regime

**Prior**: 0.75 (moderate confidence)
**Current state**: Integrated into mixture, earned weight based on calibration

## Range Adjustment Layer

### Implemented Adjustments

The range adjustment layer in `functions/intelligence.ts` applies the following modifications to the final range:

**1. Volatility Regime Scale**
```typescript
if (vol.regime === "compressed") {
  rangeScale *= 0.85;  // Tighten range
} else if (vol.regime === "expanded") {
  rangeScale *= 1.25;  // Widen range
}
```

**2. Breakout Scale**
```typescript
if (brk.compressionPercentile > 0.8) {
  if (brk.postCompressionBreakRate > brk.baseBreakRate * 1.1) {
    rangeScale *= 1.3;  // Widen for likely breakout
  } else {
    rangeScale *= 0.9;  // Tighten for failed squeeze
  }
}
```

**3. Trend Shift**
```typescript
trendShift = trend.direction === "up" ? 0.1 : trend.direction === "down" ? -0.1 : 0;
rangeLo = rangeLo * (1 - trendShift);
rangeHi = rangeHi * (1 + trendShift);
```

**4. DNA Pattern Tilt**
```typescript
const recentBands = rounds.slice(-10).map(r => bandIndex(r.multiplier));
const upsideBias = recentBands.filter(b => b >= 4).length >= 5 ? 0.15 : 0;
const downsideBias = recentBands.filter(b => b <= 1).length >= 5 ? -0.1 : 0;
if (upsideBias > 0) {
  rangeScale *= 1.15;
} else if (downsideBias < 0) {
  rangeScale *= 0.9;
}
```

**5. Final Clamp**
```typescript
rangeScale = clamp(rangeScale, 0.5, 2.0);
```

### Response Fields

The forecast includes `rangeAdjustments` in the intelligence block:

```typescript
{
  regimeScale: number,      // Volatility regime multiplier
  breakoutScale: number,    // Breakout adjustment multiplier
  trendShift: number,       // Trend direction shift
  dnaPatternTilt: number,   // DNA pattern adjustment
  finalScale: number        // Final applied multiplier
}
```

### Not Yet Integrated

The following adjustments were planned but commented out due to implementation complexity or insufficient data:

- **Support/resistance bounds**: Would use `supportDensity()` to constrain range lo/hi
- **Linguistics token tilt**: Would use recent bullish/bearish tokens to adjust range

These can be re-enabled when the underlying functions are better integrated.

## Calibration and Earned Weights

### Earned Weight System

The forecast uses Bayesian-mixture weights from trailing log-losses:

```typescript
weight ∝ prior · exp(-n_eff · ΔL)
```

Where:
- `prior`: Component prior confidence (0.65-1.0)
- `n_eff`: Effective sample size (ledger rows)
- `ΔL`: Log-loss difference vs baseline

### Component Priors

```typescript
const PRIOR: Record<ComponentKey, number> = {
  baseline: 1.0,      // Highest confidence (historical truth)
  percentile: 0.8,
  markov: 0.9,
  dna: 0.7,
  band: 0.9,
  ml: 0.6,
  ensemble: 0.8,
  signals: 0.6,
  linguistics: 0.75,  // NEW - moderate confidence
  shape: 0.65,        // NEW - lower confidence (exploratory)
  fxRegime: 0.75,     // NEW - moderate confidence
};
```

### Calibration Ledger

The `intel_calibrations` table stores:
- Raw mixture distribution
- Published distribution (after recalibration)
- Per-component probabilities
- Log-loss (raw and calibrated)
- Outcome band

New engines are automatically scored:
- Per-band loss tracked
- Weight adjusted based on performance
- Demoted if consistently underperforming

### Evidence Gating

The robust branch's locked-holdout evidence gate applies to the intel forecast:
- Engines must demonstrate skill on holdout rounds
- Confidence capped at LOW unless skill demonstrated
- Numbers never changed by gate (only labels)

## API Fields and Endpoints

### Forecast Endpoint

**GET /api/v1/intelligence/forecast** (also via /api/v1/pipeline/next-round)

**New/Modified Fields**:

```typescript
{
  // ... existing fields ...

  intelligence: {
    // ... existing fields ...

    components: [
      // ... existing components ...
      {
        key: "linguistics",
        label: "Linguistic token distribution (multi-layer language model)",
        weight: number,
        prior: 0.75,
        mid: number,
        p2: number,
        p10: number,
        distribution: number[6]
      },
      {
        key: "shape",
        label: "Shape projection distribution (trend/acceleration classification)",
        weight: number,
        prior: 0.65,
        mid: number,
        p2: number,
        p10: number,
        distribution: number[6]
      },
      {
        key: "fxRegime",
        label: "FX regime distribution (volatility + trend + mean reversion)",
        weight: number,
        prior: 0.75,
        mid: number,
        p2: number,
        p10: number,
        distribution: number[6]
      }
    ],

    rangeAdjustments: {
      regimeScale: number,
      breakoutScale: number,
      trendShift: number,
      dnaPatternTilt: number,
      finalScale: number
    }
  }
}
```

### Component Endpoint

**GET /api/v1/intelligence/components**

Returns all component engines with their current states, weights, and distributions.

## Frontend Updates

### Command Center (`web-momento/src/pages/dashboard/CommandCenter.tsx`)

**New Displays**:

1. **Component Cards**: Show linguistics, shape, and fxRegime engines alongside existing components
2. **Range Adjustment Badges**: Display active range adjustments:
   - Regime scale (e.g., "regime: ⊕25%" for expanded)
   - Breakout scale (e.g., "break: ⊕30%" for likely breakout)
   - Trend shift (e.g., "trend: +10%" for upward)
   - DNA pattern tilt (e.g., "dna: ⊕15%" for upside bias)
3. **Engine State Indicators**: Show live/shadow/demoted status for new engines

### Type Updates (`web-momento/src/lib/types.ts`)

**IntelligenceBlock** extended with:

```typescript
interface IntelligenceBlock {
  // ... existing fields ...

  rangeAdjustments?: {
    regimeScale: number;
    breakoutScale: number;
    trendShift: number;
    dnaPatternTilt: number;
    finalScale: number;
  };
}
```

## Testing and Verification

### Backend Tests

```bash
cd functions
npm test                    # Run unit tests
npm run build               # Verify TypeScript compiles
```

### Verification Steps

1. **Type Check**: Ensure no TypeScript errors
2. **Distribution Validation**:
   - Each distribution has exactly 6 probabilities
   - Probabilities are finite and non-negative
   - Probabilities sum to approximately 1
3. **Forecast Validation**:
   - Forecast endpoint returns valid JSON
   - Expected value and range are monotonic (rangeLo ≤ expected ≤ rangeHi)
   - Quantiles are monotonic
   - New components appear in forecast output
4. **Calibration Verification**:
   - New components participate in mixture weights
   - Calibration ledger scoring handles new keys
   - Earned weights adjust based on performance
5. **Range Adjustment Verification**:
   - Range adjustments respond to regime/signal changes
   - Final range scale is clamped to [0.5, 2.0]
   - Range remains consistent with quantiles

### API Verification

```bash
# Health check
curl http://localhost:8000/api/v1/health

# Forecast check
curl http://localhost:8000/api/v1/intelligence/forecast | jq .

# Calibration check
curl http://localhost:8000/api/v1/intelligence/calibrations | jq .

# Components check
curl http://localhost:8000/api/v1/intelligence/components | jq .
```

## Service Management

### Systemd Services

Three services manage the MomentoV6 system:

**momento-backend.service**
- REST API + SQLite on port 8000
- Exec: `/home/admin/node-v24.21.0-linux-x64/bin/node local-dev.mjs -p 8000`
- Unit file: `/etc/systemd/system/momento-backend.service`

**momento-console.service**
- Console UI on port 8080
- Exec: `/home/admin/node-v24.21.0-linux-x64/bin/node local-dev.mjs -p 8080`

**momento-feed.service**
- File feed watcher
- Polls `~/Downloads` every 5 seconds

### Restart Commands

```bash
# Restart backend
sudo systemctl restart momento-backend.service

# Restart all services
sudo systemctl restart momento-backend.service momento-console.service momento-feed.service

# Check status
sudo systemctl status momento-backend.service
sudo journalctl -u momento-backend.service -n 50
```

### Branch Switch Procedure

1. Commit or stash changes on current branch
2. Switch to target branch: `git checkout <branch>`
3. Copy data directory if needed: `cp -r /tmp/momento-data-backup/* data/`
4. Restart services: `sudo systemctl restart momento-backend.service`
5. Verify health: `curl http://localhost:8000/api/v1/health`

## Data Preservation

### Database

- SQLite database: `/home/admin/V6/MomentoV6/data/momento-v6.sqlite`
- Preserved across branch switches when data directory is copied
- Contains:
  - Round history
  - Calibration ledger (`intel_calibrations`)
  - Settings
  - Accuracy data

### Data Directory

- Location: `/home/admin/V6/MomentoV6/data/`
- Contains:
  - `momento-v6.sqlite` (main database)
  - Any additional data files

### Backup Procedure

```bash
# Backup before branch switch
cp -r data /tmp/momento-data-backup

# Restore after branch switch
cp -r /tmp/momento-data-backup/* data/
```

## Limitations and Considerations

### Intelligence Limitations

1. **Sample Size Requirements**:
   - Linguistics: Requires ≥50 rounds for meaningful distribution
   - Shape: Requires ≥80 rounds for classification
   - FX: Requires ≥100 rounds for stable regime detection

2. **Support-Aware Smoothing**:
   - New engines shrink toward baseline when evidence is weak
   - Prevents over-weighting of sparse patterns

3. **Evidence Gating**:
   - New engines must demonstrate skill on holdout rounds
   - Confidence capped at LOW until skill is demonstrated
   - Does not change forecast numbers, only labels

4. **Range Adjustments**:
   - Currently limited to regime, breakout, trend, and DNA
   - Support/resistance and linguistics tilts commented out
   - Adjustments are clamped to prevent extreme ranges

### Calibration Limitations

1. **Earned Weight Latency**:
   - New engines start with prior weight
   - Takes time to earn higher/lower weights based on performance
   - Minimum 100 scored rounds for stable weights

2. **Recalibration Window**:
   - Default 1000 resolved rounds
   - New engines need time to accumulate calibration data

### Future Enhancements

1. **Re-enable Support/Resistance**:
   - Integrate `supportDensity()` into range adjustments
   - Constrain range lo/hi based on nearby levels

2. **Linguistics Range Tilt**:
   - Use recent bullish/bearish tokens to adjust range
   - Separate from distribution (range-only adjustment)

3. **Enhanced DNA Integration**:
   - Consider separate `dnaPattern` engine if statistical significance proven
   - Currently using original `dna` engine to avoid duplication

4. **FX Signal Expansion**:
   - Add more FX signals to distribution
   - Improve signal aggregation logic

## Operational Procedures

### Initial Boot

1. Start services: `sudo systemctl start momento-backend.service`
2. Wait for bootstrap (~5-10 seconds)
3. Verify health: `curl http://localhost:8000/api/v1/health`
4. Check forecast: `curl http://localhost:8000/api/v1/pipeline/next-round`

### Calibration Warm-up

1. Forecast starts with raw mixture (no recalibration)
2. After 150 rounds (default `intel_backtest_rounds`), recalibration tested
3. After 1000 resolved rounds, full recalibration window available
4. New engines accumulate calibration data over time

### Monitoring

1. **Component Weights**: Monitor via `/api/v1/intelligence/components`
2. **Calibration Status**: Monitor via `/api/v1/research/recalibration`
3. **Evidence Status**: Monitor via `/api/v1/research/evidence`
4. **Range Adjustments**: Check `rangeAdjustments` in forecast response

### Troubleshooting

**Forecast fails with "normalize is not defined"**:
- Check that `normalize` is exported from `analysis.ts`
- Verify imports in `intelligence.ts`

**Component missing from forecast**:
- Check component is in `COMPONENTS` array
- Verify component has entry in `COMPONENT_LABEL` and `PRIOR`
- Check distribution function is imported and called

**Range adjustments not applying**:
- Check that FX/volatility functions are imported
- Verify signal objects are not null/undefined
- Check range adjustment logic is not commented out

**Service restart loop**:
- Check journalctl for build errors: `journalctl -u momento-backend.service -n 100`
- Verify TypeScript compiles: `cd functions && npm run build`
- Check for duplicate declarations or missing exports

## Summary

The intel branch successfully integrates sidelined intelligence into a unified platform-driven forecast:

✅ **Three new distribution engines**: linguistics, shape, fxRegime
✅ **Range adjustment layer**: Regime, breakout, trend, DNA pattern tilts
✅ **Calibration integration**: New engines earn weights through performance
✅ **Evidence gating**: Maintains robust branch's locked-holdout validation
✅ **Frontend updates**: Command Center displays new intelligence
✅ **Data preservation**: Existing database and data preserved
✅ **Service stability**: All systemd services operational

The forecast now uses a more comprehensive set of intelligence sources while maintaining the robust branch's calibration and evidence validation framework.
