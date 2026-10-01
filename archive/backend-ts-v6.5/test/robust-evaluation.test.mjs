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

// ---------------------------------------------------------------- v1 gates
import { gateConfidence, summarizeEvidence, cleanSamples, baselineDistribution, unavailableEvidence } from "../.predictor-build/robust-evaluation.mjs";

// deterministic PRNG so the suite is reproducible
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const REPS = [1.2, 1.7, 3, 7, 30, 200]; // one representative multiplier per band
function draw(dist, u) {
  let c = 0;
  for (let i = 0; i < dist.length; i++) { c += dist[i]; if (u < c) return REPS[i]; }
  return REPS[REPS.length - 1];
}
const MARGINAL = [0.45, 0.2, 0.2, 0.08, 0.06, 0.01];
const LOW = [0.7, 0.15, 0.1, 0.03, 0.019, 0.001];
const HIGH = [0.2, 0.25, 0.3, 0.13, 0.1, 0.02];

test("uninformative forecast on an i.i.d. tape never claims demonstrated skill", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const r = rng(seed);
    const s = Array.from({ length: 600 }, () => ({ dist: MARGINAL, actual: draw(MARGINAL, r()) }));
    const ev = evaluateLockedHoldout(s);
    assert.notEqual(ev.status, "demonstrated-skill", `seed ${seed}: ${ev.reason}`);
  }
});

test("genuinely informative forecast is recognised as demonstrated skill", () => {
  const r = rng(42);
  const s = Array.from({ length: 800 }, (_, i) => {
    const d = i % 2 ? LOW : HIGH; // the regime is known to the forecaster
    return { dist: d, actual: draw(d, r()) };
  });
  const ev = evaluateLockedHoldout(s);
  assert.equal(ev.status, "demonstrated-skill", ev.reason);
  assert.ok(ev.calibratedLogLoss < ev.baselineLogLoss);
  assert.ok(ev.baselineSkillPct > 0);
  assert.ok(ev.meanBrierSkillPct > 0);
});

test("marginal gain within one standard error is not skill", () => {
  const r = rng(9);
  // forecast is very slightly better than the marginal — not distinguishable on 120 rounds
  const s = Array.from({ length: 600 }, () => ({ dist: MARGINAL, actual: draw(MARGINAL, r()) }));
  const ev = evaluateLockedHoldout(s, { minSeMultiple: 1 });
  assert.ok(ev.baselineGainSe !== null && ev.baselineGainSe >= 0);
  if (ev.status === "demonstrated-skill") {
    assert.ok(ev.baselineLogLoss - ev.calibratedLogLoss > ev.baselineGainSe);
  }
});

test("corrupt, short or non-finite rows are rejected and counted, not fitted", () => {
  const good = samples.slice(0, 150);
  const bad = [
    { dist: [NaN, 1, 0, 0, 0, 0], actual: 2 },
    { dist: [1, 0, 0], actual: 2 },
    { dist: dist, actual: Number.NaN },
    { dist: dist, actual: 0.5 },
    { dist: null, actual: 3 },
    null,
  ];
  const ev = evaluateLockedHoldout([...good, ...bad]);
  assert.equal(ev.trainingSample + ev.holdoutSample, 151); // NaN entry in dist[0] is sanitised to 0, still usable
  assert.equal(ev.rejectedSample, 5);
  assert.equal(cleanSamples(bad).length, 1);
});

test("baseline distribution uses only the training segment and is smoothed", () => {
  const b = baselineDistribution([{ dist, actual: 1.1 }]);
  assert.equal(b.length, 6);
  assert.ok(Math.abs(b.reduce((a, x) => a + x, 0) - 1) < 1e-12);
  assert.ok(b.every((x) => x > 0));
});

test("p25–p75 coverage is reported on the holdout and is a valid share", () => {
  const big = Array.from({ length: 400 }, (_, i) => samples[i % samples.length]);
  const ev = evaluateLockedHoldout(big);
  assert.notEqual(ev.status, "insufficient-data");
  assert.ok(ev.coverage50 !== null && ev.coverage50 >= 0 && ev.coverage50 <= 1);
});

test("confidence label is capped unless skill is demonstrated, numbers untouched", () => {
  const ev = summarizeEvidence(evaluateLockedHoldout(samples.slice(0, 20)), { active: false, quantileActive: false, reason: "x" }, { dataCutoffMs: 5, ledgerWindow: 1000 });
  const f = { confidenceLabel: "HIGH", expectedMultiplier: 1.9 };
  const g = gateConfidence(f, ev);
  assert.equal(g.forecast.confidenceLabel, "LOW");
  assert.equal(g.forecast.expectedMultiplier, 1.9);
  assert.equal(g.evidence.confidenceGated, true);
  assert.equal(g.evidence.confidenceLabelUngated, "HIGH");
  assert.equal(f.confidenceLabel, "HIGH", "input object is not mutated");
  const off = gateConfidence(f, ev, false);
  assert.equal(off.forecast.confidenceLabel, "HIGH");
  assert.equal(off.evidence.confidenceGated, false);
  const shown = gateConfidence(f, { ...ev, status: "demonstrated-skill" });
  assert.equal(shown.forecast.confidenceLabel, "HIGH");
});

test("evidence payload is JSON-safe and carries provenance", () => {
  const ev = summarizeEvidence(evaluateLockedHoldout(samples), { active: true, quantileActive: false, reason: "fit" }, { dataCutoffMs: 123, ledgerWindow: 1000 });
  const round = JSON.parse(JSON.stringify(ev));
  assert.deepEqual(round, ev);
  assert.equal(ev.version, "robust-evidence-v1");
  assert.equal(ev.dataCutoffMs, 123);
  assert.equal(ev.recalibrationActive, true);
  assert.equal(ev.thresholds.length, PUBLIC_THRESHOLDS.length);
  const u = unavailableEvidence("boom", { dataCutoffMs: null, ledgerWindow: 1000 });
  assert.equal(u.status, "insufficient-data");
  assert.equal(u.reason, "boom");
});
