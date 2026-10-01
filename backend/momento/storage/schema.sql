-- Momento afresh backend — SQLite schema (v6.5-compatible).
--
-- Regenerated verbatim from the CREATE statements of the archived TypeScript
-- Durable Object (archive/backend-ts-v6.5). The two historical ALTER TABLE
-- migrations are folded into their tables (rounds.origin, intel_calibrations.cal_loss);
-- momento.storage.db still applies them idempotently to databases created elsewhere.
-- New in afresh: schema_version and jobs (bounded background job pool).

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL,
  applied_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  progress REAL NOT NULL DEFAULT 0,
  result TEXT,
  error TEXT,
  created_ms INTEGER NOT NULL,
  started_ms INTEGER,
  finished_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status, created_ms);

-- ---------------------------------------------------------------- from archive/backend-ts-v6.5/core.ts
CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  ts_ms INTEGER NOT NULL,
  multiplier REAL NOT NULL,
  color TEXT,
  source TEXT NOT NULL,
  session_id INTEGER,
  ingest TEXT NOT NULL DEFAULT 'api',
  created_ms INTEGER NOT NULL,
  origin TEXT NOT NULL DEFAULT 'observed'
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
  resolved_ms INTEGER,
  cal_loss REAL
);
CREATE INDEX IF NOT EXISTS idx_intel_cal ON intel_calibrations (created_ms);

-- ---------------------------------------------------------------- from archive/backend-ts-v6.5/v64routes.ts
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

-- ---------------------------------------------------------------- from archive/backend-ts-v6.5/v65routes.ts
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
