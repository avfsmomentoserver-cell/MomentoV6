// Shared DTOs for the Momento backend API.

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface RoundDto {
  id: number;
  ts: string;
  multiplier: number;
  color: string | null;
  source: string;
  session_id: number | null;
  /** anchor trajectory information */
  anchor?: {
    isPeak: boolean;
    left?: number;
    right?: number;
    size?: number;
    phase?: "forming" | "released" | "idle";
    potential?: number;
    roundsSincePeak?: number;
  };
}

export interface Overview {
  count: number;
  mean: number;
  median: number;
  max: number;
  min: number;
  firstTs: string | null;
  lastTs: string | null;
  sessions: number;
  q10: number;
  q25: number;
  q75: number;
  q90: number;
  q95: number;
  q99: number;
}

export interface ExceedanceRow {
  threshold: number;
  hits: number;
  rate: number;
  ci: [number, number];
  etaMedian: number | null;
  etaP90: number | null;
  currentRun: number;
}

export interface Streaks {
  threshold: number;
  current: number;
  currentKind: "above" | "below";
  maxBelow: number;
  maxAbove: number;
  conditional: { streak: number; n: number; rate: number; ci: [number, number] }[];
  markov: { pStayBelow: number; pJump: number; nBelow: number; nAbove: number };
  postHigh: { rate: number; n: number };
  continuationProb: number | null;
  expectedDuration: number | null;
}

export interface Bands {
  counts: number[];
  shares: number[];
  transition: number[][];
  chiSquare: number;
  independent: boolean;
}

export interface Pressure {
  powerLaw: { a: number; b: number; fitFrom: number };
  targets: { target: number; rate: number; etaMedian: number | null; etaP90: number | null; currentRun: number; pressurePct: number }[];
  overallPressure: number;
  status: "calm" | "building" | "loaded" | "critical";
}

export interface Shape {
  classification: string;
  slope: number;
  acceleration: number;
  skewness: number;
  kurtosis: number;
  dryZone: { active: boolean; severity: number; window: number; threshold: number };
  pareto: { alpha: number; ks: number; pValue: number; plausibility: string };
  eta: { target: number; median: number | null; band: [number, number] | null }[];
  trajectory: { group: string; forwardMedian: number };
}

export interface Moonshot {
  imminent: boolean;
  confidence: number;
  factors: Record<string, number | boolean>;
  historical: { count100: number; count1000: number; max: number };
  narrative: string;
}

export interface Ceiling {
  level: number;
  archetype: string;
  touches: number;
  lastTouchIndex: number;
  withinTolerance: number;
}

export interface Ladder {
  startIndex: number;
  endIndex: number;
  length: number;
  band: string;
  values: number[];
}

export interface Analysis {
  source: string;
  generatedAt: string;
  overview: Overview;
  exceedance: ExceedanceRow[];
  streaks: Streaks;
  bands: Bands;
  pressure: Pressure;
  shape: Shape;
  moonshot: Moonshot;
  gaps: ExceedanceRow[];
  houseEdge: { observedMean: number; impliedFair: number; estimatedEdge: number; evTable: { threshold: number; p: number; ev: number }[] };
  ladders: { ladders: Ladder[]; current: Ladder | null; histogram: Record<number, number> };
  ceilings: { levels: Ceiling[]; dominant: Ceiling | null };
}

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  n: number;
}

export interface SessionPhase {
  sessionId: number;
  started: string;
  ended: string;
  rounds: number;
  max: number;
  mean: number;
  p2: number;
  phase: string;
}

export interface SourceDto {
  id: number;
  name: string;
  label: string;
  kind: string;
  rounds: number;
  last_round: string | null;
}

export interface ForecastDto {
  id: number;
  source: string;
  model: string;
  threshold: number;
  probability: number;
  note: string | null;
  created_ms: number;
  resolved_ms: number | null;
  actual: number | null;
  brier: number | null;
}

export interface ForecastAccuracy {
  total: number;
  open: number;
  resolved: number;
  brier: number | null;
  perModel: { model: string; n: number; brier: number; hitRate: number }[];
  recent: ForecastDto[];
}

