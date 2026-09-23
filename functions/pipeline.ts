// functions/pipeline.ts — prediction pipeline + Accuracy Engine v2 math (v6.0).
//
// The pipeline turns measured history into multi-window probabilities:
//   per-round ensemble probability  →  P(hit within a window of N rounds)
// Engine weights are *earned* from the accuracy ledger (Brier skill vs baseline),
// so accuracy improvements accumulate as history resolves. verification runs
// score every model against history in non-overlapping window blocks — O(n)
// per threshold, so the whole table verifies at any scale.

import { BAND_EDGES, BAND_LABELS, bandIndex, moonshot as moonshotOf, pressure as pressureOf, shape as shapeOf, streaks as streaksOf, type Round } from "./analysis";

// ------------------------------------------------------------------ windows

export interface WindowDef {
  id: string;
  label: string;
  ms: number;
}

export const WINDOWS: WindowDef[] = [
  { id: "15m", label: "15 minutes", ms: 15 * 60_000 },
  { id: "1h", label: "1 hour", ms: 3_600_000 },
  { id: "4h", label: "4 hours", ms: 4 * 3_600_000 },
  { id: "1d", label: "1 day", ms: 24 * 3_600_000 },
  { id: "7d", label: "7 days", ms: 7 * 24 * 3_600_000 },
];

