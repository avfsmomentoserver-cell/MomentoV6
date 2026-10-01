// Walk-forward backtest of the full-intelligence headline on a synthetic crash
// tape. Mirrors calibrateIntel(): every round is forecast from strictly earlier
// rounds, the recalibrator is refitted only on forecasts that already resolved.
//
//   node test/build-predictor.mjs && node test/predictor-backtest.mjs [--scenario iid|drift] [--scored 800] [--warmup 1500] [--old path/to/old-intelligence.mjs]
//
// Metrics (lower is better unless noted):
//   logloss   band log-loss of the published distribution
//   cov50     share of rounds inside p25–p75            (target 0.50)
//   belowExp  share of rounds ≤ expected (true median)   (target 0.50)
//   pinball   mean quantile loss at 0.25 / 0.5 / 0.75 / 0.9
//   crashGap  |mean forecast P(<2x) − observed share|
import { fitRecalibrator } from "../.predictor-build/calibration.mjs";
import { fullIntelligenceForecast } from "../.predictor-build/intelligence.mjs";
import { syntheticTape } from "./synthetic.mjs";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const scenario = arg("scenario", "iid");
const scored = Number(arg("scored", 800));
const warmup = Number(arg("warmup", 1500));
const seed = Number(arg("seed", 7));
const oldPath = arg("old", null);
const old = oldPath ? await import(new URL(oldPath, `file://${process.cwd()}/`).href) : null;
const oldEta = oldPath ? await import(new URL(oldPath.replace(/[^/]+$/, "old-v65.mjs"), `file://${process.cwd()}/`).href).catch(() => null) : null;

const edgeAt = scenario === "drift" ? (i) => 0.05 + 0.04 * Math.sin((2 * Math.PI * i) / 900) : null;
const tape = syntheticTape(warmup + scored, { seed, edge: 0.03, edgeAt });
const bandOf = (x) => [1.5, 2, 5, 10, 100].filter((e) => x >= e).length;
const pin = (q, pred, y) => (y >= pred ? q * (y - pred) : (1 - q) * (pred - y));

const methods = { main: [], calibrated: [], ...(old ? { oldPredictor: [] } : {}) };
const samples = [];
let rc = fitRecalibrator([]);
const t0 = Date.now();
for (let i = warmup; i < tape.length; i++) {
  const history = tape.slice(0, i);
  const y = tape[i].multiplier;
  if ((i - warmup) % 10 === 0) rc = fitRecalibrator(samples.slice(-1000));
  const fc = fullIntelligenceForecast(history, "all", { recalibrator: rc });
  const fm = fullIntelligenceForecast(history, "all");
  const out = { main: fm, calibrated: fc };
  if (old) {
    let etaMedian;
    try {
      etaMedian = oldEta?.etaBoard(history, { thresholds: [10] }).rows.find((r) => r.threshold === 10)?.etaMedian;
    } catch {}
    let f = old.fullIntelligenceForecast(history, "all", { etaMedian, coneSpread: 1 });
    if (oldEta) {
      const dist = f.distribution.map((d) => d.probability);
      const p25 = oldEta.quantileFromDist(dist, 0.25), p50 = oldEta.quantileFromDist(dist, 0.5), p90 = oldEta.quantileFromDist(dist, 0.9);
      const spread = Math.max(0.8, Math.min(2, p50 > 0 ? (p90 - p25) / p50 : 1));
      if (Math.abs(spread - 1) > 0.1) f = old.fullIntelligenceForecast(history, "all", { etaMedian, coneSpread: spread });
    }
    out.oldPredictor = f;
  }
  for (const [k, f] of Object.entries(out)) {
    const dist = f.distribution.map((d) => d.probability);
    methods[k].push({
      ll: -Math.log(Math.max(1e-6, dist[bandOf(y)])),
      in50: y >= f.rangeLo && y <= f.rangeHi ? 1 : 0,
      below: y <= f.expectedMultiplier ? 1 : 0,
      pin: (pin(0.25, f.rangeLo, y) + pin(0.5, f.expectedMultiplier, y) + pin(0.75, f.rangeHi, y) + pin(0.9, f.moonshotReach, y)) / 4,
      crash: dist[0] + dist[1],
      isCrash: y < 2 ? 1 : 0,
    });
  }
  samples.push({ dist: fc.rawDistribution, actual: y });
  if ((i - warmup) % 100 === 99) console.error(`  ${i - warmup + 1}/${scored} rounds · ${((Date.now() - t0) / 1000).toFixed(0)}s · recal ${rc.active ? "on" : "off"}/${rc.quantileActive ? "on" : "off"}`);
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const report = {};
for (const [k, rows] of Object.entries(methods)) {
  report[k] = {
    logloss: +mean(rows.map((r) => r.ll)).toFixed(4),
    cov50: +mean(rows.map((r) => r.in50)).toFixed(3),
    belowExp: +mean(rows.map((r) => r.below)).toFixed(3),
    pinball: +mean(rows.map((r) => r.pin)).toFixed(4),
    crashGap: +Math.abs(mean(rows.map((r) => r.crash)) - mean(rows.map((r) => r.isCrash))).toFixed(4),
  };
}
console.log(JSON.stringify({ scenario, seed, warmup, scored, finalRecalibrator: { active: rc.active, quantileActive: rc.quantileActive, gamma: rc.gamma, tau: rc.tau, reason: rc.reason }, report }, null, 2));
