// functions/fx.ts — FX analysis engines (v6.0).
// Pure functions over the stored series: rounds in, metrics out. No I/O, no state.
// These engines feed the prediction pipeline (features + probability tilts) and
// are surfaced on the FX Analysis Lab page.

import { exceedance, maxOf, quantile, THRESHOLDS, type Round } from "./analysis";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r3 = (v: number) => +v.toFixed(3);
const r4 = (v: number) => +v.toFixed(4);

// ------------------------------------------------------------- correlation

export interface CorrelationEngine {
  n: number;
  logAcf: { lag: number; acf: number; significant: boolean }[];
  flagAcf: { lag: number; acf: number; significant: boolean }[];
  ljungBoxLog: number;
  ljungBoxFlag: number;
  note: string;
}

/** Autocorrelation + Ljung-Box on the log series and on the binary ≥threshold stream. */
export function correlationEngine(rounds: Round[], threshold = 2, maxLag = 20): CorrelationEngine {
  const recent = rounds.slice(-10000);
  const n = recent.length;
  const logs = recent.map((r) => Math.log(Math.max(1.01, r.multiplier)));
  const flags = recent.map((r) => (r.multiplier >= threshold ? 1 : 0));
  const acfOf = (series: number[]) => {
    const m = series.reduce((a, b) => a + b, 0) / Math.max(1, n);
    let c0 = 0;
    for (const v of series) c0 += (v - m) ** 2;
    const out: { lag: number; acf: number; significant: boolean }[] = [];
    let q = 0;
    for (let lag = 1; lag <= maxLag; lag++) {
      let ck = 0;
      for (let i = lag; i < n; i++) ck += (series[i] - m) * (series[i - lag] - m);
      const acf = c0 > 0 ? ck / c0 : 0;
      const sig = Math.abs(acf) > 1.96 / Math.sqrt(n);
      q += (n * (n + 2) * acf * acf) / Math.max(1, n - lag);
      out.push({ lag, acf: r4(acf), significant: sig });
    }
    return { rows: out, q: r3(q) };
  };
  const logRes = acfOf(logs);
  const flagRes = acfOf(flags);
  const anySig = logRes.rows.some((r) => r.significant) || flagRes.rows.some((r) => r.significant);
  return {
    n,
    logAcf: logRes.rows,
    flagAcf: flagRes.rows,
    ljungBoxLog: logRes.q,
    ljungBoxFlag: flagRes.q,
    note: anySig
      ? "Some lags exceed the 95% band — small but measurable serial structure."
      : "No lag exceeds the 95% band — the series behaves close to serially independent.",
  };
}

// -------------------------------------------------------------- volatility

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

/** Rolling realized volatility of log returns, EWMA vol, vol-of-vol, hour-of-day profile. */
export function volatilityProfile(rounds: Round[], window = 50): VolatilityProfile {
  const recent = rounds.slice(-6000);
  const rets = recent.map((r, i) => (i === 0 ? 0 : Math.log(Math.max(1.01, r.multiplier)) - Math.log(Math.max(1.01, recent[i - 1].multiplier))));
  const vols: { t: string; vol: number }[] = [];
  for (let i = window; i < recent.length; i++) {
    let s = 0, s2 = 0;
    for (let j = i - window + 1; j <= i; j++) { s += rets[j]; s2 += rets[j] ** 2; }
    const m = s / window;
    vols.push({ t: recent[i].ts.slice(5, 16), vol: Math.sqrt(Math.max(0, s2 / window - m * m)) });
  }
  const sorted = vols.map((v) => v.vol).sort((a, b) => a - b);
  const currentVol = vols.length ? vols[vols.length - 1].vol : 0;
  const rank = sorted.length ? sorted.findIndex((v) => v >= currentVol) / sorted.length : 0.5;
  let ewma = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  for (const v of vols) ewma = 0.06 * v.vol + 0.94 * ewma;
  const volsOfVols: number[] = [];
  for (let i = window; i < vols.length; i++) {
    let s = 0, s2 = 0;
    for (let j = i - window + 1; j <= i; j++) { s += vols[j].vol; s2 += vols[j].vol ** 2; }
    const m = s / window;
    volsOfVols.push(Math.sqrt(Math.max(0, s2 / window - m * m)));
  }
  const hourAcc = new Map<number, { s: number; n: number }>();
  for (let i = 1; i < recent.length; i++) {
    const h = new Date(recent[i].tsMs).getUTCHours();
    const e = hourAcc.get(h) ?? { s: 0, n: 0 };
    e.s += Math.abs(rets[i]);
    e.n++;
    hourAcc.set(h, e);
  }
  const hourly = Array.from({ length: 24 }, (_, h) => ({
    hour: `${String(h).padStart(2, "0")}h`,
    vol: hourAcc.has(h) ? r4(hourAcc.get(h)!.s / hourAcc.get(h)!.n) : 0,
  }));
  const volOfVol = volsOfVols.length ? volsOfVols.reduce((a, b) => a + b, 0) / volsOfVols.length : 0;
  const pct = r3(clamp(rank, 0, 1));
  return {
    currentVol: r4(currentVol),
    volPercentile: pct,
    ewmaVol: r4(ewma),
    volOfVol: r4(volOfVol),
    regime: pct >= 0.8 ? "expanded" : pct <= 0.2 ? "compressed" : "normal",
    series: vols.slice(-400),
    hourly,
    note: pct >= 0.8 ? "Volatility in the top quintile — expansion regime." : pct <= 0.2 ? "Volatility squeezed — compression regime, break risk builds." : "Volatility near its central range.",
  };
}

