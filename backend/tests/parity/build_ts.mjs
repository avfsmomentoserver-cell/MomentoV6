// Bundles every pure archived TS module so parity tests can call them.
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../archive/backend-ts-v6.5/package.json", import.meta.url));
const { build } = require("esbuild");
import { fileURLToPath } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../../../archive/backend-ts-v6.5");
const mods = ["analysis", "calibration", "intelligence", "robust-evaluation", "point-range", "analogue", "engine-gate", "pipeline", "momentum", "fx", "v64", "v65"];
await build({
  entryPoints: Object.fromEntries(mods.map((m) => [m, path.join(src, m + ".ts")])),
  bundle: true, format: "esm", platform: "node",
  outdir: path.join(here, ".ts-build"), outExtension: { ".js": ".mjs" }, logLevel: "error",
  external: ["cloudflare:*"],
  nodePaths: [path.join(src, "node_modules")],
});
