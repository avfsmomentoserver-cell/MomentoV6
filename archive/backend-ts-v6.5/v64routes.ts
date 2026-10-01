// functions/v64routes.ts — V6.4 endpoints mounted inside the MomentoCore DO.
//
// Two-tier compute model
//   deep tier   scheduled jobs (DO alarm) run the long, full-history scans
//               (DNA k-mer tables, linguistics, vocabulary discovery, shape
//               ledger, AI summary) and persist results in deep_results.
//   live tier   every request / new round overlays the newest rounds on the
//               latest deep result — O(new rounds), never a full rescan.
// The live pulse endpoint lets every open dashboard refetch the moment a new
// round lands, so every stat updates in real time.

import type { Round } from "./analysis";
import {
  ALPHABETS,
  applyRange,
  discoverPhrases,
  dnaOverlay,
  dnaScan,
  fitCadence,
  hueOf,
  investigateRange,
  investigateRound,
  linguisticsV2,
  nameShape,
  parseTopRounds,
  planReconstruction,
  projectShape,
  rangeFromQuery,
  scopeKey,
  scoreProjection,
  spreadSpan,
  type Alphabet,
  type CalibRow,
  type DnaScan,
} from "./v64";

type Rows = Record<string, unknown>;
type Sql = {
  exec: (q: string, ...b: unknown[]) => { toArray: () => unknown[]; rowsWritten?: number };
};