// -------------------------------------------------------------- order flow

export interface OrderFlow {
  bucket: number;
  buckets: { t: string; buy: number; sell: number; imbalance: number }[];
  cumulative: { t: string; cvd: number }[];
  currentImbalance: number;
  currentZ: number;
  note: string;
}

/** Buy/sell pressure proxy: per-bucket share of ≥2× rounds; cumulative delta + z-score. */
export function orderFlow(rounds: Round[], bucket = 20): OrderFlow {
  const recent = rounds.slice(-bucket * 60);
  const buckets: { t: string; buy: number; sell: number; imbalance: number }[] = [];
  let cvd = 0;
  const cumulative: { t: string; cvd: number }[] = [];
  for (let i = 0; i + bucket <= recent.length; i += bucket) {
    let buy = 0;
    for (let j = i; j < i + bucket; j++) if (recent[j].multiplier >= 2) buy++;
    const imb = (2 * buy - bucket) / bucket;
    cvd += imb;
    buckets.push({ t: recent[i].ts.slice(5, 16), buy, sell: bucket - buy, imbalance: r3(imb) });
    cumulative.push({ t: recent[i].ts.slice(5, 16), cvd: r3(cvd) });
  }
  const imbs = buckets.map((b) => b.imbalance);
  const mean = imbs.reduce((a, b) => a + b, 0) / Math.max(1, imbs.length);
  const sd = Math.sqrt(imbs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, imbs.length - 1));
  const current = imbs.length ? imbs[imbs.length - 1] : 0;
  const z = sd > 0 ? (current - mean) / sd : 0;
  return {
    bucket,
    buckets,
    cumulative,
    currentImbalance: r3(current),
    currentZ: r3(z),
    note: z > 1 ? "Aggressive buy-side pressure vs recent norm." : z < -1 ? "Sell-side (dry) pressure vs recent norm." : "Balanced two-sided flow.",
  };
}

// ---------------------------------------------------------- support density

export interface SupportDensity {
  current: number;
  bins: { from: number; to: number; count: number }[];
  supports: { level: number; touches: number }[];
  resistances: { level: number; touches: number }[];
  nearestSupport: number | null;
  nearestResistance: number | null;
  note: string;
}

