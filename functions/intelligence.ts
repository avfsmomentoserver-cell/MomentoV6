// functions/intelligence.ts — Full-Intelligence next-round forecast (v6.3).
//
// The V5.01-backtd forecast engine (Markov state transitions + empirical
// percentiles + DNA analogue matching + ladder release + band exhaustion +
// logistic ML ensemble, blended into one state / expected / range headline)
// rebuilt on top of every v6 engine (band-partition model, earned-weight
// per-round ensemble, moonshot scanner, mega pressure, ShapeShifters, FX lab,
// range momentum, moonshot research).
//
// Every engine emits a full next-round distribution over the six v6 bands.
// The final forecast is a Bayesian mixture of those distributions whose
// weights are EARNED from the calibration ledger (log-score of each engine on
// rounds it had to forecast before they landed). An engine with no demonstrated
// skill decays toward the floor; the measured baseline is always kept in the
// mix, so the forecast is honest when the tape carries no signal.
//
// Pure module: rounds in, forecast out. No I/O.

import type { ForecastEvidence } from "./robust-evaluation";
import { interval as pointRangeInterval, pointEstimate, type PointRangeSelection } from "./point-range";
import {
  BAND_EDGES,
  BAND_LABELS,
  bandIndex,
  bandShares,
  bands as bandsOf,
  dnaPatternDistribution,
  linguistics,
  linguisticsTokenDistribution,
  medianWait,
  moonshot as moonshotOf,
  normalize,
  percentileWait,
  pressure as pressureOf,
  shape as shapeOf,
  shapeDistribution,
  streaks as streaksOf,
  type Round,
} from "./analysis";
import { breakout, fxDistribution, meanReversion, trendQuality, volatilityProfile, type VolatilityProfile } from "./fx";
import { moonshot as moonshotResearch, rangeMomentum } from "./momentum";
import { medianIntervalMs, nextRoundForecast, perRoundProbability } from "./pipeline";
import {
  applyDistribution,
  identityRecalibrator,
  mapLevel,
  rangeProfile,
  survivalAt as survivalAtThreshold,
  type RangeProfileName,
  type Recalibrator,
} from "./calibration";

