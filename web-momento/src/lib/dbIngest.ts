// SQLite (.db) file ingest with automatic schema detection.
//
// Opens an uploaded SQLite file in the browser (sql.js, lazily loaded), scans
// every table, and auto-maps whatever schema it finds onto Momento's round
// shape: multiplier column (with scale detection — e.g. 9600 → 96.00x),
// timestamp column (epoch ms / epoch s / Julian day / ISO strings), and an
// optional color column. Tables without timestamps get a synthetic cadence so
// dedupe (source, ts_ms, multiplier) never collapses real rows.

import type { Database, SqlJsStatic } from "sql.js";

export interface DbTableInfo {
  name: string;
  rowCount: number;
  columns: string[];
}

export type TimestampUnit = "ms" | "s" | "julian" | "iso";

export interface DbMapping {
  table: string;
  columns: string[];
  rowCount: number;
  multiplierColumn: string;
  scale: number;
  timestampColumn: string | null;
  timestampUnit: TimestampUnit | null;
  colorColumn: string | null;
  syntheticCadenceMs: number | null;
  confidence: "high" | "medium" | "low";
  notes: string[];
  sample: Record<string, unknown>[];
}

export interface MappedRound {
  multiplier: number;
  timestamp?: number;
  color?: string;
}

const MULT_NAME = /(multiplier|mult|crash|payout|odds|value|result|point|x$)/i;
const TS_NAME = /(time|ts|date|created|stamp|draw|_at$|at$)/i;
const ID_NAME = /^(_?id|rowid|index|idx|.*_id)$/i;
const COLOR_NAME = /colou?r/i;
const TABLE_NAME = /round|game|history|result|bet|crash|draw|spin|seed/i;

const SAMPLE_ROWS = 400;
const MAX_TABLES = 24;

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

/** Lazily load sql.js + its wasm blob (only fetched when a .db file is opened). */
async function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      const [{ default: wasmUrl }, { default: initSqlJs }] = await Promise.all([
        import("sql.js/dist/sql-wasm.wasm?url"),
        import("sql.js"),
      ]);
      return initSqlJs({ locateFile: () => wasmUrl });
    })();
  }
  return sqlJsPromise;
}

/** Open an uploaded SQLite file. Throws a friendly error on invalid files. */
export async function openSqlite(file: File): Promise<Database> {
  const SQL = await loadSqlJs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 100 || String.fromCharCode(...bytes.slice(0, 15)) !== "SQLite format 3") {
    throw new Error("Not a SQLite database (missing SQLite header)");
  }
  return new SQL.Database(bytes);
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function rowsOf(db: Database, query: string): Record<string, unknown>[] {
  const res = db.exec(query);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((v) => {
    const row: Record<string, unknown> = {};
    columns.forEach((c, i) => (row[c] = v[i]));
    return row;
  });
}

/** List user tables with column names and row counts. */
export function listTables(db: Database): DbTableInfo[] {
  const meta = rowsOf(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT " + MAX_TABLES,
  );
  const tables: DbTableInfo[] = [];
  for (const m of meta) {
    const name = String(m.name);
    const cols = rowsOf(db, `PRAGMA table_info(${quoteIdent(name)})`).map((c) => String(c.name));
    if (!cols.length) continue;
    const countRow = rowsOf(db, `SELECT COUNT(*) AS n FROM ${quoteIdent(name)}`)[0];
    tables.push({ name, rowCount: Number(countRow?.n ?? 0), columns: cols });
  }
  return tables;
}

interface ColStats {
  numeric: number[];
  strings: string[];
  total: number;
}