/** Log-binned density of recent rounds → clustered support/resistance shelves. */
export function supportDensity(rounds: Round[], window = 800, binCount = 36): SupportDensity {
  const recent = rounds.slice(-window);
  const values = recent.map((r) => r.multiplier);
  const current = values.length ? values[values.length - 1] : 1;
  const lo = Math.log10(Math.max(1, quantile([...values].sort((a, b) => a - b), 0.02)));
  const hi = Math.log10(Math.max(lo + 0.3, maxOf(values)));
  const width = (hi - lo) / binCount || 0.1;
  const counts = new Array(binCount).fill(0) as number[];
  for (const v of values) {
    const b = clamp(Math.floor((Math.log10(Math.max(1, v)) - lo) / width), 0, binCount - 1);
    counts[b]++;
  }
  const bins = counts.map((c, b) => ({
    from: +Math.pow(10, lo + b * width).toFixed(2),
    to: +Math.pow(10, lo + (b + 1) * width).toFixed(2),
    count: c,
  }));
  const avg = values.length / binCount;
  const levels: { level: number; touches: number }[] = [];
  let run: { s: number; n: number } | null = null;
  for (let b = 0; b < binCount; b++) {
    if (counts[b] >= avg * 1.35 && counts[b] >= 3) {
      const mid = Math.pow(10, lo + (b + 0.5) * width);
      run = run ? { s: run.s + mid * counts[b], n: run.n + counts[b] } : { s: mid * counts[b], n: counts[b] };
    } else if (run) {
      levels.push({ level: +(run.s / run.n).toFixed(2), touches: run.n });
      run = null;
    }
  }
  if (run) levels.push({ level: +(run.s / run.n).toFixed(2), touches: run.n });
  const supports = levels.filter((l) => l.level < current).sort((a, b) => b.level - a.level);
  const resistances = levels.filter((l) => l.level >= current).sort((a, b) => a.level - b.level);
  return {
    current: +current.toFixed(2),
    bins,
    supports,
    resistances,
    nearestSupport: supports[0]?.level ?? null,
    nearestResistance: resistances[0]?.level ?? null,
    note: supports.length && resistances.length
      ? `Price shelf ${supports[0].level}× below, ${resistances[0].level}× above the current print.`
      : "Not enough clustered density to define shelves yet.",
  };
}

// ---------------------------------------------------------------- breakout

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

/** Range compression and the measured probability that a squeeze resolves in a breakout. */
export function breakout(rounds: Round[], window = 30, horizon = 10): Breakout {
  const recent = rounds.slice(-6000);
  const logs = recent.map((r) => Math.log(Math.max(1.01, r.multiplier)));
  const ranges: number[] = [];
  const rangeTs: string[] = [];
  for (let i = window; i < logs.length; i++) {
    let lo = Infinity, hi = -Infinity;
    for (let j = i - window + 1; j <= i; j++) { lo = Math.min(lo, logs[j]); hi = Math.max(hi, logs[j]); }
    ranges.push(hi - lo);
    rangeTs.push(recent[i].ts.slice(5, 16));
  }
  const sorted = [...ranges].sort((a, b) => a - b);
  const rangeNow = ranges.length ? ranges[ranges.length - 1] : 0;
  const pct = sorted.length ? sorted.findIndex((v) => v >= rangeNow) / sorted.length : 0.5;
  // historical resolution: after a top-quintile squeeze, does the next horizon exceed the squeeze high?
  let compN = 0, compBreaks = 0, allN = 0, allBreaks = 0;
  for (let i = window; i + horizon < recent.length; i++) {
    let lo = Infinity, hi = -Infinity;
    for (let j = i - window + 1; j <= i; j++) { lo = Math.min(lo, logs[j]); hi = Math.max(hi, logs[j]); }
    let broke = false;
    for (let j = i + 1; j <= i + horizon; j++) if (logs[j] > hi) { broke = true; break; }
    allN++;
    if (broke) allBreaks++;
    const localSorted = ranges.slice(Math.max(0, i - window - 300), i - window + 1).sort((a, b) => a - b);
    const localPct = localSorted.length > 30 ? localSorted.findIndex((v) => v >= hi - lo) / localSorted.length : 1;
    if (localPct <= 0.2) {
      compN++;
      if (broke) compBreaks++;
    }
  }
  const compRate = compN ? compBreaks / compN : 0;
  const baseRate = allN ? allBreaks / allN : 0;
  return {
    window,
    horizon,
    rangeNow: +rangeNow.toFixed(3),
    compressionPercentile: r3(1 - clamp(pct, 0, 1)),
    series: ranges.slice(-300).map((v, i) => ({ t: rangeTs[Math.max(0, ranges.length - 300 + i)], range: +v.toFixed(3) })),
    postCompressionBreakRate: r4(compRate),
    baseBreakRate: r4(baseRate),
    sample: compN,
    note: compRate > baseRate * 1.1
      ? `Squeezes resolve upward ${((compRate / Math.max(1e-9, baseRate) - 1) * 100).toFixed(0)}% more often than base — compression carries information here.`
      : "Compression shows no measured breakout edge — squeezes resolve at the base rate.",
  };
}

