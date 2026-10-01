// Bundles the pure forecasting modules to .predictor-build/ for the node:test
// suite and the walk-forward backtest (no Cloudflare runtime needed).
import { build } from "esbuild";
await build({
  entryPoints: { calibration: "calibration.ts", intelligence: "intelligence.ts", v65: "v65.ts", "robust-evaluation": "robust-evaluation.ts", "point-range": "point-range.ts", analogue: "analogue.ts", "engine-gate": "engine-gate.ts" },
  bundle: true,
  format: "esm",
  platform: "node",
  outdir: ".predictor-build",
  outExtension: { ".js": ".mjs" },
  logLevel: "warning",
});
