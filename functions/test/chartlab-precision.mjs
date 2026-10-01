// Walk-forward precision test of Chart Lab (analogue) projections on synthetic
// tapes. node test/build-predictor.mjs && node test/chartlab-precision.mjs
import { chartLabPrecision } from "../.predictor-build/analogue.mjs";
import { syntheticTape, mulberry32, crashDraw } from "./synthetic.mjs";

// a tape WITH real structure: after 3 low rounds the next round is drawn with a
// much smaller edge (a planted, learnable pattern) — positive control
function plantedTape(n, seed) {
  const r = mulberry32(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const low3 = i >= 3 && out[i - 1] < 1.5 && out[i - 2] < 1.5 && out[i - 3] < 1.5;
    out.push(crashDraw(r, low3 ? -1.5 : 0.03));
  }
  return out;
}
const cases = {
  iid: syntheticTape(6000, { seed: 7 }).map((r) => r.multiplier),
  drift: syntheticTape(6000, { seed: 11, edgeAt: (i) => 0.05 + 0.04 * Math.sin((2 * Math.PI * i) / 900) }).map((r) => r.multiplier),
  planted: plantedTape(6000, 5),
};
const out = {};
for (const [k, m] of Object.entries(cases)) out[k] = chartLabPrecision(m, { anchors: 120, window: Number(process.argv[2] ?? 30), horizon: 20, k: 40 });
console.log(JSON.stringify(out, null, 2));
