// functions/calibration.ts — Out-of-sample recalibration of the full-intelligence
// next-round distribution.
//
// Replaces the ad-hoc multiplier stack (ETA / cone / crash / candidate / ceiling
// nudges) with two textbook, *validated* layers that keep every published number
// a real quantile of one coherent distribution:
//
//   1. Distribution recalibration (band level)
//        p'_i ∝ (p_i · r_i^γ)^τ
//      r_i  = (observed_i + κ) / (expected_i + κ)   shrunk per-band reliability ratio
//      γ    = how much of the reliability correction to trust (0 = none)
//      τ    = temperature (τ < 1 softens an over-confident mixture, τ > 1 sharpens)
//      Validated by rolling-origin (forward-chaining) cross-validation over the
//      resolved ledger; accepted only if it lowers held-out log-loss by more than
//      one standard error of the paired difference, then refitted on the whole
//      window. Otherwise: identity.
//
//   2. Quantile (PIT) recalibration (Kuleshov et al. 2018)
//      For level q we publish F⁻¹(q′) with q′ = G⁻¹(q), G = empirical CDF of the
//      probability-integral transforms u = F(actual). Shrunk toward q by n/(n+k)
//      and accepted only when it reduces held-out quantile-calibration error
//      (same rolling-origin folds).
//      This is what makes "p25–p75" contain ~50% of rounds and "expected" be a
//      true median, instead of tuning them by hand.
//
// Pure module: samples in, recalibrator out. No I/O.

import { BAND_EDGES, bandIndex } from "./analysis";

export const CAL_NB = BAND_EDGES.length + 1;
const EDGES = [1, ...BAND_EDGES, Infinity];

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const r4 = (v: number) => +v.toFixed(4);

export interface CalSample {
  /** raw (un-recalibrated) mixture distribution published before the round */
  dist: number[];
  /** multiplier that actually landed */
  actual: number;
}

export interface QuantileLevel {
  q: number;
  mapped: number;
}

export interface Recalibrator {
  /** distribution layer earned on held-out data */
  active: boolean;
  /** quantile (PIT) layer earned on held-out data */
  quantileActive: boolean;
  gamma: number;
  tau: number;
  ratios: number[];
  levels: QuantileLevel[];
  sample: number;
  fitSample: number;
  validSample: number;
  validRawLogLoss: number | null;
  validCalLogLoss: number | null;
  /** held-out log-loss improvement in % of raw (positive = better) */
  improvementPct: number | null;
  /** held-out fraction of actuals inside the published p25–p75 */
  coverageRaw: number | null;
  coverageCal: number | null;
  /** held-out mean |P(Y ≤ F⁻¹(q)) − q| over the published levels */
  quantileErrRaw: number | null;
  quantileErrCal: number | null;
  reason: string;
}

export interface FitOptions {
  /** minimum resolved samples before anything is fitted */
  minSample?: number;
  /** pseudo-count for the per-band reliability ratio */
  kappa?: number;
  /** PIT shrinkage constant: weight = n / (n + shrink) */
  shrink?: number;
}

/** Quantile levels the forecast publishes (range lo, expected, range hi, reach). */
export const PUBLISHED_LEVELS = [0.25, 0.5, 0.75, 0.9] as const;

const GAMMAS = [0, 0.25, 0.5, 0.75, 1];
const TAUS = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25];

export function identityRecalibrator(reason: string, sample = 0): Recalibrator {
  return {
    active: false,
    quantileActive: false,
    gamma: 0,
    tau: 1,
    ratios: new Array(CAL_NB).fill(1),
    levels: PUBLISHED_LEVELS.map((q) => ({ q, mapped: q })),
    sample,
    fitSample: 0,
    validSample: 0,
    validRawLogLoss: null,
    validCalLogLoss: null,
    improvementPct: null,
    coverageRaw: null,
    coverageCal: null,
    quantileErrRaw: null,
    quantileErrCal: null,
    reason,
  };
}

/** Clean a probability vector: finite, non-negative, length CAL_NB, sums to 1. */
export function sanitizeDist(dist: readonly number[] | null | undefined): number[] | null {
  if (!dist || dist.length !== CAL_NB) return null;
  const xs = dist.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const s = xs.reduce((a, b) => a + b, 0);
  if (!(s > 0)) return null;
  return xs.map((x) => x / s);
}

/** Probability floor so a band that was given ~0 can never produce infinite loss. */
function floorDist(dist: number[], eps = 1e-4): number[] {
  const xs = dist.map((x) => Math.max(eps, x));
  const s = xs.reduce((a, b) => a + b, 0);
  return xs.map((x) => x / s);
}

