// robust-evaluation.ts — locked chronological holdout evidence for the
// full-intelligence forecast.
//
// The recalibrator (calibration.ts) answers "is the published distribution
// better calibrated than the raw mixture?". That is NOT the same as "does the
// model forecast better than simply using the historical band frequencies?".
// This module answers the second question, and nothing else:
//
//   1. Resolved forecasts are taken oldest → newest and split once into a
//      training segment and a final, untouched holdout segment.
//   2. The whole fitting procedure (recalibrator + unconditional baseline) is
//      run on the training segment only.
//   3. Raw, published (recalibrated) and baseline distributions are scored on
//      exactly the same holdout rounds.
//   4. "demonstrated-skill" is granted only when the published forecast beats
//      the baseline by more than `minSeMultiple` standard errors of the paired
//      per-round log-loss difference AND mean threshold Brier skill is above
//      `minimumBrierSkillPct`. Anything less is reported as such.
//
// Pure module: no I/O, no clock, deterministic for a given input.

import {
  applyDistribution,
  CAL_NB,
  fitRecalibrator,
  identityRecalibrator,
  logLoss,
  mapLevel,
  quantileAt,
  rangeProfile,
  sanitizeDist,
  survivalAt,
  type CalSample,
  type FitOptions,
  type Recalibrator,
} from "./calibration";
import { bandIndex } from "./analysis";

export const PUBLIC_THRESHOLDS = [2, 5, 10, 20, 50, 100] as const;
export const EVIDENCE_VERSION = "robust-evidence-v1";

export type EvidenceStatus = "insufficient-data" | "no-demonstrated-skill" | "demonstrated-skill";

export interface ThresholdReliability {
  threshold: number;
  sample: number;
  /** mean published P(X ≥ threshold) on the holdout */
  predicted: number;
  /** observed share of holdout rounds ≥ threshold */
  observed: number;
  brier: number;
  /** Brier of the constant training-segment frequency */
  baselineBrier: number | null;
  /** (baselineBrier − brier) / baselineBrier × 100; positive = better than baseline */
  brierSkillPct: number | null;
}

export interface LockedHoldoutEvidence {
  status: EvidenceStatus;
  reason: string;
  trainingSample: number;
  holdoutSample: number;
  /** rows dropped because the distribution or actual was unusable */
  rejectedSample: number;
  rawLogLoss: number | null;
  calibratedLogLoss: number | null;
  baselineLogLoss: number | null;
  /** published vs raw, % of raw (calibration diagnostic, not skill) */
  logLossImprovementPct: number | null;
  /** published vs baseline, % of baseline (positive = better than baseline) */
  baselineSkillPct: number | null;
  /** standard error of the paired per-round (baseline − published) log loss */
  baselineGainSe: number | null;
  meanBrierSkillPct: number | null;
  /** holdout share inside p25–p75 (target 0.50) */
  coverage50: number | null;
  /** holdout share inside the published headline range (target = rangeNominal) */
  rangeCoverage: number | null;
  rangeProfile: string;
  rangeNominal: number;
  recalibrator: Recalibrator;
  baselineDistribution: number[] | null;
  thresholds: ThresholdReliability[];
}

export interface EvidenceOptions extends FitOptions {
  holdoutFraction?: number;
  minTrainingSample?: number;
  minHoldoutSample?: number;
  minimumBrierSkillPct?: number;
  /** required margin over the baseline, in standard errors of the paired gain */
  minSeMultiple?: number;
  /** headline range profile whose coverage is reported (default "loose") */
  rangeProfile?: string | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const clamp01 = (x: number) => Math.min(1 - 1e-6, Math.max(1e-6, x));
const r6 = (x: number | null) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 1e6) / 1e6);

function standardError(xs: number[]): number {
  if (xs.length < 2) return Infinity;
  const m = mean(xs);
  const v = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v / xs.length);
}

/** Keep only usable samples, normalising the distribution; order is preserved. */
export function cleanSamples(input: readonly CalSample[]): CalSample[] {
  const out: CalSample[] = [];
  for (const s of input ?? []) {
    if (!s) continue;
    const dist = sanitizeDist(s.dist);
    if (dist && Number.isFinite(s.actual) && s.actual >= 1) out.push({ dist, actual: s.actual });
  }
  return out;
}

/** Laplace-smoothed band frequencies of the training segment. */
export function baselineDistribution(train: readonly CalSample[]): number[] {
  const counts = new Array(CAL_NB).fill(1);
  for (const s of train) counts[bandIndex(s.actual)]++;
  const total = counts.reduce((a, b) => a + b, 0);
  return counts.map((c) => c / total);
}

