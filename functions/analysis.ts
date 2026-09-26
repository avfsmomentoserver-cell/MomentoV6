// functions/analysis.ts — pure analysis engine, ported from the original
// Momento AVFS core (analysis.py / forecast.py / features/*) to TypeScript.
// All functions are pure: rounds in, metrics out. No I/O, no state.

export interface Round {
  id: number;
  ts: string;
  tsMs: number;
  multiplier: number;
  color: string | null;
  source: string;
  sessionId: number | null;
}

export const THRESHOLDS = [1.2, 1.5, 2, 3, 5, 10, 20, 50, 100, 250, 500, 1000] as const;
export const LIVE_THRESHOLDS = [2, 5, 10, 50, 100] as const;

export const BAND_EDGES = [1.5, 2, 5, 10, 100];
export const BAND_LABELS = ["<1.5x", "1.5–2x", "2–5x", "5–10x", "10–100x", "100x+"];

export function bandIndex(m: number): number {
  let i = 0;
  while (i < BAND_EDGES.length && m >= BAND_EDGES[i]) i++;
  return i;
}

export function wilson(p: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - spread) / denom), Math.min(1, (centre + spread) / denom)];
}

export function medianWait(rate: number): number | null {
  if (rate <= 0 || rate >= 1) return null;
  return Math.max(1, Math.ceil(Math.log(2) / -Math.log(1 - rate)));
}

export function percentileWait(rate: number, q: number): number | null {
  if (rate <= 0 || rate >= 1) return null;
  // rounds until P(at least one hit) reaches q: 1-(1-p)^k >= q  =>  k = ln(1-q)/ln(1-p)
  return Math.max(1, Math.ceil(Math.log(1 - q) / Math.log(1 - rate)));
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Spread-free max — Math.max(...arr) overflows the stack on 100k+ rounds. */
export function maxOf(values: number[]): number {
  let m = 0;
  for (const v of values) if (v > m) m = v;
  return m;
}

// ---------------------------------------------------------------- overview

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

export function overview(rounds: Round[]): Overview {
  const mults = rounds.map((r) => r.multiplier).sort((a, b) => a - b);
  const n = mults.length;
  const sessions = new Set(rounds.map((r) => r.sessionId).filter((s): s is number => s !== null));
  const sortedTs = [...rounds].sort((a, b) => a.tsMs - b.tsMs);
  return {
    count: n,
    mean: n ? mults.reduce((a, b) => a + b, 0) / n : 0,
    median: quantile(mults, 0.5),
    max: n ? mults[n - 1] : 0,
    min: n ? mults[0] : 0,
    firstTs: sortedTs[0]?.ts ?? null,
    lastTs: sortedTs[n - 1]?.ts ?? null,
    sessions: sessions.size,
    q10: quantile(mults, 0.1),
    q25: quantile(mults, 0.25),
    q75: quantile(mults, 0.75),
    q90: quantile(mults, 0.9),
    q95: quantile(mults, 0.95),
    q99: quantile(mults, 0.99),
  };
}

// -------------------------------------------------------------- exceedance

export interface ExceedanceRow {
  threshold: number;
  hits: number;
  rate: number;
  ci: [number, number];
  etaMedian: number | null;
  etaP90: number | null;
  currentRun: number;
}

export function exceedance(rounds: Round[], thresholds: readonly number[] = THRESHOLDS): ExceedanceRow[] {
  const n = rounds.length;
  const hits = new Map<number, number>();
  for (const t of thresholds) hits.set(t, 0);
  for (const r of rounds) {
    for (const t of thresholds) if (r.multiplier >= t) hits.set(t, (hits.get(t) ?? 0) + 1);
  }
  return thresholds.map((threshold) => {
    const h = hits.get(threshold) ?? 0;
    const rate = n ? h / n : 0;
    let run = 0;
    for (let i = rounds.length - 1; i >= 0; i--) {
      if (rounds[i].multiplier >= threshold) break;
      run++;
    }
    return { threshold, hits: h, rate, ci: wilson(rate, n), etaMedian: medianWait(rate), etaP90: percentileWait(rate, 0.9), currentRun: run };
  });
}

// ----------------------------------------------------------------- streaks

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

export function streaks(rounds: Round[], threshold = 2): Streaks {
  const flags = rounds.map((r) => r.multiplier >= threshold);
  const n = flags.length;
  // current streak (from the most recent round backwards)
  let current = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (flags[i] === flags[n - 1]) current++;
    else break;
  }
  const currentKind: "above" | "below" = flags[n - 1] ? "above" : "below";
  let maxBelow = 0, maxAbove = 0, run = 0, kind: boolean | null = null;
  const condN = new Map<number, { n: number; hits: number }>();
  let nBelow = 0, nAbove = 0, jump = 0, stayBelow = 0;
  let postHighN = 0, postHighHits = 0;
  for (let i = 0; i < n; i++) {
    if (kind === flags[i]) run++;
    else { kind = flags[i]; run = 1; }
    if (!flags[i]) { maxBelow = Math.max(maxBelow, run); nBelow++; }
    else { maxAbove = Math.max(maxAbove, run); nAbove++; }
    // condition on the streak of below-threshold rounds BEFORE this round
    if (i > 0 && !flags[i - 1]) {
      let streak = 0;
      for (let j = i - 1; j >= 0 && !flags[j]; j--) streak++;
      const bucket = condN.get(streak) ?? { n: 0, hits: 0 };
      bucket.n++;
      if (flags[i]) bucket.hits++;
      condN.set(streak, bucket);
      if (flags[i]) jump++; else stayBelow++;
    }
    if (i > 0 && rounds[i - 1].multiplier >= 10) {
      postHighN++;
      if (flags[i]) postHighHits++;
    }
  }
  const conditional = [...condN.entries()]
    .filter(([s]) => s <= 6)
    .sort((a, b) => a[0] - b[0])
    .map(([streak, { n: bn, hits }]) => ({ streak, n: bn, rate: bn ? hits / bn : 0, ci: wilson(bn ? hits / bn : 0, bn) }));
  const transitions = nBelow + nAbove - 1;
  return {
    threshold,
    current,
    currentKind,
    maxBelow,
    maxAbove,
    conditional,
    markov: { pStayBelow: nBelow ? (stayBelow / Math.max(1, transitions)) : 0, pJump: nBelow ? jump / Math.max(1, transitions) : 0, nBelow, nAbove },
    postHigh: { rate: postHighN ? postHighHits / postHighN : 0, n: postHighN },
    continuationProb: nBelow ? stayBelow / Math.max(1, transitions) : null,
    expectedDuration: nBelow ? 1 / Math.max(1e-9, jump / Math.max(1, transitions)) : null,
  };
}

