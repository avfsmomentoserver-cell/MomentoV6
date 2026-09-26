// functions/v64.ts — Momento V6.4 research engines (pure functions, no I/O).
//
//  • Top-rounds parser     Spribe "Top → Rounds → Day/Month/Year" HTML or text
//  • Cadence model         inter-round time as a function of the previous multiplier
//  • Gap reconstruction    labelled fills between session gaps, anchored on real top rounds
//  • Span seeder           multipliers without timestamps spread across a known window
//  • DNA / Pattern DNA     multi-length k-mer scans with range filters + live overlay
//  • Linguistics v2        vocabulary, sentences, phrases, entropy, next-word model
//  • Investigation         single-round case file + range case file
//  • Shape projection      analogue-ensemble projected shapes, named, decomputed into rounds + ETA
//
// Every statistic is reported next to its baseline. Aviator is a provably-fair
// RNG, so the honest default expectation is "no edge"; these engines measure
// whether that expectation is ever violated, they do not assume it is.

import type { Round } from "./analysis";

// ------------------------------------------------------------------ helpers

export const AVIATOR = { blue: "rgb(52, 180, 255)", purple: "rgb(145, 62, 248)", pink: "rgb(192, 23, 180)" } as const;
export type Hue = "blue" | "purple" | "pink";
export const hueOf = (m: number): Hue => (m < 2 ? "blue" : m < 10 ? "purple" : "pink");

