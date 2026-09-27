// Tests for functions/lib/forecast.ts (Momento Lib next-event forecaster).
// Run: npm test   (bundles the TS with esbuild, then node --test)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import * as L from "../.lib-build/forecast.mjs";

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Fair two-edge crash law: point mass h0 at 1.00x, S(x) = c / x above. */
function fairRound(r, h0 = 0.039, c = 0.97) {
  if (r() < h0) return 1;
  const m = Math.floor((c / (1 - h0)) * 1.01 / Math.max(1e-9, r()) * 100) / 100;
  return Math.max(1.01, m);
}
function fairTape(n, seed = 1) {
  const r = rng(seed);
  let t = 1.78e12;
  return Array.from({ length: n }, () => ({ multiplier: fairRound(r), tsMs: (t += 20000) }));
}
/** A tape with a real, planted dependence: after a round below 1.2x the next round is >= 2x with p 0.70. */
function plantedTape(n, seed = 2) {
  const r = rng(seed);
  const out = [];
  let prev = 2, t = 1.78e12;
  for (let i = 0; i < n; i++) {
    let m;
    if (prev < 1.2) m = r() < 0.7 ? 2 + Math.floor(r() * 300) / 100 : 1.01 + Math.floor(r() * 98) / 100;
    else m = fairRound(r);
    out.push({ multiplier: m, tsMs: (t += 20000) });
    prev = m;
  }
  return out;
}
const sum = (a) => a.reduce((x, y) => x + y, 0);

test("bins partition the line and survival is coherent", () => {
  assert.equal(L.LIB_BINS, 11);
  assert.equal(L.libBin(1.0), 0);
  assert.equal(L.libBin(1.01), 1);
  assert.equal(L.libBin(1.99), 3);
  assert.equal(L.libBin(2), 4);
  assert.equal(L.libBin(250), 10);
  const f = L.libForecast(fairTape(3000));
  assert.ok(Math.abs(sum(f.bins.map((b) => b.p)) - 1) < 1e-3);
  assert.ok(Math.abs(sum(f.v6Bands) - 1) < 1e-3);
  for (let i = 1; i < f.survival.length; i++) assert.ok(f.survival[i].p <= f.survival[i - 1].p, "survival must fall with x");
  for (const s of f.survival) assert.ok(s.p > 0 && s.p < 1);
  for (let i = 1; i < f.quantiles.length; i++) assert.ok(f.quantiles[i].x >= f.quantiles[i - 1].x, "quantiles must rise with q");
});

test("two-edge fair law fit recovers the house parameters", () => {
  const tape = fairTape(60000, 7);
  const counts = new Array(L.LIB_BINS).fill(0);
  for (const r of tape) counts[L.libBin(r.multiplier)]++;
  const fit = L.fitTwoEdge(counts);
  assert.ok(Math.abs(fit.h0 - 0.039) < 0.004, `h0 ${fit.h0}`);
  const p2 = L.survivalAt(fit.dist, 2);
  const obs2 = tape.filter((r) => r.multiplier >= 2).length / tape.length;
  assert.ok(Math.abs(p2 - obs2) < 0.006, `P(>=2) fit ${p2} vs observed ${obs2}`);
});

test("forecast is causal and deterministic", () => {
  const tape = fairTape(4000, 3);
  const a = L.libForecast(tape.slice(0, 3000));
  const b = L.libForecast(tape.slice(0, 3000));
  assert.deepEqual(a, b);
  // the online forecaster's prediction for round 3000 equals the batch forecast of rounds 0..2999
  const f = new L.LibForecaster();
  for (let i = 0; i < 3000; i++) f.update(tape[i]);
  const d = f.predictDist();
  a.bins.forEach((bin, i) => assert.ok(Math.abs(bin.p - d[i]) < 1e-4));
  // changing a future round cannot change a past forecast
  const tampered = tape.map((r, i) => (i >= 3000 ? { ...r, multiplier: 1000 } : r));
  assert.deepEqual(L.libForecast(tampered.slice(0, 3000)), a);
});

