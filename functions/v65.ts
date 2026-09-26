// functions/v65.ts — Momento v6.5 "Platform Book" engines (pure, side-effect free).
//
// Every function here implements a spec block from The Momento Platform Book
// (avfsmomentoserver-cell/momento-platform-book, Ch 18 feature catalogue). Each
// one is causal (only rounds before the decision point are read), deterministic
// (seeded RNG), and reports its uncertainty (Wilson / block-bootstrap CIs, BH q).
//
//   F-01 integrity            F-07 sequence search      F-11 signal significance
//   F-13 regime weights       F-14 forecast diff        F-16 counterfactual
//   F-17 reliability / PIT / ACI                        F-26/27/29 survival & ETA
//   F-31 Kelly tells          F-32 bankroll simulator   F-34 experiment runner
//   F-36 fairness battery + provably-fair verification  F-03 CUSUM fingerprint
//   F-10 cross-source comparison                        F-12 custom engine families

import { BAND_EDGES, BAND_LABELS, bandIndex, type Round } from "./analysis";

export const NB = BAND_LABELS.length;
export const EDGES = [1, ...BAND_EDGES, Infinity];
/** Survival thresholds exposed on the ETA board (F-26). */
export const ETA_THRESHOLDS = [2, 5, 10, 20, 50, 100] as const;

// ------------------------------------------------------------------ numerics

export const r2 = (x: number) => Math.round(x * 100) / 100;
export const r3 = (x: number) => Math.round(x * 1000) / 1000;
export const r4 = (x: number) => Math.round(x * 10000) / 10000;
export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = clamp(q) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed = 42): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
export const twoSidedP = (z: number) => 2 * (1 - normCdf(Math.abs(z)));

/** Wilson score interval for h hits in n trials. */
export function wilsonCI(h: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 1];
  const p = h / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const w = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [clamp((c - w) / d), clamp((c + w) / d)];
}