// ------------------------------------------------------------------ helpers

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const r2 = (v: number) => +v.toFixed(2);
const r3 = (v: number) => +v.toFixed(3);
const r4 = (v: number) => +v.toFixed(4);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pstdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};
function pct(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Six v6 bands: <1.5, 1.5–2, 2–5, 5–10, 10–100, 100+. */
const NB = BAND_LABELS.length;
const EDGES = [1, ...BAND_EDGES, Infinity];

// ---------------------------------------------------- V5 settings (defaults)

export const V5_SETTINGS = {
  ladderMinLength: 3,
  ladderTolerance: 0.06,
  collapseMinLength: 3,
  lowBand: 2.0,
  ignition: 5.0,
  moonshot: 10.0,
  megaMoonshot: 50.0,
  shelfWindow: 12,
  shelfVariance: 0.35,
  baitSpikeRatio: 2.2,
  volatilityWindow: 30,
  dnaWindow: 8,
  dnaTolerance: 0.85,
  confidenceFloor: 0.05,
  horizon: 5,
};
const S = V5_SETTINGS;

// ------------------------------------------------ V5 linguistic vocabulary

/** V5 layer-1 bands (DNA alphabet). */
const V5_BANDS = [
  { key: "dust", lo: 1.0, hi: 1.2 },
  { key: "floor", lo: 1.2, hi: 1.5 },
  { key: "low", lo: 1.5, hi: 2.0 },
  { key: "base", lo: 2.0, hi: 3.0 },
  { key: "mid", lo: 3.0, hi: 5.0 },
  { key: "high", lo: 5.0, hi: 10.0 },
  { key: "ignition", lo: 10.0, hi: 20.0 },
  { key: "moonshot", lo: 20.0, hi: 50.0 },
  { key: "mega", lo: 50.0, hi: 100.0 },
  { key: "cosmic", lo: 100.0, hi: Infinity },
];
function v5BandIndex(m: number): number {
  const v = Math.max(1, m);
  for (let i = 0; i < V5_BANDS.length; i++) if (v >= V5_BANDS[i].lo && v < V5_BANDS[i].hi) return i;
  return V5_BANDS.length - 1;
}

/** V5 Momento scaler — 100 points == 1.00x, every doubling adds 30 points. */
const toPoints = (m: number) => 100 + Math.log2(Math.max(1, m)) * 30;
const fromPoints = (p: number) => Math.pow(2, (p - 100) / 30);

export const STATES = ["Normal", "Collapse", "Ignition", "Moonshot", "Exhaustion", "Shelf", "Bait"] as const;
export type MarketState = (typeof STATES)[number];

export const STATE_META: Record<MarketState, { tone: string; color: string; meaning: string }> = {
  Normal: { tone: "neutral", color: "#8b95b7", meaning: "Balanced distribution, no dominant pressure" },
  Collapse: { tone: "bear", color: "#ef4444", meaning: "Descending ceilings, energy draining out of the curve" },
  Ignition: { tone: "bull", color: "#2ee6c0", meaning: "Compression released, upside energy building" },
  Moonshot: { tone: "bull", color: "#38bdf8", meaning: "High band cleared, extended run in progress" },
  Exhaustion: { tone: "bear", color: "#f59e0b", meaning: "Upside spent, mean reversion likely" },
  Shelf: { tone: "neutral", color: "#a3a3a3", meaning: "Flat variance shelf, market coiling" },
  Bait: { tone: "warn", color: "#fb923c", meaning: "Single spike inside weakness — false invitation" },
};

function energyOf(m: number): string {
  if (m < 1.3) return "snuffed";
  if (m < 2) return "damp";
  if (m < 3) return "steady";
  if (m < 6) return "charged";
  if (m < 15) return "surging";
  if (m < 50) return "explosive";
  return "runaway";
}
function shapeWord(window: number[]): string {
  if (window.length < 3) return "seed";
  const pts = window.map(toPoints);
  const h = Math.floor(pts.length / 2);
  const delta = mean(pts.slice(h)) - mean(pts.slice(0, h));
  const spread = Math.max(...pts) - Math.min(...pts);
  if (spread < 12) return "shelf";
  if (delta > 10) return "ramp";
  if (delta < -10) return "slide";
  const peak = pts.indexOf(Math.max(...pts));
  return peak === 0 || peak === pts.length - 1 ? "edge-spike" : "arch";
}

// ------------------------------------------------------ V5 signal detectors

interface Signals {
  asc: { active: boolean; length: number; strength: number; slope: number; floor: number };
  col: { active: boolean; run: number; strength: number; ceiling: number };
  nested: { detected: boolean; compression: number };
  shelf: { active: boolean; strength: number; level: number };
  bait: { active: boolean; strength: number; spike: number; ratio: number };
}

function ascendingLadder(m: number[]): Signals["asc"] {
  if (m.length < 2) return { active: false, length: 0, strength: 0, slope: 0, floor: 1 };
  const pts = m.map(toPoints);
  let length = 1;
  let floor = pts[pts.length - 1];
  const tol = S.ladderTolerance * 100;
  for (let i = pts.length - 2; i >= 0; i--) {
    if (pts[i] <= floor + tol) { length++; floor = Math.min(floor, pts[i]); } else break;
  }
  const win = pts.slice(-length);
  const slope = length > 1 ? (win[win.length - 1] - win[0]) / (length - 1) : 0;
  const active = length >= S.ladderMinLength && slope > 0;
  const pressure = active ? clamp(length / 12) : clamp(length / 24);
  return { active, length, strength: clamp(pressure * 0.6 + clamp(slope / 20) * 0.4), slope: r3(slope), floor: r2(fromPoints(floor)) };
}

function collapseLadder(m: number[]): Signals["col"] {
  if (m.length < 2) return { active: false, run: 0, strength: 0, ceiling: 1 };
  const pts = m.map(toPoints);
  let run = 1;
  let ceiling = pts[pts.length - 1];
  for (let i = pts.length - 2; i >= 0; i--) {
    if (pts[i] >= ceiling) { run++; ceiling = Math.max(ceiling, pts[i]); } else break;
  }
  return { active: run >= S.collapseMinLength, run, strength: clamp(run / 10), ceiling: r2(fromPoints(ceiling)) };
}

function nestedBands(m: number[]): Signals["nested"] {
  const w = m.slice(-S.shelfWindow);
  if (w.length < 4) return { detected: false, compression: 0 };
  const pts = w.map(toPoints);
  const h = Math.floor(pts.length / 2);
  const early = Math.max(...pts.slice(0, h)) - Math.min(...pts.slice(0, h));
  const late = Math.max(...pts.slice(h)) - Math.min(...pts.slice(h));
  const compression = clamp((early - late) / Math.max(1, early));
  return { detected: compression > 0.35 && late < 25, compression: r4(compression) };
}

function shelfSignal(m: number[]): Signals["shelf"] {
  const w = m.slice(-S.shelfWindow);
  if (w.length < 5) return { active: false, strength: 0, level: 1 };
  const pts = w.map(toPoints);
  const norm = pstdev(pts) / 100;
  return { active: norm <= S.shelfVariance / 2, strength: clamp(1 - norm * 3), level: r2(fromPoints(mean(pts))) };
}

function baitSignal(m: number[]): Signals["bait"] {
  const w = m.slice(-8);
  if (w.length < 5) return { active: false, strength: 0, spike: 0, ratio: 1 };
  const spike = Math.max(...w);
  const others = w.filter((x) => x !== spike);
  const ctx = others.length ? mean(others) : 1;
  const ratio = spike / Math.max(1, ctx);
  const lows = others.filter((x) => x < S.lowBand).length;
  const active = ratio >= S.baitSpikeRatio && lows >= others.length * 0.6;
  return { active, strength: active ? clamp((ratio - 1) / 5) : clamp((ratio - 1) / 12), spike: r2(spike), ratio: r3(ratio) };
}

function signalsOf(window: number[]): Signals {
  return { asc: ascendingLadder(window), col: collapseLadder(window), nested: nestedBands(window), shelf: shelfSignal(window), bait: baitSignal(window) };
}

/** V5 classify_state: score every state, winner + score table. */
function classifyState(sig: Signals, m: number[]): { state: MarketState; scores: Record<MarketState, number> } {
  const scores = { Normal: 0.34, Collapse: 0, Ignition: 0, Moonshot: 0, Exhaustion: 0, Shelf: 0, Bait: 0 } as Record<MarketState, number>;
  if (!m.length) return { state: "Normal", scores };
  const last = m[m.length - 1];
  const recent = m.slice(-10);
  const highHits = recent.filter((x) => x >= S.moonshot).length;
  const lowHits = recent.filter((x) => x < S.lowBand).length;
  scores.Collapse = sig.col.strength * (sig.col.active ? 1.25 : 0.5);
  scores.Ignition = sig.asc.strength * 0.7 + sig.nested.compression * 0.55;
  scores.Moonshot = last >= S.ignition ? clamp(highHits / 2.5) : clamp(highHits / 6);
  scores.Shelf = sig.shelf.strength * (sig.shelf.active ? 1.2 : 0.4);
  scores.Bait = sig.bait.strength * (sig.bait.active ? 1.3 : 0.35);
  const peak = Math.max(...recent);
  if (peak >= S.moonshot && last < S.lowBand) scores.Exhaustion = clamp(0.55 + lowHits / 14);
  else if (peak >= S.ignition && last < S.lowBand) scores.Exhaustion = clamp(0.4 + lowHits / 20);
  if (last >= S.moonshot) scores.Moonshot = clamp(scores.Moonshot + 0.45);
  if (last >= S.ignition) scores.Ignition = clamp(scores.Ignition + 0.2);
  if (lowHits >= 7) scores.Collapse = clamp(scores.Collapse + 0.2);
  for (const k of STATES) scores[k] = r4(clamp(scores[k]));
  let state: MarketState = "Normal";
  for (const k of STATES) if (scores[k] > scores[state]) state = k;
  return { state, scores };
}

/** Rolling V5 state label for the trailing `limit` rounds (window of 40). */
function stateSequence(m: number[], limit = 1500): { labels: MarketState[]; offset: number } {
  const offset = Math.max(0, m.length - limit);
  const labels: MarketState[] = [];
  for (let i = offset; i < m.length; i++) {
    const w = m.slice(Math.max(0, i - 39), i + 1);
    if (w.length < 5) { labels.push("Normal"); continue; }
    labels.push(classifyState(signalsOf(w), w).state);
  }
  return { labels, offset };
}

function transitionMatrix(labels: MarketState[]): Record<MarketState, Record<MarketState, number>> {
  const counts = {} as Record<MarketState, Record<MarketState, number>>;
  for (const a of STATES) { counts[a] = {} as Record<MarketState, number>; for (const b of STATES) counts[a][b] = 0; }
  for (let i = 1; i < labels.length; i++) counts[labels[i - 1]][labels[i]] += 1;
  const out = {} as Record<MarketState, Record<MarketState, number>>;
  for (const a of STATES) {
    out[a] = {} as Record<MarketState, number>;
    const total = STATES.reduce((s, b) => s + counts[a][b], 0);
    for (const b of STATES) out[a][b] = total ? r4((counts[a][b] + 0.5) / (total + 0.5 * STATES.length)) : r4(1 / STATES.length);
  }
  return out;
}

// ------------------------------------------------------------ V5 DNA report

export interface DnaReport {
  signature: string[];
  matchCount: number;
  confidence: number;
  outcomes: { count: number; median: number; p75: number; p90: number; over2: number; over5: number; over10: number } | null;
  matches: { index: number; similarity: number; next: number }[];
  followers: number[];
}

function dnaReport(m: number[], scan = 6000): DnaReport {
  const W = S.dnaWindow;
  const sig = m.slice(-W).map(v5BandIndex);
  const signature = sig.map((i) => V5_BANDS[i].key);
  if (m.length < W * 3) return { signature, matchCount: 0, confidence: 0, outcomes: null, matches: [], followers: [] };
  const start0 = Math.max(0, m.length - scan);
  const keys = m.map((v, i) => (i >= start0 ? v5BandIndex(v) : 0));
  const maxDist = W * (V5_BANDS.length - 1);
  const matches: { index: number; similarity: number; next: number }[] = [];
  const limit = m.length - W * 2;
  for (let s = start0; s < limit; s++) {
    let d = 0;
    for (let k = 0; k < W; k++) d += Math.abs(keys[s + k] - sig[k]);
    const sim = 1 - d / maxDist;
    if (sim >= S.dnaTolerance) matches.push({ index: s, similarity: r4(sim), next: r2(m[s + W]) });
  }
  matches.sort((a, b) => b.similarity - a.similarity);
  const followers = matches.map((x) => x.next);
  const sorted = [...followers].sort((a, b) => a - b);
  const outcomes = followers.length
    ? {
        count: followers.length,
        median: r2(pct(sorted, 0.5)),
        p75: r2(pct(sorted, 0.75)),
        p90: r2(pct(sorted, 0.9)),
        over2: r4(followers.filter((f) => f >= 2).length / followers.length),
        over5: r4(followers.filter((f) => f >= 5).length / followers.length),
        over10: r4(followers.filter((f) => f >= 10).length / followers.length),
      }
    : null;
  return { signature, matchCount: matches.length, confidence: r4(clamp(matches.length / 25)), outcomes, matches: matches.slice(0, 16), followers };
}

// ---------------------------------------------------- V5 band exhaustion

export interface ExhaustionBand {
  threshold: number;
  rate: number;
  expectedGap: number | null;
  roundsSince: number;
  overdueRatio: number;
  exhaustion: number;
  status: "overdue" | "due" | "fresh";
}

function bandExhaustion(m: number[]): { bands: ExhaustionBand[]; mostOverdue: ExhaustionBand | null } {
  const total = m.length;
  if (total < 10) return { bands: [], mostOverdue: null };
  const out: ExhaustionBand[] = [2, 3, 5, 10, 20, 50, 100].map((t) => {
    let hits = 0;
    let last = -1;
    for (let i = 0; i < total; i++) if (m[i] >= t) { hits++; last = i; }
    const rate = hits / total;
    const expectedGap = rate > 0 ? r2(1 / rate) : null;
    const since = last >= 0 ? total - 1 - last : total;
    const overdue = expectedGap ? r3(since / expectedGap) : 0;
    return {
      threshold: t,
      rate: r4(rate),
      expectedGap,
      roundsSince: since,
      overdueRatio: overdue,
      exhaustion: r4(clamp(overdue / 2.5)),
      status: overdue > 1.25 ? "overdue" : overdue > 0.85 ? "due" : "fresh",
    };
  });
  const ranked = out.filter((b) => b.expectedGap).sort((a, b) => b.overdueRatio - a.overdueRatio);
  return { bands: out, mostOverdue: ranked[0] ?? null };
}

// ------------------------------------------ V5 ladder release conditions

interface V5Ladder { type: "ascend" | "collapse"; start: number; end: number; length: number; pure: boolean }

function detectLadders(m: number[], minLength = 4, baseWindow = 20): V5Ladder[] {
  const out: V5Ladder[] = [];
  if (m.length < minLength) return out;
  const base: number[] = new Array(m.length);
  let run = 0;
  for (let i = 0; i < m.length; i++) {
    run += m[i];
    if (i >= baseWindow) run -= m[i - baseWindow];
    base[i] = run / Math.min(i + 1, baseWindow);
  }
  let i = 0;
  while (i < m.length - minLength + 1) {
    const b = base[i];
    let a = 0;
    for (let j = i; j < m.length && m[j] >= b; j++) a++;
    if (a >= minLength) {
      let pure = true;
      for (let k = i; k < i + a - 1; k++) if (!(m[k] < m[k + 1])) { pure = false; break; }
      out.push({ type: "ascend", start: i, end: i + a - 1, length: a, pure });
      i += a;
      continue;
    }
    let c = 0;
    for (let j = i; j < m.length && m[j] <= b; j++) c++;
    if (c >= minLength) {
      let pure = true;
      for (let k = i; k < i + c - 1; k++) if (!(m[k] > m[k + 1])) { pure = false; break; }
      out.push({ type: "collapse", start: i, end: i + c - 1, length: c, pure });
      i += c;
      continue;
    }
    i++;
  }
  return out;
}

export interface LadderIntel {
  ladderCount: number;
  moonshotProbability: number;
  releaseCorrelation: number;
  etaToMoonshot: number;
  pressureScore: number;
  releasePrediction: "imminent" | "likely" | "possible" | "none";
  currentLadder: { type: string; length: number } | null;
  compressionNearRelease: boolean;
  etaAdjustment: number;
}

function ladderIntel(m: number[]): LadderIntel {
  const empty: LadderIntel = {
    ladderCount: 0, moonshotProbability: 0, releaseCorrelation: 0, etaToMoonshot: 0, pressureScore: 0,
    releasePrediction: "none", currentLadder: null, compressionNearRelease: false, etaAdjustment: 0,
  };
  if (m.length < 10) return empty;
  const ladders = detectLadders(m, 4);
  if (!ladders.length) return empty;
  // release conditions: longest ladders followed by a >=20x inside 15 rounds
  const sorted = [...ladders].sort((a, b) => b.length - a.length);
  let longest = sorted.filter((l) => l.length >= 10);
  if (!longest.length) longest = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 10)));
  const etas: number[] = [];
  for (const l of longest) {
    for (let i = l.end + 1; i < Math.min(m.length, l.end + 15); i++) {
      if (m[i] >= 20) { etas.push(i - l.end); break; }
    }
  }
  const current = ladders.filter((l) => l.end === m.length - 1);
  const cur = current.length ? current.reduce((a, b) => (b.length > a.length ? b : a)) : null;
  const moonshotProbability = cur ? (cur.length >= 10 ? Math.min(0.95, 0.6 + cur.length * 0.02) : 0.3) : 0.2;
  // ladder pressure: continuous low-distance same-type clusters
  let accumulation = 0;
  for (let k = 1; k < ladders.length; k++) {
    const a = ladders[k - 1];
    const b = ladders[k];
    if (a.type === b.type && b.start - a.end <= 5) accumulation += a.length + b.length;
  }
  const pressureScore = clamp(accumulation / Math.max(1, ladders.length * 20));
  const releasePrediction = pressureScore > 0.7 ? "imminent" : pressureScore > 0.4 ? "likely" : pressureScore > 0.2 ? "possible" : "none";
  // compression under the rolling p95 ceiling (last 50)
  const w = m.slice(-50).sort((a, b) => a - b);
  const ceiling = w[Math.floor(w.length * 0.95)] ?? 2;
  const last10 = m.slice(-10);
  const contained = last10.every((x) => x <= ceiling);
  const spread10 = Math.max(...last10.map(toPoints)) - Math.min(...last10.map(toPoints));
  const compressionNearRelease = contained && spread10 < 40;
  const etaAdjustment = -pressureScore * 5 - (cur ? cur.length * 0.3 : 0) - (compressionNearRelease ? 2 : 0);
  return {
    ladderCount: ladders.length,
    moonshotProbability: r4(moonshotProbability),
    releaseCorrelation: r4(longest.length ? etas.length / longest.length : 0),
    etaToMoonshot: r2(etas.length ? mean(etas) : 10),
    pressureScore: r4(pressureScore),
    releasePrediction,
    currentLadder: cur ? { type: cur.type, length: cur.length } : null,
    compressionNearRelease,
    etaAdjustment: r2(etaAdjustment),
  };
}

