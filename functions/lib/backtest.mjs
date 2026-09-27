// Walk-forward backtest of functions/lib/forecast.ts on a CSV tape.
// Usage: node lib/backtest.mjs <tape.csv[.gz]> [--last N] [--shuffle] [--out report.json]
// CSV needs a `multiplier` column; `ts_ms` (epoch ms) is used for timing features when present.
import fs from "node:fs";
import zlib from "node:zlib";
import { build } from "esbuild";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const outFile = path.join(here, "..", ".lib-build", "forecast.mjs");
await build({ entryPoints: [path.join(here, "forecast.ts")], bundle: true, format: "esm", platform: "node", outfile: outFile, logLevel: "silent" });
const L = await import(url.pathToFileURL(outFile).href);

const args = process.argv.slice(2);
const file = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const raw = fs.readFileSync(file);
const text = (file.endsWith(".gz") ? zlib.gunzipSync(raw) : raw).toString().trim().split("\n");
const head = text[0].split(",");
const mi = head.indexOf("multiplier"), ti = head.indexOf("ts_ms");
let rounds = text.slice(1).map((l) => { const c = l.split(","); return { multiplier: +c[mi], tsMs: ti >= 0 ? +c[ti] : undefined }; }).filter((r) => isFinite(r.multiplier));
if (args.includes("--shuffle")) {
  let s = 12345; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const ms = rounds.map((r) => r.multiplier);
  for (let i = ms.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ms[i], ms[j]] = [ms[j], ms[i]]; }
  rounds = rounds.map((r, i) => ({ ...r, multiplier: ms[i] }));
}
const last = +opt("--last", 0);
const warmup = +opt("--warmup", 0) || (last ? Math.max(0, rounds.length - last) : undefined);
const t0 = Date.now();
const rep = L.libBacktest(rounds, { warmup });
const fc = L.libForecast(rounds);
const out = { tape: path.basename(file), shuffled: args.includes("--shuffle"), totalRounds: rounds.length, seconds: (Date.now() - t0) / 1000, backtest: rep, nextForecast: fc };
if (opt("--out")) fs.writeFileSync(opt("--out"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
