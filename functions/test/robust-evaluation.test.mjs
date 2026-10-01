import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLockedHoldout, PUBLIC_THRESHOLDS } from "../.predictor-build/robust-evaluation.mjs";

const dist = [0.5, 0.2, 0.15, 0.08, 0.05, 0.02];
const samples = Array.from({ length: 200 }, (_, i) => ({
  dist,
  actual: i % 10 < 5 ? 1.1 : i % 10 < 7 ? 1.7 : i % 10 < 9 ? 3 : 12,
}));

test("locked holdout refuses evaluation without enough chronological evidence", () => {
  const result = evaluateLockedHoldout(samples.slice(0, 20));
  assert.equal(result.status, "insufficient-data");
  assert.equal(result.trainingSample, 16);
  assert.equal(result.holdoutSample, 4);
  assert.equal(result.thresholds.length, PUBLIC_THRESHOLDS.length);
});

test("recalibrator fit is unchanged when only locked-holdout outcomes change", () => {
  const original = evaluateLockedHoldout(samples);
  const changedHoldout = samples.map((sample, index) =>
    index < 160 ? sample : { ...sample, actual: 1000 },
  );
  const changed = evaluateLockedHoldout(changedHoldout);
  assert.equal(changed.trainingSample, original.trainingSample);
  assert.equal(changed.holdoutSample, original.holdoutSample);
  assert.equal(changed.recalibrator.gamma, original.recalibrator.gamma);
  assert.equal(changed.recalibrator.tau, original.recalibrator.tau);
  assert.deepEqual(changed.recalibrator.ratios, original.recalibrator.ratios);
});

test("threshold evidence contains finite metrics for every public threshold", () => {
  const result = evaluateLockedHoldout(samples);
  assert.equal(result.thresholds.length, PUBLIC_THRESHOLDS.length);
  for (let i = 0; i < result.thresholds.length; i++) {
    const row = result.thresholds[i];
    assert.equal(row.threshold, PUBLIC_THRESHOLDS[i]);
    assert.equal(row.sample, result.holdoutSample);
    assert.ok(Number.isFinite(row.predicted));
    assert.ok(Number.isFinite(row.observed));
    assert.ok(Number.isFinite(row.brier));
    assert.ok(row.predicted > 0 && row.predicted < 1);
    assert.ok(row.observed >= 0 && row.observed <= 1);
    assert.ok(row.brier >= 0 && row.brier <= 1);
  }
});
