// functions/momentum.ts — Momentum & Structure engines (v6.2).
//
// Pure functions: rounds in, metrics out. Modules:
//   hitPoints        — time-bucketed combined hit points (mega hits split across buckets)
//   anchors          — anchor structures (peak + any number of surrounding rounds) and
//                      their measured effect on market direction
//   rangeMomentum    — gap-based momentum per multiplier range (short gaps = hot)
//   moonshot         — researched conditions that precede very high rounds + live readiness
//   rangeForecast    — range-filtered prediction per band
//   invertedForecast — everything read backwards: reversed order, high-value compression
//   assessLive       — continuous assessment of open predictions + bucket energy agreement

import { type Round } from "./analysis";
import {
  WINDOWS,
  expectedRounds,
  medianIntervalMs,
  perRoundProbability,
  windowProbability,
  type PerRoundProbability,
} from "./pipeline";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (v: number) => +v.toFixed(2);
const r3 = (v: number) => +v.toFixed(3);
const r4 = (v: number) => +v.toFixed(4);
const r5 = (v: number) => +v.toFixed(5);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const meanOf = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
function medianOf(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[clamp(Math.floor(q * s.length), 0, s.length - 1)];
}

// ------------------------------------------------------------------ hit points

/** A round at or above this magnitude is a "mega hit" and bleeds across buckets. */
export const MEGA_MIN = 10;

export interface HitPointBucket {
  /** bucket start, epoch ms */
  t: number;
  count: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** raw sum of multipliers landing in the bucket */
  rawEnergy: number;
  /** combined hit points: mega hits divided across their span */
  energy: number;
  megaCount: number;
}

/**
 * Time-based combined hit points: every round lands in the bucket that contains
 * its end time. A mega hit (>= 10x) is treated as spanning multiple buckets —
 * e.g. a 15x hit spans 2 buckets and contributes 7.5 to each ("divided by half
 * or equivalent"). Candle fields (open/high/low/close) come from the actual
 * multipliers inside each bucket; energy is the split-adjusted combined score.
 */
export function hitPoints(rounds: Round[], bucketMs = 300_000): HitPointBucket[] {
  const cells = new Map<number, { mults: number[]; energy: number; mega: number }>();
  const ensure = (t: number) => {
    let c = cells.get(t);
    if (!c) {
      c = { mults: [], energy: 0, mega: 0 };
      cells.set(t, c);
    }
    return c;
  };
  for (const r of rounds) {
    const b = Math.floor(r.tsMs / bucketMs) * bucketMs;
    const cell = ensure(b);
    cell.mults.push(r.multiplier);
    const span = r.multiplier >= MEGA_MIN ? clamp(Math.ceil(r.multiplier / MEGA_MIN), 1, 4) : 1;
    const share = r.multiplier / span;
    cell.energy += share;
    if (span > 1) cell.mega++;
    for (let k = 1; k < span; k++) ensure(b + k * bucketMs).energy += share;
  }
  return [...cells.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, c]) => ({
      t,
      count: c.mults.length,
      // buckets that only received spill-over energy from an earlier mega hit have no rounds
      open: c.mults.length ? r2(c.mults[0]) : 0,
      close: c.mults.length ? r2(c.mults[c.mults.length - 1]) : 0,
      high: c.mults.length ? r2(Math.max(...c.mults)) : 0,
      low: c.mults.length ? r2(Math.min(...c.mults)) : 0,
      rawEnergy: r2(sum(c.mults)),
      energy: r2(c.energy),
      megaCount: c.mega,
    }));
}

// --------------------------------------------------------------------- anchors

export interface AnchorPoint {
  peakIdx: number;
  peak: number;
  peakTsMs: number;
  /** rounds from the previous trough (exclusive) through the peak (inclusive) */
  left: number;
  /** rounds after the peak through the next trough (inclusive) */
  right: number;
  /** total rounds in the anchor structure — can be any number */
  size: number;
}

