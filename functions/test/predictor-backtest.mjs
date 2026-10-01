// Walk-forward backtest of the full-intelligence headline on a synthetic crash
// tape. Mirrors calibrateIntel(): every round is forecast from strictly earlier
// rounds, the recalibrator is refitted only on forecasts that already resolved.
//
//   node test/build-predictor.mjs && node test/predictor-backtest.mjs [--scenario iid|drift] [--scored 800] [--warmup 1500] [--old path/to/old-intelligence.mjs]
//
// Metrics (lower is better unless noted):
//   logloss   band log-loss of the published distribution
//   covRange  share of rounds inside the headline range (target = profile nominal, loose 0.70)
//   belowExp  share of rounds ≤ expected (true median)   (target 0.50)
//   pinball   mean quantile loss at 0.25 / 0.5 / 0.75 / 0.9
//   crashGap  |mean forecast P(<2x) − observed share|
import { fitRecalibrator } from "../.predictor-build/calibration.mjs";
import { fullIntelligenceForecast } from "../.predictor-build/intelligence.mjs";
import { evaluateLockedHoldout } from "../.predictor-build/robust-evaluation.mjs";
import { selectPointRange, defaultSelection } from "../.predictor-build/point-range.mjs";
import { analogueNextDist } from "../.predictor-build/analogue.mjs";
import { blendAdmission, gatedStates } from "../.predictor-build/engine-gate.mjs";
import { COMPONENTS } from "../.predictor-build/intelligence.mjs";
import { syntheticTape } from "./synthetic.mjs";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const scenario = arg("scenario", "iid");
const scored = Number(arg("scored", 800));
const warmup = Number(arg("warmup", 1500));
const seed = Number(arg("seed", 7));
const profile = arg("profile", "loose");
const NOMINAL = { tight: 0.5, loose: 0.7, wide: 0.8 }[profile] ?? 0.7;
const pointArg = arg("point", "auto");
const rangeArg = arg("range", "auto");
const adaptiveArg = arg("adaptive", "1") !== "0";
const gateMode = arg("gate", "candidates"); // all | candidates | off
const CHARTLAB = { key: "chartlab", label: "Chart Lab analogues", prior: 0.6, predict: (r) => analogueNextDist(r.map((x) => x.multiplier), { window: 30, k: 40 }) };
const gateRows = [];
let gate = null;
let states = {};
const oldPath = arg("old", null);
const old = oldPath ? await import(new URL(oldPath, `file://${process.cwd()}/`).href) : null;
const oldEta = oldPath ? await import(new URL(oldPath.replace(/[^/]+$/, "old-v65.mjs"), `file://${process.cwd()}/`).href).catch(() => null) : null;

const edgeAt = scenario === "drift" ? (i) => 0.05 + 0.04 * Math.sin((2 * Math.PI * i) / 900) : null;
const tape = syntheticTape(warmup + scored, { seed, edge: 0.03, edgeAt });
const bandOf = (x) => [1.5, 2, 5, 10, 100].filter((e) => x >= e).length;
const pin = (q, pred, y) => (y >= pred ? q * (y - pred) : (1 - q) * (pred - y));

