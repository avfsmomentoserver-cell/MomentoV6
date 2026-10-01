import {
  applyDistribution,
  fitRecalibrator,
  identityRecalibrator,
  survivalAt,
  type CalSample,
  type FitOptions,
  type Recalibrator,
} from "./calibration";

export const PUBLIC_THRESHOLDS = [2, 5, 10, 20, 50, 100] as const;

export interface ThresholdReliability {
  threshold: number;
  sample: number;
  predicted: number;
  observed: number;
  brier: number;
  baselineBrier: number | null;
  brierSkillPct: number | null;
}

export interface LockedHoldoutEvidence {
  status: "insufficient-data" | "no-demonstrated-skill" | "demonstrated-skill";
  reason: string;
  trainingSample: number;
  holdoutSample: number;
  rawLogLoss: number | null;
  calibratedLogLoss: number | null;
  logLossImprovementPct: number | null;
  recalibrator: Recalibrator;
  thresholds: ThresholdReliability[];
}

export interface EvidenceOptions extends FitOptions {
  holdoutFraction?: number;
  minTrainingSample?: number;
  minHoldoutSample?: number;
  minimumBrierSkillPct?: number;
}

const finite = (x: number) => Number.isFinite(x);
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const clamp01 = (x: number) => Math.min(1 - 1e-6, Math.max(1e-6, x));

function clean(samples: CalSample[]): CalSample[] {
  return samples.filter((s) => Array.isArray(s.dist) && finite(s.actual) && s.actual >= 1);
}

function logLoss(dist: number[], actual: number): number {
  const band = actual < 1.5 ? 0 : actual < 2 ? 1 : actual < 5 ? 2 : actual < 10 ? 3 : actual < 100 ? 4 : 5;
  return -Math.log(Math.max(1e-6, dist[band] ?? 1e-6));
}

function thresholdRow(samples: CalSample[], threshold: number, rc: Recalibrator, baseline: number | null): ThresholdReliability {
  const predicted = samples.map((s) => survivalAt(applyDistribution(s.dist, rc), threshold));
  const actual = samples.map((s) => s.actual >= threshold ? 1 : 0);
  const brier = mean(predicted.map((p, i) => (p - actual[i]) ** 2));
  const baselineBrier = baseline === null ? null : mean(actual.map((y) => (baseline - y) ** 2));
  return {
    threshold,
    sample: samples.length,
    predicted: mean(predicted),
    observed: mean(actual),
    brier,
    baselineBrier,
    brierSkillPct: baselineBrier && baselineBrier > 0 ? ((baselineBrier - brier) / baselineBrier) * 100 : null,
  };
}

/**
 * Evaluates calibration on a final chronological holdout that is never used to
 * fit the recalibrator. Input must be oldest-to-newest resolved forecasts.
 */
export function evaluateLockedHoldout(input: CalSample[], options: EvidenceOptions = {}): LockedHoldoutEvidence {
  const samples = clean(input);
  const fraction = options.holdoutFraction ?? 0.2;
  const minTraining = options.minTrainingSample ?? 100;
  const minHoldout = options.minHoldoutSample ?? 50;
  const skillFloor = options.minimumBrierSkillPct ?? 0;
  const cut = Math.floor(samples.length * (1 - fraction));
  const train = samples.slice(0, cut);
  const holdout = samples.slice(cut);

  if (train.length < minTraining || holdout.length < minHoldout) {
    return {
      status: "insufficient-data",
      reason: `Locked holdout requires ${minTraining} training and ${minHoldout} holdout forecasts; found ${train.length} and ${holdout.length}.`,
      trainingSample: train.length,
      holdoutSample: holdout.length,
      rawLogLoss: null,
      calibratedLogLoss: null,
      logLossImprovementPct: null,
      recalibrator: identityRecalibrator("Locked holdout not evaluated: insufficient resolved forecasts.", samples.length),
      thresholds: PUBLIC_THRESHOLDS.map((threshold) => thresholdRow(holdout, threshold, identityRecalibrator("insufficient data"), null)),
    };
  }

  const recalibrator = fitRecalibrator(train, options);
  const rawLoss = mean(holdout.map((s) => logLoss(s.dist, s.actual)));
  const calLoss = mean(holdout.map((s) => logLoss(applyDistribution(s.dist, recalibrator), s.actual)));
  const rows = PUBLIC_THRESHOLDS.map((threshold) => {
    const baseline = mean(train.map((s) => s.actual >= threshold ? 1 : 0));
    return thresholdRow(holdout, threshold, recalibrator, clamp01(baseline));
  });
  const skills = rows.map((row) => row.brierSkillPct).filter((x): x is number => x !== null);
  const improvesLogLoss = calLoss < rawLoss - 1e-6;
  const meanSkill = mean(skills);
  const demonstrated = recalibrator.active && improvesLogLoss && meanSkill > skillFloor;

  return {
    status: demonstrated ? "demonstrated-skill" : "no-demonstrated-skill",
    reason: demonstrated
      ? `Recalibration improved locked-holdout log loss and mean threshold Brier skill by ${meanSkill.toFixed(2)}%.`
      : `No demonstrated conditional skill on the locked holdout: log loss ${rawLoss.toFixed(5)} → ${calLoss.toFixed(5)}, mean threshold Brier skill ${meanSkill.toFixed(2)}%.`,
    trainingSample: train.length,
    holdoutSample: holdout.length,
    rawLogLoss: rawLoss,
    calibratedLogLoss: calLoss,
    logLossImprovementPct: rawLoss > 0 ? ((rawLoss - calLoss) / rawLoss) * 100 : null,
    recalibrator,
    thresholds: rows,
  };
}