export interface VocabItem {
  id: number;
  token: string;
  layer: string;
  layers: string[];
  definition: string;
  status: string;
  uses: number;
  hits: number;
  misses: number;
  score: number;
  created_ms: number;
  updated_ms: number;
}

export interface LinguisticRound {
  token: string;
  layers: string[];
  multiplier: number;
  ts: string;
}

export interface ReleaseDto {
  id?: number;
  version: string;
  filename: string;
  url: string;
  sha256?: string;
  notes?: string | null;
  created_ms?: number;
}

export interface PluginDto {
  id: number;
  key: string;
  name: string;
  category: string;
  description: string;
  weight: number;
  enabled: number;
  config: string;
  runs: number;
}

export interface UserDto {
  id: number;
  email: string;
  name: string;
  role: string;
  created_ms?: number;
  disabled?: number;
}

export interface AuditRow {
  id: number;
  actor: string;
  action: string;
  target: string | null;
  meta: string | null;
  created_ms: number;
}

export interface Verdict {
  threshold: number;
  rate: number;
  ci: [number, number];
  brierBase: number;
  brierEnsemble: number;
  lift: number;
  verdict: string;
  models: { name: string; brier: number; lift: number }[];
}

export interface RangeLab {
  dataset: { rounds: number; source: string };
  reference: { threshold: number; rate: number; etaMed: number; etaP90: number; brierBase: number; lift: number; verdict: string }[];
  live: { verdicts: Verdict[]; leaderboard: { name: string; brier: number; lift: number }[]; split: { train: number; test: number; warmup: number } } | null;
  liveThresholds: number[];
}

export interface Calibration {
  dataset: { rounds: number; mean: number; median: number; max: number };
  reference: { dataset: { rounds: number; sessions: number; mean: number; median: number; max: number }; exceedance: Record<string, number>; tail: { a: number; b: number } };
  exceedance: ExceedanceRow[];
  tail: { a: number; b: number; fitFrom: number };
  postHigh: { rate: number | null; reference: number; n: number };
  checks: { threshold: number; referencePct: number; livePct: number | null; deltaPct: number | null; match: boolean }[];
  allMatch: boolean;
}

export interface OrchestratorState {
  settings: { patience: number; speed: string; risk: string; minConfidence: number };
  state: { streak: number; streakKind: string; dryZone: boolean; tailPressure: number; lastRound: RoundDto | null };
  guidance: { action: "enter" | "skip"; confidence: number; reason: string; mistakes: string[] };
}

export interface AutopilotDecision {
  id: number;
  source: string;
  round_id: number | null;
  decision: string;
  threshold: number | null;
  confidence: number | null;
  reason: string;
  stake: number;
  pnl: number;
  resolved: number;
  created_ms: number;
}

export interface DocMeta {
  slug: string;
  title: string;
  section: string;
  summary: string;
  audience: string;
}

// ---- v6: FX analysis lab -------------------------------------------------

export interface FxSignal {
  key: string;
  label: string;
  value: string;
  dir: number;
  note: string;
}

export interface AcfRow {
  lag: number;
  acf: number;
  significant: boolean;
}

export interface CorrelationEngine {
  n: number;
  logAcf: AcfRow[];
  flagAcf: AcfRow[];
  ljungBoxLog: number;
  ljungBoxFlag: number;
  note: string;
}

export interface VolatilityProfile {
  currentVol: number;
  volPercentile: number;
  ewmaVol: number;
  volOfVol: number;
  regime: "compressed" | "normal" | "expanded";
  series: { t: string; vol: number }[];
  hourly: { hour: string; vol: number }[];
  note: string;
}

export interface OrderFlow {
  bucket: number;
  buckets: { t: string; buy: number; sell: number; imbalance: number }[];
  cumulative: { t: string; cvd: number }[];
  currentImbalance: number;
  currentZ: number;
  note: string;
}

export interface SupportDensity {
  current: number;
  bins: { from: number; to: number; count: number }[];
  supports: { level: number; touches: number }[];
  resistances: { level: number; touches: number }[];
  nearestSupport: number | null;
  nearestResistance: number | null;
  note: string;
}