const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const ln = (m: number) => Math.log(Math.max(1, m));

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}
function quant(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
/** One-sample binomial z for k hits in n trials against base rate p0. */
function zScore(k: number, n: number, p0: number): number {
  if (!n || p0 <= 0 || p0 >= 1) return 0;
  return (k - n * p0) / Math.sqrt(n * p0 * (1 - p0));
}

// ------------------------------------------------------------- range filter

export interface RangeFilter {
  fromMs?: number | null;
  toMs?: number | null;
  minX?: number | null;
  maxX?: number | null;
  sessionId?: number | null;
  lastN?: number | null;
}

/**
 * Restrict the analysed series. Time / session / lastN cut the timeline;
 * minX/maxX keep only rounds whose multiplier falls in range (a "sub-language"
 * — e.g. the grammar of rounds between 2x and 10x).
 */
export function applyRange(rounds: Round[], f: RangeFilter): Round[] {
  let out = rounds;
  if (f.fromMs) out = out.filter((r) => r.tsMs >= f.fromMs!);
  if (f.toMs) out = out.filter((r) => r.tsMs <= f.toMs!);
  if (f.sessionId) out = out.filter((r) => r.sessionId === f.sessionId);
  if (f.minX) out = out.filter((r) => r.multiplier >= f.minX!);
  if (f.maxX) out = out.filter((r) => r.multiplier <= f.maxX!);
  if (f.lastN && out.length > f.lastN) out = out.slice(-f.lastN);
  return out;
}

export function rangeFromQuery(q: URLSearchParams): RangeFilter {
  const num = (k: string) => {
    const v = q.get(k);
    if (v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const time = (k: string) => {
    const v = q.get(k);
    if (!v) return null;
    const n = Number(v);
    if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000;
    const p = Date.parse(v);
    return Number.isNaN(p) ? null : p;
  };
  return { fromMs: time("from"), toMs: time("to"), minX: num("minX"), maxX: num("maxX"), sessionId: num("session"), lastN: num("lastN") };
}

// -------------------------------------------------------- top-rounds parser

export interface TopRow {
  scope: "day" | "month" | "year" | "unknown";
  metric: string;
  localText: string;
  tsMs: number;
  multiplier: number;
}
export interface TopParse {
  blocks: { scope: TopRow["scope"]; metric: string; rows: number; min: number; max: number }[];
  rows: TopRow[];
  warnings: string[];
}

/**
 * Parse Spribe Aviator "Top" widget markup (or plain "26.09.26 07:04 714.95x"
 * lines). Several pasted widgets are split on the tab switcher; each block's
 * active tabs give its metric (X / Win / Rounds) and scope (Day / Month / Year).
 * Dates are DD.MM.YY HH:MM in the viewer's local time → tzOffsetMin converts.
 */
export function parseTopRounds(input: string, tzOffsetMin = 120): TopParse {
  const warnings: string[] = [];
  const rows: TopRow[] = [];
  const blocks: TopParse["blocks"] = [];
  const toMs = (dd: string, mo: string, yy: string, hh: string, mi: string) =>
    Date.UTC(2000 + Number(yy), Number(mo) - 1, Number(dd), Number(hh), Number(mi)) - tzOffsetMin * 60_000;
  const parts = input.includes("top-tab-switcher") ? input.split(/<app-top-tab-switcher/i).slice(1) : [input];
  const rowRe = /(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})(?:\s*<\/div>\s*<div[^>]*>)?\s*([\d][\d,\s]*(?:\.\d+)?)\s*x/gi;
  for (const part of parts) {
    const actives = [...part.matchAll(/top-tab-switcher__tab[^"]*--active[^"]*"[^>]*>\s*([A-Za-z]+)\s*</g)].map((m) => m[1]);
    const metric = actives.find((a) => /^(x|win|rounds)$/i.test(a)) ?? "Rounds";
    const scopeRaw = (actives.find((a) => /^(day|month|year)$/i.test(a)) ?? "unknown").toLowerCase();
    const scope = (["day", "month", "year"].includes(scopeRaw) ? scopeRaw : "unknown") as TopRow["scope"];
    const text = part.replace(/<!---->/g, "");
    const local: TopRow[] = [];
    for (const m of text.matchAll(rowRe)) {
      const mult = Number(m[6].replace(/[,\s]/g, ""));
      if (!Number.isFinite(mult) || mult < 1) continue;
      local.push({ scope, metric, localText: `${m[1]}.${m[2]}.${m[3]} ${m[4]}:${m[5]}`, tsMs: toMs(m[1], m[2], m[3], m[4], m[5]), multiplier: mult });
    }
    if (!local.length) continue;
    if (!/rounds/i.test(metric)) warnings.push(`A ${metric} block was found — only the "Rounds" tab lists round multipliers; its rows were still read as multipliers.`);
    blocks.push({ scope, metric, rows: local.length, min: Math.min(...local.map((r) => r.multiplier)), max: Math.max(...local.map((r) => r.multiplier)) });
    rows.push(...local);
  }
  if (!rows.length) warnings.push("No DD.MM.YY HH:MM + multiplier pairs were found.");
  return { blocks, rows, warnings };
}

export const scopeKey = (scope: TopRow["scope"], tsMs: number, tzOffsetMin = 120): string => {
  const d = new Date(tsMs + tzOffsetMin * 60_000).toISOString();
  return scope === "day" ? d.slice(0, 10) : scope === "month" ? d.slice(0, 7) : scope === "year" ? d.slice(0, 4) : "unknown";
};

// ------------------------------------------------------------ cadence model

export interface Cadence {
  a: number; // fixed ms between rounds (betting window + ramp)
  b: number; // ms per ln(multiplier) of flight
  medianMs: number;
  sample: number;
}

/** Least-squares fit of Δt(i→i+1) = a + b·ln(m_i) on consecutive real rounds. */
export function fitCadence(rounds: Round[]): Cadence {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 1; i < rounds.length; i++) {
    if (rounds[i].source !== rounds[i - 1].source) continue;
    const d = rounds[i].tsMs - rounds[i - 1].tsMs;
    if (d <= 2_000 || d > 180_000) continue;
    xs.push(ln(rounds[i - 1].multiplier));
    ys.push(d);
  }
  const n = xs.length;
  if (n < 30) return { a: 12_000, b: 6_000, medianMs: 14_000, sample: n };
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const b = sxx > 0 ? Math.max(0, sxy / sxx) : 0;
  const a = Math.max(3_000, my - b * mx);
  return { a: Math.round(a), b: Math.round(b), medianMs: Math.round(median(ys)), sample: n };
}
export const stepMs = (c: Cadence, prevMult: number) => c.a + c.b * ln(prevMult);

// ------------------------------------------------------ gap reconstruction

export interface Anchor {
  tsMs: number;
  multiplier: number;
}
export interface GapPlan {
  source: string;
  startMs: number;
  endMs: number;
  gapSec: number;
  anchors: number;
  fills: number;
  cap: number | null;
}
export interface ReconRound {
  tsMs: number;
  multiplier: number;
  origin: "reconstructed" | "anchor";
}
export interface ReconOptions {
  minGapSec: number;
  maxGapHours: number;
  maxFillPerGap: number;
  seed: number;
  fromMs?: number | null;
  toMs?: number | null;
}

/**
 * Plan and synthesise fills between session gaps for one source.
 *
 * Inside every gap: known top rounds become fixed anchors at their minute
 * (mid-minute timestamp); the remaining slots are paced by the cadence model
 * and filled by bootstrap samples of the source's own observed distribution.
 * A full top list for a day / month / year is also an upper bound: no
 * unlisted round of that period exceeded the list minimum, so fills are
 * resampled below that cap. Every fill is labelled origin = "reconstructed".
 */
export function planReconstruction(
  observed: Round[],
  anchors: Anchor[],
  caps: (tsMs: number) => number | null,
  opts: ReconOptions,
): { gaps: GapPlan[]; rounds: ReconRound[]; cadence: Cadence } {
  const cadence = fitCadence(observed);
  const rng = mulberry32(opts.seed);
  const pool = observed.map((r) => r.multiplier);
  const gaps: GapPlan[] = [];
  const out: ReconRound[] = [];
  if (pool.length < 50) return { gaps, rounds: out, cadence };
  const draw = (cap: number | null) => {
    for (let t = 0; t < 40; t++) {
      const v = pool[Math.floor(rng() * pool.length)];
      if (cap === null || v < cap) return v;
    }
    return Math.min(pool[Math.floor(rng() * pool.length)], cap ? cap * 0.99 : Infinity);
  };
  const sortedAnchors = [...anchors].sort((a, b) => a.tsMs - b.tsMs);
  for (let i = 1; i < observed.length; i++) {
    const prev = observed[i - 1];
    const next = observed[i];
    if (prev.source !== next.source) continue;
    const gapMs = next.tsMs - prev.tsMs;
    if (gapMs < opts.minGapSec * 1000 || gapMs > opts.maxGapHours * 3_600_000) continue;
    if (opts.fromMs && next.tsMs < opts.fromMs) continue;
    if (opts.toMs && prev.tsMs > opts.toMs) continue;
    const inGap = sortedAnchors.filter((a) => a.tsMs > prev.tsMs + 2_000 && a.tsMs < next.tsMs - 2_000);
    // segment the gap at anchors: [prev → a1 → a2 … → next]
    const points: { tsMs: number; multiplier: number; anchor: boolean }[] = [
      { tsMs: prev.tsMs, multiplier: prev.multiplier, anchor: false },
      ...inGap.map((a) => ({ tsMs: a.tsMs, multiplier: a.multiplier, anchor: true })),
      { tsMs: next.tsMs, multiplier: next.multiplier, anchor: false },
    ];
    let fills = 0;
    let gapCap: number | null = null;
    for (let s = 1; s < points.length && fills < opts.maxFillPerGap; s++) {
      const a = points[s - 1];
      const b = points[s];
      let t = a.tsMs;
      let m = a.multiplier;
      const seg: ReconRound[] = [];
      // walk forward while the next paced round still leaves room before b
      while (fills + seg.length < opts.maxFillPerGap) {
        const cap = caps(t);
        gapCap = gapCap === null ? cap : cap === null ? gapCap : Math.min(gapCap, cap);
        const v = draw(cap);
        const tNext = t + stepMs(cadence, m);
        if (tNext + stepMs(cadence, v) * 0.5 > b.tsMs) break;
        seg.push({ tsMs: Math.round(tNext), multiplier: r2(v), origin: "reconstructed" });
        t = tNext;
        m = v;
      }
      // stretch the segment so its pacing ends exactly one step before b
      if (seg.length) {
        const span = seg[seg.length - 1].tsMs - a.tsMs;
        const target = b.tsMs - a.tsMs - stepMs(cadence, seg[seg.length - 1].multiplier);
        const k = span > 0 && target > 0 ? target / span : 1;
        for (const r of seg) r.tsMs = Math.round(a.tsMs + (r.tsMs - a.tsMs) * Math.min(1.5, Math.max(0.6, k)));
      }
      out.push(...seg);
      fills += seg.length;
      if (b.anchor) out.push({ tsMs: b.tsMs, multiplier: b.multiplier, origin: "anchor" });
    }
    gaps.push({ source: prev.source, startMs: prev.tsMs, endMs: next.tsMs, gapSec: Math.round(gapMs / 1000), anchors: inGap.length, fills, cap: gapCap });
  }
  return { gaps, rounds: out, cadence };
}

/**
 * Span seeder: rounds known only by order (e.g. copied from the in-game
 * "Previous" history) spread across [startMs, endMs] with cadence-shaped
 * spacing so longer flights take proportionally longer.
 */
export function spreadSpan(mults: number[], startMs: number, endMs: number, cadence: Cadence): { tsMs: number; multiplier: number }[] {
  if (!mults.length) return [];
  if (mults.length === 1) return [{ tsMs: startMs, multiplier: mults[0] }];
  const steps = mults.slice(0, -1).map((m) => stepMs(cadence, m));
  const total = steps.reduce((s, x) => s + x, 0);
  const scale = total > 0 ? (endMs - startMs) / total : 0;
  let t = startMs;
  return mults.map((m, i) => {
    const row = { tsMs: Math.round(t), multiplier: m };
    if (i < steps.length) t += steps[i] * scale;
    return row;
  });
}

// ------------------------------------------------------- DNA / pattern DNA

export type Alphabet = "band" | "hue" | "binary" | "tempo";
export const ALPHABETS: Record<Alphabet, { label: string; symbols: string[] }> = {
  band: { label: "6 bands · A <1.5 · B 1.5–2 · C 2–5 · D 5–10 · E 10–100 · F 100+", symbols: ["A", "B", "C", "D", "E", "F"] },
  hue: { label: "Aviator colours · b blue <2 · p purple 2–10 · k pink 10+", symbols: ["b", "p", "k"] },
  binary: { label: "Binary around a pivot (default 2x) · 0 below · 1 at/above", symbols: ["0", "1"] },
  tempo: { label: "Hue × tempo · uppercase = long wait before the round", symbols: ["b", "p", "k", "B", "P", "K"] },
};

export function encode(rounds: Round[], alphabet: Alphabet, pivot = 2, cadence?: Cadence): string[] {
  return rounds.map((r, i) => {
    const m = r.multiplier;
    if (alphabet === "band") return m < 1.5 ? "A" : m < 2 ? "B" : m < 5 ? "C" : m < 10 ? "D" : m < 100 ? "E" : "F";
    if (alphabet === "binary") return m >= pivot ? "1" : "0";
    const h = m < 2 ? "b" : m < 10 ? "p" : "k";
    if (alphabet === "hue") return h;
    const prev = rounds[i - 1];
    const expected = cadence && prev ? stepMs(cadence, prev.multiplier) : 15_000;
    const slow = prev ? r.tsMs - prev.tsMs > expected * 1.8 : false;
    return slow ? h.toUpperCase() : h;
  });
}

export interface DnaTarget {
  lo: number;
  hi: number;
  label: string;
}
export interface DnaPattern {
  pattern: string;
  k: number;
  n: number;
  hits: number;
  rate: number;
  ci: [number, number];
  base: number;
  lift: number;
  z: number;
  avgNext: number;
  lastSeenMs: number | null;
}
export interface DnaScan {
  alphabet: Alphabet;
  alphabetLabel: string;
  target: DnaTarget;
  kRange: [number, number];
  analysed: number;
  baseRate: number;
  tested: number;
  expectedFalsePositives: number;
  significant: number;
  top: DnaPattern[];
  under: DnaPattern[];
  live: DnaPattern[];
  byK: { k: number; patterns: number; significant: number; maxAbsZ: number }[];
  verdict: string;
  table: Record<string, [number, number, number]>; // pattern → [n, hits, sumNext]
}

/**
 * Scan every k-mer (kMin…kMax) of the encoded series and measure the rate at
 * which the NEXT round lands in the target range, against the base rate.
 * Reports |z| ≥ 3 patterns and — importantly — how many such patterns chance
 * alone would produce given the number tested (multiple-comparison control).
 */
export function dnaScan(
  rounds: Round[],
  opts: { alphabet: Alphabet; kMin: number; kMax: number; target: DnaTarget; minSupport: number; pivot?: number; limit?: number; cadence?: Cadence },
): DnaScan {
  const sym = encode(rounds, opts.alphabet, opts.pivot ?? 2, opts.cadence);
  const inT = rounds.map((r) => r.multiplier >= opts.target.lo && r.multiplier < opts.target.hi);
  const nAll = Math.max(1, rounds.length);
  const base = inT.filter(Boolean).length / nAll;
  const table: Record<string, [number, number, number]> = {};
  const last: Record<string, number> = {};
  for (let k = opts.kMin; k <= opts.kMax; k++) {
    for (let i = k; i < rounds.length; i++) {
      const p = `${k}:${sym.slice(i - k, i).join("")}`;
      const row = table[p] ?? (table[p] = [0, 0, 0]);
      row[0]++;
      if (inT[i]) row[1]++;
      row[2] += Math.min(rounds[i].multiplier, 1000);
      last[p] = rounds[i].tsMs;
    }
  }
  const all: DnaPattern[] = [];
  const byK = new Map<number, { patterns: number; significant: number; maxAbsZ: number }>();
  for (const [key, [n, hits, sum]] of Object.entries(table)) {
    const k = Number(key.split(":")[0]);
    const agg = byK.get(k) ?? { patterns: 0, significant: 0, maxAbsZ: 0 };
    agg.patterns++;
    if (n < opts.minSupport) {
      byK.set(k, agg);
      continue;
    }
    const z = zScore(hits, n, base);
    if (Math.abs(z) >= 3) agg.significant++;
    agg.maxAbsZ = Math.max(agg.maxAbsZ, Math.abs(z));
    byK.set(k, agg);
    all.push({ pattern: key.split(":")[1], k, n, hits, rate: r4(hits / n), ci: wilson(hits, n).map(r4) as [number, number], base: r4(base), lift: r4(base ? hits / n / base : 0), z: r2(z), avgNext: r2(sum / n), lastSeenMs: last[key] ?? null });
  }
  const tested = all.length;
  // P(|Z| ≥ 3) under the null ≈ 0.0027
  const expectedFalsePositives = r2(tested * 0.0027);
  const significant = all.filter((p) => Math.abs(p.z) >= 3).length;
  const limit = opts.limit ?? 40;
  const top = [...all].sort((a, b) => b.z - a.z).slice(0, limit);
  const under = [...all].sort((a, b) => a.z - b.z).slice(0, Math.min(15, limit));
  const live: DnaPattern[] = [];
  for (let k = opts.kMin; k <= opts.kMax; k++) {
    const p = sym.slice(-k).join("");
    const hit = all.find((x) => x.k === k && x.pattern === p);
    if (hit) live.push(hit);
    else {
      const row = table[`${k}:${p}`];
      if (row) live.push({ pattern: p, k, n: row[0], hits: row[1], rate: r4(row[1] / row[0]), ci: wilson(row[1], row[0]).map(r4) as [number, number], base: r4(base), lift: r4(base ? row[1] / row[0] / base : 0), z: r2(zScore(row[1], row[0], base)), avgNext: r2(row[2] / row[0]), lastSeenMs: last[`${k}:${p}`] ?? null });
    }
  }
  const excess = significant - expectedFalsePositives;
  const verdict =
    tested === 0
      ? "Not enough data for this range — widen the filter or lower min support."
      : excess > Math.max(3, 2 * Math.sqrt(expectedFalsePositives + 1))
        ? `${significant} patterns at |z|≥3 vs ~${expectedFalsePositives} expected by chance — structure worth a hold-out test.`
        : `${significant} patterns at |z|≥3 vs ~${expectedFalsePositives} expected by chance — consistent with randomness (no reliable DNA edge).`;
  return {
    alphabet: opts.alphabet,
    alphabetLabel: ALPHABETS[opts.alphabet].label,
    target: opts.target,
    kRange: [opts.kMin, opts.kMax],
    analysed: rounds.length,
    baseRate: r4(base),
    tested,
    expectedFalsePositives,
    significant,
    top,
    under,
    live,
    byK: [...byK.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ k, ...v, maxAbsZ: r2(v.maxAbsZ) })),
    verdict,
    table,
  };
}

/** Realtime overlay: look up the live k-mers in a stored (scheduled) scan table. */
export function dnaOverlay(rounds: Round[], snapshot: { alphabet: Alphabet; kRange: [number, number]; baseRate: number; table: Record<string, [number, number, number]>; pivot?: number }, cadence?: Cadence) {
  const sym = encode(rounds.slice(-64), snapshot.alphabet, snapshot.pivot ?? 2, cadence);
  const out: { k: number; pattern: string; n: number; rate: number; lift: number; z: number }[] = [];
  for (let k = snapshot.kRange[0]; k <= snapshot.kRange[1]; k++) {
    const p = sym.slice(-k).join("");
    const row = snapshot.table[`${k}:${p}`];
    if (!row) {
      out.push({ k, pattern: p, n: 0, rate: 0, lift: 0, z: 0 });
      continue;
    }
    out.push({ k, pattern: p, n: row[0], rate: r4(row[1] / row[0]), lift: r4(snapshot.baseRate ? row[1] / row[0] / snapshot.baseRate : 0), z: r2(zScore(row[1], row[0], snapshot.baseRate)) });
  }
  return out;
}

// ----------------------------------------------------------- linguistics v2

export const WORDS = [
  { word: "dust", lo: 1, hi: 1.2, gloss: "instant crash" },
  { word: "low", lo: 1.2, hi: 1.5, gloss: "shallow flight" },
  { word: "soft", lo: 1.5, hi: 2, gloss: "near-miss below 2x" },
  { word: "lift", lo: 2, hi: 3, gloss: "clears 2x" },
  { word: "climb", lo: 3, hi: 5, gloss: "solid climb" },
  { word: "rise", lo: 5, hi: 10, gloss: "strong purple" },
  { word: "surge", lo: 10, hi: 50, gloss: "pink round" },
  { word: "blast", lo: 50, hi: 100, gloss: "deep pink" },
  { word: "moon", lo: 100, hi: 1000, gloss: "three-digit moon" },
  { word: "legend", lo: 1000, hi: Infinity, gloss: "four-digit+ legend" },
] as const;
export const wordOf = (m: number) => (WORDS.find((w) => m >= w.lo && m < w.hi) ?? WORDS[WORDS.length - 1]).word;

export interface LinguisticsV2 {
  analysed: number;
  lexicon: { word: string; gloss: string; lo: number; hi: number; count: number; share: number; hue: Hue }[];
  entropyBits: number;
  maxEntropyBits: number;
  entropyTrend: { index: number; bits: number }[];
  typeTokenRatio: number;
  stream: { id: number; word: string; hue: Hue; multiplier: number; ts: string; tempo: "quick" | "steady" | "slow" | "gap"; origin?: string }[];
  sentences: {
    count: number;
    meanLength: number;
    expectedLength: number;
    current: { words: string[]; length: number };
    recent: { words: string[]; length: number; closer: string; closedAt: string }[];
    lengthHistogram: { length: string; count: number; expected: number }[];
  };
  phrases: { phrase: string; n: number; count: number; expected: number; lift: number; z: number }[];
  underPhrases: { phrase: string; n: number; count: number; expected: number; lift: number; z: number }[];
  nextWord: { context: string; order: number; support: number; dist: { word: string; p: number; base: number }[]; pLift2x: number; base2x: number };
  narrative: string;
}

/** A multi-layer reading of the series as language: words, sentences (split at pink rounds), phrases, entropy and a back-off next-word model. */
export function linguisticsV2(rounds: Round[], depth = 240, cadence?: Cadence): LinguisticsV2 {
  const words = rounds.map((r) => wordOf(r.multiplier));
  const n = words.length || 1;
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  const lexicon = WORDS.map((w) => ({ word: w.word, gloss: w.gloss, lo: w.lo, hi: w.hi === Infinity ? 1e9 : w.hi, count: counts.get(w.word) ?? 0, share: r4((counts.get(w.word) ?? 0) / n), hue: hueOf(w.lo) }));
  const H = (arr: string[]) => {
    const c = new Map<string, number>();
    for (const w of arr) c.set(w, (c.get(w) ?? 0) + 1);
    let h = 0;
    for (const v of c.values()) {
      const p = v / arr.length;
      h -= p * Math.log2(p);
    }
    return h;
  };
  const entropyBits = r4(H(words));
  const entropyTrend: { index: number; bits: number }[] = [];
  const win = 200;
  for (let i = win; i <= words.length; i += Math.max(1, Math.floor(words.length / 60))) entropyTrend.push({ index: i, bits: r4(H(words.slice(i - win, i))) });
  // stream
  const tail = rounds.slice(-depth);
  const stream = tail.map((r, idx) => {
    const gi = rounds.length - tail.length + idx;
    const prev = rounds[gi - 1];
    const d = prev ? r.tsMs - prev.tsMs : 0;
    const exp = cadence && prev ? stepMs(cadence, prev.multiplier) : 15_000;
    const tempo: "quick" | "steady" | "slow" | "gap" = !prev ? "steady" : d > 180_000 ? "gap" : d > exp * 1.6 ? "slow" : d < exp * 0.7 ? "quick" : "steady";
    return { id: r.id, word: words[gi], hue: hueOf(r.multiplier), multiplier: r.multiplier, ts: r.ts, tempo, origin: (r as Round & { origin?: string }).origin };
  });
  // sentences: close at every pink (≥10x)
  const sentences: { words: string[]; closer: string; closedAt: string }[] = [];
  let cur: string[] = [];
  for (let i = 0; i < rounds.length; i++) {
    cur.push(words[i]);
    if (rounds[i].multiplier >= 10) {
      sentences.push({ words: cur, closer: words[i], closedAt: rounds[i].ts });
      cur = [];
    }
  }
  const pPink = rounds.filter((r) => r.multiplier >= 10).length / n;
  const lens = sentences.map((s) => s.words.length);
  const bucket = (L: number) => (L <= 5 ? "1–5" : L <= 10 ? "6–10" : L <= 20 ? "11–20" : L <= 40 ? "21–40" : L <= 80 ? "41–80" : "81+");
  const edges: [string, number, number][] = [["1–5", 1, 5], ["6–10", 6, 10], ["11–20", 11, 20], ["21–40", 21, 40], ["41–80", 41, 80], ["81+", 81, 100000]];
  const geomMass = (a: number, b: number) => (pPink > 0 ? Math.pow(1 - pPink, a - 1) - Math.pow(1 - pPink, b) : 0);
  const lengthHistogram = edges.map(([label, a, b]) => ({ length: label, count: lens.filter((L) => bucket(L) === label).length, expected: r2(sentences.length * geomMass(a, b)) }));
  // phrases (2–4 grams) with independence expectation
  const share = (w: string) => (counts.get(w) ?? 0) / n;
  const phraseRows: { phrase: string; n: number; count: number; expected: number; lift: number; z: number }[] = [];
  for (let g = 2; g <= 4; g++) {
    const c = new Map<string, number>();
    for (let i = g; i <= words.length; i++) {
      const p = words.slice(i - g, i).join(" ");
      c.set(p, (c.get(p) ?? 0) + 1);
    }
    const positions = Math.max(1, words.length - g + 1);
    for (const [p, cnt] of c) {
      const pExp = p.split(" ").reduce((acc, w) => acc * share(w), 1);
      const expected = positions * pExp;
      if (expected < 3 && cnt < 5) continue;
      const z = expected > 0 ? (cnt - expected) / Math.sqrt(expected * (1 - pExp)) : 0;
      phraseRows.push({ phrase: p, n: g, count: cnt, expected: r2(expected), lift: r2(expected ? cnt / expected : 0), z: r2(z) });
    }
  }
  const phrases = [...phraseRows].sort((a, b) => b.z - a.z).slice(0, 30);
  const underPhrases = [...phraseRows].sort((a, b) => a.z - b.z).slice(0, 12);
  // next-word back-off model (order 3 → 1)
  let nextWord: LinguisticsV2["nextWord"] = { context: "", order: 0, support: 0, dist: [], pLift2x: 0, base2x: 0 };
  const base2x = rounds.filter((r) => r.multiplier >= 2).length / n;
  for (let order = 3; order >= 1; order--) {
    if (words.length <= order) continue;
    const ctx = words.slice(-order).join(" ");
    const follow = new Map<string, number>();
    let support = 0;
    let ge2 = 0;
    for (let i = order; i < words.length; i++) {
      if (words.slice(i - order, i).join(" ") !== ctx) continue;
      support++;
      follow.set(words[i], (follow.get(words[i]) ?? 0) + 1);
      if (rounds[i].multiplier >= 2) ge2++;
    }
    if (support >= 30 || order === 1) {
      nextWord = {
        context: ctx,
        order,
        support,
        dist: WORDS.map((w) => ({ word: w.word, p: r4((follow.get(w.word) ?? 0) / Math.max(1, support)), base: r4(share(w.word)) })),
        pLift2x: r4(support ? ge2 / support : 0),
        base2x: r4(base2x),
      };
      break;
    }
  }
  const curWords = cur;
  const narrative =
    `The market has spoken ${curWords.length} word${curWords.length === 1 ? "" : "s"} since the last surge` +
    (curWords.length ? ` (“…${curWords.slice(-8).join(" ")}”)` : "") +
    `. A sentence ends at a pink round; with P(≥10x) = ${(pPink * 100).toFixed(1)}% the expected sentence length is ${pPink ? (1 / pPink).toFixed(1) : "—"} words. ` +
    `Vocabulary entropy is ${entropyBits.toFixed(2)} of ${Math.log2(WORDS.length).toFixed(2)} bits — ` +
    `after “${nextWord.context}”, P(next ≥2x) = ${(nextWord.pLift2x * 100).toFixed(1)}% vs ${(base2x * 100).toFixed(1)}% overall (n=${nextWord.support}).`;
  return {
    analysed: rounds.length,
    lexicon,
    entropyBits,
    maxEntropyBits: r4(Math.log2(WORDS.length)),
    entropyTrend,
    typeTokenRatio: r4(counts.size / n),
    stream,
    sentences: {
      count: sentences.length,
      meanLength: r2(lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0),
      expectedLength: r2(pPink ? 1 / pPink : 0),
      current: { words: curWords.slice(-60), length: curWords.length },
      recent: sentences.slice(-12).reverse().map((s) => ({ words: s.words.slice(-24), length: s.words.length, closer: s.closer, closedAt: s.closedAt })),
      lengthHistogram,
    },
    phrases,
    underPhrases,
    nextWord,
    narrative,
  };
}

/** Vocabulary discovery v2: significant phrases become candidate tokens, each auto-evaluated on the next-round ≥2x rate. */
export function discoverPhrases(rounds: Round[], minCount = 25): { token: string; layer: string; layers: string[]; definition: string; uses: number; hits: number; misses: number; score: number; lift: number; z: number }[] {
  const words = rounds.map((r) => wordOf(r.multiplier));
  const n = words.length || 1;
  const base = rounds.filter((r) => r.multiplier >= 2).length / n;
  const out: ReturnType<typeof discoverPhrases> = [];
  for (let g = 1; g <= 4; g++) {
    const stats = new Map<string, [number, number]>();
    for (let i = g; i < words.length; i++) {
      const p = words.slice(i - g, i).join(" ");
      const s = stats.get(p) ?? [0, 0];
      s[0]++;
      if (rounds[i].multiplier >= 2) s[1]++;
      stats.set(p, s);
    }
    for (const [p, [uses, hits]] of stats) {
      if (uses < minCount) continue;
      const z = zScore(hits, uses, base);
      const rate = hits / uses;
      out.push({
        token: p.replace(/ /g, "·"),
        layer: g === 1 ? "word" : `phrase-${g}`,
        layers: p.split(" "),
        definition: `After “${p}”, next round ≥2x ${(rate * 100).toFixed(1)}% vs ${(base * 100).toFixed(1)}% base (n=${uses}, z=${z.toFixed(2)}).`,
        uses,
        hits,
        misses: uses - hits,
        score: r4(rate),
        lift: r4(base ? rate / base : 0),
        z: r2(z),
      });
    }
  }
  return out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 80);
}

