// stdin: {"module": "...", "calls": [{"fn": "...", "args": [...]}]}  → stdout: JSON results
// Arguments named {"$tape": "<key>"} are replaced by the tape's Round[] array.
import { readFileSync } from "node:fs";
const req = JSON.parse(readFileSync(0, "utf8"));
const mod = await import(new URL(`./.ts-build/${req.module}.mjs`, import.meta.url));
const tapes = req.tapes ?? {};
const fix = (a) => {
  if (a && typeof a === "object" && !Array.isArray(a) && a.$tape) return tapes[a.$tape];
  if (a && typeof a === "object" && !Array.isArray(a) && "$const" in a) return () => a.$const;
  if (a && typeof a === "object" && !Array.isArray(a) && a.$params) return new URLSearchParams(a.$params);
  if (a && typeof a === "object" && !Array.isArray(a) && a.$obj) return Object.fromEntries(Object.entries(a.$obj).map(([k, v]) => [k, fix(v)]));
  return Array.isArray(a) ? a.map(fix) : a;
};
const out = [];
for (const c of req.calls) {
  try {
    let fn = mod;
    for (const part of c.fn.split(".")) fn = fn[part];
    const r = typeof fn === "function" ? fn(...(c.args ?? []).map(fix)) : fn;
    out.push({ ok: true, value: r === undefined ? null : r });
  } catch (e) {
    out.push({ ok: false, error: String(e && e.message || e) });
  }
}
process.stdout.write(JSON.stringify(out));