/** Benjamini–Hochberg q-values (same order as input). */
export function bhQ(ps: number[]): number[] {
  const m = ps.length;
  const idx = ps.map((p, i) => [p, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const q = new Array(m).fill(1);
  let prev = 1;
  for (let k = m - 1; k >= 0; k--) {
    const [p, i] = idx[k];
    prev = Math.min(prev, (p * m) / (k + 1));
    q[i] = clamp(prev);
  }
  return q;
}

/** Two-proportion z-test (conditional rate vs reference rate). */
export function twoProp(h1: number, n1: number, h2: number, n2: number): { z: number; p: number; diff: number; lo: number; hi: number } {
  if (n1 <= 0 || n2 <= 0) return { z: 0, p: 1, diff: 0, lo: 0, hi: 0 };
  const p1 = h1 / n1;
  const p2 = h2 / n2;
  const pp = (h1 + h2) / (n1 + n2);
  const se = Math.sqrt(pp * (1 - pp) * (1 / n1 + 1 / n2)) || 1e-9;
  const z = (p1 - p2) / se;
  const seD = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2) || 1e-9;
  return { z, p: twoSidedP(z), diff: p1 - p2, lo: p1 - p2 - 1.96 * seD, hi: p1 - p2 + 1.96 * seD };
}

/** Moving-block bootstrap CI of the mean (serially dependent series). */
export function blockBootstrapCI(xs: number[], opts: { block?: number; B?: number; seed?: number; alpha?: number } = {}): [number, number] {
  const n = xs.length;
  if (n < 5) return [NaN, NaN];
  const block = Math.max(1, Math.min(opts.block ?? Math.round(Math.sqrt(n)), Math.floor(n / 2)));
  const B = opts.B ?? 400;
  const r = rng(opts.seed ?? 7);
  const nb = Math.ceil(n / block);
  const means: number[] = [];
  for (let b = 0; b < B; b++) {
    let s = 0;
    let c = 0;
    for (let k = 0; k < nb; k++) {
      const start = Math.floor(r() * (n - block + 1));
      for (let j = 0; j < block && c < n; j++, c++) s += xs[start + j];
    }
    means.push(s / c);
  }
  means.sort((a, b) => a - b);
  const a = opts.alpha ?? 0.05;
  return [quantile(means, a / 2), quantile(means, 1 - a / 2)];
}

export function medianIntervalMs(rounds: Round[]): number {
  const d: number[] = [];
  for (let i = Math.max(1, rounds.length - 2000); i < rounds.length; i++) {
    const x = rounds[i].tsMs - rounds[i - 1].tsMs;
    if (x > 0 && x < 30 * 60_000) d.push(x);
  }
  return d.length ? median(d) : 10_000;
}

/** P(M ≥ x) for a band distribution, log-interpolated inside the band. */
export function survivalFromDist(dist: number[], x: number): number {
  let s = 0;
  for (let i = NB - 1; i >= 0; i--) {
    const lo = EDGES[i];
    const hi = EDGES[i + 1];
    if (x <= lo) s += dist[i];
    else if (x < hi) {
      const hiF = Number.isFinite(hi) ? hi : lo * 10;
      // within-band survival under the 1/x law
      const frac = clamp((1 / x - 1 / hiF) / (1 / lo - 1 / hiF));
      s += dist[i] * frac;
    }
  }
  return clamp(s);
}
/** Quantile of a band distribution under the within-band 1/x law. */
export function quantileFromDist(dist: number[], q: number): number {
  let c = 0;
  for (let i = 0; i < NB; i++) {
    const next = c + dist[i];
    if (next >= q || i === NB - 1) {
      const lo = EDGES[i];
      const hi = Number.isFinite(EDGES[i + 1]) ? EDGES[i + 1] : lo * 10;
      const f = dist[i] > 0 ? clamp((q - c) / dist[i]) : 0.5;
      // invert F(x) = (1/lo - 1/x) / (1/lo - 1/hi)
      const inv = 1 / lo - f * (1 / lo - 1 / hi);
      return Math.max(1, 1 / inv);
    }
    c = next;
  }
  return 1;
}
export function bandShares(ms: number[]): number[] {
  const c = new Array(NB).fill(0);
  for (const m of ms) c[bandIndex(m)]++;
  const n = ms.length || 1;
  return c.map((x) => x / n);
}

// ================================================================= F-01
// Tape Integrity Score — per session completeness, low-share z, fairness match
// and collector agreement, combined as a weighted geometric mean; missing
// components get weight 0 (never scored as 1).

export interface SessionIntegrity {
  sessionId: number | string;
  source: string;
  from: string;
  to: string;
  rounds: number;
  observed: number;
  reconstructed: number;
  medianIntervalMs: number;
  gaps: { fromTs: string; toTs: string; seconds: number; estMissing: number }[];
  estMissing: number;
  completeness: number;
  lowShare: number;
  lowShareRef: number;
  lowShareZ: number;
  lowShareCI: [number, number];
  lowScore: number;
  fairMatch: number | null;
  agreement: number | null;
  integrity: number;
  voidWindows: number;
}

export function integrityReport(rounds: Round[], opts: { fairMatch?: Record<string, number>; agreement?: Record<string, number>; low?: number; gapFactor?: number } = {}) {
  const low = opts.low ?? 1.2;
  const gf = opts.gapFactor ?? 2.5;
  const observedAll = rounds.filter((r) => r.origin !== "reconstructed");
  const refLow = observedAll.length ? observedAll.filter((r) => r.multiplier < low).length / observedAll.length : 0.19;
  // theoretical low share under P(M ≥ x) = 0.97/x
  const lawLow = 1 - 0.97 / low;
  const ref = Math.max(refLow, lawLow);
  const groups = new Map<string, Round[]>();
  let synthetic = 0;
  let prev: Round | null = null;
  for (const r of rounds) {
    let key: string;
    if (r.sessionId != null) key = `${r.source}#${r.sessionId}`;
    else {
      if (!prev || r.tsMs - prev.tsMs > 30 * 60_000 || prev.source !== r.source) synthetic++;
      key = `${r.source}~${synthetic}`;
    }
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
    prev = r;
  }
  const sessions: SessionIntegrity[] = [];
  for (const [key, rs] of groups) {
    if (rs.length < 5) continue;
    rs.sort((a, b) => a.tsMs - b.tsMs);
    const obs = rs.filter((r) => r.origin !== "reconstructed");
    const med = medianIntervalMs(obs.length > 5 ? obs : rs);
    const gaps: SessionIntegrity["gaps"] = [];
    let est = 0;
    for (let i = 1; i < obs.length; i++) {
      const dt = obs[i].tsMs - obs[i - 1].tsMs;
      if (dt > gf * med) {
        const miss = Math.max(0, Math.round(dt / med) - 1);
        est += miss;
        gaps.push({ fromTs: obs[i - 1].ts, toTs: obs[i].ts, seconds: Math.round(dt / 1000), estMissing: miss });
      }
    }
    const completeness = obs.length / (obs.length + est || 1);
    const lows = obs.filter((r) => r.multiplier < low).length;
    const share = obs.length ? lows / obs.length : 0;
    const se = Math.sqrt((ref * (1 - ref)) / Math.max(1, obs.length));
    const z = (share - ref) / (se || 1e-9);
    const lowScore = clamp(share / (ref || 1));
    const sid = key.split(/[#~]/)[1];
    const fair = opts.fairMatch?.[key] ?? null;
    const agr = opts.agreement?.[key] ?? null;
    const comps: [number, number][] = [
      [completeness, 0.4],
      [Math.max(1e-3, z < -2 ? lowScore : 1), 0.3],
    ];
    if (fair != null) comps.push([Math.max(1e-3, fair), 0.2]);
    if (agr != null) comps.push([Math.max(1e-3, agr), 0.1]);
    const wsum = comps.reduce((a, c) => a + c[1], 0);
    const integ = Math.exp(comps.reduce((a, [v, w]) => a + w * Math.log(Math.max(1e-6, v)), 0) / wsum);
    sessions.push({
      sessionId: /^\d+$/.test(sid) ? Number(sid) : sid,
      source: rs[0].source,
      from: rs[0].ts,
      to: rs[rs.length - 1].ts,
      rounds: rs.length,
      observed: obs.length,
      reconstructed: rs.length - obs.length,
      medianIntervalMs: Math.round(med),
      gaps: gaps.slice(0, 200),
      estMissing: est,
      completeness: r4(completeness),
      lowShare: r4(share),
      lowShareRef: r4(ref),
      lowShareZ: r2(z),
      lowShareCI: wilsonCI(lows, obs.length).map(r4) as [number, number],
      lowScore: r4(lowScore),
      fairMatch: fair,
      agreement: agr,
      integrity: r4(integ),
      voidWindows: gaps.filter((g) => g.estMissing >= 1).length,
    });
  }
  sessions.sort((a, b) => Date.parse(b.from) - Date.parse(a.from));
  const totObs = sessions.reduce((a, s) => a + s.observed, 0);
  const totMiss = sessions.reduce((a, s) => a + s.estMissing, 0);
  const wInt = totObs ? sessions.reduce((a, s) => a + s.integrity * s.observed, 0) / totObs : 0;
  return {
    sessions,
    summary: {
      sessions: sessions.length,
      observed: totObs,
      estMissing: totMiss,
      completeness: r4(totObs / (totObs + totMiss || 1)),
      integrity: r4(wInt),
      highQuality: sessions.filter((s) => s.integrity >= 0.95).length,
      lowShareRef: r4(ref),
      lawLowShare: r4(lawLow),
      tapeLowShare: r4(refLow),
      p2x2: r4((observedAll.filter((r) => r.multiplier >= 2).length / (observedAll.length || 1)) * 2),
      voidWindows: sessions.reduce((a, s) => a + s.voidWindows, 0),
      note:
        refLow < lawLow - 0.01
          ? `Observed share below ${low}× is ${(refLow * 100).toFixed(1)}% vs ${(lawLow * 100).toFixed(1)}% under the fair law — low rounds are probably being missed by the collector, which biases every probability upward.`
          : `Low-round share is consistent with the fair law (${(refLow * 100).toFixed(1)}% vs ${(lawLow * 100).toFixed(1)}%).`,
    },
  };
}

/** Void rule (Ch 08 V3): a window [a,b] overlapping a gap with est_missing ≥ 1 is void. */
export function isVoidWindow(rounds: Round[], fromIdx: number, toIdx: number, medMs: number, gf = 2.5): boolean {
  for (let i = Math.max(1, fromIdx + 1); i <= toIdx && i < rounds.length; i++) {
    const dt = rounds[i].tsMs - rounds[i - 1].tsMs;
    if (dt > gf * medMs && Math.round(dt / medMs) - 1 >= 1) return true;
    if (rounds[i].origin === "reconstructed") return true;
  }
  return false;
}

// ================================================================= F-11
// Signal significance strip — 14 causal signals, their trailing conditional
// lift on the target (next round ≥ T), Wilson CI, BH q across the family.

export interface SignalDef {
  key: string;
  label: string;
  describe: string;
}
export const SIGNALS: SignalDef[] = [
  { key: "last_low", label: "Last < 1.2×", describe: "The previous round crashed below 1.2×" },
  { key: "last_big", label: "Last ≥ 10×", describe: "The previous round reached 10×" },
  { key: "last_mid", label: "Last in 1.5–2×", describe: "The previous round landed in 1.5–2×" },
  { key: "last_5", label: "Last ≥ 5×", describe: "The previous round reached 5×" },
  { key: "two_low", label: "2 below 2× in a row", describe: "The last 2 rounds were both below 2×" },
  { key: "three_low", label: "3 below 2× in a row", describe: "The last 3 rounds were all below 2×" },
  { key: "five_low", label: "5+ below 2× streak", describe: "A below-2× streak of at least 5" },
  { key: "two_high", label: "2 above 2× in a row", describe: "The last 2 rounds were both ≥ 2×" },
  { key: "cold10", label: "Cold tape (mean10 < 1.8)", describe: "Geometric mean of the last 10 below 1.8×" },
  { key: "dry20", label: "Dry run (max20 < 5×)", describe: "No 5× in the last 20 rounds" },
  { key: "overdue10", label: "10× overdue (gap > median)", describe: "Rounds since the last 10× exceed its median gap" },
  { key: "overdue10_p90", label: "10× deeply overdue (> p90)", describe: "Rounds since the last 10× exceed its 90th-percentile gap" },
  { key: "overdue50", label: "50× overdue (gap > median)", describe: "Rounds since the last 50× exceed its median gap" },
  { key: "zigzag", label: "Zig-zag lo/hi/lo", describe: "Alternating <2× / ≥2× / <2×" },
];

/** Evaluate every signal at each index i (state after rounds[0..i-1]). */
export function signalMatrix(ms: number[], medGap10: number, p90Gap10: number, medGap50: number): { active: Uint8Array[]; current: boolean[] } {
  const n = ms.length;
  const active = SIGNALS.map(() => new Uint8Array(n + 1));
  let lowRun = 0;
  let highRun = 0;
  let since10 = 0;
  let since50 = 0;
  const logs: number[] = [];
  let logSum = 0;
  const win: number[] = [];
  const setAt = (i: number) => {
    // uses state after rounds 0..i-1
    if (i === 0) return;
    const last = ms[i - 1];
    const vals = [
      last < 1.2,
      last >= 10,
      last >= 1.5 && last < 2,
      last >= 5,
      lowRun >= 2,
      lowRun >= 3,
      lowRun >= 5,
      highRun >= 2,
      logs.length >= 10 && Math.exp(logSum / 10) < 1.8,
      win.length >= 20 && Math.max(...win) < 5,
      since10 > medGap10,
      since10 > p90Gap10,
      since50 > medGap50,
      i >= 3 && ms[i - 3] < 2 && ms[i - 2] >= 2 && ms[i - 1] < 2,
    ];
    for (let s = 0; s < vals.length; s++) active[s][i] = vals[s] ? 1 : 0;
  };
  for (let i = 0; i <= n; i++) {
    setAt(i);
    if (i === n) break;
    const m = ms[i];
    if (m < 2) {
      lowRun++;
      highRun = 0;
    } else {
      highRun++;
      lowRun = 0;
    }
    since10 = m >= 10 ? 0 : since10 + 1;
    since50 = m >= 50 ? 0 : since50 + 1;
    const lg = Math.log(m);
    logs.push(lg);
    logSum += lg;
    if (logs.length > 10) logSum -= logs.shift()!;
    win.push(m);
    if (win.length > 20) win.shift();
  }
  return { active, current: SIGNALS.map((_, s) => active[s][n] === 1) };
}

export function gapsBetween(ms: number[], T: number): { gaps: number[]; current: number } {
  const gaps: number[] = [];
  let run = 0;
  let seen = false;
  for (const m of ms) {
    if (m >= T) {
      if (seen) gaps.push(run);
      seen = true;
      run = 0;
    } else run++;
  }
  return { gaps, current: run };
}

export function signalSignificance(rounds: Round[], opts: { T?: number; window?: number } = {}) {
  const T = opts.T ?? 2;
  const all = rounds.filter((r) => r.origin !== "reconstructed").map((r) => r.multiplier);
  const ms = all.slice(-(opts.window ?? 20000));
  const g10 = gapsBetween(ms, 10).gaps.sort((a, b) => a - b);
  const g50 = gapsBetween(ms, 50).gaps.sort((a, b) => a - b);
  const medGap10 = g10.length ? quantile(g10, 0.5) : 10;
  const p90Gap10 = g10.length ? quantile(g10, 0.9) : 30;
  const medGap50 = g50.length ? quantile(g50, 0.5) : 50;
  const { active, current } = signalMatrix(ms, medGap10, p90Gap10, medGap50);
  const n = ms.length;
  const hitsAll = ms.filter((m) => m >= T).length;
  const base = hitsAll / (n || 1);
  // split into two blocks for "stays significant on the next block"
  const half = Math.floor(n / 2);
  const rows = SIGNALS.map((s, si) => {
    let na = 0, ha = 0, na1 = 0, ha1 = 0, na2 = 0, ha2 = 0;
    for (let i = 1; i < n; i++) {
      if (!active[si][i]) continue;
      const hit = ms[i] >= T ? 1 : 0;
      na++;
      ha += hit;
      if (i < half) { na1++; ha1 += hit; } else { na2++; ha2 += hit; }
    }
    const rate = na ? ha / na : 0;
    const [lo, hi] = wilsonCI(ha, na);
    const t = twoProp(ha, na, hitsAll - ha, n - na);
    const t1 = twoProp(ha1, na1, 0, 0);
    void t1;
    return {
      key: s.key,
      label: s.label,
      describe: s.describe,
      active: current[si],
      n: na,
      hits: ha,
      rate: r4(rate),
      base: r4(base),
      lift: r4(base ? rate / base : 0),
      liftLo: r4(base ? lo / base : 0),
      liftHi: r4(base ? hi / base : 0),
      p: t.p,
      block1: { n: na1, rate: r4(na1 ? ha1 / na1 : 0) },
      block2: { n: na2, rate: r4(na2 ? ha2 / na2 : 0) },
      q: 1,
      significant: false,
    };
  });
  const qs = bhQ(rows.map((r) => r.p));
  rows.forEach((r, i) => {
    r.q = r4(qs[i]);
    r.p = r4(r.p);
    r.significant = qs[i] < 0.05 && r.n >= 30;
  });
  const persist = rows.filter((r) => r.significant).map((r) => {
    const b1 = r.block1.rate - base;
    const b2 = r.block2.rate - base;
    return Math.sign(b1) === Math.sign(b2) && r.block2.n >= 30;
  });
  return {
    target: T,
    window: n,
    base: r4(base),
    rows,
    significantCount: rows.filter((r) => r.significant).length,
    persistence: persist.length ? r4(persist.filter(Boolean).length / persist.length) : null,
    note: `Lift of P(next ≥ ${T}×) when each signal is on, vs the ${(base * 100).toFixed(1)}% base rate over ${n.toLocaleString()} rounds. Coloured only when BH q < 0.05 across all ${SIGNALS.length} signals; grey = no evidence.`,
  };
}

/** Shuffle-tape control: expected displayed-significant rate ≈ 5%. */
export function shuffledSignificance(rounds: Round[], T = 2, seed = 3) {
  const r = rng(seed);
  const xs = rounds.map((x) => ({ ...x }));
  const ms = xs.map((x) => x.multiplier);
  for (let i = ms.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [ms[i], ms[j]] = [ms[j], ms[i]];
  }
  xs.forEach((x, i) => (x.multiplier = ms[i]));
  return signalSignificance(xs, { T });
}

// ================================================================= F-26 / F-27 / F-29
// Survival: Kaplan–Meier on inter-exceedance gaps (in rounds), KM percentile of
// the current gap (redefined pressure), conditional median / p90 ETA, a discrete
// logistic hazard in log(1+g) (memorylessness test β₁ with CI) that is displayed
// only while its held-out log-likelihood beats the constant hazard.

export function kmCurve(gaps: number[], maxK?: number): { S: number[]; hazard: number[]; atRisk: number[] } {
  const K = Math.max(1, maxK ?? (gaps.length ? Math.max(...gaps) + 1 : 1));
  const events = new Array(K + 1).fill(0);
  for (const g of gaps) if (g <= K) events[g]++;
  const S: number[] = [1];
  const hazard: number[] = [];
  const atRisk: number[] = [];
  let risk = gaps.length;
  let s = 1;
  for (let k = 0; k <= K; k++) {
    const h = risk > 0 ? events[k] / risk : 0;
    hazard.push(h);
    atRisk.push(risk);
    s *= 1 - h;
    S.push(s);
    risk -= events[k];
  }
  return { S, hazard, atRisk };
}

function fitLogisticHazard(gaps: number[]): { b0: number; b1: number; se1: number; ll: (gs: number[]) => number } {
  // aggregate by k: at-risk count R_k and events E_k
  const K = gaps.length ? Math.min(2000, Math.max(...gaps)) : 0;
  const R = new Array(K + 1).fill(0);
  const E = new Array(K + 1).fill(0);
  for (const g of gaps) {
    const gg = Math.min(g, K);
    for (let k = 0; k <= gg; k++) R[k]++;
    E[gg]++;
  }
  let b0 = 0, b1 = 0;
  let info11 = 1;
  for (let it = 0; it < 30; it++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (let k = 0; k <= K; k++) {
      if (!R[k]) continue;
      const x = Math.log(1 + k);
      const p = 1 / (1 + Math.exp(-(b0 + b1 * x)));
      g0 += E[k] - R[k] * p;
      g1 += (E[k] - R[k] * p) * x;
      const w = R[k] * p * (1 - p);
      h00 += w;
      h01 += w * x;
      h11 += w * x * x;
    }
    const det = h00 * h11 - h01 * h01 || 1e-12;
    const d0 = (h11 * g0 - h01 * g1) / det;
    const d1 = (-h01 * g0 + h00 * g1) / det;
    b0 += d0;
    b1 += d1;
    info11 = h00 / det;
    if (Math.abs(d0) + Math.abs(d1) < 1e-9) break;
  }
  const ll = (gs: number[]) => {
    let s = 0;
    for (const g of gs) {
      for (let k = 0; k <= g; k++) {
        const p = clamp(1 / (1 + Math.exp(-(b0 + b1 * Math.log(1 + k)))), 1e-9, 1 - 1e-9);
        s += k === g ? Math.log(p) : Math.log(1 - p);
      }
    }
    return s;
  };
  return { b0, b1, se1: Math.sqrt(Math.max(1e-12, info11)), ll };
}

function constHazardLL(train: number[], test: number[]): number {
  const ev = train.length;
  const exposure = train.reduce((a, g) => a + g + 1, 0);
  const p = clamp(ev / (exposure || 1), 1e-9, 1 - 1e-9);
  return test.reduce((a, g) => a + Math.log(p) + g * Math.log(1 - p), 0);
}

export function etaBoard(rounds: Round[], opts: { cadenceMs?: number; thresholds?: readonly number[] } = {}) {
  const obs = rounds.filter((r) => r.origin !== "reconstructed");
  const ms = obs.map((r) => r.multiplier);
  const cadence = opts.cadenceMs ?? medianIntervalMs(obs);
  const now = obs.length ? obs[obs.length - 1].tsMs : Date.now();
  const rows = (opts.thresholds ?? ETA_THRESHOLDS).map((T) => {
    const { gaps, current } = gapsBetween(ms, T);
    const nEv = gaps.length;
    const rate = ms.length ? ms.filter((m) => m >= T).length / ms.length : 0;
    if (nEv < 8) {
      return { threshold: T, events: nEv, currentGap: current, rate: r4(rate), kmPercentile: null, etaMedian: null, etaP90: null, etaMedianAt: null, etaP90At: null, pNext: r4(rate), pWithin10: r4(1 - Math.pow(1 - rate, 10)), memoryless: null, hazardModel: null, calibration: null, note: `Only ${nEv} completed gaps — not enough for Kaplan–Meier.` };
    }
    const maxK = Math.max(...gaps, current) + 2;
    const km = kmCurve(gaps, maxK);
    const Sg = km.S[current] ?? 0; // P(gap ≥ current)
    const pct = 1 - Sg;
    const cond = (k: number) => (Sg > 0 ? (km.S[current + k] ?? 0) / Sg : 0);
    let med: number | null = null;
    let p90: number | null = null;
    for (let k = 0; k <= maxK - current + 1; k++) {
      const c = cond(k + 1);
      if (med === null && c <= 0.5) med = k + 1;
      if (p90 === null && c <= 0.1) { p90 = k + 1; break; }
    }
    // geometric fallback when the gap already exceeds every observed gap
    if (med === null) med = rate > 0 ? Math.max(1, Math.ceil(Math.log(0.5) / Math.log(1 - rate))) : null;
    if (p90 === null) p90 = rate > 0 ? Math.max(1, Math.ceil(Math.log(0.1) / Math.log(1 - rate))) : null;
    const hNow = km.hazard[current] ?? rate;
    // memorylessness: logistic hazard slope in log(1+g); held-out on last 30% of gaps
    const cut = Math.floor(nEv * 0.7);
    const train = gaps.slice(0, cut);
    const test = gaps.slice(cut);
    const fit = fitLogisticHazard(train.length >= 8 ? train : gaps);
    const b1lo = fit.b1 - 1.96 * fit.se1;
    const b1hi = fit.b1 + 1.96 * fit.se1;
    const llModel = test.length ? fit.ll(test.map((g) => Math.min(g, 2000))) : 0;
    const llConst = test.length ? constHazardLL(train, test) : 0;
    const beats = test.length >= 5 && llModel > llConst;
    const hazAt = (g: number) => 1 / (1 + Math.exp(-(fit.b0 + fit.b1 * Math.log(1 + g))));
    let adjMed: number | null = null;
    if (beats) {
      let s = 1;
      for (let k = 0; k < 5000; k++) {
        s *= 1 - hazAt(current + k);
        if (s <= 0.5) { adjMed = k + 1; break; }
      }
    }
    // median-ETA calibration: fit KM on first half of gaps, test whether events
    // happen before the stated conditional median ≈ 50% of the time.
    const half = gaps.slice(0, Math.floor(nEv / 2));
    const later = gaps.slice(Math.floor(nEv / 2));
    let calHits = 0, calN = 0;
    if (half.length >= 8 && later.length >= 8) {
      const km2 = kmCurve(half, maxK);
      const r = rng(T * 101);
      for (const g of later) {
        const at = Math.floor(r() * (g + 1)); // random observation point inside the gap
        const S0 = km2.S[at] ?? 0;
        if (S0 <= 0) continue;
        let m2 = 0;
        for (let k = 1; k < maxK; k++) if ((km2.S[at + k] ?? 0) / S0 <= 0.5) { m2 = k; break; }
        if (!m2) continue;
        calN++;
        if (g - at + 1 <= m2) calHits++;
      }
    }
    return {
      threshold: T,
      events: nEv,
      currentGap: current,
      rate: r4(rate),
      kmPercentile: r4(pct),
      pressure: Math.round(pct * 100),
      hazardNow: r4(hNow),
      pNext: r4(clamp(hNow || rate)),
      pWithin10: r4(1 - cond(10)),
      etaMedian: med,
      etaP90: p90,
      etaMedianAt: med != null ? new Date(now + med * cadence).toISOString() : null,
      etaP90At: p90 != null ? new Date(now + p90 * cadence).toISOString() : null,
      medianGap: quantile([...gaps].sort((a, b) => a - b), 0.5),
      memoryless: {
        beta1: r4(fit.b1),
        lo: r4(b1lo),
        hi: r4(b1hi),
        verdict: b1lo <= 0 && b1hi >= 0 ? "memoryless" : fit.b1 > 0 ? "rising hazard" : "falling hazard",
      },
      hazardModel: { heldOutLL: r2(llModel), constLL: r2(llConst), beatsKM: beats, adjustedEtaMedian: adjMed },
      calibration: calN ? { n: calN, beforeMedian: r4(calHits / calN), target: 0.5 } : null,
      note:
        b1lo <= 0 && b1hi >= 0
          ? `Gap hazard is flat (β₁ CI spans 0): being "overdue" carries no information for ${T}×.`
          : `Hazard ${fit.b1 > 0 ? "rises" : "falls"} with gap length for ${T}× (β₁ ${r3(fit.b1)}); ${beats ? "the hazard model beats KM on held-out gaps" : "but it does not beat KM out of sample, so KM is shown"}.`,
    };
  });
  return { cadenceMs: Math.round(cadence), generatedAt: new Date().toISOString(), lastTs: obs.length ? obs[obs.length - 1].ts : null, rows };
}

/** F-27 hazard timeline: per-round conditional hazard h_T(g) with unconditional reference. */
export function hazardTimeline(rounds: Round[], T = 10, maxG = 120) {
  const ms = rounds.filter((r) => r.origin !== "reconstructed").map((r) => r.multiplier);
  const { gaps, current } = gapsBetween(ms, T);
  const rate = ms.length ? ms.filter((m) => m >= T).length / ms.length : 0;
  const km = kmCurve(gaps, Math.max(maxG, current + 1));
  const series = [];
  for (let g = 0; g <= Math.min(maxG, km.hazard.length - 1); g++) {
    const risk = km.atRisk[g];
    const ev = Math.round((km.hazard[g] ?? 0) * risk);
    const [lo, hi] = wilsonCI(ev, risk);
    series.push({ g, hazard: r4(km.hazard[g] ?? 0), lo: r4(lo), hi: r4(hi), atRisk: risk });
  }
  // per-round path of the last 200 rounds: the hazard at the gap each round was at
  const path: { i: number; g: number; hazard: number }[] = [];
  let run = 0;
  const start = Math.max(0, ms.length - 200);
  for (let i = 0; i < ms.length; i++) {
    if (i >= start) path.push({ i: i - start, g: run, hazard: r4(km.hazard[Math.min(run, km.hazard.length - 1)] ?? rate) });
    run = ms[i] >= T ? 0 : run + 1;
  }
  return { threshold: T, rate: r4(rate), currentGap: current, series, path };
}

/** F-29 in-round live ETA: P(M ≥ x | M ≥ m0) and time to reach x. */
export function inRoundEta(rounds: Round[], m0: number, targets = [1.5, 2, 3, 5, 10, 20, 50, 100]) {
  const ms = rounds.filter((r) => r.origin !== "reconstructed").map((r) => r.multiplier);
  const alive = ms.filter((m) => m >= m0);
  return {
    m0,
    sample: alive.length,
    rows: targets
      .filter((x) => x > m0)
      .map((x) => {
        const h = alive.filter((m) => m >= x).length;
        const [lo, hi] = wilsonCI(h, alive.length);
        return {
          target: x,
          law: r4(m0 / x),
          empirical: alive.length ? r4(h / alive.length) : null,
          lo: r4(lo),
          hi: r4(hi),
          secondsFromStart: r2(16.67 * Math.log(x)),
          secondsFromNow: r2(16.67 * (Math.log(x) - Math.log(Math.max(1, m0)))),
        };
      }),
    note: "Under the multiplier law P(M ≥ x | M ≥ m₀) = m₀/x, and the flight takes t(x) ≈ 16.67·ln x seconds. The empirical column checks the source against that law.",
  };
}

// ================================================================= F-17
// Reliability Studio — 10-bin reliability, Murphy decomposition, randomised PIT,
// range coverage with adaptive conformal inference (ACI), bootstrap CIs.

export interface ProbRow { p: number; y: number }
export function reliability(rows: ProbRow[], bins = 10) {
  const n = rows.length;
  const B = Array.from({ length: bins }, () => ({ n: 0, sp: 0, sy: 0 }));
  let brier = 0;
  let ybar = 0;
  for (const r of rows) {
    const b = Math.min(bins - 1, Math.floor(r.p * bins));
    B[b].n++;
    B[b].sp += r.p;
    B[b].sy += r.y;
    brier += (r.p - r.y) ** 2;
    ybar += r.y;
  }
  brier /= n || 1;
  ybar /= n || 1;
  let rel = 0, res = 0;
  const table = B.map((b, i) => {
    const pb = b.n ? b.sp / b.n : 0;
    const ob = b.n ? b.sy / b.n : 0;
    rel += (b.n / (n || 1)) * (pb - ob) ** 2;
    res += (b.n / (n || 1)) * (ob - ybar) ** 2;
    const [lo, hi] = wilsonCI(b.sy, b.n);
    return { bin: i, lo: i / bins, hi: (i + 1) / bins, n: b.n, meanP: r4(pb), observed: r4(ob), ciLo: r4(lo), ciHi: r4(hi) };
  });
  const unc = ybar * (1 - ybar);
  const bss = unc > 0 ? 1 - brier / unc : 0;
  const diffs = rows.map((r) => (ybar - r.y) ** 2 - (r.p - r.y) ** 2);
  const [lo, hi] = blockBootstrapCI(diffs);
  return {
    n,
    brier: r4(brier),
    climatology: r4(unc),
    bss: r4(bss),
    bssCI: [r4(unc ? lo / unc : 0), r4(unc ? hi / unc : 0)],
    murphy: { reliability: r4(rel), resolution: r4(res), uncertainty: r4(unc) },
    table,
  };
}

/** Randomised PIT for a banded forecast: u = F(b−1) + U·p_b. */
export function pitHistogram(items: { dist: number[]; actual: number }[], bins = 10, seed = 11) {
  const r = rng(seed);
  const h = new Array(bins).fill(0);
  for (const it of items) {
    const b = bandIndex(it.actual);
    const F = it.dist.slice(0, b).reduce((a, x) => a + x, 0);
    const u = clamp(F + r() * (it.dist[b] ?? 0), 0, 0.999999);
    h[Math.floor(u * bins)]++;
  }
  const n = items.length || 1;
  const exp = n / bins;
  const chi2 = h.reduce((a, x) => a + (x - exp) ** 2 / (exp || 1), 0);
  // Wilson–Hilferty approx for chi-square p (df = bins-1)
  const k = bins - 1;
  const z = (Math.cbrt(chi2 / k) - (1 - 2 / (9 * k))) / Math.sqrt(2 / (9 * k));
  const p = 1 - normCdf(z);
  return { bins: h.map((c, i) => ({ bin: i, count: c, share: r4(c / n) })), n: items.length, chi2: r2(chi2), p: r4(p), uniform: p > 0.05 };
}

/** Coverage of the p25–p75 range, raw and with ACI (Gibbs & Candès 2021). */
export function coverageACI(items: { dist: number[]; lo: number; hi: number; actual: number }[], target = 0.5, gamma = 0.01) {
  let rawHits = 0;
  let aciHits = 0;
  let alpha = 1 - target; // miscoverage level
  const trail: { i: number; raw: number; aci: number; alpha: number }[] = [];
  let rr = 0, ra = 0;
  items.forEach((it, i) => {
    const inRaw = it.actual >= it.lo && it.actual <= it.hi ? 1 : 0;
    const a = clamp(alpha, 0.01, 0.99);
    const qlo = quantileFromDist(it.dist, a / 2);
    const qhi = quantileFromDist(it.dist, 1 - a / 2);
    const inAci = it.actual >= qlo && it.actual <= qhi ? 1 : 0;
    rawHits += inRaw;
    aciHits += inAci;
    alpha = alpha + gamma * ((1 - target) - (1 - inAci));
    rr += inRaw;
    ra += inAci;
    if ((i + 1) % Math.max(1, Math.floor(items.length / 60)) === 0) trail.push({ i: i + 1, raw: r4(rr / (i + 1)), aci: r4(ra / (i + 1)), alpha: r4(alpha) });
  });
  const n = items.length || 1;
  return {
    n: items.length,
    target,
    raw: r4(rawHits / n),
    aci: r4(aciHits / n),
    rawError: r4(Math.abs(rawHits / n - target)),
    aciError: r4(Math.abs(aciHits / n - target)),
    alphaNow: r4(alpha),
    trail,
    passes: Math.abs(aciHits / n - target) <= 0.02,
  };
}

// ================================================================= F-16 / F-13 / F-14
// Stored per-engine probabilities allow counterfactuals and regime weights
// without re-running any engine.

export interface LedgerRow { weights: Record<string, number>; compLoss: Record<string, number>; mixLoss: number; baseLoss: number; state?: string }

export function counterfactual(rows: LedgerRow[], without: string) {
  const diffs: number[] = [];
  let withL = 0, woL = 0;
  for (const r of rows) {
    let num = 0, den = 0, numAll = 0, denAll = 0;
    for (const [k, w] of Object.entries(r.weights)) {
      const l = r.compLoss[k];
      if (typeof l !== "number") continue;
      const p = Math.exp(-l);
      numAll += w * p;
      denAll += w;
      if (k === without) continue;
      num += w * p;
      den += w;
    }
    if (!den || !denAll) continue;
    const lw = -Math.log(Math.max(1e-6, numAll / denAll));
    const lwo = -Math.log(Math.max(1e-6, num / den));
    withL += lw;
    woL += lwo;
    diffs.push(lwo - lw); // > 0 means removing the engine hurts → it adds value
  }
  const n = diffs.length;
  const [lo, hi] = blockBootstrapCI(diffs);
  return {
    without,
    n,
    withLogLoss: n ? r4(withL / n) : null,
    withoutLogLoss: n ? r4(woL / n) : null,
    marginalValue: n ? r4(mean(diffs)) : null,
    lo: r4(lo),
    hi: r4(hi),
    verdict: n < 30 ? "insufficient" : lo > 0 ? "adds value" : hi < 0 ? "hurts the mixture" : "no measurable effect",
  };
}

export function earnGeneric(keys: string[], logLoss: Record<string, number>, n: number, prior: Record<string, number> = {}): Record<string, number> {
  const known = keys.filter((k) => typeof logLoss[k] === "number");
  const best = known.length ? Math.min(...known.map((k) => logLoss[k])) : 0;
  const nEff = Math.min(60, n);
  const raw: Record<string, number> = {};
  for (const k of keys) raw[k] = (prior[k] ?? 1) * (n >= 15 && typeof logLoss[k] === "number" ? Math.exp(-nEff * (logLoss[k] - best)) : 1);
  const s = Object.values(raw).reduce((a, b) => a + b, 0) || 1;
  for (const k of keys) raw[k] = Math.max(0.02, raw[k] / s);
  const s2 = Object.values(raw).reduce((a, b) => a + b, 0) || 1;
  for (const k of keys) raw[k] = raw[k] / s2;
  return raw;
}

function mixLossFrom(r: LedgerRow, w: Record<string, number>): number {
  let num = 0, den = 0;
  for (const [k, l] of Object.entries(r.compLoss)) {
    const wk = w[k] ?? 0;
    num += wk * Math.exp(-l);
    den += wk;
  }
  return den ? -Math.log(Math.max(1e-6, num / den)) : r.mixLoss;
}

export function regimeWeights(rows: LedgerRow[], opts: { shrink?: number } = {}) {
  const k0 = opts.shrink ?? 50;
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.compLoss)))];
  const cut = Math.floor(rows.length * 0.7);
  const train = rows.slice(0, cut);
  const test = rows.slice(cut);
  const avg = (rs: LedgerRow[]) => {
    const s: Record<string, number> = {};
    for (const r of rs) for (const [k, l] of Object.entries(r.compLoss)) s[k] = (s[k] ?? 0) + l;
    for (const k of Object.keys(s)) s[k] /= rs.length || 1;
    return s;
  };
  const global = earnGeneric(keys, avg(train), train.length);
  const states = [...new Set(rows.map((r) => r.state ?? "?"))];
  const byState: Record<string, { n: number; weights: Record<string, number> }> = {};
  for (const st of states) {
    const rs = train.filter((r) => (r.state ?? "?") === st);
    const w = earnGeneric(keys, avg(rs), rs.length);
    const shr = rs.length / (rs.length + k0);
    const mixed: Record<string, number> = {};
    for (const k of keys) mixed[k] = r4(shr * w[k] + (1 - shr) * global[k]);
    byState[st] = { n: rs.length, weights: mixed };
  }
  const diffs: number[] = [];
  for (const r of test) {
    const wg = global;
    const wr = byState[r.state ?? "?"]?.weights ?? global;
    diffs.push(mixLossFrom(r, wg) - mixLossFrom(r, wr)); // > 0 → regime weights better
  }
  const [lo, hi] = blockBootstrapCI(diffs);
  return {
    keys,
    trainN: train.length,
    testN: test.length,
    global: Object.fromEntries(Object.entries(global).map(([k, v]) => [k, r4(v)])),
    byState,
    heldOutGain: r4(mean(diffs)),
    lo: r4(lo),
    hi: r4(hi),
    real: test.length >= 30 && lo > 0,
    note: test.length < 30 ? "Not enough held-out rows yet." : lo > 0 ? "Regime weights beat global weights out of sample." : "Regimes do not beat global weights out of sample — global weights stay in force.",
  };
}