export interface Breakout {
  window: number;
  horizon: number;
  rangeNow: number;
  compressionPercentile: number;
  series: { t: string; range: number }[];
  postCompressionBreakRate: number;
  baseBreakRate: number;
  sample: number;
  note: string;
}

export interface MeanReversion {
  hurst: number;
  varianceRatios: { q: number; vr: number }[];
  ar1: number;
  halfLife: number | null;
  zScore: number;
  interpretation: string;
}

export interface TrendQuality {
  efficiency: number;
  r2: number;
  direction: "up" | "down" | "flat";
  classification: "trending" | "ranging";
  series: { t: string; eff: number }[];
  note: string;
}

export interface EventRisk {
  extremeThreshold: number;
  anomalyRate: number;
  sinceLastExtreme: number | null;
  zNow: number;
  anomalies: { ts: string; multiplier: number; z: number }[];
  note: string;
}

export interface DivergenceRow {
  source: string;
  rounds: number;
  divergences: { threshold: number; rate: number; base: number; deltaPct: number }[];
  score: number;
}

export interface FxPayload {
  source: string;
  generatedAt: string;
  rounds: number;
  signals: FxSignal[];
  correlation: CorrelationEngine;
  volatility: VolatilityProfile;
  orderFlow: OrderFlow;
  density: SupportDensity;
  breakout: Breakout;
  reversion: MeanReversion;
  trend: TrendQuality;
  events: EventRisk;
  divergence: DivergenceRow[];
}

// ---- v6: prediction pipeline ----------------------------------------------

export interface ProbabilityComponent {
  model: string;
  p: number;
  weight: number;
}

export interface PipelinePrediction {
  threshold: number;
  probability: number;
  baselineRate: number;
  perRound: { p: number; baseRate: number; components: ProbabilityComponent[]; note: string };
  currentRun: number;
}

export interface PipelineWindow {
  window: string;
  label: string;
  expectedRounds: number;
  predictions: PipelinePrediction[];
}

export interface PipelineForecast {
  source: string;
  generatedAt: string;
  cadenceMs: number;
  weights: Record<string, number>;
  windows: PipelineWindow[];
  inverted?: InvertedForecast;
}

export interface ForecastEvidence {
  version: string;
  status: "insufficient-data" | "no-demonstrated-skill" | "demonstrated-skill";
  reason: string;
  dataCutoffMs: number | null;
  ledgerWindow: number;
  trainingSample: number;
  holdoutSample: number;
  rejectedSample: number;
  recalibrationActive: boolean;
  quantileRecalibrationActive: boolean;
  recalibrationReason: string;
  logLoss: { raw: number | null; published: number | null; baseline: number | null };
  baselineSkillPct: number | null;
  meanBrierSkillPct: number | null;
  coverage50: number | null;
  rangeCoverage?: number | null;
  rangeProfile?: string;
  rangeNominal?: number;
  thresholds: { threshold: number; predicted: number; observed: number; brierSkillPct: number | null }[];
  confidenceGated: boolean;
  confidenceLabelUngated: "HIGH" | "MEDIUM" | "LOW" | null;
}