// ------------------------------------------------ V5 logistic ML ensemble

const ML_WEIGHTS: Record<string, Record<string, number>> = {
  over2: { bias: -0.35, meanLog: 1.15, stdLog: 0.42, lastLog: -0.28, lowShare: -1.6, highShare: 0.85, trend: 0.55, maxLog: 0.12 },
  over5: { bias: -1.45, meanLog: 0.95, stdLog: 0.78, lastLog: -0.18, lowShare: -1.15, highShare: 1.3, trend: 0.62, maxLog: 0.22 },
  over10: { bias: -2.3, meanLog: 0.7, stdLog: 0.92, lastLog: -0.12, lowShare: -0.85, highShare: 1.65, trend: 0.58, maxLog: 0.3 },
};

export interface MlIntel {
  features: Record<string, number>;
  predictions: Record<string, { model: number; empirical: number; blended: number; edge: number }>;
}

function mlIntel(m: number[], empirical: { over2: number; over5: number; over10: number }): MlIntel {
  const w = m.slice(-40);
  const logs = w.map((x) => Math.log(Math.max(1.01, x)));
  const features: Record<string, number> = {
    meanLog: r4(mean(logs)),
    stdLog: r4(pstdev(logs)),
    lastLog: r4(logs[logs.length - 1] ?? 0),
    lowShare: r4(w.filter((x) => x < S.lowBand).length / Math.max(1, w.length)),
    highShare: r4(w.filter((x) => x >= S.ignition).length / Math.max(1, w.length)),
    recentMean: r4(mean(w.slice(-8))),
    trend: r4(mean(logs.slice(-8)) - mean(logs.slice(0, 8))),
    maxLog: r4(logs.length ? Math.max(...logs) : 0),
  };
  const predictions: MlIntel["predictions"] = {};
  for (const [target, wts] of Object.entries(ML_WEIGHTS)) {
    let z = wts.bias;
    for (const [k, v] of Object.entries(wts)) if (k !== "bias") z += v * (features[k] ?? 0);
    const model = 1 / (1 + Math.exp(-clamp(z, -60, 60)));
    const emp = empirical[target as keyof typeof empirical];
    const blended = clamp(model * 0.6 + emp * 0.4);
    predictions[target] = { model: r4(model), empirical: r4(emp), blended: r4(blended), edge: r4(blended - emp) };
  }
  return { features, predictions };
}

// ----------------------------------------------------- distribution tools

/** Band shares of a sample, Dirichlet-smoothed toward a prior. */
function bandShares(values: number[], prior?: number[], pseudo = 0): number[] {
  const c = new Array(NB).fill(0);
  for (const v of values) c[bandIndex(v)]++;
  if (prior && pseudo > 0) for (let i = 0; i < NB; i++) c[i] += prior[i] * pseudo;
  const s = c.reduce((a, b) => a + b, 0);
  return s > 0 ? c.map((x) => x / s) : c.map(() => 1 / NB);
}

/** Reshape a reference distribution so it honours target survivals P(>=2), P(>=5), P(>=10). */
function reshapeFromSurvival(ref: number[], s2: number, s5: number, s10: number): number[] {
  const a = clamp(s2, 0.001, 0.999);
  const b = clamp(Math.min(s5, a), 0.0005, a);
  const c = clamp(Math.min(s10, b), 0.0002, b);
  const lo = ref[0] + ref[1] || 1;
  const hi = ref[4] + ref[5] || 1;
  return normalize([
    (1 - a) * (ref[0] / lo),
    (1 - a) * (ref[1] / lo),
    a - b,
    b - c,
    c * (ref[4] / hi),
    c * (ref[5] / hi),
  ]);
}

/** Exponential tilt of a distribution along the band axis (s in [-1, 1]). */
function tilt(ref: number[], s: number, lambda = 0.35): number[] {
  const mid = (NB - 1) / 2;
  return normalize(ref.map((p, i) => p * Math.exp(lambda * s * ((i - mid) / mid))));
}

const survivalAt = (d: number[], band: number) => d.slice(band).reduce((a, b) => a + b, 0);

/** Log-score (nats) of a distribution on the band that actually landed. */
export function bandLogLoss(dist: number[], actual: number): number {
  return -Math.log(Math.max(1e-6, dist[bandIndex(actual)] ?? 1e-6));
}

function jsDivergence(p: number[], q: number[]): number {
  const m = p.map((x, i) => (x + q[i]) / 2);
  const kl = (a: number[], b: number[]) => a.reduce((s, x, i) => (x > 0 && b[i] > 0 ? s + x * Math.log(x / b[i]) : s), 0);
  return 0.5 * kl(p, m) + 0.5 * kl(q, m);
}

// ------------------------------------------------------------------ types

export const COMPONENTS = ["baseline", "percentile", "markov", "dna", "band", "ml", "ensemble", "signals", "linguistics", "shape", "fxRegime"] as const;
export type ComponentKey = (typeof COMPONENTS)[number];

