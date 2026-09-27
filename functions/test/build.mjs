// Bundles functions/lib/forecast.ts to .lib-build/forecast.mjs for the node:test suite.
import { build } from "esbuild";
await build({ entryPoints: ["lib/forecast.ts"], bundle: true, format: "esm", platform: "node", outfile: ".lib-build/forecast.mjs", logLevel: "warning" });