export interface NextRoundForecast {
  source: string;
  generatedAt: string;
  cadenceMs: number;
  state: MarketState;
  confidence: number;
  confidenceLabel: "HIGH" | "MEDIUM" | "LOW";
  expectedMultiplier: number;
  rangeLo: number;
  rangeHi: number;
  band: string;
  distribution: { label: string; edge: number; probability: number; representative: number }[];
  baseMultiplier: number;
  tailLift: number;
  moonshotReach: number;
  /** headline range profile (default "loose" = p15–p85, ~70% of rounds) */
  rangeProfile?: { name: "tight" | "loose" | "wide"; lo: number; hi: number; reach: number; nominal: number; label: string };
  /** how expected and the range were read off the distribution (point-range.ts) */
  pointRange?: { pointMethod: "median" | "geomean" | "trimmed"; intervalMethod: "central" | "shortest"; coverage: number; nominal: number; adaptive: boolean; sample: number; median: number; reason: string };
  /** exact quantiles of the published distribution */
  quantiles?: { p05: number; p10: number; p15: number; p25: number; p50: number; p75: number; p85: number; p90: number; p95: number };
  rectification: { active: boolean; factor: number; biasPct: number; sampleSize: number; note: string } | null;
  lastRound: { multiplier: number; band: string };
  components: (ProbabilityComponent & { mid: number })[];
  note: string;
  /** v6.3 full-intelligence fields (absent on the legacy /next-round/band payload) */
  engine?: "full-intelligence-v6.3";
  predictedState?: MarketState;
  predictedBand?: string;
  horizon?: number;
  stateConviction?: number;
  stateScores?: Record<MarketState, number>;
  candidates?: IntelCandidate[];
  transitionMatrix?: Record<MarketState, Record<MarketState, number>>;
  blend?: Record<string, number>;
  intelligence?: IntelligenceBlock;
  /** robust: locked chronological holdout evidence (functions/robust-evaluation.ts) */
  evidence?: ForecastEvidence;
}

// ---- v6.3: full-intelligence forecast ------------------------------------

export type MarketState = "Normal" | "Moonshot" | "Ignition" | "Collapse" | "Exhaustion" | "Bait" | "Shelf";

export interface IntelCandidate {
  state: MarketState;
  probability: number;
  rangeLo: number;
  rangeHi: number;
  survival: number;
  label: string;
  color: string;
  note: string;
}

export interface IntelComponent {
  key: string;
  label: string;
  weight: number;
  prior: number;
  mid: number;
  p2: number;
  p10: number;
  distribution: number[];
  logLoss: number | null;
  samples: number;
  confidence?: number;  // Confidence score for adaptive engines
}

export interface IntelSignal {
  engine: string;
  reading: string;
  direction: number;
  note: string;
}

export interface IntelHorizonRow {
  threshold: number;
  perRound: number;
  baseline: number;
  withinHorizon: number;
  etaMedian: number | null;
  etaP90: number | null;
  currentRun: number;
}

export interface IntelExhaustionBand {
  threshold: number;
  rate: number;
  expectedGap: number | null;
  roundsSince: number;
  overdueRatio: number;
  exhaustion: number;
  status: "overdue" | "due" | "fresh";
}

export interface IntelCalibrationInfo {
  distributionActive: boolean;
  quantileActive: boolean;
  gamma: number;
  tau: number;
  levels: { rangeLo: number; expected: number; rangeHi: number; reach: number };
  sample: number;
  validSample: number;
  validRawLogLoss: number | null;
  validCalLogLoss: number | null;
  improvementPct: number | null;
  coverageRaw: number | null;
  coverageCal: number | null;
  crash: { raw: number; calibrated: number; observed: number };
  legacyCorrection: boolean;
  modeBand: string;
  reason: string;
}