export function logLoss(dist: number[], actual: number): number {
  return -Math.log(Math.max(1e-6, dist[bandIndex(actual)] ?? 1e-6));
}

// -------------------------------------------------------- continuous CDF

/**
 * Within-band CDF under the crash-game law S(x) ∝ 1/x (Pareto α = 1):
 *   F(x | band) = (1/lo − 1/x) / (1/lo − 1/hi); open top band: 1 − lo/x.
 * Same interpolation as v65 quantileFromDist, so PIT and quantiles agree.
 */
function withinBandCdf(i: number, x: number): number {
  const lo = EDGES[i];
  const hi = EDGES[i + 1];
  if (x <= lo) return 0;
  if (!Number.isFinite(hi)) return clamp(1 - lo / x);
  if (x >= hi) return 1;
  return clamp((1 / lo - 1 / x) / (1 / lo - 1 / hi));
}

function withinBandInverse(i: number, f: number): number {
  const lo = EDGES[i];
  const hi = EDGES[i + 1];
  const g = clamp(f, 0, 0.999999);
  if (!Number.isFinite(hi)) return lo / (1 - g);
  return 1 / (1 / lo - g * (1 / lo - 1 / hi));
}

/** P(X ≤ x) for a band distribution. */
export function cdfAt(dist: number[], x: number): number {
  if (!(x > 1)) return 0;
  const b = bandIndex(x);
  let c = 0;
  for (let i = 0; i < b; i++) c += dist[i];
  return clamp(c + dist[b] * withinBandCdf(b, x));
}

/** P(X ≥ t) — per-round probability of clearing threshold t. */
export function survivalAt(dist: number[], t: number): number {
  return clamp(1 - cdfAt(dist, t), 1e-6, 1 - 1e-6);
}

/** Inverse CDF of a band distribution (Pareto within-band interpolation). */
export function quantileAt(dist: number[], q: number): number {
  const qq = clamp(q, 1e-6, 1 - 1e-6);
  let c = 0;
  for (let i = 0; i < CAL_NB; i++) {
    const next = c + dist[i];
    if (next >= qq || i === CAL_NB - 1) {
      const f = dist[i] > 0 ? clamp((qq - c) / dist[i]) : 0.5;
      return Math.max(1, withinBandInverse(i, f));
    }
    c = next;
  }
  return 1;
}

// ------------------------------------------------------ distribution layer

export function applyDistribution(dist: number[], rc: Pick<Recalibrator, "active" | "gamma" | "tau" | "ratios">): number[] {
  const clean = sanitizeDist(dist);
  if (!clean) return new Array(CAL_NB).fill(1 / CAL_NB);
  if (!rc.active) return clean;
  const xs = clean.map((p, i) => Math.pow(Math.max(1e-9, p * Math.pow(rc.ratios[i] ?? 1, rc.gamma)), rc.tau));
  const s = xs.reduce((a, b) => a + b, 0);
  const out = s > 0 && Number.isFinite(s) ? xs.map((x) => x / s) : clean;
  return floorDist(out);
}

function reliabilityRatios(samples: CalSample[], kappa: number): number[] {
  const expected = new Array(CAL_NB).fill(0);
  const observed = new Array(CAL_NB).fill(0);
  for (const s of samples) {
    for (let i = 0; i < CAL_NB; i++) expected[i] += s.dist[i];
    observed[bandIndex(s.actual)]++;
  }
  return expected.map((e, i) => clamp((observed[i] + kappa) / (e + kappa), 0.25, 4));
}