export function windowById(id: string): WindowDef | undefined {
  return WINDOWS.find((w) => w.id === id);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r4 = (v: number) => +v.toFixed(4);
const r5 = (v: number) => +v.toFixed(5);

/** For each round index, the length of the sub-threshold run it ends (1 if it clears the threshold). O(n). */
function streakMapOf(rounds: Round[], threshold: number): number[] {
  const out: number[] = new Array(rounds.length);
  let run = 0;
  for (let i = 0; i < rounds.length; i++) {
    run = rounds[i].multiplier >= threshold ? 1 : run + 1;
    out[i] = run;
  }
  return out;
}

/** Median gap between the most recent `span` rounds (rounds/min cadence). */
export function medianIntervalMs(rounds: Round[], span = 200): number {
  const tail = rounds.slice(-span);
  const gaps: number[] = [];
  for (let i = 1; i < tail.length; i++) {
    const g = tail[i].tsMs - tail[i - 1].tsMs;
    if (g > 0 && g < 6 * 3600_000) gaps.push(g);
  }
  if (!gaps.length) return 4000;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/** Expected number of rounds inside a window, from the observed cadence. */
export function expectedRounds(rounds: Round[], windowMs: number): number {
  const interval = medianIntervalMs(rounds);
  return clamp(Math.round(windowMs / interval), 1, 200_000);
}

// ------------------------------------------------------- per-round ensemble

export interface ProbabilityComponent {
  model: string;
  p: number;
  weight: number;
}

export interface PerRoundProbability {
  p: number;
  baseRate: number;
  components: ProbabilityComponent[];
  note: string;
}

const logit = (p: number) => Math.log(clamp(p, 1e-6, 1 - 1e-6) / (1 - clamp(p, 1e-6, 1 - 1e-6)));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/**
 * Ensemble per-round probability that the next round clears `threshold`.
 * Components: measured baseline, markov-1 state, streak conditional, recent-form
 * (EWMA-ish). Weights are earned skill from the accuracy ledger; baseline keeps
 * a floor so the estimate is honest when no model has skill yet.
 */
export function perRoundProbability(
  rounds: Round[],
  threshold: number,
  weights: Record<string, number>,
  recent = 200,
  streakMap?: number[],
): PerRoundProbability {
  const n = rounds.length;
  if (n === 0) return { p: 0.5, baseRate: 0.5, components: [], note: "no history yet" };
  const flags = rounds.map((r) => (r.multiplier >= threshold ? 1 : 0));
  const totalHigh = flags.reduce((a, b) => a + b, 0);
  const baseRate = totalHigh / n;

  // markov-1: P(hit | previous round hit / missed)
  let hh = 0, hl = 0, lh = 0, ll = 0;
  for (let i = 1; i < flags.length; i++) {
    if (flags[i - 1] === 1) { if (flags[i] === 1) hh++; else hl++; }
    else if (flags[i] === 1) lh++; else ll++;
  }
  const prevHit = flags[n - 1] === 1;
  const pMarkov = prevHit
    ? hh + hl > 0 ? hh / (hh + hl) : baseRate
    : lh + ll > 0 ? lh / (lh + ll) : baseRate;

  // streak: empirical P(hit | current below-streak length s), counted via the O(n) map
  const sm = streakMap ?? streakMapOf(rounds, threshold);
  const s = prevHit ? 0 : sm[n - 1];
  let sN = 0, sHits = 0;
  if (!prevHit) {
    for (let i = 1; i < n; i++) {
      if (flags[i - 1]) continue;
      if (sm[i - 1] === s) { sN++; if (flags[i]) sHits++; }
    }
  }
  const pStreak = sN >= 10 ? sHits / sN : baseRate;

  // recent form: rate over the last `recent` rounds
  const tailHigh = flags.slice(-recent).reduce((a, b) => a + b, 0);
  const pRecent = tailHigh / Math.max(1, Math.min(recent, n));

  const models: Record<string, number> = {
    baseline: baseRate,
    markov: pMarkov,
    streak: pStreak,
    recent: pRecent,
  };
  // earned weights: skill floor for baseline, positive-skill share for models
  const w: Record<string, number> = { baseline: 0.25 };
  let skillSum = 0;
  for (const m of ["markov", "streak", "recent"]) {
    const sk = Math.max(0, weights[m] ?? 0);
    w[m] = sk;
    skillSum += sk;
  }
  if (skillSum <= 0) w.baseline = 1;
  else for (const m of ["markov", "streak", "recent"]) w[m] = (w[m] / skillSum) * 0.75;

  const totalW = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const components: ProbabilityComponent[] = Object.entries(models).map(([model, p]) => ({
    model,
    p: r5(p),
    weight: r4((w[model] ?? 0) / totalW),
  }));
  const blended = sigmoid(Object.entries(models).reduce((a, [model, p]) => a + ((w[model] ?? 0) / totalW) * logit(p), 0));
  const p = clamp(blended, 1e-6, 1 - 1e-6);
  const skillModels = Object.entries(w).filter(([m, v]) => m !== "baseline" && v > 0).map(([m]) => m);
  return {
    p: r5(p),
    baseRate: r5(baseRate),
    components,
    note: skillModels.length
      ? `Blended with earned weight on ${skillModels.join(", ")}; baseline keeps its floor.`
      : "No model has earned skill over baseline yet — measured rate governs.",
  };
}

/** P(at least one hit within `nRounds` rounds) under per-round probability p. */
export function windowProbability(pPerRound: number, nRounds: number): number {
  const p = clamp(pPerRound, 1e-9, 1 - 1e-9);
  return clamp(1 - Math.pow(1 - p, nRounds), 1e-9, 1 - 1e-9);
}

// ------------------------------------------------------------------ forecast

export interface PipelinePrediction {
  threshold: number;
  probability: number;
  baselineRate: number;
  perRound: PerRoundProbability;
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
}

export function pipelineForecast(
  rounds: Round[],
  source: string,
  weights: Record<string, number>,
  thresholds: number[] = [2, 5, 10],
  windows: WindowDef[] = WINDOWS,
): PipelineForecast {
  const cadenceMs = medianIntervalMs(rounds);
  const out: PipelineWindow[] = windows.map((w) => {
    const nR = expectedRounds(rounds, w.ms);
    const predictions = thresholds.map((t) => {
      const per = perRoundProbability(rounds, t, weights);
      let run = 0;
      for (let i = rounds.length - 1; i >= 0; i--) {
        if (rounds[i].multiplier >= t) break;
        run++;
      }
      return {
        threshold: t,
        probability: r5(windowProbability(per.p, nR)),
        baselineRate: per.baseRate,
        perRound: per,
        currentRun: run,
      };
    });
    return { window: w.id, label: w.label, expectedRounds: nR, predictions };
  });
  return { source, generatedAt: new Date().toISOString(), cadenceMs, weights, windows: out };
}

// ------------------------------------------------------------- next-round
//
// Flat, UI-ready projection of the single next round — the v5 ForecastPanel
// equivalent, recomputed in v6's own ensemble (no markov/percentile/dna; the
// per-model chips are baseline/markov/streak/recent). The state heuristic uses
// signals only, never the predicted multiplier (which would be circular).

export interface NextRoundBlend {
  model: string;
  p: number;
  weight: number;
  mid: number;
}

export interface NextRoundBand {
  label: string;
  edge: number;
  probability: number;
  representative: number;
}

export interface NextRoundForecast {
  source: string;
  generatedAt: string;
  cadenceMs: number;
  state: string;
  confidence: number;
  confidenceLabel: "HIGH" | "MEDIUM" | "LOW";
  expectedMultiplier: number;
  rangeLo: number;
  rangeHi: number;
  band: string;
  distribution: NextRoundBand[];
  tailLift: number;
  moonshotReach: number;
  lastRound: { multiplier: number; band: string };
  components: NextRoundBlend[];
  note: string;
}

function bandLabelOf(m: number): string {
  let i = 0;
  while (i < BAND_EDGES.length && m >= BAND_EDGES[i]) i++;
  return BAND_LABELS[i];
}

export function nextRoundForecast(
  rounds: Round[],
  source: string,
  weights: Record<string, number>,
): NextRoundForecast {
  const n = rounds.length;
  const lastM = rounds[n - 1]?.multiplier ?? 1;
  const cadenceMs = medianIntervalMs(rounds);
  const st = streaksOf(rounds, 2);
  const sm = streakMapOf(rounds, 2);
  const per = perRoundProbability(rounds, 2, weights, 200, sm);

  // ---- next-round band model -------------------------------------------------
  // Split the measured distribution into bands (1.5 / 2 / 5 / 10 / 100 x).
  // Conditional band shares are measured inside the <2 and >=2 halves; tail
  // conditions (moonshot confidence, ignition) sharpen the >=2 split so hot
  // tails push expected value and the upper range into moonshot territory
  // instead of the old quantile-of-raw-mean (~2x) ceiling.
  const recent = rounds.slice(-400);
  const edges = [1, 1.5, 2, 5, 10, 100, Infinity];
  const labels = ["<1.5x", "1.5–2x", "2–5x", "5–10x", "10–100x", "100x+"];
  const counts = [0, 0, 0, 0, 0, 0];
  const logSums = [0, 0, 0, 0, 0, 0];
  for (const r of recent) {
    const b = bandIndex(r.multiplier);
    counts[b]++;
    logSums[b] += Math.log(Math.max(1.01, r.multiplier));
  }
  const tot = recent.length;
  const belowN = counts[0] + counts[1];
  const aboveN = tot - belowN;
  const rep = (b: number): number =>
    counts[b] >= 5 ? Math.exp(logSums[b] / counts[b]) : b === 5 ? 200 : (edges[b] + edges[b + 1]) / 2;
  const pBelow = belowN / tot;
  const pAbove = aboveN / tot;
  const condBelow = [0, 1].map((b) => (belowN ? counts[b] / belowN : 0.5));
  const condAbove = [0, 1, 2, 3].map((i) => (aboveN ? counts[2 + i] / aboveN : 0.25));

  const shape = shapeOf(rounds, 80);
  const ms = moonshotOf(rounds);
  const press = pressureOf(rounds);
  const recent20 = rounds.slice(-20);
  const hiRun = recent20.filter((r) => r.multiplier >= 10).length;
  const aboveShare = recent20.length ? recent20.filter((r) => r.multiplier >= 2).length / recent20.length : 0;

  let state: NextRoundForecast["state"] = "Shelf";
  if (hiRun >= 2) state = "Ignition";
  else if (ms.imminent || (ms.confidence >= 0.5 && press.overallPressure >= 65)) state = "Moonshot";
  else if (shape.dryZone.active && st.currentKind === "below" && st.current >= 6) state = "Collapse";
  else if (aboveShare >= 0.4 && st.currentKind === "above" && st.current >= 3) state = "Bait";
  else if (st.currentKind === "below" && st.current >= 5) state = "Exhaustion";

  const tailLift = clamp(
    Math.min(1, Math.max(0, ms.confidence)) * 0.7 + (state === "Ignition" ? 0.5 : 0),
    0,
    1,
  );
  // Sharpen the >=2 split toward the tail; zero out the smallest 2-5x slice first.
  const hi = condAbove.map((w, i) => w * (1 + tailLift * i * 0.7));
  hi[0] *= Math.max(0, 1 - tailLift * 0.9);
  const hiSum = hi.reduce((a, b) => a + b, 0) || 1;
  const bandP = [
    condBelow[0] * pBelow,
    condBelow[1] * pBelow,
    hi[0] / hiSum * pAbove,
    hi[1] / hiSum * pAbove,
    hi[2] / hiSum * pAbove,
    hi[3] / hiSum * pAbove,
  ].map((p) => r5(p));
  const reps = [0, 1, 2, 3, 4, 5].map(rep);
  const expected = bandP.reduce((a, p, i) => a + p * reps[i], 0);

  // Quantiles of the band partition -> tight central range + moonshot reach.
  const quantile = (q: number): number => {
    let c = 0;
    for (let i = 0; i < 6; i++) {
      c += bandP[i];
      if (c >= q) {
        const lo = edges[i];
        const hiE = edges[i + 1] === Infinity ? reps[i] * 2 : edges[i + 1];
        return Math.sqrt(lo * hiE);
      }
    }
    return reps[5] * 2;
  };
  const rangeLo = Math.max(1, quantile(0.25));
  const rangeHi = Math.max(rangeLo, quantile(0.75));
  const moonshotReach = quantile(0.85);

  // per-model standalone multipliers from the same band model
  const midFor = (p2: number): number => {
    const below = 1 - p2;
    const above = p2;
    const mass = [condBelow[0] * below, condBelow[1] * below, hi[0] / hiSum * above, hi[1] / hiSum * above, hi[2] / hiSum * above, hi[3] / hiSum * above];
    return Math.max(1, mass.reduce((a, m, i) => a + m * reps[i], 0));
  };
  const components: NextRoundBlend[] = per.components.map((c) => ({ ...c, mid: +midFor(c.p).toFixed(2) }));

  const confidence = Math.min(0.95, Math.max(0.05, per.p));
  const confidenceLabel = confidence >= 0.66 ? "HIGH" : confidence >= 0.38 ? "MEDIUM" : "LOW";

  const stateNotes: Record<string, string> = {
    Ignition: `Consecutive 10x+ rounds inside the last 20 — the tail is hot, so the next-round distribution weights the moonshot bands hard (P(≥2x) ${Math.round(per.p * 100)}%).`,
    Moonshot: `Moonshot conditions are building — ${Math.round(ms.confidence * 100)}% scanner confidence with ${press.overallPressure}% tail pressure; the upper range reaches the moonshot target.`,
    Collapse: `Dry zone active (severity ${shape.dryZone.severity}) with a ${st.current}-round below-2x streak — energy is snuffed, the distribution compresses toward the base bands.`,
    Bait: `${Math.round(aboveShare * 100)}% of the last 20 rounds cleared 2x and the streak is still above — a single spike inside this heat reads as a false invitation.`,
    Exhaustion: `The below-2x streak sits at ${st.current} rounds (max ${st.maxBelow}) — the ladder is worn out and a reset is more likely than another push.`,
    Shelf: `No dominant signal — the shape layer reads ${shape.classification} and the measured band distribution governs (P(≥2x) ${Math.round(per.p * 100)}%).`,
  };
  const streakPart = st.currentKind === "below" ? `drying ${st.current} rounds` : `riding an above streak of ${st.current}`;
  const tailShare = bandP[4] + bandP[5];
  const tailPart = tailShare >= 0.2
    ? ` The next-round distribution still carries ${Math.round(tailShare * 100)}% in the 10x+ moonshot bands.`
    : "";

  return {
    source,
    generatedAt: new Date().toISOString(),
    cadenceMs,
    state,
    confidence: r4(confidence),
    confidenceLabel,
    expectedMultiplier: +expected.toFixed(2),
    rangeLo: +rangeLo.toFixed(2),
    rangeHi: +rangeHi.toFixed(2),
    band: bandLabelOf(expected),
    distribution: bandP.map((p, i) => ({
      label: labels[i],
      edge: edges[i],
      probability: p,
      representative: +reps[i].toFixed(2),
    })),
    tailLift: r4(tailLift),
    moonshotReach: +moonshotReach.toFixed(2),
    lastRound: { multiplier: lastM, band: bandLabelOf(lastM) },
    components,
    note: `${stateNotes[state]} Last round settled ${lastM.toFixed(2)}x in the ${bandLabelOf(lastM)} band, ${streakPart}.${tailPart}`,
  };
}

// ----------------------------------------------------------------- verify

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

interface RunAcc {
  n: number;
  brier: number;
  base: number;
  logloss: number;
  hits: number;
}

function newAcc(): RunAcc {
  return { n: 0, brier: 0, base: 0, logloss: 0, hits: 0 };
}

function score(acc: RunAcc, p: number, y: number, base: number): void {
  const pc = clamp(p, 1e-6, 1 - 1e-6);
  acc.n++;
  acc.brier += (pc - y) ** 2;
  acc.base += (base - y) ** 2;
  acc.logloss += -(y * Math.log(pc) + (1 - y) * Math.log(1 - pc));
  if (pc >= 0.5 === (y === 1)) acc.hits++;
}

function finalize(acc: RunAcc): { brier: number; base: number; logloss: number; hitRate: number } {
  const n = Math.max(1, acc.n);
  return {
    brier: r5(acc.brier / n),
    base: r5(acc.base / n),
    logloss: r5(acc.logloss / n),
    hitRate: r4(acc.hits / n),
  };
}

/**
 * Walk-forward verification over the full history, non-overlapping window blocks.
 * Every model sees only data strictly before each block; the outcome is whether
 * any round in the block cleared the threshold. Running accumulators keep this
 * O(n) per threshold — accuracy figures accumulate at unlimited scale.
 */
export function verifyAgainstHistory(
  rounds: Round[],
  opts: {
    thresholds?: number[];
    windows?: WindowDef[];
    warmup?: number;
    cadenceMs?: number;
    blockWeights?: Record<string, number>;
  } = {},
): VerifyResult {
  const thresholds = opts.thresholds ?? [2, 5, 10];
  const windows = opts.windows ?? WINDOWS;
  const warmup = Math.max(300, opts.warmup ?? 500);
  const cadence = opts.cadenceMs ?? medianIntervalMs(rounds);
  const n = rounds.length;
  const runs: VerifyRun[] = [];
  let blocksTotal = 0;

  for (const t of thresholds) {
    const flags = new Uint8Array(n);
    const prefix = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++) {
      flags[i] = rounds[i].multiplier >= t ? 1 : 0;
      prefix[i + 1] = prefix[i] + flags[i];
    }
    for (const w of windows) {
      const blockSize = clamp(Math.round(w.ms / cadence), 1, n - warmup);
      if (n < warmup + blockSize * 2) {
        runs.push({
          window: w.id, label: w.label, blockSize, threshold: t, blocks: 0,
          brier: 0, brierBase: 0, logloss: 0, hitRate: 0, liftPct: 0, verdict: "insufficient",
          models: [],
        });
        continue;
      }
      const accBase = newAcc();
      const accMarkov = newAcc();
      const accRecent = newAcc();
      const accStreak = newAcc();
      const accEnsemble = newAcc();
      let highCount = 0;
      let hh = 0, hl = 0, lh = 0, ll = 0;
      let belowRun = 0;
      const blocks = Math.floor((n - warmup) / blockSize);
      for (let b = 0; b < blocks; b++) {
        const start = warmup + b * blockSize;
        const end = start + blockSize;
        const base = highCount / Math.max(1, start);
        const prevHit = flags[start - 1] === 1;
        const pMarkov = prevHit ? (hh + hl > 0 ? hh / (hh + hl) : base) : (lh + ll > 0 ? lh / (lh + ll) : base);
        // streak conditional for the current below-run length
        let sN = 0, sHits = 0;
        if (!prevHit) {
          for (let i = 1; i < start; i++) {
            if (flags[i - 1] === 1) continue;
            let st = 0;
            for (let j = i - 1; j >= 0 && flags[j] === 0; j--) st++;
            if (st === belowRun) { sN++; if (flags[i] === 1) sHits++; }
          }
        }
        const pStreak = sN >= 10 ? sHits / sN : base;
        const tailStart = Math.max(0, start - 200);
        const pRecent = (prefix[start] - prefix[tailStart]) / Math.max(1, start - tailStart);
        const ensInputs: [string, number][] = [["baseline", base], ["markov", pMarkov], ["streak", pStreak], ["recent", pRecent]];
        const wts = opts.blockWeights ?? { baseline: 0.25, markov: 0.25, streak: 0.25, recent: 0.25 };
        const wTotal = Object.values(wts).reduce((x, y) => x + y, 0) || 1;
        const pEns = sigmoid(ensInputs.reduce((a, [m, p]) => a + ((wts[m] ?? 0) / wTotal) * logit(p), 0));
        const y = prefix[end] - prefix[start] > 0 ? 1 : 0;
        score(accBase, base, y, base);
        score(accMarkov, pMarkov, y, base);
        score(accStreak, pStreak, y, base);
        score(accRecent, pRecent, y, base);
        score(accEnsemble, pEns, y, base);
        // advance running stats through the block
        for (let i = start; i < end; i++) {
          if (flags[i] === 1) { highCount++; belowRun = 0; }
          else belowRun++;
          if (i > 0) {
            if (flags[i - 1] === 1) { if (flags[i] === 1) hh++; else hl++; }
            else if (flags[i] === 1) lh++; else ll++;
          }
        }
      }
      const fBase = finalize(accBase);
      const models: VerifyModelScore[] = [
        { model: "markov", blocks: accMarkov.n, brier: r5(accMarkov.brier / Math.max(1, accMarkov.n)), logloss: r5(accMarkov.logloss / Math.max(1, accMarkov.n)), hitRate: r4(accMarkov.hits / Math.max(1, accMarkov.n)) },
        { model: "streak", blocks: accStreak.n, brier: r5(accStreak.brier / Math.max(1, accStreak.n)), logloss: r5(accStreak.logloss / Math.max(1, accStreak.n)), hitRate: r4(accStreak.hits / Math.max(1, accStreak.n)) },
        { model: "recent", blocks: accRecent.n, brier: r5(accRecent.brier / Math.max(1, accRecent.n)), logloss: r5(accRecent.logloss / Math.max(1, accRecent.n)), hitRate: r4(accRecent.hits / Math.max(1, accRecent.n)) },
        { model: "ensemble", blocks: accEnsemble.n, brier: r5(accEnsemble.brier / Math.max(1, accEnsemble.n)), logloss: r5(accEnsemble.logloss / Math.max(1, accEnsemble.n)), hitRate: r4(accEnsemble.hits / Math.max(1, accEnsemble.n)) },
      ];
      const fEns = finalize(accEnsemble);
      const lift = fBase.brier > 0 ? ((fEns.brier - fBase.brier) / fBase.brier) * 100 : 0;
      blocksTotal += accBase.n;
      runs.push({
        window: w.id,
        label: w.label,
        blockSize,
        threshold: t,
        blocks: accBase.n,
        brier: fBase.brier,
        brierBase: fBase.brier,
        logloss: fBase.logloss,
        hitRate: fBase.hitRate,
        liftPct: +lift.toFixed(2),
        verdict: accBase.n < 20 ? "insufficient" : fEns.brier <= fBase.brier * 0.995 ? "accepted" : "rejected",
        models,
      });
    }
  }
  return { runs, scanned: n, blocks: blocksTotal, cadenceMs: cadence, generatedAt: new Date().toISOString() };
}

/** Skill score per model from verification runs: baseline Brier − model Brier (weighted by blocks). */
export function skillsFromRuns(runs: VerifyRun[]): Record<string, number> {
  const acc = new Map<string, { skillTimesN: number; n: number }>();
  for (const run of runs) {
    if (run.verdict === "insufficient" || !run.blocks) continue;
    for (const m of run.models) {
      const e = acc.get(m.model) ?? { skillTimesN: 0, n: 0 };
      e.skillTimesN += (run.brierBase - m.brier) * run.blocks;
      e.n += run.blocks;
      acc.set(m.model, e);
    }
  }
  const out: Record<string, number> = {};
  for (const [model, e] of acc) out[model] = e.n ? r5(e.skillTimesN / e.n) : 0;
  return out;
}
