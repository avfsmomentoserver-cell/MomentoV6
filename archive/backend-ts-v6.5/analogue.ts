// analogue.ts — Chart Lab analogue engine as a next-round expert, plus a fair
// precision test for Chart Lab projections.
//
// Chart Lab (v64.projectShape) finds the K historical windows whose
// cumulative log-excess path looks most like the last `window` rounds and
// reads the continuation off what followed them. Its built-in score compares
// the median continuation with a FLAT path. On a skewed series that
// comparison is not like-for-like: the median of a sum of skewed steps drifts
// below zero, so a median path beats a flat path under absolute error even
// when the analogues carry no information at all. The fair comparison here
// uses the same median statistic over K RANDOM past windows (no conditioning).
//
// Pure module: no I/O; deterministic (seeded selection of random windows).

import { BAND_EDGES, bandIndex } from "./analysis";

const NB = BAND_EDGES.length + 1;
const LOG_CAP = Math.log(1000);
const lx = (m: number) => Math.min(Math.log(Math.max(1, m)), LOG_CAP);

export interface AnalogueOptions {
  /** rounds in the matched window */
  window?: number;
  /** analogues kept */
  k?: number;
  /** how far back to scan for analogues (bounds cost) */
  scanLimit?: number;
  /** pseudo-count toward the base band frequencies */
  shrink?: number;
}

function zscore(p: number[]): number[] {
  const m = p.reduce((a, b) => a + b, 0) / p.length;
  const sd = Math.sqrt(p.reduce((a, b) => a + (b - m) ** 2, 0) / p.length) || 1;
  return p.map((v) => (v - m) / sd);
}

/** End indices (exclusive) of the K nearest analogue windows; continuation starts at `end`. */
export function nearestAnalogues(x: number[], mu: number, opts: Required<Pick<AnalogueOptions, "window" | "k" | "scanLimit">>, horizon = 1): number[] {
  const n = x.length;
  const W = opts.window;
  if (n < W + horizon + 50) return [];
  // prefix sums of (x − mu) give every window path in O(W)
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + (x[i] - mu);
  const pathOf = (end: number) => {
    const out = new Array(W + 1);
    const base = pre[end - W];
    for (let j = 0; j <= W; j++) out[j] = pre[end - W + j] - base;
    return out as number[];
  };
  const cur = pathOf(n);
  const cz = zscore(cur);
  const lo = Math.max(W, n - opts.scanLimit);
  const cands: { end: number; d: number }[] = [];
  for (let e = lo; e <= n - horizon; e++) {
    const p = pathOf(e);
    const pz = zscore(p);
    let d = 0;
    for (let j = 0; j < pz.length; j++) d += (pz[j] - cz[j]) ** 2;
    d += 0.5 * (p[W] - cur[W]) ** 2;
    cands.push({ end: e, d });
  }
  cands.sort((a, b) => a.d - b.d);
  return cands.slice(0, Math.min(opts.k, cands.length)).map((c) => c.end);
}

/**
 * Next-round band distribution from the analogues' next rounds, shrunk toward
 * the base band frequencies so a small K cannot produce zero probabilities.
 */
export function analogueNextDist(multipliers: number[], opts: AnalogueOptions = {}): number[] {
  const window = opts.window ?? 30;
  const k = opts.k ?? 40;
  const scanLimit = opts.scanLimit ?? 6000;
  const shrink = opts.shrink ?? 20;
  const n = multipliers.length;
  const base = new Array(NB).fill(1);
  const tail = multipliers.slice(-Math.max(scanLimit, 2000));
  for (const m of tail) base[bandIndex(m)]++;
  const bs = base.reduce((a, b) => a + b, 0);
  const baseDist = base.map((c) => c / bs);
  if (n < window + 60) return baseDist;
  const x = multipliers.map(lx);
  const mu = x.reduce((a, b) => a + b, 0) / n;
  const ends = nearestAnalogues(x, mu, { window, k, scanLimit }, 1);
  if (!ends.length) return baseDist;
  const counts = new Array(NB).fill(0);
  for (const e of ends) counts[bandIndex(multipliers[e])]++;
  const tot = ends.length + shrink;
  return counts.map((c, i) => (c + shrink * baseDist[i]) / tot);
}

// ------------------------------------------------------------ precision test

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = (s.length - 1) / 2;
  return (s[Math.floor(m)] + s[Math.ceil(m)]) / 2;
};
const meanOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const seOf = (xs: number[]) => {
  if (xs.length < 2) return Infinity;
  const m = meanOf(xs);
  return Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / (xs.length - 1) / xs.length);
};

export interface ChartLabPrecision {
  anchors: number;
  window: number;
  horizon: number;
  k: number;
  /** MAE of the cumulative path, model median vs flat path (Chart Lab's own metric) */
  maeModel: number;
  maeFlat: number;
  skillVsFlat: number;
  /** same median statistic over K random past windows — the fair baseline */
  maeRandom: number;
  skillVsRandom: number;
  /** paired SE of (random − model) per anchor; skill is real only if gain > SE */
  gainVsRandom: number;
  gainVsRandomSe: number;
  /** next-round band log loss: analogue distribution vs base frequencies */
  nextLogLoss: number;
  nextLogLossBase: number;
  nextGain: number;
  nextGainSe: number;
  verdict: "more-precise" | "not-more-precise" | "insufficient-data";
  reason: string;
}