export interface AnchorStats {
  /** most recent anchors, oldest first */
  recent: AnchorPoint[];
  count: number;
  medianPeak: number;
  medianSize: number;
  /** measured effect on market direction after each anchor completes */
  direction: {
    sampled: number;
    /** share of anchors followed by above-average drift over the next 10 rounds */
    pctUpward: number | null;
    /** mean of next-10-round multiplier means after anchors, vs global mean */
    nextMean: number | null;
    globalMean: number;
    bySize: { band: string; n: number; pctUpward: number | null; nextMean: number | null }[];
  };
  state: {
    /** "forming" = rising since last trough (peak not yet made); "released" = peak made and broken */
    phase: "forming" | "released" | "idle";
    risingRun: number;
    roundsSincePeak: number | null;
    lastPeak: number | null;
    potential: number | null;
  };
}

/**
 * Anchor detection: a peak is a round strictly above its previous neighbour and
 * at or above its next neighbour (1.2x → 3x → 2.1x: the 3x is the anchor). The
 * structure spans from the surrounding troughs and may contain any number of
 * rounds. Post-anchor drift is measured over the next 10 rounds vs global mean.
 */
export function anchors(rounds: Round[]): AnchorStats {
  const m = rounds.map((r) => r.multiplier);
  const n = m.length;
  const globalMean = meanOf(m);
  const troughIdx: number[] = [];
  for (let i = 1; i < n - 1; i++) if (m[i] < m[i - 1] && m[i] <= m[i + 1]) troughIdx.push(i);

  const points: AnchorPoint[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (!(m[i] > m[i - 1] && m[i] >= m[i + 1])) continue;
    const left = troughIdx.filter((t) => t < i).pop();
    const start = left ?? 0;
    const right = troughIdx.find((t) => t > i);
    const end = right ?? n - 1;
    points.push({
      peakIdx: i,
      peak: r2(m[i]),
      peakTsMs: rounds[i].tsMs,
      left: i - start,
      right: end - i,
      size: end - start,
    });
  }

  // direction effect: from each anchor's completion (right trough) measure drift
  const dirs: number[] = [];
  const outcomes: { size: number; up: boolean; nextMean: number }[] = [];
  for (const a of points) {
    const endIdx = a.peakIdx + a.right;
    const next = m.slice(endIdx + 1, endIdx + 11);
    if (next.length < 5 || globalMean <= 0) continue;
    const nm = meanOf(next);
    const up = nm > globalMean;
    dirs.push(up ? 1 : 0);
    outcomes.push({ size: a.size, up, nextMean: nm });
  }
  const bandOf = (size: number) => (size < 5 ? "small <5" : size <= 15 ? "medium 5-15" : "large >15");
  const bands = ["small <5", "medium 5-15", "large >15"].map((band) => {
    const rows = outcomes.filter((o) => bandOf(o.size) === band);
    return {
      band,
      n: rows.length,
      pctUpward: rows.length ? r3(meanOf(rows.map((o) => (o.up ? 1 : 0)))) : null,
      nextMean: rows.length ? r2(meanOf(rows.map((o) => o.nextMean))) : null,
    };
  });

  // current state
  const lastPeak = points.length ? points[points.length - 1] : null;
  const lastTrough = troughIdx.length ? troughIdx[troughIdx.length - 1] : -1;
  let risingRun = 0;
  let potential: number | null = null;
  if (lastPeak && lastPeak.peakIdx > lastTrough) {
    risingRun = 0;
    potential = null;
  } else {
    for (let i = n - 1; i > lastTrough; i--) {
      if (i < n - 1 && m[i] > m[i + 1]) break; // stopped rising
      risingRun = n - i;
      potential = Math.max(potential ?? 0, m[i]);
    }
  }
  const phase: AnchorStats["state"]["phase"] =
    lastPeak && lastPeak.peakIdx > lastTrough ? "released" : risingRun >= 2 ? "forming" : "idle";

  return {
    recent: points.slice(-40),
    count: points.length,
    medianPeak: r2(medianOf(points.map((p) => p.peak))),
    medianSize: r2(medianOf(points.map((p) => p.size))),
    direction: {
      sampled: outcomes.length,
      pctUpward: dirs.length ? r3(meanOf(dirs)) : null,
      nextMean: outcomes.length ? r2(meanOf(outcomes.map((o) => o.nextMean))) : null,
      globalMean: r2(globalMean),
      bySize: bands,
    },
    state: {
      phase,
      risingRun,
      roundsSincePeak: lastPeak ? n - 1 - lastPeak.peakIdx : null,
      lastPeak: lastPeak ? lastPeak.peak : null,
      potential: potential !== null ? r2(potential) : null,
    },
  };
}