function thresholdRow(holdout: CalSample[], published: number[][], threshold: number, base: number | null): ThresholdReliability {
  const p = published.map((d) => survivalAt(d, threshold));
  const y = holdout.map((s) => (s.actual >= threshold ? 1 : 0));
  const brier = mean(p.map((v, i) => (v - y[i]) ** 2));
  const baselineBrier = base === null ? null : mean(y.map((v) => (base - v) ** 2));
  return {
    threshold,
    sample: holdout.length,
    predicted: mean(p),
    observed: mean(y),
    brier,
    baselineBrier,
    brierSkillPct: baselineBrier !== null && baselineBrier > 0 ? ((baselineBrier - brier) / baselineBrier) * 100 : null,
  };
}

function intervalCoverage(holdout: CalSample[], published: number[][], rc: Recalibrator, lo = 0.25, hi = 0.75): number | null {
  if (!holdout.length) return null;
  const qLo = mapLevel(rc, lo);
  const qHi = mapLevel(rc, hi);
  let inside = 0;
  for (let i = 0; i < holdout.length; i++) {
    const lo = quantileAt(published[i], qLo);
    const hi = quantileAt(published[i], qHi);
    if (holdout[i].actual >= lo && holdout[i].actual <= hi) inside++;
  }
  return inside / holdout.length;
}

export function evaluateLockedHoldout(input: readonly CalSample[], options: EvidenceOptions = {}): LockedHoldoutEvidence {
  const all = cleanSamples(input);
  const rejectedSample = (input?.length ?? 0) - all.length;
  const fraction = Math.min(0.5, Math.max(0.05, options.holdoutFraction ?? 0.2));
  const cut = Math.floor(all.length * (1 - fraction));
  const train = all.slice(0, cut);
  const holdout = all.slice(cut);
  const minTrain = options.minTrainingSample ?? 100;
  const minHold = options.minHoldoutSample ?? 50;
  const prof = rangeProfile(options.rangeProfile);

  if (train.length < minTrain || holdout.length < minHold) {
    const rc = identityRecalibrator("Locked holdout not evaluated: insufficient resolved forecasts.", all.length);
    const raw = holdout.map((s) => s.dist);
    return {
      status: "insufficient-data",
      reason: `Locked holdout requires ${minTrain} training and ${minHold} holdout forecasts; found ${train.length} and ${holdout.length}.`,
      trainingSample: train.length,
      holdoutSample: holdout.length,
      rejectedSample,
      rawLogLoss: null,
      calibratedLogLoss: null,
      baselineLogLoss: null,
      logLossImprovementPct: null,
      baselineSkillPct: null,
      baselineGainSe: null,
      meanBrierSkillPct: null,
      coverage50: null,
      rangeCoverage: null,
      rangeProfile: prof.name,
      rangeNominal: prof.nominal,
      recalibrator: rc,
      baselineDistribution: null,
      thresholds: PUBLIC_THRESHOLDS.map((t) => thresholdRow(holdout, raw, t, null)),
    };
  }

  // everything below is fitted on `train` only
  const rc = fitRecalibrator(train, options);
  const baseDist = baselineDistribution(train);
  const published = holdout.map((s) => applyDistribution(s.dist, rc));

  const rawLosses = holdout.map((s) => logLoss(s.dist, s.actual));
  const pubLosses = published.map((d, i) => logLoss(d, holdout[i].actual));
  const baseLosses = holdout.map((s) => logLoss(baseDist, s.actual));
  const raw = mean(rawLosses);
  const pub = mean(pubLosses);
  const base = mean(baseLosses);
  const gains = baseLosses.map((b, i) => b - pubLosses[i]);
  const gain = mean(gains);
  const se = standardError(gains);

  const rows = PUBLIC_THRESHOLDS.map((t) =>
    thresholdRow(holdout, published, t, clamp01(mean(train.map((s) => (s.actual >= t ? 1 : 0))))),
  );
  const skillRows = rows.filter((r) => r.brierSkillPct !== null);
  const meanSkill = skillRows.length ? mean(skillRows.map((r) => r.brierSkillPct as number)) : 0;

  const seMultiple = options.minSeMultiple ?? 1;
  const minBrier = options.minimumBrierSkillPct ?? 0;
  const beatsBaseline = gain > 0 && gain > seMultiple * se;
  const demonstrated = beatsBaseline && meanSkill > minBrier;

  const detail =
    `published log loss ${pub.toFixed(5)} vs baseline ${base.toFixed(5)} ` +
    `(gain ${gain.toFixed(5)} ± ${Number.isFinite(se) ? se.toFixed(5) : "∞"} SE), ` +
    `mean threshold Brier skill ${meanSkill.toFixed(2)}% on ${holdout.length} untouched rounds`;

  return {
    status: demonstrated ? "demonstrated-skill" : "no-demonstrated-skill",
    reason: demonstrated
      ? `Published forecast beat the unconditional baseline on the locked holdout: ${detail}.`
      : `No demonstrated skill over historical band frequencies on the locked holdout: ${detail}.`,
    trainingSample: train.length,
    holdoutSample: holdout.length,
    rejectedSample,
    rawLogLoss: raw,
    calibratedLogLoss: pub,
    baselineLogLoss: base,
    logLossImprovementPct: raw > 0 ? ((raw - pub) / raw) * 100 : null,
    baselineSkillPct: base > 0 ? ((base - pub) / base) * 100 : null,
    baselineGainSe: Number.isFinite(se) ? se : null,
    meanBrierSkillPct: meanSkill,
    coverage50: intervalCoverage(holdout, published, rc),
    rangeCoverage: intervalCoverage(holdout, published, rc, prof.lo, prof.hi),
    rangeProfile: prof.name,
    rangeNominal: prof.nominal,
    recalibrator: rc,
    baselineDistribution: baseDist,
    thresholds: rows,
  };
}