// ----------------------------------------------------------- mean reversion

export interface MeanReversion {
  hurst: number;
  varianceRatios: { q: number; vr: number }[];
  ar1: number;
  halfLife: number | null;
  zScore: number;
  interpretation: string;
}

/** Hurst (R/S), variance ratios, AR(1) mean-reversion speed and half-life. */
export function meanReversion(rounds: Round[]): MeanReversion {
  const recent = rounds.slice(-5000);
  const logs = recent.map((r) => Math.log(Math.max(1.01, r.multiplier)));
  const n = logs.length;
  // Hurst via rescaled range over geometric window sizes
  const sizes: number[] = [];
  for (let s = 16; s <= Math.floor(n / 2); s *= 2) sizes.push(s);
  const rs: { x: number; y: number }[] = [];
  for (const size of sizes) {
    let rsSum = 0, blocks = 0;
    for (let start = 0; start + size <= n; start += size) {
      const seg = logs.slice(start, start + size);
      const m = seg.reduce((a, b) => a + b, 0) / size;
      let cum = 0, lo = Infinity, hi = -Infinity, ss = 0;
      for (const v of seg) { cum += v - m; lo = Math.min(lo, cum); hi = Math.max(hi, cum); ss += (v - m) ** 2; }
      const sd = Math.sqrt(ss / size);
      if (sd > 0) { rsSum += (hi - lo) / sd; blocks++; }
    }
    if (blocks) rs.push({ x: Math.log(size), y: Math.log(Math.max(1e-9, rsSum / blocks)) });
  }
  let hurst = 0.5;
  if (rs.length >= 2) {
    const mx = rs.reduce((a, p) => a + p.x, 0) / rs.length;
    const my = rs.reduce((a, p) => a + p.y, 0) / rs.length;
    let num = 0, den = 0;
    for (const p of rs) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; }
    hurst = den ? clamp(num / den, 0, 1) : 0.5;
  }
  // variance ratios on first differences
  const diffs = logs.slice(1).map((v, i) => v - logs[i]);
  const varOf = (arr: number[]) => {
    const m = arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
    return arr.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, arr.length);
  };
  const v1 = varOf(diffs);
  const varianceRatios = [2, 4, 8].map((q) => {
    const agg: number[] = [];
    for (let i = q - 1; i < diffs.length; i += 1) {
      let s = 0;
      for (let j = i - q + 1; j <= i; j++) s += diffs[j];
      agg.push(s);
    }
    return { q, vr: r3(v1 > 0 ? varOf(agg) / (q * v1) : 1) };
  });
  // AR(1) on the log level
  let sxy = 0, sxx = 0;
  const mx = (logs[n - 1] + logs[0]) / 2;
  for (let i = 1; i < n; i++) { sxy += logs[i - 1] * logs[i]; sxx += logs[i - 1] ** 2; }
  const phi = sxx > 0 ? sxy / sxx : 1;
  const halfLife = phi > 0 && phi < 1 ? Math.round(Math.LN2 / -Math.log(Math.max(1e-9, phi))) : null;
  const windowLogs = logs.slice(-50);
  const wm = windowLogs.reduce((a, b) => a + b, 0) / Math.max(1, windowLogs.length);
  const wsd = Math.sqrt(windowLogs.reduce((a, b) => a + (b - wm) ** 2, 0) / Math.max(1, windowLogs.length));
  const z = wsd > 0 ? (logs[n - 1] - wm) / wsd : 0;
  return {
    hurst: r3(hurst),
    varianceRatios,
    ar1: r3(phi),
    halfLife,
    zScore: r3(z),
    interpretation: hurst < 0.45 ? "Mean-reverting tendency (H<0.45) — excursions tend to fade." : hurst > 0.55 ? "Trending/persistent tendency (H>0.55) — moves cluster." : "Random-walk-like (H≈0.5) — no reversion or persistence edge.",
  };
}