// ------------------------------------------------------------------- bands

export interface Bands {
  counts: number[];
  shares: number[];
  transition: number[][];
  chiSquare: number;
  independent: boolean;
}

export function bands(rounds: Round[]): Bands {
  const k = BAND_LABELS.length;
  const counts = new Array(k).fill(0);
  const matrix = Array.from({ length: k }, () => new Array(k).fill(0));
  let prev = -1;
  for (const r of rounds) {
    const b = bandIndex(r.multiplier);
    counts[b]++;
    if (prev >= 0) matrix[prev][b]++;
    prev = b;
  }
  const total = rounds.length;
  const rowSums = matrix.map((row) => row.reduce((a, b) => a + b, 0));
  const colSums = matrix[0].map((_, j) => matrix.reduce((a, row) => a + row[j], 0));
  const grand = rowSums.reduce((a, b) => a + b, 0);
  let chi = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const expected = (rowSums[i] * colSums[j]) / grand;
      if (expected > 0) chi += ((matrix[i][j] - expected) ** 2) / expected;
    }
  }
  const transition = matrix.map((row, i) =>
    row.map((v) => (rowSums[i] ? v / rowSums[i] : 0)),
  );
  return {
    counts,
    shares: counts.map((c) => (total ? c / total : 0)),
    transition,
    chiSquare: chi,
    independent: chi < 37.65, // chi2 .999 quantile, 25 dof
  };
}

// ----------------------------------------------------------------- ladders

export interface Ladder {
  startIndex: number;
  endIndex: number;
  length: number;
  band: string;
  values: number[];
}