export const COMPONENT_LABEL: Record<ComponentKey, string> = {
  baseline: "Measured baseline (full history)",
  percentile: "Empirical percentiles (recent 500)",
  markov: "Markov state transitions (V5 7-state)",
  dna: "DNA analogue matching",
  band: "v6 band-partition model (tail-lift)",
  ml: "Logistic ML ensemble",
  ensemble: "v6 earned-weight per-round ensemble",
  signals: "Signal layer (pressure · moonshot · ladders · FX · momentum)",
  linguistics: "Linguistic token distribution (multi-layer language model)",
  shape: "Shape projection distribution (trend/acceleration classification)",
  fxRegime: "FX regime distribution (volatility + trend + mean reversion)",
};

export interface IntelComponent {
  key: ComponentKey;
  label: string;
  weight: number;
  prior: number;
  mid: number;
  p2: number;
  p10: number;
  distribution: number[];
  logLoss: number | null;
  samples: number;
}

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

export interface IntelSignal {
  engine: string;
  reading: string;
  direction: number;
  note: string;
}

export interface HorizonRow {
  threshold: number;
  perRound: number;
  baseline: number;
  withinHorizon: number;
  etaMedian: number | null;
  etaP90: number | null;
  currentRun: number;
}

export interface IntelWeights {
  weights: Partial<Record<ComponentKey, number>>;
  logLoss: Partial<Record<ComponentKey, number>>;
  sample: number;
  mixLogLoss: number | null;
  baseLogLoss: number | null;
  hitRate: number | null;
}

export interface IntelCalibrationInfo {
  /** distribution layer (band reliability × temperature) earned on held-out rounds */
  distributionActive: boolean;
  /** PIT quantile-level remap earned on held-out rounds */
  quantileActive: boolean;
  gamma: number;
  tau: number;
  /** quantile levels actually read for lo / expected / hi / reach */
  levels: { rangeLo: number; expected: number; rangeHi: number; reach: number };
  sample: number;
  validSample: number;
  validRawLogLoss: number | null;
  validCalLogLoss: number | null;
  improvementPct: number | null;
  coverageRaw: number | null;
  coverageCal: number | null;
  /** P(< 2x) — raw mixture, calibrated, and observed on the trailing 500 rounds */
  crash: { raw: number; calibrated: number; observed: number };
  /** legacy median log-bias rectification is only used while recalibration is inactive */
  legacyCorrection: boolean;
  modeBand: string;
  reason: string;
}

export interface FullIntelligenceForecast {
  engine: "full-intelligence-v6.3";
  source: string;
  generatedAt: string;
  cadenceMs: number;
  // --- v6 NextRoundForecast-compatible headline ---
  state: MarketState;
  confidence: number;
  confidenceLabel: "HIGH" | "MEDIUM" | "LOW";
  expectedMultiplier: number;
  rangeLo: number;
  rangeHi: number;
  band: string;
  distribution: { label: string; edge: number; probability: number; representative: number }[];
  /** un-recalibrated mixture — this is what the calibration ledger scores and fits on */
  rawDistribution: number[];
  baseMultiplier: number;
  tailLift: number;
  moonshotReach: number;
  /** which central interval rangeLo–rangeHi is (default "loose" = p15–p85, ~70% of rounds) */
  rangeProfile: { name: RangeProfileName; lo: number; hi: number; reach: number; nominal: number; label: string };
  /** exact quantiles of the published (calibrated) distribution */
  /** how expected and the range were read off the distribution */
  pointRange: { pointMethod: string; intervalMethod: string; coverage: number; nominal: number; adaptive: boolean; sample: number; median: number; reason: string };
  quantiles: { p05: number; p10: number; p15: number; p25: number; p50: number; p75: number; p85: number; p90: number; p95: number };
  rectification: { active: boolean; factor: number; biasPct: number; sampleSize: number; note: string } | null;
  lastRound: { multiplier: number; band: string };
  components: { model: string; p: number; weight: number; mid: number }[];
  note: string;
  // --- V5.01-backtd forecast surface ---
  predictedState: MarketState;
  predictedBand: string;
  horizon: number;
  stateConviction: number;
  stateScores: Record<MarketState, number>;
  candidates: IntelCandidate[];
  transitionMatrix: Record<MarketState, Record<MarketState, number>>;
  blend: {
    markovMid: number;
    percentileMid: number;
    dnaMid: number;
    bandMid: number;
    mlMid: number;
    ensembleMid: number;
    signalsMid: number;
    baselineMid: number;
  };
  // --- full intelligence ---
  intelligence: {
    components: IntelComponent[];
    agreement: number;
    calibratedHitRate: number | null;
    skillPct: number | null;
    calibrationSample: number;
    signals: IntelSignal[];
    dna: Omit<DnaReport, "followers">;
    exhaustion: { bands: ExhaustionBand[]; mostOverdue: ExhaustionBand | null };
    ladders: LadderIntel;
    ml: MlIntel;
    percentiles: Record<string, number>;
    horizonOutlook: HorizonRow[];
    regime: { label: string; volatility: number; drift: number };
    independence: { chiSquare: number; independent: boolean };
    honesty: string;
    /** how the published headline was derived from the calibrated distribution */
    calibration: IntelCalibrationInfo;
  };
  /** locked-holdout evidence / provenance, attached by the live core (robust-evaluation.ts) */
  evidence?: ForecastEvidence;
  /** blend admission summary, attached by the live core (engine-gate.ts) */
  blendGate?: { mode: string; admitted: string[] | null; excluded: string[]; reason: string };
}

// ------------------------------------------------------------- main engine

export interface IntelOptions {
  /** earned weights / scores from the calibration ledger */
  ledger?: IntelWeights | null;
  /** v6 earned per-round weights (baseline/markov/streak/recent) */
  pipelineWeights?: Record<string, number>;
  /** log-bias rectification (from trailing calibration) */
  correction?: number;
  correctionSample?: number;
  /** cap on history the heavy engines see */
  maxHistory?: number;
  /** v6.5 engine registry (F-12): live | shadow | demoted per engine key */
  engineStates?: Record<string, string>;
  /** v6.5 registered custom engines (F-12) — join the mixture as experts */
  extraEngines?: { key: string; label: string; prior: number; predict: (rounds: Round[]) => number[] }[];
  /** out-of-sample recalibrator fitted on the resolved intel ledger (see calibration.ts) */
  recalibrator?: Recalibrator | null;
  /** headline range profile: "tight" p25–p75, "loose" p15–p85 (default), "wide" p10–p90 */
  rangeProfile?: RangeProfileName | string | null;
  /** point / interval method + adaptive coverage chosen on the resolved ledger (point-range.ts) */
  pointRange?: PointRangeSelection | null;
}

const PRIOR: Record<ComponentKey, number> = {
  baseline: 1.0,
  percentile: 0.8,
  markov: 0.9,
  dna: 0.7,
  band: 0.9,
  ml: 0.6,
  ensemble: 0.8,
  signals: 0.6,
  linguistics: 0.75,
  shape: 0.65,
  fxRegime: 0.75,
};

/** Bayesian-mixture weights from trailing log-losses (posterior ∝ prior · e^(-n_eff · ΔL)). */
export function earnWeights(ledger: IntelWeights | null | undefined): Record<ComponentKey, number> {
  const out = {} as Record<ComponentKey, number>;
  const ll = ledger?.logLoss ?? {};
  const n = ledger?.sample ?? 0;
  const known = COMPONENTS.filter((c) => typeof ll[c] === "number");
  const nEff = Math.min(60, n);
  const best = known.length ? Math.min(...known.map((c) => ll[c] as number)) : 0;
  for (const c of COMPONENTS) {
    const l = ll[c];
    const post = n >= 15 && typeof l === "number" ? PRIOR[c] * Math.exp(-nEff * (l - best)) : PRIOR[c];
    out[c] = post;
  }
  const s = COMPONENTS.reduce((a, c) => a + out[c], 0) || 1;
  for (const c of COMPONENTS) out[c] = out[c] / s;
  // floors: baseline always keeps 8%, every engine keeps 2% so it can recover
  out.baseline = Math.max(out.baseline, 0.08);
  for (const c of COMPONENTS) out[c] = Math.max(out[c], 0.02);
  const s2 = COMPONENTS.reduce((a, c) => a + out[c], 0);
  for (const c of COMPONENTS) out[c] = r4(out[c] / s2);
  return out;
}

