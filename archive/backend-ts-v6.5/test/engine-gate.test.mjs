import test from "node:test";
import assert from "node:assert/strict";
import { blendAdmission, gatedStates } from "../.predictor-build/engine-gate.mjs";
import { analogueNextDist, chartLabPrecision } from "../.predictor-build/analogue.mjs";
import { fullIntelligenceForecast } from "../.predictor-build/intelligence.mjs";
import { syntheticTape, mulberry32 } from "./synthetic.mjs";

// rows where engine "good" puts high probability on what lands, "noise" does not
function rows(n, seed, goodEdge = 0.25) {
  const r = mulberry32(seed);
  return Array.from({ length: n }, () => {
    const pBase = 0.3;
    const pGood = Math.min(0.95, pBase + goodEdge * (r() < 0.8 ? 1 : -0.5));
    const pNoise = Math.max(0.01, pBase + (r() - 0.5) * 0.3);
    return {
      weights: { baseline: 0.6, noise: 0.4, good: 0.02 },
      compLoss: { baseline: -Math.log(pBase), noise: -Math.log(pNoise), good: -Math.log(pGood) },
    };
  });
}

test("gate admits an engine that improves the blend and excludes one that does not", () => {
  const g = blendAdmission(rows(400, 1), ["baseline", "noise", "good"]);
  const v = Object.fromEntries(g.verdicts.map((x) => [x.key, x]));
  assert.equal(v.baseline.status, "always");
  assert.equal(v.good.status, "admitted", v.good.reason);
  assert.ok(v.good.gain > 2 * v.good.se);
  assert.notEqual(v.noise.status, "admitted", v.noise.reason);
  assert.deepEqual(g.admitted.sort(), ["baseline", "good"]);
});

test("gate needs a minimum sample and ignores corrupt rows", () => {
  const g = blendAdmission(rows(50, 2), ["baseline", "good"], { minSample: 100 });
  assert.equal(g.verdicts.find((x) => x.key === "good").status, "insufficient-data");
  const dirty = [...rows(150, 3), { weights: null, compLoss: null }, { weights: { baseline: 1 }, compLoss: { baseline: NaN } }];
  assert.equal(blendAdmission(dirty, ["baseline", "good"]).sample, 150);
});

test("an engine identical to the rest of the blend adds nothing and is excluded", () => {
  const same = Array.from({ length: 300 }, (_, i) => {
    const p = 0.2 + 0.6 * ((i * 7919) % 100) / 100;
    return { weights: { baseline: 0.5, copy: 0.5 }, compLoss: { baseline: -Math.log(p), copy: -Math.log(p) } };
  });
  const g = blendAdmission(same, ["baseline", "copy"]);
  assert.equal(g.verdicts.find((x) => x.key === "copy").status, "excluded");
});

test("gated states: operator removals win, new engines start in shadow, built-ins keep state until tested", () => {
  const gate = {
    sample: 300, admitted: ["baseline", "markov"], excluded: ["dna", "chartlab"], reason: "",
    verdicts: [
      { key: "baseline", status: "always", admitted: true },
      { key: "markov", status: "admitted", admitted: true },
      { key: "dna", status: "excluded", admitted: false },
      { key: "chartlab", status: "excluded", admitted: false },
      { key: "ml", status: "insufficient-data", admitted: false },
      { key: "custom1", status: "insufficient-data", admitted: false },
    ],
  };
  const s = gatedStates({ markov: "demoted" }, gate, ["baseline", "markov", "dna", "ml"], ["chartlab", "custom1", "custom2"]);
  assert.equal(s.markov, "demoted", "operator demotion wins over admission");
  assert.equal(s.dna, "shadow");
  assert.equal(s.chartlab, "shadow");
  assert.equal(s.ml, "live");
  assert.equal(s.custom1, "shadow");
  assert.equal(s.custom2, "shadow");
  assert.deepEqual(gatedStates({ dna: "live" }, null, [], []), { dna: "live" });
});

test("analogue engine returns a valid smoothed distribution", () => {
  const m = syntheticTape(3000, { seed: 4 }).map((r) => r.multiplier);
  for (const tape of [m, m.slice(0, 20), []]) {
    const d = analogueNextDist(tape, { window: 30, k: 40 });
    assert.equal(d.length, 6);
    assert.ok(Math.abs(d.reduce((a, b) => a + b, 0) - 1) < 1e-9);
    assert.ok(d.every((p) => p > 0));
  }
});

test("Chart Lab precision test does not report precision on an i.i.d. tape", () => {
  const m = syntheticTape(4000, { seed: 7 }).map((r) => r.multiplier);
  const p = chartLabPrecision(m, { anchors: 60, window: 30, horizon: 20, k: 40, scanLimit: 3000 });
  assert.ok(p.anchors >= 30);
  assert.notEqual(p.verdict, "more-precise", p.reason);
  assert.ok(Number.isFinite(p.skillVsFlat) && Number.isFinite(p.skillVsRandom));
});

test("a shadow extra engine is scored but carries no weight; live it joins the mixture", () => {
  const tape = syntheticTape(2600, { seed: 3 });
  const eng = { key: "chartlab", label: "Chart Lab", prior: 0.6, predict: (r) => analogueNextDist(r.map((x) => x.multiplier)) };
  const off = fullIntelligenceForecast(tape, "all", { extraEngines: [eng], engineStates: { chartlab: "shadow" } });
  const on = fullIntelligenceForecast(tape, "all", { extraEngines: [eng], engineStates: { chartlab: "live" } });
  const c0 = off.intelligence.components.find((c) => c.key === "chartlab");
  const c1 = on.intelligence.components.find((c) => c.key === "chartlab");
  assert.ok(c0 && c1);
  assert.equal(c0.weight, 0);
  assert.ok(c1.weight > 0);
});