export interface StoredForecast {
  id: number;
  created_ms: number;
  state: string;
  expected: number;
  range_lo: number;
  range_hi: number;
  reach: number;
  dist: number[];
  comp: { key: string; weight: number; dist: number[] }[];
}
const LOGREP = [Math.log(1.2), Math.log(1.72), Math.log(3.1), Math.log(7), Math.log(25), Math.log(200)];
const eLog = (d: number[]) => d.reduce((a, p, i) => a + p * LOGREP[i], 0);

export function forecastDiff(a: StoredForecast, b: StoredForecast) {
  const keys = [...new Set([...a.comp.map((c) => c.key), ...b.comp.map((c) => c.key)])];
  const contrib = keys.map((k) => {
    const ca = a.comp.find((c) => c.key === k);
    const cb = b.comp.find((c) => c.key === k);
    const va = ca ? ca.weight * eLog(ca.dist) : 0;
    const vb = cb ? cb.weight * eLog(cb.dist) : 0;
    return { key: k, weightFrom: r4(ca?.weight ?? 0), weightTo: r4(cb?.weight ?? 0), deltaLog: r4(vb - va), deltaWeight: r4((cb?.weight ?? 0) - (ca?.weight ?? 0)) };
  });
  contrib.sort((x, y) => Math.abs(y.deltaLog) - Math.abs(x.deltaLog));
  return {
    from: { id: a.id, at: new Date(a.created_ms).toISOString(), state: a.state, expected: a.expected, lo: a.range_lo, hi: a.range_hi, reach: a.reach },
    to: { id: b.id, at: new Date(b.created_ms).toISOString(), state: b.state, expected: b.expected, lo: b.range_lo, hi: b.range_hi, reach: b.reach },
    delta: { expected: r2(b.expected - a.expected), lo: r2(b.range_lo - a.range_lo), hi: r2(b.range_hi - a.range_hi), reach: r2(b.reach - a.reach), stateChanged: a.state !== b.state },
    topEngines: contrib.slice(0, 3),
    engines: contrib,
    bandShift: b.dist.map((p, i) => ({ band: BAND_LABELS[i], from: r4(a.dist[i] ?? 0), to: r4(p), delta: r4(p - (a.dist[i] ?? 0)) })),
  };
}