// ----------------------------------------------------------- investigation

export interface CalibRow {
  state: string;
  expected: number;
  range_lo: number;
  range_hi: number;
  confidence: number | null;
  verdict: string;
  reason: string;
  comp_loss?: string | null;
  weights?: string | null;
}

export function investigateRound(all: Round[], idx: number, calib: CalibRow | null, cadence: Cadence, radius = 30) {
  const r = all[idx] as Round & { origin?: string };
  const n = all.length;
  const sorted = all.map((x) => x.multiplier).sort((a, b) => a - b);
  let below = 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < r.multiplier) lo = mid + 1;
    else hi = mid;
  }
  below = lo;
  const exceed = (n - below) / n;
  const sinceLast = (x: number) => {
    for (let j = idx - 1; j >= 0; j--) if (all[j].multiplier >= x) return idx - j;
    return null;
  };
  const baseRate = (x: number) => all.filter((y) => y.multiplier >= x).length / n;
  const counters = [2, 5, 10, 50, 100].map((x) => {
    const since = sinceLast(x);
    const p = baseRate(x);
    return { threshold: x, roundsSince: since, expectedGap: p ? r2(1 / p) : null, pressure: since !== null && p ? r2(since * p) : null };
  });
  let dry = 0;
  for (let j = idx - 1; j >= 0 && all[j].multiplier < 2; j--) dry++;
  const prev = all[idx - 1];
  const deltaMs = prev ? r.tsMs - prev.tsMs : null;
  const expectedMs = prev ? Math.round(stepMs(cadence, prev.multiplier)) : null;
  const sess = all.filter((x) => r.sessionId !== null && x.sessionId === r.sessionId);
  const posInSession = sess.findIndex((x) => x.id === r.id);
  // DNA context: the band 6-mer that preceded this round and its history
  const sym = encode(all, "band");
  const k = 6;
  const pattern = idx >= k ? sym.slice(idx - k, idx).join("") : "";
  let pn = 0;
  let pHit = 0;
  const base2 = baseRate(2);
  if (pattern) {
    for (let i = k; i < n; i++) {
      if (i === idx) continue;
      if (sym.slice(i - k, i).join("") === pattern) {
        pn++;
        if (all[i].multiplier >= 2) pHit++;
      }
    }
  }
  // nearest analogues on the preceding 12 rounds (log-distance)
  const W = 12;
  const analogues: { index: number; id: number; ts: string; distance: number; next: number }[] = [];
  if (idx >= W) {
    const q = all.slice(idx - W, idx).map((x) => Math.min(ln(x.multiplier), 5));
    for (let s = W; s < n; s++) {
      if (Math.abs(s - idx) < W) continue;
      let d = 0;
      for (let j = 0; j < W; j++) d += (Math.min(ln(all[s - W + j].multiplier), 5) - q[j]) ** 2;
      analogues.push({ index: s, id: all[s].id, ts: all[s].ts, distance: r4(Math.sqrt(d / W)), next: all[s].multiplier });
    }
    analogues.sort((a, b) => a.distance - b.distance);
    analogues.splice(12);
  }
  const words = all.slice(Math.max(0, idx - 20), idx + 1).map((x) => wordOf(x.multiplier));
  const context = all.slice(Math.max(0, idx - radius), Math.min(n, idx + radius + 1)).map((x) => ({ id: x.id, ts: x.ts, multiplier: x.multiplier, hue: hueOf(x.multiplier), focus: x.id === r.id, origin: (x as Round & { origin?: string }).origin ?? "observed" }));
  let parsedLoss: Record<string, number> | null = null;
  let parsedWeights: Record<string, number> | null = null;
  try {
    parsedLoss = calib?.comp_loss ? JSON.parse(calib.comp_loss) : null;
    parsedWeights = calib?.weights ? JSON.parse(calib.weights) : null;
  } catch {
    /* ignore */
  }
  return {
    round: { id: r.id, ts: r.ts, multiplier: r.multiplier, source: r.source, sessionId: r.sessionId, hue: hueOf(r.multiplier), word: wordOf(r.multiplier), origin: r.origin ?? "observed" },
    rarity: { percentile: r4(below / n), exceedance: r4(exceed), oneIn: exceed > 0 ? r2(1 / exceed) : null, rankFromTop: n - below },
    timing: { deltaMs, expectedMs, verdict: deltaMs === null ? "first round" : deltaMs > 180_000 ? "after a session gap" : expectedMs && deltaMs > expectedMs * 1.6 ? "slower than cadence" : expectedMs && deltaMs < expectedMs * 0.7 ? "faster than cadence" : "on cadence" },
    counters,
    dryRunBefore: dry,
    session: r.sessionId ? { id: r.sessionId, rounds: sess.length, position: posInSession + 1, max: r2(Math.max(...sess.map((x) => x.multiplier))) } : null,
    dna: { pattern, occurrences: pn, rateGe2: pn ? r4(pHit / pn) : null, base2: r4(base2) },
    sentence: words.join(" "),
    forecast: calib
      ? { state: calib.state, expected: calib.expected, rangeLo: calib.range_lo, rangeHi: calib.range_hi, confidence: calib.confidence, verdict: calib.verdict, reason: calib.reason, engineLoss: parsedLoss, weights: parsedWeights }
      : null,
    analogues: analogues.map((a) => ({ ...a, next: r2(a.next) })),
    analogueNextGe2: analogues.length ? r4(analogues.filter((a) => a.next >= 2).length / analogues.length) : null,
    context,
  };
}