/**
 * Walk-forward precision test. Every anchor uses only rounds before it.
 * Anchors are spaced `step` rounds apart (non-overlapping horizons by default).
 */
export function chartLabPrecision(
  multipliers: number[],
  opts: { window?: number; horizon?: number; k?: number; scanLimit?: number; anchors?: number; minHistory?: number; seed?: number } = {},
): ChartLabPrecision {
  const W = opts.window ?? 30;
  const H = opts.horizon ?? 20;
  const K = opts.k ?? 40;
  const scanLimit = opts.scanLimit ?? 6000;
  const want = opts.anchors ?? 150;
  const minHistory = opts.minHistory ?? 1500;
  const rnd = mulberry(opts.seed ?? 17);
  const n = multipliers.length;
  const x = multipliers.map(lx);
  const step = Math.max(H, Math.floor((n - minHistory - H) / want));
  const gM: number[] = [], gF: number[] = [], gR: number[] = [];
  const llA: number[] = [], llB: number[] = [];
  for (let end = minHistory; end + H <= n && gM.length < want; end += step) {
    const hx = x.slice(0, end);
    const mu = meanOf(hx);
    const ends = nearestAnalogues(hx, mu, { window: W, k: K, scanLimit }, H);
    if (ends.length < 5) continue;
    // continuation paths (cumulative excess) for chosen and random windows
    const contOf = (e: number) => {
      const out: number[] = [];
      let s = 0;
      for (let h = 0; h < H; h++) { s += hx[e + h] - mu; out.push(s); }
      return out;
    };
    const lo = Math.max(W, end - scanLimit);
    const randomEnds = Array.from({ length: ends.length }, () => lo + Math.floor(rnd() * Math.max(1, end - H - lo)));
    const mPath = Array.from({ length: H }, (_, h) => median(ends.map((e) => contOf(e)[h])));
    const rPath = Array.from({ length: H }, (_, h) => median(randomEnds.map((e) => contOf(e)[h])));
    let s = 0, aM = 0, aF = 0, aR = 0;
    for (let h = 0; h < H; h++) {
      s += x[end + h] - mu;
      aM += Math.abs(mPath[h] - s);
      aF += Math.abs(0 - s);
      aR += Math.abs(rPath[h] - s);
    }
    gM.push(aM / H); gF.push(aF / H); gR.push(aR / H);
    // next-round probabilistic precision
    const dist = analogueNextDist(multipliers.slice(0, end), { window: W, k: K, scanLimit });
    const base = new Array(NB).fill(1);
    for (const m of multipliers.slice(Math.max(0, end - Math.max(scanLimit, 2000)), end)) base[bandIndex(m)]++;
    const bs = base.reduce((a, b) => a + b, 0);
    const b = bandIndex(multipliers[end]);
    llA.push(-Math.log(Math.max(1e-6, dist[b])));
    llB.push(-Math.log(Math.max(1e-6, base[b] / bs)));
  }
  const maeModel = meanOf(gM), maeFlat = meanOf(gF), maeRandom = meanOf(gR);
  const gainsR = gR.map((r, i) => r - gM[i]);
  const gainsN = llB.map((b, i) => b - llA[i]);
  const gainVsRandom = meanOf(gainsR), gainVsRandomSe = seOf(gainsR);
  const nextGain = meanOf(gainsN), nextGainSe = seOf(gainsN);
  const enough = gM.length >= 30;
  const precise = enough && gainVsRandom > gainVsRandomSe && nextGain > nextGainSe;
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  return {
    anchors: gM.length,
    window: W,
    horizon: H,
    k: K,
    maeModel: r4(maeModel),
    maeFlat: r4(maeFlat),
    skillVsFlat: r4(maeFlat ? 1 - maeModel / maeFlat : 0),
    maeRandom: r4(maeRandom),
    skillVsRandom: r4(maeRandom ? 1 - maeModel / maeRandom : 0),
    gainVsRandom: r4(gainVsRandom),
    gainVsRandomSe: Number.isFinite(gainVsRandomSe) ? r4(gainVsRandomSe) : -1,
    nextLogLoss: r4(meanOf(llA)),
    nextLogLossBase: r4(meanOf(llB)),
    nextGain: r4(nextGain),
    nextGainSe: Number.isFinite(nextGainSe) ? r4(nextGainSe) : -1,
    verdict: !enough ? "insufficient-data" : precise ? "more-precise" : "not-more-precise",
    reason: !enough
      ? `Only ${gM.length} walk-forward anchors; at least 30 are needed.`
      : `Skill vs flat path ${(r4(maeFlat ? 1 - maeModel / maeFlat : 0) * 100).toFixed(1)}%, vs random-window median ${(r4(maeRandom ? 1 - maeModel / maeRandom : 0) * 100).toFixed(1)}% ` +
        `(gain ${r4(gainVsRandom)} ± ${Number.isFinite(gainVsRandomSe) ? r4(gainVsRandomSe) : "∞"} SE); ` +
        `next-round log loss ${r4(meanOf(llA))} vs base ${r4(meanOf(llB))} (gain ${r4(nextGain)} ± ${Number.isFinite(nextGainSe) ? r4(nextGainSe) : "∞"} SE) over ${gM.length} anchors.`,
  };
}