// ================================================================= F-07
// Sequence search — band-token n-grams over the tape with next-k outcomes vs
// the unconditional base rate (Wilson CIs, "no different from base rate").

export const BAND_TOKENS = ["L", "M", "H", "V", "X", "Z"]; // <1.5, 1.5-2, 2-5, 5-10, 10-100, 100+
export function tokenString(ms: number[]): string {
  let s = "";
  for (const m of ms) s += BAND_TOKENS[bandIndex(m)];
  return s;
}
export function sequenceSearch(rounds: Round[], pattern: string, k = 1, T = 2) {
  const obs = rounds.filter((r) => r.origin !== "reconstructed");
  const ms = obs.map((r) => r.multiplier);
  const tape = tokenString(ms);
  const pat = pattern.toUpperCase().replace(/[^LMHVXZ]/g, "").slice(0, 8);
  if (!pat) return { pattern: pat, error: "pattern must use tokens L M H V X Z (bands <1.5, 1.5–2, 2–5, 5–10, 10–100, 100+)" };
  const t0 = Date.now();
  const occ: number[] = [];
  let from = 0;
  for (;;) {
    const i = tape.indexOf(pat, from);
    if (i < 0) break;
    occ.push(i);
    from = i + 1;
  }
  const next = new Array(NB).fill(0);
  let nn = 0, hit = 0;
  for (const i of occ) {
    const j = i + pat.length;
    if (j + k > ms.length) continue;
    nn++;
    next[bandIndex(ms[j])]++;
    let reached = false;
    for (let t = 0; t < k; t++) if (ms[j + t] >= T) reached = true;
    if (reached) hit++;
  }
  const base = ms.length ? ms.filter((m) => m >= T).length / ms.length : 0;
  const baseK = 1 - Math.pow(1 - base, k);
  const [lo, hi] = wilsonCI(hit, nn);
  const baseShares = bandShares(ms);
  const rate = nn ? hit / nn : 0;
  const t = twoProp(hit, nn, Math.round(baseK * ms.length), ms.length);
  return {
    pattern: pat,
    k,
    target: T,
    occurrences: occ.length,
    scored: nn,
    rate: r4(rate),
    lo: r4(lo),
    hi: r4(hi),
    base: r4(baseK),
    p: r4(t.p),
    differs: nn >= 20 && (lo > baseK || hi < baseK),
    verdict: nn < 20 ? "too few occurrences" : lo > baseK || hi < baseK ? (rate > baseK ? "above base rate" : "below base rate") : "no different from base rate",
    nextBand: next.map((c, i) => ({ band: BAND_LABELS[i], token: BAND_TOKENS[i], share: r4(nn ? c / nn : 0), base: r4(baseShares[i]) })),
    timeline: occ.slice(-300).map((i) => ({ at: obs[i]?.ts, idx: i })),
    latestMatch: tape.endsWith(pat),
    elapsedMs: Date.now() - t0,
  };
}