test("on a fair tape the blend is calibrated and never worse than the base rate", () => {
  const rep = L.libBacktest(fairTape(30000, 11), { warmup: 5000 });
  assert.ok(rep.logLoss.skillNats > -0.001, `skill ${rep.logLoss.skillNats}`);
  const t2 = rep.thresholds.find((t) => t.x === 2);
  assert.ok(Math.abs(t2.meanP - t2.hitRate) < 0.012, `mean p ${t2.meanP} vs hit ${t2.hitRate}`);
  for (const c of t2.calibration) assert.ok(Math.abs(c.meanP - c.observed) < 0.03, JSON.stringify(c));
});

test("a real planted signal is found and exploited", () => {
  const rep = L.libBacktest(plantedTape(30000), { warmup: 3000 });
  assert.ok(rep.logLoss.skillNats > 0.01, `skill ${rep.logLoss.skillNats} nats`);
  const t2 = rep.thresholds.find((t) => t.x === 2);
  assert.ok(t2.auc > 0.55, `AUC ${t2.auc}`);
  assert.ok(t2.brierSkillPct > 1, `Brier skill ${t2.brierSkillPct}%`);
  // right after a round below 1.2x the forecast must lift P(>= 2x)
  const tape = plantedTape(20000, 5);
  const i = tape.findLastIndex((r) => r.multiplier < 1.2);
  const f = L.libForecast(tape.slice(0, i + 1));
  const ev = f.nextEvents.find((e) => e.threshold === 2);
  assert.ok(ev.pNext > 0.6, `pNext ${ev.pNext}`);
});

test("next-event probabilities are coherent", () => {
  const f = L.libForecast(fairTape(8000, 9));
  for (const e of f.nextEvents) {
    for (let i = 1; i < e.within.length; i++) assert.ok(e.within[i].p >= e.within[i - 1].p);
    assert.ok(Math.abs(e.within[0].p - e.pNext) < 1e-3);
    assert.ok(e.expectedWait >= 1 && e.medianWait >= 1);
    assert.ok(e.roundsSince >= 0);
  }
  const ten = f.nextEvents.find((e) => e.threshold === 10);
  assert.ok(Math.abs(ten.expectedWait - 1 / ten.pBase) < 2, `wait ${ten.expectedWait} vs 1/p ${1 / ten.pBase}`);
});

test("AUC and reliability helpers", () => {
  assert.equal(L.auc([[0.1, 0], [0.9, 1]]), 1);
  assert.equal(L.auc([[0.9, 0], [0.1, 1]]), 0);
  assert.equal(L.auc([[0.5, 0], [0.5, 1]]), 0.5);
  const rel = L.reliability(Array.from({ length: 100 }, (_, i) => [i / 100, i % 2]), 5);
  assert.equal(rel.length, 5);
});

// Optional: real tape regression. Set MOMENTO_TAPE=/path/master_aviator.csv(.gz)
const TAPE = process.env.MOMENTO_TAPE;
test("real tape: blend is at least as good as the base rate (walk-forward)", { skip: !TAPE && "set MOMENTO_TAPE to run" }, () => {
  const raw = fs.readFileSync(TAPE);
  const lines = (TAPE.endsWith(".gz") ? zlib.gunzipSync(raw) : raw).toString().trim().split("\n");
  const h = lines[0].split(","), mi = h.indexOf("multiplier"), ti = h.indexOf("ts_ms");
  const rounds = lines.slice(1).map((l) => { const c = l.split(","); return { multiplier: +c[mi], tsMs: ti >= 0 ? +c[ti] : undefined }; });
  const rep = L.libBacktest(rounds, { warmup: 5000 });
  assert.ok(rep.logLoss.skillNats > -2 * rep.logLoss.skillSe - 1e-4, JSON.stringify(rep.logLoss));
});
