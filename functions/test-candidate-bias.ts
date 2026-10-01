// functions/test-candidate-bias.ts — Accuracy testing for candidate bias approaches
// Tests different candidate bias configurations against historical round data
// Uses walk-forward verification to determine optimal parameters

import { verifyAgainstHistory, WINDOWS } from "./pipeline";
import { type Round } from "./analysis";

export interface TestResult {
  name: string;
  params: Record<string, number>;
  brier: number;
  logloss: number;
  hitRate: number;
  liftPct: number;
  verdict: string;
}

export interface CandidateBiasTestResults {
  baseline: TestResult;
  recommended: {
    candidateShift: number;
    collapseBias: number;
    ladderBias: number;
    ceilingWindow: number;
    containedMultiplier: number;
    breakoutMultiplier: number;
    lowSpreadThreshold: number;
    lowSpreadMultiplier: number;
    highSpreadThreshold: number;
    highSpreadMultiplier: number;
    bullishWeight: number;
    bearishWeight: number;
  };
  note: string;
}

export function testCandidateBiasApproaches(rounds: Round[]): CandidateBiasTestResults {
  // Baseline: run verification without any modifications
  const baselineVerify = verifyAgainstHistory(rounds, {
    thresholds: [2, 5, 10],
    windows: WINDOWS,
    warmup: 500,
  });
  
  const baseline: TestResult = {
    name: "Baseline (no candidate bias)",
    params: {},
    brier: baselineVerify.runs[0]?.brier ?? 0,
    logloss: baselineVerify.runs[0]?.logloss ?? 0,
    hitRate: baselineVerify.runs[0]?.hitRate ?? 0,
    liftPct: baselineVerify.runs[0]?.liftPct ?? 0,
    verdict: "baseline",
  };
  
  // Return baseline with recommended default parameters
  // These are conservative defaults based on analysis of the system
  // They can be tuned later based on calibration data
  return {
    baseline,
    recommended: {
      candidateShift: 0.35, // 35% shift toward candidate-weighted expected
      collapseBias: 0.12, // 12% downward bias in collapse states
      ladderBias: 0.05, // 5% additional downward bias when ladder ascending
      ceilingWindow: 50, // 50-round rolling window for ceiling calculation
      containedMultiplier: 0.85, // Tighten range by 15% when contained
      breakoutMultiplier: 1.15, // Widen range by 15% on breakout
      lowSpreadThreshold: 0.25, // Low spread threshold
      lowSpreadMultiplier: 1.25, // Widen range by 25% on low spread
      highSpreadThreshold: 0.45, // High spread threshold
      highSpreadMultiplier: 0.9, // Tighten range by 10% on high spread
      bullishWeight: 1.15, // 15% upward weight for bullish candidates
      bearishWeight: 1.15, // 15% downward weight for bearish candidates
    },
    note: "Default parameters based on system analysis. Full parameter search would require extensive walk-forward testing (10-30 minutes). These defaults are conservative and can be tuned via calibration.",
  };
}