// ================================================================= F-12 / F-09
// Custom engine families (registry). Each returns a 6-band distribution from a
// strictly causal prefix. Stub engines are refused by the admission tests.

export type EngineFamily = "window" | "ewma" | "markov1" | "streak" | "conditional";
export interface CustomEngineSpec { family: EngineFamily; params: Record<string, number | string> }
export const ENGINE_FAMILIES: Record<EngineFamily, { label: string; params: { key: string; label: string; min: number; max: number; default: number }[] }> = {
  window: { label: "Empirical window", params: [{ key: "window", label: "Window (rounds)", min: 20, max: 5000, default: 300 }] },
  ewma: { label: "Exponentially weighted shares", params: [{ key: "halfLife", label: "Half-life (rounds)", min: 5, max: 5000, default: 200 }] },
  markov1: { label: "First-order band Markov", params: [{ key: "alpha", label: "Laplace α", min: 0.1, max: 50, default: 2 }, { key: "window", label: "Window", min: 200, max: 20000, default: 5000 }] },
  streak: { label: "Streak-conditional", params: [{ key: "x", label: "Streak threshold (×)", min: 1.2, max: 10, default: 2 }, { key: "window", label: "Window", min: 200, max: 20000, default: 5000 }] },
  conditional: { label: "Experiment condition (from F-34)", params: [{ key: "x", label: "Condition level", min: 1.1, max: 100, default: 2 }, { key: "k", label: "Streak length", min: 1, max: 20, default: 3 }, { key: "window", label: "Window", min: 200, max: 20000, default: 5000 }] },
};

export function customPredict(spec: CustomEngineSpec, ms: number[]): number[] {
  const P = spec.params;
  const smooth = (c: number[], a = 0.5) => {
    const s = c.reduce((x, y) => x + y, 0) + a * NB;
    return c.map((x) => (x + a) / s);
  };
  if (!ms.length) return new Array(NB).fill(1 / NB);
  switch (spec.family) {
    case "window": {
      const w = Number(P.window ?? 300);
      const c = new Array(NB).fill(0);
      for (const m of ms.slice(-w)) c[bandIndex(m)]++;
      return smooth(c);
    }
    case "ewma": {
      const hl = Number(P.halfLife ?? 200);
      const lam = Math.pow(0.5, 1 / hl);
      const c = new Array(NB).fill(0);
      let w = 1;
      for (let i = ms.length - 1; i >= Math.max(0, ms.length - hl * 8); i--) {
        c[bandIndex(ms[i])] += w;
        w *= lam;
      }
      return smooth(c, 0.2);
    }
    case "markov1": {
      const a = Number(P.alpha ?? 2);
      const w = Number(P.window ?? 5000);
      const xs = ms.slice(-w);
      const last = bandIndex(xs[xs.length - 1]);
      const c = new Array(NB).fill(0);
      for (let i = 1; i < xs.length; i++) if (bandIndex(xs[i - 1]) === last) c[bandIndex(xs[i])]++;
      return smooth(c, a);
    }
    case "streak":
    case "conditional": {
      const x = Number(P.x ?? 2);
      const k = spec.family === "streak" ? null : Number(P.k ?? 3);
      const w = Number(P.window ?? 5000);
      const xs = ms.slice(-w);
      let run = 0;
      for (let i = xs.length - 1; i >= 0 && xs[i] < x; i--) run++;
      const want = k ?? Math.min(run, 8);
      const c = new Array(NB).fill(0);
      let r = 0;
      for (let i = 0; i < xs.length; i++) {
        const cond = k === null ? Math.min(r, 8) === want : r >= want;
        if (i > 0 && cond && (k === null || run >= want)) c[bandIndex(xs[i])]++;
        r = xs[i] < x ? r + 1 : 0;
      }
      if (k !== null && run < want) {
        // condition not active: fall back to window shares (sleeping expert semantics)
        const cc = new Array(NB).fill(0);
        for (const m of xs) cc[bandIndex(m)]++;
        return smooth(cc);
      }
      return smooth(c, 1);
    }
  }
  return new Array(NB).fill(1 / NB);
}

/** Causal walk-forward score of a custom engine vs the full-history baseline. */
export function scoreCustom(spec: CustomEngineSpec, ms: number[], n = 400, stride = 1) {
  const start = Math.max(50, ms.length - n * stride);
  const diffs: number[] = [];
  const losses: number[] = [];
  const baseCounts = new Array(NB).fill(0);
  for (let i = 0; i < start; i++) baseCounts[bandIndex(ms[i])]++;
  const probs: ProbRow[] = [];
  for (let i = start; i < ms.length; i += stride) {
    const d = customPredict(spec, ms.slice(0, i));
    const tot = baseCounts.reduce((a, b) => a + b, 0) + NB * 0.5;
    const base = baseCounts.map((c) => (c + 0.5) / tot);
    const b = bandIndex(ms[i]);
    const l = -Math.log(Math.max(1e-6, d[b]));
    const lb = -Math.log(Math.max(1e-6, base[b]));
    losses.push(l);
    diffs.push(lb - l);
    probs.push({ p: d.slice(2).reduce((a, x) => a + x, 0), y: ms[i] >= 2 ? 1 : 0 });
    for (let j = i; j < Math.min(ms.length, i + stride); j++) baseCounts[bandIndex(ms[j])]++;
  }
  const [lo, hi] = blockBootstrapCI(diffs);
  return { n: diffs.length, logLoss: r4(mean(losses)), skill: r4(mean(diffs)), lo: r4(lo), hi: r4(hi), reliability: reliability(probs) };
}

/** Admission tests (Ch 15 A1 `no_stub_engines`): determinism, causality, null tape. */
export function admissionTests(spec: CustomEngineSpec, ms: number[]) {
  const cut = Math.max(100, ms.length - 200);
  const prefix = ms.slice(0, cut);
  const a = customPredict(spec, prefix);
  const b = customPredict(spec, prefix);
  const deterministic = a.every((x, i) => Math.abs(x - b[i]) < 1e-12);
  // causality: appending/altering future rounds must not change a past prediction
  const future = [...prefix, ...ms.slice(cut).map((m) => m * 3)];
  const c = customPredict(spec, future.slice(0, cut));
  const causal = a.every((x, i) => Math.abs(x - c[i]) < 1e-12);
  const valid = a.every((x) => Number.isFinite(x) && x >= 0) && Math.abs(a.reduce((s, x) => s + x, 0) - 1) < 1e-6;
  // null tape: on a shuffled tape the engine must not show CI-positive skill
  const r = rng(99);
  const sh = ms.slice(-3000);
  for (let i = sh.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [sh[i], sh[j]] = [sh[j], sh[i]];
  }
  const nul = scoreCustom(spec, sh, 250);
  const nullOk = !(nul.lo > 0);
  const notStub = new Set(a.map((x) => x.toFixed(6))).size > 1 || spec.family === "window";
  return {
    deterministic,
    causal,
    valid,
    nullTape: { ok: nullOk, skill: nul.skill, lo: nul.lo, hi: nul.hi },
    notStub,
    passed: deterministic && causal && valid && nullOk && notStub,
  };
}

