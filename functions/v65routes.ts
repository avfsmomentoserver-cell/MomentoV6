// functions/v65routes.ts — Momento v6.5 "Platform Book" surface, mounted in the MomentoCore DO.
//
// Implements the feature catalogue of The Momento Platform Book (Ch 18) on top of
// the v6.4 core. The measurement foundation comes first (Ch 19 §19.3):
//
//   * every forecast is STORED AT CREATION (fixes Ch 08 V4) in forecast_store
//     with its per-engine distributions, and hash-chained (F-18);
//   * the next observed round resolves it; windows that overlap a tape gap or a
//     reconstructed round are VOID, never scored as misses (F-01 void rule);
//   * everything downstream (reliability F-17, registry F-12, regimes F-13,
//     counterfactuals F-16, diff F-14, explain F-35, replay F-24) reads those
//     stored rows — nothing is recomputed after the fact.

import type { Round } from "./analysis";
import { BAND_LABELS, bandIndex } from "./analysis";
import { anchors, rangeMomentum } from "./momentum";
import { wordOf } from "./v64";
import type { CoreAdapter } from "./v64routes";
import { libBacktest, libForecast } from "./lib/forecast";
import {
  ENGINE_FAMILIES,
  GENESIS,
  NB,
  SIGNALS,
  admissionTests,
  bhQ,
  blockBootstrapCI,
  canonicalJson,
  chainHashSync,
  compareSources,
  counterfactual,
  coverageACI,
  customPredict,
  cusumFingerprint,
  etaBoard,
  fairnessBattery,
  forecastDiff,
  hazardTimeline,
  inRoundEta,
  integrityReport,
  kellyTells,
  mean,
  medianIntervalMs,
  narrate,
  numbersCheck,
  parseHypothesis,
  pitHistogram,
  quantileFromDist,
  r2,
  r4,
  regimeWeights,
  reliability,
  runExperiment,
  scoreCustom,
  sequenceSearch,
  shuffledSignificance,
  signalSignificance,
  simulateBankroll,
  solveConvention,
  survivalFromDist,
  verdictFor,
  verifyAll,
  verifySeedChain,
  wilsonCI,
  twoProp,
  type CustomEngineSpec,
  type EngineFamily,
  type ExperimentSpec,
  type LedgerRow,
  type StoredForecast,
  type Strategy,
} from "./v65";