function collectStats(sample: Record<string, unknown>[], col: string): ColStats {
  const numeric: number[] = [];
  const strings: string[] = [];
  let total = 0;
  for (const row of sample) {
    const raw = row[col];
    if (raw === null || raw === undefined) continue;
    total++;
    if (typeof raw === "number" && Number.isFinite(raw)) numeric.push(raw);
    else if (typeof raw === "string") {
      const stripped = raw.trim().replace(/x$/i, "");
      const n = Number(stripped);
      if (stripped !== "" && Number.isFinite(n)) numeric.push(n);
      else strings.push(raw);
    }
  }
  return { numeric, strings, total };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Detect the timestamp unit of a numeric column, or null if implausible. */
function numericTimeUnit(values: number[]): TimestampUnit | null {
  if (values.length < 3) return null;
  const med = median(values);
  const allInt = values.every((v) => v === Math.round(v));
  if (med >= 1e12 && med < 1e14) return "ms"; // epoch ms, 2001 → 5138
  if (med >= 1e9 && med < 2e10) return "s"; // epoch s, 2001 → 2286
  if (allInt && med >= 2400000 && med < 2500000) return "julian"; // SQLite julianday()
  return null;
}

function isoTimeUnit(strings: string[]): TimestampUnit | null {
  if (strings.length < 3) return null;
  const ok = strings.filter((s) => !Number.isNaN(Date.parse(s))).length;
  return ok / strings.length >= 0.9 ? "iso" : null;
}

/** Analyze one table: find multiplier (and its scale), timestamp, color. */
function mapTable(info: DbTableInfo, sample: Record<string, unknown>[]): DbMapping | null {
  const notes: string[] = [];
  let multCol: string | null = null;
  let multScore = 0;
  let scale = 1;

  for (const col of info.columns) {
    if (ID_NAME.test(col)) continue;
    const st = collectStats(sample, col);
    if (st.total < 3 || st.numeric.length / st.total < 0.9) continue;
    const values = st.numeric;
    const med = median(values);
    if (med < 1 || med > 1e6) continue;

    // Name affinity is the strongest signal.
    const nameHit = MULT_NAME.test(col) && !TS_NAME.test(col);
    // Distribution must look like multipliers: spread out, not an enum/status.
    const spread = Math.max(...values) / Math.max(med, 1e-9);
    const distinct = new Set(values.map((v) => Math.round(v * 100))).size;
    if (distinct <= 3 && med < 5) continue;

    let score = 1 + (nameHit ? 3 : 0) + (spread > 1.2 ? 1 : 0);
    // Scale: integer values with a big median are almost always percent-encoded.
    let colScale = 1;
    if (values.every((v) => v === Math.round(v))) {
      if (med >= 100) colScale = 100;
      if (med >= 10000) colScale = 10000;
    }
    if (colScale > 1) score += 1;
    if (score > multScore) {
      multScore = score;
      multCol = col;
      scale = colScale;
    }
  }

  if (!multCol) {
    // Last resort: a numeric column whose values sit in a plausible band.
    for (const col of info.columns) {
      if (ID_NAME.test(col)) continue;
      const st = collectStats(sample, col);
      if (st.total < 10 || st.numeric.length / st.total < 0.9) continue;
      const med = median(st.numeric);
      if (med >= 1 && med <= 20 && Math.max(...st.numeric) >= 5 && !TS_NAME.test(col)) {
        multCol = col;
        multScore = 1;
        notes.push(`"${col}" chosen by value distribution (1–20 band)`);
        break;
      }
    }
  }
  if (!multCol) return null;

  // Timestamp: name-matched columns first, then any plausible time-valued column.
  let tsCol: string | null = null;
  let unit: TimestampUnit | null = null;
  const timeCandidates = [...info.columns].sort((a, b) => Number(TS_NAME.test(b)) - Number(TS_NAME.test(a)));
  for (const col of timeCandidates) {
    const st = collectStats(sample, col);
    if (st.total < 3) continue;
    const u =
      st.numeric.length / st.total >= 0.9 && st.numeric.length >= 3
        ? numericTimeUnit(st.numeric)
        : isoTimeUnit(st.strings);
    if (u) {
      tsCol = col;
      unit = u;
      break;
    }
  }

  const colorCol = info.columns.find((c) => COLOR_NAME.test(c) && collectStats(sample, c).strings.length > 0) ?? null;

  if (!tsCol) notes.push("no timestamp column found — synthetic cadence will be applied");
  if (scale > 1) notes.push(`integer values detected — dividing by ${scale}`);

  return {
    table: info.name,
    columns: info.columns,
    rowCount: info.rowCount,
    multiplierColumn: multCol,
    scale,
    timestampColumn: tsCol,
    timestampUnit: tsCol ? unit : null,
    colorColumn: colorCol,
    syntheticCadenceMs: tsCol ? null : 120_000,
    confidence: multScore >= 4 ? "high" : multScore >= 2 ? "medium" : "low",
    notes,
    sample: sample.slice(0, 6),
  };
}

/** Scan every table and return mappings best-first. */
export function detectSchemas(db: Database): DbMapping[] {
  const mappings: DbMapping[] = [];
  for (const info of listTables(db)) {
    const sample = rowsOf(db, `SELECT * FROM ${quoteIdent(info.name)} LIMIT ${SAMPLE_ROWS}`);
    const m = mapTable(info, sample);
    if (m) mappings.push(m);
  }
  const conf = { high: 3, medium: 2, low: 1 } as const;
  const score = (m: DbMapping) =>
    conf[m.confidence] * 100 + (m.timestampColumn ? 20 : 0) + (TABLE_NAME.test(m.table) ? 10 : 0) + Math.min(m.rowCount / 1000, 10);
  return mappings.sort((a, b) => score(b) - score(a));
}

function toMs(raw: unknown, unit: TimestampUnit | null): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (unit === "s") return raw * 1000;
    if (unit === "ms") return raw;
    if (unit === "julian") return Math.round((raw - 2440587.5) * 86400000);
    return raw > 1e12 ? raw : raw * 1000;
  }
  if (typeof raw === "string") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return toMs(n, unit === "iso" ? null : unit);
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function toMult(raw: unknown, scale: number): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim().replace(/x$/i, ""));
  if (!Number.isFinite(n)) return null;
  const m = n / scale;
  return m >= 1 && m <= 1e7 ? m : null;
}

