// point-range.ts — how the headline "expected" and range are read off the
// calibrated distribution.
//
// The median only looks at one point of the distribution: two forecasts with
// very different tails can share a median, so the headline barely moves. This
// module offers estimators that use the whole distribution shape, and only
// lets them replace the median / equal-tailed interval after they score
// better on resolved rounds they were not chosen on.
//
// Point estimators (Q = quantile function of the published distribution):
//   median     Q(0.5)                       optimal for absolute log error
//   geomean    exp E[log X], top 0.5% cut   optimal for squared log error;
//                                            moves with the whole shape
//   trimmed    exp mean log Q(u), u∈[.1,.9] robust compromise
//
// Intervals with the same nominal coverage c:
//   central    [Q((1−c)/2), Q((1+c)/2)]     equal tails
//   shortest   narrowest window in log space holding c   (moves with skew)
//
// Adaptive coverage (ACI, Gibbs & Candès 2021): the level actually used is
// nudged by recent misses so realised coverage tracks the nominal share when
// the regime drifts. Bounded to nominal ± 0.15.
//
// Pure module: no I/O, deterministic.

import { applyDistribution, quantileAt, sanitizeDist, type CalSample, type Recalibrator } from "./calibration";

export type PointMethod = "median" | "geomean" | "trimmed";
export type IntervalMethod = "central" | "shortest";
export const POINT_METHODS: PointMethod[] = ["median", "geomean", "trimmed"];
export const INTERVAL_METHODS: IntervalMethod[] = ["central", "shortest"];

export type QuantileFn = (q: number) => number;

const GRID_N = 199; // q = 0.005 … 0.995
const GRID = Array.from({ length: GRID_N }, (_, i) => (i + 1) / (GRID_N + 1));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function seOf(xs: number[]): number {
  if (xs.length < 2) return Infinity;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1) / xs.length);
}

/** log quantiles on a fixed grid, forced monotone */
function logGrid(qf: QuantileFn): number[] {
  let prev = 0;
  return GRID.map((q) => {
    const v = Math.log(Math.max(1, qf(q)));
    prev = Math.max(prev, Number.isFinite(v) ? v : prev);
    return prev;
  });
}

export function pointEstimate(qf: QuantileFn, method: PointMethod): number {
  if (method === "median") return Math.max(1, qf(0.5));
  const lg = logGrid(qf);
  if (method === "geomean") return Math.exp(mean(lg));
  const lo = Math.floor(GRID_N * 0.1);
  const hi = Math.ceil(GRID_N * 0.9);
  return Math.exp(mean(lg.slice(lo, hi)));
}

/** Interval with nominal coverage `coverage`. */
export function interval(qf: QuantileFn, coverage: number, method: IntervalMethod): [number, number] {
  const c = Math.min(0.98, Math.max(0.05, coverage));
  if (method === "central") return [Math.max(1, qf((1 - c) / 2)), Math.max(1, qf((1 + c) / 2))];
  // shortest window in log space over the grid containing ≥ c probability
  const lg = logGrid(qf);
  const k = Math.max(1, Math.round(c * (GRID_N + 1))); // grid steps spanning c
  let best = 0;
  let bestW = Infinity;
  for (let i = 0; i + k < GRID_N; i++) {
    const w = lg[i + k] - lg[i];
    if (w < bestW - 1e-12) { bestW = w; best = i; }
  }
  if (!Number.isFinite(bestW)) return interval(qf, c, "central");
  return [Math.exp(lg[best]), Math.exp(lg[Math.min(GRID_N - 1, best + k)])];
}

/** Squared log error — proper loss for exp E[log X]. */
export function pointLoss(pred: number, actual: number): number {
  return (Math.log(Math.max(1, actual)) - Math.log(Math.max(1, pred))) ** 2;
}

/**
 * Interval (Winkler) score in log space at miscoverage α: width plus 2/α per
 * unit of miss. Proper for intervals of nominal coverage 1 − α; lower is better.
 */
export function intervalScore(lo: number, hi: number, actual: number, coverage: number): number {
  const a = 1 - coverage;
  const L = Math.log(Math.max(1, lo));
  const H = Math.log(Math.max(1, hi));
  const y = Math.log(Math.max(1, actual));
  return H - L + (2 / a) * (Math.max(0, L - y) + Math.max(0, y - H));
}