// ------------------------------------------------------------ trend quality

export interface TrendQuality {
  efficiency: number;
  r2: number;
  direction: "up" | "down" | "flat";
  classification: "trending" | "ranging";
  series: { t: string; eff: number }[];
  note: string;
}

/** Kaufman efficiency ratio + log-linear R² — trend quality over the recent window. */
export function trendQuality(rounds: Round[], window = 60): TrendQuality {
  const recent = rounds.slice(-6000);
  const logs = recent.map((r) => Math.log(Math.max(1.01, r.multiplier)));
  const effAt = (i: number) => {
    let net = Math.abs(logs[i] - logs[i - window + 1]);
    let path = 0;
    for (let j = i - window + 2; j <= i; j++) path += Math.abs(logs[j] - logs[j - 1]);
    return path > 0 ? net / path : 0;
  };
  const series: { t: string; eff: number }[] = [];
  for (let i = window - 1; i < logs.length; i += Math.max(1, Math.floor((logs.length - window) / 240))) {
    series.push({ t: recent[i].ts.slice(5, 16), eff: r3(effAt(i)) });
  }
  const last = logs.length ? logs[logs.length - 1] : 0;
  const first = logs.length ? logs[Math.max(0, logs.length - window)] : 0;
  const efficiency = logs.length >= window ? r3(effAt(logs.length - 1)) : 0;
  // R² of the log-linear fit on the window
  const seg = logs.slice(-window);
  const n = seg.length;
  const mx = (n - 1) / 2;
  const my = seg.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  seg.forEach((y, x) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; });
  const slope = sxx ? sxy / sxx : 0;
  const r2 = syy > 0 ? clamp((sxy ** 2) / (sxx * syy), 0, 1) : 0;
  return {
    efficiency,
    r2: r3(r2),
    direction: slope > 0.002 ? "up" : slope < -0.002 ? "down" : "flat",
    classification: efficiency > 0.35 && r2 > 0.25 ? "trending" : "ranging",
    series,
    note: efficiency > 0.35 ? "Directional efficiency elevated — trends are being paid." : "Choppy tape — path/net ratio favors range tactics.",
  };
}

// ---------------------------------------------------------------- event risk

export interface EventRisk {
  extremeThreshold: number;
  anomalyRate: number;
  sinceLastExtreme: number | null;
  zNow: number;
  anomalies: { ts: string; multiplier: number; z: number }[];
  note: string;
}

/** Rolling z-score anomaly scan against the q99.5 extreme line. */
export function eventRisk(rounds: Round[], window = 200, scan = 4000): EventRisk {
  const recent = rounds.slice(-scan);
  const logs = recent.map((r) => Math.log(Math.max(1.01, r.multiplier)));
  const sortedAll = [...recent.map((r) => r.multiplier)].sort((a, b) => a - b);
  const extremeThreshold = sortedAll.length ? +quantile(sortedAll, 0.995).toFixed(2) : 100;
  const anomalies: { ts: string; multiplier: number; z: number }[] = [];
  let anomalyCount = 0;
  let sinceExtreme: number | null = null;
  for (let i = window; i < recent.length; i++) {
    const seg = logs.slice(i - window, i);
    const m = seg.reduce((a, b) => a + b, 0) / window;
    const sd = Math.sqrt(seg.reduce((a, b) => a + (b - m) ** 2, 0) / window);
    const z = sd > 0 ? (logs[i] - m) / sd : 0;
    if (Math.abs(z) > 3) {
      anomalyCount++;
      if (anomalies.length < 12 || i > recent.length - 12) anomalies.push({ ts: recent[i].ts, multiplier: +recent[i].multiplier.toFixed(2), z: r3(z) });
    }
  }
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].multiplier >= extremeThreshold) { sinceExtreme = recent.length - 1 - i; break; }
  }
  const lastSeg = logs.slice(-window);
  const lm = lastSeg.reduce((a, b) => a + b, 0) / Math.max(1, lastSeg.length);
  const lsd = Math.sqrt(lastSeg.reduce((a, b) => a + (b - lm) ** 2, 0) / Math.max(1, lastSeg.length));
  return {
    extremeThreshold,
    anomalyRate: r4(anomalyCount / Math.max(1, recent.length - window)),
    sinceLastExtreme: sinceExtreme,
    zNow: lsd > 0 ? r3((logs[logs.length - 1] - lm) / lsd) : 0,
    anomalies: anomalies.slice(-12).reverse(),
    note: sinceExtreme !== null ? `Last q99.5 extreme (${extremeThreshold}×) landed ${sinceExtreme} rounds ago.` : "No q99.5 extreme in the scanned window.",
  };
}