export interface IntelligenceBlock {
  components: IntelComponent[];
  agreement: number;
  calibratedHitRate: number | null;
  skillPct: number | null;
  calibrationSample: number;
  signals: IntelSignal[];
  dna: {
    signature: string[];
    matchCount: number;
    confidence: number;
    outcomes: { count: number; median: number; p75: number; p90: number; over2: number; over5: number; over10: number } | null;
    matches: { index: number; similarity: number; next: number }[];
  };
  exhaustion: { bands: IntelExhaustionBand[]; mostOverdue: IntelExhaustionBand | null };
  ladders: {
    ladderCount: number;
    moonshotProbability: number;
    releaseCorrelation: number;
    etaToMoonshot: number;
    pressureScore: number;
    releasePrediction: string;
    currentLadder: { type: string; length: number } | null;
    compressionNearRelease: boolean;
    etaAdjustment: number;
  };
  ml: {
    features: Record<string, number>;
    predictions: Record<string, { model: number; empirical: number; blended: number; edge: number }>;
  };
  percentiles: Record<string, number>;
  horizonOutlook: IntelHorizonRow[];
  regime: { label: string; volatility: number; drift: number };
  independence: { chiSquare: number; independent: boolean };
  honesty: string;
  /** predictor: how the headline was derived from the out-of-sample calibrated distribution */
  calibration?: IntelCalibrationInfo;
  /** blend mids for all engines including new intelligence engines */
  blend: {
    markovMid: number;
    percentileMid: number;
    dnaMid: number;
    bandMid: number;
    mlMid: number;
    ensembleMid: number;
    signalsMid: number;
    baselineMid: number;
    dnaPatternMid: number;
    linguisticsMid: number;
    shapeMid: number;
    fxRegimeMid: number;
    laddersMid: number;
    resistanceMid: number;
  };
  /** comprehensive range adjustment layer */
  rangeAdjustments: {
    regimeScale: number;
    supportResistanceAdj: boolean;
    breakoutScale: number;
    trendShift: number;
    dnaPatternTilt: number;
    linguisticsTilt: number;
    tailLiftTrajectory: number;
    momentumSpeed: number;
    finalScale: number;
  };
  /** collapse, ascend, and resistance forecast data */
  collapseAscendResistance?: {
    collapse: { active: boolean; run: number; strength: number; ceiling: number };
    ascend: { active: boolean; length: number; strength: number; slope: number; floor: number };
    resistance: { levels: Array<{ level: number; archetype: string; touches: number }>; dominant: { level: number; archetype: string; touches: number } | null };
    anchorPhase: "forming" | "released" | "idle";
    anchorPotential: number | null;
  };
}

export interface IntelCalibrationRow {
  id: number;
  state: string;
  expected: number;
  range_lo: number;
  range_hi: number;
  reach: number;
  confidence: number;
  correction: number;
  dist: number[] | null;
  weights: Record<string, number> | null;
  comp_loss: Record<string, number> | null;
  mix_loss: number | null;
  base_loss: number | null;
  actual: number | null;
  verdict: string;
  reason: string;
  band_err: number;
  log_err: number;
  created_ms: number;
}

export interface IntelCalibrationSummary {
  rows: IntelCalibrationRow[];
  verdicts: Record<string, number>;
  ledger: {
    logLoss: Record<string, number>;
    sample: number;
    mixLogLoss: number | null;
    baseLogLoss: number | null;
    hitRate: number | null;
  };
  correction: number;
  correctionSample: number;
  components: string[];
}

export interface RoundCalibration {
  id: number;
  state: string;
  expected: number;
  range_lo: number;
  range_hi: number;
  reach: number;
  tail_lift: number;
  correction: number;
  dist: { label: string; edge: number; probability: number; representative: number }[] | null;
  actual: number | null;
  verdict: string;
  reason: string;
  band_err: number;
  log_err: number;
  created_ms: number;
  resolved_ms: number | null;
}

export interface CalibrationSummary {
  rows: RoundCalibration[];
  verdicts: Record<string, number>;
  correction: number;
  correctionNote: string;
  backtestDone: boolean;
}

// ---- v6: accuracy engine v2 ------------------------------------------------

export interface ScheduledPrediction {
  id: number;
  source: string;
  window: string;
  threshold: number;
  model: string;
  probability: number;
  per_round: number;
  expected_rounds: number;
  components: string | null;
  created_ms: number;
  due_ms: number;
  resolved_ms: number | null;
  actual: number | null;
  outcome_rounds: number | null;
  brier: number | null;
  logloss: number | null;
}

export interface LedgerRow {
  model: string;
  window: string;
  threshold: number;
  n: number;
  brier_sum: number;
  base_sum: number;
  logloss_sum: number;
  hits: number;
  rounds_scanned: number;
  updated_ms: number;
  brier: number | null;
  base: number | null;
  hitRate: number | null;
}

export interface EngineWeight {
  model: string;
  skill: number;
  weight: number;
  updated_ms: number;
}

export interface AccuracyHistoryPoint {
  id: number;
  window: string;
  threshold: number;
  ts: number;
  cumulative_n: number;
  cumulative_brier: number;
  cumulative_base: number;
  hit_rate: number;
}

export interface AccuracyConfig {
  enabled: boolean;
  windows: { id: string; label: string; ms: number }[];
  thresholds: number[];
}