const methods = { main: [], calibrated: [], dynamic: [], allEngines: [], gated: [], ...(old ? { oldPredictor: [] } : {}) };
let sel = defaultSelection(NOMINAL, "warm-up");
const samples = [];
let rc = fitRecalibrator([]);
const t0 = Date.now();
for (let i = warmup; i < tape.length; i++) {
  const history = tape.slice(0, i);
  const y = tape[i].multiplier;
  if ((i - warmup) % 10 === 0) {
    rc = fitRecalibrator(samples.slice(-1000));
    sel = selectPointRange(samples.slice(-600), rc, { nominal: NOMINAL, pointMethod: pointArg, intervalMethod: rangeArg, adaptive: adaptiveArg });
    if (gateMode !== "off") {
      const keys = gateMode === "all" ? [...COMPONENTS, "chartlab"] : ["chartlab"];
      gate = blendAdmission(gateRows, keys, { window: 600, minSample: 100, seMultiple: Number(arg("gate-se", 2)) });
      states = gatedStates({}, gate, COMPONENTS, ["chartlab"]);
    }
  }
  const fc = fullIntelligenceForecast(history, "all", { recalibrator: rc, rangeProfile: profile });
  const fm = fullIntelligenceForecast(history, "all", { rangeProfile: profile });
  const fd = fullIntelligenceForecast(history, "all", { recalibrator: rc, rangeProfile: profile, pointRange: sel });
  // Chart Lab always live (ungated) vs gated blend; the ungated run also feeds
  // the gate's ledger rows (every engine scored, chartlab at its earned weight)
  const fa = fullIntelligenceForecast(history, "all", { recalibrator: rc, rangeProfile: profile, pointRange: sel, extraEngines: [CHARTLAB], engineStates: { chartlab: "live" } });
  const fg = fullIntelligenceForecast(history, "all", { recalibrator: rc, rangeProfile: profile, pointRange: sel, extraEngines: [CHARTLAB], engineStates: states });
  const bandOfY = bandOf(y);
  gateRows.push({
    weights: Object.fromEntries(fg.intelligence.components.map((c) => [c.key, c.weight])),
    compLoss: Object.fromEntries(fg.intelligence.components.map((c) => [c.key, -Math.log(Math.max(1e-6, c.distribution[bandOfY]))])),
  });
  const out = { main: fm, calibrated: fc, dynamic: fd, allEngines: fa, gated: fg };
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
      inRange: y >= f.rangeLo && y <= f.rangeHi ? 1 : 0,
      below: y <= f.expectedMultiplier ? 1 : 0,
      pin: (pin(0.25, f.rangeLo, y) + pin(0.5, f.expectedMultiplier, y) + pin(0.75, f.rangeHi, y) + pin(0.9, f.moonshotReach, y)) / 4,
      crash: dist[0] + dist[1],
      sle: (Math.log(y) - Math.log(f.expectedMultiplier)) ** 2,
      ale: Math.abs(Math.log(y) - Math.log(f.expectedMultiplier)),
      iscore: (() => { const a = 1 - NOMINAL, L = Math.log(f.rangeLo), H = Math.log(f.rangeHi), z = Math.log(y); return H - L + (2 / a) * (Math.max(0, L - z) + Math.max(0, z - H)); })(),
      logExp: Math.log(f.expectedMultiplier),
      logWidth: Math.log(f.rangeHi) - Math.log(f.rangeLo),
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
    covRange: +mean(rows.map((r) => r.inRange)).toFixed(3),
    belowExp: +mean(rows.map((r) => r.below)).toFixed(3),
    pinball: +mean(rows.map((r) => r.pin)).toFixed(4),
    crashGap: +Math.abs(mean(rows.map((r) => r.crash)) - mean(rows.map((r) => r.isCrash))).toFixed(4),
    sqLogErr: +mean(rows.map((r) => r.sle)).toFixed(4),
    absLogErr: +mean(rows.map((r) => r.ale)).toFixed(4),
    intervalScore: +mean(rows.map((r) => r.iscore)).toFixed(4),
    // dynamics: how much the headline moves round to round
    expectedSdLog: +Math.sqrt(mean(rows.map((r) => r.logExp ** 2)) - mean(rows.map((r) => r.logExp)) ** 2).toFixed(4),
    meanLogWidth: +mean(rows.map((r) => r.logWidth)).toFixed(4),
  };
}
// locked chronological holdout over the resolved raw distributions: does the
// published forecast beat plain band frequencies on untouched rounds?
const ev = evaluateLockedHoldout(samples, { rangeProfile: profile });
const lockedHoldout = {
  status: ev.status,
  trainingSample: ev.trainingSample,
  holdoutSample: ev.holdoutSample,
  publishedLogLoss: ev.calibratedLogLoss === null ? null : +ev.calibratedLogLoss.toFixed(5),
  baselineLogLoss: ev.baselineLogLoss === null ? null : +ev.baselineLogLoss.toFixed(5),
  baselineSkillPct: ev.baselineSkillPct === null ? null : +ev.baselineSkillPct.toFixed(3),
  meanBrierSkillPct: ev.meanBrierSkillPct === null ? null : +ev.meanBrierSkillPct.toFixed(3),
  coverage50: ev.coverage50 === null ? null : +ev.coverage50.toFixed(3),
  rangeCoverage: ev.rangeCoverage === null ? null : +ev.rangeCoverage.toFixed(3),
  rangeNominal: ev.rangeNominal,
};
console.log(JSON.stringify({ scenario, seed, profile, gate: gate ? { admitted: gate.admitted, excluded: gate.excluded, verdicts: gate.verdicts.map((v) => `${v.key}:${v.status}:${v.gain}±${v.se}`) } : null, finalSelection: { point: sel.pointMethod, interval: sel.intervalMethod, coverage: +sel.coverage.toFixed(4), reason: sel.reason }, warmup, scored, lockedHoldout, finalRecalibrator: { active: rc.active, quantileActive: rc.quantileActive, gamma: rc.gamma, tau: rc.tau, reason: rc.reason }, report }, null, 2));
