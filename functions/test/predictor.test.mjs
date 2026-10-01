// node:test suite for the predictor recalibration layer and forecast invariants.
// Run: npm test   (builds .predictor-build/ first)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAL_NB,
  applyDistribution,
  cdfAt,
  fitRecalibrator,
  quantileAt,
  sanitizeDist,
  survivalAt,
  reliabilityTable,
} from "../.predictor-build/calibration.mjs";
import { fullIntelligenceForecast } from "../.predictor-build/intelligence.mjs";
import { mulberry32, crashDraw, syntheticTape } from "./synthetic.mjs";

const EDGES = [1, 1.5, 2, 5, 10, 100, Infinity];
/** exact band distribution of the crash law with house edge e */
function trueDist(e = 0.03) {
  const S = (x) => (x <= 1 ? 1 : Math.min(1, (1 - e) / x));
  return EDGES.slice(0, -1).map((lo, i) => S(lo) * (i === 0 ? 1 / S(1) : 1) - (Number.isFinite(EDGES[i + 1]) ? S(EDGES[i + 1]) : 0)).map((p, i, xs) => (i === 0 ? 1 - xs.slice(1).reduce((a, b) => a + b, 0) : p));
}
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

test("cdf and quantile are inverse and monotone", () => {
  const d = trueDist();
  let prev = 0;
  for (const q of [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
    const x = quantileAt(d, q);
    assert.ok(x >= 1 && Number.isFinite(x));
    assert.ok(x >= prev, "quantiles must be non-decreasing");
    prev = x;
    assert.ok(Math.abs(cdfAt(d, x) - q) < 1e-6, `cdf(quantile(${q})) ≈ ${q}`);
  }
  assert.ok(survivalAt(d, 2) > survivalAt(d, 5) && survivalAt(d, 5) > survivalAt(d, 10));
});

test("sanitizeDist rejects garbage and normalises", () => {
  assert.equal(sanitizeDist(null), null);
  assert.equal(sanitizeDist([1, 2]), null);
  assert.equal(sanitizeDist(new Array(CAL_NB).fill(0)), null);
  const d = sanitizeDist([1, NaN, -3, 1, Infinity, 2]);
  assert.ok(d && Math.abs(sum(d) - 1) < 1e-12 && d.every((x) => x >= 0));
});

test("identity below the minimum sample and on corrupt input", () => {
  const rc = fitRecalibrator([{ dist: trueDist(), actual: 2 }], { minSample: 60 });
  assert.equal(rc.active, false);
  assert.equal(rc.quantileActive, false);
  const junk = Array.from({ length: 200 }, () => ({ dist: [NaN, 1], actual: NaN }));
  const rc2 = fitRecalibrator(junk);
  assert.equal(rc2.active, false);
  assert.equal(rc2.sample, 0);
});

function samplesFrom(forecastDist, n, seed, edge = 0.03) {
  const rand = mulberry32(seed);
  return Array.from({ length: n }, () => ({ dist: forecastDist, actual: crashDraw(rand, edge) }));
}

test("well-calibrated forecasts are left (almost) untouched", () => {
  const d = trueDist();
  let activations = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const rc = fitRecalibrator(samplesFrom(d, 1000, seed));
    if (rc.active) activations++;
    const cal = applyDistribution(d, rc);
    const tv = 0.5 * sum(cal.map((p, i) => Math.abs(p - d[i])));
    assert.ok(tv < 0.04, `calibrated forecast should stay close to truth (TV ${tv.toFixed(3)})`);
  }
  assert.ok(activations <= 2, `layer should rarely fire on calibrated input (${activations}/5)`);
});