// -------------------------------------------------------------- range momentum

export interface RangeMomentum {
  id: string;
  min: number;
  hits: number;
  hitRate: number;
  /** median rounds between hits, all history */
  medianGap: number;
  /** median of the last 3 gaps — short recent gaps vs long-run = hot */
  recentGap: number | null;
  /** long-run / recent gap ratio, >1 = accelerating; clamped to 3 */
  momentum: number | null;
  trend: "accelerating" | "steady" | "cooling" | "calm";
  /** rounds since the last hit at this range */
  currentRun: number;
  /** median wall-clock gap in ms */
  medianGapMs: number;
}

const MOMENTUM_RANGES = [2, 5, 10, 50, 100];

export function rangeMomentum(rounds: Round[]): RangeMomentum[] {
  const n = rounds.length;
  const m = rounds.map((r) => r.multiplier);
  return MOMENTUM_RANGES.map((min) => {
    const hits: number[] = [];
    for (let i = 0; i < n; i++) if (m[i] >= min) hits.push(i);
    const gaps: number[] = [];
    const gapsT: number[] = [];
    for (let k = 1; k < hits.length; k++) {
      gaps.push(hits[k] - hits[k - 1]);
      gapsT.push(rounds[hits[k]].tsMs - rounds[hits[k - 1]].tsMs);
    }
    const medianGap = medianOf(gaps);
    const recentGap = gaps.length >= 3 ? medianOf(gaps.slice(-3)) : null;
    const momentum = recentGap !== null && medianGap > 0 ? clamp(medianGap / recentGap, 0, 3) : null;
    const trend: RangeMomentum["trend"] =
      momentum === null
        ? "calm"
        : momentum >= 1.25
          ? "accelerating"
          : momentum <= 0.75
            ? "cooling"
            : "steady";
    return {
      id: `${min}x+`,
      min,
      hits: hits.length,
      hitRate: n ? r4(hits.length / n) : 0,
      medianGap: r2(medianGap),
      recentGap: recentGap !== null ? r2(recentGap) : null,
      momentum: momentum !== null ? r3(momentum) : null,
      trend,
      currentRun: hits.length ? n - 1 - hits[hits.length - 1] : n,
      medianGapMs: Math.round(medianOf(gapsT)),
    } as RangeMomentum;
  });
}

// -------------------------------------------------------------------- moonshot

export interface MoonshotProfile {
  threshold: number;
  hits: number;
  share: number;
  conditions: {
    key: string;
    label: string;
    median: number;
    p25: number;
    p75: number;
    current: number | null;
    /** how the current value scores against the researched distribution */
    met: boolean | null;
  }[];
  /** 0-100 live readiness built from the researched conditions */
  readiness: number | null;
  note: string;
}

interface MoonshotSample {
  gap: number;
  lowStreak: number;
  mean10: number;
  anchorNear: number;
  bucketEnergy: number;
}

function lowStreakBefore(m: number[], idx: number, cap = 2): number {
  let s = 0;
  for (let i = idx - 1; i >= 0 && m[i] < cap; i--) s++;
  return s;
}