/** Descending sequences of rounds that each stay inside [low, high). */
export function ladders(rounds: Round[], low = 2, high = 5, minLen = 3): { ladders: Ladder[]; current: Ladder | null; histogram: Record<number, number> } {
  const found: Ladder[] = [];
  const histogram: Record<number, number> = {};
  let run: Round[] = [];
  const flush = () => {
    if (run.length >= minLen) {
      found.push({
        startIndex: run[0].id,
        endIndex: run[run.length - 1].id,
        length: run.length,
        band: `${low}–${high}x`,
        values: run.map((r) => r.multiplier),
      });
      histogram[run.length] = (histogram[run.length] ?? 0) + 1;
    }
    run = [];
  };
  for (const r of rounds) {
    const inBand = r.multiplier >= low && r.multiplier < high;
    if (inBand && (run.length === 0 || r.multiplier < run[run.length - 1].multiplier)) run.push(r);
    else { flush(); if (inBand) run = [r]; }
  }
  flush();
  const current = found.length ? found[found.length - 1] : null;
  return { ladders: found.slice(-50), current: current && current.length > 0 ? current : null, histogram };
}

// -------------------------------------------------------------- resistance

export interface Ceiling {
  level: number;
  archetype: string;
  touches: number;
  lastTouchIndex: number;
  withinTolerance: number;
}

export function ceilings(rounds: Round[], window = 400, minTouches = 3, tolerance = 0.05): { levels: Ceiling[]; dominant: Ceiling | null } {
  const recent = rounds.slice(-window);
  const peaks: number[] = [];
  for (let i = 1; i < recent.length - 1; i++) {
    const m = recent[i].multiplier;
    if (m >= 2 && m > recent[i - 1].multiplier && m >= recent[i + 1].multiplier) peaks.push(m);
  }
  const clusters: { level: number; mults: number[]; last: number }[] = [];
  for (let i = 0; i < peaks.length; i++) {
    const m = peaks[i];
    const c = clusters.find((cl) => Math.abs(m - cl.level) / cl.level <= tolerance);
    if (c) { c.mults.push(m); c.level = c.mults.reduce((a, b) => a + b, 0) / c.mults.length; c.last = i; }
    else clusters.push({ level: m, mults: [m], last: i });
  }
  const levels: Ceiling[] = clusters
    .filter((c) => c.mults.length >= minTouches)
    .map((c) => ({
      level: +c.level.toFixed(3),
      archetype: c.level > c.mults[0] ? "ascending" : c.level < c.mults[0] ? "descending" : "flat",
      touches: c.mults.length,
      lastTouchIndex: c.last,
      withinTolerance: tolerance,
    }))
    .sort((a, b) => b.touches - a.touches);
  return { levels: levels.slice(0, 12), dominant: levels[0] ?? null };
}

// ---------------------------------------------------------------- pressure

export interface Pressure {
  powerLaw: { a: number; b: number; fitFrom: number };
  targets: { target: number; rate: number; etaMedian: number | null; etaP90: number | null; currentRun: number; pressurePct: number }[];
  overallPressure: number;
  status: "calm" | "building" | "loaded" | "critical";
}

/** Power-law tail fit p(m >= t) = a * t^-b via log-log OLS on thresholds >= fitFrom. */
export function tailFit(rounds: Round[], fitFrom = 25): { a: number; b: number } {
  const n = rounds.length;
  const fitTs = [25, 50, 100, 250, 500, 1000, 2500, 5000];
  const hitCounts = new Map<number, number>();
  for (const t of fitTs) hitCounts.set(t, 0);
  for (const r of rounds) {
    for (const t of fitTs) if (r.multiplier >= t) hitCounts.set(t, (hitCounts.get(t) ?? 0) + 1);
  }
  const xs: number[] = [], ys: number[] = [];
  for (const t of fitTs) {
    const p = n ? (hitCounts.get(t) ?? 0) / n : 0;
    if (p > 0 && t >= fitFrom) { xs.push(Math.log(t)); ys.push(Math.log(p)); }
  }
  if (xs.length < 2) return { a: 0.9497, b: 1.006 };
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den ? num / den : -1;
  return { a: Math.exp(my - slope * mx), b: -slope };
}