export function investigateRange(all: Round[], slice: Round[]) {
  const stat = (rs: Round[]) => {
    const m = rs.map((x) => x.multiplier).sort((a, b) => a - b);
    const n = m.length || 1;
    return {
      count: rs.length,
      mean: r2(m.reduce((a, b) => a + Math.min(b, 1000), 0) / n),
      median: r2(quant(m, 0.5)),
      max: r2(m[m.length - 1] ?? 0),
      ge2: r4(m.filter((x) => x >= 2).length / n),
      ge10: r4(m.filter((x) => x >= 10).length / n),
      ge100: r4(m.filter((x) => x >= 100).length / n),
      lt12: r4(m.filter((x) => x < 1.2).length / n),
    };
  };
  const a = stat(slice);
  const b = stat(all);
  // two-sample KS on log-multipliers
  const xa = slice.map((x) => ln(x.multiplier)).sort((p, q) => p - q);
  const xb = all.map((x) => ln(x.multiplier)).sort((p, q) => p - q);
  let i = 0;
  let j = 0;
  let D = 0;
  while (i < xa.length && j < xb.length) {
    if (xa[i] <= xb[j]) i++;
    else j++;
    D = Math.max(D, Math.abs(i / xa.length - j / xb.length));
  }
  const ne = (xa.length * xb.length) / Math.max(1, xa.length + xb.length);
  const lambda = (Math.sqrt(ne) + 0.12 + 0.11 / Math.max(1e-9, Math.sqrt(ne))) * D;
  let p = 0;
  for (let k = 1; k < 100; k++) p += 2 * Math.pow(-1, k - 1) * Math.exp(-2 * k * k * lambda * lambda);
  p = Math.min(1, Math.max(0, p));
  const z2 = a.count ? zScore(Math.round(a.ge2 * a.count), a.count, b.ge2) : 0;
  const z10 = a.count ? zScore(Math.round(a.ge10 * a.count), a.count, b.ge10) : 0;
  return {
    slice: a,
    overall: b,
    ks: { D: r4(D), pValue: r4(p) },
    z: { ge2: r2(z2), ge10: r2(z10) },
    verdict: p < 0.01 ? "This range's distribution differs from the full history (KS p<0.01) — check for data issues or a regime change." : "This range is statistically indistinguishable from the full history.",
    hues: { blue: slice.filter((x) => x.multiplier < 2).length, purple: slice.filter((x) => x.multiplier >= 2 && x.multiplier < 10).length, pink: slice.filter((x) => x.multiplier >= 10).length },
  };
}