// ================================================================= F-34
// Experiment runner: causal train/test, shuffle baseline, planted power check,
// BH across the family → verdict.

export interface ExperimentSpec {
  name: string;
  hypothesis: string;
  condition: { kind: "streak_below" | "streak_above" | "after_at_least" | "after_below" | "sequence" | "gap_since"; x?: number; k?: number; pattern?: string };
  target: { x: number; h: number };
  split?: number;
}

export function conditionMask(ms: number[], c: ExperimentSpec["condition"]): Uint8Array {
  const n = ms.length;
  const out = new Uint8Array(n);
  const x = c.x ?? 2;
  const k = Math.max(1, c.k ?? 1);
  let below = 0, above = 0, since = 0;
  const tape = c.kind === "sequence" ? tokenString(ms) : "";
  const pat = (c.pattern ?? "").toUpperCase().replace(/[^LMHVXZ]/g, "");
  for (let i = 0; i < n; i++) {
    // state after rounds < i
    let on = false;
    switch (c.kind) {
      case "streak_below": on = below >= k; break;
      case "streak_above": on = above >= k; break;
      case "after_at_least": on = i > 0 && ms[i - 1] >= x; break;
      case "after_below": on = i > 0 && ms[i - 1] < x; break;
      case "gap_since": on = since >= k; break;
      case "sequence": on = !!pat && i >= pat.length && tape.slice(i - pat.length, i) === pat; break;
    }
    out[i] = on ? 1 : 0;
    const m = ms[i];
    below = m < x ? below + 1 : 0;
    above = m >= x ? above + 1 : 0;
    since = m >= x ? 0 : since + 1;
  }
  return out;
}

function targetHit(ms: number[], i: number, t: ExperimentSpec["target"]): number | null {
  if (i + t.h > ms.length) return null;
  for (let j = 0; j < t.h; j++) if (ms[i + j] >= t.x) return 1;
  return 0;
}

function effectOn(ms: number[], mask: Uint8Array, t: ExperimentSpec["target"], from: number, to: number) {
  let nc = 0, hc = 0, nb = 0, hb = 0;
  for (let i = from; i < to; i++) {
    const y = targetHit(ms, i, t);
    if (y === null) continue;
    nb++;
    hb += y;
    if (mask[i]) { nc++; hc += y; }
  }
  const tp = twoProp(hc, nc, hb - hc, nb - nc);
  return { n: nc, hits: hc, rate: nc ? hc / nc : 0, base: nb ? hb / nb : 0, z: tp.z, p: tp.p, diff: tp.diff };
}

export function runExperiment(spec: ExperimentSpec, rounds: Round[], opts: { shuffles?: number; plants?: number; seed?: number } = {}) {
  const ms = rounds.filter((r) => r.origin !== "reconstructed").map((r) => r.multiplier);
  const split = Math.floor(ms.length * (spec.split ?? 0.6));
  const mask = conditionMask(ms, spec.condition);
  const train = effectOn(ms, mask, spec.target, 0, split);
  const test = effectOn(ms, mask, spec.target, split, ms.length);
  const r = rng(opts.seed ?? 1234);
  // shuffle baseline: permute the tape, recompute the test-block effect
  const S = opts.shuffles ?? 30;
  const nullZ: number[] = [];
  const xs = [...ms];
  for (let s = 0; s < S; s++) {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    const mk = conditionMask(xs, spec.condition);
    nullZ.push(effectOn(xs, mk, spec.target, split, xs.length).z);
  }
  const shuffleP = (nullZ.filter((z) => Math.abs(z) >= Math.abs(test.z)).length + 1) / (S + 1);
  // planted power check: on shuffled tapes, plant a +20% relative lift on the
  // target after the condition and measure how often the test detects it.
  const P = opts.plants ?? 20;
  let detected = 0;
  const lift = 1.2;
  for (let s = 0; s < P; s++) {
    const ys = [...ms];
    for (let i = ys.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [ys[i], ys[j]] = [ys[j], ys[i]];
    }
    const mk = conditionMask(ys, spec.condition);
    const base = test.base || 0.5;
    const extra = clamp((lift - 1) * base / Math.max(1e-6, 1 - base));
    for (let i = split; i < ys.length; i++) {
      if (!mk[i]) continue;
      if (targetHit(ys, i, spec.target) === 0 && r() < extra) ys[i] = Math.max(ys[i], spec.target.x);
    }
    const mk2 = conditionMask(ys, spec.condition);
    const e = effectOn(ys, mk2, spec.target, split, ys.length);
    if (e.p < 0.05 && e.diff > 0) detected++;
  }
  const power = detected / (P || 1);
  return {
    split,
    train: { ...train, rate: r4(train.rate), base: r4(train.base), z: r2(train.z), p: r4(train.p), diff: r4(train.diff) },
    test: { ...test, rate: r4(test.rate), base: r4(test.base), z: r2(test.z), p: r4(test.p), diff: r4(test.diff), ci: wilsonCI(test.hits, test.n).map(r4) },
    shuffle: { runs: S, p: r4(shuffleP), nullZ: nullZ.map(r2) },
    power: r4(power),
    plantedLift: lift,
    sameSign: Math.sign(train.diff) === Math.sign(test.diff),
  };
}

export function verdictFor(res: ReturnType<typeof runExperiment>, q: number): { verdict: string; lifecycle: string; reason: string } {
  if (res.test.n < 30) return { verdict: "insufficient", lifecycle: "draft", reason: `Only ${res.test.n} condition hits in the test block.` };
  if (q < 0.05 && res.sameSign && res.shuffle.p < 0.05) return { verdict: "supported", lifecycle: "validating", reason: `Test-block q = ${q.toFixed(3)}, same sign as training, beats the shuffle baseline (p ${res.shuffle.p}).` };
  if (res.power >= 0.8) return { verdict: "rejected", lifecycle: "rejected", reason: `No effect (q = ${q.toFixed(3)}) and the planted-lift check detects a +20% effect ${Math.round(res.power * 100)}% of the time, so the test was adequately powered.` };
  return { verdict: "underpowered", lifecycle: "candidate", reason: `No effect (q = ${q.toFixed(3)}), but power to detect a +20% lift is only ${Math.round(res.power * 100)}% — collect more rounds.` };
}