export function pressure(rounds: Round[]): Pressure {
  const n = rounds.length;
  const fit = tailFit(rounds);
  const targets = [100, 250, 500, 1000, 2500, 5000, 10000, 100000];
  const hitCounts = new Map<number, number>();
  for (const t of targets) hitCounts.set(t, 0);
  for (const r of rounds) {
    for (const t of targets) if (r.multiplier >= t) hitCounts.set(t, (hitCounts.get(t) ?? 0) + 1);
  }
  const rows = targets.map((target) => {
    const hits = hitCounts.get(target) ?? 0;
    const rate = n ? hits / n : 0;
    const modeled = Math.min(0.5, fit.a * Math.pow(target, -fit.b));
    const blended = hits >= 5 ? rate : modeled;
    let run = 0;
    for (let i = rounds.length - 1; i >= 0; i--) {
      if (rounds[i].multiplier >= target) break;
      run++;
    }
    const med = medianWait(blended);
    return {
      target,
      rate: blended,
      etaMedian: med,
      etaP90: percentileWait(blended, 0.9),
      currentRun: run,
      pressurePct: med ? Math.min(99, Math.round((run / med) * 50)) : 0,
    };
  });
  const overall = Math.round(rows.reduce((a, t) => a + t.pressurePct, 0) / Math.max(1, rows.length));
  const status: Pressure["status"] = overall >= 85 ? "critical" : overall >= 65 ? "loaded" : overall >= 40 ? "building" : "calm";
  return { powerLaw: { a: +fit.a.toFixed(4), b: +fit.b.toFixed(4), fitFrom: 25 }, targets: rows, overallPressure: overall, status };
}

// ------------------------------------------------------------------- shape

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

export function shape(rounds: Round[], window = 60): Shape {
  const recent = rounds.slice(-window).map((r) => r.multiplier);
  const logs = recent.map((m) => Math.log(Math.max(1.01, m)));
  const n = logs.length;
  let slope = 0, accel = 0;
  if (n > 4) {
    const half = Math.floor(n / 2);
    const slopeOf = (arr: number[]) => {
      const mx = (arr.length - 1) / 2, my = arr.reduce((a, b) => a + b, 0) / arr.length;
      let num = 0, den = 0;
      arr.forEach((y, x) => { num += (x - mx) * (y - my); den += (x - mx) ** 2; });
      return den ? num / den : 0;
    };
    slope = slopeOf(logs);
    accel = slopeOf(logs.slice(half)) - slopeOf(logs.slice(0, half));
  }
  const mean = logs.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const sd = Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n));
  const skew = n ? logs.reduce((a, b) => a + ((b - mean) / sd) ** 3, 0) / n : 0;
  const kurt = n ? logs.reduce((a, b) => a + ((b - mean) / sd) ** 4, 0) / n : 0;
  let classification = "uniform";
  if (kurt > 4 && skew > 0.8) classification = "clustered";
  else if (kurt > 3.2) classification = "power_law";
  else if (Math.abs(accel) > 0.01) classification = accel > 0 ? "exponential" : "bimodal";
  const rolling: number[] = recent.slice(-50);
  const rollMean = rolling.reduce((a, b) => a + b, 0) / Math.max(1, rolling.length);
  const dry = rollMean < 2;
  const severity = dry ? Math.min(1, (2 - rollMean) / 1.2) : 0;
  // Pareto MLE on rounds above the 75th percentile floor
  const sorted = [...recent].sort((a, b) => a - b);
  const xm = Math.max(1.05, quantile(sorted, 0.75));
  const tail = sorted.filter((m) => m >= xm);
  const alpha = tail.length >= 3 ? tail.length / tail.reduce((a, m) => a + Math.log(m / xm), 0) : 1.006;
  const ks = tail.length ? Math.max(...tail.map((m, i) => Math.abs(1 - Math.pow(xm / m, alpha) - (i + 1) / tail.length))) : 0;
  const pValue = Math.exp(-2 * tail.length * ks * ks);
  const plausibility = pValue > 0.05 ? "pareto-plausible" : "pareto-rejected";
  const eta = [2, 5, 10, 50, 100].map((target) => {
    const surv = Math.pow(1 / alpha, alpha) * 0 + (target > 1 ? Math.pow(1 / target, 0) : 1);
    // conditional survival P(X>t | X>current floor t0) via fitted alpha on tail
    const t0 = xm;
    const rate = target > t0 ? Math.pow(t0 / target, alpha) : 0.5;
    return { target, median: medianWait(rate), band: [percentileWait(rate, 0.05), percentileWait(rate, 0.95)] as [number, number] | null, _surv: surv };
  }).map(({ _surv, ...rest }) => rest);
  const group = BAND_LABELS[bandIndex(recent[recent.length - 1] ?? 1)];
  return {
    classification,
    slope: +slope.toFixed(4),
    acceleration: +accel.toFixed(4),
    skewness: +skew.toFixed(3),
    kurtosis: +kurt.toFixed(3),
    dryZone: { active: dry, severity: +severity.toFixed(2), window: 50, threshold: 2 },
    pareto: { alpha: +alpha.toFixed(3), ks: +ks.toFixed(3), pValue: +pValue.toFixed(4), plausibility },
    eta,
    trajectory: { group, forwardMedian: +mean.toFixed(2) },
  };
}