test("miscalibrated mixture (fat tail, too few crashes) is corrected out of sample", () => {
  const truth = trueDist();
  const biased = sanitizeDist([0.25, 0.15, 0.27, 0.11, 0.19, 0.03]);
  const train = samplesFrom(biased, 1000, 11);
  const rc = fitRecalibrator(train);
  assert.equal(rc.active, true, rc.reason);
  assert.ok(rc.validCalLogLoss < rc.validRawLogLoss);
  // fresh, unseen rounds
  const test = samplesFrom(biased, 4000, 99);
  const ll = (dist) => -sum(test.map((s) => Math.log(dist[[1.5, 2, 5, 10, 100].filter((e) => s.actual >= e).length]))) / test.length;
  const cal = applyDistribution(biased, rc);
  assert.ok(ll(cal) < ll(biased), `held-out log-loss ${ll(cal).toFixed(4)} < ${ll(biased).toFixed(4)}`);
  const crash = (x) => x[0] + x[1];
  assert.ok(Math.abs(crash(cal) - crash(truth)) < Math.abs(crash(biased) - crash(truth)), "P(<2x) moves toward the truth");
  const rel = reliabilityTable(train, rc);
  assert.equal(rel.length, CAL_NB);
});

test("quantile layer restores p25–p75 coverage", () => {
  // over-dispersed central block: true dist but quantiles read off a wrong one
  const biased = sanitizeDist([0.2, 0.12, 0.3, 0.14, 0.2, 0.04]);
  const rc = fitRecalibrator(samplesFrom(biased, 600, 21));
  const rand = mulberry32(5);
  const dist = applyDistribution(biased, rc);
  const lvl = (q) => (rc.quantileActive ? rc.levels.find((l) => l.q === q).mapped : q);
  const lo = quantileAt(dist, lvl(0.25));
  const hi = quantileAt(dist, lvl(0.75));
  const xs = Array.from({ length: 6000 }, () => crashDraw(rand));
  const cov = xs.filter((x) => x >= lo && x <= hi).length / xs.length;
  assert.ok(Math.abs(cov - 0.5) < 0.06, `coverage ${cov.toFixed(3)} ≈ 0.50`);
});

test("full-intelligence forecast invariants hold (with and without recalibrator)", () => {
  const tape = syntheticTape(2600, { seed: 3 });
  const truthSamples = samplesFrom(sanitizeDist([0.25, 0.15, 0.27, 0.11, 0.19, 0.03]), 300, 4);
  for (const recalibrator of [undefined, fitRecalibrator(truthSamples)]) {
    const f = fullIntelligenceForecast(tape, "all", { recalibrator });
    const nums = [f.expectedMultiplier, f.rangeLo, f.rangeHi, f.moonshotReach, f.confidence];
    assert.ok(nums.every(Number.isFinite), "all headline numbers finite");
    assert.ok(1 <= f.rangeLo && f.rangeLo <= f.expectedMultiplier && f.expectedMultiplier <= f.rangeHi && f.rangeHi <= f.moonshotReach, `ordered: ${nums}`);
    const p = f.distribution.map((d) => d.probability);
    assert.ok(Math.abs(sum(p) - 1) < 1e-3);
    assert.equal(f.rawDistribution.length, CAL_NB);
    const bandOf = (x) => [1.5, 2, 5, 10, 100].filter((e) => x >= e).length;
    assert.equal(f.band, f.distribution[bandOf(f.expectedMultiplier)].label, "band is the band of the expected value");
    const outlook = f.intelligence.horizonOutlook;
    for (let i = 1; i < outlook.length; i++) assert.ok(outlook[i].perRound <= outlook[i - 1].perRound + 1e-9, "P(≥t) non-increasing in t");
    assert.ok(f.intelligence.calibration && typeof f.intelligence.calibration.reason === "string");
  }
});

test("forecast survives tiny and degenerate tapes", () => {
  for (const n of [0, 1, 5, 30]) {
    const tape = syntheticTape(n, { seed: 9 });
    const f = fullIntelligenceForecast(tape, "all");
    assert.ok(Number.isFinite(f.expectedMultiplier) && f.expectedMultiplier >= 1, `n=${n}`);
    assert.ok(f.rangeLo <= f.rangeHi);
  }
  const flat = syntheticTape(400).map((r) => ({ ...r, multiplier: 1 }));
  const f = fullIntelligenceForecast(flat, "all");
  assert.ok(Number.isFinite(f.expectedMultiplier));
});