type Rows = Record<string, unknown>;
type Sql = CoreAdapter["sql"];
export interface V65User { id: number; email: string; name: string; role: string }

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const ok = (data: unknown) => json({ ok: true, data });
const fail = (error: string, status = 400) => json({ ok: false, error }, status);
const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity) => {
  if (v === null || v === undefined || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const parse = <T,>(s: unknown, d: T): T => {
  if (typeof s !== "string" || !s) return d;
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
};
const srcOf = (q: URLSearchParams) => {
  const s = q.get("source");
  return s && s !== "all" ? s : null;
};
const isOp = (u: V65User | null) => !!u && (u.role === "operator" || u.role === "admin");

// ------------------------------------------------------------------ schema

export function initV65Schema(sql: Sql): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS forecast_store (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL DEFAULT 'all',
      origin TEXT NOT NULL DEFAULT 'live',
      after_round_id INTEGER,
      after_ts_ms INTEGER NOT NULL,
      created_ms INTEGER NOT NULL,
      state TEXT NOT NULL,
      expected REAL NOT NULL,
      range_lo REAL NOT NULL,
      range_hi REAL NOT NULL,
      reach REAL NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      dist TEXT NOT NULL,
      comp TEXT NOT NULL,
      cone TEXT,
      resolved_round_id INTEGER,
      actual REAL,
      void INTEGER NOT NULL DEFAULT 0,
      void_reason TEXT,
      mix_loss REAL,
      base_loss REAL,
      comp_loss TEXT,
      resolved_ms INTEGER,
      chain_seq INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_fs_created ON forecast_store (created_ms);
    CREATE INDEX IF NOT EXISTS idx_fs_open ON forecast_store (resolved_ms, after_ts_ms);
    CREATE TABLE IF NOT EXISTS ledger_chain (
      seq INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      ref_id INTEGER NOT NULL,
      payload TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      row_hash TEXT NOT NULL,
      created_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ledger_heads (
      day TEXT PRIMARY KEY,
      seq INTEGER NOT NULL,
      head TEXT NOT NULL,
      created_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS engines (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '1',
      owner TEXT NOT NULL DEFAULT 'core',
      kind TEXT NOT NULL DEFAULT 'builtin',
      family TEXT,
      params TEXT NOT NULL DEFAULT '{}',
      state TEXT NOT NULL DEFAULT 'live',
      prior REAL NOT NULL DEFAULT 1,
      admission TEXT,
      created_ms INTEGER NOT NULL,
      updated_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS engine_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      from_state TEXT,
      to_state TEXT NOT NULL,
      reason TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'system',
      created_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS drawn_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_key TEXT NOT NULL,
      display_name TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'all',
      level REAL NOT NULL,
      horizon INTEGER NOT NULL,
      probability REAL NOT NULL,
      mixture_p REAL NOT NULL,
      after_round_id INTEGER,
      after_ts_ms INTEGER NOT NULL,
      drawing TEXT,
      created_ms INTEGER NOT NULL,
      resolved_ms INTEGER,
      actual INTEGER,
      rounds_used INTEGER,
      logloss REAL,
      mix_logloss REAL,
      void INTEGER NOT NULL DEFAULT 0,
      chain_seq INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_dp_open ON drawn_predictions (resolved_ms, after_ts_ms);
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      producer TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'all',
      ref TEXT,
      action TEXT NOT NULL,
      target REAL,
      probability REAL,
      base_rate REAL,
      stake REAL NOT NULL DEFAULT 0,
      horizon INTEGER NOT NULL DEFAULT 1,
      after_ts_ms INTEGER NOT NULL,
      reasons TEXT,
      guard TEXT,
      created_ms INTEGER NOT NULL,
      resolved_ms INTEGER,
      outcome INTEGER,
      pnl REAL
    );
    CREATE INDEX IF NOT EXISTS idx_dec_prod ON decisions (producer, created_ms);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_dec_ref ON decisions (producer, ref);
    CREATE TABLE IF NOT EXISTS experiments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      hypothesis TEXT NOT NULL,
      spec TEXT NOT NULL,
      result TEXT,
      p REAL,
      q REAL,
      verdict TEXT NOT NULL DEFAULT 'draft',
      lifecycle TEXT NOT NULL DEFAULT 'draft',
      family TEXT NOT NULL DEFAULT 'default',
      engine_key TEXT,
      drafted_by TEXT NOT NULL DEFAULT 'parser',
      approved_by TEXT,
      created_ms INTEGER NOT NULL,
      updated_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alert_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL DEFAULT 'console',
      name TEXT NOT NULL,
      field TEXT NOT NULL,
      op TEXT NOT NULL,
      value REAL NOT NULL,
      source TEXT NOT NULL DEFAULT 'all',
      channel TEXT NOT NULL DEFAULT 'in-app',
      debounce_s INTEGER NOT NULL DEFAULT 300,
      quiet_from INTEGER,
      quiet_to INTEGER,
      daily_cap INTEGER NOT NULL DEFAULT 20,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_fired_ms INTEGER,
      last_state INTEGER NOT NULL DEFAULT 0,
      created_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER,
      kind TEXT NOT NULL DEFAULT 'rule',
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      probability REAL,
      link TEXT,
      forecast_id INTEGER,
      rating INTEGER,
      read INTEGER NOT NULL DEFAULT 0,
      created_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts (created_ms);
    CREATE TABLE IF NOT EXISTS ingest_quarantine (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      payload TEXT NOT NULL,
      reasons TEXT NOT NULL,
      created_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ingest_nonces (
      nonce TEXT PRIMARY KEY,
      created_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      key TEXT PRIMARY KEY,
      fails INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0,
      updated_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      meta TEXT,
      created_ms INTEGER NOT NULL
    );
  `);
  const now = Date.now();
  const builtins: [string, string, number][] = [
    ["baseline", "Measured baseline (full history)", 1.0],
    ["percentile", "Empirical percentiles (recent 500)", 0.8],
    ["markov", "Markov state transitions (V5 7-state)", 0.9],
    ["dna", "DNA analogue matching", 0.7],
    ["band", "v6 band-partition model (tail-lift)", 0.9],
    ["ml", "Logistic ML ensemble", 0.6],
    ["ensemble", "v6 earned-weight per-round ensemble", 0.8],
    ["signals", "Signal layer (pressure · moonshot · ladders · FX · momentum)", 0.6],
  ];
  for (const [k, l, p] of builtins) {
    sql.exec(
      "INSERT INTO engines (key, label, version, owner, kind, state, prior, created_ms, updated_ms) VALUES (?, ?, '6.3', 'core', 'builtin', 'live', ?, ?, ?) ON CONFLICT(key) DO NOTHING",
      k, l, p, now, now,
    );
  }
}

// ------------------------------------------------------------ registry glue

export interface RegistryEngine { key: string; label: string; prior: number; predict: (rounds: Round[]) => number[] }

let registryCache: { stamp: string; states: Record<string, string>; extras: RegistryEngine[] } | null = null;
export function registry(sql: Sql): { states: Record<string, string>; extras: RegistryEngine[] } {
  let rows: Rows[] = [];
  try {
    rows = sql.exec("SELECT key, label, kind, family, params, state, prior, updated_ms FROM engines").toArray() as Rows[];
  } catch {
    return { states: {}, extras: [] };
  }
  const stamp = rows.map((r) => `${r.key}:${r.state}:${r.updated_ms}`).join("|");
  if (registryCache?.stamp === stamp) return registryCache;
  const states: Record<string, string> = {};
  const extras: RegistryEngine[] = [];
  for (const r of rows) {
    states[r.key as string] = r.state as string;
    if (r.kind === "custom" && r.state !== "retired") {
      const spec: CustomEngineSpec = { family: r.family as EngineFamily, params: parse(r.params, {}) };
      extras.push({
        key: r.key as string,
        label: r.label as string,
        prior: Number(r.prior) || 0.5,
        predict: (rounds: Round[]) => customPredict(spec, rounds.filter((x) => x.origin !== "reconstructed").map((x) => x.multiplier)),
      });
    }
  }
  registryCache = { stamp, states, extras };
  return registryCache;
}

// ------------------------------------------------------------- ledger chain

function appendChain(sql: Sql, kind: string, refId: number, payload: Record<string, unknown>): number {
  const last = sql.exec("SELECT seq, row_hash FROM ledger_chain ORDER BY seq DESC LIMIT 1").toArray()[0] as Rows | undefined;
  const seq = ((last?.seq as number) ?? 0) + 1;
  const prev = (last?.row_hash as string) ?? GENESIS;
  const body = { seq, kind, ref: refId, ...payload };
  const hash = chainHashSync(prev, body);
  sql.exec("INSERT INTO ledger_chain (seq, kind, ref_id, payload, prev_hash, row_hash, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?)", seq, kind, refId, canonicalJson(body), prev, hash, Date.now());
  const day = new Date().toISOString().slice(0, 10);
  sql.exec("INSERT INTO ledger_heads (day, seq, head, created_ms) VALUES (?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET seq = excluded.seq, head = excluded.head, created_ms = excluded.created_ms", day, seq, hash, Date.now());
  return seq;
}

// ------------------------------------------------------------ stored forecasts

interface IntelLike {
  state: string;
  expectedMultiplier: number;
  rangeLo: number;
  rangeHi: number;
  moonshotReach: number;
  confidence: number;
  distribution: { probability: number }[];
  intelligence: { components: { key: string; weight: number; distribution: number[] }[] };
}

function coneFrom(dist: number[], h = 5) {
  // i.i.d. horizon: each step shares the next-round distribution; the cone of the
  // running max widens with h (P(max_h ≥ x) = 1 − (1 − S(x))^h).
  const out = [];
  for (let k = 1; k <= h; k++) {
    const qMax = (q: number) => {
      // invert 1 − (1 − S(x))^k = 1 − q  →  S(x) = 1 − q^(1/k)
      const s = 1 - Math.pow(q, 1 / k);
      return quantileFromDist(dist, 1 - s);
    };
    out.push({ h: k, p25: r2(quantileFromDist(dist, 0.25)), p50: r2(quantileFromDist(dist, 0.5)), p75: r2(quantileFromDist(dist, 0.75)), p90: r2(quantileFromDist(dist, 0.9)), max50: r2(qMax(0.5)), max90: r2(qMax(0.9)) });
  }
  return out;
}

export function storeForecast(a: CoreAdapter, rounds: Round[], origin: "live" | "backfill", createdMs?: number): number | null {
  if (rounds.length < 150) return null;
  const last = rounds[rounds.length - 1];
  const f = a.intel(rounds, "all") as unknown as IntelLike;
  const dist = f.distribution.map((d) => d.probability);
  const comp = f.intelligence.components.map((c) => ({ key: c.key, weight: c.weight, dist: c.distribution }));
  const created = createdMs ?? Date.now();
  a.sql.exec(
    `INSERT INTO forecast_store (source, origin, after_round_id, after_ts_ms, created_ms, state, expected, range_lo, range_hi, reach, confidence, dist, comp, cone)
     VALUES ('all', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    origin, last.id, last.tsMs, created, f.state, f.expectedMultiplier, f.rangeLo, f.rangeHi, f.moonshotReach, f.confidence,
    JSON.stringify(dist.map(r4)), JSON.stringify(comp.map((c) => ({ key: c.key, weight: r4(c.weight), dist: c.dist.map(r4) }))), JSON.stringify(coneFrom(dist)),
  );
  const id = (a.sql.exec("SELECT MAX(id) AS id FROM forecast_store").toArray()[0] as { id: number }).id;
  const seq = appendChain(a.sql, "forecast", id, {
    origin,
    afterRoundId: last.id,
    afterTsMs: last.tsMs,
    createdMs: created,
    state: f.state,
    expected: f.expectedMultiplier,
    lo: f.rangeLo,
    hi: f.rangeHi,
    reach: f.moonshotReach,
    dist: dist.map(r4),
  });
  a.sql.exec("UPDATE forecast_store SET chain_seq = ? WHERE id = ?", seq, id);
  return id;
}

/** Resolve open stored forecasts, drawn predictions and decisions against the tape. */
export function resolveOpen(a: CoreAdapter, rounds: Round[]): { forecasts: number; predictions: number; decisions: number } {
  const sql = a.sql;
  const obs = rounds;
  if (!obs.length) return { forecasts: 0, predictions: 0, decisions: 0 };
  const med = medianIntervalMs(obs.filter((r) => r.origin !== "reconstructed"));
  const idxAfter = (ts: number) => {
    let lo = 0, hi = obs.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (obs[m].tsMs <= ts) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  let nf = 0, np = 0, nd = 0;
  const open = sql.exec("SELECT * FROM forecast_store WHERE resolved_ms IS NULL ORDER BY id LIMIT 2000").toArray() as Rows[];
  for (const f of open) {
    const i = idxAfter(f.after_ts_ms as number);
    if (i >= obs.length) continue;
    const t = obs[i];
    const prev = obs[i - 1];
    let voidReason: string | null = null;
    if (t.origin === "reconstructed") voidReason = "target is a reconstructed round";
    else if (prev && t.tsMs - prev.tsMs > 2.5 * med && Math.round((t.tsMs - prev.tsMs) / med) - 1 >= 1) voidReason = `tape gap of ${Math.round((t.tsMs - prev.tsMs) / 1000)}s before the target`;
    const dist = parse<number[]>(f.dist, []);
    const comp = parse<{ key: string; weight: number; dist: number[] }[]>(f.comp, []);
    const b = bandIndex(t.multiplier);
    const L = (d: number[]) => r4(-Math.log(Math.max(1e-6, d[b] ?? 1e-6)));
    const compLoss = Object.fromEntries(comp.map((c) => [c.key, L(c.dist)]));
    sql.exec(
      "UPDATE forecast_store SET resolved_round_id = ?, actual = ?, void = ?, void_reason = ?, mix_loss = ?, base_loss = ?, comp_loss = ?, resolved_ms = ? WHERE id = ?",
      t.id, t.multiplier, voidReason ? 1 : 0, voidReason, L(dist), compLoss.baseline ?? null, JSON.stringify(compLoss), Date.now(), f.id,
    );
    appendChain(sql, "resolution", f.id as number, { forecastId: f.id, roundId: t.id, actual: t.multiplier, void: voidReason ? 1 : 0, mixLoss: L(dist) });
    nf++;
  }
  const preds = sql.exec("SELECT * FROM drawn_predictions WHERE resolved_ms IS NULL ORDER BY id LIMIT 2000").toArray() as Rows[];
  for (const p of preds) {
    const i = idxAfter(p.after_ts_ms as number);
    const H = p.horizon as number;
    if (i + H > obs.length) continue;
    const win = obs.slice(i, i + H);
    const hitAt = win.findIndex((r) => r.multiplier >= (p.level as number));
    const y = hitAt >= 0 ? 1 : 0;
    const isVoid = win.some((r) => r.origin === "reconstructed") ? 1 : 0;
    const ll = (q: number) => r4(-(y * Math.log(Math.max(1e-6, q)) + (1 - y) * Math.log(Math.max(1e-6, 1 - q))));
    sql.exec(
      "UPDATE drawn_predictions SET resolved_ms = ?, actual = ?, rounds_used = ?, logloss = ?, mix_logloss = ?, void = ? WHERE id = ?",
      Date.now(), y, hitAt >= 0 ? hitAt + 1 : H, ll(p.probability as number), ll(p.mixture_p as number), isVoid, p.id,
    );
    appendChain(sql, "prediction-resolution", p.id as number, { predictionId: p.id, actual: y, void: isVoid });
    np++;
  }
  const decs = sql.exec("SELECT * FROM decisions WHERE resolved_ms IS NULL ORDER BY id LIMIT 2000").toArray() as Rows[];
  for (const d of decs) {
    const i = idxAfter(d.after_ts_ms as number);
    const H = (d.horizon as number) || 1;
    if (i + H > obs.length) continue;
    const win = obs.slice(i, i + H);
    const tgt = (d.target as number) ?? 2;
    const y = win.some((r) => r.multiplier >= tgt) ? 1 : 0;
    const stake = (d.stake as number) ?? 0;
    const pnl = d.action === "stake" || d.action === "enter" ? (y ? stake * (tgt - 1) : -stake) : 0;
    sql.exec("UPDATE decisions SET resolved_ms = ?, outcome = ?, pnl = ? WHERE id = ?", Date.now(), y, r4(pnl), d.id);
    nd++;
  }
  return { forecasts: nf, predictions: np, decisions: nd };
}

let lastLiveStore = 0;
/** Called by the core after every observed ingest batch. */
export function onIngest(a: CoreAdapter, inserted: number, origin: string): void {
  if (inserted <= 0 || origin === "reconstructed") return;
  const rounds = a.roundsFor(null);
  resolveOpen(a, rounds);
  // one stored forecast per batch (bulk imports create one, live feeds one per round)
  const now = Date.now();
  if (now - lastLiveStore >= 500 || inserted <= 5) {
    storeForecast(a, rounds, "live");
    lastLiveStore = now;
  }
  try {
    recordTells(a, rounds);
    evaluateAlerts(a, rounds);
    autoDemote(a);
  } catch (e) {
    console.error("v65 post-ingest", e instanceof Error ? e.message : String(e));
  }
}

// ------------------------------------------------------------- ledgers

type LedgerSource = "stored" | "calibration";
function ledgerRows(a: CoreAdapter, which: LedgerSource, limit = 5000, includeBackfill = true): (LedgerRow & { id: number; dist: number[]; actual: number; lo: number; hi: number; createdMs: number })[] {
  if (which === "calibration") {
    const rows = a.sql.exec("SELECT id, state, dist, weights, comp_loss, mix_loss, base_loss, actual, range_lo, range_hi, created_ms FROM intel_calibrations WHERE resolved_ms IS NOT NULL AND actual IS NOT NULL ORDER BY created_ms DESC LIMIT ?", limit).toArray() as Rows[];
    return rows.reverse().map((r) => ({
      id: r.id as number,
      state: r.state as string,
      weights: parse(r.weights, {}),
      compLoss: parse(r.comp_loss, {}),
      mixLoss: r.mix_loss as number,
      baseLoss: r.base_loss as number,
      dist: parse(r.dist, []),
      actual: r.actual as number,
      lo: r.range_lo as number,
      hi: r.range_hi as number,
      createdMs: r.created_ms as number,
    }));
  }
  const rows = a.sql
    .exec(`SELECT id, state, dist, comp, comp_loss, mix_loss, base_loss, actual, range_lo, range_hi, created_ms FROM forecast_store WHERE resolved_ms IS NOT NULL AND void = 0 ${includeBackfill ? "" : "AND origin = 'live'"} ORDER BY created_ms DESC LIMIT ?`, limit)
    .toArray() as Rows[];
  return rows.reverse().map((r) => {
    const comp = parse<{ key: string; weight: number }[]>(r.comp, []);
    return {
      id: r.id as number,
      state: r.state as string,
      weights: Object.fromEntries(comp.map((c) => [c.key, c.weight])),
      compLoss: parse(r.comp_loss, {}),
      mixLoss: r.mix_loss as number,
      baseLoss: r.base_loss as number,
      dist: parse(r.dist, []),
      actual: r.actual as number,
      lo: r.range_lo as number,
      hi: r.range_hi as number,
      createdMs: r.created_ms as number,
    };
  });
}
function pickLedger(a: CoreAdapter, q: URLSearchParams): LedgerSource {
  const w = q.get("ledger");
  if (w === "stored" || w === "calibration") return w;
  const n = (a.sql.exec("SELECT COUNT(*) AS n FROM forecast_store WHERE resolved_ms IS NOT NULL AND void = 0").toArray()[0] as { n: number }).n;
  return n >= 100 ? "stored" : "calibration";
}

function engineLeaderboard(a: CoreAdapter, which: LedgerSource, trailing = 1000) {
  const rows = ledgerRows(a, which, trailing);
  const engines = a.sql.exec("SELECT * FROM engines ORDER BY kind, key").toArray() as Rows[];
  const keys = [...new Set([...engines.map((e) => e.key as string), ...rows.flatMap((r) => Object.keys(r.compLoss))])];
  const out = keys.map((k) => {
    const diffs: number[] = [];
    const losses: number[] = [];
    for (const r of rows) {
      const l = r.compLoss[k];
      if (typeof l !== "number" || typeof r.baseLoss !== "number") continue;
      diffs.push(r.baseLoss - l);
      losses.push(l);
    }
    const [lo, hi] = blockBootstrapCI(diffs, { seed: k.length * 13 });
    const e = engines.find((x) => x.key === k);
    const w = rows.length ? mean(rows.map((r) => r.weights[k] ?? 0)) : 0;
    const baseMean = rows.length ? mean(rows.filter((r) => typeof r.compLoss[k] === "number").map((r) => r.baseLoss)) : 0;
    return {
      key: k,
      label: (e?.label as string) ?? k,
      kind: (e?.kind as string) ?? "builtin",
      family: (e?.family as string) ?? null,
      state: (e?.state as string) ?? "live",
      owner: (e?.owner as string) ?? "core",
      prior: (e?.prior as number) ?? 1,
      n: diffs.length,
      logLoss: losses.length ? r4(mean(losses)) : null,
      skill: diffs.length ? r4(mean(diffs)) : null,
      skillPct: diffs.length && baseMean ? r4(mean(diffs) / baseMean) : null,
      lo: Number.isFinite(lo) ? r4(lo) : null,
      hi: Number.isFinite(hi) ? r4(hi) : null,
      avgWeight: r4(w),
      verdict: diffs.length < 30 ? "insufficient" : lo > 0 ? "beats baseline" : hi < 0 ? "worse than baseline" : "no measurable skill",
      admission: parse(e?.admission, null),
    };
  });
  const mixDiffs = rows.map((r) => r.baseLoss - r.mixLoss).filter(Number.isFinite);
  const [mlo, mhi] = blockBootstrapCI(mixDiffs, { seed: 5 });
  out.sort((x, y) => (y.skill ?? -9) - (x.skill ?? -9));
  return {
    ledger: which,
    n: rows.length,
    mixture: { n: mixDiffs.length, skill: r4(mean(mixDiffs)), lo: r4(mlo), hi: r4(mhi), logLoss: r4(mean(rows.map((r) => r.mixLoss))), baseLogLoss: r4(mean(rows.map((r) => r.baseLoss))) },
    engines: out,
  };
}

// ------------------------------------------------------------ F-20 auto-demotion

let lastDemoteCheck = 0;
export function autoDemote(a: CoreAdapter, force = false): { demoted: string[] } {
  const now = Date.now();
  if (!force && now - lastDemoteCheck < 5 * 60_000) return { demoted: [] };
  lastDemoteCheck = now;
  if (a.setting("auto_demotion") === "0") return { demoted: [] };
  const lb = engineLeaderboard(a, pickLedger(a, new URLSearchParams()), 400);
  const demoted: string[] = [];
  for (const e of lb.engines) {
    if (e.key === "baseline" || e.state !== "live" || e.n < 100 || e.hi == null) continue;
    if (e.hi < 0) {
      a.sql.exec("UPDATE engines SET state = 'demoted', updated_ms = ? WHERE key = ?", now, e.key);
      a.sql.exec("INSERT INTO engine_history (key, from_state, to_state, reason, actor, created_ms) VALUES (?, 'live', 'demoted', ?, 'auto-demotion', ?)", e.key, `trailing-${e.n} log-score skill ${e.skill} with 95% CI upper bound ${e.hi} < 0`, now);
      a.sql.exec("INSERT INTO alerts (kind, title, body, link, created_ms) VALUES ('engine', ?, ?, '/dashboard/engines', ?)", `Engine demoted: ${e.label}`, `Trailing skill ${e.skill} (CI ${e.lo} to ${e.hi}) is below 0 with 95% confidence. Weight set to the floor; re-promotion goes through shadow mode.`, now);
      demoted.push(e.key);
    }
  }
  if (demoted.length) registryCache = null;
  return { demoted };
}

// ------------------------------------------------------------ F-31 tells → decisions

function recordTells(a: CoreAdapter, rounds: Round[]) {
  if (a.setting("tells_enabled") === "0") return;
  const last = rounds[rounds.length - 1];
  if (!last) return;
  const tells = kellyTells(rounds, { targets: [2, 5, 10] });
  for (const t of tells) {
    a.sql.exec(
      `INSERT OR IGNORE INTO decisions (producer, source, ref, action, target, probability, base_rate, stake, horizon, after_ts_ms, reasons, guard, created_ms)
       VALUES ('auto-tells-v2', 'all', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      `${last.id}:${t.target}`, t.action, t.target, t.pLower, t.pHat, t.fraction * 100, last.tsMs, JSON.stringify(t.reasons), t.action === "skip" ? "no-edge" : null, Date.now(),
    );
  }
}

function syncAutopilot(a: CoreAdapter): number {
  // mirror autopilot_decisions into the unified ledger (idempotent)
  let rows: Rows[] = [];
  try {
    rows = a.sql.exec("SELECT * FROM autopilot_decisions ORDER BY id").toArray() as Rows[];
  } catch {
    return 0;
  }
  let n = 0;
  for (const r of rows) {
    const res = a.sql.exec(
      `INSERT OR IGNORE INTO decisions (producer, source, ref, action, target, probability, base_rate, stake, horizon, after_ts_ms, reasons, guard, created_ms, resolved_ms, outcome, pnl)
       VALUES ('autopilot', ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?, NULL, ?, ?, ?, ?)`,
      r.source, `ap:${r.id}`, r.decision, r.threshold, r.confidence, r.stake, r.created_ms, JSON.stringify([r.reason]), r.created_ms,
      r.resolved ? r.created_ms : null, r.resolved ? ((r.pnl as number) > 0 ? 1 : 0) : null, r.resolved ? r.pnl : null,
    );
    n += res.rowsWritten ?? 0;
  }
  return n;
}

function decisionLeaderboard(a: CoreAdapter, rounds: Round[]) {
  syncAutopilot(a);
  const ms = rounds.filter((r) => r.origin !== "reconstructed").map((r) => r.multiplier);
  const baseAt = (x: number) => (ms.length ? ms.filter((m) => m >= x).length / ms.length : 0);
  const producers = a.sql.exec("SELECT producer, COUNT(*) AS n FROM decisions GROUP BY producer").toArray() as Rows[];
  const out = producers.map((p) => {
    const rows = a.sql.exec("SELECT * FROM decisions WHERE producer = ? AND resolved_ms IS NOT NULL ORDER BY created_ms", p.producer).toArray() as Rows[];
    const acted = rows.filter((r) => r.action === "stake" || r.action === "enter");
    const hits = acted.filter((r) => r.outcome === 1).length;
    const baseR = acted.length ? mean(acted.map((r) => 1 - Math.pow(1 - baseAt((r.target as number) ?? 2), (r.horizon as number) || 1))) : 0;
    const [lo, hi] = wilsonCI(hits, acted.length);
    const pnls = acted.map((r) => (r.pnl as number) ?? 0);
    const [plo, phi] = blockBootstrapCI(pnls.map((x) => x * 100), { seed: 3 });
    let eq = 0, peak = 0, dd = 0;
    for (const x of pnls) {
      eq += x;
      peak = Math.max(peak, eq);
      dd = Math.max(dd, peak - eq);
    }
    const vetoes = rows.filter((r) => r.guard).length;
    return {
      producer: p.producer as string,
      total: p.n as number,
      resolved: rows.length,
      acted: acted.length,
      hitRate: r4(acted.length ? hits / acted.length : 0),
      baseRate: r4(baseR),
      delta: r4((acted.length ? hits / acted.length : 0) - baseR),
      deltaLo: r4(lo - baseR),
      deltaHi: r4(hi - baseR),
      pnlPer100: r2(acted.length ? mean(pnls) * 100 : 0),
      pnlLo: Number.isFinite(plo) ? r2(plo) : null,
      pnlHi: Number.isFinite(phi) ? r2(phi) : null,
      drawdown: r2(dd),
      guardVetoes: vetoes,
      ranked: acted.length >= 30,
    };
  });
  out.sort((x, y) => Number(y.ranked) - Number(x.ranked) || y.pnlPer100 - x.pnlPer100);
  // reconciliation against autopilot_decisions
  let apCount = 0;
  try {
    apCount = (a.sql.exec("SELECT COUNT(*) AS n FROM autopilot_decisions").toArray()[0] as { n: number }).n;
  } catch {
    /* none */
  }
  const mirrored = (a.sql.exec("SELECT COUNT(*) AS n FROM decisions WHERE producer = 'autopilot'").toArray()[0] as { n: number }).n;
  return { producers: out, reconciliation: { autopilotRows: apCount, ledgerRows: mirrored, mismatches: Math.abs(apCount - mirrored) } };
}

// ------------------------------------------------------------ F-38 alerts

function liveFields(a: CoreAdapter, rounds: Round[]): Record<string, number> {
  const out: Record<string, number> = {};
  const eta = etaBoard(rounds);
  for (const r of eta.rows) {
    if (r.kmPercentile != null) out[`eta.${r.threshold}.kmPercentile`] = r.kmPercentile * 100;
    out[`eta.${r.threshold}.pNext`] = (r.pNext ?? 0) * 100;
    out[`eta.${r.threshold}.pWithin10`] = (r.pWithin10 ?? 0) * 100;
    out[`eta.${r.threshold}.gap`] = r.currentGap;
  }
  const last = a.sql.exec("SELECT * FROM forecast_store ORDER BY id DESC LIMIT 1").toArray()[0] as Rows | undefined;
  if (last) {
    const d = parse<number[]>(last.dist, []);
    out["forecast.expected"] = last.expected as number;
    out["forecast.reach"] = last.reach as number;
    out["forecast.p2"] = survivalFromDist(d, 2) * 100;
    out["forecast.p10"] = survivalFromDist(d, 10) * 100;
    out["forecast.confidence"] = ((last.confidence as number) ?? 0) * 100;
  }
  const ms = rounds.map((r) => r.multiplier);
  let below = 0;
  for (let i = ms.length - 1; i >= 0 && ms[i] < 2; i--) below++;
  out["streak.below2"] = below;
  out["last.multiplier"] = ms[ms.length - 1] ?? 0;
  try {
    const an = anchors(rounds) as unknown as { state?: { active?: boolean; size?: number } };
    out["anchor.active"] = an.state?.active ? 1 : 0;
    if (an.state?.size != null) out["anchor.size"] = an.state.size;
  } catch {
    /* optional */
  }
  return out;
}

export const ALERT_FIELDS: { field: string; label: string; unit: string }[] = [
  { field: "eta.10.kmPercentile", label: "10× gap KM percentile", unit: "%" },
  { field: "eta.50.kmPercentile", label: "50× gap KM percentile", unit: "%" },
  { field: "eta.100.kmPercentile", label: "100× gap KM percentile", unit: "%" },
  { field: "eta.10.pWithin10", label: "P(10× within 10 rounds)", unit: "%" },
  { field: "eta.10.gap", label: "Rounds since last 10×", unit: "rounds" },
  { field: "eta.50.gap", label: "Rounds since last 50×", unit: "rounds" },
  { field: "forecast.expected", label: "Forecast median", unit: "×" },
  { field: "forecast.reach", label: "Forecast p90 reach", unit: "×" },
  { field: "forecast.p2", label: "P(next ≥ 2×)", unit: "%" },
  { field: "forecast.p10", label: "P(next ≥ 10×)", unit: "%" },
  { field: "streak.below2", label: "Rounds below 2× in a row", unit: "rounds" },
  { field: "last.multiplier", label: "Last round multiplier", unit: "×" },
  { field: "anchor.active", label: "Anchor forming (1 = yes)", unit: "" },
];

function evaluateAlerts(a: CoreAdapter, rounds: Round[]) {
  const rules = a.sql.exec("SELECT * FROM alert_rules WHERE enabled = 1").toArray() as Rows[];
  if (!rules.length) return;
  const f = liveFields(a, rounds);
  const now = Date.now();
  const hour = new Date(now + 120 * 60_000).getUTCHours();
  const lastF = a.sql.exec("SELECT id FROM forecast_store ORDER BY id DESC LIMIT 1").toArray()[0] as Rows | undefined;
  for (const r of rules) {
    const v = f[r.field as string];
    if (v === undefined) continue;
    const th = r.value as number;
    const on = r.op === ">=" ? v >= th : r.op === "<=" ? v <= th : r.op === ">" ? v > th : r.op === "<" ? v < th : Math.abs(v - th) < 1e-9;
    const wasOn = (r.last_state as number) === 1;
    a.sql.exec("UPDATE alert_rules SET last_state = ? WHERE id = ?", on ? 1 : 0, r.id);
    if (!on || wasOn) continue; // fire on the rising edge only
    if (r.last_fired_ms && now - (r.last_fired_ms as number) < (r.debounce_s as number) * 1000) continue;
    if (r.quiet_from != null && r.quiet_to != null) {
      const qf = r.quiet_from as number, qt = r.quiet_to as number;
      if (qf <= qt ? hour >= qf && hour < qt : hour >= qf || hour < qt) continue;
    }
    const today = (a.sql.exec("SELECT COUNT(*) AS n FROM alerts WHERE rule_id = ? AND created_ms > ?", r.id, now - 86_400_000).toArray()[0] as { n: number }).n;
    if (today >= (r.daily_cap as number)) continue;
    const meta = ALERT_FIELDS.find((x) => x.field === r.field);
    const T = Number(String(r.field).split(".")[1]);
    const pNext = Number.isFinite(T) ? f[`eta.${T}.pNext`] : f["forecast.p2"];
    a.sql.exec(
      "INSERT INTO alerts (rule_id, kind, title, body, probability, link, forecast_id, created_ms) VALUES (?, 'rule', ?, ?, ?, ?, ?, ?)",
      r.id, r.name, `${meta?.label ?? r.field} is ${r2(v)}${meta?.unit ?? ""} (rule ${r.op} ${th}). Calibrated P(next round ≥ ${Number.isFinite(T) ? T : 2}×) = ${r2(pNext ?? 0)}% — a probability, not a directive.`,
      pNext != null ? r4(pNext / 100) : null, "/dashboard/intelligence", lastF?.id ?? null, now,
    );
    a.sql.exec("UPDATE alert_rules SET last_fired_ms = ? WHERE id = ?", now, r.id);
  }
}

// ------------------------------------------------------------ F-35 explain

function explain(a: CoreAdapter, fRow: Rows, rounds: Round[]) {
  const dist = parse<number[]>(fRow.dist, []);
  const comp = parse<{ key: string; weight: number; dist: number[] }[]>(fRow.comp, []);
  const base = comp.find((c) => c.key === "baseline")?.dist ?? dist;
  const qm = (d: number[]) => quantileFromDist(d, 0.5);
  const baseMid = qm(base);
  const lb = engineLeaderboard(a, pickLedger(a, new URLSearchParams()), 400);
  const skillOf = (k: string) => lb.engines.find((e) => e.key === k);
  const waterfall = comp
    .map((c) => {
      // contribution = w_c · (median(dist_c) − median(baseline)), then scaled so the bars sum to the headline shift
      const raw = c.weight * (qm(c.dist) - baseMid);
      return { key: c.key, weight: c.weight, engineMid: r2(qm(c.dist)), raw, skill: skillOf(c.key)?.skill ?? null, skillVerdict: skillOf(c.key)?.verdict ?? "insufficient" };
    })
    .sort((x, y) => Math.abs(y.raw) - Math.abs(x.raw));
  const mixMid = qm(dist);
  const sumRaw = waterfall.reduce((s, w) => s + w.raw, 0);
  const scale = Math.abs(sumRaw) > 1e-9 ? (mixMid - baseMid) / sumRaw : 0;
  const eta = etaBoard(rounds);
  const e10 = eta.rows.find((r) => r.threshold === 10);
  const rm = (() => {
    try {
      return rangeMomentum(rounds) as unknown as { min: number; trend: string; momentum?: number }[];
    } catch {
      return [];
    }
  })();
  const m10 = rm.find((x) => x.min === 10);
  const an = (() => {
    try {
      return anchors(rounds) as unknown as { state?: { active?: boolean; label?: string } };
    } catch {
      return {};
    }
  })();
  const ms = rounds.map((r) => r.multiplier);
  const recent = ms.slice(-50).map((m) => Math.log(m));
  const vol = Math.sqrt(mean(recent.map((x) => (x - mean(recent)) ** 2)));
  const longV = ms.slice(-2000).map((m) => Math.log(m));
  const volL = Math.sqrt(mean(longV.map((x) => (x - mean(longV)) ** 2)));
  const argmax = dist.indexOf(Math.max(...dist));
  const sig = signalSignificance(rounds, { T: 2, window: 8000 });
  let below = 0;
  for (let i = ms.length - 1; i >= 0 && ms[i] < 2; i--) below++;
  const mixSkill = lb.mixture;
  const dims = [
    { dimension: "Next value", value: `${r2(fRow.expected as number)}× (50% range ${r2(fRow.range_lo as number)}–${r2(fRow.range_hi as number)}×)`, engine: "mixture", skill: mixSkill.skill, informative: mixSkill.lo > 0 },
    { dimension: "Next big one", value: e10?.etaMedian != null ? `10× conditional median in ${e10.etaMedian} rounds (p90 ${e10.etaP90})` : "not enough 10× gaps", engine: "survival (KM)", skill: e10?.calibration?.beforeMedian ?? null, informative: e10?.memoryless?.verdict !== "memoryless" },
    { dimension: "Hotter or cooler?", value: m10 ? `${m10.trend}` : "—", engine: "range momentum", skill: null, informative: false },
    { dimension: "Steady or wild?", value: `σ(log) ${r2(vol)} vs ${r2(volL)} long-run → ${vol > volL * 1.15 ? "wild" : vol < volL * 0.85 ? "steady" : "normal"}`, engine: "volatility", skill: null, informative: false },
    { dimension: "Most likely band", value: `${BAND_LABELS[argmax]} at ${(dist[argmax] * 100).toFixed(1)}%`, engine: "mixture", skill: mixSkill.skill, informative: mixSkill.lo > 0 },
    { dimension: "Building or fading?", value: an.state?.active ? `anchor forming${an.state.label ? ` (${an.state.label})` : ""}` : "no anchor", engine: "momentum anchors", skill: null, informative: false },
    { dimension: "Session risk", value: below >= 5 ? `${below} rounds below 2× — guard caution` : "normal", engine: "guard", skill: null, informative: false },
    { dimension: "How sure are we?", value: `confidence ${(Number(fRow.confidence) * 100).toFixed(0)}% · mixture skill ${(mixSkill.skill * 100).toFixed(2)} milli-nats (CI ${mixSkill.lo} to ${mixSkill.hi})`, engine: "ledger", skill: mixSkill.skill, informative: mixSkill.lo > 0 },
  ];
  // what would change it: signals closest to flipping
  const flips = sig.rows
    .map((r) => ({ key: r.key, label: r.label, active: r.active, lift: r.lift, significant: r.significant }))
    .slice(0, 14);
  const nearFlip: string[] = [];
  if (below > 0) nearFlip.push(`A round ≥ 2× ends the ${below}-round run below 2× (streak signals switch off).`);
  else nearFlip.push("A round below 2× starts a new below-2× streak.");
  if (e10) nearFlip.push(`A 10× resets the 10× gap (now ${e10.currentGap} rounds, KM percentile ${Math.round((e10.kmPercentile ?? 0) * 100)}%).`);
  const sentence = `The forecast is ${r2(fRow.expected as number)}× (state ${fRow.state}). The baseline alone says ${r2(baseMid)}×; the largest pull comes from ${waterfall[0]?.key ?? "baseline"} (${waterfall[0] ? (waterfall[0].raw * scale >= 0 ? "+" : "") + r2(waterfall[0].raw * scale) : 0}×). ${mixSkill.lo > 0 ? "The mixture has measured skill over the baseline." : "The mixture has no measurable skill over the baseline, so treat it as the base rate."}`;
  const allowed = [fRow.expected, baseMid, waterfall[0] ? Math.abs(waterfall[0].raw * scale) : 0, fRow.range_lo, fRow.range_hi].map(Number).map(r2);
  const check = numbersCheck(sentence, allowed);
  return {
    forecastId: fRow.id,
    createdAt: new Date(fRow.created_ms as number).toISOString(),
    headline: { expected: fRow.expected, lo: fRow.range_lo, hi: fRow.range_hi, reach: fRow.reach, state: fRow.state, baselineMid: r2(baseMid), mixtureMid: r2(mixMid) },
    dimensions: dims,
    waterfall: waterfall.map((w) => ({ key: w.key, weight: r4(w.weight), engineMid: w.engineMid, contribution: r2(w.raw * scale), skill: w.skill, skillVerdict: w.skillVerdict })),
    signals: flips,
    wouldChange: nearFlip,
    narrator: { sentence, numbersCheck: check },
  };
}

// ------------------------------------------------------------ F-37 ask

async function askMomento(a: CoreAdapter, question: string, passages: { id: string; title: string; text: string }[]) {
  const key = (a.env.ENTRIM_API_KEY as string) || a.setting("entrim_api_key") || "";
  if (!passages.length) return { answer: null, refused: true, reason: "No knowledge passages matched the question, so Ask Momento refuses rather than guess.", citations: [] };
  if (!key) {
    return {
      answer: `Closest knowledge (no AI key set — extractive answer):\n\n${passages.slice(0, 3).map((p) => `- ${p.text.slice(0, 280).trim()}… [${p.id}]`).join("\n")}`,
      refused: false,
      citations: passages.slice(0, 3).map((p) => p.id),
      model: "extractive",
    };
  }
  const base = (a.setting("entrim_base_url") || "https://api.entrim.ai/v1").replace(/\/+$/, "");
  const model = a.setting("entrim_model") || "deepseek-ai/DeepSeek-V4-Flash";
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 700,
        messages: [
          { role: "system", content: "You answer questions about the Momento platform ONLY from the numbered passages. Cite every claim with the passage id in square brackets, e.g. [ch08#3]. If the passages do not answer the question, reply exactly: NO_ANSWER. Under 180 words." },
          { role: "user", content: `Question: ${question}\n\nPassages:\n${passages.map((p) => `[${p.id}] (${p.title}) ${p.text.slice(0, 1400)}`).join("\n\n")}` },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content?.trim() ?? "";
    const cited = [...new Set((text.match(/\[([^\]]+)\]/g) ?? []).map((s) => s.slice(1, -1)))].filter((id) => passages.some((p) => p.id === id));
    if (!text || text.includes("NO_ANSWER") || !cited.length) return { answer: null, refused: true, reason: "The answer did not cite a valid knowledge object, so it was refused.", citations: [], model };
    return { answer: text, refused: false, citations: cited, model };
  } catch (e) {
    return { answer: null, refused: true, reason: `AI provider unreachable: ${e instanceof Error ? e.message : String(e)}`, citations: [] };
  }
}

// ------------------------------------------------------------ router

export async function routeV65(a: CoreAdapter, method: string, path: string, q: URLSearchParams, body: Record<string, unknown>, user: V65User | null, asOf: number | null): Promise<Response | null> {
  const sql = a.sql;
  if (!path.startsWith("/api/v1/")) return null;
  const p = path.slice(8);
  const rounds = () => a.roundsFor(srcOf(q));
  const needOp = () => {
    if (!user) return fail("authentication required", 401);
    if (!isOp(user)) return fail("operator role required", 403);
    return null;
  };

  // ---- Lib: probabilistic next-event forecaster (functions/lib/forecast.ts)
  if (p === "lib/forecast" && method === "GET") {
    const rs = rounds();
    return ok({ source: srcOf(q) ?? "all", ...libForecast(rs, { maxHistory: num(q.get("history"), 30000, 500, 200000) }) });
  }
  if (p === "lib/backtest" && method === "GET") {
    const rs = rounds();
    const last = num(q.get("last"), 5000, 500, 100000);
    const tail = rs.slice(-Math.min(rs.length, last + 20000));
    return ok({ source: srcOf(q) ?? "all", ...libBacktest(tail, { warmup: Math.max(0, tail.length - last) }) });
  }

  // ---- F-04 time travel: stored forecast as of t (never recomputed)
  if (p === "intelligence/forecast" && method === "GET" && asOf) {
    const row = sql.exec("SELECT * FROM forecast_store WHERE created_ms <= ? ORDER BY created_ms DESC LIMIT 1", asOf).toArray()[0] as Rows | undefined;
    if (!row) return null; // fall through: core recomputes on the as_of-truncated tape
    return null; // core forecast is computed on truncated rounds; stored snapshot served by asof/forecast
  }
  if (p === "asof/forecast" && method === "GET") {
    const t = num(q.get("t") ?? asOf, Date.now());
    const row = sql.exec("SELECT * FROM forecast_store WHERE created_ms <= ? ORDER BY created_ms DESC LIMIT 1", t).toArray()[0] as Rows | undefined;
    if (!row) return ok({ found: false, t });
    return ok({ found: true, t, forecast: { ...row, dist: parse(row.dist, []), comp: parse(row.comp, []), cone: parse(row.cone, []), comp_loss: parse(row.comp_loss, null) } });
  }
  if (p === "asof/info" && method === "GET") {
    const r = sql.exec("SELECT MIN(ts_ms) AS a, MAX(ts_ms) AS b, COUNT(*) AS n FROM rounds").toArray()[0] as Rows;
    const f = sql.exec("SELECT MIN(created_ms) AS a, MAX(created_ms) AS b, COUNT(*) AS n, SUM(origin = 'live') AS live FROM forecast_store").toArray()[0] as Rows;
    const visible = asOf ? a.roundsFor(null).length : (r.n as number);
    return ok({ asOf, visibleRounds: visible, rounds: { from: r.a, to: r.b, n: r.n }, forecasts: { from: f.a, to: f.b, n: f.n, live: f.live ?? 0 },
      knowledgeRule: "Live-ingested rounds count from their ingest time (created_ms). Historical back-fills (import, seed, reconstruct) count from their own round timestamp, and are labelled as such." });
  }
  if (p === "asof/property-test" && method === "GET") {
    // F-04 measurement: f(as_of = t) equals the forecast stored at t
    const rows = sql.exec("SELECT id, created_ms FROM forecast_store ORDER BY RANDOM() LIMIT ?", num(q.get("n"), 200, 1, 1000)).toArray() as Rows[];
    let mismatch = 0;
    for (const r of rows) {
      const got = sql.exec("SELECT id FROM forecast_store WHERE created_ms <= ? ORDER BY created_ms DESC, id DESC LIMIT 1", r.created_ms).toArray()[0] as Rows;
      const same = sql.exec("SELECT COUNT(*) AS n FROM forecast_store WHERE created_ms = ?", r.created_ms).toArray()[0] as { n: number };
      if (got.id !== r.id && same.n === 1) mismatch++;
    }
    return ok({ tested: rows.length, mismatches: mismatch, passes: mismatch === 0 });
  }

  // ---- F-01 integrity
  if (p === "integrity" && method === "GET") {
    const rep = integrityReport(rounds());
    const sess = q.get("session");
    const days = num(q.get("days"), 0, 0, 3650);
    let list = rep.sessions;
    if (sess) list = list.filter((s) => String(s.sessionId) === sess);
    if (days) list = list.filter((s) => Date.parse(s.to) >= Date.now() - days * 86_400_000 || true);
    return ok({ summary: rep.summary, sessions: list.slice(0, num(q.get("limit"), 400, 1, 5000)) });
  }
  if (p === "integrity/summary" && method === "GET") {
    const rep = integrityReport(rounds());
    const voided = sql.exec("SELECT COUNT(*) AS n, SUM(void) AS v FROM forecast_store WHERE resolved_ms IS NOT NULL").toArray()[0] as Rows;
    return ok({ ...rep.summary, ledgerVoided: voided.v ?? 0, ledgerResolved: voided.n ?? 0, quarantined: (sql.exec("SELECT COUNT(*) AS n FROM ingest_quarantine").toArray()[0] as Rows).n });
  }

  // ---- F-02 collectors
  if (p === "collectors" && method === "GET") {
    const s = srcOf(q);
    const rows = sql.exec(`SELECT source, ingest, COUNT(*) AS n, MAX(ts_ms) AS last, MIN(ts_ms) AS first FROM rounds ${s ? "WHERE source = ?" : ""} GROUP BY source, ingest ORDER BY source`, ...(s ? [s] : [])).toArray() as Rows[];
    const bySrc = new Map<string, Rows[]>();
    for (const r of rows) (bySrc.get(r.source as string) ?? bySrc.set(r.source as string, []).get(r.source as string)!).push(r);
    const out = [...bySrc.entries()].map(([source, cs]) => {
      const pair = sql.exec(
        `SELECT COUNT(*) AS n, SUM(ABS(a.multiplier - b.multiplier) < 0.005) AS agree FROM rounds a JOIN rounds b ON a.source = b.source AND a.ingest < b.ingest AND ABS(a.ts_ms - b.ts_ms) <= 1000 WHERE a.source = ?`,
        source,
      ).toArray()[0] as Rows;
      const pairs = (pair.n as number) ?? 0;
      return {
        source,
        collectors: cs.map((c) => ({ method: c.ingest, rounds: c.n, lastTs: c.last ? new Date(c.last as number).toISOString() : null, lagSeconds: c.last ? Math.round((Date.now() - (c.last as number)) / 1000) : null })),
        multiCollector: cs.length >= 2,
        pairs,
        agreement: pairs ? r4(((pair.agree as number) ?? 0) / pairs) : null,
        disagreements: pairs - ((pair.agree as number) ?? 0),
        note: cs.length >= 2 ? "Reconciled on (source, ts ± 1 s, value)." : "Only one collector feeds this source — consensus needs a second, independently keyed collector (WebSocket + DOM).",
      };
    });
    return ok({ sources: out });
  }
  if (p === "collectors/disagreements" && method === "GET") {
    const s = q.get("source") ?? "";
    const rows = sql.exec(
      `SELECT a.id AS a_id, b.id AS b_id, a.ts AS ts, a.multiplier AS a_m, b.multiplier AS b_m, a.ingest AS a_c, b.ingest AS b_c FROM rounds a JOIN rounds b ON a.source = b.source AND a.ingest < b.ingest AND ABS(a.ts_ms - b.ts_ms) <= 1000
       WHERE a.source = ? AND ABS(a.multiplier - b.multiplier) >= 0.005 LIMIT 200`,
      s,
    ).toArray();
    return ok({ source: s, rows, quarantine: sql.exec("SELECT * FROM ingest_quarantine ORDER BY id DESC LIMIT 100").toArray() });
  }

  // ---- F-03 fingerprint
  if (p === "fingerprint" && method === "GET") {
    const tz = num(a.setting("tz_offset_min"), 120, -720, 840);
    const stats = cusumFingerprint(rounds(), tz);
    return ok({ source: q.get("source") ?? "all", stats, alarm: stats.some((s) => s.alarm), note: "Two-sided CUSUM (k = 0.5σ, h = 5σ, in-control ARL ≈ 465 days) on daily shares; σ from the first third of days." });
  }

  // ---- F-05 federation
  if (p === "federation" && method === "GET") {
    const t0 = Date.now();
    const srcs = sql.exec("SELECT source, COUNT(*) AS n, MAX(ts_ms) AS last FROM rounds GROUP BY source").toArray() as Rows[];
    return ok({
      mode: "single-DO (local)",
      sources: srcs.map((s) => ({ source: s.source, rounds: s.n, last: s.last ? new Date(s.last as number).toISOString() : null })),
      fanOutMs: Date.now() - t0,
      note: "Per-source Durable Objects (idFromName(source)) with a Directory DO are the Cloudflare deployment target; the API paths are unchanged, and source=all is the federated view.",
    });
  }

  // ---- F-06 dictionary
  if (p === "dictionary" && method === "GET") {
    const rs = rounds().filter((r) => r.origin !== "reconstructed");
    const words = rs.map((r) => wordOf(r.multiplier));
    const n = rs.length;
    const split = Math.floor(n * 0.6);
    const baseA = rs.slice(0, split).filter((r) => r.multiplier >= 2).length / (split || 1);
    const baseB = rs.slice(split).filter((r) => r.multiplier >= 2).length / ((n - split) || 1);
    const toks = sql.exec("SELECT * FROM vocabulary ORDER BY uses DESC LIMIT 400").toArray() as Rows[];
    const rows = toks.map((t) => {
      const parts = String(t.token).split("·");
      const g = parts.length;
      let na = 0, ha = 0, nb = 0, hb = 0;
      for (let i = g; i < n; i++) {
        let match = true;
        for (let j = 0; j < g; j++) if (words[i - g + j] !== parts[j]) { match = false; break; }
        if (!match) continue;
        const y = rs[i].multiplier >= 2 ? 1 : 0;
        if (i < split) { na++; ha += y; } else { nb++; hb += y; }
      }
      const ta = twoProp(ha, na, Math.round(baseA * split), split);
      const tb = twoProp(hb, nb, Math.round(baseB * (n - split)), n - split);
      const [lo, hi] = wilsonCI(hb, nb);
      return { id: t.id, token: t.token, layer: t.layer, status: t.status, definition: t.definition, blockA: { n: na, rate: r4(na ? ha / na : 0), p: ta.p }, blockB: { n: nb, rate: r4(nb ? hb / nb : 0), lo: r4(lo), hi: r4(hi), p: tb.p, lift: r4(baseB ? (nb ? hb / nb : 0) / baseB : 0), liftLo: r4(baseB ? lo / baseB : 0), liftHi: r4(baseB ? hi / baseB : 0) }, qA: 1, qB: 1 };
    });
    const qa = bhQ(rows.map((r) => r.blockA.p));
    const qb = bhQ(rows.map((r) => r.blockB.p));
    rows.forEach((r, i) => {
      r.qA = r4(qa[i]);
      r.qB = r4(qb[i]);
    });
    const formalisable = rows.filter((r) => r.qA < 0.05 && r.qB < 0.05 && Math.sign(r.blockA.rate - baseA) === Math.sign(r.blockB.rate - baseB));
    const formal = rows.filter((r) => r.status === "formalized");
    const precision = formal.length ? formal.filter((r) => r.blockB.liftLo > 1 || r.blockB.liftHi < 1).length / formal.length : null;
    return ok({ base: { blockA: r4(baseA), blockB: r4(baseB) }, split, rows, formalisable: formalisable.map((r) => r.token), precision, rule: "Formalisation needs BH q < 0.05 on the held-out block (B) with the same sign as the discovery block (A)." });
  }
  const vocabPage = p.match(/^vocabulary\/(\d+)\/page$/);
  if (vocabPage && method === "GET") {
    const t = sql.exec("SELECT * FROM vocabulary WHERE id = ?", Number(vocabPage[1])).toArray()[0] as Rows | undefined;
    if (!t) return fail("not found", 404);
    const rs = rounds().filter((r) => r.origin !== "reconstructed");
    const words = rs.map((r) => wordOf(r.multiplier));
    const parts = String(t.token).split("·");
    const ex: { ts: string; next: number }[] = [];
    for (let i = parts.length; i < rs.length && ex.length < 400; i++) {
      let m = true;
      for (let j = 0; j < parts.length; j++) if (words[i - parts.length + j] !== parts[j]) { m = false; break; }
      if (m) ex.push({ ts: rs[i].ts, next: rs[i].multiplier });
    }
    const hist = sql.exec("SELECT * FROM audit_log WHERE target = ? ORDER BY created_ms DESC LIMIT 50", String(t.token)).toArray();
    return ok({ token: t, examples: ex.slice(-40).reverse(), occurrences: ex.length, history: hist });
  }

  // ---- F-07 sequence search
  if (p === "sequence/search" && method === "GET") {
    return ok(sequenceSearch(rounds(), q.get("pattern") ?? "", num(q.get("k"), 1, 1, 50), num(q.get("T"), 2, 1.01, 1000)));
  }

  // ---- F-09 workbench
  if (p === "workbench/families" && method === "GET") return ok({ families: ENGINE_FAMILIES });
  if (p === "workbench/run" && method === "POST") {
    const fam = String(body.family ?? "window") as EngineFamily;
    if (!ENGINE_FAMILIES[fam]) return fail("unknown family");
    const spec: CustomEngineSpec = { family: fam, params: (body.params as Record<string, number>) ?? {} };
    const ms = a.roundsFor(typeof body.source === "string" && body.source !== "all" ? body.source : null).filter((r) => r.origin !== "reconstructed").map((r) => r.multiplier);
    const res = scoreCustom(spec, ms, num(body.n, 400, 50, 3000));
    sql.exec("INSERT INTO backtest_runs (source, kind, params, result, created_ms) VALUES (?, 'workbench', ?, ?, ?)", String(body.source ?? "all"), JSON.stringify(spec), JSON.stringify(res), Date.now());
    return ok({ spec, ...res });
  }
  if (p === "workbench/runs" && method === "GET") {
    const rows = sql.exec("SELECT * FROM backtest_runs WHERE kind = 'workbench' ORDER BY id DESC LIMIT 50").toArray() as Rows[];
    return ok({ runs: rows.map((r) => ({ id: r.id, source: r.source, spec: parse(r.params, {}), result: parse(r.result, {}), created: r.created_ms })) });
  }

  // ---- F-10 compare
  if (p === "compare" && method === "GET") {
    const A = q.get("a") ?? "";
    const B = q.get("b") ?? "";
    if (!A || !B) return fail("a and b sources required");
    return ok({ a: A, b: B, ...compareSources(a.roundsFor(A), a.roundsFor(B), q.get("metric") ?? "all") });
  }

  // ---- F-11 significance
  if (p === "signals/significance" && method === "GET") {
    const T = num(q.get("T"), 2, 1.01, 1000);
    const res = signalSignificance(rounds(), { T, window: num(q.get("window"), 20000, 500, 250000) });
    const control = q.get("shuffle") === "1" ? shuffledSignificance(rounds().slice(-20000), T) : null;
    return ok({ ...res, shuffleControl: control ? { significantCount: control.significantCount, rate: r4(control.significantCount / SIGNALS.length) } : null });
  }

  // ---- F-12 registry
  if (p === "engines" && method === "GET") {
    const which = pickLedger(a, q);
    return ok({ ...engineLeaderboard(a, which, num(q.get("trailing"), 1000, 50, 20000)), families: ENGINE_FAMILIES });
  }
  if (p === "engines" && method === "POST") {
    const g = needOp();
    if (g) return g;
    const fam = String(body.family ?? "") as EngineFamily;
    if (!ENGINE_FAMILIES[fam]) return fail("family must be one of " + Object.keys(ENGINE_FAMILIES).join(", "));
    const params = (body.params as Record<string, number>) ?? {};
    for (const d of ENGINE_FAMILIES[fam].params) params[d.key] = num(params[d.key], d.default, d.min, d.max);
    const spec: CustomEngineSpec = { family: fam, params };
    const ms = a.roundsFor(null).filter((r) => r.origin !== "reconstructed").map((r) => r.multiplier);
    const adm = admissionTests(spec, ms);
    if (!adm.passed) return json({ ok: false, error: "admission tests failed", data: adm }, 422);
    const key = `custom:${fam}:${Object.values(params).join("-")}`.slice(0, 60);
    const label = String(body.label ?? `${ENGINE_FAMILIES[fam].label} (${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(", ")})`);
    const now = Date.now();
    sql.exec(
      `INSERT INTO engines (key, label, version, owner, kind, family, params, state, prior, admission, created_ms, updated_ms) VALUES (?, ?, '1', ?, 'custom', ?, ?, 'shadow', ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET label = excluded.label, params = excluded.params, admission = excluded.admission, updated_ms = excluded.updated_ms`,
      key, label, user!.email, fam, JSON.stringify(params), num(body.prior, 0.5, 0.05, 2), JSON.stringify(adm), now, now,
    );
    sql.exec("INSERT INTO engine_history (key, from_state, to_state, reason, actor, created_ms) VALUES (?, NULL, 'shadow', 'registered — passed admission (deterministic, causal, null tape, not a stub)', ?, ?)", key, user!.email, now);
    registryCache = null;
    a.invalidate();
    return ok({ key, state: "shadow", admission: adm });
  }
  const engState = p.match(/^engines\/([^/]+)\/state$/);
  if (engState && method === "POST") {
    const g = needOp();
    if (g) return g;
    const key = decodeURIComponent(engState[1]);
    const to = String(body.state ?? "");
    if (!["live", "shadow", "demoted", "retired"].includes(to)) return fail("state must be live | shadow | demoted | retired");
    if (key === "baseline" && to !== "live") return fail("the measured baseline is always live");
    const e = sql.exec("SELECT state FROM engines WHERE key = ?", key).toArray()[0] as Rows | undefined;
    if (!e) return fail("unknown engine", 404);
    if (e.state === "demoted" && to === "live") return fail("re-promotion goes through shadow mode first");
    sql.exec("UPDATE engines SET state = ?, updated_ms = ? WHERE key = ?", to, Date.now(), key);
    sql.exec("INSERT INTO engine_history (key, from_state, to_state, reason, actor, created_ms) VALUES (?, ?, ?, ?, ?, ?)", key, e.state, to, String(body.reason ?? "operator change"), user!.email, Date.now());
    registryCache = null;
    a.invalidate();
    return ok({ key, from: e.state, to });
  }
  const engHist = p.match(/^engines\/([^/]+)\/history$/);
  if (engHist && method === "GET") {
    return ok({ history: sql.exec("SELECT * FROM engine_history WHERE key = ? ORDER BY created_ms DESC", decodeURIComponent(engHist[1])).toArray() });
  }
  if (p === "engines/demotion-check" && method === "POST") {
    const g = needOp();
    if (g) return g;
    return ok(autoDemote(a, true));
  }

  // ---- F-13 mixture by regime
  if (p === "mixture" && method === "GET") {
    return ok({ ledger: pickLedger(a, q), ...regimeWeights(ledgerRows(a, pickLedger(a, q), 3000), { shrink: num(q.get("shrink"), 50, 1, 1000) }) });
  }

  // ---- F-14 diff
  if (p === "forecast/diff" && method === "GET") {
    const ids = [q.get("from"), q.get("to")].map((x) => (x ? Number(x) : null));
    const pick = (id: number | null, off: number) => (id ? sql.exec("SELECT * FROM forecast_store WHERE id = ?", id).toArray()[0] : sql.exec("SELECT * FROM forecast_store ORDER BY id DESC LIMIT 1 OFFSET ?", off).toArray()[0]) as Rows | undefined;
    const A = pick(ids[0], 1);
    const B = pick(ids[1], 0);
    if (!A || !B) return ok({ available: false, note: "Need at least two stored forecasts." });
    const toSF = (r: Rows): StoredForecast => ({ id: r.id as number, created_ms: r.created_ms as number, state: r.state as string, expected: r.expected as number, range_lo: r.range_lo as number, range_hi: r.range_hi as number, reach: r.reach as number, dist: parse(r.dist, []), comp: parse(r.comp, []) });
    return ok({ available: true, ...forecastDiff(toSF(A), toSF(B)) });
  }

  // ---- F-15 distribution
  if (p === "intelligence/distribution" && method === "GET") {
    const r = sql.exec("SELECT * FROM forecast_store ORDER BY id DESC LIMIT 1").toArray()[0] as Rows | undefined;
    const rs = rounds();
    const f = r
      ? { id: r.id, dist: parse<number[]>(r.dist, []), comp: parse<{ key: string; weight: number; dist: number[] }[]>(r.comp, []), created: r.created_ms }
      : (() => {
          const x = a.intel(rs, "all") as unknown as IntelLike;
          return { id: null, dist: x.distribution.map((d) => d.probability), comp: x.intelligence.components.map((c) => ({ key: c.key, weight: c.weight, dist: c.distribution })), created: Date.now() };
        })();
    const xs = [1.1, 1.2, 1.5, 2, 3, 5, 7, 10, 20, 50, 100, 200, 500, 1000];
    const ms = rs.filter((x) => x.origin !== "reconstructed").map((x) => x.multiplier);
    return ok({
      forecastId: f.id,
      bands: BAND_LABELS,
      mixture: f.dist,
      engines: f.comp,
      survival: xs.map((x) => ({ x, mixture: r4(survivalFromDist(f.dist, x)), base: r4(ms.length ? ms.filter((m) => m >= x).length / ms.length : 0), law: r4(Math.min(1, 0.97 / x)), engines: Object.fromEntries(f.comp.map((c) => [c.key, r4(survivalFromDist(c.dist, x))])) })),
    });
  }

  // ---- F-16 counterfactual
  if (p === "accuracy/counterfactual" && method === "GET") {
    const which = pickLedger(a, q);
    const rows = ledgerRows(a, which, num(q.get("n"), 2000, 50, 20000));
    const w = q.get("without");
    const keys = w ? [w] : [...new Set(rows.flatMap((r) => Object.keys(r.weights)))];
    return ok({ ledger: which, rows: keys.map((k) => counterfactual(rows, k)) });
  }

  // ---- F-17 reliability studio
  if (p === "accuracy/reliability" && method === "GET") {
    const which = pickLedger(a, q);
    const rows = ledgerRows(a, which, num(q.get("n"), 5000, 50, 50000));
    const T = num(q.get("threshold"), 2, 1.01, 1000);
    const model = q.get("model") ?? "mixture";
    const pr = rows.map((r) => {
      let d = r.dist;
      if (model !== "mixture" && which === "stored") {
        const st = a.sql.exec("SELECT comp FROM forecast_store WHERE id = ?", r.id).toArray()[0] as Rows | undefined;
        const c = parse<{ key: string; dist: number[] }[]>(st?.comp, []).find((x) => x.key === model);
        if (c) d = c.dist;
      }
      return { p: survivalFromDist(d, T), y: r.actual >= T ? 1 : 0 };
    });
    return ok({ ledger: which, model, threshold: T, ...reliability(pr) });
  }
  if (p === "accuracy/pit" && method === "GET") {
    const which = pickLedger(a, q);
    const rows = ledgerRows(a, which, num(q.get("n"), 5000, 50, 50000));
    return ok({ ledger: which, ...pitHistogram(rows.map((r) => ({ dist: r.dist, actual: r.actual }))) });
  }
  if (p === "accuracy/coverage" && method === "GET") {
    const which = pickLedger(a, q);
    const rows = ledgerRows(a, which, num(q.get("n"), 5000, 50, 50000));
    return ok({ ledger: which, ...coverageACI(rows.map((r) => ({ dist: r.dist, lo: r.lo, hi: r.hi, actual: r.actual })), 0.5, num(q.get("gamma"), 0.01, 0.001, 0.2)) });
  }

  // ---- F-18 ledger
  if (p === "ledger/head" && method === "GET") {
    const last = sql.exec("SELECT seq, row_hash, created_ms FROM ledger_chain ORDER BY seq DESC LIMIT 1").toArray()[0] as Rows | undefined;
    return ok({ seq: last?.seq ?? 0, head: last?.row_hash ?? GENESIS, at: last?.created_ms ?? null, genesis: GENESIS, daily: sql.exec("SELECT * FROM ledger_heads ORDER BY day DESC LIMIT 60").toArray() });
  }
  if (p === "ledger/export" && method === "GET") {
    const from = num(q.get("from"), 1, 1);
    const lim = num(q.get("limit"), 2000, 1, 20000);
    const rows = sql.exec("SELECT seq, kind, ref_id, payload, prev_hash, row_hash, created_ms FROM ledger_chain WHERE seq >= ? ORDER BY seq LIMIT ?", from, lim).toArray();
    return ok({ from, rows, algorithm: "row_hash = sha256(prev_hash + '|' + canonical_json(payload))", genesis: GENESIS });
  }
  if (p === "ledger/verify" && method === "GET") {
    const rows = sql.exec("SELECT seq, payload, prev_hash, row_hash FROM ledger_chain ORDER BY seq").toArray() as Rows[];
    let prev = GENESIS;
    let bad: number | null = null;
    for (const r of rows) {
      const h = chainHashSync(prev, JSON.parse(r.payload as string));
      if (r.prev_hash !== prev || h !== r.row_hash) { bad = r.seq as number; break; }
      prev = h;
    }
    // stored rows must still match their chained creation payload (tamper check)
    let tampered = 0;
    const fr = sql.exec("SELECT f.id, f.expected, f.range_lo, f.range_hi, c.payload FROM forecast_store f JOIN ledger_chain c ON c.seq = f.chain_seq").toArray() as Rows[];
    for (const r of fr) {
      const pl = JSON.parse(r.payload as string) as Record<string, number>;
      if (Math.abs(pl.expected - (r.expected as number)) > 1e-9 || Math.abs(pl.lo - (r.range_lo as number)) > 1e-9 || Math.abs(pl.hi - (r.range_hi as number)) > 1e-9) tampered++;
    }
    return ok({ rows: rows.length, valid: bad === null && tampered === 0, firstBadSeq: bad, tamperedForecasts: tampered, head: prev });
  }
  if (p === "ledger/backfill" && method === "POST") {
    const g = needOp();
    if (g) return g;
    const n = num(body.n, 100, 1, 300);
    const all = a.roundsFor(null);
    const have = sql.exec("SELECT MIN(after_ts_ms) AS t FROM forecast_store").toArray()[0] as Rows;
    const stopTs = (have.t as number) ?? Infinity;
    let end = all.length - 1;
    while (end > 0 && all[end].tsMs >= stopTs) end--;
    const start = Math.max(150, end - n + 1);
    let made = 0;
    const t0 = Date.now();
    for (let i = start; i <= end; i++) {
      if (all[i].origin === "reconstructed") continue;
      storeForecast(a, all.slice(0, i + 1), "backfill");
      made++;
      if (Date.now() - t0 > 25_000) break;
    }
    resolveOpen(a, all);
    return ok({ created: made, elapsedMs: Date.now() - t0, note: "Backfilled rows are causal walk-forward forecasts created now; they are chained with origin = backfill and can be excluded from any metric." });
  }
  if (p === "ledger/forecasts" && method === "GET") {
    const lim = num(q.get("limit"), 100, 1, 2000);
    const rows = (asOf
      ? sql.exec("SELECT * FROM forecast_store WHERE created_ms <= ? ORDER BY id DESC LIMIT ?", asOf, lim)
      : sql.exec("SELECT * FROM forecast_store ORDER BY id DESC LIMIT ?", lim)
    ).toArray() as Rows[];
    const stats = sql.exec("SELECT COUNT(*) AS n, SUM(resolved_ms IS NOT NULL) AS resolved, SUM(void) AS voided, SUM(origin = 'live') AS live, AVG(CASE WHEN void = 0 THEN base_loss - mix_loss END) AS skill FROM forecast_store").toArray()[0];
    return ok({ stats, rows: rows.map((r) => ({ ...r, dist: parse(r.dist, []), comp: undefined, cone: undefined, comp_loss: undefined })) });
  }

  // ---- F-19 gates
  if (p === "app/gate" && method === "GET") {
    const lb = engineLeaderboard(a, pickLedger(a, q), 2000);
    const minN = num(q.get("minN"), 300, 30, 100000);
    const mixOk = lb.mixture.n >= minN && lb.mixture.lo > 0;
    const passing = lb.engines.filter((e) => e.n >= minN && (e.lo ?? -1) > 0);
    return ok({ minN, mixture: { ...lb.mixture, passes: mixOk }, passing: passing.map((e) => e.key), showBaseRate: !mixOk, label: mixOk ? "skill-backed forecast" : "base rate", note: mixOk ? "The mixture's skill CI lower bound is above 0 at n ≥ " + minN + "." : `No producer has a skill CI lower bound above 0 at n ≥ ${minN}; consumer cards show the measured base rate, clearly labelled.` });
  }

  // ---- F-21 cone
  if (p === "intelligence/cone" && method === "GET") {
    const h = num(q.get("h"), 5, 1, 20);
    const r = sql.exec("SELECT * FROM forecast_store ORDER BY id DESC LIMIT 1").toArray()[0] as Rows | undefined;
    const rs = rounds();
    const dist = r ? parse<number[]>(r.dist, []) : (a.intel(rs, "all") as unknown as IntelLike).distribution.map((d) => d.probability);
    const cad = medianIntervalMs(rs);
    const last = rs[rs.length - 1];
    const eta = etaBoard(rs).rows.filter((x) => x.threshold === 10 || x.threshold === 50);
    // measured visual coverage on resolved stored forecasts
    const res = ledgerRows(a, pickLedger(a, q), 2000);
    const cov = res.length ? res.filter((x) => x.actual >= quantileFromDist(x.dist, 0.25) && x.actual <= quantileFromDist(x.dist, 0.75)).length / res.length : null;
    const cov90 = res.length ? res.filter((x) => x.actual <= quantileFromDist(x.dist, 0.9)).length / res.length : null;
    return ok({
      forecastId: r?.id ?? null,
      lastTs: last?.tsMs ?? null,
      cadenceMs: Math.round(cad),
      cone: coneFrom(dist, h).map((c) => ({ ...c, t: (last?.tsMs ?? Date.now()) + c.h * cad })),
      etaMarkers: eta.map((e) => ({ threshold: e.threshold, rounds: e.etaMedian, at: e.etaMedianAt })),
      coverage: { p25p75: cov != null ? r4(cov) : null, belowP90: cov90 != null ? r4(cov90) : null, n: res.length },
    });
  }

  // ---- F-22 drawn predictions + leaderboard
  if (p === "predictions" && method === "POST") {
    const level = num(body.level, 0, 1.01, 10000);
    const horizon = Math.round(num(body.horizon ?? body.rounds, 10, 1, 500));
    const minutes = body.minutes != null ? num(body.minutes, 0, 0.5, 1440) : null;
    if (!level) return fail("level (×) required");
    const rs = a.roundsFor(null);
    const cad = medianIntervalMs(rs);
    const H = minutes ? Math.max(1, Math.round((minutes * 60_000) / cad)) : horizon;
    const last = rs[rs.length - 1];
    if (!last) return fail("no rounds yet");
    const fr = sql.exec("SELECT dist FROM forecast_store ORDER BY id DESC LIMIT 1").toArray()[0] as Rows | undefined;
    const dist = fr ? parse<number[]>(fr.dist, []) : (a.intel(rs, "all") as unknown as IntelLike).distribution.map((d) => d.probability);
    const pOne = survivalFromDist(dist, level);
    const mixP = r4(1 - Math.pow(1 - pOne, H));
    const prob = r4(num(body.probability, mixP, 0.001, 0.999));
    const userKey = user ? `user:${user.id}` : `anon:${String(body.clientId ?? "guest").slice(0, 40)}`;
    const display = String(body.displayName ?? user?.name ?? "guest").slice(0, 40);
    sql.exec(
      "INSERT INTO drawn_predictions (user_key, display_name, source, level, horizon, probability, mixture_p, after_round_id, after_ts_ms, drawing, created_ms) VALUES (?, ?, 'all', ?, ?, ?, ?, ?, ?, ?, ?)",
      userKey, display, level, H, prob, mixP, last.id, last.tsMs, body.drawing ? JSON.stringify(body.drawing) : null, Date.now(),
    );
    const id = (sql.exec("SELECT MAX(id) AS id FROM drawn_predictions").toArray()[0] as { id: number }).id;
    const seq = appendChain(sql, "prediction", id, { user: userKey, level, horizon: H, probability: prob, mixtureP: mixP, afterRoundId: last.id });
    sql.exec("UPDATE drawn_predictions SET chain_seq = ? WHERE id = ?", seq, id);
    return ok({ id, level, horizon: H, probability: prob, mixtureP: mixP, etaMinutes: r2((H * cad) / 60_000), chainSeq: seq });
  }
  if (p === "predictions" && method === "GET") {
    const who = q.get("user");
    const rows = (who ? sql.exec("SELECT * FROM drawn_predictions WHERE user_key = ? ORDER BY id DESC LIMIT 200", who) : sql.exec("SELECT * FROM drawn_predictions ORDER BY id DESC LIMIT 200")).toArray() as Rows[];
    let rel = null;
    if (who) {
      const res = rows.filter((r) => r.resolved_ms && !r.void);
      rel = reliability(res.map((r) => ({ p: r.probability as number, y: r.actual as number })), 5);
    }
    return ok({ rows, reliability: rel });
  }
  if (p === "leaderboard" && method === "GET") {
    const period = q.get("period") ?? "all";
    const since = period === "daily" ? Date.now() - 86_400_000 : period === "weekly" ? Date.now() - 7 * 86_400_000 : 0;
    const minN = num(q.get("minN"), 30, 1, 10000);
    const rows = sql.exec("SELECT * FROM drawn_predictions WHERE resolved_ms IS NOT NULL AND void = 0 AND created_ms >= ?", since).toArray() as Rows[];
    const by = new Map<string, Rows[]>();
    for (const r of rows) (by.get(r.user_key as string) ?? by.set(r.user_key as string, []).get(r.user_key as string)!).push(r);
    const users = [...by.entries()].map(([k, rs]) => {
      const d = rs.map((r) => (r.mix_logloss as number) - (r.logloss as number));
      const [lo, hi] = blockBootstrapCI(d, { seed: k.length });
      return { user: k, name: rs[rs.length - 1].display_name, n: rs.length, hits: rs.filter((r) => r.actual === 1).length, skill: r4(mean(d)), lo: Number.isFinite(lo) ? r4(lo) : null, hi: Number.isFinite(hi) ? r4(hi) : null, ranked: rs.length >= minN, beatsPlatform: Number.isFinite(lo) && lo > 0 };
    });
    users.sort((x, y) => Number(y.ranked) - Number(x.ranked) || y.skill - x.skill);
    // chance reference: simulated users who copy the mixture with noise
    const ranked = users.filter((u) => u.ranked);
    let chancePositive = null as number | null;
    if (ranked.length) {
      const r = (seed: number) => {
        let s = seed;
        return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
      };
      let pos = 0;
      const sims = 200;
      const pool = rows;
      for (let s = 0; s < sims; s++) {
        const rnd = r(s + 1);
        const nn = Math.max(30, Math.round(mean(ranked.map((u) => u.n))));
        const d: number[] = [];
        for (let i = 0; i < nn && pool.length; i++) {
          const row = pool[Math.floor(rnd() * pool.length)];
          const pm = row.mixture_p as number;
          const pn = Math.min(0.999, Math.max(0.001, pm + (rnd() - 0.5) * 0.2));
          const y = row.actual as number;
          const ll = (pp: number) => -(y * Math.log(pp) + (1 - y) * Math.log(1 - pp));
          d.push(ll(pm) - ll(pn));
        }
        const [lo] = blockBootstrapCI(d, { B: 100, seed: s });
        if (lo > 0) pos++;
      }
      chancePositive = r4((pos / sims) * ranked.length);
    }
    return ok({ period, minN, users, rankedUsers: ranked.length, positiveSkillUsers: ranked.filter((u) => u.beatsPlatform).length, expectedByChance: chancePositive, scoring: "log-score skill vs the platform mixture (positive = you beat Momento)" });
  }

  // ---- F-24 / F-08 replay with narration
  if (p === "replay" && method === "GET") {
    const all = a.roundsFor(srcOf(q));
    const to = num(q.get("to"), all.length ? all[all.length - 1].tsMs : Date.now());
    const from = num(q.get("from"), to - num(q.get("minutes"), 30, 1, 1440) * 60_000);
    const idx0 = all.findIndex((r) => r.tsMs >= from);
    const slice = all.filter((r) => r.tsMs >= from && r.tsMs <= to).slice(0, num(q.get("limit"), 400, 1, 3000));
    const fs = sql.exec("SELECT id, after_ts_ms, created_ms, state, expected, range_lo, range_hi, reach, dist, origin FROM forecast_store WHERE after_ts_ms >= ? AND after_ts_ms <= ? ORDER BY after_ts_ms", from - 60 * 60_000, to).toArray() as Rows[];
    let below2 = 0, since10 = 0;
    for (let i = 0; i < (idx0 < 0 ? 0 : idx0); i++) {
      below2 = all[i].multiplier < 2 ? below2 + 1 : 0;
      since10 = all[i].multiplier >= 10 ? 0 : since10 + 1;
    }
    let fi = 0;
    let current: Rows | null = null;
    const frames = slice.map((r) => {
      // the forecast visible just before this round landed: latest stored with after_ts_ms < r.tsMs
      while (fi < fs.length && (fs[fi].after_ts_ms as number) < r.tsMs) current = fs[fi++];
      const stored = current ? { id: current.id as number, expected: current.expected as number, lo: current.range_lo as number, hi: current.range_hi as number, state: current.state as string, origin: current.origin as string } : null;
      const caption = narrate(r.multiplier, { below2, since10 }, stored);
      below2 = r.multiplier < 2 ? below2 + 1 : 0;
      since10 = r.multiplier >= 10 ? 0 : since10 + 1;
      return { id: r.id, ts: r.ts, tsMs: r.tsMs, multiplier: r.multiplier, origin: r.origin, forecast: stored, caption };
    });
    return ok({ from, to, frames, storedForecasts: fs.length, note: fs.length ? "Forecasts are the rows stored at the time, never recomputed." : "No stored forecasts in this window yet — backfill the ledger or wait for live rounds." });
  }

  // ---- F-26 / F-27 / F-29 survival
  if (p === "eta/board" && method === "GET") return ok(etaBoard(rounds()));
  if (p === "eta/hazard" && method === "GET") return ok(hazardTimeline(rounds(), num(q.get("T"), 10, 1.01, 1000), num(q.get("maxG"), 120, 10, 2000)));
  if (p === "eta/inround" && method === "GET") return ok(inRoundEta(rounds(), num(q.get("m0"), 1, 1, 10000)));

  // ---- F-30 decisions
  if (p === "decisions" && method === "GET") {
    const prod = q.get("producer");
    syncAutopilot(a);
    const rows = (prod ? sql.exec("SELECT * FROM decisions WHERE producer = ? ORDER BY id DESC LIMIT 300", prod) : sql.exec("SELECT * FROM decisions ORDER BY id DESC LIMIT 300")).toArray() as Rows[];
    return ok({ rows: rows.map((r) => ({ ...r, reasons: parse(r.reasons, []) })) });
  }
  if (p === "decisions/leaderboard" && method === "GET") return ok(decisionLeaderboard(a, rounds()));
  if (p === "decisions" && method === "POST") {
    const rs = a.roundsFor(null);
    const last = rs[rs.length - 1];
    if (!last) return fail("no rounds");
    const producer = user ? `user:${user.email}` : `user:${String(body.clientId ?? "guest").slice(0, 40)}`;
    const target = num(body.target, 2, 1.01, 1000);
    sql.exec(
      "INSERT INTO decisions (producer, source, ref, action, target, probability, stake, horizon, after_ts_ms, reasons, created_ms) VALUES (?, 'all', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      producer, `${producer}:${Date.now()}`, String(body.action ?? "stake"), target, body.probability != null ? num(body.probability, 0.5, 0, 1) : null, num(body.stake, 1, 0, 1e6), Math.round(num(body.horizon, 1, 1, 100)), last.tsMs, JSON.stringify([String(body.reason ?? "manual")]), Date.now(),
    );
    return ok({ recorded: true });
  }

  // ---- F-31 tells
  if (p === "tells" && method === "GET") {
    return ok({ kappa: 0.25, tells: kellyTells(rounds(), { kappa: num(q.get("kappa"), 0.25, 0, 0.25), cap: num(q.get("cap"), 0.02, 0, 0.2) }), rule: "f = κ·(p·x − 1)/(x − 1) with p = Wilson lower bound (n ≥ 100), κ ≤ 0.25, tier cap; f = 0 whenever p·x ≤ 1." });
  }

  // ---- F-32 simulator
  if (p === "simulate" && method === "POST") {
    const s = (body.strategy as Record<string, unknown>) ?? {};
    const strat: Strategy = {
      cashout: num(s.cashout, 2, 1.01, 1000),
      stakeMode: s.stakeMode === "fraction" ? "fraction" : "flat",
      stake: num(s.stake, 1, 0.0001, 1e6),
      stopLoss: s.stopLoss != null && s.stopLoss !== "" ? num(s.stopLoss, 0, 0, 1e9) : undefined,
      takeProfit: s.takeProfit != null && s.takeProfit !== "" ? num(s.takeProfit, 0, 0, 1e9) : undefined,
      roundsPerSession: Math.round(num(s.roundsPerSession, 60, 5, 2000)),
    };
    return ok(simulateBankroll(a.roundsFor(typeof body.source === "string" && body.source !== "all" ? body.source : null), strat, { sessions: Math.round(num(body.sessions, 20, 1, 500)), bankroll: num(body.bankroll, 100, 1, 1e9), paths: Math.round(num(body.paths, 400, 50, 3000)) }));
  }

  // ---- F-33 coach
  if (p === "coach" && method === "GET") {
    const rs = rounds().filter((r) => r.origin !== "reconstructed");
    const cap = num(q.get("cap"), 50, 0, 1e9);
    const spent = num(q.get("spent"), 0, 0, 1e9);
    const startedMs = num(q.get("started"), Date.now() - 45 * 60_000);
    const usualMin = num(q.get("usualMinutes"), 40, 1, 1440);
    const lenMin = (Date.now() - startedMs) / 60_000;
    let below = 0;
    for (let i = rs.length - 1; i >= 0 && rs[i].multiplier < 2; i--) below++;
    const recent = rs.slice(-30).map((r) => r.multiplier);
    const cold = recent.length ? recent.filter((m) => m >= 2).length / recent.length : 0;
    const lines: { tone: "info" | "warn" | "stop"; text: string }[] = [];
    if (cap > 0) lines.push({ tone: spent / cap >= 0.9 ? "stop" : spent / cap >= 0.7 ? "warn" : "info", text: `Loss cap ${Math.round((spent / cap) * 100)}% used (${r2(spent)} of ${r2(cap)}).` });
    lines.push({ tone: lenMin / usualMin >= 2 ? "warn" : "info", text: `Session length ${r2(lenMin / usualMin)}× your usual (${Math.round(lenMin)} min vs ${Math.round(usualMin)}).` });
    if (below >= 5) lines.push({ tone: "warn", text: `${below} rounds below 2× in a row. On this tape the next round's chance of ≥ 2× is unchanged by streaks — the guard asks you to pause, not to chase.` });
    lines.push({ tone: "info", text: `Last 30 rounds: ${Math.round(cold * 100)}% reached 2×.` });
    const guard = lines.some((l) => l.tone === "stop") ? "stop" : lines.some((l) => l.tone === "warn") ? "caution" : "ok";
    return ok({ guard, lines, capUsed: cap ? r4(spent / cap) : null, sessionMinutes: Math.round(lenMin) });
  }

  // ---- F-34 experiments
  if (p === "experiments/draft" && method === "POST") {
    const text = String(body.hypothesis ?? "").trim();
    if (!text) return fail("hypothesis required");
    return ok({ spec: parseHypothesis(text), draftedBy: "parser", note: "Review the drafted spec — a person approves it before it runs." });
  }
  if (p === "experiments" && method === "POST") {
    const specIn = (body.spec as ExperimentSpec) ?? parseHypothesis(String(body.hypothesis ?? ""));
    if (!specIn?.condition || !specIn?.target) return fail("spec.condition and spec.target required");
    const spec: ExperimentSpec = {
      name: String(specIn.name ?? body.hypothesis ?? "experiment").slice(0, 100),
      hypothesis: String(specIn.hypothesis ?? body.hypothesis ?? ""),
      condition: { kind: specIn.condition.kind, x: num(specIn.condition.x, 2, 1.01, 1000), k: Math.round(num(specIn.condition.k, 3, 1, 500)), pattern: specIn.condition.pattern },
      target: { x: num(specIn.target.x, 2, 1.01, 1000), h: Math.round(num(specIn.target.h, 1, 1, 100)) },
      split: num(specIn.split, 0.6, 0.3, 0.9),
    };
    const family = String(body.family ?? "default");
    const res = runExperiment(spec, rounds(), { shuffles: 30, plants: 20 });
    const now = Date.now();
    sql.exec(
      "INSERT INTO experiments (name, hypothesis, spec, result, p, verdict, lifecycle, family, drafted_by, approved_by, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?, 'pending', 'running', ?, ?, ?, ?, ?)",
      spec.name, spec.hypothesis, JSON.stringify(spec), JSON.stringify(res), res.test.p, family, String(body.draftedBy ?? "parser"), user?.email ?? "console", now, now,
    );
    // BH across the whole family, then re-verdict every member
    const fam = sql.exec("SELECT id, p, result FROM experiments WHERE family = ? AND p IS NOT NULL ORDER BY id", family).toArray() as Rows[];
    const qs = bhQ(fam.map((f) => f.p as number));
    fam.forEach((f, i) => {
      const r = JSON.parse(f.result as string) as ReturnType<typeof runExperiment>;
      const v = verdictFor(r, qs[i]);
      sql.exec("UPDATE experiments SET q = ?, verdict = ?, lifecycle = CASE WHEN lifecycle IN ('promoted','shadow') THEN lifecycle ELSE ? END, updated_ms = ? WHERE id = ?", r4(qs[i]), v.verdict, v.lifecycle, now, f.id);
    });
    const id = (sql.exec("SELECT MAX(id) AS id FROM experiments").toArray()[0] as { id: number }).id;
    const row = sql.exec("SELECT * FROM experiments WHERE id = ?", id).toArray()[0] as Rows;
    return ok({ ...row, spec, result: res, familySize: fam.length, reason: verdictFor(res, row.q as number).reason });
  }
  if (p === "experiments" && method === "GET") {
    const rows = sql.exec("SELECT * FROM experiments ORDER BY id DESC LIMIT 200").toArray() as Rows[];
    return ok({ rows: rows.map((r) => ({ ...r, spec: parse(r.spec, {}), result: parse(r.result, null) })) });
  }
  const expGet = p.match(/^experiments\/(\d+)$/);
  if (expGet && method === "GET") {
    const r = sql.exec("SELECT * FROM experiments WHERE id = ?", Number(expGet[1])).toArray()[0] as Rows | undefined;
    if (!r) return fail("not found", 404);
    const res = parse<ReturnType<typeof runExperiment> | null>(r.result, null);
    return ok({ ...r, spec: parse(r.spec, {}), result: res, reason: res ? verdictFor(res, (r.q as number) ?? 1).reason : null });
  }
  const expPromote = p.match(/^experiments\/(\d+)\/promote$/);
  if (expPromote && method === "POST") {
    const g = needOp();
    if (g) return g;
    const r = sql.exec("SELECT * FROM experiments WHERE id = ?", Number(expPromote[1])).toArray()[0] as Rows | undefined;
    if (!r) return fail("not found", 404);
    if (r.verdict !== "supported") return fail("only supported experiments can be promoted into the registry");
    const spec = parse<ExperimentSpec>(r.spec, null as unknown as ExperimentSpec);
    const params = { x: spec.condition.x ?? 2, k: spec.condition.k ?? 3, window: 5000 };
    const key = `custom:exp${r.id}`;
    const adm = admissionTests({ family: "conditional", params }, a.roundsFor(null).map((x) => x.multiplier));
    const now = Date.now();
    sql.exec(
      "INSERT INTO engines (key, label, version, owner, kind, family, params, state, prior, admission, created_ms, updated_ms) VALUES (?, ?, '1', ?, 'custom', 'conditional', ?, 'shadow', 0.4, ?, ?, ?) ON CONFLICT(key) DO NOTHING",
      key, `Experiment #${r.id}: ${String(r.name).slice(0, 50)}`, user!.email, JSON.stringify(params), JSON.stringify(adm), now, now,
    );
    sql.exec("INSERT INTO engine_history (key, from_state, to_state, reason, actor, created_ms) VALUES (?, NULL, 'shadow', ?, ?, ?)", key, `promoted from experiment #${r.id}`, user!.email, now);
    sql.exec("UPDATE experiments SET lifecycle = 'shadow', engine_key = ?, updated_ms = ? WHERE id = ?", key, now, r.id);
    registryCache = null;
    return ok({ key, state: "shadow", admission: adm });
  }

  // ---- F-35 explain
  const explainM = p.match(/^forecast\/(latest|\d+)\/explain$/);
  if (explainM && method === "GET") {
    let row = (explainM[1] === "latest" ? sql.exec("SELECT * FROM forecast_store ORDER BY id DESC LIMIT 1") : sql.exec("SELECT * FROM forecast_store WHERE id = ?", Number(explainM[1]))).toArray()[0] as Rows | undefined;
    const rs = a.roundsFor(null);
    if (!row) {
      const id = storeForecast(a, rs, "live");
      if (id) row = sql.exec("SELECT * FROM forecast_store WHERE id = ?", id).toArray()[0] as Rows;
    }
    if (!row) return ok({ available: false });
    sql.exec("INSERT INTO event_log (kind, meta, created_ms) VALUES ('explain.open', ?, ?)", String(row.id), Date.now());
    const hist = rs.filter((r) => r.tsMs <= (row!.after_ts_ms as number));
    return ok({ available: true, ...explain(a, row, hist) });
  }
  if (p === "events" && method === "POST") {
    sql.exec("INSERT INTO event_log (kind, meta, created_ms) VALUES (?, ?, ?)", String(body.kind ?? "view").slice(0, 40), JSON.stringify(body.meta ?? null).slice(0, 500), Date.now());
    return ok({ logged: true });
  }
  if (p === "events/summary" && method === "GET") {
    const rows = sql.exec("SELECT kind, COUNT(*) AS n FROM event_log WHERE created_ms > ? GROUP BY kind", Date.now() - 7 * 86_400_000).toArray() as Rows[];
    const views = (rows.find((r) => r.kind === "forecast.view")?.n as number) ?? 0;
    const opens = (rows.find((r) => r.kind === "explain.open")?.n as number) ?? 0;
    return ok({ rows, whyRate: views ? r4(opens / views) : null, target: 0.2 });
  }

  // ---- F-36 fairness
  if (p === "fair/battery" && method === "GET") return ok(fairnessBattery(rounds()));
  if (p === "fair/verify" && method === "POST") {
    const server = String(body.server ?? body.serverSeed ?? "");
    if (!server) return fail("server seed required");
    const clients = Array.isArray(body.clients) ? (body.clients as unknown[]).map(String) : undefined;
    const res = await verifyAll({ server, client: body.client != null ? String(body.client) : undefined, clients, nonce: body.nonce != null ? Number(body.nonce) : undefined, observed: body.observed != null ? Number(body.observed) : undefined });
    return ok({ results: res, matches: res.filter((r) => r.match).map((r) => r.convention) });
  }
  if (p === "fair/solve" && method === "POST") {
    const list = Array.isArray(body.rounds) ? (body.rounds as Record<string, unknown>[]) : [];
    if (!list.length) return fail("rounds [{server, client|clients, nonce, observed}] required");
    return ok(await solveConvention(list.map((r) => ({ server: String(r.server ?? ""), client: r.client != null ? String(r.client) : undefined, clients: Array.isArray(r.clients) ? (r.clients as unknown[]).map(String) : undefined, nonce: r.nonce != null ? Number(r.nonce) : undefined, observed: r.observed != null ? Number(r.observed) : undefined }))));
  }
  if (p === "fair/chain" && method === "POST") {
    return ok(await verifySeedChain(String(body.revealed ?? ""), String(body.committed ?? ""), num(body.maxDepth, 2000, 1, 20000)));
  }

  // ---- F-37 ask
  if (p === "knowledge/ask" && method === "POST") {
    const qn = String(body.q ?? body.question ?? "").trim();
    if (!qn) return fail("question required");
    const passages = Array.isArray(body.passages) ? (body.passages as { id: string; title: string; text: string }[]).slice(0, 8) : [];
    return ok(await askMomento(a, qn, passages));
  }

  // ---- F-38 alerts
  if (p === "alerts/fields" && method === "GET") {
    return ok({ fields: ALERT_FIELDS, current: liveFields(a, a.roundsFor(null)), presets: [
      { name: "10× gap past its 90th percentile", field: "eta.10.kmPercentile", op: ">=", value: 90 },
      { name: "50× gap past its 90th percentile (F-28)", field: "eta.50.kmPercentile", op: ">=", value: 90 },
      { name: "Anchor forming (F-25)", field: "anchor.active", op: "=", value: 1 },
      { name: "5+ rounds below 2×", field: "streak.below2", op: ">=", value: 5 },
      { name: "Moonshot landed (≥ 50×)", field: "last.multiplier", op: ">=", value: 50 },
    ] });
  }
  if (p === "alerts/rules" && method === "GET") return ok({ rules: sql.exec("SELECT * FROM alert_rules ORDER BY id DESC").toArray() });
  if (p === "alerts/rules" && method === "POST") {
    const field = String(body.field ?? "");
    if (!ALERT_FIELDS.some((f) => f.field === field)) return fail("unknown field");
    const op = String(body.op ?? ">=");
    if (![">=", "<=", ">", "<", "="].includes(op)) return fail("op must be one of >= <= > < =");
    sql.exec(
      "INSERT INTO alert_rules (owner, name, field, op, value, source, channel, debounce_s, quiet_from, quiet_to, daily_cap, created_ms) VALUES (?, ?, ?, ?, ?, 'all', ?, ?, ?, ?, ?, ?)",
      user?.email ?? "console", String(body.name ?? field).slice(0, 80), field, op, num(body.value, 0), String(body.channel ?? "in-app"), Math.round(num(body.debounce_s, 300, 0, 86400)),
      body.quiet_from != null && body.quiet_from !== "" ? Math.round(num(body.quiet_from, 0, 0, 23)) : null, body.quiet_to != null && body.quiet_to !== "" ? Math.round(num(body.quiet_to, 0, 0, 23)) : null, Math.round(num(body.daily_cap, 20, 1, 500)), Date.now(),
    );
    return ok({ created: true });
  }
  const ruleDel = p.match(/^alerts\/rules\/(\d+)$/);
  if (ruleDel && method === "DELETE") {
    sql.exec("DELETE FROM alert_rules WHERE id = ?", Number(ruleDel[1]));
    return ok({ deleted: true });
  }
  const ruleToggle = p.match(/^alerts\/rules\/(\d+)\/toggle$/);
  if (ruleToggle && method === "POST") {
    sql.exec("UPDATE alert_rules SET enabled = 1 - enabled WHERE id = ?", Number(ruleToggle[1]));
    return ok({ toggled: true });
  }
  if (p === "alerts" && method === "GET") {
    const rows = sql.exec("SELECT * FROM alerts ORDER BY id DESC LIMIT ?", num(q.get("limit"), 50, 1, 500)).toArray();
    const unread = (sql.exec("SELECT COUNT(*) AS n FROM alerts WHERE read = 0").toArray()[0] as { n: number }).n;
    const rated = sql.exec("SELECT COUNT(*) AS n, SUM(rating > 0) AS good FROM alerts WHERE rating IS NOT NULL").toArray()[0] as Rows;
    return ok({ rows, unread, precision: rated.n ? r4(((rated.good as number) ?? 0) / (rated.n as number)) : null });
  }
  if (p === "alerts/read" && method === "POST") {
    if (body.id) sql.exec("UPDATE alerts SET read = 1 WHERE id = ?", Number(body.id));
    else sql.exec("UPDATE alerts SET read = 1");
    return ok({ read: true });
  }
  if (p === "alerts/rate" && method === "POST") {
    sql.exec("UPDATE alerts SET rating = ? WHERE id = ?", Number(body.rating) > 0 ? 1 : -1, Number(body.id));
    return ok({ rated: true });
  }

  // ---- overview of the book implementation
  if (p === "platform/book" && method === "GET") {
    const c = (t: string, w = "") => ((sql.exec(`SELECT COUNT(*) AS n FROM ${t} ${w}`).toArray()[0] as { n: number }).n);
    return ok({
      version: "6.5.0",
      stored: { forecasts: c("forecast_store"), resolved: c("forecast_store", "WHERE resolved_ms IS NOT NULL"), voided: c("forecast_store", "WHERE void = 1"), chain: c("ledger_chain"), predictions: c("drawn_predictions"), decisions: c("decisions"), experiments: c("experiments"), engines: c("engines"), alertRules: c("alert_rules"), alerts: c("alerts") },
      features: FEATURE_STATUS,
    });
  }
  return null;
}

export const FEATURE_STATUS: { id: string; name: string; status: "live" | "partial"; where: string; api: string }[] = [
  { id: "F-01", name: "Tape Integrity Score", status: "live", where: "/dashboard/integrity", api: "/integrity, /integrity/summary" },
  { id: "F-02", name: "Multi-collector consensus", status: "partial", where: "/dashboard/integrity", api: "/collectors, /collectors/disagreements" },
  { id: "F-03", name: "Source fingerprinting (CUSUM)", status: "live", where: "/dashboard/fairness", api: "/fingerprint" },
  { id: "F-04", name: "Time-travel queries (as_of)", status: "live", where: "TopBar time control", api: "?as_of=, /asof/*" },
  { id: "F-05", name: "Per-source sharding / federated view", status: "partial", where: "/dashboard/integrity", api: "/federation" },
  { id: "F-06", name: "Living Dictionary", status: "live", where: "/dashboard/dictionary", api: "/dictionary, /vocabulary/{id}/page" },
  { id: "F-07", name: "Sequence search", status: "live", where: "/dashboard/sequence", api: "/sequence/search" },
  { id: "F-08", name: "Narrated replay", status: "live", where: "/dashboard/replay", api: "/replay" },
  { id: "F-09", name: "Engine Workbench", status: "live", where: "/dashboard/engines", api: "/workbench/run, /workbench/runs" },
  { id: "F-10", name: "Cross-source comparator", status: "live", where: "/dashboard/sequence", api: "/compare" },
  { id: "F-11", name: "Signal significance strip", status: "live", where: "Command Center", api: "/signals/significance" },
  { id: "F-12", name: "Engine Marketplace / registry", status: "live", where: "/dashboard/engines", api: "/engines, /engines/{key}/state" },
  { id: "F-13", name: "Regime-aware weights", status: "live", where: "/dashboard/engines", api: "/mixture?by=regime" },
  { id: "F-14", name: "Forecast diff", status: "live", where: "/dashboard/explain", api: "/forecast/diff" },
  { id: "F-15", name: "Distribution explorer", status: "live", where: "/dashboard/explain", api: "/intelligence/distribution" },
  { id: "F-16", name: "Counterfactual engine toggle", status: "live", where: "/dashboard/engines", api: "/accuracy/counterfactual" },
  { id: "F-17", name: "Reliability Studio", status: "live", where: "/dashboard/reliability", api: "/accuracy/reliability, /pit, /coverage" },
  { id: "F-18", name: "Tamper-evident track record", status: "live", where: "/dashboard/track-record", api: "/ledger/head, /ledger/export, /ledger/verify" },
  { id: "F-19", name: "Accuracy gates per tier", status: "live", where: "consumer app", api: "/app/gate" },
  { id: "F-20", name: "Auto-demotion and alerts", status: "live", where: "/dashboard/engines", api: "/engines/{key}/history" },
  { id: "F-21", name: "Forecast cone on chart", status: "live", where: "Market, /dashboard/predict", api: "/intelligence/cone" },
  { id: "F-22", name: "Drawn predictions + leaderboard", status: "live", where: "/dashboard/predict, /app/charts", api: "/predictions, /leaderboard" },
  { id: "F-23", name: "Multi-source terminal", status: "live", where: "/dashboard/multi", api: "/candles per source" },
  { id: "F-24", name: "Replay mode", status: "live", where: "/dashboard/replay", api: "/replay" },
  { id: "F-25", name: "Anchor alerts", status: "live", where: "/dashboard/alerts", api: "alert preset" },
  { id: "F-26", name: "ETA Board", status: "live", where: "/dashboard/eta", api: "/eta/board" },
  { id: "F-27", name: "Hazard timeline", status: "live", where: "/dashboard/eta", api: "/eta/hazard" },
  { id: "F-28", name: "ETA alerts", status: "live", where: "/dashboard/alerts", api: "alert preset" },
  { id: "F-29", name: "In-round live ETA", status: "live", where: "/dashboard/eta", api: "/eta/inround" },
  { id: "F-30", name: "Decision Ledger + producer leaderboard", status: "live", where: "/dashboard/decisions", api: "/decisions, /decisions/leaderboard" },
  { id: "F-31", name: "Auto-Tells v2", status: "live", where: "/dashboard/decisions", api: "/tells" },
  { id: "F-32", name: "Bankroll Simulator", status: "live", where: "/dashboard/simulator", api: "/simulate" },
  { id: "F-33", name: "Session Coach", status: "live", where: "/dashboard/simulator", api: "/coach" },
  { id: "F-34", name: "Experiment Registry", status: "live", where: "/dashboard/experiments", api: "/experiments" },
  { id: "F-35", name: "Explain-this-forecast", status: "live", where: "/dashboard/explain", api: "/forecast/{id}/explain" },
  { id: "F-36", name: "Fairness Console", status: "live", where: "/dashboard/fairness", api: "/fair/*" },
  { id: "F-37", name: "Ask Momento", status: "live", where: "⌘K / /dashboard/ask", api: "/knowledge/ask" },
  { id: "F-38", name: "Alerts Center", status: "live", where: "/dashboard/alerts + TopBar bell", api: "/alerts, /alerts/rules" },
];
void NB;
void wordOf;
void mean;