/**
 * Research: what conditions precede very high rounds ("moonshots", >= threshold,
 * default 10x)? For every historical moonshot we record the preceding state —
 * rounds since the previous moonshot, the low-round streak, the mean of the
 * prior 10 rounds, whether an anchor peak sat nearby, and the 5-minute bucket
 * energy just before — then compare the live state against those distributions.
 */
export function moonshot(rounds: Round[], threshold = 10): MoonshotProfile {
  const m = rounds.map((r) => r.multiplier);
  const n = m.length;
  const hitIdx: number[] = [];
  for (let i = 0; i < n; i++) if (m[i] >= threshold) hitIdx.push(i);

  const anchorPeaks = anchors(rounds).recent.map((a) => a.peakIdx);
  const pts = hitPoints(rounds.slice(-6000), 300_000);
  const bucketEnergyByTs = new Map<number, number>();
  for (const p of pts) bucketEnergyByTs.set(p.t, p.energy);

  const samples: MoonshotSample[] = [];
  for (let k = 0; k < hitIdx.length; k++) {
    const i = hitIdx[k];
    const prev = k > 0 ? hitIdx[k - 1] : null;
    const tail = rounds.slice(Math.max(0, i - 10), i);
    const bucket = bucketEnergyByTs.get(Math.floor(rounds[i].tsMs / 300_000) * 300_000 - 300_000);
    samples.push({
      gap: prev !== null ? i - prev : Math.min(i, 500),
      lowStreak: lowStreakBefore(m, i),
      mean10: meanOf(tail.map((r) => r.multiplier)),
      anchorNear: anchorPeaks.some((p) => p < i && i - p <= 6) ? 1 : 0,
      bucketEnergy: bucket ?? -1,
    });
  }
  const validEnergy = samples.map((s) => s.bucketEnergy).filter((v) => v >= 0);

  const anchorPeaksRecent = anchorPeaks.filter((p) => p > n - 7);
  const nowGap = hitIdx.length ? n - 1 - hitIdx[hitIdx.length - 1] : n;
  const current: MoonshotSample = {
    gap: nowGap,
    lowStreak: lowStreakBefore(m, n),
    mean10: meanOf(rounds.slice(-10).map((r) => r.multiplier)),
    anchorNear: anchorPeaksRecent.length ? 1 : 0,
    bucketEnergy: pts.length ? pts[pts.length - 1].energy : -1,
  };

  const cond = (
    key: string,
    label: string,
    pick: (s: MoonshotSample) => number,
    higherIsFavorable: boolean,
    pool = samples,
  ): MoonshotProfile["conditions"][number] => {
    const vals = pool.map(pick).filter((v) => v >= 0);
    const med = medianOf(vals);
    const cur = pick(current);
    const met = vals.length >= 5 ? (higherIsFavorable ? cur >= med : cur <= med) : null;
    return {
      key,
      label,
      median: r2(med),
      p25: r2(quantile(vals, 0.25)),
      p75: r2(quantile(vals, 0.75)),
      current: cur >= 0 ? r2(cur) : null,
      met,
    };
  };

  const conditions = [
    cond("gap", "Rounds since previous moonshot", (s) => s.gap, true),
    cond("lowStreak", "Sub-2x streak before the hit", (s) => s.lowStreak, true),
    cond("mean10", "Mean of prior 10 rounds", (s) => s.mean10, false),
    cond("anchorNear", "Anchor peak within last 6 rounds", (s) => s.anchorNear, true),
    cond("bucketEnergy", "Prior 5-min bucket energy", (s) => s.bucketEnergy, false, samples.filter((s) => s.bucketEnergy >= 0)),
  ];

  // readiness: weighted blend of how conditions sit vs researched medians
  let readiness: number | null = null;
  if (samples.length >= 10) {
    const parts: [number, number][] = [];
    const gapMed = medianOf(samples.map((s) => s.gap));
    parts.push([clamp(current.gap / Math.max(1, gapMed), 0, 2) / 2, 30]);
    const streakMed = Math.max(1, medianOf(samples.map((s) => s.lowStreak)));
    parts.push([clamp(current.lowStreak / streakMed, 0, 2) / 2, 25]);
    const meanMed = medianOf(samples.map((s) => s.mean10));
    parts.push([clamp((meanMed - current.mean10) / Math.max(0.1, meanMed), 0, 1), 20]);
    parts.push([current.anchorNear ? 1 : 0, 15]);
    const eMed = medianOf(validEnergy);
    if (eMed > 0 && current.bucketEnergy >= 0) parts.push([clamp((eMed - current.bucketEnergy) / eMed, 0, 1), 10]);
    const totalW = parts.reduce((a, [, w]) => a + w, 0);
    readiness = Math.round((parts.reduce((a, [v, w]) => a + v * w, 0) / totalW) * 100);
  }

  return {
    threshold,
    hits: hitIdx.length,
    share: n ? r4(hitIdx.length / n) : 0,
    conditions,
    readiness,
    note:
      samples.length < 10
        ? "Fewer than 10 historical moonshots — profile needs more history before readiness is trusted."
        : "Readiness blends how each researched condition sits vs its historical moonshot median. Correlation, not causation — treat as a pressure gauge.",
  };
}