export function fullIntelligenceForecast(allRounds: Round[], source: string, opts: IntelOptions = {}): FullIntelligenceForecast {
  const rounds = allRounds.slice(-(opts.maxHistory ?? 20_000));
  const m = rounds.map((r) => r.multiplier);
  const n = m.length;
  const last = m[n - 1] ?? 1;
  const cadenceMs = medianIntervalMs(rounds);
  const pw = opts.pipelineWeights ?? {};

  // ---------- measured references
  const baseline = bandShares(m);
  const recent = m.slice(-500);
  const recentSorted = [...recent].sort((a, b) => a - b);
  const percentiles: Record<string, number> = {};
  for (const [k, q] of [["p05", 0.05], ["p10", 0.1], ["p25", 0.25], ["p50", 0.5], ["p75", 0.75], ["p90", 0.9], ["p95", 0.95], ["p99", 0.99]] as [string, number][]) {
    percentiles[k] = r2(pct(recentSorted, q));
  }
  const percentileDist = bandShares(recent, baseline, 20);
  const surv = (t: number) => (n ? m.filter((x) => x >= t).length / n : 0);
  const emp = { over2: surv(2), over5: surv(5), over10: surv(10) };

  // per-band within-band sorted samples (interpolated quantiles)
  const inBand: number[][] = Array.from({ length: NB }, () => []);
  for (const v of m.slice(-5000)) inBand[bandIndex(v)].push(v);
  for (const b of inBand) b.sort((x, y) => x - y);
  const representative = inBand.map((b, i) => (b.length >= 5 ? Math.exp(mean(b.map((v) => Math.log(v)))) : i === NB - 1 ? 200 : Math.sqrt(EDGES[i] * EDGES[i + 1])));
  const quantileOf = (dist: number[], q: number): number => {
    let c = 0;
    for (let i = 0; i < NB; i++) {
      const next = c + dist[i];
      if (next >= q || i === NB - 1) {
        const f = dist[i] > 0 ? clamp((q - c) / dist[i]) : 0.5;
        const b = inBand[i];
        if (b.length >= 8) return Math.max(1, pct(b, f));
        const lo = EDGES[i];
        const hi = Number.isFinite(EDGES[i + 1]) ? EDGES[i + 1] : lo * 10;
        return lo * Math.pow(hi / lo, f);
      }
      c = next;
    }
    return representative[NB - 1];
  };

  // ---------- V5 state machine + Markov
  const sig = signalsOf(m.slice(-40));
  const cls = classifyState(sig, m.slice(-40));
  const current = cls.state;
  const { labels, offset } = stateSequence(m, 1500);
  const matrix = transitionMatrix(labels);
  const markovRow = matrix[current];
  // value distribution of rounds while the tape was labelled s
  const stateValues = {} as Record<MarketState, number[]>;
  for (const s of STATES) stateValues[s] = [];
  labels.forEach((lab, i) => stateValues[lab].push(m[offset + i]));

  // ---------- engines
  const dna = dnaReport(m);
  const exhaustion = bandExhaustion(m.slice(-5000));
  const ladders = ladderIntel(m.slice(-1500));
  const ml = mlIntel(m, emp);
  const press = pressureOf(rounds);
  const ms = moonshotOf(rounds);
  const sh = shapeOf(rounds, 80);
  const st = streaksOf(rounds, 2);
  const bandTest = bandsOf(rounds.slice(-5000));
  const v6band = nextRoundForecast(rounds, source, pw);
  const per2 = perRoundProbability(rounds, 2, pw);
  const per5 = perRoundProbability(rounds, 5, pw);
  const per10 = perRoundProbability(rounds, 10, pw);
  let trend: ReturnType<typeof trendQuality> | null = null;
  let rev: ReturnType<typeof meanReversion> | null = null;
  let vol: ReturnType<typeof volatilityProfile> | null = null;
  let brk: ReturnType<typeof breakout> | null = null;
  if (n >= 200) {
    trend = trendQuality(rounds);
    rev = meanReversion(rounds);
    vol = volatilityProfile(rounds);
    brk = breakout(rounds);
  }
  const momentum = rangeMomentum(rounds.slice(-5000));
  const research = n >= 300 ? moonshotResearch(rounds.slice(-8000), 10) : null;

  // V5 gap/swing momentum + regime
  const pts = m.slice(-21).map(toPoints);
  const gaps = pts.slice(1).map((p, i) => p - pts[i]);
  const net = gaps.reduce((a, b) => a + b, 0);
  const swingDir = net > 6 ? "up" : net < -6 ? "down" : "flat";
  const vw = m.slice(-S.volatilityWindow).map((x) => Math.log(Math.max(1.01, x)));
  const regVol = pstdev(vw);
  const regDrift = mean(vw);
  let regime = regVol < 0.45 ? "compressed" : regVol < 0.85 ? "balanced" : regVol < 1.35 ? "expanded" : "chaotic";
  if (regDrift > 0.95 && regVol > 0.8) regime = "trending-up";
  else if (regDrift < 0.45 && regVol < 0.7) regime = "grinding-down";
  const regimeConf = clamp(vw.length / S.volatilityWindow);

  // ---------- V5 candidate tilts (translated onto v6 engines)
  const dnaWeight = Math.min(0.35, dna.confidence * 0.35);
  const overdueTilt = Math.min(0.2, (exhaustion.mostOverdue?.exhaustion ?? 0) * 0.2);
  const pressureTilt = press.overallPressure > 70 ? Math.min(0.15, ((press.overallPressure - 70) / 100) * 0.15) : 0;
  const moonshotTilt = ms.confidence > 0.7 ? Math.min(0.12, (ms.confidence - 0.7) * 0.4) : 0;
  const ladderTilt = ladders.moonshotProbability > 0.6 ? Math.min(0.25, (ladders.moonshotProbability - 0.6) * 0.5) : 0;
  const collapseTilt = sig.col.active ? Math.min(0.1, sig.col.strength * 0.1) : 0;
  const momentumTilt = swingDir === "up" ? 0.04 : swingDir === "down" ? -0.04 : 0;

  const raw: { state: MarketState; p: number }[] = STATES.map((s) => {
    let p = markovRow[s];
    if (dna.outcomes && dnaWeight > 0) {
      if (s === "Moonshot" || s === "Ignition") p = p * (1 - dnaWeight) + dna.outcomes.over5 * dnaWeight;
      else if (s === "Collapse" || s === "Exhaustion") p = p * (1 - dnaWeight) + (1 - dna.outcomes.over2) * dnaWeight;
    }
    if (s === "Moonshot" || s === "Ignition") {
      p += overdueTilt + pressureTilt;
      if (s === "Moonshot") p += moonshotTilt + ladderTilt;
      if (momentumTilt > 0) p += momentumTilt;
    } else if (s === "Collapse" || s === "Exhaustion") {
      p = Math.max(0, p - overdueTilt * 0.5) + collapseTilt;
      if (momentumTilt < 0) p += -momentumTilt;
    }
    return { state: s, p: Math.max(0, p) };
  });
  const rawTotal = raw.reduce((a, r) => a + r.p, 0) || 1;
  const stateProb = {} as Record<MarketState, number>;
  for (const r of raw) stateProb[r.state] = r.p / rawTotal;

  const stateDist = {} as Record<MarketState, number[]>;
  for (const s of STATES) stateDist[s] = bandShares(stateValues[s], baseline, 10);
  // Markov value channel: the empirical distribution of the round that FOLLOWED
  // every round labelled with the current state — P(next | state). (Mixing the
  // value distribution of each candidate label would be circular: labels are
  // partly defined by the round's own value.) The V5 tilts then lean it.
  const followers: number[] = [];
  for (let i = 0; i < labels.length - 1; i++) if (labels[i] === current) followers.push(m[offset + i + 1]);
  const markovTilt = clamp(
    (stateProb.Moonshot + stateProb.Ignition - markovRow.Moonshot - markovRow.Ignition) -
      (stateProb.Collapse + stateProb.Exhaustion - markovRow.Collapse - markovRow.Exhaustion),
    -1,
    1,
  );
  const markovDist = tilt(bandShares(followers, baseline, 20), markovTilt, 0.6);

  const candidates: IntelCandidate[] = STATES.map((s) => {
    const vals = [...stateValues[s]].sort((a, b) => a - b);
    const lo = vals.length >= 10 ? pct(vals, 0.25) : quantileOf(stateDist[s], 0.25);
    const hi = vals.length >= 10 ? pct(vals, 0.75) : quantileOf(stateDist[s], 0.75);
    return {
      state: s,
      probability: r4(stateProb[s]),
      rangeLo: r2(Math.max(1, lo)),
      rangeHi: r2(Math.max(lo + 0.05, hi)),
      survival: r4(survivalAt(stateDist[s], 2)),
      label: STATE_META[s].meaning,
      color: STATE_META[s].color,
      note: `transition from ${current} · n=${vals.length}`,
    };
  }).sort((a, b) => b.probability - a.probability);
  const top = candidates[0];

  // ---------- component distributions
  const dnaDist = dna.followers.length ? bandShares(dna.followers, baseline, 10) : baseline;
  const bandDist = normalize(v6band.distribution.map((d) => d.probability));
  const mlDist = reshapeFromSurvival(baseline, ml.predictions.over2.blended, ml.predictions.over5.blended, ml.predictions.over10.blended);
  const ensembleDist = reshapeFromSurvival(baseline, per2.p, per5.p, per10.p);

  // signal layer: every directional engine votes on a band-axis tilt
  const signals: IntelSignal[] = [];
  const push = (engine: string, reading: string, direction: number, note: string) =>
    signals.push({ engine, reading, direction: r3(clamp(direction, -1, 1)), note });
  push("Mega pressure", `${press.overallPressure}% · ${press.status}`, press.overallPressure >= 65 ? 0.4 : press.overallPressure >= 40 ? 0.15 : 0, "Power-law tail priors vs current dry runs on 100x+ targets.");
  push("Moonshot scanner", `${Math.round(ms.confidence * 100)}%${ms.imminent ? " · imminent" : ""}`, ms.imminent ? 0.5 : (ms.confidence - 0.4) * 0.5, ms.narrative);
  if (research?.readiness != null) push("Moonshot research", `readiness ${research.readiness}`, (research.readiness - 50) / 100, research.note);
  push("Ladder release", `${ladders.releasePrediction} · p ${Math.round(ladders.moonshotProbability * 100)}%`, ladders.moonshotProbability > 0.6 ? 0.4 : ladders.releasePrediction === "likely" ? 0.2 : 0, `${ladders.ladderCount} ladders · release correlation ${Math.round(ladders.releaseCorrelation * 100)}% · ETA ~${ladders.etaToMoonshot} rounds.`);
  if (exhaustion.mostOverdue) push("Band exhaustion", `${exhaustion.mostOverdue.threshold}x ${exhaustion.mostOverdue.status} (${exhaustion.mostOverdue.overdueRatio}×gap)`, exhaustion.mostOverdue.status === "overdue" ? 0.25 : 0, `${exhaustion.mostOverdue.roundsSince} rounds since the last ${exhaustion.mostOverdue.threshold}x vs expected gap ${exhaustion.mostOverdue.expectedGap}.`);
  push("ShapeShifters", `${sh.classification}${sh.dryZone.active ? ` · dry ${sh.dryZone.severity}` : ""}`, sh.dryZone.active ? -0.3 * sh.dryZone.severity : sh.classification === "exponential" ? 0.2 : 0, `Pareto α ${sh.pareto.alpha} (${sh.pareto.plausibility}).`);
  push("Gap / swing", `${swingDir} (net ${r2(net)} pts)`, swingDir === "up" ? 0.2 : swingDir === "down" ? -0.2 : 0, "V5 point-space round-over-round swing across the last 20 rounds.");
  push("Streak", `${st.currentKind} ${st.current} (max below ${st.maxBelow})`, st.currentKind === "below" && st.current >= 5 ? -0.15 : 0, `P(stay below) ${Math.round(st.markov.pStayBelow * 100)}%.`);
  if (trend) push("FX trend quality", `${trend.classification} · ${trend.direction}`, trend.classification === "trending" ? (trend.direction === "up" ? 0.4 : -0.4) : 0, trend.note);
  if (rev) push("FX mean reversion", `H ${rev.hurst} · z ${rev.zScore}`, rev.zScore < -1.5 ? 0.35 : rev.zScore > 1.5 ? -0.35 : 0, rev.interpretation);
  if (vol) push("FX volatility", `${vol.regime} (p${Math.round(vol.volPercentile * 100)})`, vol.regime === "compressed" ? 0.25 : vol.regime === "expanded" ? -0.1 : 0, vol.note);
  if (brk) push("FX breakout", `${Math.round(brk.compressionPercentile * 100)}% squeeze`, brk.compressionPercentile > 0.8 ? 0.3 : 0, brk.note);
  const m10 = momentum.find((x) => x.min === 10);
  if (m10) push("Range momentum 10x+", `${m10.trend}${m10.momentum != null ? ` · ${m10.momentum}` : ""}`, m10.trend === "accelerating" ? 0.3 : m10.trend === "cooling" ? -0.2 : 0, `median gap ${m10.medianGap} · recent ${m10.recentGap ?? "—"} · run ${m10.currentRun}.`);
  push("Regime", `${regime} · σ ${r3(regVol)}`, regime === "trending-up" ? 0.3 : regime === "grinding-down" ? -0.3 : 0, "V5 volatility regime from rolling log dispersion.");
  const composite = signals.length ? clamp(mean(signals.map((s) => s.direction)) * 2, -1, 1) : 0;
  const signalsDist = tilt(percentileDist, composite);

  const dists: Record<ComponentKey, number[]> = {
    baseline,
    percentile: percentileDist,
    markov: markovDist,
    dna: dnaDist,
    band: bandDist,
    ml: mlDist,
    ensemble: ensembleDist,
    signals: signalsDist,
    linguistics: linguisticsTokenDistribution(rounds),
    shape: shapeDistribution(rounds),
    fxRegime: fxDistribution(rounds),
  };

  // ---------- earned mixture
  const weights = earnWeights(opts.ledger);
  // v6.5 registry: shadow engines are scored but carry no weight (sleeping
  // experts), demoted engines sit at the floor, custom engines earn like the rest.
  const states = opts.engineStates ?? {};
  const extras = (opts.extraEngines ?? []).map((e) => {
    let d: number[];
    try {
      d = normalize(e.predict(rounds));
    } catch {
      d = baseline;
    }
    return { key: e.key, label: e.label, prior: e.prior, dist: d.length === NB && d.every(Number.isFinite) ? d : baseline };
  });
  const extraW: Record<string, number> = {};
  if (extras.length || Object.keys(states).length) {
    const ll = (opts.ledger?.logLoss ?? {}) as Record<string, number>;
    const nS = opts.ledger?.sample ?? 0;
    const nEff = Math.min(60, nS);
    const keys: string[] = [...COMPONENTS, ...extras.map((e) => e.key)];
    const pri: Record<string, number> = { ...PRIOR, ...Object.fromEntries(extras.map((e) => [e.key, e.prior])) };
    const stateOf = (k: string) => (k === "baseline" ? "live" : states[k] ?? ((COMPONENTS as readonly string[]).includes(k) ? "live" : "shadow"));
    const known = keys.filter((k) => typeof ll[k] === "number" && stateOf(k) === "live");
    const best = known.length ? Math.min(...known.map((k) => ll[k])) : 0;
    const raw: Record<string, number> = {};
    for (const k of keys) {
      const st = stateOf(k);
      if (st === "shadow") { raw[k] = 0; continue; }
      const l = ll[k];
      raw[k] = pri[k] * (nS >= 15 && typeof l === "number" ? Math.exp(-nEff * (l - best)) : (COMPONENTS as readonly string[]).includes(k) ? 1 : 0.25);
    }
    let s0 = keys.reduce((a, k) => a + raw[k], 0) || 1;
    for (const k of keys) raw[k] /= s0;
    raw.baseline = Math.max(raw.baseline, 0.08);
    for (const k of keys) {
      const st = stateOf(k);
      if (st === "demoted") raw[k] = 0.02;
      else if (st === "live") raw[k] = Math.max(raw[k], 0.02);
    }
    s0 = keys.reduce((a, k) => a + raw[k], 0) || 1;
    for (const c of COMPONENTS) weights[c] = r4(raw[c] / s0);
    for (const e of extras) extraW[e.key] = r4(raw[e.key] / s0);
  }
  const mixture = normalize(
    new Array(NB).fill(0).map((_, i) => COMPONENTS.reduce((a, c) => a + weights[c] * dists[c][i], 0) + extras.reduce((a, e) => a + (extraW[e.key] ?? 0) * e.dist[i], 0)),
  );
  const agreement = clamp(1 - COMPONENTS.reduce((a, c) => a + weights[c] * jsDivergence(dists[c], mixture), 0) / Math.log(2) * 4);

  // ---------- headline from ONE calibrated distribution
  // Every published number (expected, headline range, reach, band, horizon
  // probabilities) is read off the same distribution, so they can never
  // contradict each other. The recalibrator only changes anything when it has
  // beaten the raw mixture on held-out rounds (calibration.ts).
  const rc = opts.recalibrator ?? identityRecalibrator("No recalibrator supplied.");
  const calibrated = rc.active ? applyDistribution(mixture, rc) : mixture;
  const prof = rangeProfile(opts.rangeProfile);
  const lvl = {
    rangeLo: mapLevel(rc, prof.lo),
    expected: mapLevel(rc, 0.5),
    rangeHi: mapLevel(rc, prof.hi),
    reach: mapLevel(rc, prof.reach),
  };
  // legacy median log-bias rectification: only while no recalibration layer is
  // earned (otherwise the median would be corrected twice).
  const corr = rc.active || rc.quantileActive ? 0 : opts.correction ?? 0;
  const factor = corr ? clamp(Math.exp(corr), 0.5, 2) : 1;
  const expectedRaw = quantileOf(mixture, 0.5);
  const qExpected = quantileOf(calibrated, lvl.expected);
  const qLo = quantileOf(calibrated, lvl.rangeLo);
  const qHi = quantileOf(calibrated, lvl.rangeHi);
  const qReach = quantileOf(calibrated, lvl.reach);
  // the rectification shifts the whole central block (in log space) so the
  // range keeps bracketing the point estimate
  // point / interval method earned on the ledger (point-range.ts). Below its
  // minimum sample the selection is absent and the median / equal-tailed
  // profile levels (with the PIT level map) are used unchanged.
  const pr = opts.pointRange && opts.pointRange.sample > 0 && (opts.pointRange.pointMethod !== "median" || opts.pointRange.intervalMethod !== "central" || opts.pointRange.adaptive)
    ? opts.pointRange
    : null;
  const qf = (q: number) => quantileOf(calibrated, q);
  const medianPub = Math.max(1, qExpected * factor);
  let expected = medianPub;
  let lo0 = qLo * factor;
  let hi0 = qHi * factor;
  if (pr) {
    expected = Math.max(1, (pr.pointMethod === "median" ? qExpected : pointEstimate(qf, pr.pointMethod)) * factor);
    if (pr.intervalMethod !== "central" || pr.adaptive) {
      const [a, b] = pointRangeInterval(qf, pr.coverage, pr.intervalMethod);
      lo0 = a * factor;
      hi0 = b * factor;
    }
  }
  let rangeLo = Math.max(1, Math.min(lo0, expected));
  let rangeHi = Math.max(expected, hi0, rangeLo + 0.01);
  const reach = Math.max(rangeHi, qReach * factor);

  // ---------- comprehensive range adjustment layer
  let rangeScale = 1;
  const rangeAdjustments: {
    regimeScale: number;
    breakoutScale: number;
    trendShift: number;
    dnaPatternTilt: number;
    finalScale: number;
  } = {
    regimeScale: 1,
    breakoutScale: 1,
    trendShift: 0,
    dnaPatternTilt: 0,
    finalScale: 1,
  };

  // Regime-based adjustment
  if (vol) {
    if (vol.regime === "compressed") {
      rangeScale *= 0.85;
      rangeAdjustments.regimeScale = 0.85;
    } else if (vol.regime === "expanded") {
      rangeScale *= 1.25;
      rangeAdjustments.regimeScale = 1.25;
    }
  }

  // Breakout adjustment
  if (brk && brk.compressionPercentile > 0.8) {
    if (brk.postCompressionBreakRate > brk.baseBreakRate * 1.1) {
      rangeScale *= 1.3;
      rangeAdjustments.breakoutScale = 1.3;
    } else {
      rangeScale *= 0.9;
      rangeAdjustments.breakoutScale = 0.9;
    }
  }

  // Trend-based shift (applied before final scale)
  let trendShift = 0;
  if (trend) {
    trendShift = trend.direction === "up" ? 0.1 : trend.direction === "down" ? -0.1 : 0;
    rangeAdjustments.trendShift = trendShift;
  }

  // DNA pattern tilt
  const dnaPatternDist = dnaPatternDistribution(rounds);
  const recentBands = rounds.slice(-10).map((r) => bandIndex(r.multiplier));
  const upsideBias = recentBands.filter((b) => b >= 3).length >= 5 ? 0.15 : 0;
  const downsideBias = recentBands.filter((b) => b <= 1).length >= 5 ? -0.1 : 0;
  if (upsideBias > 0) {
    rangeScale *= 1.15;
    rangeAdjustments.dnaPatternTilt = 0.15;
  } else if (downsideBias < 0) {
    rangeScale *= 0.9;
    rangeAdjustments.dnaPatternTilt = -0.1;
  }

  // Clamp final range scale
  rangeScale = clamp(rangeScale, 0.5, 2.0);
  rangeAdjustments.finalScale = rangeScale;

  // Apply trend shift
  rangeLo = rangeLo * (1 - trendShift);
  rangeHi = rangeHi * (1 + trendShift);

  // Apply range scale
  rangeLo = Math.max(1, rangeLo * rangeScale);
  rangeHi = rangeHi * rangeScale;
  // exact published quantiles (same distribution, same level map, same shift),
  // forced monotone so p05 ≤ … ≤ p95 always holds
  const quantiles = (() => {
    const keys = [["p05", 0.05], ["p10", 0.1], ["p15", 0.15], ["p25", 0.25], ["p50", 0.5], ["p75", 0.75], ["p85", 0.85], ["p90", 0.9], ["p95", 0.95]] as const;
    let prev = 1;
    const out = {} as FullIntelligenceForecast["quantiles"];
    for (const [k, q] of keys) {
      const v = k === "p50" ? medianPub : Math.max(1, quantileOf(calibrated, mapLevel(rc, q)) * factor);
      prev = Math.max(prev, v);
      out[k] = r2(prev);
    }
    return out;
  })();
  const pctLabel = (q: number) => `p${Math.round(q * 100)}`;
  const tailShare = calibrated[4] + calibrated[5];
  const recentCrash = recent.length ? recent.filter((x) => x < 2).length / recent.length : 0;
  const modeIndex = calibrated.indexOf(Math.max(...calibrated));

  // ---------- V5 confidence (state conviction) + calibrated confidence
  const scoreVals = STATES.map((s) => cls.scores[s]).sort((a, b) => b - a);
  const agreementV5 = scoreVals[0] - mean(scoreVals.slice(1));
  const sampleFactor = clamp(n / 150);
  const baseConf = clamp(Math.max(S.confidenceFloor, agreementV5 * 0.55 + sampleFactor * 0.3 + regimeConf * 0.15));
  const lead = top.probability - (candidates[1]?.probability ?? 0);
  const boost = ms.confidence > 0.8 || press.overallPressure > 85 ? 0.05 : 0;
  const stateConviction = clamp(baseConf * 0.55 + lead * 1.4 + dna.confidence * 0.15 + boost);
  const hitRate = opts.ledger?.hitRate ?? null;
  const calSample = opts.ledger?.sample ?? 0;
  // Confidence is earned: without a calibration ledger it is capped at MEDIUM,
  // and while the mixture does not out-score the measured baseline it stays
  // below HIGH no matter how loud the state machine is.
  const skillRaw =
    opts.ledger?.mixLogLoss != null && opts.ledger?.baseLogLoss != null && opts.ledger.baseLogLoss > 0
      ? (opts.ledger.baseLogLoss - opts.ledger.mixLogLoss) / opts.ledger.baseLogLoss
      : null;
  let confidence =
    calSample >= 15 && hitRate !== null
      ? stateConviction * 0.35 + agreement * 0.25 + hitRate * 0.4
      : (stateConviction * 0.6 + agreement * 0.4) * 0.6;
  // HIGH requires demonstrated out-of-sample skill: the mixture must beat the
  // measured baseline's log-score by >= 3% on the ledger.
  if (calSample < 15) confidence = Math.min(confidence, 0.6);
  else if (skillRaw === null || skillRaw < 0.03) confidence = Math.min(confidence, 0.6);
  confidence = clamp(confidence, 0.05, 0.95);
  const confidenceLabel = confidence >= 0.66 ? "HIGH" : confidence >= 0.38 ? "MEDIUM" : "LOW";
  const skillPct = skillRaw !== null ? r2(skillRaw * 100) : null;

  // ---------- horizon outlook (V5 h+5) from the calibrated distribution
  const baseSurv = (t: number) => surv(t);
  const perRoundAt = (t: number): number => survivalAtThreshold(calibrated, t);
  const horizonOutlook: HorizonRow[] = [2, 5, 10, 20, 50, 100].map((t) => {
    const p = clamp(perRoundAt(t), 1e-6, 1 - 1e-6);
    let run = 0;
    for (let i = n - 1; i >= 0 && m[i] < t; i--) run++;
    return {
      threshold: t,
      perRound: r4(p),
      baseline: r4(baseSurv(t)),
      withinHorizon: r4(1 - Math.pow(1 - p, S.horizon)),
      etaMedian: medianWait(p),
      etaP90: percentileWait(p, 0.9),
      currentRun: run,
    };
  });

  // ---------- components (UI chips) + blend mids
  const compOut: IntelComponent[] = COMPONENTS.map((c) => ({
    key: c,
    label: COMPONENT_LABEL[c],
    weight: weights[c],
    prior: PRIOR[c],
    mid: r2(quantileOf(dists[c], 0.5)),
    p2: r4(survivalAt(dists[c], 2)),
    p10: r4(survivalAt(dists[c], 4)),
    distribution: dists[c].map(r4),
    logLoss: typeof opts.ledger?.logLoss?.[c] === "number" ? r4(opts.ledger!.logLoss[c]!) : null,
    samples: c === "dna" ? dna.matchCount : c === "markov" ? followers.length : c === "percentile" ? recent.length : n,
  }));
  for (const e of extras) {
    compOut.push({
      key: e.key as ComponentKey,
      label: e.label,
      weight: extraW[e.key] ?? 0,
      prior: e.prior,
      mid: r2(quantileOf(e.dist, 0.5)),
      p2: r4(survivalAt(e.dist, 2)),
      p10: r4(survivalAt(e.dist, 4)),
      distribution: e.dist.map(r4),
      logLoss: typeof opts.ledger?.logLoss?.[e.key as ComponentKey] === "number" ? r4(opts.ledger!.logLoss[e.key as ComponentKey]!) : null,
      samples: n,
    });
  }
  const mid = (c: ComponentKey) => compOut.find((x) => x.key === c)!.mid;

  const bandLabel = BAND_LABELS[bandIndex(expected)];
  const honesty = bandTest.independent
    ? "Band-to-band transitions pass the chi-square independence test — consecutive rounds behave as independent draws, so engines can only earn weight by out-scoring the measured baseline on the calibration ledger."
    : "Band transitions fail the independence test on the trailing sample — conditional engines may carry information; their earned weights show how much.";

  const window10 = m.slice(-10);
  const lastEnergy = energyOf(last);
  const note =
    `${top.state}: ${STATE_META[top.state].meaning.toLowerCase()} (from ${current}). ` +
    `Last round settled ${last.toFixed(2)}x in the ${BAND_LABELS[bandIndex(last)]} band with ${lastEnergy} energy, forming a ${shapeWord(window10)} across the last ${window10.length} rounds. ` +
    `Mixture of ${COMPONENTS.length} engines${rc.active ? " (recalibrated)" : ""} puts P(≥2x) at ${Math.round(survivalAtThreshold(calibrated, 2) * 100)}%` +
    (tailShare >= 0.05 ? ` and ${Math.round(tailShare * 100)}% on the 10x+ bands.` : ".");

  return {
    engine: "full-intelligence-v6.3",
    source,
    generatedAt: new Date().toISOString(),
    cadenceMs,
    state: top.state,
    confidence: r4(confidence),
    confidenceLabel,
    expectedMultiplier: r2(expected),
    rangeLo: r2(rangeLo),
    rangeHi: r2(rangeHi),
    band: bandLabel,
    distribution: calibrated.map((p, i) => ({ label: BAND_LABELS[i], edge: EDGES[i], probability: r4(p), representative: r2(representative[i]) })),
    rawDistribution: mixture.map(r4),
    baseMultiplier: r2(expectedRaw),
    tailLift: v6band.tailLift,
    moonshotReach: r2(reach),
    rangeProfile: { ...prof, label: pr && (pr.intervalMethod !== "central" || pr.adaptive) ? `${Math.round(pr.coverage * 100)}% ${pr.intervalMethod === "shortest" ? "shortest" : "central"}` : `${pctLabel(prof.lo)}–${pctLabel(prof.hi)}` },
    pointRange: {
      pointMethod: pr?.pointMethod ?? "median",
      intervalMethod: pr && (pr.intervalMethod !== "central" || pr.adaptive) ? pr.intervalMethod : "central",
      coverage: r4(pr && (pr.intervalMethod !== "central" || pr.adaptive) ? pr.coverage : prof.nominal),
      nominal: prof.nominal,
      adaptive: !!pr?.adaptive,
      sample: opts.pointRange?.sample ?? 0,
      median: r2(medianPub),
      reason: opts.pointRange?.reason ?? "Median and equal-tailed profile range (no ledger selection supplied).",
    },
    quantiles,
    rectification: corr
      ? {
          active: Math.abs(corr) >= 0.05,
          factor: r4(factor),
          biasPct: r4(corr),
          sampleSize: opts.correctionSample ?? 0,
          note: corr > 0
            ? `Full-intelligence median ran ${Math.round(corr * 100)}% low (median log error) across ${opts.correctionSample ?? 0} verified rounds — central range scaled up ${factor.toFixed(2)}x.`
            : `Full-intelligence median ran ${Math.round(-corr * 100)}% high (median log error) across ${opts.correctionSample ?? 0} verified rounds — central range scaled down ${factor.toFixed(2)}x.`,
        }
      : opts.correction && (rc.active || rc.quantileActive)
        ? {
            active: false,
            factor: 1,
            biasPct: r4(opts.correction),
            sampleSize: opts.correctionSample ?? 0,
            note: "Median log-bias rectification superseded by out-of-sample distribution / quantile recalibration.",
          }
        : null,
    lastRound: { multiplier: last, band: BAND_LABELS[bandIndex(last)] },
    components: compOut.map((c) => ({ model: c.key, p: c.p2, weight: c.weight, mid: c.mid })),
    note,
    predictedState: top.state,
    predictedBand: bandLabel,
    horizon: S.horizon,
    stateConviction: r4(stateConviction),
    stateScores: cls.scores,
    candidates,
    transitionMatrix: matrix,
    blend: {
      markovMid: mid("markov"),
      percentileMid: mid("percentile"),
      dnaMid: mid("dna"),
      bandMid: mid("band"),
      mlMid: mid("ml"),
      ensembleMid: mid("ensemble"),
      signalsMid: mid("signals"),
      baselineMid: mid("baseline"),
      linguisticsMid: mid("linguistics"),
      shapeMid: mid("shape"),
      fxRegimeMid: mid("fxRegime"),
    },
    rangeAdjustments,
    intelligence: {
      components: compOut,
      agreement: r4(agreement),
      calibratedHitRate: hitRate !== null ? r4(hitRate) : null,
      skillPct,
      calibrationSample: calSample,
      signals,
      dna: { signature: dna.signature, matchCount: dna.matchCount, confidence: dna.confidence, outcomes: dna.outcomes, matches: dna.matches },
      exhaustion,
      ladders,
      ml,
      percentiles,
      horizonOutlook,
      regime: { label: regime, volatility: r4(regVol), drift: r4(regDrift) },
      independence: { chiSquare: r2(bandTest.chiSquare), independent: bandTest.independent },
      honesty,
      calibration: {
        distributionActive: rc.active,
        quantileActive: rc.quantileActive,
        gamma: rc.gamma,
        tau: rc.tau,
        levels: { rangeLo: r4(lvl.rangeLo), expected: r4(lvl.expected), rangeHi: r4(lvl.rangeHi), reach: r4(lvl.reach) },
        sample: rc.sample,
        validSample: rc.validSample,
        validRawLogLoss: rc.validRawLogLoss,
        validCalLogLoss: rc.validCalLogLoss,
        improvementPct: rc.improvementPct,
        coverageRaw: rc.coverageRaw,
        coverageCal: rc.coverageCal,
        crash: { raw: r4(mixture[0] + mixture[1]), calibrated: r4(calibrated[0] + calibrated[1]), observed: r4(recentCrash) },
        legacyCorrection: corr !== 0,
        modeBand: BAND_LABELS[modeIndex],
        reason: rc.reason,
      },
    },
  };
}