// ---------------------------------------------------------------- divergence

export interface DivergenceRow {
  source: string;
  rounds: number;
  divergences: { threshold: number; rate: number; base: number; deltaPct: number }[];
  score: number;
}

/** Per-source exceedance vs the blended baseline — who deviates, and by how much. */
export function divergence(rounds: Round[], thresholds: number[] = [2, 5, 10]): DivergenceRow[] {
  const bySource = new Map<string, number[]>();
  for (const r of rounds) {
    const arr = bySource.get(r.source);
    if (arr) arr.push(r.multiplier);
    else bySource.set(r.source, [r.multiplier]);
  }
  const total = rounds.length;
  const baseAt = (t: number) => (total ? rounds.reduce((a, r) => a + (r.multiplier >= t ? 1 : 0), 0) / total : 0);
  const rows: DivergenceRow[] = [];
  for (const [source, mults] of bySource) {
    if (mults.length < 200) continue;
    const divergences = thresholds.map((t) => {
      const rate = mults.reduce((a, m) => a + (m >= t ? 1 : 0), 0) / mults.length;
      const base = baseAt(t);
      return { threshold: t, rate: r4(rate), base: r4(base), deltaPct: r3(base > 0 ? (rate - base) / base * 100 : 0) };
    });
    const score = r3(maxOf(divergences.map((d) => Math.abs(d.deltaPct))));
    rows.push({ source, rounds: mults.length, divergences, score });
  }
  return rows.sort((a, b) => b.score - a.score);
}

// ----------------------------------------------------------------- signals

export interface FxSignal {
  key: string;
  label: string;
  value: string;
  dir: number;
  note: string;
}

/** Composite signal vector consumed by the prediction pipeline and the UI. */
export function fxSignals(rounds: Round[]): { signals: FxSignal[]; engines: Record<string, unknown> } {
  const trend = trendQuality(rounds);
  const rev = meanReversion(rounds);
  const vol = volatilityProfile(rounds);
  const flow = orderFlow(rounds);
  const brk = breakout(rounds);
  const events = eventRisk(rounds);
  const signals: FxSignal[] = [
    { key: "trend", label: "Trend quality", value: `${trend.classification} (ER ${trend.efficiency})`, dir: trend.classification === "trending" ? (trend.direction === "up" ? 0.6 : -0.6) : 0, note: trend.note },
    { key: "reversion", label: "Mean reversion", value: `H ${rev.hurst} · z ${rev.zScore}`, dir: rev.zScore < -1.5 ? 0.5 : rev.zScore > 1.5 ? -0.5 : 0, note: rev.interpretation },
    { key: "vol", label: "Volatility regime", value: `${vol.regime} (p${Math.round(vol.volPercentile * 100)})`, dir: vol.regime === "compressed" ? 0.4 : vol.regime === "expanded" ? -0.2 : 0, note: vol.note },
    { key: "flow", label: "Order-flow tilt", value: `z ${flow.currentZ}`, dir: clamp(flow.currentZ / 2, -1, 1), note: flow.note },
    { key: "breakout", label: "Breakout setup", value: `${Math.round(brk.compressionPercentile * 100)}% squeeze`, dir: brk.compressionPercentile > 0.8 ? 0.5 : 0, note: brk.note },
    { key: "events", label: "Event risk", value: events.sinceLastExtreme !== null ? `${events.sinceLastExtreme} since extreme` : "quiet", dir: 0, note: events.note },
  ];
  return {
    signals,
    engines: { trend, reversion: rev, volatility: vol, orderFlow: flow, breakout: brk, events, density: supportDensity(rounds), correlation: correlationEngine(rounds) },
  };
}

// Re-export for pipeline convenience.
export { exceedance, THRESHOLDS };