// ------------------------------------------------------------- range forecast

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

const BANDS: { id: string; min: number; max: number }[] = [
  { id: "2-5x", min: 2, max: 5 },
  { id: "5-10x", min: 5, max: 10 },
  { id: "10x+", min: 10, max: Number.POSITIVE_INFINITY },
];

/**
 * Range-filtered prediction: each band is forecast on its own filtered hit
 * series — per-round probability blends the band's measured rate with the
 * geometric estimate from its median gap, then window probabilities follow.
 */
export function rangeForecast(rounds: Round[], windows = WINDOWS): RangeBand[] {
  const n = rounds.length;
  const m = rounds.map((r) => r.multiplier);
  return BANDS.map(({ id, min, max }) => {
    const hits: number[] = [];
    for (let i = 0; i < n; i++) if (m[i] >= min && m[i] < max) hits.push(i);
    const gaps: number[] = [];
    for (let k = 1; k < hits.length; k++) gaps.push(hits[k] - hits[k - 1]);
    const rate = n ? hits.length / n : 0;
    const medianGap = medianOf(gaps);
    const geometric = medianGap > 0 ? 1 / medianGap : rate;
    const perRound = clamp(0.5 * rate + 0.5 * geometric, 0, 1);
    return {
      id,
      min,
      max: Number.isFinite(max) ? max : 0,
      hits: hits.length,
      rate: r4(rate),
      medianGap: r2(medianGap),
      perRound: r5(perRound),
      windows: windows.map((w) => ({
        window: w.id,
        label: w.label,
        probability: r5(windowProbability(perRound, expectedRounds(rounds, w.ms))),
      })),
    };
  });
}

// ----------------------------------------------------------- inverted forecast

export interface InvertedReading {
  threshold: number;
  /** inverted-lens per-round probability of a "high" (= a sub-threshold round in real space) */
  invertedPerRound: PerRoundProbability;
  /** P(the window contains at least one round below threshold) — the dip read */
  dipProbability: number;
}

export interface InvertedForecast {
  anchor: number;
  tailRounds: number;
  windows: { window: string; label: string; expectedRounds: number; readings: InvertedReading[] }[];
  note: string;
}

/**
 * Inverted forecast — everything read backwards. The series order is reversed
 * (the latest round is read as the last round) and magnitudes are compressed
 * from the top: multiplier' = anchor / multiplier, so 1x rounds spread out and
 * high rounds compress together. A "high" in the inverted lens is therefore a
 * sub-threshold round in real space, giving a genuinely different (companion)
 * read on the same windows: high standard P(hit) + low inverted dip probability
 * = both lenses agree the window should clear.
 */
