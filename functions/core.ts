// functions/core.ts — MomentoCore Durable Object: the whole backend.
// Relational SQLite storage + every /api/v1 endpoint, ported from the original
// Momento AVFS core (FastAPI + SQLite) to the Cloudflare Worker runtime.

import { DurableObject } from "cloudflare:workers";
import {
  BAND_LABELS,
  bandIndex,
  bands as bandsOf,
  candles as candlesOf,
  ceilings as ceilingsOf,
  exceedance as exceedanceOf,
  gaps as gapsOf,
  houseEdge as houseEdgeOf,
  linguistics as linguisticsOf,
  ladders as laddersOf,
  maxOf,
  moonshot as moonshotOf,
  overview as overviewOf,
  pressure as pressureOf,
  sessionPhases,
  shape as shapeOf,
  streaks as streaksOf,
  walkForward,
  THRESHOLDS,
  type Round,
} from "./analysis";
import { BUILD_STEPS, CALIBRATION_REFERENCE, DOCS, RANGE_LAB_REFERENCE } from "./docs";
import {
  breakout as breakoutOf,
  correlationEngine,
  divergence as divergenceOf,
  eventRisk,
  fxSignals,
  meanReversion,
  orderFlow,
  supportDensity,
  volatilityProfile,
  trendQuality,
} from "./fx";
import {
  WINDOWS,
  bandLabelOfShort,
  expectedRounds,
  nextRoundForecast,
  perRoundProbability,
  pipelineForecast,
  verifyAgainstHistory,
  windowProbability,
  type WindowDef,
} from "./pipeline";
import {
  anchors,
  assessLive,
  hitPoints,
  invertedForecast,
  moonshot as moonshotResearch,
  rangeForecast,
  rangeMomentum,
} from "./momentum";
import {
  COMPONENTS as INTEL_COMPONENTS,
  bandLogLoss,
  fullIntelligenceForecast,
  scoreIntelForecast,
  type FullIntelligenceForecast,
  type IntelWeights,
} from "./intelligence";

export const VERSION = "6.3.0";

type Rows = Record<string, unknown>;

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const ok = (data: unknown) => json({ ok: true, data });
const fail = (error: string, status = 400) => json({ ok: false, error }, status);