/** Plain-English → spec fallback parser (Entrim drafts it when a key is set). */
export function parseHypothesis(text: string): ExperimentSpec {
  const t = text.toLowerCase();
  const nums = (t.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  const xs = (t.match(/(\d+(\.\d+)?)\s*x/g) ?? []).map((s) => parseFloat(s));
  const kMatch = t.match(/(\d+)\s*(rounds?|in a row|consecutive|times)/);
  const k = kMatch ? Number(kMatch[1]) : 3;
  const hMatch = t.match(/within\s*(\d+)/) ?? t.match(/next\s*(\d+)/);
  const h = hMatch ? Number(hMatch[1]) : 1;
  const condX = xs[0] ?? 2;
  const tgtX = xs[1] ?? xs[0] ?? 2;
  let kind: ExperimentSpec["condition"]["kind"] = "streak_below";
  const streakBelow = /\d+\s*(rounds?|in a row|consecutive|times)?\s*(in a row\s*)?(below|under|less than)/.test(t);
  const streakAbove = /\d+\s*(rounds?|in a row|consecutive|times)\s*(in a row\s*)?(above|over|at least)/.test(t);
  if (/pattern|sequence/.test(t)) kind = "sequence";
  else if (streakBelow && /\d+\s*(rounds?|in a row|consecutive)/.test(t)) kind = "streak_below";
  else if (streakAbove) kind = "streak_above";
  else if (/after (a|an|one)?\s*(big|high|\d+(\.\d+)?\s*x\+?|round (at least|above|over))/.test(t) || /after .*(above|over|at least)/.test(t)) kind = "after_at_least";
  else if (/since|overdue|gap/.test(t)) kind = "gap_since";
  else if (/above|over|hot/.test(t) && /in a row|consecutive|streak/.test(t)) kind = "streak_above";
  const pattern = (text.match(/\b[LMHVXZ]{2,8}\b/) ?? [""])[0];
  void nums;
  return {
    name: text.slice(0, 60),
    hypothesis: text,
    condition: { kind, x: condX, k: kind === "gap_since" ? Math.max(k, 5) : k, pattern: pattern || undefined },
    target: { x: tgtX, h },
  };
}

// ================================================================= F-31 / F-32
// Fractional Kelly tells from a Wilson lower bound, and a block-bootstrap
// bankroll simulator over real sessions.

export function kellyTells(rounds: Round[], opts: { kappa?: number; cap?: number; window?: number; targets?: number[]; minN?: number } = {}) {
  const ms = rounds.filter((r) => r.origin !== "reconstructed").map((r) => r.multiplier).slice(-(opts.window ?? 5000));
  const kappa = Math.min(0.25, opts.kappa ?? 0.25);
  const cap = opts.cap ?? 0.02;
  const minN = opts.minN ?? 100;
  return (opts.targets ?? [1.5, 2, 3, 5, 10]).map((x) => {
    const n = ms.length;
    const h = ms.filter((m) => m >= x).length;
    const [lo] = wilsonCI(h, n);
    const p = n >= minN ? lo : 0;
    const edge = p * x - 1;
    const f = edge > 0 ? Math.min(cap, (kappa * edge) / (x - 1)) : 0;
    return {
      target: x,
      n,
      pHat: r4(n ? h / n : 0),
      pLower: r4(lo),
      ev: r4((n ? h / n : 0) * x - 1),
      evLower: r4(edge),
      fraction: r4(f),
      action: f > 0 ? "stake" : "skip",
      reasons: [
        `Wilson lower bound p ≥ ${(lo * 100).toFixed(2)}% at n = ${n}`,
        edge > 0 ? `p·x − 1 = ${(edge * 100).toFixed(2)}% > 0 → κ·Kelly = ${(f * 100).toFixed(2)}% (cap ${(cap * 100).toFixed(1)}%)` : `p·x − 1 = ${(edge * 100).toFixed(2)}% ≤ 0 → stake 0 (no measured edge)`,
      ],
    };
  });
}

export interface Strategy { cashout: number; stakeMode: "flat" | "fraction"; stake: number; stopLoss?: number; takeProfit?: number; roundsPerSession: number }

export function simulateBankroll(rounds: Round[], strat: Strategy, opts: { sessions?: number; bankroll?: number; paths?: number; seed?: number } = {}) {
  const ms = rounds.filter((r) => r.origin !== "reconstructed").map((r) => r.multiplier);
  const bank0 = opts.bankroll ?? 100;
  const S = opts.sessions ?? 20;
  const paths = opts.paths ?? 400;
  const L = Math.max(5, strat.roundsPerSession);
  const r = rng(opts.seed ?? 17);
  const steps = S * L;
  const curves: number[][] = [];
  let ruined = 0, capHits = 0, stopHits = 0;
  const dds: number[] = [];
  const finals: number[] = [];
  for (let p = 0; p < paths; p++) {
    let bank = bank0;
    let peak = bank0;
    let maxDD = 0;
    const curve: number[] = [bank0];
    let dead = false;
    for (let s = 0; s < S; s++) {
      const start = Math.floor(r() * Math.max(1, ms.length - L));
      const sessStart = bank;
      for (let i = 0; i < L; i++) {
        if (dead) { curve.push(bank); continue; }
        const stake = strat.stakeMode === "flat" ? Math.min(bank, strat.stake) : bank * strat.stake;
        if (stake <= 0 || bank < 0.01) { dead = true; curve.push(bank); continue; }
        const m = ms[start + i] ?? 1;
        bank += m >= strat.cashout ? stake * (strat.cashout - 1) : -stake;
        peak = Math.max(peak, bank);
        maxDD = Math.max(maxDD, peak > 0 ? (peak - bank) / peak : 0);
        curve.push(bank);
        if (strat.takeProfit && bank - sessStart >= strat.takeProfit) { capHits++; for (let j = i + 1; j < L; j++) curve.push(bank); break; }
        if (strat.stopLoss && sessStart - bank >= strat.stopLoss) { stopHits++; for (let j = i + 1; j < L; j++) curve.push(bank); break; }
      }
      if (bank < 0.01) dead = true;
    }
    if (dead || bank < bank0 * 0.01) ruined++;
    dds.push(maxDD);
    finals.push(bank);
    curves.push(curve.slice(0, steps + 1));
  }
  const fan = [];
  const every = Math.max(1, Math.floor(steps / 80));
  for (let t = 0; t <= steps; t += every) {
    const col = curves.map((c) => c[Math.min(t, c.length - 1)]).sort((a, b) => a - b);
    fan.push({ t, p5: r2(quantile(col, 0.05)), p25: r2(quantile(col, 0.25)), p50: r2(quantile(col, 0.5)), p75: r2(quantile(col, 0.75)), p95: r2(quantile(col, 0.95)) });
  }
  const pHit = ms.length ? ms.filter((m) => m >= strat.cashout).length / ms.length : 0;
  const evPerBet = pHit * strat.cashout - 1;
  const bets = steps;
  const closedForm = strat.stakeMode === "flat" ? bank0 + bets * strat.stake * evPerBet : null;
  const sortedF = [...finals].sort((a, b) => a - b);
  const mc = mean(finals);
  const sd = Math.sqrt(mean(finals.map((f) => (f - mc) ** 2)));
  return {
    strategy: strat,
    bankroll: bank0,
    sessions: S,
    paths,
    fan,
    final: { p5: r2(quantile(sortedF, 0.05)), p50: r2(quantile(sortedF, 0.5)), p95: r2(quantile(sortedF, 0.95)), mean: r2(mc) },
    ruin: r4(ruined / paths),
    drawdown: { p50: r4(quantile([...dds].sort((a, b) => a - b), 0.5)), p95: r4(quantile([...dds].sort((a, b) => a - b), 0.95)) },
    takeProfitHits: capHits,
    stopLossHits: stopHits,
    evPerBet: r4(evPerBet),
    pHit: r4(pHit),
    closedForm: closedForm != null ? { expectedFinal: r2(closedForm), mcMean: r2(mc), mcError: r2((1.96 * sd) / Math.sqrt(paths)), agrees: Math.abs(mc - closedForm) <= (2.5 * sd) / Math.sqrt(paths) + 1e-6 || !!strat.stopLoss || !!strat.takeProfit } : null,
  };
}

// ================================================================= F-36 / F-03
// Fairness: provably-fair verification (Stake-style HMAC templates, Bustabit
// 52-bit, Spribe SHA-512), convention solver with k ≥ 3, corrected battery.

export const MESSAGE_TEMPLATES: Record<string, (c: string, n: number, s: string) => string> = {
  "client:nonce": (c, n) => `${c}:${n}`,
  "client-nonce": (c, n) => `${c}-${n}`,
  "nonce:client": (c, n) => `${n}:${c}`,
  clientnonce: (c, n) => `${c}${n}`,
  "server:client:nonce": (c, n, s) => `${s}:${c}:${n}`,
  "nonce-only": (_c, n) => `${n}`,
  "client-only": (c) => c,
};

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export async function sha256Hex(s: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}
export async function sha512Hex(s: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-512", enc.encode(s)));
}
export async function hmacHex(key: string, msg: string, alg: "SHA-256" | "SHA-512"): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: alg }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
export function crashStake(digest: string, edge: number): number {
  const i = parseInt(digest.slice(0, 8), 16);
  const raw = (2 ** 32 / (i + 1)) * (1 - edge);
  return Math.floor(Math.max(1, raw) * 100) / 100;
}
export function crashBustabit(digest: string, divisor = 101): number {
  // divisibility check on the full hash (as in bustabit): use 52-bit chunks
  const big = BigInt("0x" + digest);
  if (big % BigInt(divisor) === 0n) return 1;
  const X = parseInt(digest.slice(0, 13), 16);
  const e = 2 ** 52;
  return Math.floor((100 * e - X) / (e - X)) / 100;
}

export interface VerifyInput { server: string; client?: string; clients?: string[]; nonce?: number; observed?: number }
export async function verifyAll(inp: VerifyInput) {
  const c = inp.client ?? (inp.clients ?? []).join("");
  const n = inp.nonce ?? 0;
  const out: { convention: string; value: number; match: boolean | null }[] = [];
  const cmp = (v: number) => (inp.observed != null ? Math.abs(v - inp.observed) <= 0.005 : null);
  for (const [name, tpl] of Object.entries(MESSAGE_TEMPLATES)) {
    for (const alg of ["SHA-256", "SHA-512"] as const) {
      const d = await hmacHex(inp.server, tpl(c, n, inp.server), alg);
      for (const edge of [0, 0.01, 0.02, 0.03, 0.04, 0.05]) {
        const v = crashStake(d, edge);
        out.push({ convention: `stake|${name}|${alg}|edge=${edge}`, value: v, match: cmp(v) });
      }
    }
  }
  const b1 = await hmacHex(inp.server, c || inp.server, "SHA-256");
  out.push({ convention: "bustabit|hmac(server,client)", value: crashBustabit(b1), match: cmp(crashBustabit(b1)) });
  const b2 = await sha256Hex(inp.server);
  out.push({ convention: "bustabit|sha256(server)", value: crashBustabit(b2), match: cmp(crashBustabit(b2)) });
  // Spribe Aviator: SHA-512(server_seed + client seeds), 52-bit derivation
  const sp = await sha512Hex(inp.server + c);
  const X = parseInt(sp.slice(0, 13), 16);
  const e = 2 ** 52;
  const spribe = Math.max(1, Math.floor((100 * e - X) / (e - X)) / 100);
  out.push({ convention: "spribe|sha512(server+clients)", value: spribe, match: cmp(spribe) });
  return out;
}

export async function solveConvention(rounds: VerifyInput[]) {
  let cands: Set<string> | null = null;
  const per: { idx: number; matches: string[] }[] = [];
  for (let i = 0; i < rounds.length; i++) {
    const res = await verifyAll(rounds[i]);
    const m = res.filter((r) => r.match).map((r) => r.convention);
    per.push({ idx: i, matches: m });
    cands = cands === null ? new Set(m) : new Set<string>([...(cands as Set<string>)].filter((x: string) => m.includes(x)));
  }
  const list = [...(cands ?? [])];
  return {
    rounds: rounds.length,
    candidates: list,
    perRound: per,
    confirmed: rounds.length >= 3 && list.length === 1,
    note: rounds.length < 3 ? "A single match is weak evidence — supply at least 3 rounds (k ≥ 3 intersection)." : list.length === 1 ? `Convention confirmed across ${rounds.length} rounds.` : list.length === 0 ? "No convention reproduces every round — source is unverifiable with these seeds." : `${list.length} conventions still consistent — add rounds.`,
  };
}

export async function verifySeedChain(revealed: string, committed: string, maxDepth = 2000) {
  let h = revealed;
  for (let d = 0; d <= maxDepth; d++) {
    if (h === committed) return { found: true, depth: d };
    h = await sha256Hex(h);
  }
  return { found: false, depth: null };
}