// ------------------------------------------------------------- scoring

/** Loose next-round scoring — mirrors the v6 calibration verdicts. */
export function scoreIntelForecast(
  f: Pick<FullIntelligenceForecast, "expectedMultiplier" | "rangeLo" | "rangeHi" | "state">,
  actual: number,
): { verdict: string; bandErr: number; logErr: number; reason: string } {
  const eb = bandIndex(f.expectedMultiplier);
  const ab = bandIndex(actual);
  const bandErr = ab - eb;
  const logErr = Math.log(Math.max(1, actual)) - Math.log(Math.max(1, f.expectedMultiplier));
  const inRange = actual >= f.rangeLo && actual <= f.rangeHi;
  const loose = actual >= f.rangeLo / 1.5 && actual <= f.rangeHi * 1.5;
  const short = (i: number) => BAND_LABELS[i].replace("x", "");
  if (inRange && Math.abs(bandErr) <= 1) return { verdict: "hit", bandErr, logErr, reason: `Inside the published range in ${bandErr === 0 ? "the" : "an adjacent"} projected band — ${f.state} projection held.` };
  if (Math.abs(bandErr) <= 1 && loose) return { verdict: "adjacent", bandErr, logErr, reason: `Off by one band (${short(eb)} → ${short(ab)}) inside the padded range — direction correct.` };
  if (bandErr > 1) return { verdict: "miss-high", bandErr, logErr, reason: `Landed ${bandErr} bands above the projected ${short(eb)} — the tail ran hotter than the mixture implied under ${f.state}.` };
  if (bandErr < -1) return { verdict: "miss-low", bandErr, logErr, reason: `Landed ${-bandErr} bands below the projected ${short(eb)} — base bands held weight the mixture gave to the upside under ${f.state}.` };
  return { verdict: "near", bandErr, logErr, reason: "Just outside the central range in a neighbouring band — band split right, range edges tight." };
}