export interface MethodScore<M extends string> { method: M; loss: number; gainVsDefault: number; se: number }

export interface PointRangeSelection {
  pointMethod: PointMethod;
  intervalMethod: IntervalMethod;
  /** coverage level actually used for the headline range (ACI-adjusted) */
  coverage: number;
  nominal: number;
  adaptive: boolean;
  sample: number;
  pointScores: MethodScore<PointMethod>[];
  intervalScores: MethodScore<IntervalMethod>[];
  /** realised coverage of the chosen interval method over the evaluation window */
  realisedCoverage: number | null;
  reason: string;
}

export interface SelectOptions {
  nominal: number;
  /** "auto" picks by held-out score; any method name forces it */
  pointMethod?: string | null;
  intervalMethod?: string | null;
  adaptive?: boolean;
  /** resolved rounds scored (most recent) */
  window?: number;
  minSample?: number;
  /** ACI step size */
  gamma?: number;
  /** required margin over the default, in standard errors */
  minSeMultiple?: number;
}

const isPoint = (x: unknown): x is PointMethod => POINT_METHODS.includes(x as PointMethod);
const isInterval = (x: unknown): x is IntervalMethod => INTERVAL_METHODS.includes(x as IntervalMethod);

export function defaultSelection(nominal: number, reason: string, sample = 0): PointRangeSelection {
  return {
    pointMethod: "median",
    intervalMethod: "central",
    coverage: nominal,
    nominal,
    adaptive: false,
    sample,
    pointScores: [],
    intervalScores: [],
    realisedCoverage: null,
    reason,
  };
}

/**
 * Choose the point and interval method on resolved ledger rows (oldest first).
 * Each row's raw distribution is passed through the current recalibrator — the
 * same transform the live forecast uses. A method replaces the default
 * (median / central) only if its mean loss is lower by more than
 * `minSeMultiple` standard errors of the paired per-round difference.
 */