export class MomentoCore extends DurableObject {
  private analysisCache = new Map<string, { maxId: number; payload: unknown }>();
  private fxCache = new Map<string, { maxId: number; payload: Record<string, unknown> }>();
  private momentumCache = new Map<string, { maxId: number; payload: Record<string, unknown> }>();
  private roundsCache = new Map<string, { maxId: number; count: number; rounds: Round[] }>();
  private booted = false;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.initSchema();
      await this.bootstrap();
      this.booted = true;
    });
  }

  // ------------------------------------------------------------------ schema

  private initSchema(): void {
    const sql = this.ctx.storage.sql;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS rounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        ts_ms INTEGER NOT NULL,
        multiplier REAL NOT NULL,
        color TEXT,
        source TEXT NOT NULL,
        session_id INTEGER,
        ingest TEXT NOT NULL DEFAULT 'api',
        created_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rounds_source_ts ON rounds (source, ts_ms DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rounds_dedupe ON rounds (source, ts_ms, multiplier);
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        started_ms INTEGER NOT NULL,
        ended_ms INTEGER NOT NULL,
        rounds INTEGER NOT NULL DEFAULT 0,
        max_multiplier REAL NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        label TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'collector',
        created_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'operator',
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_ms INTEGER NOT NULL,
        disabled INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS tokens (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_ms INTEGER NOT NULL,
        expires_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS forecasts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        model TEXT NOT NULL,
        threshold REAL NOT NULL,
        probability REAL NOT NULL,
        note TEXT,
        created_ms INTEGER NOT NULL,
        resolved_ms INTEGER,
        resolved_round_id INTEGER,
        actual INTEGER,
        brier REAL
      );
      CREATE INDEX IF NOT EXISTS idx_forecasts_source ON forecasts (source, created_ms DESC);
      CREATE TABLE IF NOT EXISTS plugins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'analyzer',
        description TEXT NOT NULL DEFAULT '',
        weight REAL NOT NULL DEFAULT 1.0,
        enabled INTEGER NOT NULL DEFAULT 1,
        config TEXT NOT NULL DEFAULT '{}',
        runs INTEGER NOT NULL DEFAULT 0,
        created_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plugin_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plugin_id INTEGER NOT NULL,
        source TEXT NOT NULL,
        duration_ms REAL NOT NULL,
        output TEXT NOT NULL,
        created_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS autopilot_decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        round_id INTEGER,
        decision TEXT NOT NULL,
        threshold REAL,
        confidence REAL,
        reason TEXT NOT NULL DEFAULT '',
        stake REAL NOT NULL DEFAULT 0,
        pnl REAL NOT NULL DEFAULT 0,
        resolved INTEGER NOT NULL DEFAULT 0,
        created_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_autopilot_source ON autopilot_decisions (source, created_ms DESC);
      CREATE TABLE IF NOT EXISTS backtest_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        kind TEXT NOT NULL,
        params TEXT NOT NULL,
        result TEXT NOT NULL,
        created_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ingest_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        method TEXT NOT NULL,
        count INTEGER NOT NULL,
        rejected INTEGER NOT NULL DEFAULT 0,
        created_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS build_steps (
        step INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'done',
        updated_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        meta TEXT,
        created_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_ms DESC);
      CREATE TABLE IF NOT EXISTS top_rounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        scope TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        round_id INTEGER,
        ts TEXT NOT NULL,
        multiplier REAL NOT NULL,
        color TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_top_rounds ON top_rounds (source, scope, multiplier DESC);
      CREATE TABLE IF NOT EXISTS vocabulary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE NOT NULL,
        layer TEXT NOT NULL DEFAULT 'band',
        layers TEXT NOT NULL DEFAULT '[]',
        definition TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'candidate',
        uses INTEGER NOT NULL DEFAULT 0,
        hits INTEGER NOT NULL DEFAULT 0,
        misses INTEGER NOT NULL DEFAULT 0,
        score REAL NOT NULL DEFAULT 0.5,
        created_ms INTEGER NOT NULL,
        updated_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS releases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL,
        filename TEXT NOT NULL,
        url TEXT NOT NULL,
        sha256 TEXT,
        notes TEXT,
        manifest TEXT,
        created_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS orchestrator_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        kind TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scheduled_predictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL DEFAULT 'all',
        window TEXT NOT NULL,
        threshold REAL NOT NULL,
        model TEXT NOT NULL DEFAULT 'pipeline',
        probability REAL NOT NULL,
        per_round REAL NOT NULL DEFAULT 0,
        expected_rounds INTEGER NOT NULL,
        components TEXT,
        created_ms INTEGER NOT NULL,
        due_ms INTEGER NOT NULL,
        resolved_ms INTEGER,
        resolved_round_id INTEGER,
        actual INTEGER,
        outcome_rounds INTEGER,
        brier REAL,
        logloss REAL
      );
      CREATE INDEX IF NOT EXISTS idx_sched_due ON scheduled_predictions (resolved_ms, due_ms);
      CREATE TABLE IF NOT EXISTS accuracy_ledger (
        model TEXT NOT NULL,
        window TEXT NOT NULL,
        threshold REAL NOT NULL,
        n INTEGER NOT NULL DEFAULT 0,
        brier_sum REAL NOT NULL DEFAULT 0,
        base_sum REAL NOT NULL DEFAULT 0,
        logloss_sum REAL NOT NULL DEFAULT 0,
        hits INTEGER NOT NULL DEFAULT 0,
        rounds_scanned INTEGER NOT NULL DEFAULT 0,
        updated_ms INTEGER NOT NULL,
        PRIMARY KEY (model, window, threshold)
      );
      CREATE TABLE IF NOT EXISTS engine_weights (
        model TEXT PRIMARY KEY,
        skill REAL NOT NULL DEFAULT 0,
        weight REAL NOT NULL DEFAULT 0,
        updated_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS accuracy_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        window TEXT NOT NULL,
        threshold REAL NOT NULL,
        ts INTEGER NOT NULL,
        cumulative_n INTEGER NOT NULL,
        cumulative_brier REAL NOT NULL,
        cumulative_base REAL NOT NULL,
        hit_rate REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_acc_hist ON accuracy_history (window, threshold, ts);
      CREATE TABLE IF NOT EXISTS round_calibrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL DEFAULT 'all',
        state TEXT NOT NULL,
        expected REAL NOT NULL,
        range_lo REAL NOT NULL,
        range_hi REAL NOT NULL,
        reach REAL NOT NULL,
        tail_lift REAL NOT NULL,
        correction REAL NOT NULL DEFAULT 0,
        dist TEXT,
        actual REAL,
        verdict TEXT,
        reason TEXT,
        band_err INTEGER,
        log_err REAL,
        created_ms INTEGER NOT NULL,
        resolved_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_round_cal ON round_calibrations (resolved_ms, created_ms);
      CREATE TABLE IF NOT EXISTS intel_calibrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL DEFAULT 'all',
        round_id INTEGER,
        state TEXT NOT NULL,
        expected REAL NOT NULL,
        range_lo REAL NOT NULL,
        range_hi REAL NOT NULL,
        reach REAL NOT NULL,
        confidence REAL NOT NULL,
        correction REAL NOT NULL DEFAULT 0,
        dist TEXT,
        weights TEXT,
        comp_loss TEXT,
        mix_loss REAL,
        base_loss REAL,
        actual REAL,
        verdict TEXT,
        reason TEXT,
        band_err INTEGER,
        log_err REAL,
        created_ms INTEGER NOT NULL,
        resolved_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_intel_cal ON intel_calibrations (created_ms);
    `);
  }

  private async bootstrap(): Promise<void> {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    const userCount = (sql.exec("SELECT COUNT(*) AS n FROM users").toArray()[0] as { n: number }).n;
    if (userCount === 0) {
      const email = "operator@momento.local";
      const salt = crypto.randomUUID().replace(/-/g, "");
      const hash = await this.hashPassword("momento", salt);
      sql.exec(
        "INSERT INTO users (email, name, role, password_hash, salt, created_ms) VALUES (?, ?, 'operator', ?, ?, ?)",
        email, "Operator", hash, salt, now,
      );
    }
    const pluginCount = (sql.exec("SELECT COUNT(*) AS n FROM plugins").toArray()[0] as { n: number }).n;
    if (pluginCount === 0) {
      const plugins: [string, string, string, string, number][] = [
        ["ladders", "Ladder Telemetry", "analyzer", "Descending in-band collapse sequences with run-length histogram", 1.0],
        ["resistance", "Resistance / Ceilings", "analyzer", "Clustered local-maxima resistance levels with touch counts", 1.0],
        ["streaks", "Streaks & Markov", "analyzer", "Below/above-threshold streaks, conditional rates, 2x2 Markov", 1.0],
        ["regimes", "Session Regimes", "analyzer", "Per-session phase classification (compressed→eruption)", 1.0],
        ["edge_fit", "Edge Fit / House Edge", "analyzer", "Observed mean vs implied fair; cashout EV table", 1.0],
        ["pressure", "Mega Pressure", "analyzer", "Power-law tail priors and dry-run pressure on 100x+ targets", 1.0],
        ["moonshot", "Moonshot Scanner", "analyzer", "Linguistic moonshot factors with honest confidence", 0.9],
        ["shape_shifters", "ShapeShifters", "analyzer", "Curve anatomy, Pareto fit, dry zones, ETA bands, trajectory groups", 1.0],
        ["linguistics", "MomentoLinguistics", "analyzer", "Eight-layer semantic vocabulary over the live series", 0.9],
        ["markov_forecast", "Markov Forecaster", "forecast", "First-order Markov threshold forecasts (earned weight)", 0.0],
        ["ensemble_forecast", "Ensemble Forecaster", "forecast", "Blend of measured exceedance + conditional models", 0.0],
      ];
      for (const [key, name, category, description, weight] of plugins) {
        sql.exec(
          "INSERT OR IGNORE INTO plugins (key, name, category, description, weight, created_ms) VALUES (?, ?, ?, ?, ?, ?)",
          key, name, category, description, weight, now,
        );
      }
    }
    const stepCount = (sql.exec("SELECT COUNT(*) AS n FROM build_steps").toArray()[0] as { n: number }).n;
    if (stepCount === 0) {
      for (const s of BUILD_STEPS) {
        sql.exec("INSERT OR REPLACE INTO build_steps (step, title, status, updated_ms) VALUES (?, ?, 'done', ?)", s.step, s.title, now);
      }
    }
    const defaults: [string, string][] = [
      ["session_gap_minutes", "30"],
      ["orchestrator_patience", "3"],
      ["orchestrator_speed", "balanced"],
      ["orchestrator_risk", "moderate"],
      ["orchestrator_min_confidence", "0.55"],
      ["autopilot_running", "0"],
      ["autopilot_stake", "1.0"],
      ["autopilot_threshold", "2"],
      ["accuracy_enabled", "1"],
      ["accuracy_windows", "15m,1h,4h,1d,7d"],
      ["accuracy_thresholds", "2,5,10"],
      ["accuracy_last_tick", "0"],
    ];
    for (const [k, v] of defaults) {
      sql.exec("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", k, v);
    }
    const srcCount = (sql.exec("SELECT COUNT(*) AS n FROM sources").toArray()[0] as { n: number }).n;
    if (srcCount === 0) {
      for (const [name, label, kind] of [
        ["aviator", "Aviator Collector", "collector"],
      ] as [string, string, string][]) {
        sql.exec("INSERT OR IGNORE INTO sources (name, label, kind, created_ms) VALUES (?, ?, ?, ?)", name, label, kind, now);
      }
    }
    // Accuracy Engine v2: schedule the first tick so multi-window predictions
    // start accumulating even before the dashboard is opened.
    if (!(await this.ctx.storage.getAlarm())) {
      await this.ctx.storage.setAlarm(Date.now() + 20_000);
    }
    // Next-round calibration: backtest the trailing rounds so the rectification
    // correction is informed from the first live forecast.
    try {
      this.calibrateNewRounds([]);
    } catch (e) {
      console.error("calibration bootstrap failed", e instanceof Error ? e.message : String(e));
    }
  }

  // -------------------------------------------------------------------- auth

  private async hashPassword(password: string, salt: string): Promise<string> {
    const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 100_000, hash: "SHA-256" },
      keyMaterial,
      256,
    );
    return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  private bearer(request: Request): string | null {
    const h = request.headers.get("Authorization") ?? "";
    return h.startsWith("Bearer ") ? h.slice(7) : null;
  }

  private userFor(request: Request): Rows | null {
    const token = this.bearer(request);
    if (!token) return null;
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT u.id, u.email, u.name, u.role, t.expires_ms FROM tokens t JOIN users u ON u.id = t.user_id
         WHERE t.token = ? AND u.disabled = 0`,
        token,
      )
      .toArray() as Rows[];
    const row = rows[0];
    if (!row || (row.expires_ms as number) < Date.now()) return null;
    return row;
  }

  private requireOperator(request: Request): Rows {
    const user = this.userFor(request);
    if (!user) throw new HttpError("authentication required", 401);
    if (user.role !== "operator" && user.role !== "admin") throw new HttpError("operator role required", 403);
    return user;
  }

  private audit(actor: string, action: string, target?: string, meta?: unknown): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO audit_log (actor, action, target, meta, created_ms) VALUES (?, ?, ?, ?, ?)",
      actor, action, target ?? null, meta ? JSON.stringify(meta).slice(0, 2000) : null, Date.now(),
    );
  }

  private setting(key: string): string | null {
    const rows = this.ctx.storage.sql.exec("SELECT value FROM settings WHERE key = ?", key).toArray() as Rows[];
    return rows.length ? (rows[0].value as string) : null;
  }

  private setSetting(key: string, value: string): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key, value,
    );
  }

  // ------------------------------------------------------------------ rounds

  private invalidateCaches(): void {
    this.roundsCache.clear();
    this.analysisCache.clear();
  }

  private roundsFor(source: string | null, cacheable = true): Round[] {
    const key = source ?? "all";
    const stats = this.tableStats();
    if (cacheable) {
      const hit = this.roundsCache.get(key);
      if (hit && hit.maxId === stats.maxId && hit.count === stats.count) return hit.rounds;
    }
    const rows = (
      source && source !== "all"
        ? this.ctx.storage.sql.exec("SELECT id, ts, ts_ms, multiplier, color, source, session_id FROM rounds WHERE source = ? ORDER BY ts_ms ASC", source).toArray()
        : this.ctx.storage.sql.exec("SELECT id, ts, ts_ms, multiplier, color, source, session_id FROM rounds ORDER BY ts_ms ASC").toArray()
    ) as Rows[];
    const rounds: Round[] = rows.map((r) => ({
      id: r.id as number,
      ts: r.ts as string,
      tsMs: r.ts_ms as number,
      multiplier: r.multiplier as number,
      color: (r.color as string) ?? null,
      source: r.source as string,
      sessionId: (r.session_id as number) ?? null,
    }));
    if (cacheable) this.roundsCache.set(key, { maxId: stats.maxId, count: stats.count, rounds });
    return rounds;
  }

  private tableStats(): { maxId: number; count: number } {
    const row = this.ctx.storage.sql.exec("SELECT COALESCE(MAX(id), 0) AS maxId, COUNT(*) AS count FROM rounds").toArray()[0] as { maxId: number; count: number };
    return row;
  }

  private lastSessionId(): number {
    const row = this.ctx.storage.sql.exec("SELECT id FROM sessions ORDER BY id DESC LIMIT 1").toArray()[0] as { id: number } | undefined;
    return row?.id ?? 0;
  }

  /** 30-minute-gap sessionization (investigationsuite methodology). */
  private rebuildSessions(source: string): void {
    const gapMs = 30 * 60 * 1000;
    const sql = this.ctx.storage.sql;
    const rows = sql.exec("SELECT id, ts_ms, multiplier FROM rounds WHERE source = ? ORDER BY ts_ms ASC", source).toArray() as Rows[];
    sql.exec("DELETE FROM sessions WHERE source = ?", source);
    let sid: number | null = null;
    let startRow: Rows | null = null;
    let prev: Rows | null = null;
    let count = 0;
    let max = 0;
    const close = () => {
      if (sid !== null && startRow && prev) {
        sql.exec("UPDATE rounds SET session_id = ? WHERE id BETWEEN ? AND ?", sid, startRow.id as number, prev.id as number);
        sql.exec("UPDATE sessions SET started_ms = ?, ended_ms = ?, rounds = ?, max_multiplier = ? WHERE id = ?", startRow.ts_ms as number, prev.ts_ms as number, count, max, sid);
      }
    };
    for (const r of rows) {
      const ts = r.ts_ms as number;
      if (!startRow || (prev !== null && ts - (prev.ts_ms as number) > gapMs)) {
        close();
        sql.exec("INSERT INTO sessions (source, started_ms, ended_ms, rounds, max_multiplier) VALUES (?, ?, ?, 0, 0)", source, ts, ts);
        sid = this.lastSessionId();
        startRow = r;
        count = 0;
        max = 0;
      }
      count++;
      max = Math.max(max, r.multiplier as number);
      prev = r;
    }
    close();
  }

  private normalizeRound(raw: unknown, fallbackTsMs: number): { tsMs: number; multiplier: number; color: string | null } | null {
    if (typeof raw !== "object" || raw === null) {
      const n = Number(raw);
      return Number.isFinite(n) && n >= 1 ? { tsMs: fallbackTsMs, multiplier: n, color: null } : null;
    }
    const o = raw as Record<string, unknown>;
    const multRaw = o.multiplier ?? o.value ?? o.crash_point ?? o.result ?? o.payout;
    const multiplier = Number(multRaw);
    if (!Number.isFinite(multiplier) || multiplier < 1) return null;
    const tsRaw = o.timestamp ?? o.time ?? o.ts ?? o.created_at;
    let tsMs = fallbackTsMs;
    if (typeof tsRaw === "number") tsMs = tsRaw > 1e12 ? tsRaw : tsRaw * 1000;
    else if (typeof tsRaw === "string") {
      const parsed = Date.parse(tsRaw);
      if (!Number.isNaN(parsed)) tsMs = parsed;
    }
    const colorRaw = o.color ?? o.colour;
    const color = typeof colorRaw === "string" && colorRaw.length ? colorRaw.toLowerCase().slice(0, 16) : null;
    return { tsMs, multiplier: Math.min(multiplier, 1e7), color };
  }

  private ingestRounds(source: string, method: string, incoming: unknown[]): { inserted: number; rejected: number } {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    let inserted = 0;
    let rejected = 0;
    const sorted = incoming
      .map((r) => this.normalizeRound(r, now))
      .filter((r): r is { tsMs: number; multiplier: number; color: string | null } => r !== null);
    rejected = incoming.length - sorted.length;
    sorted.sort((a, b) => a.tsMs - b.tsMs);
    this.ctx.storage.transactionSync(() => {
      for (const r of sorted) {
        const ts = new Date(r.tsMs).toISOString().replace(/\.\d{3}Z$/, ".000Z");
        const res = sql.exec(
          "INSERT OR IGNORE INTO rounds (ts, ts_ms, multiplier, color, source, session_id, ingest, created_ms) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)",
          ts, r.tsMs, r.multiplier, r.color, source, method, now,
        );
        inserted += res.rowsWritten ?? 0;
      }
    });
    sql.exec(
      "INSERT INTO ingest_log (source, method, count, rejected, created_ms) VALUES (?, ?, ?, ?, ?)",
      source, method, inserted, rejected, now,
    );
    sql.exec(
      "INSERT INTO sources (name, label, kind, created_ms) VALUES (?, ?, 'collector', ?) ON CONFLICT(name) DO NOTHING",
      source, source, now,
    );
    this.invalidateCaches();
    if (sorted.length > 0 && sorted.length <= 200) this.extendSessions(source, sorted);
    if (inserted > 0) this.calibrateNewRounds();
    return { inserted, rejected };
  }

  /** Incremental sessionization for small live batches. */
  private extendSessions(source: string, sorted: { tsMs: number; multiplier: number; color: string | null }[]): void {
    const gapMs = 30 * 60 * 1000;
    const sql = this.ctx.storage.sql;
    const last = sql.exec("SELECT * FROM sessions WHERE source = ? ORDER BY ended_ms DESC LIMIT 1", source).toArray()[0] as Rows | undefined;
    let sid = (last?.id as number) ?? null;
    let started = (last?.started_ms as number) ?? 0;
    let ended = (last?.ended_ms as number) ?? 0;
    let count = (last?.rounds as number) ?? 0;
    let max = (last?.max_multiplier as number) ?? 0;
    for (const r of sorted) {
      const idRow = sql.exec("SELECT id FROM rounds WHERE source = ? AND ts_ms = ? AND multiplier = ? ORDER BY id DESC LIMIT 1", source, r.tsMs, r.multiplier).toArray()[0] as { id: number } | undefined;
      if (!idRow) continue;
      if (sid === null || r.tsMs - ended > gapMs) {
        sql.exec("INSERT INTO sessions (source, started_ms, ended_ms, rounds, max_multiplier) VALUES (?, ?, ?, 0, 0)", source, r.tsMs, r.tsMs);
        sid = this.lastSessionId();
        started = r.tsMs;
        count = 0;
        max = 0;
      }
      ended = Math.max(ended, r.tsMs);
      count++;
      max = Math.max(max, r.multiplier);
      sql.exec("UPDATE rounds SET session_id = ? WHERE id = ?", sid, idRow.id);
    }
    if (sid !== null) {
      sql.exec("UPDATE sessions SET started_ms = ?, ended_ms = ?, rounds = ?, max_multiplier = ? WHERE id = ?", started, ended, count, max, sid);
    }
  }

  // -------------------------------------------------------------- analysis

  private analysisPayload(source: string | null): Record<string, unknown> {
    const rounds = this.roundsFor(source);
    const maxId = this.tableStats().maxId;
    const key = `${source ?? "all"}:${maxId}`;
    const hit = this.analysisCache.get(key);
    if (hit) return hit.payload as Record<string, unknown>;
    const ov = overviewOf(rounds);
    const exc = exceedanceOf(rounds);
    const st = streaksOf(rounds, 2);
    const bd = bandsOf(rounds);
    const pr = pressureOf(rounds);
    const sh = shapeOf(rounds);
    const ms = moonshotOf(rounds);
    const gp = gapsOf(rounds);
    const he = houseEdgeOf(rounds);
    const ld = laddersOf(rounds);
    const cl = ceilingsOf(rounds);
    const payload = {
      source: source ?? "all",
      generatedAt: new Date().toISOString(),
      overview: ov,
      exceedance: exc,
      streaks: st,
      bands: bd,
      pressure: pr,
      shape: sh,
      moonshot: ms,
      gaps: gp,
      houseEdge: he,
      ladders: ld,
      ceilings: cl,
    };
    this.analysisCache.set(key, { maxId, payload });
    return payload;
  }

  private forecastAccuracy(source: string | null): Record<string, unknown> {
    const rows = (
      source && source !== "all"
        ? this.ctx.storage.sql.exec("SELECT * FROM forecasts WHERE source = ? ORDER BY created_ms DESC LIMIT 500", source).toArray()
        : this.ctx.storage.sql.exec("SELECT * FROM forecasts ORDER BY created_ms DESC LIMIT 500").toArray()
    ) as Rows[];
    const resolved = rows.filter((r) => r.actual !== null && r.actual !== undefined);
    const brier = resolved.length ? resolved.reduce((a, r) => a + ((r.brier as number) ?? 0), 0) / resolved.length : null;
    const byModel = new Map<string, { model: string; n: number; brierSum: number; hits: number }>();
    for (const r of resolved) {
      let m = byModel.get(r.model as string);
      if (!m) {
        m = { model: r.model as string, n: 0, brierSum: 0, hits: 0 };
        byModel.set(r.model as string, m);
      }
      m.n++;
      m.brierSum += (r.brier as number) ?? 0;
      if (r.actual === 1) m.hits++;
    }
    return {
      total: rows.length,
      open: rows.length - resolved.length,
      resolved: resolved.length,
      brier: brier !== null ? +brier.toFixed(5) : null,
      perModel: [...byModel.values()].map((m) => ({ model: m.model, n: m.n, brier: +(m.brierSum / m.n).toFixed(5), hitRate: +(m.hits / m.n).toFixed(4) })),
      recent: rows.slice(0, 50),
    };
  }

  /** Resolve open forecasts against the newest round (stored-before-landing honesty). */
  private resolveForecasts(): number {
    const latest = this.ctx.storage.sql.exec("SELECT id, multiplier FROM rounds ORDER BY ts_ms DESC LIMIT 1").toArray()[0] as Rows | undefined;
    if (!latest) return 0;
    const open = this.ctx.storage.sql.exec("SELECT id, threshold, probability FROM forecasts WHERE actual IS NULL").toArray() as Rows[];
    let n = 0;
    for (const f of open) {
      const actual = (latest.multiplier as number) >= (f.threshold as number) ? 1 : 0;
      const p = f.probability as number;
      const brier = (p - actual) ** 2;
      this.ctx.storage.sql.exec("UPDATE forecasts SET actual = ?, brier = ?, resolved_ms = ?, resolved_round_id = ? WHERE id = ?", actual, brier, Date.now(), latest.id, f.id);
      n++;
    }
    return n;
  }

  // ------------------------------------------------- accuracy engine v2

  private accuracyBusy = false;

  private accuracyConfig(): { enabled: boolean; windows: WindowDef[]; thresholds: number[] } {
    const enabled = this.setting("accuracy_enabled") !== "0";
    const winIds = (this.setting("accuracy_windows") ?? "15m,1h,4h,1d,7d").split(",").map((s) => s.trim()).filter(Boolean);
    const windows = winIds.map((id) => WINDOWS.find((w) => w.id === id)).filter((w): w is WindowDef => Boolean(w));
    const thresholds = (this.setting("accuracy_thresholds") ?? "2,5,10").split(",").map(Number).filter((v) => Number.isFinite(v) && v >= 1.01);
    return { enabled, windows: windows.length ? windows : WINDOWS, thresholds: thresholds.length ? thresholds : [2, 5, 10] };
  }

  private weightsMap(): Record<string, number> {
    const rows = this.ctx.storage.sql.exec("SELECT model, weight FROM engine_weights WHERE weight > 0").toArray() as Rows[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.model as string] = r.weight as number;
    return out;
  }

  /** Earned weights: Brier skill (baseline − model) aggregated across all windows/thresholds. */
  private recomputeWeights(): void {
    const rows = this.ctx.storage.sql
      .exec("SELECT model, SUM(brier_sum) AS b, SUM(base_sum) AS s, SUM(n) AS n FROM accuracy_ledger WHERE n > 0 GROUP BY model")
      .toArray() as Rows[];
    const skills = new Map<string, number>();
    for (const r of rows) {
      const n = (r.n as number) || 0;
      if (n < 5) continue;
      skills.set(r.model as string, ((r.s as number) - (r.b as number)) / n);
    }
    const now = Date.now();
    const positive = [...skills.entries()].filter(([, s]) => s > 0);
    const total = positive.reduce((a, [, s]) => a + s, 0);
    const models = new Set<string>([...skills.keys(), "baseline", "markov", "streak", "recent", "ensemble"]);
    for (const m of models) {
      const skill = skills.get(m) ?? 0;
      const weight = total > 0 ? Math.max(0, skill) / total : 0;
      this.ctx.storage.sql.exec(
        `INSERT INTO engine_weights (model, skill, weight, updated_ms) VALUES (?, ?, ?, ?)
         ON CONFLICT(model) DO UPDATE SET skill = excluded.skill, weight = excluded.weight, updated_ms = excluded.updated_ms`,
        m, +skill.toFixed(5), +weight.toFixed(5), now,
      );
    }
  }

  /** Observed round cadence (median gap of the last ~200 rounds). */
  private cadenceMs(): number {
    const rows = this.ctx.storage.sql.exec("SELECT ts_ms FROM rounds ORDER BY ts_ms DESC LIMIT 201").toArray() as Rows[];
    const ts = rows.map((r) => r.ts_ms as number).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < ts.length; i++) {
      const g = ts[i] - ts[i - 1];
      if (g > 0 && g < 6 * 3600_000) gaps.push(g);
    }
    if (!gaps.length) return 4000;
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)];
  }

  /** Accumulative ledger upsert — O(1) per resolution, never pruned (unlimited scale). */
  private upsertLedger(model: string, window: string, threshold: number, d: { n: number; brierSum: number; baseSum: number; loglossSum: number; hits: number; roundsScanned: number }): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO accuracy_ledger (model, window, threshold, n, brier_sum, base_sum, logloss_sum, hits, rounds_scanned, updated_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(model, window, threshold) DO UPDATE SET
         n = n + excluded.n,
         brier_sum = brier_sum + excluded.brier_sum,
         base_sum = base_sum + excluded.base_sum,
         logloss_sum = logloss_sum + excluded.logloss_sum,
         hits = hits + excluded.hits,
         rounds_scanned = rounds_scanned + excluded.rounds_scanned,
         updated_ms = excluded.updated_ms`,
      model, window, threshold, d.n, d.brierSum, d.baseSum, d.loglossSum, d.hits, d.roundsScanned, Date.now(),
    );
  }

  /** Append a cumulative accuracy point for the rolling chart, then decimate. */
  private appendAccuracyHistory(window: string, threshold: number): void {
    const sql = this.ctx.storage.sql;
    const row = sql.exec(
      "SELECT SUM(n) AS n, SUM(brier_sum) AS b, SUM(base_sum) AS s, SUM(hits) AS h FROM accuracy_ledger WHERE model = 'pipeline' AND window = ? AND threshold = ?",
      window, threshold,
    ).toArray()[0] as { n: number; b: number; s: number; h: number };
    const n = Math.max(1, row.n);
    sql.exec(
      "INSERT INTO accuracy_history (window, threshold, ts, cumulative_n, cumulative_brier, cumulative_base, hit_rate) VALUES (?, ?, ?, ?, ?, ?, ?)",
      window, threshold, Date.now(), row.n, +(row.b / n).toFixed(6), +(row.s / n).toFixed(6), +(row.h / n).toFixed(4),
    );
    const over = (sql.exec("SELECT COUNT(*) AS n FROM accuracy_history WHERE window = ? AND threshold = ?", window, threshold).toArray()[0] as { n: number }).n;
    if (over > 600) {
      sql.exec(
        `DELETE FROM accuracy_history WHERE window = ? AND threshold = ? AND id <=
         (SELECT MAX(id) - 400 FROM accuracy_history WHERE window = ? AND threshold = ?)`,
        window, threshold, window, threshold,
      );
    }
  }

  /**
   * One scheduler tick: resolve matured multi-window predictions against the
   * rounds history, update accumulators + earned weights, schedule replacements,
   * keep the live engine producing rounds, and arm the next alarm.
   */
  async accuracyTick(): Promise<Record<string, unknown>> {
    if (this.accuracyBusy) return { skipped: true, reason: "tick already running" };
    this.accuracyBusy = true;
    try {
      const sql = this.ctx.storage.sql;
      const now = Date.now();
      const cfg = this.accuracyConfig();
      const summary: Record<string, unknown> = { resolved: 0, scheduled: 0, fed: 0, weights: false };
      if (!cfg.enabled) {
        await this.scheduleAccuracyAlarm();
        return { disabled: true, ...summary };
      }
      const cadence = this.cadenceMs();
      const roundsAll = this.roundsFor(null);

      // 1. resolve matured predictions against the actual history
      const matured = sql.exec("SELECT * FROM scheduled_predictions WHERE resolved_ms IS NULL AND due_ms <= ?", now).toArray() as Rows[];
      for (const f of matured) {
        const outcomeRow = sql.exec(
          "SELECT COUNT(*) AS n FROM rounds WHERE ts_ms > ? AND ts_ms <= ? AND multiplier >= ?",
          f.created_ms as number, f.due_ms as number, f.threshold as number,
        ).toArray()[0] as { n: number };
        const actual = (outcomeRow.n as number) > 0 ? 1 : 0;
        const p = f.probability as number;
        const brier = (p - actual) ** 2;
        let baseP = 0.5;
        try {
          const comps = JSON.parse((f.components as string) ?? "[]") as { model: string; p: number }[];
          baseP = comps.find((c) => c.model === "baseline")?.p ?? 0.5;
        } catch { /* keep 0.5 */ }
        const baseBrier = (baseP - actual) ** 2;
        const logloss = -(actual * Math.log(Math.max(1e-9, p)) + (1 - actual) * Math.log(Math.max(1e-9, 1 - p)));
        sql.exec(
          "UPDATE scheduled_predictions SET resolved_ms = ?, actual = ?, outcome_rounds = ?, brier = ?, logloss = ? WHERE id = ?",
          now, actual, outcomeRow.n, +brier.toFixed(6), +logloss.toFixed(6), f.id as number,
        );
        this.upsertLedger("pipeline", f.window as string, f.threshold as number, { n: 1, brierSum: brier, baseSum: baseBrier, loglossSum: logloss, hits: (p >= 0.5) === (actual === 1) ? 1 : 0, roundsScanned: 0 });
        this.appendAccuracyHistory(f.window as string, f.threshold as number);
        summary.resolved = (summary.resolved as number) + 1;
      }

      // 2. recompute earned weights from the accumulative ledger
      if (matured.length) {
        this.recomputeWeights();
        summary.weights = true;
      }

      // 3. schedule one open prediction per (window, threshold) — stored before landing
      const weights = this.weightsMap();
      for (const w of cfg.windows) {
        const nR = expectedRounds(roundsAll, w.ms);
        for (const t of cfg.thresholds) {
          const open = sql.exec("SELECT id FROM scheduled_predictions WHERE window = ? AND threshold = ? AND resolved_ms IS NULL LIMIT 1", w.id, t).toArray();
          if (open.length) continue;
          const per = perRoundProbability(roundsAll, t, weights);
          const pWin = windowProbability(per.p, nR);
          sql.exec(
            `INSERT INTO scheduled_predictions (source, window, threshold, model, probability, per_round, expected_rounds, components, created_ms, due_ms)
             VALUES ('all', ?, ?, 'pipeline', ?, ?, ?, ?, ?, ?)`,
            w.id, t, +pWin.toFixed(6), per.p, nR, JSON.stringify(per.components), now, now + w.ms,
          );
          summary.scheduled = (summary.scheduled as number) + 1;
        }
      }

      // 4. accuracy tick complete — no synthetic feed

      this.setSetting("accuracy_last_tick", String(now));
      await this.scheduleAccuracyAlarm();
      summary.cadenceMs = cadence;
      summary.enabledWindows = cfg.windows.map((w) => w.id);
      summary.thresholds = cfg.thresholds;
      return summary;
    } finally {
      this.accuracyBusy = false;
    }
  }

  private async scheduleAccuracyAlarm(): Promise<void> {
    const row = this.ctx.storage.sql
      .exec("SELECT MIN(due_ms) AS d FROM scheduled_predictions WHERE resolved_ms IS NULL")
      .toArray()[0] as { d: number | null } | undefined;
    const due = row?.d ?? null;
    const next = due ? Math.min(due + 1_000, Date.now() + 15 * 60_000) : Date.now() + 60_000;
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 5_000, next));
  }

  // Durable alarm — scheduled multi-window predictions keep verifying on schedule.
  override async alarm(): Promise<void> {
    try {
      await this.accuracyTick();
    } catch (e) {
      console.error("accuracy alarm tick failed", e instanceof Error ? e.message : String(e));
    }
    await this.scheduleAccuracyAlarm();
  }

  // ------------------------------------------------- next-round calibration
  //
  // The rectification loop: every recorded round is scored against the
  // band-model next-round forecast that existed BEFORE it landed (stored at
  // ingest). Scoring is loose by design — off-by-one band counts as a hit and
  // the range is checked with padding — so reasonable misses in the targets /
  // next-few-rounds ETAs don't trigger overfitting. Accumulated log-bias over
  // the trailing window becomes a bounded correction factor applied to the
  // live next-round point estimate (rectification).

  private calibrationConfig(): { enabled: boolean; window: number; minSample: number } {
    return {
      enabled: this.setting("calibration_enabled") !== "0",
      window: clampInt(this.setting("calibration_window") ?? "30", 10, 200, 30),
      minSample: 15,
    };
  }

  /** Current rectification correction (log-bias of expected vs actual). */
  private bandCorrection(): { value: number; sampleSize: number } {
    const cfg = this.calibrationConfig();
    const sql = this.ctx.storage.sql;
    const corrRow = sql.exec("SELECT correction FROM round_calibrations WHERE id = -1").toArray()[0] as { correction: number | null } | undefined;
    const nRow = sql.exec("SELECT COUNT(*) AS n FROM round_calibrations WHERE id <> -1 AND resolved_ms IS NOT NULL").toArray()[0] as { n: number };
    const v = corrRow?.correction ?? 0;
    const n = nRow?.n ?? 0;
    return n >= cfg.minSample ? { value: v, sampleSize: n } : { value: 0, sampleSize: n };
  }

  /** Score one forecast against the actual next-round multiplier (loose). */
  private scoreRoundForecast(
    expected: number,
    rangeLo: number,
    rangeHi: number,
    actual: number,
    state: string,
    tailLift: number,
  ): { verdict: string; bandErr: number; logErr: number; reason: string } {
    const bandErr = bandIndex(actual) - bandIndex(expected);
    const logErr = Math.log(Math.max(1, actual)) - Math.log(Math.max(1, expected));
    const inRange = actual >= rangeLo && actual <= rangeHi;
    const looseRange = actual >= rangeLo / 1.5 && actual <= rangeHi * 1.5;
    let verdict: string;
    let reason: string;
    if (inRange && Math.abs(bandErr) <= 1) {
      verdict = "hit";
      reason = `Actual settled inside the p25–p75 range in ${bandErr === 0 ? "the" : "an adjacent"} projected band — ${state} projection held.`;
    } else if (Math.abs(bandErr) <= 1 && looseRange) {
      verdict = "adjacent";
      reason = `Off by one band (${bandLabelOfShort(bandIndex(expected))} → ${bandLabelOfShort(bandIndex(actual))}) and inside the padded range — direction correct.`;
    } else if (bandErr > 1) {
      verdict = "miss-high";
      reason = `Actual landed ${bandErr} bands ABOVE the projected ${bandLabelOfShort(bandIndex(expected))} — the tail was hotter than tail-lift ${tailLift.toFixed(2)} implied under ${state}. The lift is too timid for this regime.`;
    } else if (bandErr < -1) {
      verdict = "miss-low";
      reason = `Actual landed ${-bandErr} bands BELOW the projected ${bandLabelOfShort(bandIndex(expected))} — the base bands held weight the model gave to the tail; ${state} over-weighted moonshot bands.`;
    } else {
      verdict = "near";
      reason = `Just outside the central range in a neighbouring band — the band split was right, the range edges were tight.`;
    }
    return { verdict, bandErr, logErr, reason };
  }

  /**
   * Score each target round against the band-model next-round forecast that
   * existed BEFORE it landed (history strictly prior, with the correction
   * accumulated up to that point — online rectification). First run backtests
   * the trailing rounds so the loop starts informed.
   */
  private calibrateNewRounds(): number {
    const cfg = this.calibrationConfig();
    if (!cfg.enabled) return 0;
    const sql = this.ctx.storage.sql;
    const all = this.roundsFor(null);
    const existing = (sql.exec("SELECT COUNT(*) AS n, MAX(created_ms) AS last FROM round_calibrations WHERE id <> -1").toArray()[0] as { n: number; last: number | null });
    const targets = existing.n
      ? all.filter((x) => x.tsMs > (existing.last ?? 0))
      : all.slice(-120);
    let scored = 0;
    for (const r of targets) {
      const history = all.filter((x) => x.tsMs < r.tsMs);
      if (history.length < 100) continue;
      const corr = this.bandCorrection();
      // score the raw (uncorrected) band model — drift is measured against it
      const f = nextRoundForecast(history, "all", this.weightsMap());
      const s = this.scoreRoundForecast(f.expectedMultiplier, f.rangeLo, f.rangeHi, r.multiplier, f.state, f.tailLift);
      sql.exec(
        `INSERT INTO round_calibrations (source, state, expected, range_lo, range_hi, reach, tail_lift, correction, dist, actual, verdict, reason, band_err, log_err, created_ms, resolved_ms)
         VALUES ('all', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        f.state, f.expectedMultiplier, f.rangeLo, f.rangeHi, f.moonshotReach, f.tailLift, corr.value,
        JSON.stringify(f.distribution), r.multiplier, s.verdict, s.reason, s.bandErr, +s.logErr.toFixed(5),
        r.tsMs, r.tsMs,
      );
      scored++;
    }
    if (scored) {
      this.updateBandCorrection();
      console.log(`[momento-v6] calibration: ${scored} rounds scored (${existing.n ? "incremental" : "backtest"})`);
    }
    try {
      this.calibrateIntel(all);
    } catch (e) {
      console.error("intel calibration failed", e instanceof Error ? e.message : String(e));
    }
    return scored;
  }

  // ------------------------------------------- full-intelligence calibration
  //
  // Every round is scored against the full-intelligence forecast that existed
  // BEFORE it landed. Besides the loose verdict, each engine's own next-round
  // distribution is log-scored on the band that landed; the trailing mean
  // log-loss per engine becomes its earned mixture weight (Bayesian model
  // averaging with floors), so engines that stop paying lose weight.

  private intelLedgerCache: { key: string; value: IntelWeights } | null = null;

  /** Trailing per-engine log-loss, mixture/base log-loss and loose hit rate. */
  private intelLedger(window = 200): IntelWeights {
    const sql = this.ctx.storage.sql;
    const stamp = sql.exec("SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS id FROM intel_calibrations").toArray()[0] as { n: number; id: number };
    const key = `${stamp.n}:${stamp.id}:${window}`;
    if (this.intelLedgerCache?.key === key) return this.intelLedgerCache.value;
    const rows = sql
      .exec("SELECT comp_loss, mix_loss, base_loss, verdict FROM intel_calibrations WHERE resolved_ms IS NOT NULL ORDER BY created_ms DESC LIMIT ?", window)
      .toArray() as Rows[];
    const sums: Record<string, number> = {};
    let mix = 0, base = 0, hits = 0;
    for (const r of rows) {
      const cl = r.comp_loss ? (JSON.parse(r.comp_loss as string) as Record<string, number>) : {};
      for (const [k, v] of Object.entries(cl)) sums[k] = (sums[k] ?? 0) + v;
      mix += (r.mix_loss as number) ?? 0;
      base += (r.base_loss as number) ?? 0;
      if (r.verdict === "hit" || r.verdict === "adjacent") hits++;
    }
    const n = rows.length;
    const logLoss: Record<string, number> = {};
    if (n) for (const [k, v] of Object.entries(sums)) logLoss[k] = v / n;
    const value: IntelWeights = {
      weights: {},
      logLoss,
      sample: n,
      mixLogLoss: n ? mix / n : null,
      baseLogLoss: n ? base / n : null,
      hitRate: n ? hits / n : null,
    };
    this.intelLedgerCache = { key, value };
    return value;
  }

  /** Bounded log-bias correction of the mixture point estimate (trailing window). */
  private intelCorrection(): { value: number; sampleSize: number } {
    const cfg = this.calibrationConfig();
    const rows = this.ctx.storage.sql
      .exec("SELECT log_err FROM intel_calibrations WHERE resolved_ms IS NOT NULL ORDER BY created_ms DESC LIMIT ?", cfg.window)
      .toArray() as Rows[];
    const total = (this.ctx.storage.sql.exec("SELECT COUNT(*) AS n FROM intel_calibrations").toArray()[0] as { n: number }).n;
    if (rows.length < cfg.minSample) return { value: 0, sampleSize: total };
    // median, not mean: the point estimate is the mixture MEDIAN, and on a
    // heavy-tailed payout the mean log error is positive even when the median
    // is perfectly calibrated.
    const errs = rows.map((r) => (r.log_err as number) ?? 0).sort((a, b) => a - b);
    const mid = errs.length % 2 ? errs[(errs.length - 1) / 2] : (errs[errs.length / 2 - 1] + errs[errs.length / 2]) / 2;
    return { value: Math.max(-1.5, Math.min(1.5, mid)), sampleSize: total };
  }

  /** Build the live full-intelligence forecast with the current ledger + rectification. */
  private intelForecast(rounds: Round[], source: string): FullIntelligenceForecast {
    const corr = this.intelCorrection();
    return fullIntelligenceForecast(rounds, source, {
      ledger: this.intelLedger(),
      pipelineWeights: this.weightsMap(),
      correction: corr.value || undefined,
      correctionSample: corr.sampleSize,
    });
  }

  private calibrateIntel(all: Round[]): number {
    const cfg = this.calibrationConfig();
    if (!cfg.enabled || all.length < 150) return 0;
    const sql = this.ctx.storage.sql;
    const lastRow = sql.exec("SELECT COUNT(*) AS n, MAX(created_ms) AS last FROM intel_calibrations").toArray()[0] as { n: number; last: number | null };
    const maxBacktest = clampInt(this.setting("intel_backtest_rounds") ?? "150", 20, 1000, 150);
    let startIdx: number;
    if (!lastRow.n) startIdx = Math.max(100, all.length - maxBacktest);
    else {
      startIdx = all.length;
      while (startIdx > 0 && all[startIdx - 1].tsMs > (lastRow.last ?? 0)) startIdx--;
      // cap catch-up work on bulk imports: score only the most recent rounds
      startIdx = Math.max(startIdx, all.length - 300, 100);
    }
    let scored = 0;
    const weights = this.weightsMap();
    for (let i = startIdx; i < all.length; i++) {
      const target = all[i];
      const history = all.slice(0, i);
      const ledger = this.intelLedger();
      const corr = this.intelCorrection();
      const f = fullIntelligenceForecast(history, "all", {
        ledger,
        pipelineWeights: weights,
        correction: corr.value || undefined,
        correctionSample: corr.sampleSize,
      });
      // score the raw (uncorrected) point estimate so rectification measures drift, not itself
      const rawF = { ...f, expectedMultiplier: f.baseMultiplier };
      const s = scoreIntelForecast(rawF, target.multiplier);
      const compLoss: Record<string, number> = {};
      for (const c of f.intelligence.components) compLoss[c.key] = +bandLogLoss(c.distribution, target.multiplier).toFixed(5);
      const mixLoss = bandLogLoss(f.distribution.map((d) => d.probability), target.multiplier);
      sql.exec(
        `INSERT INTO intel_calibrations (source, round_id, state, expected, range_lo, range_hi, reach, confidence, correction, dist, weights, comp_loss, mix_loss, base_loss, actual, verdict, reason, band_err, log_err, created_ms, resolved_ms)
         VALUES ('all', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        target.id, f.state, f.expectedMultiplier, f.rangeLo, f.rangeHi, f.moonshotReach, f.confidence, corr.value,
        JSON.stringify(f.distribution.map((d) => d.probability)),
        JSON.stringify(Object.fromEntries(f.intelligence.components.map((c) => [c.key, c.weight]))),
        JSON.stringify(compLoss), +mixLoss.toFixed(5), compLoss.baseline ?? null,
        target.multiplier, s.verdict, s.reason, s.bandErr, +s.logErr.toFixed(5), target.tsMs, target.tsMs,
      );
      scored++;
    }
    if (scored) console.log(`[momento-v6] intel calibration: ${scored} rounds scored (${lastRow.n ? "incremental" : "backtest"})`);
    return scored;
  }

  /** Recompute the bounded log-bias correction over the trailing window. */
  private updateBandCorrection(): void {
    const cfg = this.calibrationConfig();
    const rows = this.ctx.storage.sql
      .exec("SELECT log_err FROM round_calibrations WHERE id <> -1 AND resolved_ms IS NOT NULL ORDER BY created_ms DESC LIMIT ?", cfg.window)
      .toArray() as Rows[];
    const n = rows.length;
    const mean = n ? rows.reduce((a, r) => a + (r.log_err as number), 0) / n : 0;
    const value = Math.max(-1.5, Math.min(1.5, mean));
    this.ctx.storage.sql.exec(
      `INSERT INTO round_calibrations (id, source, state, expected, range_lo, range_hi, reach, tail_lift, correction, dist, actual, verdict, reason, band_err, log_err, created_ms, resolved_ms)
       VALUES (-1, 'all', 'state', 0, 0, 0, 0, 0, ?, NULL, NULL, 'state', ?, 0, 0, 0, 0)
       ON CONFLICT(id) DO UPDATE SET correction = excluded.correction, reason = excluded.reason`,
      +value.toFixed(5), `rectification state · n=${n} over trailing ${cfg.window} · bias ${Math.round(value * 100)}%`,
    );
  }

  // ------------------------------------------------------------------- router

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;
    const q = url.searchParams;
    try {
      return await this.route(method, path, q, request);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.message, e.status);
      console.error("momento core error", e instanceof Error ? e.message : String(e));
      return fail("internal error: " + (e instanceof Error ? e.message : String(e)), 500);
    }
  }

  private async route(method: string, path: string, q: URLSearchParams, request: Request): Promise<Response> {
    const sql = this.ctx.storage.sql;
    const body = method === "POST" || method === "PUT" ? await readBody(request) : {};

    // ---- system
    if (path === "/ping") return ok({ service: "momento-core", version: VERSION, booted: this.booted });
    if (path === "/api/v1/health" && method === "GET") {
      const stats = this.tableStats();
      return ok({ service: "momento-core", version: VERSION, rounds: stats.count, time: new Date().toISOString() });
    }

    // ---- auth
    if (path === "/api/v1/auth/login" && method === "POST") {
      const email = String(body.email ?? "").toLowerCase().trim();
      const password = String(body.password ?? "");
      const rows = sql.exec("SELECT * FROM users WHERE email = ? AND disabled = 0", email).toArray() as Rows[];
      const user = rows[0];
      if (!user) return fail("invalid credentials", 401);
      const hash = await this.hashPassword(password, user.salt as string);
      if (hash !== user.password_hash) return fail("invalid credentials", 401);
      const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      const expires = Date.now() + 30 * 24 * 3600 * 1000;
      sql.exec("INSERT INTO tokens (token, user_id, created_ms, expires_ms) VALUES (?, ?, ?, ?)", token, user.id, Date.now(), expires);
      this.audit(email, "auth.login");
      return ok({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role }, expiresMs: expires });
    }
    if (path === "/api/v1/auth/register" && method === "POST") {
      const op = this.requireOperator(request);
      const email = String(body.email ?? "").toLowerCase().trim();
      const password = String(body.password ?? "");
      if (!email.includes("@") || password.length < 4) return fail("valid email and 4+ char password required");
      const salt = crypto.randomUUID().replace(/-/g, "");
      const hash = await this.hashPassword(password, salt);
      try {
        sql.exec("INSERT INTO users (email, name, role, password_hash, salt, created_ms) VALUES (?, ?, ?, ?, ?, ?)", email, String(body.name ?? email.split("@")[0]), String(body.role ?? "client"), hash, salt, Date.now());
      } catch {
        return fail("email already registered", 409);
      }
      this.audit(op.email as string, "users.create", email);
      return ok({ email, role: body.role ?? "client" });
    }
    if (path === "/api/v1/auth/me" && method === "GET") {
      const user = this.userFor(request);
      return ok(user ? { id: user.id, email: user.email, name: user.name, role: user.role } : null);
    }

    // ---- rounds / sessions / sources / statistics
    if (path === "/api/v1/rounds" && method === "GET") {
      const source = q.get("source");
      const limit = clampInt(q.get("limit"), 1, 5000, 200);
      const order = q.get("order") === "asc" ? "ASC" : "DESC";
      const rows = (
        source && source !== "all"
          ? sql.exec(`SELECT id, ts, multiplier, color, source, session_id FROM rounds WHERE source = ? ORDER BY ts_ms ${order} LIMIT ?`, source, limit).toArray()
          : sql.exec(`SELECT id, ts, multiplier, color, source, session_id FROM rounds ORDER BY ts_ms ${order} LIMIT ?`, limit).toArray()
      ) as Rows[];
      return ok({ rounds: rows, count: rows.length });
    }
    if (path === "/api/v1/rounds/latest" && method === "GET") {
      const source = q.get("source");
      const rows = (
        source && source !== "all"
          ? sql.exec("SELECT id, ts, multiplier, color, source, session_id FROM rounds WHERE source = ? ORDER BY ts_ms DESC LIMIT ?", source, clampInt(q.get("limit"), 1, 100, 20)).toArray()
          : sql.exec("SELECT id, ts, multiplier, color, source, session_id FROM rounds ORDER BY ts_ms DESC LIMIT ?", clampInt(q.get("limit"), 1, 100, 20)).toArray()
      ) as Rows[];
      return ok({ rounds: rows });
    }
    if (path === "/api/v1/sessions" && method === "GET") {
      const source = q.get("source");
      const rows = (
        source && source !== "all"
          ? sql.exec("SELECT * FROM sessions WHERE source = ? ORDER BY started_ms DESC LIMIT 200", source).toArray()
          : sql.exec("SELECT * FROM sessions ORDER BY started_ms DESC LIMIT 200").toArray()
      ) as Rows[];
      return ok({ sessions: rows });
    }
    if (path === "/api/v1/sources" && method === "GET") {
      const rows = sql.exec(
        `SELECT s.*, (SELECT COUNT(*) FROM rounds r WHERE r.source = s.name) AS rounds,
                (SELECT MAX(r.ts) FROM rounds r WHERE r.source = s.name) AS last_round
         FROM sources s ORDER BY s.name`,
      ).toArray();
      return ok({ sources: rows });
    }
    if (path === "/api/v1/sources" && method === "POST") {
      const op = this.requireOperator(request);
      const name = String(body.name ?? "").trim();
      if (!name) return fail("name required");
      sql.exec("INSERT INTO sources (name, label, kind, created_ms) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO NOTHING", name, String(body.label ?? name), String(body.kind ?? "collector"), Date.now());
      this.audit(op.email as string, "sources.create", name);
      return ok({ name });
    }
    if (path.startsWith("/api/v1/sources/") && method === "DELETE") {
      const op = this.requireOperator(request);
      const name = decodeURIComponent(path.split("/").pop() ?? "");
      sql.exec("DELETE FROM rounds WHERE source = ?", name);
      sql.exec("DELETE FROM sessions WHERE source = ?", name);
      sql.exec("DELETE FROM sources WHERE name = ?", name);
      this.invalidateCaches();
      this.audit(op.email as string, "sources.delete", name);
      return ok({ deleted: name });
    }
    if (path === "/api/v1/statistics" && method === "GET") {
      const payload = this.analysisPayload(q.get("source"));
      return ok({ statistics: payload.overview, exceedance: payload.exceedance });
    }

    // ---- ingest
    if (path === "/api/v1/ingest" && method === "POST") {
      const source = String(body.source ?? "aviator").trim() || "aviator";
      const method_ = String(body.method ?? "api");
      const rounds = Array.isArray(body.rounds) ? body.rounds : [];
      if (!rounds.length) return fail("rounds array required");
      const res = this.ingestRounds(source, method_, rounds);
      return ok({ ...res, source });
    }
    if (path === "/api/v1/import" && method === "POST") {
      const op = this.requireOperator(request);
      const entity = String(body.entity ?? "rounds");
      if (entity === "rounds") {
        const rows = Array.isArray(body.rows) ? body.rows : [];
        const bySource = new Map<string, unknown[]>();
        for (const r of rows) {
          const s = String((r as Record<string, unknown>).source ?? "imported");
          (bySource.get(s) ?? bySource.set(s, []).get(s)!).push(r);
        }
        const out: Record<string, { inserted: number; rejected: number }> = {};
        for (const [s, rows2] of bySource) out[s] = this.ingestRounds(s, "import", rows2);
        this.audit(op.email as string, "data.import", "rounds", { sources: [...bySource.keys()] });
        return ok(out);
      }
      if (entity === "vocabulary") {
        const rows = Array.isArray(body.rows) ? body.rows : [];
        let n = 0;
        for (const r of rows as Record<string, unknown>[]) {
          if (typeof r.token !== "string") continue;
          sql.exec(
            `INSERT INTO vocabulary (token, layer, layers, definition, status, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(token) DO NOTHING`,
            r.token, String(r.layer ?? "band"), JSON.stringify(r.layers ?? []), String(r.definition ?? ""), String(r.status ?? "candidate"), Date.now(), Date.now(),
          );
          n++;
        }
        this.audit(op.email as string, "data.import", "vocabulary", { count: n });
        return ok({ imported: n });
      }
      return fail("unsupported entity");
    }
    if (path === "/api/v1/export" && method === "GET") {
      const entity = q.get("entity") ?? "all";
      const limit = clampInt(q.get("limit"), 1, 250000, 50000);
      const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), version: VERSION };
      if (entity === "rounds" || entity === "all") {
        out.rounds = (sql.exec("SELECT id, ts, ts_ms, multiplier, color, source, session_id, ingest FROM rounds ORDER BY ts_ms ASC LIMIT ?", limit).toArray());
        out.roundsTruncated = this.tableStats().count > limit;
      }
      if (entity === "forecasts" || entity === "all") out.forecasts = sql.exec("SELECT * FROM forecasts ORDER BY created_ms DESC LIMIT 5000").toArray();
      if (entity === "vocabulary" || entity === "all") out.vocabulary = sql.exec("SELECT * FROM vocabulary ORDER BY id").toArray();
      if (entity === "autopilot" || entity === "all") out.autopilotDecisions = sql.exec("SELECT * FROM autopilot_decisions ORDER BY created_ms DESC LIMIT 5000").toArray();
      if (entity === "sources" || entity === "all") out.sources = sql.exec("SELECT * FROM sources").toArray();
      if (entity === "settings" || entity === "all") out.settings = Object.fromEntries((sql.exec("SELECT key, value FROM settings").toArray() as Rows[]).map((r) => [r.key, r.value]));
      return ok(out);
    }
    if (path === "/api/v1/rounds" && method === "DELETE") {
      const op = this.requireOperator(request);
      const source = String(body.source ?? q.get("source") ?? "");
      const from = String(body.from ?? q.get("from") ?? "");
      if (!source || !from) return fail("source and from (ISO timestamp) required");
      const fromMs = Date.parse(from);
      if (!Number.isFinite(fromMs)) return fail("invalid from timestamp");
      const res = sql.exec("DELETE FROM rounds WHERE source = ? AND ts_ms >= ?", source, fromMs);
      this.invalidateCaches();
      this.audit(op.email as string, "rounds.delete", source, { from, deleted: res.rowsWritten ?? 0 });
      return ok({ deleted: res.rowsWritten ?? 0, source, from });
    }
    if (path === "/api/v1/sessions/rebuild" && method === "POST") {
      const op = this.requireOperator(request);
      const sources = (sql.exec("SELECT DISTINCT source FROM rounds").toArray() as Rows[]).map((r) => r.source as string);
      for (const s of sources) this.rebuildSessions(s);
      this.invalidateCaches();
      this.audit(op.email as string, "sessions.rebuild", sources.join(","));
      return ok({ rebuilt: sources });
    }

    // ---- analysis
    if (path === "/api/v1/analysis" && method === "GET") return ok(this.analysisPayload(q.get("source")));
    if (path.startsWith("/api/v1/analysis/") && method === "GET") {
      const sub = path.slice("/api/v1/analysis/".length);
      const payload = this.analysisPayload(q.get("source"));
      const map: Record<string, unknown> = {
        ceiling: payload.ceilings, resistance: payload.ceilings, streaks: payload.streaks,
        distribution: { overview: payload.overview, bands: payload.bands },
        moonshot: payload.moonshot, signals: { gaps: payload.gaps, shape: payload.shape, streaks: payload.streaks, pressure: payload.pressure },
        "gap-swing": payload.gaps, "house-edge": payload.houseEdge,
        plugins: this.pluginStatus(payload), ml: { note: "Earned-weight models only; measured baseline governs.", leaderboard: (payload as { rangeLab?: unknown }).rangeLab ?? null },
        dna: dnaSequences(this.roundsFor(q.get("source"))),
      };
      if (sub in map) return ok(map[sub]);
      return fail("unknown analysis subresource", 404);
    }
    if (path === "/api/v1/eta" && method === "GET") {
      const payload = this.analysisPayload(q.get("source"));
      return ok({ exceedance: payload.exceedance, gaps: payload.gaps });
    }
    if (path === "/api/v1/baseline" && method === "GET") {
      const payload = this.analysisPayload(q.get("source"));
      return ok({ overview: payload.overview, exceedance: payload.exceedance });
    }
    if (path === "/api/v1/bands" && method === "GET") {
      const payload = this.analysisPayload(q.get("source"));
      return ok(payload.bands);
    }
    if (path === "/api/v1/brier-score" && method === "GET") return ok(this.forecastAccuracy(q.get("source")));

    // ---- market
    if (path === "/api/v1/market/candles" && method === "GET") {
      const tf = clampInt(q.get("tf"), 10, 86400, 60);
      return ok({ candles: candlesOf(this.roundsFor(q.get("source")), tf, clampInt(q.get("limit"), 10, 500, 150)) });
    }
    if (path === "/api/v1/market/points" && method === "GET") {
      const rows = (this.roundsFor(q.get("source")).slice(-clampInt(q.get("limit"), 10, 1000, 200))).map((r) => ({ t: r.ts, m: r.multiplier, c: r.color }));
      return ok({ points: rows });
    }
    if (path === "/api/v1/market/live" && method === "GET") {
      const rounds = this.roundsFor(q.get("source")).slice(-2);
      const feedEnabled = this.setting("feed_enabled") === "1";
      return ok({ latest: rounds[rounds.length - 1] ?? null, previous: rounds.length > 1 ? rounds[0] : null, feedEnabled, feedIntervalMs: Number(this.setting("feed_interval_ms") ?? 4000) });
    }
    if (path === "/api/v1/market/session-phases" && method === "GET") return ok({ sessions: sessionPhases(this.roundsFor(q.get("source"))) });
    if (path === "/api/v1/market/signals" && method === "GET") {
      const payload = this.analysisPayload(q.get("source"));
      return ok({ shape: payload.shape, gaps: payload.gaps, streaks: payload.streaks, ceilings: payload.ceilings, pressure: payload.pressure });
    }

    // ---- mega pressure
    if (path === "/api/v1/mega-pressure" && method === "GET") return ok(this.analysisPayload(q.get("source")).pressure);

    // ---- linguistics & vocabulary
    if (path === "/api/v1/linguistics" && method === "GET") {
      return ok(linguisticsOf(this.roundsFor(q.get("source")), clampInt(q.get("depth"), 20, 1000, 200)));
    }
    if (path === "/api/v1/linguistics/explain" && method === "GET") {
      const token = q.get("token") ?? "";
      const rows = sql.exec("SELECT * FROM vocabulary WHERE token = ?", token).toArray() as Rows[];
      return ok({ token, layers: token.split("·"), vocabulary: rows[0] ?? null, explanation: "Tokens compose band·chroma·streak·transition layers; each layer is measurable on the live series." });
    }
    if (path === "/api/v1/vocabulary" && method === "GET") {
      const status = q.get("status");
      const rows = (status
        ? sql.exec("SELECT * FROM vocabulary WHERE status = ? ORDER BY updated_ms DESC LIMIT 500", status).toArray()
        : sql.exec("SELECT * FROM vocabulary ORDER BY updated_ms DESC LIMIT 500").toArray()) as Rows[];
      const counts = (status
        ? sql.exec("SELECT status, COUNT(*) AS n FROM vocabulary GROUP BY status").toArray()
        : sql.exec("SELECT status, COUNT(*) AS n FROM vocabulary GROUP BY status").toArray()) as Rows[];
      return ok({ vocabulary: rows.map(parseVocab), counts });
    }
    if (path === "/api/v1/vocabulary" && method === "POST") {
      const op = this.requireOperator(request);
      const token = String(body.token ?? "").trim();
      if (!token) return fail("token required");
      sql.exec(
        `INSERT INTO vocabulary (token, layer, layers, definition, status, created_ms, updated_ms) VALUES (?, ?, ?, ?, 'candidate', ?, ?)
         ON CONFLICT(token) DO UPDATE SET definition = excluded.definition, updated_ms = excluded.updated_ms`,
        token, String(body.layer ?? "band"), JSON.stringify(body.layers ?? []), String(body.definition ?? ""), Date.now(), Date.now(),
      );
      this.audit(op.email as string, "vocabulary.create", token);
      return ok({ token });
    }
    if (path === "/api/v1/vocabulary/discover" && method === "POST") {
      const op = this.userFor(request);
      const rounds = this.roundsFor(String(body.source ?? "") || null);
      const candidates = discoverVocabulary(rounds);
      const now = Date.now();
      let added = 0;
      for (const c of candidates) {
        const res = sql.exec(
          `INSERT INTO vocabulary (token, layer, layers, definition, status, created_ms, updated_ms) VALUES (?, ?, ?, ?, 'candidate', ?, ?)
           ON CONFLICT(token) DO NOTHING`,
          c.token, c.layer, JSON.stringify(c.layers), c.definition, now, now,
        );
        added += res.rowsWritten ?? 0;
      }
      this.audit((op?.email as string) ?? "system", "vocabulary.discover", null, { added });
      return ok({ added, candidates: candidates.length });
    }
    if (path === "/api/v1/vocabulary/discoveries" && method === "GET") {
      const rows = sql.exec("SELECT * FROM vocabulary WHERE status = 'candidate' ORDER BY updated_ms DESC LIMIT 100").toArray();
      return ok({ discoveries: rows.map(parseVocab) });
    }
    if (path === "/api/v1/vocabulary/learning/status" && method === "GET") {
      const rows = sql.exec("SELECT status, COUNT(*) AS n FROM vocabulary GROUP BY status").toArray() as Rows[];
      const total = (sql.exec("SELECT COUNT(*) AS n FROM vocabulary").toArray()[0] as { n: number }).n;
      return ok({ total, byStatus: rows });
    }
    if (path === "/api/v1/vocabulary/learning/progress" && method === "GET") {
      const rows = sql.exec("SELECT * FROM vocabulary WHERE status != 'deprecated' ORDER BY score DESC LIMIT 50").toArray();
      return ok({ progress: rows.map(parseVocab) });
    }
    if (path.startsWith("/api/v1/vocabulary/") && (method === "PUT" || method === "POST" || method === "DELETE")) {
      const op = this.requireOperator(request);
      const seg = path.split("/").filter(Boolean);
      const id = Number(seg[3]);
      const action = seg[4];
      const rows = sql.exec("SELECT * FROM vocabulary WHERE id = ?", id).toArray() as Rows[];
      if (!rows.length) return fail("vocabulary not found", 404);
      if (method === "DELETE" || action === "deprecate") {
        sql.exec("UPDATE vocabulary SET status = 'deprecated', updated_ms = ? WHERE id = ?", Date.now(), id);
      } else if (action === "formalize") {
        sql.exec("UPDATE vocabulary SET status = 'formalized', updated_ms = ? WHERE id = ?", Date.now(), id);
      } else if (action === "evaluate") {
        const hits = Number(body.hits ?? rows[0].hits ?? 0);
        const misses = Number(body.misses ?? rows[0].misses ?? 0);
        const uses = Number(body.uses ?? rows[0].uses ?? 0);
        const score = hits + misses > 0 ? hits / (hits + misses) : 0.5;
        sql.exec("UPDATE vocabulary SET hits = ?, misses = ?, uses = ?, score = ?, status = CASE WHEN ? >= 0.6 THEN 'validated' ELSE status END, updated_ms = ? WHERE id = ?", hits, misses, uses, score, score, Date.now(), id);
      } else if (method === "PUT") {
        sql.exec("UPDATE vocabulary SET token = COALESCE(?, token), definition = COALESCE(?, definition), layer = COALESCE(?, layer), updated_ms = ? WHERE id = ?", (body.token as string) ?? null, (body.definition as string) ?? null, (body.layer as string) ?? null, Date.now(), id);
      }
      this.audit(op.email as string, `vocabulary.${method.toLowerCase()}${action ? "." + action : ""}`, String(id));
      return ok({ id });
    }

    // ---- forecasts
    if (path === "/api/v1/forecasts" && method === "GET") {
      const status = q.get("status");
      const source = q.get("source");
      let query = "SELECT * FROM forecasts";
      const conds: string[] = [], params: unknown[] = [];
      if (status === "open") conds.push("actual IS NULL");
      if (status === "resolved") conds.push("actual IS NOT NULL");
      if (source && source !== "all") { conds.push("source = ?"); params.push(source); }
      if (conds.length) query += " WHERE " + conds.join(" AND ");
      query += " ORDER BY created_ms DESC LIMIT ?";
      params.push(clampInt(q.get("limit"), 1, 500, 100));
      return ok({ forecasts: sql.exec(query, ...params).toArray() });
    }
    if (path === "/api/v1/forecasts/record" && method === "POST") {
      const user = this.userFor(request);
      const threshold = Number(body.threshold);
      const probability = Number(body.probability);
      if (!Number.isFinite(threshold) || !Number.isFinite(probability) || probability < 0 || probability > 1) return fail("threshold and probability∈[0,1] required");
      const source = String(body.source ?? "aviator");
      sql.exec(
        "INSERT INTO forecasts (source, model, threshold, probability, note, created_ms) VALUES (?, ?, ?, ?, ?, ?)",
        source, String(body.model ?? "manual"), threshold, probability, String(body.note ?? ""), Date.now(),
      );
      this.audit((user?.email as string) ?? "system", "forecasts.record", `${source}@${threshold}x`);
      return ok({ recorded: true });
    }
    if (path === "/api/v1/forecasts/resolve" && method === "POST") return ok({ resolved: this.resolveForecasts() });
    if (path === "/api/v1/forecasts/accuracy" && method === "GET") return ok(this.forecastAccuracy(q.get("source")));
    if (path === "/api/v1/forecasts/history" && method === "GET") {
      return ok({ history: sql.exec("SELECT * FROM forecasts WHERE actual IS NOT NULL ORDER BY resolved_ms DESC LIMIT 200").toArray() });
    }
    if (path === "/api/v1/forecasts/transitions" && method === "GET") {
      const payload = this.analysisPayload(q.get("source"));
      return ok(payload.bands);
    }

    // ---- orchestrator
    if (path === "/api/v1/orchestrator" && method === "GET") {
      const payload = this.analysisPayload(null);
      const settingsVals = {
        patience: Number(this.setting("orchestrator_patience") ?? 3),
        speed: this.setting("orchestrator_speed") ?? "balanced",
        risk: this.setting("orchestrator_risk") ?? "moderate",
        minConfidence: Number(this.setting("orchestrator_min_confidence") ?? 0.55),
      };
      return ok({
        settings: settingsVals,
        state: {
          streak: payload.streaks.current,
          streakKind: payload.streaks.currentKind,
          dryZone: payload.shape.dryZone.active,
          tailPressure: payload.pressure.overallPressure,
          lastRound: this.roundsFor(null, false).slice(-1)[0] ?? null,
        },
        guidance: orchestratorGuidance(payload, settingsVals),
      });
    }
    if (path === "/api/v1/orchestrator/settings" && (method === "PUT" || method === "POST")) {
      const op = this.requireOperator(request);
      if (body.patience !== undefined) this.setSetting("orchestrator_patience", String(Number(body.patience)));
      if (body.speed !== undefined) this.setSetting("orchestrator_speed", String(body.speed));
      if (body.risk !== undefined) this.setSetting("orchestrator_risk", String(body.risk));
      if (body.minConfidence !== undefined) this.setSetting("orchestrator_min_confidence", String(Number(body.minConfidence)));
      this.audit(op.email as string, "orchestrator.settings", null, body);
      return ok({ settings: { patience: this.setting("orchestrator_patience"), speed: this.setting("orchestrator_speed"), risk: this.setting("orchestrator_risk"), minConfidence: this.setting("orchestrator_min_confidence") } });
    }
    if (path === "/api/v1/orchestrator/evaluate" && method === "POST") {
      const payload = this.analysisPayload(null);
      const settingsVals = {
        patience: Number(this.setting("orchestrator_patience") ?? 3),
        speed: this.setting("orchestrator_speed") ?? "balanced",
        risk: this.setting("orchestrator_risk") ?? "moderate",
        minConfidence: Number(this.setting("orchestrator_min_confidence") ?? 0.55),
      };
      const guidance = orchestratorGuidance(payload, settingsVals);
      sql.exec("INSERT INTO orchestrator_log (source, kind, detail, created_ms) VALUES ('all', 'evaluate', ?, ?)", JSON.stringify(guidance), Date.now());
      return ok({ guidance, evaluatedAt: new Date().toISOString() });
    }

    // ---- autopilot
    if (path === "/api/v1/autopilot/decisions" && method === "GET") {
      const source = q.get("source");
      const rows = (source && source !== "all"
        ? sql.exec("SELECT * FROM autopilot_decisions WHERE source = ? ORDER BY created_ms DESC LIMIT ?", source, clampInt(q.get("limit"), 1, 500, 100)).toArray()
        : sql.exec("SELECT * FROM autopilot_decisions ORDER BY created_ms DESC LIMIT ?", clampInt(q.get("limit"), 1, 500, 100)).toArray()) as Rows[];
      const closed = rows.filter((r) => r.resolved === 1);
      const pnl = closed.reduce((a, r) => a + ((r.pnl as number) ?? 0), 0);
      return ok({ decisions: rows, pnl: +pnl.toFixed(2), wins: closed.filter((r) => (r.pnl as number) > 0).length, resolved: closed.length });
    }
    if (path === "/api/v1/autopilot/config" && method === "GET") {
      return ok({ config: { running: this.setting("autopilot_running") === "1", stake: Number(this.setting("autopilot_stake") ?? 1), threshold: Number(this.setting("autopilot_threshold") ?? 2) } });
    }
    if (path === "/api/v1/autopilot/config" && method === "PUT") {
      const op = this.requireOperator(request);
      if (body.stake !== undefined) this.setSetting("autopilot_stake", String(Number(body.stake)));
      if (body.threshold !== undefined) this.setSetting("autopilot_threshold", String(Number(body.threshold)));
      this.audit(op.email as string, "autopilot.config", null, body);
      return ok({ config: { stake: this.setting("autopilot_stake"), threshold: this.setting("autopilot_threshold") } });
    }
    if (path === "/api/v1/autopilot/status" && method === "GET") {
      const running = this.setting("autopilot_running") === "1";
      return ok({ running, feedEnabled: this.setting("feed_enabled") === "1", stake: Number(this.setting("autopilot_stake") ?? 1), threshold: Number(this.setting("autopilot_threshold") ?? 2) });
    }
    if (path === "/api/v1/autopilot/start" && method === "POST") {
      const op = this.requireOperator(request);
      this.setSetting("autopilot_running", "1");
      this.audit(op.email as string, "autopilot.start");
      return ok({ running: true });
    }
    if (path === "/api/v1/autopilot/stop" && method === "POST") {
      const op = this.requireOperator(request);
      this.setSetting("autopilot_running", "0");
      this.audit(op.email as string, "autopilot.stop");
      return ok({ running: false });
    }
    if (path === "/api/v1/autopilot/reset" && method === "POST") {
      const op = this.requireOperator(request);
      sql.exec("DELETE FROM autopilot_decisions");
      this.audit(op.email as string, "autopilot.reset");
      return ok({ reset: true });
    }
    if (path === "/api/v1/autopilot/evaluate" && method === "POST") {
      const rounds = this.roundsFor(null, false);
      const latest = rounds[rounds.length - 1];
      if (!latest) return fail("no rounds yet");
      const payload = this.analysisPayload(null);
      const settingsVals = {
        patience: Number(this.setting("orchestrator_patience") ?? 3),
        speed: this.setting("orchestrator_speed") ?? "balanced",
        risk: this.setting("orchestrator_risk") ?? "moderate",
        minConfidence: Number(this.setting("orchestrator_min_confidence") ?? 0.55),
      };
      const guidance = orchestratorGuidance(payload, settingsVals);
      const stake = Number(this.setting("autopilot_stake") ?? 1);
      const threshold = Number(this.setting("autopilot_threshold") ?? 2);
      const decision = guidance.action === "skip" ? "skip" : "enter";
      const pnl = decision === "enter" ? (latest.multiplier >= threshold ? stake * (threshold - 1) : -stake) : 0;
      sql.exec(
        "INSERT INTO autopilot_decisions (source, round_id, decision, threshold, confidence, reason, stake, pnl, resolved, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
        latest.source, latest.id, decision, threshold, guidance.confidence, guidance.reason, decision === "enter" ? stake : 0, pnl, Date.now(),
      );
      // resolve any open forecasts against this round
      const open = sql.exec("SELECT id, threshold, probability FROM forecasts WHERE actual IS NULL").toArray() as Rows[];
      for (const f of open) {
        const actual = latest.multiplier >= (f.threshold as number) ? 1 : 0;
        const brier = ((f.probability as number) - actual) ** 2;
        sql.exec("UPDATE forecasts SET actual = ?, brier = ?, resolved_ms = ?, resolved_round_id = ? WHERE id = ?", actual, brier, Date.now(), latest.id, f.id);
      }
      return ok({ decision, pnl, round: latest });
    }

    // ---- inventory (plugins)
    if (path === "/api/v1/inventory" && method === "GET") {
      return ok({ plugins: sql.exec("SELECT * FROM plugins ORDER BY category, key").toArray() });
    }
    if (path === "/api/v1/inventory" && method === "POST") {
      const op = this.requireOperator(request);
      const key = String(body.key ?? "").trim();
      if (!key) return fail("key required");
      sql.exec("INSERT INTO plugins (key, name, category, description, created_ms) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO NOTHING", key, String(body.name ?? key), String(body.category ?? "analyzer"), String(body.description ?? ""), Date.now());
      this.audit(op.email as string, "inventory.create", key);
      return ok({ key });
    }
    if (path.startsWith("/api/v1/inventory/")) {
      const seg = path.split("/").filter(Boolean);
      const id = Number(seg[3]);
      const action = seg[4];
      const rows = sql.exec("SELECT * FROM plugins WHERE id = ?", id).toArray() as Rows[];
      if (!rows.length) return fail("plugin not found", 404);
      if (method === "DELETE") {
        const op = this.requireOperator(request);
        sql.exec("DELETE FROM plugins WHERE id = ?", id);
        this.audit(op.email as string, "inventory.delete", String(id));
        return ok({ deleted: id });
      }
      if (method === "GET") {
        const runs = sql.exec("SELECT * FROM plugin_runs WHERE plugin_id = ? ORDER BY created_ms DESC LIMIT 20", id).toArray();
        return ok({ plugin: rows[0], runs });
      }
      const op = this.requireOperator(request);
      if (action === "enabled") {
        sql.exec("UPDATE plugins SET enabled = ? WHERE id = ?", body.enabled ? 1 : 0, id);
      } else if (action === "config") {
        sql.exec("UPDATE plugins SET config = ?, weight = ? WHERE id = ?", JSON.stringify(body.config ?? {}), Number(body.weight ?? rows[0].weight ?? 1), id);
      }
      this.audit(op.email as string, `inventory.${action ?? "update"}`, String(id));
      return ok({ id });
    }

    // ---- backtest & range lab & calibration
    if (path === "/api/v1/backtest/runs" && method === "GET") {
      return ok({ runs: sql.exec("SELECT id, source, kind, params, created_ms FROM backtest_runs ORDER BY created_ms DESC LIMIT 100").toArray() });
    }
    if (path === "/api/v1/backtest/status" && method === "GET") {
      const n = (sql.exec("SELECT COUNT(*) AS n FROM backtest_runs").toArray()[0] as { n: number }).n;
      return ok({ runs: n, engine: "walk-forward, train-half fit / test-half score, Brier vs baseline" });
    }
    if (path === "/api/v1/backtest/run" && method === "POST") {
      const op = this.userFor(request);
      const kind = String(body.kind ?? "threshold-ensemble");
      const source = String(body.source ?? "all");
      const rounds = this.roundsFor(source === "all" ? null : source);
      if (rounds.length < 600) return fail("need at least 600 rounds to backtest");
      const result = walkForward(rounds, THRESHOLDS, 300);
      sql.exec("INSERT INTO backtest_runs (source, kind, params, result, created_ms) VALUES (?, ?, ?, ?, ?)", source, kind, JSON.stringify({ thresholds: THRESHOLDS, warmup: 300 }), JSON.stringify(result), Date.now());
      this.audit((op?.email as string) ?? "system", "backtest.run", kind, { rounds: rounds.length });
      const idRow = sql.exec("SELECT id FROM backtest_runs ORDER BY id DESC LIMIT 1").toArray()[0] as { id: number };
      return ok({ runId: idRow.id, result });
    }
    if (path.startsWith("/api/v1/backtest/run/") && method === "GET") {
      const id = Number(path.split("/").pop());
      const rows = sql.exec("SELECT * FROM backtest_runs WHERE id = ?", id).toArray() as Rows[];
      if (!rows.length) return fail("run not found", 404);
      return ok({ run: rows[0], result: JSON.parse(rows[0].result as string) });
    }
    if (path.startsWith("/api/v1/backtest/run/") && method === "DELETE") {
      const op = this.requireOperator(request);
      const id = Number(path.split("/").pop());
      sql.exec("DELETE FROM backtest_runs WHERE id = ?", id);
      this.audit(op.email as string, "backtest.delete", String(id));
      return ok({ deleted: id });
    }
    if (path === "/api/v1/range-lab" && method === "GET") {
      const source = q.get("source") ?? "all";
      const rounds = this.roundsFor(source === "all" ? null : source);
      const live = rounds.length >= 600 ? walkForward(rounds, THRESHOLDS, 300) : null;
      return ok({
        dataset: { rounds: rounds.length, source },
        reference: RANGE_LAB_REFERENCE,
        live,
        liveThresholds: [2, 5, 10, 50, 100],
      });
    }
    if (path === "/api/v1/calibration" && method === "GET") {
      const rounds = this.roundsFor(null);
      const n = rounds.length;
      const mults = rounds.map((r) => r.multiplier);
      const exc = exceedanceOf(rounds, [1.5, 2, 3, 5, 10, 25, 50, 100, 250, 500, 1000]);
      const fit = pressureOf(rounds).powerLaw;
      const postHigh = rounds.filter((r, i) => i > 0 && rounds[i - 1].multiplier >= 10);
      const postHighRate = postHigh.length ? postHigh.filter((r) => r.multiplier >= 2).length / postHigh.length : null;
      const ref = CALIBRATION_REFERENCE;
      const refEntries = Object.entries(ref.exceedance) as [string, number][];
      const checks = refEntries.map(([t, refPct]) => {
        const row = exc.find((e) => e.threshold === Number(t));
        const livePct = row ? row.rate * 100 : null;
        return { threshold: Number(t), referencePct: refPct, livePct: livePct !== null ? +livePct.toFixed(4) : null, deltaPct: livePct !== null ? +((livePct - refPct) / refPct * 100).toFixed(3) : null, match: livePct !== null && Math.abs(livePct - refPct) / refPct < 0.01 };
      });
      return ok({
        dataset: { rounds: n, mean: +(mults.reduce((a, b) => a + b, 0) / Math.max(1, n)).toFixed(3), median: rounds.length ? medianOf(mults) : 0, max: rounds.length ? maxOf(mults) : 0 },
        reference: ref,
        exceedance: exc,
        tail: fit,
        postHigh: { rate: postHighRate, reference: ref.postHigh2x / 100, n: postHigh.length },
        checks,
        allMatch: checks.every((c) => c.match),
      });
    }

    // ---- top rounds
    if (path === "/api/v1/top-rounds" && method === "GET") {
      const scope = q.get("scope") ?? "all";
      const source = q.get("source") ?? "all";
      let rows: Rows[];
      if (scope === "all") {
        rows = (source !== "all"
          ? sql.exec("SELECT id, ts, multiplier, color, source FROM rounds WHERE source = ? ORDER BY multiplier DESC LIMIT 25", source).toArray()
          : sql.exec("SELECT id, ts, multiplier, color, source FROM rounds ORDER BY multiplier DESC LIMIT 25").toArray()) as Rows[];
      } else if (scope === "day") {
        rows = sql.exec(
          `WITH ranked AS (SELECT id, ts, multiplier, color, source, substr(ts, 1, 10) AS day, ROW_NUMBER() OVER (PARTITION BY substr(ts, 1, 10) ORDER BY multiplier DESC) AS rn FROM rounds${source !== "all" ? " WHERE source = ?" : ""})
           SELECT id, ts, multiplier, color, source, day FROM ranked WHERE rn = 1 ORDER BY day DESC LIMIT 60`,
          ...(source !== "all" ? [source] : []),
        ).toArray() as Rows[];
      } else {
        rows = sql.exec(
          `WITH ranked AS (SELECT id, ts, multiplier, color, source, session_id, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY multiplier DESC) AS rn FROM rounds WHERE session_id IS NOT NULL${source !== "all" ? " AND source = ?" : ""})
           SELECT id, ts, multiplier, color, source, session_id FROM ranked WHERE rn = 1 ORDER BY ts DESC LIMIT 60`,
          ...(source !== "all" ? [source] : []),
        ).toArray() as Rows[];
      }
      return ok({ scope, top: rows });
    }
    if (path === "/api/v1/top-rounds/ingest" && method === "POST") {
      const op = this.requireOperator(request);
      sql.exec("DELETE FROM top_rounds");
      const rows = sql.exec("SELECT id, ts, multiplier, color, source FROM rounds ORDER BY multiplier DESC LIMIT 100").toArray() as Rows[];
      for (const r of rows) {
        sql.exec("INSERT INTO top_rounds (source, scope, scope_key, round_id, ts, multiplier, color) VALUES (?, 'all', 'all', ?, ?, ?, ?)", r.source, r.id, r.ts, r.multiplier, r.color);
      }
      this.audit(op.email as string, "top_rounds.rebuild", null, { count: rows.length });
      return ok({ count: rows.length });
    }

    // ---- feed engine (disabled — no synthetic data)
    if (path === "/api/v1/feed/status" && method === "GET") {
      return ok({ enabled: false, cursor: 0, rounds: 0, intervalMs: 0 });
    }
    if (path === "/api/v1/feed/start" && method === "POST") {
      return fail("feed engine disabled", 410);
    }
    if (path === "/api/v1/feed/stop" && method === "POST") {
      return ok({ enabled: false });
    }
    if (path === "/api/v1/feed/step" && method === "POST") {
      return fail("feed engine disabled", 410);
    }
    if (path === "/api/v1/feed/verify" && method === "GET") {
      return fail("feed engine disabled", 410);
    }

    // ---- settings / users / audit
    if (path === "/api/v1/settings" && method === "GET") {
      return ok({ settings: Object.fromEntries((sql.exec("SELECT key, value FROM settings").toArray() as Rows[]).map((r) => [r.key as string, r.value])) });
    }
    if (path === "/api/v1/settings" && (method === "PUT" || method === "POST")) {
      const op = this.requireOperator(request);
      const values = (body.values as Record<string, string>) ?? Object.fromEntries(Object.entries(body).filter(([k]) => k !== "values"));
      for (const [k, v] of Object.entries(values)) this.setSetting(k, String(v));
      this.audit(op.email as string, "settings.update", null, values);
      return ok({ settings: Object.fromEntries((sql.exec("SELECT key, value FROM settings").toArray() as Rows[]).map((r) => [r.key as string, r.value])) });
    }
    if (path === "/api/v1/users" && method === "GET") {
      this.requireOperator(request);
      return ok({ users: sql.exec("SELECT id, email, name, role, created_ms, disabled FROM users ORDER BY id").toArray() });
    }
    if (path === "/api/v1/users" && method === "POST") {
      const op = this.requireOperator(request);
      const email = String(body.email ?? "").toLowerCase().trim();
      const password = String(body.password ?? "");
      if (!email.includes("@") || password.length < 4) return fail("valid email and 4+ char password required");
      const salt = crypto.randomUUID().replace(/-/g, "");
      const hash = await this.hashPassword(password, salt);
      try {
        sql.exec("INSERT INTO users (email, name, role, password_hash, salt, created_ms) VALUES (?, ?, ?, ?, ?, ?)", email, String(body.name ?? email.split("@")[0]), String(body.role ?? "client"), hash, salt, Date.now());
      } catch {
        return fail("email already registered", 409);
      }
      this.audit(op.email as string, "users.create", email);
      return ok({ email });
    }
    if (path.startsWith("/api/v1/users/") && method === "DELETE") {
      const op = this.requireOperator(request);
      const id = Number(path.split("/").pop());
      if (id === (op.id as number)) return fail("cannot delete yourself");
      sql.exec("UPDATE users SET disabled = 1 WHERE id = ?", id);
      this.audit(op.email as string, "users.disable", String(id));
      return ok({ disabled: id });
    }
    if (path === "/api/v1/audit" && method === "GET") {
      this.requireOperator(request);
      return ok({ log: sql.exec("SELECT * FROM audit_log ORDER BY created_ms DESC LIMIT ?", clampInt(q.get("limit"), 1, 500, 100)).toArray() });
    }

    // ---- platform: docs / build steps / releases / downloads
    if (path === "/api/v1/platform/docs" && method === "GET") return ok({ docs: DOCS, version: VERSION });
    if (path.startsWith("/api/v1/platform/doc/") && method === "GET") {
      const slug = path.slice("/api/v1/platform/doc/".length);
      const meta = DOCS.find((d) => d.slug === slug);
      if (!meta) return fail("doc not found", 404);
      return ok({ doc: meta, appPath: `/dashboard/docs/${slug}` });
    }
    if (path === "/api/v1/platform/build-steps" && method === "GET") {
      return ok({ steps: sql.exec("SELECT * FROM build_steps ORDER BY step").toArray() });
    }
    if (path === "/api/v1/platform/build-steps/sync" && method === "POST") {
      const op = this.requireOperator(request);
      const now = Date.now();
      for (const s of BUILD_STEPS) sql.exec("INSERT OR REPLACE INTO build_steps (step, title, status, updated_ms) VALUES (?, ?, 'done', ?)", s.step, s.title, now);
      this.audit(op.email as string, "platform.build_steps.sync");
      return ok({ steps: BUILD_STEPS.length });
    }
    if (path === "/api/v1/platform/overview" && method === "GET") {
      const stats = this.tableStats();
      return ok({
        name: "Momento", suite: "Momento Platform", version: VERSION,
        pipeline: "Collector → Ingest API → Analysis → Forecast Engine → Database → Dashboard",
        subProjects: 8, screens: 34, rounds: stats.count,
        docs: DOCS.length,
      });
    }
    if (path.startsWith("/api/v1/platform/download/") && method === "GET") {
      const filename = decodeURIComponent(path.slice("/api/v1/platform/download/".length));
      const rows = sql.exec("SELECT * FROM releases WHERE filename = ? ORDER BY created_ms DESC LIMIT 1", filename).toArray() as Rows[];
      if (!rows.length) return fail("release not found", 404);
      return ok({ release: rows[0], note: "Bundle is served from the web origin under /downloads/" });
    }
    if (path === "/api/v1/releases" && method === "GET") {
      return ok({ releases: sql.exec("SELECT id, version, filename, url, sha256, notes, created_ms FROM releases ORDER BY created_ms DESC").toArray() });
    }
    if (path === "/api/v1/releases/latest" && method === "GET") {
      const rows = sql.exec("SELECT * FROM releases ORDER BY created_ms DESC LIMIT 1").toArray() as Rows[];
      return ok({ release: rows[0] ?? null });
    }
    if (path === "/api/v1/releases" && method === "POST") {
      const op = this.requireOperator(request);
      const version = String(body.version ?? VERSION);
      const filename = String(body.filename ?? "");
      if (!filename) return fail("filename required");
      sql.exec("INSERT INTO releases (version, filename, url, sha256, notes, manifest, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?)", version, filename, String(body.url ?? `/downloads/${filename}`), String(body.sha256 ?? ""), String(body.notes ?? ""), body.manifest ? JSON.stringify(body.manifest) : null, Date.now());
      this.audit(op.email as string, "releases.create", version);
      return ok({ version, filename });
    }

    // ---- FX analysis lab (v6)
    if (path === "/api/v1/fx" && method === "GET") return ok(this.fxPayload(q.get("source")));
    if (path === "/api/v1/fx/signals" && method === "GET") {
      const p = this.fxPayload(q.get("source"));
      return ok({ signals: p.signals, generatedAt: p.generatedAt, rounds: p.rounds });
    }
    if (path.startsWith("/api/v1/fx/") && method === "GET") {
      const sub = path.slice("/api/v1/fx/".length);
      const p = this.fxPayload(q.get("source"));
      if (sub in p) return ok({ [sub]: p[sub] });
      return fail("unknown fx subresource", 404);
    }

    // ---- prediction pipeline (v6, + inverted lens v6.2)
    if (path === "/api/v1/pipeline/forecast" && method === "GET") {
      const source = q.get("source");
      const rounds = this.roundsFor(source);
      const base = pipelineForecast(rounds, source ?? "all", this.weightsMap());
      return ok({ ...base, inverted: invertedForecast(rounds, this.weightsMap()) });
    }
    // v6.3: the next-round hero is the full-intelligence forecast (V5.01-backtd
    // blend + every v6 engine, earned mixture weights). The v6.2 band model
    // stays available at /next-round/band for comparison.
    if ((path === "/api/v1/pipeline/next-round" || path === "/api/v1/intelligence/forecast") && method === "GET") {
      const source = q.get("source");
      const rounds = this.roundsFor(source);
      if (rounds.length < 8) return fail("need at least 8 rounds for a forecast", 409);
      return ok(this.intelForecast(rounds, source ?? "all"));
    }
    if (path === "/api/v1/pipeline/next-round/band" && method === "GET") {
      const source = q.get("source");
      const rounds = this.roundsFor(source);
      const corr = this.bandCorrection();
      return ok(nextRoundForecast(rounds, source ?? "all", this.weightsMap(), corr.value || undefined, corr.sampleSize));
    }
    if (path === "/api/v1/intelligence/calibrations" && method === "GET") {
      const rows = (sql
        .exec("SELECT * FROM intel_calibrations ORDER BY created_ms DESC LIMIT ?", clampInt(q.get("limit") ?? "50", 1, 500, 50))
        .toArray() as Rows[]).map((r) => ({
          ...r,
          dist: r.dist ? JSON.parse(r.dist as string) : null,
          weights: r.weights ? JSON.parse(r.weights as string) : null,
          comp_loss: r.comp_loss ? JSON.parse(r.comp_loss as string) : null,
        }));
      const all = sql.exec("SELECT verdict, COUNT(*) AS n FROM intel_calibrations GROUP BY verdict").toArray() as Rows[];
      const ledger = this.intelLedger();
      const corr = this.intelCorrection();
      return ok({
        rows,
        verdicts: Object.fromEntries(all.map((r) => [r.verdict as string, r.n as number])),
        ledger,
        correction: corr.value,
        correctionSample: corr.sampleSize,
        components: INTEL_COMPONENTS,
      });
    }
    if (path === "/api/v1/intelligence/recalibrate" && method === "POST") {
      this.requireOperator(request);
      sql.exec("DELETE FROM intel_calibrations");
      this.intelLedgerCache = null;
      const scored = this.calibrateIntel(this.roundsFor(null));
      return ok({ scored });
    }
    if (path === "/api/v1/pipeline/calibrations" && method === "GET") {
      const rows = (this.ctx.storage.sql
        .exec("SELECT * FROM round_calibrations WHERE id <> -1 ORDER BY created_ms DESC LIMIT ?", clampInt(q.get("limit") ?? "50", 1, 200, 50))
        .toArray() as Rows[]).map((r) => ({ ...r, dist: r.dist ? JSON.parse(r.dist as string) : null }));
      const state = (this.ctx.storage.sql
        .exec("SELECT correction, reason FROM round_calibrations WHERE id = -1")
        .toArray()[0] as { correction: number | null; reason: string | null } | undefined) ?? {};
      const verdicts = new Map<string, number>();
      for (const r of rows) verdicts.set(r.verdict as string, (verdicts.get(r.verdict as string) ?? 0) + 1);
      return ok({
        rows,
        verdicts: Object.fromEntries(verdicts),
        correction: state.correction ?? 0,
        correctionNote: state.reason ?? "not yet computed",
        backtestDone: this.setting("calibration_backtest_done") === "1",
      });
    }

    // ---- momentum & structure lab (v6.2)
    if (path === "/api/v1/momentum/overview" && method === "GET") {
      return ok(this.momentumPayload(q.get("source"), clampInt(q.get("bucketMs"), 60_000, 3_600_000, 300_000)));
    }
    if (path === "/api/v1/momentum/hitpoints" && method === "GET") {
      const p = this.momentumPayload(q.get("source"), clampInt(q.get("bucketMs"), 60_000, 3_600_000, 300_000));
      return ok({ bucketMs: p.bucketMs, rounds: p.rounds, points: p.hitPoints });
    }
    if (path === "/api/v1/momentum/anchors" && method === "GET") {
      return ok({ anchors: this.momentumPayload(q.get("source"), 300_000).anchors });
    }
    if (path === "/api/v1/momentum/assessment" && method === "GET") {
      const rounds = this.roundsFor(q.get("source"));
      const open = sql
        .exec("SELECT id, window, threshold, probability, created_ms, due_ms FROM scheduled_predictions WHERE resolved_ms IS NULL ORDER BY due_ms ASC LIMIT 200")
        .toArray() as Rows[];
      return ok(
        assessLive(
          rounds,
          open.map((r) => ({
            id: r.id as number,
            window: String(r.window),
            threshold: Number(r.threshold),
            p: Number(r.probability),
            createdMs: Number(r.created_ms),
            dueMs: Number(r.due_ms),
          })),
        ),
      );
    }

    // ---- accuracy engine v2 (v6)
    if (path === "/api/v1/accuracy/overview" && method === "GET") {
      const cfg = this.accuracyConfig();
      const totalsRow = sql.exec(
        "SELECT COUNT(*) AS scheduled, SUM(CASE WHEN resolved_ms IS NULL THEN 1 ELSE 0 END) AS open, SUM(CASE WHEN resolved_ms IS NOT NULL THEN 1 ELSE 0 END) AS resolved FROM scheduled_predictions",
      ).toArray()[0] as Rows;
      const accRow = sql.exec(
        "SELECT SUM(n) AS n, SUM(brier_sum) AS b, SUM(base_sum) AS s, SUM(hits) AS h FROM accuracy_ledger WHERE model = 'pipeline'",
      ).toArray()[0] as Rows;
      const ledger = sql.exec("SELECT * FROM accuracy_ledger ORDER BY model, window, threshold").toArray() as Rows[];
      const weights = sql.exec("SELECT * FROM engine_weights ORDER BY weight DESC, model").toArray();
      const perWindow = sql
        .exec("SELECT window, threshold, SUM(n) AS n, SUM(brier_sum) AS b, SUM(base_sum) AS s, SUM(hits) AS h FROM accuracy_ledger WHERE model = 'pipeline' GROUP BY window, threshold")
        .toArray() as Rows[];
      const history = sql.exec("SELECT * FROM accuracy_history ORDER BY ts ASC LIMIT 4000").toArray();
      const openPreds = sql.exec("SELECT * FROM scheduled_predictions WHERE resolved_ms IS NULL ORDER BY due_ms ASC LIMIT 60").toArray();
      const recentPreds = sql.exec("SELECT * FROM scheduled_predictions WHERE resolved_ms IS NOT NULL ORDER BY resolved_ms DESC LIMIT 60").toArray();
      const n = (accRow.n as number) || 0;
      const brier = n ? (accRow.b as number) / n : null;
      const base = n ? (accRow.s as number) / n : null;
      return ok({
        config: cfg,
        cadenceMs: this.cadenceMs(),
        lastTickMs: Number(this.setting("accuracy_last_tick") ?? 0),
        totals: {
          scheduled: totalsRow.scheduled ?? 0,
          open: totalsRow.open ?? 0,
          resolved: totalsRow.resolved ?? 0,
          ledgerN: n,
          brier: brier !== null ? +brier.toFixed(5) : null,
          base: base !== null ? +base.toFixed(5) : null,
          liftPct: brier !== null && base ? +(((brier - base) / base) * 100).toFixed(2) : null,
          hitRate: n ? +(((accRow.h as number) || 0) / n).toFixed(4) : null,
        },
        ledger: ledger.map((r) => ({
          ...r,
          brier: r.n ? +((r.brier_sum as number) / (r.n as number)).toFixed(5) : null,
          base: r.n ? +((r.base_sum as number) / (r.n as number)).toFixed(5) : null,
          hitRate: r.n ? +((r.hits as number) / (r.n as number)).toFixed(4) : null,
        })),
        perWindow: perWindow.map((r) => ({
          ...r,
          brier: r.n ? +((r.b as number) / (r.n as number)).toFixed(5) : null,
          base: r.n ? +((r.s as number) / (r.n as number)).toFixed(5) : null,
          hitRate: r.n ? +((r.h as number) / (r.n as number)).toFixed(4) : null,
        })),
        weights,
        history,
        open: openPreds,
        recent: recentPreds,
      });
    }
    if (path === "/api/v1/accuracy/tick" && method === "POST") return ok(await this.accuracyTick());
    if (path === "/api/v1/accuracy/config" && method === "GET") return ok({ config: this.accuracyConfig() });
    if (path === "/api/v1/accuracy/config" && (method === "PUT" || method === "POST")) {
      const op = this.requireOperator(request);
      if (body.enabled !== undefined) this.setSetting("accuracy_enabled", body.enabled ? "1" : "0");
      if (Array.isArray(body.windows)) this.setSetting("accuracy_windows", body.windows.join(","));
      if (Array.isArray(body.thresholds)) this.setSetting("accuracy_thresholds", body.thresholds.join(","));
      this.audit(op.email as string, "accuracy.config", null, body);
      return ok({ config: this.accuracyConfig() });
    }
    if (path === "/api/v1/accuracy/predictions" && method === "GET") {
      const status = q.get("status") ?? "all";
      const window = q.get("window");
      const conds: string[] = [];
      const params: unknown[] = [];
      if (status === "open") conds.push("resolved_ms IS NULL");
      if (status === "resolved") conds.push("resolved_ms IS NOT NULL");
      if (window && window !== "all") { conds.push("window = ?"); params.push(window); }
      const where = conds.length ? ` WHERE ${conds.join(" AND ")}` : "";
      const rows = sql.exec(`SELECT * FROM scheduled_predictions${where} ORDER BY created_ms DESC LIMIT ?`, ...params, clampInt(q.get("limit"), 1, 500, 120)).toArray();
      return ok({ predictions: rows });
    }
    if (path === "/api/v1/accuracy/verify" && method === "POST") {
      const op = this.userFor(request);
      const source = String(body.source ?? "all");
      const rounds = this.roundsFor(source === "all" ? null : source);
      if (rounds.length < 500) return fail("need at least 500 rounds to verify");
      const cfg = this.accuracyConfig();
      const result = verifyAgainstHistory(rounds, {
        thresholds: cfg.thresholds,
        windows: cfg.windows,
        cadenceMs: this.cadenceMs(),
        blockWeights: { baseline: 0.25, markov: 0.25, streak: 0.25, recent: 0.25 },
      });
      for (const run of result.runs) {
        if (!run.blocks) continue;
        for (const m of run.models) {
          this.upsertLedger(m.model, run.window, run.threshold, {
            n: m.blocks,
            brierSum: m.brier * m.blocks,
            baseSum: run.brierBase * m.blocks,
            loglossSum: m.logloss * m.blocks,
            hits: m.hitRate * m.blocks,
            roundsScanned: result.scanned,
          });
        }
      }
      this.recomputeWeights();
      sql.exec(
        "INSERT INTO backtest_runs (source, kind, params, result, created_ms) VALUES (?, 'accuracy-history', ?, ?, ?)",
        source, JSON.stringify({ thresholds: cfg.thresholds, windows: cfg.windows.map((w) => w.id) }), JSON.stringify(result), Date.now(),
      );
      this.audit((op?.email as string) ?? "system", "accuracy.verify", source, { blocks: result.blocks });
      return ok(result);
    }

    // ---- fallback
    return fail(`no route: ${method} ${path}`, 404);
  }

  private fxPayload(source: string | null): Record<string, unknown> {
    const rounds = this.roundsFor(source);
    const maxId = this.tableStats().maxId;
    const key = `${source ?? "all"}:${maxId}`;
    const hit = this.fxCache.get(key);
    if (hit) return hit.payload;
    const { signals, engines } = fxSignals(rounds);
    const payload = {
      source: source ?? "all",
      generatedAt: new Date().toISOString(),
      rounds: rounds.length,
      signals,
      ...engines,
      divergence: divergenceOf(rounds),
      // v6.2: structure & momentum summary so the FX lab sees the same signals
      hitPoints: hitPoints(rounds, 300_000).slice(-24),
      anchorState: anchors(rounds).state,
      rangeMomentum: rangeMomentum(rounds).map((r) => ({ id: r.id, momentum: r.momentum, trend: r.trend, currentRun: r.currentRun, medianGapMs: r.medianGapMs })),
    };
    this.fxCache.set(key, { maxId, payload });
    return payload;
  }

  /** Momentum & structure lab payload — hit points, anchors, range momentum, moonshot research, inverted lens. */
  private momentumPayload(source: string | null, bucketMs: number): Record<string, unknown> {
    const rounds = this.roundsFor(source);
    const maxId = this.tableStats().maxId;
    const key = `${source ?? "all"}:${bucketMs}:${maxId}`;
    const hit = this.momentumCache.get(key);
    if (hit) return hit.payload;
    const payload = {
      source: source ?? "all",
      generatedAt: new Date().toISOString(),
      rounds: rounds.length,
      bucketMs,
      hitPoints: hitPoints(rounds, bucketMs),
      anchors: anchors(rounds),
      momentum: rangeMomentum(rounds),
      moonshot: moonshotResearch(rounds, 10),
      rangeForecast: rangeForecast(rounds),
      inverted: invertedForecast(rounds, this.weightsMap()),
    };
    if (this.momentumCache.size > 8) this.momentumCache.clear();
    this.momentumCache.set(key, { maxId, payload });
    return payload;
  }

  private pluginStatus(payload: Record<string, unknown>): unknown {
    const plugins = this.ctx.storage.sql.exec("SELECT key, name, enabled, weight, runs FROM plugins ORDER BY key").toArray() as Rows[];
    const computed: Record<string, unknown> = {
      ladders: payload.ladders, resistance: payload.ceilings, streaks: payload.streaks,
      regimes: null, edge_fit: payload.houseEdge, pressure: payload.pressure,
      moonshot: payload.moonshot, shape_shifters: payload.shape, linguistics: null,
      markov_forecast: payload.streaks, ensemble_forecast: payload.exceedance,
    };
    return plugins.map((p) => ({ ...p, computed: computed[p.key as string] ?? null }));
  }
}

class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (!text) return {};
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function clampInt(raw: string | number | null, min: number, max: number, dflt: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function medianOf(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : +((s[mid - 1] + s[mid]) / 2).toFixed(4);
}

function parseVocab(r: Rows): Record<string, unknown> {
  return { ...r, layers: JSON.parse((r.layers as string) ?? "[]") };
}

function orchestratorGuidance(payload: Record<string, unknown>, settings: { patience: number; speed: string; risk: string; minConfidence: number }): { action: "enter" | "skip"; confidence: number; reason: string; mistakes: string[] } {
  const streaks = payload.streaks as { current: number; currentKind: string };
  const shape = payload.shape as { dryZone: { active: boolean } };
  const pressure = payload.pressure as { overallPressure: number };
  const mistakes: string[] = [];
  let confidence = 0.4;
  const reasons: string[] = [];
  if (streaks.currentKind === "below" && streaks.current >= settings.patience) {
    confidence += Math.min(0.25, streaks.current * 0.03);
    reasons.push(`dry streak of ${streaks.current} within patience (${settings.patience})`);
  } else if (streaks.currentKind === "below") {
    reasons.push(`dry streak ${streaks.current} below patience ${settings.patience} — wait`);
  } else {
    reasons.push("streak just broke; chase risk elevated");
    mistakes.push("Do not chase immediately after a streak break — measured continuation offers no edge.");
  }
  if (shape.dryZone.active) {
    confidence += 0.1;
    reasons.push("dry zone active (rolling 50-round mean below 2.0x)");
  }
  if (pressure.overallPressure >= 65) {
    confidence += 0.1;
    reasons.push(`tail pressure loaded (${pressure.overallPressure}%)`);
  }
  confidence = Math.min(0.95, confidence);
  const action: "enter" | "skip" = confidence >= settings.minConfidence ? "enter" : "skip";
  if (settings.risk === "aggressive") mistakes.push("Aggressive risk profile active — size positions defensively.");
  return { action, confidence: +confidence.toFixed(2), reason: reasons.join("; "), mistakes };
}

/** Band-triplet DNA sequences with forward statistics. */
function dnaSequences(rounds: Round[]): Record<string, unknown> {
  const seqs = new Map<string, { count: number; nextSum: number }>();
  for (let i = 0; i + 3 < rounds.length; i++) {
    const key = `${bandIndex(rounds[i].multiplier)}${bandIndex(rounds[i + 1].multiplier)}${bandIndex(rounds[i + 2].multiplier)}`;
    const e = seqs.get(key) ?? { count: 0, nextSum: 0 };
    e.count++;
    e.nextSum += rounds[i + 3].multiplier;
    seqs.set(key, e);
  }
  const top = [...seqs.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 25)
    .map(([key, v]) => ({
      triplet: key.split("").map((i) => BAND_LABELS[Number(i)]).join(" → "),
      count: v.count,
      forwardMean: +(v.nextSum / v.count).toFixed(3),
    }));
  return { top, unique: seqs.size };
}

/** Derive vocabulary candidate tokens from the live series (learning system). */
function discoverVocabulary(rounds: Round[]): { token: string; layer: string; layers: string[]; definition: string }[] {
  const candidates: { token: string; layer: string; layers: string[]; definition: string }[] = [];
  const recent = rounds.slice(-500);
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1].multiplier;
    const cur = recent[i].multiplier;
    const transition = `${BAND_LABELS[bandIndex(prev)]}→${BAND_LABELS[bandIndex(cur)]}`;
    if (cur >= 10) {
      candidates.push({
        token: transition,
        layer: "transition",
        layers: [BAND_LABELS[bandIndex(prev)], BAND_LABELS[bandIndex(cur)]],
        definition: `Observed band transition into a high round (≥10x), ${recent.filter((r) => r.multiplier >= 10).length} occurrences in last 500.`,
      });
    }
  }
  let dry = 0;
  for (let i = recent.length - 1; i >= 0 && recent[i].multiplier < 2; i--) dry++;
  if (dry >= 5) {
    candidates.push({
      token: `dry${Math.min(dry, 9)}`,
      layer: "streak",
      layers: ["streak", String(dry)],
      definition: `Current below-2x run of ${dry} rounds at discovery time.`,
    });
  }
  const seen = new Set<string>();
  return candidates.filter((c) => (seen.has(c.token) ? false : (seen.add(c.token), true))).slice(0, 30);
}