export interface CoreAdapter {
  sql: Sql;
  env: Record<string, unknown>;
  roundsFor: (source: string | null, opts?: { includeReconstructed?: boolean }) => Round[];
  invalidate: () => void;
  setting: (k: string) => string | null;
  setSetting: (k: string, v: string) => void;
  tableStats: () => { maxId: number; count: number };
  ingest: (source: string, method: string, rows: unknown[], origin?: string) => { inserted: number; rejected: number };
  rebuildSessions: (source: string) => void;
  intel: (rounds: Round[], source: string) => Record<string, unknown>;
  audit: (actor: string, action: string, target?: string, meta?: unknown) => void;
  analysis: (source: string | null) => Record<string, unknown>;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const ok = (data: unknown) => json({ ok: true, data });
const fail = (error: string, status = 400) => json({ ok: false, error }, status);
const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity) => {
  if (v === null || v === undefined || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const tz = (a: CoreAdapter) => num(a.setting("tz_offset_min"), 120, -720, 840);

// ------------------------------------------------------------------ schema

export function initV64Schema(sql: Sql): void {
  try {
    sql.exec("ALTER TABLE rounds ADD COLUMN origin TEXT NOT NULL DEFAULT 'observed'");
  } catch {
    /* column exists */
  }
  sql.exec(`
    CREATE INDEX IF NOT EXISTS idx_rounds_origin ON rounds (origin, ts_ms);
    CREATE INDEX IF NOT EXISTS idx_rounds_mult ON rounds (multiplier);
    CREATE TABLE IF NOT EXISTS deep_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      kind TEXT NOT NULL,
      params TEXT NOT NULL DEFAULT '{}',
      every_min INTEGER NOT NULL DEFAULT 30,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_ms INTEGER,
      last_duration_ms INTEGER,
      last_status TEXT,
      created_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deep_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER,
      kind TEXT NOT NULL,
      params TEXT NOT NULL,
      payload TEXT NOT NULL,
      rounds INTEGER NOT NULL,
      max_id INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_deep_results_job ON deep_results (job_id, created_ms DESC);
    CREATE TABLE IF NOT EXISTS shape_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anchor_round_id INTEGER NOT NULL,
      anchor_ts_ms INTEGER NOT NULL,
      window INTEGER NOT NULL,
      horizon INTEGER NOT NULL,
      name TEXT NOT NULL,
      family TEXT NOT NULL,
      payload TEXT NOT NULL,
      mu REAL NOT NULL,
      start_level REAL NOT NULL,
      resolved_ms INTEGER,
      actual_name TEXT,
      mae_model REAL,
      mae_base REAL,
      skill REAL,
      coverage REAL,
      created_ms INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_shape_anchor ON shape_predictions (anchor_round_id, window, horizon);
    CREATE TABLE IF NOT EXISTS ai_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL,
      max_id INTEGER NOT NULL,
      rounds INTEGER NOT NULL,
      headline TEXT,
      content TEXT NOT NULL,
      metrics TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_ms INTEGER NOT NULL
    );
  `);
  const now = Date.now();
  const seed: [string, string, Record<string, unknown>, number, number][] = [
    ["DNA · bands → next ≥2x", "dna", { alphabet: "band", kMin: 2, kMax: 6, targetLo: 2, targetHi: 1e9, minSupport: 40 }, 20, 1],
    ["DNA · colours → next pink", "dna", { alphabet: "hue", kMin: 2, kMax: 9, targetLo: 10, targetHi: 1e9, minSupport: 40 }, 20, 1],
    ["DNA · tempo → next ≥2x", "dna", { alphabet: "tempo", kMin: 2, kMax: 5, targetLo: 2, targetHi: 1e9, minSupport: 40 }, 45, 1],
    ["Linguistics · full history", "linguistics", { depth: 240 }, 15, 1],
    ["Vocabulary · discover + evaluate", "vocabulary", { minCount: 25 }, 60, 1],
    ["Chart predictions · project + score", "shape", { window: 30, horizon: 20, k: 40 }, 5, 1],
    ["AI forecast summary", "ai", {}, 30, 1],
    ["Gap reconstruction", "reconstruct", { minGapSec: 120, maxGapHours: 8, maxFillPerGap: 2000 }, 360, 0],
  ];
  for (const [name, kind, params, every, enabled] of seed) {
    sql.exec("INSERT INTO deep_jobs (name, kind, params, every_min, enabled, created_ms) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO NOTHING", name, kind, JSON.stringify(params), every, enabled, now);
  }
}

// ------------------------------------------------------------ round filters

interface PageFilter {
  where: string;
  args: unknown[];
}
function roundFilter(q: URLSearchParams): PageFilter {
  const w: string[] = [];
  const a: unknown[] = [];
  const source = q.get("source");
  if (source && source !== "all") {
    w.push("source = ?");
    a.push(source);
  }
  const ranges = (q.get("ranges") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      // "1-2", "10-" (open-ended), "10+" , "-2"
      const m = s.replace("+", "-").split("-");
      const lo = m[0] === "" ? 0 : Number(m[0]);
      const hi = m.length < 2 || m[1] === "" ? 1e12 : Number(m[1]);
      return [lo, hi];
    })
    .filter((p) => p.every(Number.isFinite) && p[1] > p[0]);
  if (ranges.length) {
    w.push("(" + ranges.map(() => "(multiplier >= ? AND multiplier < ?)").join(" OR ") + ")");
    for (const [lo, hi] of ranges) a.push(lo, hi);
  }
  const minX = q.get("minX");
  const maxX = q.get("maxX");
  if (minX) {
    w.push("multiplier >= ?");
    a.push(Number(minX));
  }
  if (maxX) {
    w.push("multiplier < ?");
    a.push(Number(maxX));
  }
  const hue = q.get("hue");
  if (hue === "blue") w.push("multiplier < 2");
  else if (hue === "purple") w.push("multiplier >= 2 AND multiplier < 10");
  else if (hue === "pink") w.push("multiplier >= 10");
  const ingest = q.get("ingest");
  if (ingest && ingest !== "all") {
    w.push("ingest = ?");
    a.push(ingest);
  }
  const origin = q.get("origin");
  if (origin && origin !== "all") {
    if (origin === "real") w.push("origin != 'reconstructed'");
    else {
      w.push("origin = ?");
      a.push(origin);
    }
  }
  const session = q.get("session");
  if (session && session !== "all") {
    w.push("session_id = ?");
    a.push(Number(session));
  }
  const t = (k: string) => {
    const v = q.get(k);
    if (!v) return null;
    const n = Number(v);
    if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000;
    const p = Date.parse(v);
    return Number.isNaN(p) ? null : p;
  };
  const from = t("from");
  const to = t("to");
  if (from) {
    w.push("ts_ms >= ?");
    a.push(from);
  }
  if (to) {
    w.push("ts_ms <= ?");
    a.push(to);
  }
  return { where: w.length ? "WHERE " + w.join(" AND ") : "", args: a };
}

// ---------------------------------------------------------- deep execution

function latestResult(sql: Sql, jobId: number): Rows | null {
  return (sql.exec("SELECT * FROM deep_results WHERE job_id = ? ORDER BY created_ms DESC LIMIT 1", jobId).toArray()[0] as Rows) ?? null;
}

function dnaFromParams(rounds: Round[], p: Record<string, unknown>, cadence: ReturnType<typeof fitCadence>): DnaScan {
  const alphabet = (Object.keys(ALPHABETS).includes(String(p.alphabet)) ? p.alphabet : "band") as Alphabet;
  const lo = num(p.targetLo, 2, 1, 1e9);
  const hi = num(p.targetHi, 1e9, lo, 1e12);
  return dnaScan(rounds, {
    alphabet,
    kMin: num(p.kMin, 2, 1, 12),
    kMax: num(p.kMax, 6, 1, 14),
    target: { lo, hi, label: hi >= 1e9 ? `≥${lo}x` : `${lo}–${hi}x` },
    minSupport: num(p.minSupport, 30, 1, 1e6),
    pivot: num(p.pivot, 2, 1.01, 1e6),
    limit: num(p.limit, 40, 5, 200),
    cadence,
  });
}

export async function runJob(a: CoreAdapter, job: Rows): Promise<Record<string, unknown>> {
  const started = Date.now();
  const params = JSON.parse((job.params as string) || "{}") as Record<string, unknown>;
  const kind = job.kind as string;
  const source = (params.source as string) || null;
  const rounds = applyRange(a.roundsFor(source), {
    fromMs: params.fromMs as number | null,
    toMs: params.toMs as number | null,
    minX: params.minX as number | null,
    maxX: params.maxX as number | null,
    lastN: params.lastN as number | null,
  });
  const cadence = fitCadence(a.roundsFor(source, { includeReconstructed: false }));
  let payload: Record<string, unknown> = {};
  let status = "ok";
  try {
    if (kind === "dna") payload = dnaFromParams(rounds, params, cadence) as unknown as Record<string, unknown>;
    else if (kind === "linguistics") payload = linguisticsV2(rounds, num(params.depth, 240, 20, 2000), cadence) as unknown as Record<string, unknown>;
    else if (kind === "vocabulary") payload = vocabularyCycle(a, rounds, num(params.minCount, 25, 5, 10000));
    else if (kind === "shape") payload = shapeCycle(a, source, num(params.window, 30, 8, 200), num(params.horizon, 20, 3, 200), num(params.k, 40, 5, 500));
    else if (kind === "ai") payload = await aiSummary(a, false);
    else if (kind === "reconstruct") payload = reconstruct(a, { ...params, dryRun: false });
    else status = "unknown kind";
  } catch (e) {
    status = "error: " + (e instanceof Error ? e.message : String(e));
  }
  const duration = Date.now() - started;
  const stats = a.tableStats();
  if (status === "ok") {
    a.sql.exec(
      "INSERT INTO deep_results (job_id, kind, params, payload, rounds, max_id, duration_ms, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      job.id ?? null, kind, JSON.stringify(params), JSON.stringify(payload), rounds.length, stats.maxId, duration, Date.now(),
    );
    // keep the 5 most recent results per job
    if (job.id) a.sql.exec("DELETE FROM deep_results WHERE job_id = ? AND id NOT IN (SELECT id FROM deep_results WHERE job_id = ? ORDER BY created_ms DESC LIMIT 5)", job.id, job.id);
  }
  if (job.id) a.sql.exec("UPDATE deep_jobs SET last_run_ms = ?, last_duration_ms = ?, last_status = ? WHERE id = ?", Date.now(), duration, status, job.id);
  return { status, duration, kind };
}

let deepBusy = false;
/** Called by the DO alarm (and the local-dev scheduler): runs every due job. */
export async function deepTick(a: CoreAdapter): Promise<{ ran: string[] }> {
  if (deepBusy) return { ran: [] };
  deepBusy = true;
  const ran: string[] = [];
  try {
    const jobs = a.sql.exec("SELECT * FROM deep_jobs WHERE enabled = 1 ORDER BY id").toArray() as Rows[];
    const now = Date.now();
    for (const j of jobs) {
      const due = !j.last_run_ms || now - (j.last_run_ms as number) >= (j.every_min as number) * 60_000;
      if (!due) continue;
      if (j.kind === "ai" && !aiKey(a)) continue;
      await runJob(a, j);
      ran.push(j.name as string);
    }
  } finally {
    deepBusy = false;
  }
  return { ran };
}

// ----------------------------------------------------------- vocabulary v2

function vocabularyCycle(a: CoreAdapter, rounds: Round[], minCount: number) {
  const cands = discoverPhrases(rounds, minCount);
  const now = Date.now();
  let added = 0;
  let updated = 0;
  for (const c of cands) {
    const status = Math.abs(c.z) >= 3 && c.uses >= 100 ? "validated" : "candidate";
    const res = a.sql.exec(
      `INSERT INTO vocabulary (token, layer, layers, definition, status, uses, hits, misses, score, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET definition = excluded.definition, uses = excluded.uses, hits = excluded.hits, misses = excluded.misses, score = excluded.score,
         status = CASE WHEN vocabulary.status IN ('formalized','deprecated') THEN vocabulary.status ELSE excluded.status END, updated_ms = excluded.updated_ms`,
      c.token, c.layer, JSON.stringify(c.layers), c.definition, status, c.uses, c.hits, c.misses, c.score, now, now,
    );
    if ((res.rowsWritten ?? 0) > 0) updated++;
  }
  added = cands.length;
  return { discovered: added, written: updated, top: cands.slice(0, 20) };
}

// ------------------------------------------------------------ shape ledger

function shapeCycle(a: CoreAdapter, source: string | null, window: number, horizon: number, k: number) {
  const all = a.roundsFor(source);
  const cadence = fitCadence(a.roundsFor(source, { includeReconstructed: false }));
  const proj = projectShape(all, { window, horizon, k, cadence, tzOffsetMin: tz(a) });
  let recorded = false;
  if (proj) {
    const mu = all.reduce((s, r) => s + Math.min(Math.log(Math.max(1, r.multiplier)), Math.log(1000)), 0) / all.length;
    const res = a.sql.exec(
      "INSERT OR IGNORE INTO shape_predictions (anchor_round_id, anchor_ts_ms, window, horizon, name, family, payload, mu, start_level, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      proj.anchorRoundId, proj.anchorTsMs, window, horizon, proj.name, proj.family,
      JSON.stringify({ path: proj.path, baselinePath: proj.baselinePath }), mu, proj.currentShape.path[proj.currentShape.path.length - 1], Date.now(),
    );
    recorded = (res.rowsWritten ?? 0) > 0;
  }
  const scored = scoreShapes(a, all);
  return { recorded, scored, name: proj?.name ?? null };
}

/**
 * ShapeShifter gallery: the current named shape at several windows, and for
 * every shape family its historical frequency and what followed it
 * (P(≥2x) next round, P(≥10x) within `follow` rounds) vs the base rates.
 */
function shapeGallery(all: Round[], follow: number) {
  const L = all.map((r) => Math.min(Math.log(Math.max(1, r.multiplier)), Math.log(1000)));
  const mu = L.reduce((x, y) => x + y, 0) / Math.max(1, L.length);
  const pathAt = (end: number, w: number) => {
    const out = [0];
    for (let i = end - w + 1; i <= end; i++) out.push(out[out.length - 1] + (L[i] - mu));
    return out.map((v) => Math.round(v * 1e4) / 1e4);
  };
  const base2 = all.filter((r) => r.multiplier >= 2).length / Math.max(1, all.length);
  const base10 = 1 - Math.pow(1 - all.filter((r) => r.multiplier >= 10).length / Math.max(1, all.length), follow);
  const windows = [12, 20, 30, 50, 80].filter((w) => all.length > w + 5);
  const current = windows.map((w) => ({ window: w, ...nameShape(pathAt(all.length - 1, w)), path: pathAt(all.length - 1, w) }));
  const stats = new Map<string, { name: string; family: string; description: string; n: number; next2: number; ten: number; example: number[] }>();
  const w = 30;
  for (let end = w; end < all.length - follow - 1; end += 5) {
    const path = pathAt(end, w);
    const sh = nameShape(path);
    const st = stats.get(sh.name) ?? { ...sh, n: 0, next2: 0, ten: 0, example: path };
    st.n++;
    if (all[end + 1].multiplier >= 2) st.next2++;
    if (all.slice(end + 1, end + 1 + follow).some((r) => r.multiplier >= 10)) st.ten++;
    stats.set(sh.name, st);
  }
  const total = [...stats.values()].reduce((x, y) => x + y.n, 0) || 1;
  const families = [...stats.values()]
    .map((st) => ({
      name: st.name, family: st.family, description: st.description, samples: st.n, share: Math.round((st.n / total) * 1e4) / 1e4,
      nextGe2: Math.round((st.next2 / st.n) * 1e4) / 1e4, pinkWithin: Math.round((st.ten / st.n) * 1e4) / 1e4,
      liftGe2: Math.round((st.next2 / st.n / Math.max(1e-9, base2)) * 100) / 100, liftPink: Math.round((st.ten / st.n / Math.max(1e-9, base10)) * 100) / 100,
      example: st.example,
    }))
    .sort((x, y) => y.samples - x.samples);
  return { current, families, base: { ge2: Math.round(base2 * 1e4) / 1e4, pinkWithin: Math.round(base10 * 1e4) / 1e4, follow }, sampledWindow: w, analysed: all.length };
}

function scoreShapes(a: CoreAdapter, all: Round[]): number {
  const pending = a.sql.exec("SELECT * FROM shape_predictions WHERE resolved_ms IS NULL ORDER BY anchor_ts_ms ASC LIMIT 200").toArray() as Rows[];
  let scored = 0;
  for (const p of pending) {
    const idx = all.findIndex((r) => r.id === p.anchor_round_id);
    if (idx < 0) continue;
    const after = all.slice(idx + 1, idx + 1 + (p.horizon as number)).filter((r) => (r as Round & { origin?: string }).origin !== "reconstructed");
    if (after.length < (p.horizon as number)) continue;
    const stored = JSON.parse(p.payload as string);
    const s = scoreProjection(stored, after, p.mu as number, p.start_level as number);
    if (!s) continue;
    a.sql.exec("UPDATE shape_predictions SET resolved_ms = ?, mae_model = ?, mae_base = ?, skill = ?, coverage = ?, payload = ? WHERE id = ?", Date.now(), s.maeModel, s.maeBase, s.skill, s.iqrCoverage, JSON.stringify({ ...stored, actual: s.actual }), p.id);
    scored++;
  }
  return scored;
}

function shapeLedger(a: CoreAdapter) {
  const rows = a.sql.exec("SELECT id, anchor_ts_ms, window, horizon, name, family, resolved_ms, mae_model, mae_base, skill, coverage FROM shape_predictions ORDER BY anchor_ts_ms DESC LIMIT 200").toArray() as Rows[];
  const res = rows.filter((r) => r.resolved_ms);
  const mean = (k: string) => (res.length ? res.reduce((s, r) => s + (r[k] as number), 0) / res.length : null);
  const byName = new Map<string, { n: number; skill: number }>();
  for (const r of res) {
    const b = byName.get(r.name as string) ?? { n: 0, skill: 0 };
    b.n++;
    b.skill += r.skill as number;
    byName.set(r.name as string, b);
  }
  return {
    total: rows.length,
    resolved: res.length,
    pending: rows.length - res.length,
    maeModel: mean("mae_model"),
    maeBase: mean("mae_base"),
    skill: mean("mae_model") !== null && mean("mae_base") ? 1 - (mean("mae_model") as number) / (mean("mae_base") as number) : null,
    coverage: mean("coverage"),
    byName: [...byName.entries()].map(([name, v]) => ({ name, n: v.n, skill: v.skill / v.n })).sort((x, y) => y.n - x.n),
    recent: rows.slice(0, 40),
  };
}

// --------------------------------------------------------- reconstruction

function capLookup(a: CoreAdapter, source: string | null) {
  // A full top-20 list for a period is an upper bound on every unlisted round of that period.
  const rows = a.sql.exec(
    `SELECT scope, scope_key, MIN(multiplier) AS floor, COUNT(*) AS n FROM top_rounds WHERE scope IN ('day','month','year') ${source ? "AND source = ?" : ""} GROUP BY scope, scope_key`,
    ...(source ? [source] : []),
  ).toArray() as Rows[];
  const map = new Map<string, number>();
  for (const r of rows) if ((r.n as number) >= 10) map.set(`${r.scope}:${r.scope_key}`, r.floor as number);
  const offset = tz(a);
  return (ts: number) => {
    const caps = (["day", "month", "year"] as const).map((s) => map.get(`${s}:${scopeKey(s, ts, offset)}`)).filter((v): v is number => v !== undefined);
    return caps.length ? Math.min(...caps) : null;
  };
}

export function reconstruct(a: CoreAdapter, p: Record<string, unknown>) {
  const sources = p.source && p.source !== "all" ? [String(p.source)] : (a.sql.exec("SELECT DISTINCT source FROM rounds WHERE origin != 'reconstructed'").toArray() as Rows[]).map((r) => r.source as string);
  const report: Record<string, unknown>[] = [];
  let inserted = 0;
  let anchorsPlaced = 0;
  for (const src of sources) {
    const observed = a.roundsFor(src, { includeReconstructed: false }).filter((r) => (r as Round & { origin?: string }).origin !== "anchor");
    const anchors = (a.sql.exec("SELECT ts_ms AS tsMs, multiplier FROM rounds WHERE source = ? AND origin = 'anchor'", src).toArray() as { tsMs: number; multiplier: number }[]);
    const plan = planReconstruction(observed, anchors, capLookup(a, src), {
      minGapSec: num(p.minGapSec, 120, 30, 86_400),
      maxGapHours: num(p.maxGapHours, 8, 0.1, 240),
      maxFillPerGap: num(p.maxFillPerGap, 2000, 1, 20_000),
      seed: num(p.seed, 20260926, 0, 2 ** 31),
      fromMs: (p.fromMs as number) ?? null,
      toMs: (p.toMs as number) ?? null,
    });
    const fills = plan.rounds.filter((r) => r.origin === "reconstructed");
    if (!p.dryRun && fills.length) {
      // replace any earlier reconstruction for this source so reruns are idempotent
      a.sql.exec("DELETE FROM rounds WHERE source = ? AND origin = 'reconstructed'", src);
      const now = Date.now();
      for (const r of fills) {
        const res = a.sql.exec(
          "INSERT OR IGNORE INTO rounds (ts, ts_ms, multiplier, color, source, session_id, ingest, created_ms, origin) VALUES (?, ?, ?, ?, ?, NULL, 'reconstruct', ?, 'reconstructed')",
          new Date(r.tsMs).toISOString(), r.tsMs, r.multiplier, hueOf(r.multiplier), src, now,
        );
        inserted += res.rowsWritten ?? 0;
      }
    }
    anchorsPlaced += plan.gaps.reduce((s, g) => s + g.anchors, 0);
    report.push({
      source: src,
      cadence: plan.cadence,
      gaps: plan.gaps.length,
      fills: fills.length,
      anchors: plan.gaps.reduce((s, g) => s + g.anchors, 0),
      largest: [...plan.gaps].sort((x, y) => y.gapSec - x.gapSec).slice(0, 25),
    });
  }
  if (!p.dryRun) a.invalidate();
  return { dryRun: !!p.dryRun, inserted, anchorsPlaced, sources: report };
}

// ------------------------------------------------------------- AI summary

function aiKey(a: CoreAdapter): string | null {
  return (a.env?.ENTRIM_API_KEY as string) || a.setting("entrim_api_key") || null;
}

function metricsBundle(a: CoreAdapter) {
  const all = a.roundsFor(null);
  const real = a.roundsFor(null, { includeReconstructed: false });
  const cadence = fitCadence(real);
  const intel = a.intel(all, "all") as Record<string, unknown>;
  const intelligence = (intel.intelligence ?? {}) as Record<string, unknown>;
  const analysis = a.analysis(null) as Record<string, Record<string, unknown>>;
  const proj = projectShape(all, { window: 30, horizon: 20, k: 40, cadence, tzOffsetMin: tz(a) });
  const ling = linguisticsV2(all.slice(-5000), 40, cadence);
  const dna = dnaScan(all.slice(-20000), { alphabet: "hue", kMin: 2, kMax: 7, target: { lo: 10, hi: 1e9, label: "≥10x" }, minSupport: 40, limit: 5 });
  const ledger = shapeLedger(a);
  const recon = (a.sql.exec("SELECT origin, COUNT(*) AS n FROM rounds GROUP BY origin").toArray() as Rows[]).map((r) => ({ origin: r.origin, n: r.n }));
  const last = all.slice(-20).map((r) => r.multiplier);
  return {
    generatedAt: new Date().toISOString(),
    rounds: { total: all.length, real: real.length, byOrigin: recon, last20: last },
    nextRound: {
      state: intel.state,
      expected: intel.expectedMultiplier,
      range: [intel.rangeLo, intel.rangeHi],
      reach: intel.moonshotReach,
      confidence: intel.confidence,
      confidenceLabel: intel.confidenceLabel,
      candidates: ((intel.candidates as Rows[]) ?? []).slice(0, 3),
      skillPctVsBaseline: intelligence.skillPct,
      calibratedHitRate: intelligence.calibratedHitRate,
      calibrationSample: intelligence.calibrationSample,
      independence: intelligence.independence,
      engines: ((intelligence.components as Rows[]) ?? []).map((c) => ({ key: c.key, weight: c.weight })),
    },
    shape: proj ? { projected: proj.name, current: proj.currentShape.name, drift: proj.drift, confidence: proj.confidence, etas: proj.etas, first5: proj.rounds.slice(0, 5) } : null,
    shapeLedger: { resolved: ledger.resolved, skill: ledger.skill, coverage: ledger.coverage },
    dna: { verdict: dna.verdict, significant: dna.significant, expectedFalsePositives: dna.expectedFalsePositives, live: dna.live.map((l) => ({ k: l.k, pattern: l.pattern, n: l.n, rate: l.rate, base: l.base, z: l.z })) },
    linguistics: { narrative: ling.narrative, currentSentenceLength: ling.sentences.current.length, expectedSentenceLength: ling.sentences.expectedLength, entropyBits: ling.entropyBits, maxEntropyBits: ling.maxEntropyBits },
    pressure: analysis.pressure ? { overall: (analysis.pressure as Rows).overallPressure, state: (analysis.pressure as Rows).state } : null,
    moonshot: analysis.moonshot ?? null,
  };
}

export async function aiSummary(a: CoreAdapter, force: boolean): Promise<Record<string, unknown>> {
  const stats = a.tableStats();
  const last = a.sql.exec("SELECT * FROM ai_summaries WHERE status = 'ok' ORDER BY created_ms DESC LIMIT 1").toArray()[0] as Rows | undefined;
  if (!force && last && (last.max_id as number) === stats.maxId) return { cached: true, ...formatSummary(last) };
  const key = aiKey(a);
  const metrics = metricsBundle(a);
  const model = a.setting("entrim_model") || "deepseek-ai/DeepSeek-V4-Flash";
  const base = (a.setting("entrim_base_url") || "https://api.entrim.ai/v1").replace(/\/+$/, "");
  const started = Date.now();
  let content = "";
  let status = "ok";
  if (!key) {
    status = "no-key";
    content = fallbackSummary(metrics);
  } else {
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          max_tokens: 1600,
          messages: [
            {
              role: "system",
              content:
                "You are the forecast analyst for Momento, a research console for Spribe Aviator crash-game rounds (a provably-fair RNG). " +
                "Write a concise, decision-ready summary of the next-round outlook from the metrics JSON. Rules: " +
                "1) First line: a single headline sentence (no markdown symbols) stating state, expected multiplier, range and confidence. " +
                "2) Then markdown sections: '### Next round', '### Shape & timing', '### Pattern & language evidence', '### Reliability', '### Bottom line'. " +
                "3) Quote the numbers exactly as given; never invent metrics. 4) Always compare to baseline and say plainly when skill vs baseline is ~0 — the game is RNG and nothing guarantees an outcome. " +
                "5) Mention reconstructed-round share if non-zero. ETA 'eta' strings are already in the operator's local clock — copy them verbatim, never convert time zones. 6) Under 320 words. No financial advice, no betting instructions.",
            },
            { role: "user", content: "Metrics JSON:\n" + JSON.stringify(metrics) },
          ],
        }),
        signal: AbortSignal.timeout(75_000),
      });
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
      content = body.choices?.[0]?.message?.content?.trim() ?? "";
      if (!res.ok || !content) {
        status = "error";
        content = fallbackSummary(metrics) + `\n\n> AI provider error: ${body.error?.message ?? res.status}`;
      }
    } catch (e) {
      status = "error";
      content = fallbackSummary(metrics) + `\n\n> AI provider unreachable: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  const headline = content.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "").replace(/\*\*/g, "").trim() ?? "";
  a.sql.exec(
    "INSERT INTO ai_summaries (model, max_id, rounds, headline, content, metrics, duration_ms, status, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    key ? model : "deterministic", stats.maxId, stats.count, headline, content, JSON.stringify(metrics), Date.now() - started, status === "ok" ? "ok" : status, Date.now(),
  );
  a.sql.exec("DELETE FROM ai_summaries WHERE id NOT IN (SELECT id FROM ai_summaries ORDER BY created_ms DESC LIMIT 50)");
  const row = a.sql.exec("SELECT * FROM ai_summaries ORDER BY id DESC LIMIT 1").toArray()[0] as Rows;
  return { cached: false, ...formatSummary(row) };
}

function formatSummary(r: Rows) {
  return {
    id: r.id,
    model: r.model,
    status: r.status,
    headline: r.headline,
    content: r.content,
    metrics: JSON.parse((r.metrics as string) || "{}"),
    maxId: r.max_id,
    rounds: r.rounds,
    durationMs: r.duration_ms,
    createdAt: new Date(r.created_ms as number).toISOString(),
  };
}

function fallbackSummary(m: ReturnType<typeof metricsBundle>): string {
  const nr = m.nextRound;
  const fx = (v: unknown) => (typeof v === "number" ? `${v.toFixed(2)}x` : "—");
  return [
    `${nr.state ?? "—"} · expected ${fx(nr.expected)} · range ${fx((nr.range as number[])[0])}–${fx((nr.range as number[])[1])} · ${nr.confidenceLabel ?? ""} confidence`,
    "### Next round",
    `Full-intelligence state **${nr.state}**, expected **${fx(nr.expected)}**, range ${fx((nr.range as number[])[0])}–${fx((nr.range as number[])[1])}, reach ${fx(nr.reach)}.`,
    "### Shape & timing",
    m.shape ? `Current shape **${m.shape.current}** → projected **${m.shape.projected}** (drift ${m.shape.drift}, confidence ${(m.shape.confidence * 100).toFixed(0)}%).` : "Not enough rounds for a shape projection.",
    "### Pattern & language evidence",
    `${m.dna.verdict} ${m.linguistics.narrative}`,
    "### Reliability",
    `Skill vs baseline: ${nr.skillPctVsBaseline ?? "—"}% over ${nr.calibrationSample ?? 0} scored rounds. Shape-ledger skill: ${m.shapeLedger.skill === null ? "pending" : (m.shapeLedger.skill * 100).toFixed(1) + "%"}.`,
    "### Bottom line",
    "Aviator is a provably-fair RNG; treat every forecast as a calibrated description of odds, not a guarantee.",
    "",
    "_(Deterministic summary — set ENTRIM_API_KEY to enable the AI analyst.)_",
  ].join("\n");
}

// ------------------------------------------------------------------ router

export async function routeV64(a: CoreAdapter, method: string, path: string, q: URLSearchParams, body: Record<string, unknown>): Promise<Response | null> {
  const sql = a.sql;

  // ---- live pulse (realtime layer heartbeat)
  if (path === "/api/v1/live/pulse" && method === "GET") {
    const stats = a.tableStats();
    const last = sql.exec("SELECT id, ts, multiplier, source, origin FROM rounds WHERE origin != 'reconstructed' ORDER BY ts_ms DESC LIMIT 1").toArray()[0] ?? null;
    const job = sql.exec("SELECT MAX(last_run_ms) AS t FROM deep_jobs").toArray()[0] as { t: number | null };
    return ok({ maxId: stats.maxId, count: stats.count, last, deepRunMs: job.t, serverTime: Date.now() });
  }

  // ---- Eagle Eye: paged, filtered full history
  if (path === "/api/v1/rounds/page" && method === "GET") {
    const f = roundFilter(q);
    const pageSize = num(q.get("pageSize"), 500, 10, 2000);
    const page = num(q.get("page"), 1, 1, 1e7);
    const order = q.get("order") === "asc" ? "ASC" : "DESC";
    const sort = q.get("sort") === "multiplier" ? "multiplier" : "ts_ms";
    const agg = sql.exec(
      `SELECT COUNT(*) AS n, AVG(MIN(multiplier, 1000)) AS avgCapped, MAX(multiplier) AS max, MIN(multiplier) AS min,
         SUM(CASE WHEN multiplier < 2 THEN 1 ELSE 0 END) AS blue,
         SUM(CASE WHEN multiplier >= 2 AND multiplier < 10 THEN 1 ELSE 0 END) AS purple,
         SUM(CASE WHEN multiplier >= 10 THEN 1 ELSE 0 END) AS pink,
         SUM(CASE WHEN origin = 'reconstructed' THEN 1 ELSE 0 END) AS reconstructed,
         SUM(CASE WHEN origin = 'anchor' THEN 1 ELSE 0 END) AS anchors,
         MIN(ts_ms) AS firstMs, MAX(ts_ms) AS lastMs
       FROM rounds ${f.where}`,
      ...f.args,
    ).toArray()[0] as Rows;
    const rows = sql.exec(
      `SELECT id, ts, ts_ms, multiplier, color, source, session_id, ingest, origin FROM rounds ${f.where} ORDER BY ${sort} ${order}, id ${order} LIMIT ? OFFSET ?`,
      ...f.args, pageSize, (page - 1) * pageSize,
    ).toArray();
    const ingests = sql.exec(`SELECT ingest, COUNT(*) AS n FROM rounds ${f.where} GROUP BY ingest ORDER BY n DESC`, ...f.args).toArray();
    const total = (sql.exec("SELECT COUNT(*) AS n FROM rounds").toArray()[0] as { n: number }).n;
    return ok({ rounds: rows, page, pageSize, pages: Math.max(1, Math.ceil((agg.n as number) / pageSize)), filtered: agg.n, total, stats: agg, ingests });
  }
  if (path === "/api/v1/rounds/export" && method === "GET") {
    const f = roundFilter(q);
    const format = q.get("format") === "json" ? "json" : "csv";
    const limit = num(q.get("limit"), 250_000, 1, 1_000_000);
    const rows = sql.exec(`SELECT id, ts, multiplier, source, session_id, ingest, origin FROM rounds ${f.where} ORDER BY ts_ms ASC LIMIT ?`, ...f.args, limit).toArray() as Rows[];
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    if (format === "json") {
      return new Response(JSON.stringify(rows.map((r) => ({ ...r, hue: hueOf(r.multiplier as number) }))), {
        headers: { "content-type": "application/json", "content-disposition": `attachment; filename="momento-rounds-${stamp}.json"` },
      });
    }
    const lines = ["id,timestamp,multiplier,hue,source,session_id,ingest,origin"];
    for (const r of rows) lines.push([r.id, r.ts, r.multiplier, hueOf(r.multiplier as number), r.source, r.session_id ?? "", r.ingest, r.origin].join(","));
    return new Response(lines.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="momento-rounds-${stamp}.csv"` } });
  }

  // ---- seeding: top rounds (Spribe widget markup / text)
  if (path === "/api/v1/seed/top-rounds" && method === "POST") {
    const source = String(body.source ?? "aviator").trim() || "aviator";
    const tzMin = num(body.tzOffsetMin, tz(a), -720, 840);
    const parsed = parseTopRounds(String(body.html ?? body.text ?? ""), tzMin);
    if (body.scope && ["day", "month", "year"].includes(String(body.scope))) for (const r of parsed.rows) r.scope = body.scope as "day";
    if (body.dryRun) return ok({ ...parsed, rows: parsed.rows.map((r) => ({ ...r, ts: new Date(r.tsMs).toISOString() })) });
    let stored = 0;
    let anchored = 0;
    let matched = 0;
    const now = Date.now();
    for (const r of parsed.rows) {
      const key = scopeKey(r.scope, r.tsMs, tzMin);
      const exists = sql.exec("SELECT id FROM top_rounds WHERE source = ? AND scope = ? AND scope_key = ? AND ABS(multiplier - ?) < 0.005 AND ts = ?", source, r.scope, key, r.multiplier, new Date(r.tsMs).toISOString()).toArray()[0];
      if (!exists) {
        sql.exec("INSERT INTO top_rounds (source, scope, scope_key, round_id, ts, multiplier, color) VALUES (?, ?, ?, NULL, ?, ?, 'pink')", source, r.scope, key, new Date(r.tsMs).toISOString(), r.multiplier);
        stored++;
      }
      if (!/rounds/i.test(r.metric) || body.anchor === false) continue;
      // already recorded? (same multiplier within the minute ±90 s)
      const hit = sql.exec("SELECT id FROM rounds WHERE source = ? AND ABS(multiplier - ?) < 0.006 AND ts_ms BETWEEN ? AND ?", source, r.multiplier, r.tsMs - 90_000, r.tsMs + 150_000).toArray()[0] as Rows | undefined;
      if (hit) {
        matched++;
        sql.exec("UPDATE top_rounds SET round_id = ? WHERE source = ? AND scope = ? AND ABS(multiplier - ?) < 0.005 AND round_id IS NULL", hit.id, source, r.scope, r.multiplier);
        continue;
      }
      const ts = r.tsMs + 30_000; // mid-minute: the widget only shows HH:MM
      const res = sql.exec(
        "INSERT OR IGNORE INTO rounds (ts, ts_ms, multiplier, color, source, session_id, ingest, created_ms, origin) VALUES (?, ?, ?, 'pink', ?, NULL, 'top-rounds', ?, 'anchor')",
        new Date(ts).toISOString(), ts, r.multiplier, source, now,
      );
      anchored += res.rowsWritten ?? 0;
    }
    a.invalidate();
    a.audit("seeder", "seed.top_rounds", source, { rows: parsed.rows.length, stored, anchored, matched });
    return ok({ source, blocks: parsed.blocks, warnings: parsed.warnings, parsed: parsed.rows.length, stored, anchored, matched });
  }

  // ---- seeding: rounds known by order only, spread across a time window
  if (path === "/api/v1/seed/span" && method === "POST") {
    const source = String(body.source ?? "aviator").trim() || "aviator";
    const raw = Array.isArray(body.multipliers) ? (body.multipliers as unknown[]).map(Number) : String(body.text ?? "").split(/[\s,;]+/).map((s) => Number(s.replace(/x$/i, "")));
    let mults = raw.filter((v) => Number.isFinite(v) && v >= 1);
    if (body.order !== "oldest-first") mults = mults.reverse(); // the in-game history shows newest first
    const start = Date.parse(String(body.start ?? ""));
    const end = Date.parse(String(body.end ?? ""));
    if (!mults.length) return fail("no multipliers found");
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return fail("valid start < end timestamps required");
    const cadence = fitCadence(a.roundsFor(source, { includeReconstructed: false }));
    const spread = spreadSpan(mults, start, end, cadence);
    if (body.dryRun) return ok({ source, rounds: spread.map((r) => ({ ...r, ts: new Date(r.tsMs).toISOString() })), cadence });
    const res = a.ingest(source, "seed-span", spread.map((r) => ({ timestamp: r.tsMs, multiplier: r.multiplier })), "seeded");
    a.rebuildSessions(source);
    return ok({ source, ...res, cadence, first: new Date(spread[0].tsMs).toISOString(), last: new Date(spread[spread.length - 1].tsMs).toISOString() });
  }

  // ---- seeding: after a bulk import, prime every intelligence layer
  if (path === "/api/v1/seed/prime" && method === "POST") {
    const sources = (sql.exec("SELECT DISTINCT source FROM rounds").toArray() as Rows[]).map((r) => r.source as string);
    for (const s of sources) a.rebuildSessions(s);
    a.invalidate();
    const jobs = sql.exec("SELECT * FROM deep_jobs WHERE enabled = 1 AND kind IN ('dna','linguistics','vocabulary','shape')").toArray() as Rows[];
    const ran: string[] = [];
    for (const j of jobs) {
      await runJob(a, j);
      ran.push(j.name as string);
    }
    return ok({ sources, sessionsRebuilt: sources.length, jobs: ran });
  }

  // ---- gap reconstruction
  if (path === "/api/v1/reconstruct/plan" && method === "GET") {
    return ok(reconstruct(a, { source: q.get("source"), minGapSec: q.get("minGapSec"), maxGapHours: q.get("maxGapHours"), maxFillPerGap: q.get("maxFillPerGap"), dryRun: true }));
  }
  if (path === "/api/v1/reconstruct/run" && method === "POST") {
    const res = reconstruct(a, { ...body, dryRun: false });
    a.audit("reconstructor", "reconstruct.run", String(body.source ?? "all"), { inserted: res.inserted });
    return ok(res);
  }
  if (path === "/api/v1/reconstruct/clear" && method === "POST") {
    const source = body.source && body.source !== "all" ? String(body.source) : null;
    const res = source ? sql.exec("DELETE FROM rounds WHERE origin = 'reconstructed' AND source = ?", source) : sql.exec("DELETE FROM rounds WHERE origin = 'reconstructed'");
    a.invalidate();
    return ok({ removed: res.rowsWritten ?? 0 });
  }
  if (path === "/api/v1/reconstruct/config" && method === "POST") {
    a.setSetting("reconstruct_in_forecast", body.useInForecast === false || body.useInForecast === 0 || body.useInForecast === "0" ? "0" : "1");
    a.invalidate();
    return ok({ useInForecast: a.setting("reconstruct_in_forecast") !== "0" });
  }
  if (path === "/api/v1/reconstruct/status" && method === "GET") {
    const rows = sql.exec("SELECT source, origin, COUNT(*) AS n FROM rounds GROUP BY source, origin ORDER BY source").toArray();
    return ok({ byOrigin: rows, useInForecast: a.setting("reconstruct_in_forecast") !== "0" });
  }

  // ---- DNA / Pattern DNA (on-demand with range filters, or live overlay on a scheduled scan)
  if (path === "/api/v1/dna/scan" && method === "GET") {
    const rounds = applyRange(a.roundsFor(q.get("source")), rangeFromQuery(q));
    const cadence = fitCadence(a.roundsFor(q.get("source"), { includeReconstructed: false }));
    const scan = dnaFromParams(rounds, Object.fromEntries(q.entries()), cadence);
    const { table: _t, ...rest } = scan;
    return ok({ ...rest, alphabets: ALPHABETS, layer: "on-demand" });
  }
  if (path === "/api/v1/dna/live" && method === "GET") {
    const jobs = sql.exec("SELECT * FROM deep_jobs WHERE kind = 'dna' ORDER BY id").toArray() as Rows[];
    const all = a.roundsFor(null);
    const cadence = fitCadence(a.roundsFor(null, { includeReconstructed: false }));
    const stats = a.tableStats();
    const out = jobs.map((j) => {
      const r = latestResult(sql, j.id as number);
      if (!r) return { job: { id: j.id, name: j.name, every: j.every_min }, result: null };
      const scan = JSON.parse(r.payload as string) as DnaScan;
      const overlay = dnaOverlay(all, { alphabet: scan.alphabet, kRange: scan.kRange, baseRate: scan.baseRate, table: scan.table }, cadence);
      const { table: _t, ...rest } = scan;
      return {
        job: { id: j.id, name: j.name, every: j.every_min, lastRunMs: j.last_run_ms },
        result: { ...rest, computedAt: new Date(r.created_ms as number).toISOString(), roundsAtCompute: r.rounds, newSinceCompute: Math.max(0, stats.maxId - (r.max_id as number)) },
        overlay,
      };
    });
    return ok({ scans: out, layer: "deep + live overlay" });
  }

  // ---- linguistics v2
  if (path === "/api/v1/linguistics/v2" && method === "GET") {
    const rounds = applyRange(a.roundsFor(q.get("source")), rangeFromQuery(q));
    const cadence = fitCadence(a.roundsFor(q.get("source"), { includeReconstructed: false }));
    return ok(linguisticsV2(rounds, num(q.get("depth"), 240, 20, 2000), cadence));
  }

  // ---- investigation suite
  if (path === "/api/v1/investigate/round" && method === "GET") {
    const all = a.roundsFor(q.get("source"));
    let idx = -1;
    if (q.get("id")) idx = all.findIndex((r) => r.id === Number(q.get("id")));
    else if (q.get("ts")) {
      const t = Date.parse(q.get("ts")!);
      let best = Infinity;
      all.forEach((r, i) => {
        const d = Math.abs(r.tsMs - t);
        if (d < best) {
          best = d;
          idx = i;
        }
      });
    } else idx = all.length - 1;
    if (idx < 0) return fail("round not found", 404);
    const calib = (sql.exec("SELECT state, expected, range_lo, range_hi, confidence, verdict, reason, comp_loss, weights FROM intel_calibrations WHERE round_id = ? LIMIT 1", all[idx].id).toArray()[0] as CalibRow | undefined) ?? null;
    const cadence = fitCadence(a.roundsFor(all[idx].source, { includeReconstructed: false }));
    return ok(investigateRound(all, idx, calib, cadence, num(q.get("radius"), 30, 5, 200)));
  }
  if (path === "/api/v1/investigate/range" && method === "GET") {
    const all = a.roundsFor(q.get("source"));
    const slice = applyRange(all, rangeFromQuery(q));
    return ok(investigateRange(all, slice));
  }
  if (path === "/api/v1/investigate/gaps" && method === "GET") {
    const real = a.roundsFor(q.get("source"), { includeReconstructed: false });
    const cadence = fitCadence(real);
    const perSource = new Map<string, ReturnType<typeof fitCadence>>();
    for (const src of new Set(real.map((r) => r.source))) perSource.set(src, fitCadence(real.filter((r) => r.source === src)));
    const minGap = num(q.get("minGapSec"), 120, 10, 1e7) * 1000;
    const gaps: { source: string; afterId: number; startMs: number; endMs: number; gapSec: number; estMissing: number }[] = [];
    for (let i = 1; i < real.length; i++) {
      if (real[i].source !== real[i - 1].source) continue;
      const d = real[i].tsMs - real[i - 1].tsMs;
      if (d >= minGap) gaps.push({ source: real[i].source, afterId: real[i - 1].id, startMs: real[i - 1].tsMs, endMs: real[i].tsMs, gapSec: Math.round(d / 1000), estMissing: Math.max(0, Math.round(d / Math.max(1, (perSource.get(real[i].source) ?? cadence).medianMs)) - 1) });
    }
    gaps.sort((x, y) => y.gapSec - x.gapSec);
    return ok({ cadence, perSource: Object.fromEntries(perSource), count: gaps.length, totalMissing: gaps.reduce((s, g) => s + g.estMissing, 0), gaps: gaps.slice(0, num(q.get("limit"), 200, 1, 5000)) });
  }

  // ---- chart lab: projected shapes
  if (path === "/api/v1/shapes/project" && method === "GET") {
    const all = applyRange(a.roundsFor(q.get("source")), rangeFromQuery(q));
    const cadence = fitCadence(a.roundsFor(q.get("source"), { includeReconstructed: false }));
    const window = num(q.get("window"), 30, 8, 200);
    const horizon = num(q.get("horizon"), 20, 3, 200);
    const proj = projectShape(all, { window, horizon, k: num(q.get("k"), 40, 5, 500), cadence, tzOffsetMin: tz(a) });
    if (!proj) return fail("not enough rounds for this window/horizon", 422);
    const tail = all.slice(-Math.max(window * 4, 120)).map((r) => ({ id: r.id, tsMs: r.tsMs, multiplier: r.multiplier, origin: (r as Round & { origin?: string }).origin ?? "observed" }));
    return ok({ ...proj, cadence, tail, ledger: shapeLedger(a) });
  }
  if (path === "/api/v1/shapes/ledger" && method === "GET") return ok(shapeLedger(a));
  if (path === "/api/v1/shapes/backtest" && method === "GET") {
    // walk-forward: project at past anchors using only prior history, score vs what followed
    const all = a.roundsFor(q.get("source"), { includeReconstructed: false });
    const W = num(q.get("window"), 30, 8, 200);
    const H = num(q.get("horizon"), 20, 3, 100);
    const n = num(q.get("n"), 40, 5, 200);
    const cadence = fitCadence(all);
    const step = Math.max(H, Math.floor((all.length - 2000 - H) / n));
    const rows: { anchorId: number; name: string; skill: number; maeModel: number; maeBase: number; coverage: number }[] = [];
    for (let end = all.length - H - 1; end > 2000 && rows.length < n; end -= step) {
      const hist = all.slice(0, end + 1);
      const proj = projectShape(hist, { window: W, horizon: H, k: 40, cadence, tzOffsetMin: tz(a) });
      if (!proj) continue;
      const mu = hist.reduce((x, r) => x + Math.min(Math.log(Math.max(1, r.multiplier)), Math.log(1000)), 0) / hist.length;
      const sc = scoreProjection({ path: proj.path, baselinePath: proj.baselinePath }, all.slice(end + 1, end + 1 + H), mu, proj.currentShape.path[proj.currentShape.path.length - 1]);
      if (sc) rows.push({ anchorId: all[end].id, name: proj.name, skill: sc.skill, maeModel: sc.maeModel, maeBase: sc.maeBase, coverage: sc.iqrCoverage });
    }
    const mean = (k: "skill" | "maeModel" | "maeBase" | "coverage") => (rows.length ? Math.round((rows.reduce((x, r) => x + r[k], 0) / rows.length) * 1e4) / 1e4 : null);
    const maeM = mean("maeModel");
    const maeB = mean("maeBase");
    return ok({
      n: rows.length, window: W, horizon: H,
      maeModel: maeM, maeBase: maeB,
      skill: maeM !== null && maeB ? Math.round((1 - maeM / maeB) * 1e4) / 1e4 : null,
      coverage: mean("coverage"),
      wins: rows.filter((r) => r.maeModel < r.maeBase).length,
      rows: rows.reverse(),
      note: "Walk-forward: each projection uses only rounds before its anchor. Skill = 1 − MAE(model)/MAE(flat baseline); IQR coverage ≈ 50% means well-calibrated fans.",
    });
  }
  if (path === "/api/v1/shapes/gallery" && method === "GET") return ok(shapeGallery(a.roundsFor(q.get("source")), num(q.get("follow"), 10, 3, 100)));

  // ---- scheduler (deep tier)
  if (path === "/api/v1/deep/jobs" && method === "GET") {
    const jobs = sql.exec("SELECT * FROM deep_jobs ORDER BY id").toArray() as Rows[];
    return ok({
      jobs: jobs.map((j) => ({ ...j, params: JSON.parse(j.params as string), nextRunMs: j.last_run_ms ? (j.last_run_ms as number) + (j.every_min as number) * 60_000 : Date.now() })),
      aiConfigured: !!aiKey(a),
    });
  }
  if (path === "/api/v1/deep/jobs" && (method === "POST" || method === "PUT")) {
    const now = Date.now();
    if (body.id) {
      sql.exec(
        "UPDATE deep_jobs SET name = COALESCE(?, name), params = COALESCE(?, params), every_min = COALESCE(?, every_min), enabled = COALESCE(?, enabled) WHERE id = ?",
        (body.name as string) ?? null, body.params ? JSON.stringify(body.params) : null, body.every_min !== undefined ? num(body.every_min, 30, 1, 10_080) : null,
        body.enabled !== undefined ? (body.enabled ? 1 : 0) : null, body.id,
      );
      return ok({ id: body.id });
    }
    if (!body.name || !body.kind) return fail("name and kind required");
    sql.exec("INSERT INTO deep_jobs (name, kind, params, every_min, enabled, created_ms) VALUES (?, ?, ?, ?, 1, ?)", String(body.name), String(body.kind), JSON.stringify(body.params ?? {}), num(body.every_min, 30, 1, 10_080), now);
    return ok({ created: true });
  }
  if (path === "/api/v1/deep/jobs/delete" && method === "POST") {
    sql.exec("DELETE FROM deep_jobs WHERE id = ?", Number(body.id));
    sql.exec("DELETE FROM deep_results WHERE job_id = ?", Number(body.id));
    return ok({ deleted: body.id });
  }
  if (path === "/api/v1/deep/run" && method === "POST") {
    if (body.id) {
      const job = sql.exec("SELECT * FROM deep_jobs WHERE id = ?", Number(body.id)).toArray()[0] as Rows | undefined;
      if (!job) return fail("job not found", 404);
      return ok(await runJob(a, job));
    }
    return ok(await deepTick(a));
  }
  if (path === "/api/v1/deep/result" && method === "GET") {
    const r = latestResult(sql, Number(q.get("job")));
    if (!r) return ok({ result: null });
    const payload = JSON.parse(r.payload as string);
    delete payload.table;
    return ok({ result: { ...r, payload } });
  }

  // ---- AI forecast summary
  if (path === "/api/v1/ai/summary" && method === "GET") {
    const r = sql.exec("SELECT * FROM ai_summaries ORDER BY created_ms DESC LIMIT 1").toArray()[0] as Rows | undefined;
    const stats = a.tableStats();
    return ok({ summary: r ? formatSummary(r) : null, configured: !!aiKey(a), roundsSince: r ? Math.max(0, stats.maxId - (r.max_id as number)) : null });
  }
  if (path === "/api/v1/ai/summary" && method === "POST") return ok({ summary: await aiSummary(a, !!body.force), configured: !!aiKey(a) });
  if (path === "/api/v1/ai/metrics" && method === "GET") return ok(metricsBundle(a));

  return null;
}