// ------------------------------------------------------- shape projection

export interface ProjectedShape {
  name: string;
  family: string;
  description: string;
  window: number;
  horizon: number;
  analogues: number;
  currentShape: { name: string; path: number[] };
  path: { step: number; p25: number; p50: number; p75: number }[];
  baselinePath: number[];
  rounds: { step: number; etaMs: number; eta: string; p25: number; p50: number; p75: number; pGe2: number; pGe10: number; hue: Hue }[];
  etas: { threshold: number; expectedRounds: number | null; baselineRounds: number; meanWait: number; etaMs: number | null; eta: string | null; pWithinHorizon: number; baselineWithinHorizon: number }[];
  anchorTsMs: number;
  anchorRoundId: number;
  drift: number;
  confidence: number;
  honesty: string;
}

/** Name a (cumulative log-excess) path by slope, curvature and chop. */
export function nameShape(path: number[]): { name: string; family: string; description: string } {
  const n = path.length;
  if (n < 3) return { name: "Point", family: "flat", description: "Too short to shape." };
  const end = path[n - 1] - path[0];
  const mid = path[Math.floor(n / 2)] - path[0];
  const firstHalf = mid;
  const secondHalf = end - mid;
  let chop = 0;
  for (let i = 2; i < n; i++) if (Math.sign(path[i] - path[i - 1]) !== Math.sign(path[i - 1] - path[i - 2])) chop++;
  const chopRate = chop / (n - 2);
  const maxUp = Math.max(...path.map((v) => v - path[0]));
  const minDn = Math.min(...path.map((v) => v - path[0]));
  const scale = Math.max(0.35, Math.abs(maxUp) + Math.abs(minDn)) / 2;
  const s = end / scale;
  if (maxUp > 3 * Math.max(0.5, Math.abs(end)) && maxUp > 1.2) return { name: "Spike & Fade", family: "spike", description: "A single tall round lifts the path, then ordinary rounds bleed it back." };
  if (firstHalf < -0.25 * scale && secondHalf > 0.35 * scale) return { name: "V-Rebound", family: "rebound", description: "A dry dip followed by recovering rounds." };
  if (firstHalf > 0.35 * scale && secondHalf < -0.25 * scale) return { name: "Arch", family: "arch", description: "Early strength that rolls over into a dry finish." };
  if (s > 0.9) return { name: chopRate > 0.55 ? "Choppy Ascent" : "Rising Staircase", family: "rise", description: "Rounds clear the average more often than not — the path steps up." };
  if (s < -0.9) return { name: chopRate > 0.55 ? "Choppy Slide" : "Sliding Ramp", family: "slide", description: "A dry spell — rounds keep landing below the average." };
  if (chopRate > 0.6) return { name: "Sawtooth Range", family: "range", description: "Alternating lifts and drops inside a band." };
  return { name: "Flat Coil", family: "flat", description: "Sideways drift with no dominant direction." };
}