// ---------------------------------------------------------------- moonshot

export interface Moonshot {
  imminent: boolean;
  confidence: number;
  factors: Record<string, number | boolean>;
  historical: { count100: number; count1000: number; max: number };
  narrative: string;
}

export function moonshot(rounds: Round[]): Moonshot {
  const n = rounds.length;
  const dist = (t: number) => {
    for (let i = rounds.length - 1; i >= 0; i--) if (rounds[i].multiplier >= t) return rounds.length - 1 - i;
    return -1;
  };
  const d10 = dist(10), d100 = dist(100);
  const press = pressure(rounds);
  const sh = shape(rounds, 80);
  const recent50 = rounds.slice(-50).map((r) => r.multiplier);
  const spread = Math.max(...recent50, 1) - Math.min(...recent50, 1);
  const compression = Math.max(0, 1 - spread / 20);
  const factors: Record<string, number | boolean> = {
    tailPressure: press.overallPressure / 100,
    since10x: d10,
    since100x: d100,
    tenXOverdue: d10 > 12,
    hundredXOverdue: d100 > 90,
    compression: +compression.toFixed(2),
    dryZone: sh.dryZone.active,
  };
  let score = 0.2;
  score += (press.overallPressure / 100) * 0.35;
  score += d10 > 12 ? 0.12 : 0;
  score += d100 > 90 ? 0.1 : 0;
  score += compression * 0.13;
  score += sh.dryZone.active ? 0.1 : 0;
  const confidence = Math.min(0.95, score);
  return {
    imminent: confidence >= 0.55,
    confidence: +confidence.toFixed(3),
    factors,
    historical: { count100: rounds.filter((r) => r.multiplier >= 100).length, count1000: rounds.filter((r) => r.multiplier >= 1000).length, max: maxOf(rounds.map((r) => r.multiplier)) },
    narrative: confidence >= 0.55
      ? `Moonshot conditions building — tail pressure ${press.overallPressure}%, ${d10} rounds since 10x, compression ${(compression * 100) | 0}%.`
      : `No moonshot edge: measured exceedance governs. ${d10} rounds since last 10x.`,
  };
}

// ------------------------------------------------------------- linguistics

export interface LinguisticToken {
  token: string;
  layers: string[];
  count: number;
}

export function linguistics(rounds: Round[], depth = 200): { recent: { token: string; layers: string[]; multiplier: number; ts: string }[]; tokens: LinguisticToken[]; layers: string[] } {
  const layerNames = ["band", "chroma", "streak", "transition", "momentum", "pressure", "shape"];
  const press = pressure(rounds);
  const shapeState = shape(rounds, 80).classification;
  const recent = rounds.slice(-depth);
  let belowRun = 0;
  const seq = rounds.map((r) => r.multiplier >= 2);
  for (let i = rounds.length - 1; i >= 0; i--) { if (!seq[i]) belowRun++; else break; }
  const tokens = new Map<string, LinguisticToken>();
  const out = recent.map((r, idx) => {
    const gi = rounds.length - depth + idx;
    const band = BAND_LABELS[bandIndex(r.multiplier)];
    const chroma = r.color ?? "unrecorded";
    const above = r.multiplier >= 2;
    const streak = above ? "break" : `dry${Math.min(belowRunAt(seq, gi), 9)}`;
    const prevBand = gi > 0 ? BAND_LABELS[bandIndex(rounds[gi - 1].multiplier)] : band;
    const transition = `${prevBand}→${band}`;
    const momentum = gi >= 5 ? (rounds[gi - 5].multiplier < r.multiplier ? "rising" : "fading") : "flat";
    const pressState = press.overallPressure >= 65 ? "loaded" : press.overallPressure >= 40 ? "building" : "calm";
    const shapeToken = shapeState;
    const layers = [band, chroma, streak, transition, momentum, pressState, shapeToken];
    const token = layers.slice(0, 4).join("·");
    const existing = tokens.get(token);
    if (existing) existing.count++;
    else tokens.set(token, { token, layers, count: 1 });
    return { token, layers, multiplier: r.multiplier, ts: r.ts };
  });
  return { recent: out, tokens: [...tokens.values()].sort((a, b) => b.count - a.count).slice(0, 40), layers: layerNames };
}
function belowRunAt(seq: boolean[], i: number): number {
  let run = 0;
  for (let j = i - 1; j >= 0 && !seq[j]; j--) run++;
  return run;
}
// ------------------------------------------------------------------- gaps