function meanLoss(samples: CalSample[], rc: Pick<Recalibrator, "active" | "gamma" | "tau" | "ratios">): number[] {
  return samples.map((s) => logLoss(applyDistribution(s.dist, rc), s.actual));
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// ---------------------------------------------------------- quantile layer

function pit(dist: number[], actual: number): number {
  return cdfAt(dist, actual);
}

function empiricalQuantile(sorted: number[], q: number): number {
  if (!sorted.length) return q;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function fitLevels(pits: number[], shrink: number): QuantileLevel[] {
  const sorted = [...pits].sort((a, b) => a - b);
  const w = pits.length / (pits.length + shrink);
  let prev = 0;
  return PUBLISHED_LEVELS.map((q) => {
    const target = empiricalQuantile(sorted, q);
    let mapped = clamp(q + w * (target - q), 0.02, 0.98);
    mapped = Math.max(mapped, prev + 0.01); // strictly monotone levels
    prev = mapped;
    return { q, mapped: r4(mapped) };
  });
}

/** Mean |P(Y ≤ F⁻¹(q′)) − q| over published levels — 0 is perfect calibration. */
function quantileError(pits: number[], levels: QuantileLevel[]): number {
  if (!pits.length) return 0;
  return avg(levels.map((l) => Math.abs(pits.filter((u) => u <= l.mapped).length / pits.length - l.q)));
}

function coverage(pits: number[], levels: QuantileLevel[]): number {
  const lo = levels.find((l) => l.q === 0.25)!.mapped;
  const hi = levels.find((l) => l.q === 0.75)!.mapped;
  return pits.length ? pits.filter((u) => u >= lo && u <= hi).length / pits.length : 0;
}

export function mapLevel(rc: Recalibrator, q: number): number {
  if (!rc.quantileActive) return q;
  return rc.levels.find((l) => l.q === q)?.mapped ?? q;
}

// -------------------------------------------------------------------- fit

type DistLayer = { active: boolean; gamma: number; tau: number; ratios: number[] };

/** Choose (γ, τ) by in-sample log-loss on `train` (identity is a candidate). */
function selectDistLayer(train: CalSample[], kappa: number): DistLayer {
  const ratios = reliabilityRatios(train, kappa);
  const identity: DistLayer = { active: false, gamma: 0, tau: 1, ratios: new Array(CAL_NB).fill(1) };
  let best = { layer: identity, loss: avg(meanLoss(train, { ...identity, active: true })) };
  for (const gamma of GAMMAS) {
    for (const tau of TAUS) {
      if (gamma === 0 && tau === 1) continue;
      const layer = { active: true, gamma, tau, ratios };
      const l = avg(meanLoss(train, layer));
      if (l < best.loss - 1e-9) best = { layer, loss: l };
    }
  }
  return best.layer;
}

/**
 * Fit the recalibrator on chronologically ordered resolved samples (oldest →
 * newest). Validation is rolling-origin (forward-chaining) cross-validation:
 * the whole *fitting procedure* is re-run on every prefix and scored on the
 * block that follows it, so every held-out score is genuinely out-of-sample.
 * Each layer activates only if that procedure beats the raw mixture.
 */
export function fitRecalibrator(input: CalSample[], opts: FitOptions = {}): Recalibrator {
  const minSample = opts.minSample ?? 60;
  const kappa = opts.kappa ?? 20;
  const shrink = opts.shrink ?? 100;
  const samples: CalSample[] = [];
  for (const s of input) {
    const d = sanitizeDist(s.dist);
    if (d && Number.isFinite(s.actual) && s.actual >= 1) samples.push({ dist: d, actual: s.actual });
  }
  const n = samples.length;
  if (n < minSample) return identityRecalibrator(`Collecting evidence: ${n}/${minSample} resolved forecasts before recalibration is fitted.`, n);

  // five forward-chaining folds: train on [0, k), validate on [k, k + n/10)
  const folds = [0.5, 0.6, 0.7, 0.8, 0.9].map((f) => {
    const start = Math.floor(n * f);
    const end = f === 0.9 ? n : Math.floor(n * (f + 0.1));
    return { train: samples.slice(0, start), valid: samples.slice(start, end) };
  });
  const identity: DistLayer = { active: false, gamma: 0, tau: 1, ratios: new Array(CAL_NB).fill(1) };
  const idLevels: QuantileLevel[] = PUBLISHED_LEVELS.map((q) => ({ q, mapped: q }));

  const rawLosses: number[] = [];
  const calLosses: number[] = [];
  const rawPits: number[] = [];
  const layerPits: number[] = [];
  const pitPairs: { pits: number[]; levels: QuantileLevel[] }[] = [];
  for (const { train, valid } of folds) {
    if (!train.length || !valid.length) continue;
    const layer = selectDistLayer(train, kappa);
    for (const s of valid) {
      rawLosses.push(logLoss(s.dist, s.actual));
      calLosses.push(logLoss(applyDistribution(s.dist, layer), s.actual));
      rawPits.push(pit(s.dist, s.actual));
    }
    const trainPits = train.map((s) => pit(applyDistribution(s.dist, layer), s.actual));
    const validPits = valid.map((s) => pit(applyDistribution(s.dist, layer), s.actual));
    layerPits.push(...validPits);
    pitPairs.push({ pits: validPits, levels: fitLevels(trainPits, shrink) });
  }
  const rawLoss = avg(rawLosses);
  const diffs = rawLosses.map((l, i) => l - calLosses[i]);
  const dMean = avg(diffs);
  const dSe = Math.sqrt(avg(diffs.map((d) => (d - dMean) ** 2)) / Math.max(1, diffs.length - 1));
  // earned: mean held-out gain above one standard error (one-sided t > 1)
  const distActive = dMean > Math.max(1e-4, dSe);
  const calLoss = distActive ? avg(calLosses) : rawLoss;

  // quantile layer: held-out calibration error of the remapped levels
  const heldPits = distActive ? layerPits : rawPits;
  const errRaw = quantileError(heldPits, idLevels);
  const errCand = avg(pitPairs.map((pp) => quantileError(distActive ? pp.pits : [], pp.levels)));
  // when the distribution layer is off, re-evaluate the level map on raw PITs
  let errCandRaw = errCand;
  if (!distActive) {
    const pairs: number[] = [];
    for (const { train, valid } of folds) {
      if (!train.length || !valid.length) continue;
      const lv = fitLevels(train.map((s) => pit(s.dist, s.actual)), shrink);
      pairs.push(quantileError(valid.map((s) => pit(s.dist, s.actual)), lv));
    }
    errCandRaw = avg(pairs);
  }
  const errHeld = distActive ? errCand : errCandRaw;
  const quantileActive = errHeld < errRaw - 0.005;

  // final layers refitted on the whole window
  const finalLayer = distActive ? selectDistLayer(samples, kappa) : identity;
  const distLayer: DistLayer = finalLayer.active ? finalLayer : identity;
  const effectiveActive = distActive && distLayer.active;
  const allPits = samples.map((s) => pit(applyDistribution(s.dist, distLayer), s.actual));
  const levels = quantileActive ? fitLevels(allPits, shrink) : idLevels;

  const held = diffs.length;
  const reasonParts: string[] = [];
  reasonParts.push(
    effectiveActive
      ? `Distribution recalibrated (γ ${distLayer.gamma}, τ ${distLayer.tau}): rolling-origin held-out log-loss ${rawLoss.toFixed(4)} → ${calLoss.toFixed(4)} on ${held} rounds.`
      : `Raw mixture kept: recalibration did not beat it on ${held} rolling-origin held-out rounds by more than one standard error.`,
  );
  reasonParts.push(
    quantileActive
      ? `Quantile levels remapped from PITs: held-out calibration error ${(errRaw * 100).toFixed(1)}% → ${(errHeld * 100).toFixed(1)}%.`
      : `Quantile levels unchanged: held-out calibration error ${(errRaw * 100).toFixed(1)}% (remap would give ${(errHeld * 100).toFixed(1)}%).`,
  );
  const covLevels = (pp: { pits: number[]; levels: QuantileLevel[] }) => coverage(pp.pits, quantileActive ? pp.levels : idLevels);

  return {
    active: effectiveActive,
    quantileActive,
    gamma: distLayer.gamma,
    tau: distLayer.tau,
    ratios: distLayer.ratios.map(r4),
    levels,
    sample: n,
    fitSample: n - held,
    validSample: held,
    validRawLogLoss: r4(rawLoss),
    validCalLogLoss: r4(effectiveActive ? calLoss : rawLoss),
    improvementPct: rawLoss > 0 ? r4((((rawLoss - (effectiveActive ? calLoss : rawLoss)) / rawLoss) * 100)) : null,
    coverageRaw: r4(coverage(rawPits, idLevels)),
    coverageCal: r4(distActive ? avg(pitPairs.map(covLevels)) : quantileActive ? coverage(rawPits, levels) : coverage(rawPits, idLevels)),
    quantileErrRaw: r4(errRaw),
    quantileErrCal: r4(quantileActive ? errHeld : errRaw),
    reason: reasonParts.join(" "),
  };
}

// ---------------------------------------------------------- reliability

export interface ReliabilityRow {
  band: number;
  predictedRaw: number;
  predictedCal: number;
  observed: number;
}

/** Mean predicted vs observed frequency per band (reliability diagram data). */
export function reliabilityTable(samples: CalSample[], rc: Recalibrator): ReliabilityRow[] {
  const n = samples.length || 1;
  const raw = new Array(CAL_NB).fill(0);
  const cal = new Array(CAL_NB).fill(0);
  const obs = new Array(CAL_NB).fill(0);
  for (const s of samples) {
    const d = sanitizeDist(s.dist);
    if (!d) continue;
    const c = applyDistribution(d, rc);
    for (let i = 0; i < CAL_NB; i++) {
      raw[i] += d[i];
      cal[i] += c[i];
    }
    obs[bandIndex(s.actual)]++;
  }
  return raw.map((_, i) => ({ band: i, predictedRaw: r4(raw[i] / n), predictedCal: r4(cal[i] / n), observed: r4(obs[i] / n) }));
}