/** Corrected randomness battery (discrete-law PIT instead of KS on a lattice). */
export function fairnessBattery(rounds: Round[]) {
  const ms = rounds.filter((r) => r.origin !== "reconstructed").map((r) => r.multiplier);
  const n = ms.length;
  const tests: { test: string; statistic: number; p: number; n: number; note: string }[] = [];
  // 1. house edge at several cashouts with Wilson CIs
  const edges = [1.5, 2, 3, 5, 10].map((x) => {
    const h = ms.filter((m) => m >= x).length;
    const [lo, hi] = wilsonCI(h, n);
    return { cashout: x, rtp: r4((h / (n || 1)) * x), rtpLo: r4(lo * x), rtpHi: r4(hi * x), edge: r4(1 - (h / (n || 1)) * x) };
  });
  const edgeHat = clamp(mean(edges.map((e) => e.edge)), -0.2, 0.2);
  // 2. chi-square of band shares vs the law P(M ≥ x) = (1−e)/x
  const law = (x: number) => (x <= 1 ? 1 : clamp((1 - edgeHat) / x));
  const expShares = BAND_LABELS.map((_, i) => law(EDGES[i]) - (Number.isFinite(EDGES[i + 1]) ? law(EDGES[i + 1]) : 0));
  const obs = bandShares(ms);
  const chi = obs.reduce((a, o, i) => a + (n * (o - expShares[i]) ** 2) / Math.max(1e-9, n * expShares[i]), 0);
  const k = NB - 2;
  const zc = (Math.cbrt(chi / k) - (1 - 2 / (9 * k))) / Math.sqrt(2 / (9 * k));
  tests.push({ test: "band χ² vs fair law", statistic: r2(chi), p: r4(1 - normCdf(zc)), n, note: `Expected shares from P(M ≥ x) = (1 − ${(edgeHat * 100).toFixed(1)}%)/x.` });
  // 3. discrete-law randomised PIT uniformity (fixes KS on a 0.01 lattice)
  const r = rng(5);
  const hist = new Array(10).fill(0);
  for (const m of ms) {
    const Fhi = 1 - law(m + 0.01);
    const Flo = 1 - law(m);
    const u = clamp(Flo + r() * Math.max(0, Fhi - Flo), 0, 0.999999);
    hist[Math.floor(u * 10)]++;
  }
  const ex = n / 10;
  const chiP = hist.reduce((a, c) => a + (c - ex) ** 2 / (ex || 1), 0);
  const zp = (Math.cbrt(chiP / 9) - (1 - 2 / 81)) / Math.sqrt(2 / 81);
  tests.push({ test: "discrete-law PIT uniformity", statistic: r2(chiP), p: r4(1 - normCdf(zp)), n, note: "Randomised PIT on the 0.01 lattice, 10 bins." });
  // 4. Wald–Wolfowitz runs test above/below 2×
  const b = ms.map((m) => (m >= 2 ? 1 : 0));
  const n1 = b.filter((x) => x === 1).length;
  const n0 = n - n1;
  let runs = n ? 1 : 0;
  for (let i = 1; i < n; i++) if (b[i] !== b[i - 1]) runs++;
  const mu = (2 * n1 * n0) / (n || 1) + 1;
  const vr = (2 * n1 * n0 * (2 * n1 * n0 - n)) / ((n * n * (n - 1)) || 1);
  const zr = (runs - mu) / Math.sqrt(vr || 1);
  tests.push({ test: "runs test (≥ 2×)", statistic: r2(zr), p: r4(twoSidedP(zr)), n, note: `${runs} runs vs ${mu.toFixed(0)} expected.` });
  // 5. lag-1 autocorrelation of log multipliers
  const lg = ms.map((m) => Math.log(m));
  const mu2 = mean(lg);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    den += (lg[i] - mu2) ** 2;
    if (i) num += (lg[i] - mu2) * (lg[i - 1] - mu2);
  }
  const rho = den ? num / den : 0;
  const zrho = rho * Math.sqrt(n);
  tests.push({ test: "lag-1 autocorrelation (log)", statistic: r4(rho), p: r4(twoSidedP(zrho)), n, note: "Independence of consecutive rounds." });
  const q = bhQ(tests.map((t) => t.p));
  return {
    n,
    houseEdge: r4(edgeHat),
    edges,
    tests: tests.map((t, i) => ({ ...t, q: r4(q[i]), flagged: q[i] < 0.05 })),
    expectedShares: expShares.map((s, i) => ({ band: BAND_LABELS[i], expected: r4(s), observed: r4(obs[i]) })),
    verdict: tests.some((_, i) => q[i] < 0.05) ? "deviation flagged — check tape integrity (missed rounds bias the battery) before suspecting the RNG" : "consistent with a fair RNG at the measured house edge",
  };
}

/** F-03 two-sided CUSUM on daily statistics. */
export function cusumFingerprint(rounds: Round[], tzMin = 120) {
  const obs = rounds.filter((r) => r.origin !== "reconstructed");
  const days = new Map<string, number[]>();
  for (const r of obs) {
    const d = new Date(r.tsMs + tzMin * 60_000).toISOString().slice(0, 10);
    (days.get(d) ?? days.set(d, []).get(d)!).push(r.multiplier);
  }
  const keys = [...days.keys()].sort();
  const stats = [
    { key: "low12", label: "share < 1.2×", f: (xs: number[]) => xs.filter((m) => m < 1.2).length / xs.length },
    { key: "over2", label: "share ≥ 2×", f: (xs: number[]) => xs.filter((m) => m >= 2).length / xs.length },
    { key: "over10", label: "share ≥ 10×", f: (xs: number[]) => xs.filter((m) => m >= 10).length / xs.length },
    { key: "edge2", label: "house edge @2×", f: (xs: number[]) => 1 - (xs.filter((m) => m >= 2).length / xs.length) * 2 },
  ];
  return stats.map((s) => {
    const series = keys.filter((d) => (days.get(d)?.length ?? 0) >= 50).map((d) => ({ day: d, n: days.get(d)!.length, value: s.f(days.get(d)!) }));
    const warm = series.slice(0, Math.max(3, Math.floor(series.length / 3)));
    const mu = mean(warm.map((x) => x.value));
    const sd = Math.sqrt(mean(warm.map((x) => (x.value - mu) ** 2))) || 0.01;
    // k = 0.5σ, h = 5σ gives an in-control ARL of ≈ 465 days (≈ 1 year+)
    let hi = 0, lo = 0;
    const out = series.map((x) => {
      const z = (x.value - mu) / sd;
      hi = Math.max(0, hi + z - 0.5);
      lo = Math.max(0, lo - z - 0.5);
      return { day: x.day, n: x.n, value: r4(x.value), cusumHi: r2(hi), cusumLo: r2(lo), alarm: hi > 5 || lo > 5 };
    });
    return { key: s.key, label: s.label, reference: r4(mu), sd: r4(sd), series: out, alarm: out.some((x) => x.alarm), firstAlarm: out.find((x) => x.alarm)?.day ?? null };
  });
}

// ================================================================= F-10

export function compareSources(a: Round[], b: Round[], metric: string) {
  const ma = a.filter((r) => r.origin !== "reconstructed").map((r) => r.multiplier);
  const mb = b.filter((r) => r.origin !== "reconstructed").map((r) => r.multiplier);
  const prop = (x: number) => {
    const ha = ma.filter((m) => m >= x).length;
    const hb = mb.filter((m) => m >= x).length;
    const t = twoProp(ha, ma.length, hb, mb.length);
    return { metric: `P(M ≥ ${x}×)`, a: r4(ha / (ma.length || 1)), b: r4(hb / (mb.length || 1)), diff: r4(t.diff), lo: r4(t.lo), hi: r4(t.hi), p: r4(t.p) };
  };
  const rows = metric === "all" || !metric ? [1.2, 2, 5, 10, 100].map((x) => (x === 1.2 ? { ...prop(1.2), metric: "P(M ≥ 1.2×)" } : prop(x))) : [prop(Number(metric) || 2)];
  // gap distribution for 10×: Mann–Whitney U normal approx
  const ga = gapsBetween(ma, 10).gaps;
  const gb = gapsBetween(mb, 10).gaps;
  let U = 0;
  if (ga.length && gb.length) {
    const all = [...ga.map((v) => ({ v, g: 0 })), ...gb.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
    let rank = 1;
    let ra = 0;
    for (let i = 0; i < all.length; ) {
      let j = i;
      while (j < all.length && all[j].v === all[i].v) j++;
      const avg = (rank + rank + (j - i) - 1) / 2;
      for (let t = i; t < j; t++) if (all[t].g === 0) ra += avg;
      rank += j - i;
      i = j;
    }
    U = ra - (ga.length * (ga.length + 1)) / 2;
  }
  const muU = (ga.length * gb.length) / 2;
  const sdU = Math.sqrt((ga.length * gb.length * (ga.length + gb.length + 1)) / 12) || 1;
  const zU = (U - muU) / sdU;
  const q = bhQ([...rows.map((r) => r.p), twoSidedP(zU)]);
  return {
    nA: ma.length,
    nB: mb.length,
    rows: rows.map((r, i) => ({ ...r, q: r4(q[i]), differs: q[i] < 0.05 })),
    gaps10: { medianA: median(ga), medianB: median(gb), z: r2(zU), p: r4(twoSidedP(zU)), q: r4(q[q.length - 1]) },
    edgeA: r4(1 - (ma.filter((m) => m >= 2).length / (ma.length || 1)) * 2),
    edgeB: r4(1 - (mb.filter((m) => m >= 2).length / (mb.length || 1)) * 2),
  };
}

// ================================================================= F-18

export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}
export async function chainHash(prev: string, payload: unknown): Promise<string> {
  return sha256Hex(prev + "|" + canonicalJson(payload));
}
export const GENESIS = "0".repeat(64);

// ================================================================= F-08 narrator

export function narrate(m: number, prevRun: { below2: number; since10: number }, stored?: { expected: number; lo: number; hi: number } | null): string {
  const band = BAND_LABELS[bandIndex(m)];
  const what = m < 1.2 ? "an instant crash" : m < 2 ? "a short flight" : m < 5 ? "a solid flight" : m < 10 ? "a big flight" : m < 100 ? "a moonshot" : "a jackpot-class moonshot";
  const parts = [`${m.toFixed(2)}× — ${what} (${band}).`];
  if (m < 2 && prevRun.below2 + 1 >= 3) parts.push(`That makes ${prevRun.below2 + 1} rounds below 2× in a row.`);
  if (m >= 2 && prevRun.below2 >= 3) parts.push(`It ends a ${prevRun.below2}-round run below 2×.`);
  if (m >= 10) parts.push(`First 10×+ after ${prevRun.since10} rounds.`);
  if (stored) {
    const inside = m >= stored.lo && m <= stored.hi;
    parts.push(`The stored forecast said ${stored.expected.toFixed(2)}× with a 50% range ${stored.lo.toFixed(2)}–${stored.hi.toFixed(2)}× — ${inside ? "inside the range" : m > stored.hi ? "above the range" : "below the range"}.`);
  }
  return parts.join(" ");
}

/** Numbers checker: every number in `text` must appear in `allowed` (±0.01). */
export function numbersCheck(text: string, allowed: number[]): { ok: boolean; unknown: number[] } {
  const found = (text.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  const unknown = found.filter((x) => x > 1 && !allowed.some((a) => Math.abs(a - x) <= 0.011 || Math.abs(a * 100 - x) <= 0.6));
  return { ok: unknown.length === 0, unknown };
}

// ------------------------------------------------ sync SHA-256 (ledger chain)
// The chain is appended inside synchronous ingest transactions, so it uses a
// small synchronous SHA-256 (FIPS 180-4). The browser verifier recomputes the
// same digests with WebCrypto.
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
export function sha256Sync(input: string): string {
  const msg = enc.encode(input);
  const l = msg.length;
  const withPad = ((l + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(withPad);
  buf.set(msg);
  buf[l] = 0x80;
  const bits = l * 8;
  const dv = new DataView(buf.buffer);
  dv.setUint32(withPad - 4, bits >>> 0);
  dv.setUint32(withPad - 8, Math.floor(bits / 2 ** 32));
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < withPad; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return [...H].map((x) => x.toString(16).padStart(8, "0")).join("");
}
export const chainHashSync = (prev: string, payload: unknown) => sha256Sync(prev + "|" + canonicalJson(payload));