export function invertedForecast(
  rounds: Round[],
  weights: Record<string, number>,
  thresholds: number[] = [2, 5, 10],
  windows = WINDOWS,
  tail = 20_000,
): InvertedForecast {
  const tailRounds = rounds.slice(-tail);
  const mults = tailRounds.map((r) => r.multiplier);
  const anchor = medianOf(mults) || 2;
  const inverted: Round[] = tailRounds
    .map((r) => ({ ...r, multiplier: anchor / r.multiplier }))
    .reverse();
  const out = windows.map((w) => {
    const nR = expectedRounds(rounds, w.ms);
    return {
      window: w.id,
      label: w.label,
      expectedRounds: nR,
      readings: thresholds.map((t) => {
        // inv.multiplier >= anchor/t  ⟺  real multiplier <= t
        const per = perRoundProbability(inverted, anchor / t, weights);
        return {
          threshold: t,
          invertedPerRound: per,
          dipProbability: r5(windowProbability(per.p, nR)),
        };
      }),
    };
  });
  return {
    anchor: r3(anchor),
    tailRounds: tailRounds.length,
    windows: out,
    note: "Reads the series backwards with high-value compression (mult' = median/mult). Inverted-high = sub-threshold round in real space, so dip probability is the bearish read; compare side-by-side with the standard windows.",
  };
}

// --------------------------------------------------- continuous assessment

export interface OpenPredictionLite {
  id: number | string;
  window: string;
  threshold: number;
  p: number;
  createdMs: number;
  dueMs: number;
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
  buckets: {
    tested: number;
    /** share of recent 5-min buckets whose combined hit points landed within ±50% of the trailing 6-bucket mean */
    agreement: number | null;
    driftIndex: number | null;
  };
  generatedAt: string;
}

/**
 * Continuous assessment: between window resolutions this watches every open
 * prediction (progress, max seen, hit-yet, pace vs expected cadence) and scores
 * the recent 5-minute hit-point buckets against their own trailing forecast.
 */
export function assessLive(rounds: Round[], open: OpenPredictionLite[]): AssessmentResult {
  const now = Date.now();
  const predictions: AssessmentPrediction[] = open.map((o) => {
    const span = Math.max(1, o.dueMs - o.createdMs);
    const progress = clamp((now - o.createdMs) / span, 0, 1);
    const upper = Math.min(now, o.dueMs);
    let maxSeen = 0;
    let hitYet = false;
    let soFar = 0;
    for (const r of rounds) {
      if (r.tsMs < o.createdMs) continue;
      if (r.tsMs > upper) break;
      soFar++;
      if (r.multiplier > maxSeen) maxSeen = r.multiplier;
      if (r.multiplier >= o.threshold) hitYet = true;
    }
    const nR = expectedRounds(rounds, span);
    const onPace = progress > 0 ? soFar / Math.max(1, nR * progress) : 0;
    return {
      id: o.id,
      window: o.window,
      threshold: o.threshold,
      p: r5(o.p),
      progress: r3(progress),
      roundsSoFar: soFar,
      maxSeen: r2(maxSeen),
      hitYet,
      onPace: r2(clamp(onPace, 0, 3)),
      verdictNow: hitYet ? "cleared" : progress >= 1 ? "expired" : "watching",
    };
  });

  const pts = hitPoints(rounds.slice(-2400), 300_000);
  let tested = 0;
  let agreed = 0;
  let driftSum = 0;
  for (let i = 6; i < pts.length; i++) {
    const base = meanOf(pts.slice(i - 6, i).map((p) => p.energy));
    if (base <= 0) continue;
    const ratio = pts[i].energy / base;
    driftSum += ratio;
    tested++;
    if (ratio >= 0.5 && ratio <= 2) agreed++;
  }
  return {
    predictions,
    buckets: {
      tested,
      agreement: tested ? r3(agreed / tested) : null,
      driftIndex: tested ? r3(driftSum / tested) : null,
    },
    generatedAt: new Date().toISOString(),
  };
}