/** Compact provenance block attached to every live forecast. */
export interface ForecastEvidence {
  version: typeof EVIDENCE_VERSION;
  status: EvidenceStatus;
  reason: string;
  /** created_ms of the newest resolved ledger row the evidence used (null = none) */
  dataCutoffMs: number | null;
  ledgerWindow: number;
  trainingSample: number;
  holdoutSample: number;
  rejectedSample: number;
  recalibrationActive: boolean;
  quantileRecalibrationActive: boolean;
  recalibrationReason: string;
  logLoss: { raw: number | null; published: number | null; baseline: number | null };
  baselineSkillPct: number | null;
  meanBrierSkillPct: number | null;
  coverage50: number | null;
  rangeCoverage: number | null;
  rangeProfile: string;
  rangeNominal: number;
  thresholds: { threshold: number; predicted: number; observed: number; brierSkillPct: number | null }[];
  /** true when the confidence label was capped because skill is not demonstrated */
  confidenceGated: boolean;
  confidenceLabelUngated: "HIGH" | "MEDIUM" | "LOW" | null;
}

export function summarizeEvidence(
  ev: LockedHoldoutEvidence,
  live: Pick<Recalibrator, "active" | "quantileActive" | "reason">,
  meta: { dataCutoffMs: number | null; ledgerWindow: number },
): ForecastEvidence {
  return {
    version: EVIDENCE_VERSION,
    status: ev.status,
    reason: ev.reason,
    dataCutoffMs: meta.dataCutoffMs,
    ledgerWindow: meta.ledgerWindow,
    trainingSample: ev.trainingSample,
    holdoutSample: ev.holdoutSample,
    rejectedSample: ev.rejectedSample,
    recalibrationActive: live.active,
    quantileRecalibrationActive: live.quantileActive,
    recalibrationReason: live.reason,
    logLoss: { raw: r6(ev.rawLogLoss), published: r6(ev.calibratedLogLoss), baseline: r6(ev.baselineLogLoss) },
    baselineSkillPct: r6(ev.baselineSkillPct),
    meanBrierSkillPct: r6(ev.meanBrierSkillPct),
    coverage50: r6(ev.coverage50),
    rangeCoverage: r6(ev.rangeCoverage),
    rangeProfile: ev.rangeProfile,
    rangeNominal: ev.rangeNominal,
    thresholds: ev.thresholds.map((t) => ({
      threshold: t.threshold,
      predicted: r6(t.predicted) ?? 0,
      observed: r6(t.observed) ?? 0,
      brierSkillPct: r6(t.brierSkillPct),
    })),
    confidenceGated: false,
    confidenceLabelUngated: null,
  };
}

/** Evidence block used when the evaluator itself could not run. */
export function unavailableEvidence(reason: string, meta: { dataCutoffMs: number | null; ledgerWindow: number }): ForecastEvidence {
  const ev = evaluateLockedHoldout([]);
  return {
    ...summarizeEvidence(ev, identityRecalibrator(reason), meta),
    reason,
  };
}

/**
 * Cap the headline confidence label unless skill is demonstrated. The forecast
 * numbers are untouched; only the label stops implying established skill.
 */
export function gateConfidence<T extends { confidenceLabel: "HIGH" | "MEDIUM" | "LOW" }>(
  forecast: T,
  evidence: ForecastEvidence,
  enabled = true,
): { forecast: T; evidence: ForecastEvidence } {
  const gated = enabled && evidence.status !== "demonstrated-skill" && forecast.confidenceLabel !== "LOW";
  return {
    forecast: gated ? { ...forecast, confidenceLabel: "LOW" } : forecast,
    evidence: { ...evidence, confidenceGated: gated, confidenceLabelUngated: forecast.confidenceLabel },
  };
}