/** Materialize a mapping into ascending rounds ready for POST /api/v1/ingest. */
export function mapRounds(db: Database, mapping: DbMapping): MappedRound[] {
  const wanted = [mapping.multiplierColumn, mapping.timestampColumn, mapping.colorColumn].filter(
    (c): c is string => !!c,
  );
  const res = db.exec(`SELECT ${wanted.map(quoteIdent).join(", ")} FROM ${quoteIdent(mapping.table)}`);
  if (!res.length) return [];
  const { columns, values } = res[0];
  const iMult = columns.indexOf(mapping.multiplierColumn);
  const iTs = mapping.timestampColumn ? columns.indexOf(mapping.timestampColumn) : -1;
  const iColor = mapping.colorColumn ? columns.indexOf(mapping.colorColumn) : -1;

  const rounds: MappedRound[] = [];
  for (const row of values) {
    const m = toMult(row[iMult], mapping.scale);
    if (m === null) continue;
    const r: MappedRound = { multiplier: m };
    if (iTs >= 0) {
      const ts = toMs(row[iTs], mapping.timestampUnit);
      if (ts !== null && ts > 0) r.timestamp = ts;
    }
    if (iColor >= 0 && typeof row[iColor] === "string" && row[iColor]) {
      r.color = String(row[iColor]).toLowerCase().slice(0, 16);
    }
    rounds.push(r);
  }

  // No timestamps → walk backwards from now at the synthetic cadence so every
  // row keeps a unique dedupe key.
  if (!mapping.timestampColumn) {
    const cadence = mapping.syntheticCadenceMs ?? 120_000;
    let ts = Date.now();
    for (let i = rounds.length - 1; i >= 0; i--) {
      rounds[i].timestamp = ts;
      ts -= cadence;
    }
  }

  return rounds.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}
