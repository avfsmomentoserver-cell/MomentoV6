import test from "node:test";
import assert from "node:assert/strict";
import { pointEstimate, interval, intervalScore, pointLoss, selectPointRange, defaultSelection } from "../.predictor-build/point-range.mjs";
import { identityRecalibrator, quantileAt } from "../.predictor-build/calibration.mjs";
import { fullIntelligenceForecast } from "../.predictor-build/intelligence.mjs";
import { syntheticTape, mulberry32 } from "./synthetic.mjs";

const ID = identityRecalibrator("test");
const DIST = [0.45, 0.2, 0.2, 0.08, 0.06, 0.01];
const qf = (q) => quantileAt(DIST, q);

function drawFrom(dist, u) {
  // invert the published quantile function so draws match the forecast exactly
  return quantileAt(dist, u);
}

test("point estimators are finite, ≥ 1 and geomean minimises squared log error", () => {
  for (const m of ["median", "geomean", "trimmed"]) {
    const v = pointEstimate(qf, m);
    assert.ok(Number.isFinite(v) && v >= 1, m);
  }
  const r = mulberry32(5);
  const ys = Array.from({ length: 4000 }, () => drawFrom(DIST, r()));
  const loss = (m) => ys.reduce((a, y) => a + pointLoss(pointEstimate(qf, m), y), 0) / ys.length;
  assert.ok(loss("geomean") < loss("median"), "geomean beats median under squared log error");
});

test("intervals are ordered, nested by coverage, and shortest is no wider in log space", () => {
  for (const m of ["central", "shortest"]) {
    const [a, b] = interval(qf, 0.5, m);
    const [c, d] = interval(qf, 0.8, m);
    assert.ok(1 <= a && a <= b && c <= d);
    assert.ok(Math.log(d) - Math.log(c) >= Math.log(b) - Math.log(a) - 1e-9, `${m}: wider at higher coverage`);
  }
  const [cl, ch] = interval(qf, 0.7, "central");
  const [sl, sh] = interval(qf, 0.7, "shortest");
  assert.ok(Math.log(sh) - Math.log(sl) <= Math.log(ch) - Math.log(cl) + 0.02);
});

test("interval score penalises misses and rewards narrowness", () => {
  assert.ok(intervalScore(1.5, 3, 2, 0.7) < intervalScore(1.2, 6, 2, 0.7));
  assert.ok(intervalScore(1.5, 3, 10, 0.7) > intervalScore(1.5, 3, 2, 0.7));
});

test("selection keeps median / central below the minimum sample and honours operator overrides", () => {
  const few = Array.from({ length: 20 }, () => ({ dist: DIST, actual: 2 }));
  const s = selectPointRange(few, ID, { nominal: 0.7 });
  assert.equal(s.pointMethod, "median");
  assert.equal(s.intervalMethod, "central");
  assert.equal(s.coverage, 0.7);
  const forced = selectPointRange(few, ID, { nominal: 0.7, pointMethod: "geomean", intervalMethod: "shortest" });
  assert.equal(forced.pointMethod, "geomean");
  assert.equal(forced.intervalMethod, "shortest");
});

test("selection earns a distribution-weighted estimator on a calibrated ledger and is chronological-safe", () => {
  const r = mulberry32(11);
  const rows = Array.from({ length: 600 }, () => ({ dist: DIST, actual: drawFrom(DIST, r()) }));
  const s = selectPointRange(rows, ID, { nominal: 0.7 });
  assert.notEqual(s.pointMethod, "median", s.reason);
  const chosen = s.pointScores.find((x) => x.method === s.pointMethod);
  assert.ok(chosen.loss < s.pointScores.find((x) => x.method === "median").loss);
  assert.ok(s.realisedCoverage > 0.6 && s.realisedCoverage < 0.8, `coverage ${s.realisedCoverage}`);
  assert.ok(s.coverage >= 0.55 && s.coverage <= 0.85);
  // corrupt rows are ignored, not fatal
  const dirty = [...rows, { dist: null, actual: 3 }, { dist: DIST, actual: NaN }];
  assert.equal(selectPointRange(dirty, ID, { nominal: 0.7, window: 1000 }).sample, 600);
  assert.equal(defaultSelection(0.7, "x").pointMethod, "median");
});

test("forecast honours the selection and keeps lo ≤ expected ≤ hi ≤ reach", () => {
  const tape = syntheticTape(2600, { seed: 3 });
  const base = fullIntelligenceForecast(tape, "all");
  for (const sel of [
    { ...defaultSelection(0.7, "g"), pointMethod: "geomean", sample: 500 },
    { ...defaultSelection(0.7, "s"), intervalMethod: "shortest", sample: 500 },
    { ...defaultSelection(0.7, "a"), adaptive: true, coverage: 0.78, sample: 500 },
  ]) {
    const f = fullIntelligenceForecast(tape, "all", { pointRange: sel });
    assert.ok(1 <= f.rangeLo && f.rangeLo <= f.expectedMultiplier && f.expectedMultiplier <= f.rangeHi && f.rangeHi <= f.moonshotReach, JSON.stringify(sel));
    assert.equal(f.pointRange.pointMethod, sel.pointMethod);
    assert.equal(f.pointRange.median, base.expectedMultiplier, "median is still reported");
    assert.equal(f.quantiles.p50, base.quantiles.p50);
  }
  const g = fullIntelligenceForecast(tape, "all", { pointRange: { ...defaultSelection(0.7, "g"), pointMethod: "geomean", sample: 500 } });
  assert.notEqual(g.expectedMultiplier, base.expectedMultiplier);
  const a = fullIntelligenceForecast(tape, "all", { pointRange: { ...defaultSelection(0.7, "a"), adaptive: true, coverage: 0.85, sample: 500 } });
  assert.ok(a.rangeHi - a.rangeLo >= base.rangeHi - base.rangeLo - 1e-9, "higher adaptive level widens the range");
});