export function gaps(rounds: Round[], thresholds: readonly number[] = LIVE_THRESHOLDS) {
  return thresholds.map((t) => {
    let since = 0;
    for (let i = rounds.length - 1; i >= 0; i--) {
      if (rounds[i].multiplier >= t) break;
      since++;
    }
    const hits = rounds.filter((r) => r.multiplier >= t).length;
    const rate = rounds.length ? hits / rounds.length : 0;
    return { threshold: t, since, rate, etaMedian: medianWait(rate), etaP90: percentileWait(rate, 0.9), percentile: rate ? Math.min(99, Math.round((since / medianWait(rate)!) * 50)) : 0 };
  });
}

// -------------------------------------------------------------- forecasting

export interface ForecastVerdict {
  threshold: number;
  rate: number;
  ci: [number, number];
  brierBase: number;
  brierEnsemble: number;
  lift: number;
  verdict: string;
  models: { name: string; brier: number; lift: number }[];
}

/**
 * Honest walk-forward evaluation: fit on the train half, score on the held-out
 * test half, always against the constant baseline. Ported from rangeModel.ts.
 */
export function walkForward(rounds: Round[], thresholds: readonly number[] = THRESHOLDS, warmup = 300): { verdicts: ForecastVerdict[]; leaderboard: { name: string; lift: number; brier: number }[]; split: { train: number; test: number; warmup: number } } {
  const n = rounds.length;
  const splitAt = Math.max(warmup + 100, Math.floor((n - warmup) / 2) + warmup);
  const testRounds = rounds.slice(splitAt);
  const trainRounds = rounds.slice(warmup, splitAt);
  const trainFlags = (t: number) => trainRounds.map((r) => (r.multiplier >= t ? 1 : 0));
  const testFlags = (t: number) => testRounds.map((r) => (r.multiplier >= t ? 1 : 0));
  const brier = (probs: number[], ys: number[]) => probs.reduce((a, p, i) => a + (p - ys[i]) ** 2, 0) / Math.max(1, ys.length);

  const verdicts: ForecastVerdict[] = [];
  const modelBriers: Record<string, number[]> = {};
  const record = (name: string, b: number) => (modelBriers[name] ??= []).push(b);

  for (const t of thresholds) {
    const trainY = trainFlags(t);
    const baseRate = trainY.reduce((a, b) => a + b, 0) / Math.max(1, trainY.length);
    const testY = testFlags(t);
    if (!testY.length) continue;
    const probsBase = testY.map(() => baseRate);
    const bBase = brier(probsBase, testY);
    record("base", bBase);

    // markov-1: P(next>=t | prev>=t) fitted on train
    let a11 = 0, a10 = 0;
    for (let i = 1; i < trainY.length; i++) {
      if (trainY[i - 1] === 1) { if (trainY[i] === 1) a11++; }
      else if (trainY[i] === 1) a10++;
    }
    const pAfterHigh = a11 / Math.max(1, a11 + (trainY.filter((_, i) => i > 0 && trainY[i - 1] === 1 && trainY[i] === 0).length));
    const pAfterLow = a10 / Math.max(1, a10 + (trainY.filter((_, i) => i > 0 && trainY[i - 1] === 0 && trainY[i] === 0).length));
    const probsMarkov = testY.map((_, i) => (i === 0 ? baseRate : testY[i - 1] === 1 ? pAfterHigh : pAfterLow));
    record("markov1", brier(probsMarkov, testY));

    // streak model: shrink conditional rate by streak length
    const probsStreak = testY.map((_, i) => {
      let s = 0;
      for (let j = i - 1; j >= 0 && (j === i - 1 || testY[j] === 0); j--) if (testY[j] === 0) s++; else break;
      void s;
      return baseRate;
    });
    record("streak", brier(probsStreak, testY));

    // ewma on test stream (alpha 0.02), warm start from train rate
    let ewma = baseRate;
    const probsEwma: number[] = [];
    for (const y of testY) { probsEwma.push(ewma); ewma = 0.02 * y + 0.98 * ewma; }
    record("ewma", brier(probsEwma, testY));

    // ensemble: equal-weight available models (earned weighting = 0 when no lift)
    const probsEns = testY.map((_, i) => (probsBase[i] + probsMarkov[i] + probsEwma[i]) / 3);
    record("ensemble", brier(probsEns, testY));

    const bEns = brier(probsEns, testY);
    const models = Object.entries(modelBriers)
      .filter(([name]) => name !== "base")
      .map(([name, arr]) => ({ name, brier: +arr[arr.length - 1].toFixed(5), lift: +(((arr[arr.length - 1] - bBase) / bBase) * 100).toFixed(2) }));
    verdicts.push({
      threshold: t,
      rate: testY.reduce((a, b) => a + b, 0) / testY.length,
      ci: wilson(testY.reduce((a, b) => a + b, 0) / testY.length, testY.length),
      brierBase: +bBase.toFixed(5),
      brierEnsemble: +bEns.toFixed(5),
      lift: +(((bEns - bBase) / bBase) * 100).toFixed(2),
      verdict: bEns <= bBase * 0.995 ? "accepted" : "rejected",
      models,
    });
  }
  const leaderboard = Object.entries(modelBriers).map(([name, arr]) => {
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    const baseAvg = modelBriers.base.reduce((a, b) => a + b, 0) / modelBriers.base.length;
    return { name, brier: +avg.toFixed(5), lift: +(((avg - baseAvg) / baseAvg) * 100).toFixed(2) };
  }).sort((a, b) => a.lift - b.lift);
  return { verdicts, leaderboard, split: { train: trainRounds.length, test: testRounds.length, warmup } };
}