export function selectPointRange(input: readonly CalSample[], rc: Pick<Recalibrator, "active" | "gamma" | "tau" | "ratios">, opts: SelectOptions): PointRangeSelection {
  const nominal = Math.min(0.95, Math.max(0.1, opts.nominal));
  const minSample = opts.minSample ?? 100;
  const window = opts.window ?? 600;
  const k = opts.minSeMultiple ?? 1;
  const rows: { qf: QuantileFn; actual: number }[] = [];
  for (const s of input.slice(-window)) {
    const d = sanitizeDist(s?.dist);
    if (!d || !Number.isFinite(s.actual) || s.actual < 1) continue;
    const pub = applyDistribution(d, rc);
    rows.push({ qf: (q) => quantileAt(pub, q), actual: s.actual });
  }
  const forcedPoint = isPoint(opts.pointMethod) ? opts.pointMethod : null;
  const forcedInterval = isInterval(opts.intervalMethod) ? opts.intervalMethod : null;
  if (rows.length < minSample) {
    const sel = defaultSelection(nominal, `Median and equal-tailed range kept: ${rows.length}/${minSample} resolved rounds before methods are compared.`, rows.length);
    return { ...sel, pointMethod: forcedPoint ?? "median", intervalMethod: forcedInterval ?? "central" };
  }

  // ---- point
  const pLoss: Record<PointMethod, number[]> = { median: [], geomean: [], trimmed: [] };
  for (const r of rows) for (const m of POINT_METHODS) pLoss[m].push(pointLoss(pointEstimate(r.qf, m), r.actual));
  const pointScores = POINT_METHODS.map((m) => {
    const diffs = pLoss.median.map((b, i) => b - pLoss[m][i]);
    return { method: m, loss: mean(pLoss[m]), gainVsDefault: mean(diffs), se: m === "median" ? 0 : seOf(diffs) };
  });
  let pointMethod: PointMethod = "median";
  if (forcedPoint) pointMethod = forcedPoint;
  else {
    const earned = pointScores.filter((s) => s.method !== "median" && s.gainVsDefault > 0 && s.gainVsDefault > k * s.se);
    if (earned.length) pointMethod = earned.sort((a, b) => a.loss - b.loss)[0].method;
  }

  // ---- interval (scored at the nominal level so methods are comparable)
  const iLoss: Record<IntervalMethod, number[]> = { central: [], shortest: [] };
  for (const r of rows) {
    for (const m of INTERVAL_METHODS) {
      const [lo, hi] = interval(r.qf, nominal, m);
      iLoss[m].push(intervalScore(lo, hi, r.actual, nominal));
    }
  }
  const intervalScores = INTERVAL_METHODS.map((m) => {
    const diffs = iLoss.central.map((b, i) => b - iLoss[m][i]);
    return { method: m, loss: mean(iLoss[m]), gainVsDefault: mean(diffs), se: m === "central" ? 0 : seOf(diffs) };
  });
  let intervalMethod: IntervalMethod = "central";
  if (forcedInterval) intervalMethod = forcedInterval;
  else {
    const s = intervalScores.find((x) => x.method === "shortest")!;
    if (s.gainVsDefault > 0 && s.gainVsDefault > k * s.se) intervalMethod = "shortest";
  }

  // ---- adaptive coverage: replay ACI over the window with the chosen method.
  // It is kept only if it brings realised coverage closer to nominal without
  // costing more than one SE of interval score versus the fixed level.
  const allowAdaptive = opts.adaptive !== false;
  const gamma = opts.gamma ?? 0.01;
  let level = nominal;
  let hitsA = 0, hitsF = 0;
  const scoreA: number[] = [], scoreF: number[] = [];
  for (const r of rows) {
    const [la, ha] = interval(r.qf, level, intervalMethod);
    const [lf, hf] = interval(r.qf, nominal, intervalMethod);
    const inA = r.actual >= la && r.actual <= ha ? 1 : 0;
    hitsA += inA;
    hitsF += r.actual >= lf && r.actual <= hf ? 1 : 0;
    scoreA.push(intervalScore(la, ha, r.actual, nominal));
    scoreF.push(intervalScore(lf, hf, r.actual, nominal));
    // miss → widen, hit → narrow; long-run hit rate → nominal
    level = Math.min(nominal + 0.15, Math.max(nominal - 0.15, level + gamma * (nominal - inA)));
  }
  const covErrA = Math.abs(hitsA / rows.length - nominal);
  const covErrF = Math.abs(hitsF / rows.length - nominal);
  const costs = scoreA.map((a, i) => a - scoreF[i]);
  const adaptive = allowAdaptive && covErrA < covErrF - 0.01 && mean(costs) < seOf(costs);
  const coverage = adaptive ? level : nominal;
  const hits = adaptive ? hitsA : hitsF;

  const fmt = (x: number) => x.toFixed(4);
  const ps = pointScores.find((s) => s.method === pointMethod)!;
  const is = intervalScores.find((s) => s.method === intervalMethod)!;
  const reason = [
    pointMethod === "median"
      ? forcedPoint
        ? "Expected = median (set by operator)."
        : `Expected = median: no alternative beat it by more than ${k} SE in squared log error on ${rows.length} resolved rounds.`
      : `Expected = ${pointMethod} (${forcedPoint ? "set by operator" : "earned"}): squared log error ${fmt(ps.loss)} vs median ${fmt(pointScores[0].loss)} on ${rows.length} resolved rounds.`,
    intervalMethod === "central"
      ? forcedInterval
        ? "Range = equal-tailed (set by operator)."
        : "Range = equal-tailed: the shortest interval did not earn a better interval score."
      : `Range = shortest log-interval (${forcedInterval ? "set by operator" : "earned"}): interval score ${fmt(is.loss)} vs ${fmt(intervalScores[0].loss)}.`,
    adaptive
      ? `Coverage level ${(coverage * 100).toFixed(1)}% (nominal ${(nominal * 100).toFixed(0)}%, adapted to recent misses; realised ${((hits / rows.length) * 100).toFixed(1)}% vs ${((hitsF / rows.length) * 100).toFixed(1)}% fixed).`
      : `Coverage level fixed at ${(nominal * 100).toFixed(0)}% (realised ${((hitsF / rows.length) * 100).toFixed(1)}%${allowAdaptive ? `; adaptive level ${((hitsA / rows.length) * 100).toFixed(1)}% not earned` : ""}).`,
  ].join(" ");

  return {
    pointMethod,
    intervalMethod,
    coverage,
    nominal,
    adaptive,
    sample: rows.length,
    pointScores,
    intervalScores,
    realisedCoverage: hits / rows.length,
    reason,
  };
}