export interface AccuracyOverview {
  config: AccuracyConfig;
  cadenceMs: number;
  lastTickMs: number;
  totals: {
    scheduled: number;
    open: number;
    resolved: number;
    ledgerN: number;
    brier: number | null;
    base: number | null;
    liftPct: number | null;
    hitRate: number | null;
  };
  ledger: LedgerRow[];
  perWindow: LedgerRow[];
  weights: EngineWeight[];
  history: AccuracyHistoryPoint[];
  open: ScheduledPrediction[];
  recent: ScheduledPrediction[];
}

export interface VerifyModelScore {
  model: string;
  blocks: number;
  brier: number;
  logloss: number;
  hitRate: number;
}

export interface VerifyRun {
  window: string;
  label: string;
  blockSize: number;
  threshold: number;
  blocks: number;
  brier: number;
  brierBase: number;
  logloss: number;
  hitRate: number;
  liftPct: number;
  verdict: "accepted" | "insufficient" | "rejected";
  models: VerifyModelScore[];
}

export interface VerifyResult {
  runs: VerifyRun[];
  scanned: number;
  blocks: number;
  cadenceMs: number;
  generatedAt: string;
}

// ---- v6.2: momentum & structure lab ----------------------------------------

export interface HitPointBucket {
  t: number;
  count: number;
  open: number;
  high: number;
  low: number;
  close: number;
  rawEnergy: number;
  energy: number;
  megaCount: number;
}

export interface AnchorPoint {
  peakIdx: number;
  peak: number;
  peakTsMs: number;
  left: number;
  right: number;
  size: number;
}

export interface AnchorStats {
  recent: AnchorPoint[];
  count: number;
  medianPeak: number;
  medianSize: number;
  direction: {
    sampled: number;
    pctUpward: number | null;
    nextMean: number | null;
    globalMean: number;
    bySize: { band: string; n: number; pctUpward: number | null; nextMean: number | null }[];
  };
  state: {
    phase: "forming" | "released" | "idle";
    risingRun: number;
    roundsSincePeak: number | null;
    lastPeak: number | null;
    potential: number | null;
  };
}

export interface RangeMomentum {
  id: string;
  min: number;
  hits: number;
  hitRate: number;
  medianGap: number;
  recentGap: number | null;
  momentum: number | null;
  trend: "accelerating" | "steady" | "cooling" | "calm";
  currentRun: number;
  medianGapMs: number;
}

export interface MoonshotCondition {
  key: string;
  label: string;
  median: number;
  p25: number;
  p75: number;
  current: number | null;
  met: boolean | null;
}

export interface MoonshotProfile {
  threshold: number;
  hits: number;
  share: number;
  conditions: MoonshotCondition[];
  readiness: number | null;
  note: string;
}

export interface RangeBand {
  id: string;
  min: number;
  max: number;
  hits: number;
  rate: number;
  medianGap: number;
  perRound: number;
  windows: { window: string; label: string; probability: number }[];
}

export interface InvertedReading {
  threshold: number;
  invertedPerRound: {
    p: number;
    baseRate: number;
    components: { model: string; p: number; weight: number }[];
    note: string;
  };
  dipProbability: number;
}

export interface InvertedForecast {
  anchor: number;
  tailRounds: number;
  windows: { window: string; label: string; expectedRounds: number; readings: InvertedReading[] }[];
  note: string;
}

export interface AssessmentPrediction {
  id: number | string;
  window: string;
  threshold: number;
  p: number;
  progress: number;
  roundsSoFar: number;
  maxSeen: number;
  hitYet: boolean;
  onPace: number;
  verdictNow: "cleared" | "watching" | "expired";
}

export interface AssessmentResult {
  predictions: AssessmentPrediction[];
  buckets: { tested: number; agreement: number | null; driftIndex: number | null };
  generatedAt: string;
}

export interface MomentumOverview {
  source: string;
  generatedAt: string;
  rounds: number;
  bucketMs: number;
  hitPoints: HitPointBucket[];
  anchors: AnchorStats;
  momentum: RangeMomentum[];
  moonshot: MoonshotProfile;
  rangeForecast: RangeBand[];
  inverted: InvertedForecast;
}