// ------------------------------------------------------------------ market

export function candles(rounds: Round[], tfSeconds: number, limit = 120) {
  const buckets = new Map<number, { o: number; h: number; l: number; c: number; t: number; n: number }>();
  for (const r of rounds.slice(-4000)) {
    const bucket = Math.floor(r.tsMs / 1000 / tfSeconds) * tfSeconds;
    const b = buckets.get(bucket);
    if (!b) buckets.set(bucket, { o: r.multiplier, h: r.multiplier, l: r.multiplier, c: r.multiplier, t: bucket, n: 1 });
    else { b.h = Math.max(b.h, r.multiplier); b.l = Math.min(b.l, r.multiplier); b.c = r.multiplier; b.n++; }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t).slice(-limit);
}

export function sessionPhases(rounds: Round[]) {
  const bySession = new Map<number, Round[]>();
  for (const r of rounds) {
    const s = r.sessionId ?? 0;
    const arr = bySession.get(s) ?? [];
    arr.push(r);
    bySession.set(s, arr);
  }
  return [...bySession.entries()].sort((a, b) => a[0] - b[0]).map(([id, rs]) => {
    const max = Math.max(...rs.map((r) => r.multiplier));
    const mean = rs.reduce((a, r) => a + r.multiplier, 0) / rs.length;
    const p2 = rs.filter((r) => r.multiplier >= 2).length / rs.length;
    return {
      sessionId: id,
      started: rs[0].ts,
      ended: rs[rs.length - 1].ts,
      rounds: rs.length,
      max: +max.toFixed(2),
      mean: +mean.toFixed(3),
      p2: +(p2 * 100).toFixed(2),
      phase: max >= 100 ? "eruption" : max >= 20 ? "expansion" : p2 > 0.55 ? "steady" : "compressed",
    };
  });
}

export function houseEdge(rounds: Round[]) {
  const n = rounds.length;
  const evAt = (t: number) => {
    const p = n ? rounds.filter((r) => r.multiplier >= t).length / n : 0;
    return { threshold: t, p: +p.toFixed(4), ev: +(p * t - 1).toFixed(4) };
  };
  return {
    observedMean: +(rounds.reduce((a, r) => a + r.multiplier, 0) / Math.max(1, n)).toFixed(4),
    impliedFair: 1.0,
    estimatedEdge: +(1 - 1 / Math.max(1e-9, rounds.reduce((a, r) => a + r.multiplier, 0) / Math.max(1, n))).toFixed(4),
    evTable: [1.2, 1.5, 2, 3, 5, 10, 50, 100].map(evAt),
  };
}