const fmtClock = (ms: number, tzOffsetMin = 120) => new Date(ms + tzOffsetMin * 60_000).toISOString().slice(11, 19);

/**
 * Analogue-ensemble shape projection.
 * The last `window` rounds become a drawable path — cumulative log-multiplier
 * excess over the long-run mean. The K most similar historical windows (by
 * standardised path distance) vote on the continuation; the median / IQR of
 * their continuations is the projected shape. Each projected step is then
 * "decomputed" back into a round: its multiplier quantiles, P(≥2x), P(≥10x)
 * and an ETA from the cadence model.
 */
export function projectShape(rounds: Round[], opts: { window: number; horizon: number; k: number; cadence: Cadence; tzOffsetMin?: number; scanLimit?: number }): ProjectedShape | null {
  const W = opts.window;
  const H = opts.horizon;
  const n = rounds.length;
  if (n < W + H + 200) return null;
  const x = rounds.map((r) => Math.min(ln(r.multiplier), Math.log(1000)));
  const mu = x.reduce((a, b) => a + b, 0) / n;
  const pathOf = (end: number, len: number) => {
    const out: number[] = [0];
    let s = 0;
    for (let i = end - len; i < end; i++) {
      s += x[i] - mu;
      out.push(s);
    }
    return out;
  };
  const cur = pathOf(n, W);
  const std = (p: number[]) => {
    const m = p.reduce((a, b) => a + b, 0) / p.length;
    const sd = Math.sqrt(p.reduce((a, b) => a + (b - m) ** 2, 0) / p.length) || 1;
    return p.map((v) => (v - m) / sd);
  };
  const cz = std(cur);
  const lo = Math.max(W, n - (opts.scanLimit ?? 60_000));
  const cands: { end: number; d: number }[] = [];
  for (let e = lo; e <= n - H - 1; e++) {
    const p = pathOf(e, W);
    const pz = std(p);
    let d = 0;
    for (let j = 0; j < pz.length; j++) d += (pz[j] - cz[j]) ** 2;
    // include level agreement so a flat window doesn't match a spike window
    d += 0.5 * (p[p.length - 1] - cur[cur.length - 1]) ** 2;
    cands.push({ end: e, d });
  }
  cands.sort((a, b) => a.d - b.d);
  const K = Math.min(opts.k, cands.length);
  const chosen = cands.slice(0, K);
  const cont: number[][] = chosen.map(({ end }) => {
    const out: number[] = [];
    let s = 0;
    for (let h = 0; h < H; h++) {
      s += x[end + h] - mu;
      out.push(s);
    }
    return out;
  });
  const lastLevel = cur[cur.length - 1];
  const path = Array.from({ length: H }, (_, h) => {
    const col = cont.map((c) => c[h]).sort((a, b) => a - b);
    return { step: h + 1, p25: r4(lastLevel + quant(col, 0.25)), p50: r4(lastLevel + quant(col, 0.5)), p75: r4(lastLevel + quant(col, 0.75)) };
  });
  const baselinePath = Array.from({ length: H }, () => r4(lastLevel));
  const cadence = opts.cadence;
  const lastR = rounds[n - 1];
  const tz = opts.tzOffsetMin ?? 120;
  let t = lastR.tsMs;
  let prevM = lastR.multiplier;
  const decomputed = Array.from({ length: H }, (_, h) => {
    const col = chosen.map(({ end }) => rounds[end + h].multiplier).sort((a, b) => a - b);
    const p50 = quant(col, 0.5);
    t += stepMs(cadence, prevM);
    prevM = p50;
    return {
      step: h + 1,
      etaMs: Math.round(t),
      eta: fmtClock(t, tz),
      p25: r2(quant(col, 0.25)),
      p50: r2(p50),
      p75: r2(quant(col, 0.75)),
      pGe2: r4(col.filter((v) => v >= 2).length / col.length),
      pGe10: r4(col.filter((v) => v >= 10).length / col.length),
      hue: hueOf(p50),
    };
  });
  const etas = [2, 10, 100].map((th) => {
    const p = rounds.filter((r) => r.multiplier >= th).length / n;
    const firsts = chosen.map(({ end }) => {
      for (let h = 0; h < H; h++) if (rounds[end + h].multiplier >= th) return h + 1;
      return null;
    });
    const within = firsts.filter((f) => f !== null) as number[];
    const pWithin = within.length / Math.max(1, chosen.length);
    const baseWithin = 1 - Math.pow(1 - p, H);
    // like-for-like medians: analogue first-hit median (misses count as > horizon) vs geometric median
    const ranked = firsts.map((f) => (f === null ? Infinity : f)).sort((a, b) => a - b);
    const m50 = ranked.length ? ranked[Math.floor((ranked.length - 1) / 2)] : Infinity;
    const med = Number.isFinite(m50) ? m50 : null;
    let etaMs: number | null = null;
    if (med !== null) etaMs = decomputed[Math.min(H - 1, Math.max(0, Math.round(med) - 1))].etaMs;
    return { threshold: th, expectedRounds: med, baselineRounds: p > 0 && p < 1 ? Math.max(1, Math.ceil(Math.log(0.5) / Math.log(1 - p))) : 0, meanWait: p ? r2(1 / p) : 0, etaMs, eta: etaMs ? fmtClock(etaMs, tz) : null, pWithinHorizon: r4(pWithin), baselineWithinHorizon: r4(baseWithin) };
  });
  const named = nameShape([lastLevel, ...path.map((p) => p.p50)]);
  const spread = path.length ? path[path.length - 1].p75 - path[path.length - 1].p25 : 1;
  const drift = path.length ? path[path.length - 1].p50 - lastLevel : 0;
  const confidence = r4(Math.max(0, Math.min(1, Math.abs(drift) / Math.max(0.5, spread))));
  return {
    ...named,
    window: W,
    horizon: H,
    analogues: K,
    currentShape: { ...nameShape(cur), path: cur.map(r4) },
    path,
    baselinePath,
    rounds: decomputed,
    etas,
    anchorTsMs: lastR.tsMs,
    anchorRoundId: lastR.id,
    drift: r4(drift),
    confidence,
    honesty:
      "Shape projections are analogue look-ups. Their skill is tracked against the flat (no-drift) path in the Chart-prediction ledger; on a fair RNG expect that skill to hover near zero.",
  };
}

/** Score a stored projection once its horizon has landed: MAE of the median path vs the flat baseline path. */
export function scoreProjection(stored: { path: { p50: number; p25: number; p75: number }[]; baselinePath: number[] }, realised: Round[], mu: number, startLevel: number) {
  const H = Math.min(stored.path.length, realised.length);
  if (!H) return null;
  let s = startLevel;
  let maeModel = 0;
  let maeBase = 0;
  let inside = 0;
  const actual: number[] = [];
  for (let h = 0; h < H; h++) {
    s += Math.min(ln(realised[h].multiplier), Math.log(1000)) - mu;
    actual.push(r4(s));
    maeModel += Math.abs(stored.path[h].p50 - s);
    maeBase += Math.abs(stored.baselinePath[h] - s);
    if (s >= stored.path[h].p25 && s <= stored.path[h].p75) inside++;
  }
  maeModel /= H;
  maeBase /= H;
  return { actual, maeModel: r4(maeModel), maeBase: r4(maeBase), skill: r4(maeBase ? 1 - maeModel / maeBase : 0), iqrCoverage: r4(inside / H) };
}
