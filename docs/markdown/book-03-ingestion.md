# 03 · Data Collection & Ingestion

> **Why this chapter matters most.** Every probability, ETA and skill score in Momento can only be as accurate as the tape it is computed from. The canonical dataset already shows a capture-bias signature (Ch 01 §1.8). This chapter covers what the repos do today, two concrete defects found in the v6.3 ingest code, and a reference design for a collector and ingest path that makes the tape auditable.

## 3.1 Inventory: every ingest path in the account
| Component | Location | Behaviour |
|---|---|---|
| **Worker ingest** | `MomentoV5@v6.3:functions/core.ts` (`normalizeRound`, `ingestRounds`, `extendSessions`, `rebuildSessions`) | `POST /api/v1/ingest`, `/import`, `/top-rounds/ingest`; `ingest_log` table |
| **SQLite `.db` import (v6.3)** | `core.ts` + Ingest Console | Scans every table, maps any schema onto the round shape, shows a confidence chip per table |
| **Live engine** | `core.ts` feed (`/feed/*`), V5 `feed.py` | Provably-fair generator: `SHA-256(seed:cursor)` → uniform r → `m = floor(0.97/(1−r)·100)/100` |
| **File watcher (V5)** | `MomentoV5@v6:backend/momento/watcher.py` | Polls for `.json/.csv/.txt/.ndjson` files whose names start with `momento`, `avfs`, `round(s)`, `aviator`, `crash` or `jetx`. Waits until a file is settled (size stable), takes a source hint from the name, ingests it, then moves it to processed/failed |
| **Terminal watcher** | `ShapeShifters@momento-terminal-replace:backend/momento/watcher.py` | `~/Downloads` only. Byte-offset tailing, persistent seen-cache, first-run bootstrap |
| **Terminal DB ingest** | `ShapeShifters@…:backend/momento/ingest.py` (35 KB) | Read-only immutable open, column scoring, scale detection, fair-curve sanity preview |
| **V5 parsers** | `MomentoV5@v6:backend/momento/plugins.py` | `normalize_round`, `extract_rounds` (JSON of any shape), `parse_csv`, `parse_text`, `insert_rounds`, `ingest_payload`, `ingest_file` |
| **Browser collectors** | `MomentoFresh` (Aviator collector), `avfs-backend` (Express + SSE) | Live capture from the game UI (DOM) |
| **4-layer dedup** | `InvestigationSuite` | exact row → same timestamp → near-timestamp same value → cross-source overlap |
| **FPGA ingest spec** | `MomentoFX:backend/momento/FPGA_INGEST_README.md` | Hardware-path concept for ultra-low-latency capture |

## 3.2 How v6.3 ingests a round today
### 3.2.1 Accepted shapes (`docs/markdown/ingest-sources.md`)
- **Multiplier keys:** `multiplier`, `value`, `crash_point`, `result`, `payout`.
- **Timestamp keys:** `timestamp`, `time`, `ts`, `created_at`, given as ISO-8601, epoch seconds or epoch milliseconds (values > 10¹² are treated as ms).
- **Containers:** JSON arrays; objects with `rounds / data / results / items / history / records`; CSV with or without header; a plain list of numbers.
- **`.db` files:** the multiplier column is found by name or by value distribution. Percent-encoded scales are detected (integer medians ≥ 100 → ÷100, ≥ 10,000 → ÷10,000). Timestamps can be epoch ms/s, Julian day or ISO strings.

### 3.2.2 The normalise → insert path (`core.ts`)
```ts
const multRaw = o.multiplier ?? o.value ?? o.crash_point ?? o.result ?? o.payout;
if (!Number.isFinite(multiplier) || multiplier < 1) return null;         // rejected
const tsRaw = o.timestamp ?? o.time ?? o.ts ?? o.created_at;
let tsMs = fallbackTsMs;                                                 // = Date.now() for the batch
...
return { tsMs, multiplier: Math.min(multiplier, 1e7), color };
```
`ingestRounds` then:
1. sorts by `tsMs`;
2. runs `INSERT OR IGNORE` inside `transactionSync`, guarded by the unique index `(source, ts_ms, multiplier)`;
3. writes `ingest_log (source, method, count, rejected)` and registers the source if it is new;
4. invalidates caches;
5. for batches ≤ 200 rounds, calls `extendSessions` (incremental 30-minute sessionisation);
6. calls `calibrateNewRounds()`, which resolves the pending next-round forecasts.

### 3.2.3 Two defects to fix first
**Defect I1: rounds without timestamps can collapse.** Every round in a batch that has no timestamp gets the *same* `fallbackTsMs = Date.now()`. The dedupe key is `(source, ts_ms, multiplier)`, so any **repeated value inside one timestamp-less batch is silently dropped**. In a plain list such as `[1.00, 2.31, 1.00, 1.04, 1.00]`, only one `1.00` survives.

Repeats are far more common at the low end: 1.00×–1.10× values recur constantly, while high values almost never repeat exactly. So this defect **removes low rounds preferentially**. That is exactly the direction of the capture-bias signature in Ch 01 (P(≥2)·2 ≈ 1.009 > 1). The canonical tape came mostly with timestamps, so this defect alone probably does not explain the bias. It does bias every pasted list and every timestamp-less watcher file.

*Fix:*
- (a) assign synthetic, strictly increasing timestamps: `fallbackTsMs + index`, marked `ts_synthetic = 1`;
- (b) for sources that expose one, use `round_id` in the dedupe key instead of `ts_ms`;
- (c) report `collapsed` in the ingest response.

The terminal watcher already follows the principle: "every round carries the timestamp it claims".

**Defect I2: session rebuild assumes id order equals time order.** `rebuildSessions` assigns sessions with `UPDATE rounds SET session_id = ? WHERE id BETWEEN startRow.id AND prev.id`. When batches arrive out of order (a backfill of last week after today's live rounds), ids are no longer monotone in `ts_ms`. Rounds from other sessions then get the wrong `session_id`.

*Fix:* update by `ts_ms` range and source: `WHERE source = ? AND ts_ms BETWEEN ? AND ?`. Better still, store session membership in a derived table so that `rounds` stays fully immutable (App. A proposes `round_session`).

**Also worth noting:**
- `normalizeRound` rejects m < 1 silently. The count lands in `rejected` with no reason. Add a `reject_reasons` histogram to `ingest_log`.
- The live-engine formula `m = floor(0.97/(1−r)·100)/100` gives P(≥m) ≈ 0.97/m, which is a **3% edge**. The same doc describes it as "house edge 1%". The terminal's `preview_stats` defaults to `house_edge = 0.03`. Pick one value, make it a per-source setting, and use it in all fairness and fair-curve checks.

## 3.3 What the terminal gets right (and v6 should adopt)
`ShapeShifters@momento-terminal-replace:backend/momento/ingest.py` has the most carefully reasoned ingest code in the account. Its design constraints, quoted from the module docstring:
- "The uploaded file is opened **read-only and immutable** through a `file:` URI, in a throwaway copy, and never written to. A scraper's database is the user's evidence."
- "Nothing is guessed silently. `inspect_database` reports every table and every candidate column with the evidence behind its score, and the caller picks."
- "Integer storage is common (`234` meaning `2.34x`), so scale detection is explicit and always reported back."
- "Row scanning is capped, and the cap is reported so a truncated ingest is never mistaken for a complete one."

### 3.3.1 Column scoring (how a crash column is recognised)
`_score_multiplier_column` combines cheap, independent signals:

\[
\text{score} = 0.30\,s_{num} + 0.24\,s_{range} + 0.18\,s_{\approx 2} + 0.10\min(\tfrac{\text{mean}/\text{median}}{3},1) + 0.30\,h_{name} \pm 0.08/0.15_{distinct}
\]

| Symbol | Meaning |
|---|---|
| \(s_{num}\) | numeric share |
| \(s_{range}\) | share of values in [1, 10⁶] after scaling |
| \(s_{\approx 2}\) | closeness of the median to 2 |
| mean/median | heavy-tail ratio |
| \(h_{name}\) | name-hint strength |

Penalties:
- −0.5 if the range share is < 50%;
- −0.55 if the column is **monotonic**, because "a counter is the most dangerous decoy: scaled by a hundredth, an id column of 1..400 has a median near 2";
- −0.45 if the name is id-like.

### 3.3.2 Fair-curve sanity preview
`preview_stats` compares observed exceedance to the fair curve (1 − h)/t at t ∈ {1.5, 2, 5, 10, 50, 100}. A threshold is "plausible" if the observed-to-fair ratio is in [0.5, 2.0] (or there are fewer than 10 hits). The preview also reports `instantCrashes`, the share below 1.05×. If any threshold is off, the verdict reads: "Either this is not a multiplier column, the scale is wrong, or the house edge in Settings does not match this operator."

**Adopt this as the v6 import gate.** Then extend it with a *low-end* check. The ratio at t = 1.5 and t = 2 is the one that exposes missing low rounds. A tight Wilson interval there (not the loose [0.5, 2] band) is the core of F-01.

### 3.3.3 Watcher reliability
The terminal watcher's docstring records hard-won lessons:
- Files are tracked by `(path, size, mtime, byte_offset)`. "A growing file is re-read from the last byte offset, so appending never double-inserts."
- "A file is marked seen only AFTER its rounds are ingested", and duplicates are also caught round-by-round on (multiplier, timestamp). "A crash between ingest and marking cannot duplicate anything and nothing is lost either."
- The seen-cache is **persisted** (`watcher_seen.json`, written atomically via `os.replace`). It used to be in-memory, and "every restart re-ingested the whole watch directory (~1,600 rounds of old history)… wedging the event loop for minutes and filling the tape with duplicates."
- **First-run bootstrap** marks existing files as seen without ingesting them.

## 3.4 Reference design: the collector
### 3.4.1 Capture at the network layer, not the DOM
DOM readers break whenever the UI changes, and they miss short rounds. A 1.00× round can be on screen for well under a second. Headless browsers can observe WebSocket traffic directly: Playwright exposes `page.on('websocket')` with `framereceived` / `framesent` events ([Playwright network docs](https://playwright.dev/docs/network)).

```ts
// collectors/pw-ws/collector.ts  (sketch)
import { chromium } from "playwright";
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });
const page = await ctx.newPage();
page.on("websocket", ws => {
  ws.on("framereceived", ({ payload }) => {
    const ev = decodeFrame(payload);            // operator-specific decoder, versioned
    if (ev?.type === "round_end") buffer.push({
      source: SOURCE, round_id: ev.roundId ?? null, ts_ms: ev.ts ?? Date.now(),
      multiplier: ev.crash, raw_hash: sha256(payload), collector: "pw-ws@1.4.0",
    });
  });
});
await page.goto(GAME_URL);
setInterval(flush, 1000);                       // batch → NDJSON spool → POST /ingest
```
Design rules:
1. **Decoders are versioned plugins** (`decoders/<operator>@<ver>.ts`) with golden-frame tests. When an operator changes its protocol, only the decoder changes.
2. **Spool first, send second.** Append every event to a local NDJSON file before any network call. The watcher and the live path then share one parser, and nothing is lost when the network drops.
3. **Keep the DOM reader as a cross-check.** Disagreements between the WS feed and the DOM feed are the input to F-02.
4. **Heartbeats.** The collector posts `/collector/heartbeat {collector_id, last_round_ts, frames_seen, decode_errors}` every 30 s, so a dead collector is visible within a minute.

### 3.4.2 Signed batches
Collectors run on machines you do not fully control. Sign each batch with HMAC-SHA256 over the canonical JSON body and a timestamp: `X-Momento-Signature: t=<unix>,v1=<hex>`. Reject requests with |now − t| > 300 s to block replays. Each collector gets its own key, so one leaked key can be revoked on its own (Ch 17, STRIDE: *Spoofing, Tampering*).

## 3.5 Reference design: the ingest contract
```jsonc
POST /api/v1/ingest
{ "source": "aviator:operatorX", "collector": "pw-ws@1.4.0", "batch_id": "c7f2…",
  "rounds": [
    { "round_id": "8812331", "ts_ms": 1790000000000, "multiplier": 3.42, "raw_hash": "…" } ] }

→ 200 { "inserted": 97, "duplicates": 3, "collapsed": 0, "rejected": 0,
        "reject_reasons": {}, "gaps_detected": 1, "est_missing": 2, "session_id": 412 }
```
| Rule | Why |
|---|---|
| Idempotent on `batch_id` (store it in `ingest_log`) | Retries are safe |
| Dedupe key `(source, round_id)` when present, else `(source, ts_ms, multiplier)` | `round_id` is the operator's own truth |
| Synthetic timestamps are marked `ts_synthetic = 1` and excluded from cadence statistics | Fixes I1 without faking a clock |
| Out-of-order batches are accepted; sessions are recomputed for the affected time range only | Fixes I2; backfills are normal |
| Every response reports counts by outcome | Operators see loss immediately |
| `ingest_log` stores `collector`, `batch_id`, `reject_reasons` | Tape quality can be attributed to a collector build |

## 3.6 Gap and missing-round detection
Rounds arrive at a roughly regular cadence (bet phase, flight, cool-down). `pipeline.ts: medianIntervalMs` already computes the median spacing. Within a session, flag a **gap** when Δt > k · median (k ≈ 2.5). Estimate the number of missing rounds as round(Δt/median) − 1.

Flight time is not constant: it grows with the multiplier. The terminal's growth law t(x) = 16.67·ln x seconds (`RESEARCH.md`) lets you correct the expected interval for the previous round's multiplier. That makes gap detection much sharper after big rounds.

```ts
export function detectGaps(rs: Round[], k = 2.5): Gap[] {
  const d = rs.slice(1).map((r, i) => r.ts_ms - rs[i].ts_ms - 1000 * 16.67 * Math.log(rs[i].multiplier));
  const base = median(d.filter(x => x > 0));                  // cadence net of flight time
  const out: Gap[] = [];
  for (let i = 0; i < d.length; i++) if (d[i] > k * base)
    out.push({ after_round: rs[i].id, dt_ms: d[i], est_missing: Math.round(d[i] / base) - 1 });
  return out;
}
```
Store the results in `tape_gaps(session_id, after_round_id, dt_ms, est_missing, detector_ver)`. They feed:
- **capture completeness %** per session = observed / (observed + Σ est_missing);
- **low-round under-recording**: the observed share below 1.2× and below 2× vs the fair curve, with Wilson 95% CIs ([binomial proportion CI](https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval));
- **the Tape Integrity Score (F-01)**, which filters engine training to high-integrity sessions.

## 3.7 Sessionisation
Keep the 30-minute rule; it is shared by v6.3, V5 and InvestigationSuite. Add these columns to `sessions`: `collector`, `completeness`, `integrity`, `low_share_z`, `gaps`.

Two refinements:
1. **Operator sessions vs collector sessions.** A 30-minute gap can mean the game was quiet or the collector was down. Heartbeats (§3.4.1) tell you which. Mark sessions that ended because the collector died as `ended_by = 'collector'`.
2. **Recompute on range, not globally.** After a backfill, recompute only the sessions that overlap the new time range.

## 3.8 The 4-layer dedup, applied
InvestigationSuite's layers map onto v6 like this:

| Layer | Rule | Where to apply |
|---|---|---|
| 1 Exact row | identical `(source, round_id)` or `(source, ts_ms, multiplier)` | unique index (exists) |
| 2 Same timestamp | same `(source, ts_ms)`, different multiplier | quarantine: one of them is a decode error |
| 3 Near-timestamp, same value | \|Δts\| < 2 s, same multiplier, same source | merge (clock jitter between collectors) |
| 4 Cross-source overlap | same round seen via two sources (e.g. `avfs` and `momento_prev`) | keep both rows, link in `round_links` so statistics use one |

Layer 4 matters for the canonical dataset. It was merged from three sources, and any overlap double-counts rounds in every statistic.

## 3.9 Quarantine instead of rejection
Rows that fail validation should go to `ingest_quarantine(raw, reason, batch_id)`, not disappear. Examples: m < 1, a layer-2 conflict, a timestamp > 5 min in the future, a decode error. The Ingest Console gets a *Quarantine* tab, where an operator can release or delete rows. That keeps the "nothing is guessed silently" principle for live data too.

## 3.10 `normalizeRound` and `ingestRounds`, line by line
Source: `MomentoV5@v6.3-full-intelligence:functions/core.ts`. The code is at lines 581–633; the unique index is at line 112.

```ts
private normalizeRound(raw, fallbackTsMs) {
  if (typeof raw !== "object" || raw === null) {          // bare numbers or strings
    const n = Number(raw);
    return Number.isFinite(n) && n >= 1 ? { tsMs: fallbackTsMs, multiplier: n, color: null } : null;
  }
  const multRaw = o.multiplier ?? o.value ?? o.crash_point ?? o.result ?? o.payout;
  const multiplier = Number(multRaw);
  if (!Number.isFinite(multiplier) || multiplier < 1) return null;
  const tsRaw = o.timestamp ?? o.time ?? o.ts ?? o.created_at;
  let tsMs = fallbackTsMs;
  if (typeof tsRaw === "number") tsMs = tsRaw > 1e12 ? tsRaw : tsRaw * 1000;
  else if (typeof tsRaw === "string") { const p = Date.parse(tsRaw); if (!Number.isNaN(p)) tsMs = p; }
  ...
  return { tsMs, multiplier: Math.min(multiplier, 1e7), color };
}
```
```ts
private ingestRounds(source, method, incoming) {
  const now = Date.now();
  const sorted = incoming.map(r => this.normalizeRound(r, now)).filter(Boolean);
  rejected = incoming.length - sorted.length;
  sorted.sort((a, b) => a.tsMs - b.tsMs);
  transactionSync(() => { for (r of sorted) INSERT OR IGNORE INTO rounds (...) ; inserted += rowsWritten });
  INSERT INTO ingest_log (source, method, count, rejected, created_ms);
  INSERT INTO sources ... ON CONFLICT DO NOTHING;
  this.invalidateCaches();                                   // all sources
  if (sorted.length > 0 && sorted.length <= 200) this.extendSessions(source, sorted);
  if (inserted > 0) this.calibrateNewRounds();               // synchronous, in the request
}
```

### 3.10.1 Findings from the code
| # | Finding | Input that triggers it | Effect | Fix |
|---|---|---|---|---|
| I1 | **Repeats collapse without timestamps** (measured in §3.11) | `[1.00, 2.31, 1.00]`, CSV without a time column, pasted lists | Low repeats are dropped by the `(source, ts_ms, multiplier)` unique index | `fallbackTsMs + index`, `ts_synthetic = 1`, collapsed count in the response |
| I2 | **Session rebuild by id range** (I2) | Backfills out of time order | Wrong `session_id` | Update by `ts_ms` range, or use a `round_session` table |
| I3 | **Numeric-string timestamps are ignored.** `Date.parse("1727000000")` is `NaN`, so the round silently gets `now` | JSON from collectors that serialise epochs as strings; every CSV import (all CSV cells are strings) | Same collapse as I1, and the round is placed at ingest time | If `/^\d{9,13}$/` matches, treat it as an epoch in seconds or milliseconds by length |
| I4 | **Zone-less datetimes are read as UTC.** `"2026-09-26 12:00:00"` parses as 12:00 UTC in the Workers runtime | Operator exports in local time (for example SAST, UTC+2) | Rounds shift by the zone offset, sessions split or merge wrongly, and time-of-day statistics shift | Require a zone, or take a per-source `tz` setting; reject ambiguous strings to quarantine |
| I5 | **Microsecond epochs are accepted as milliseconds.** Any value > 1e12 is treated as ms, so 1.7e15 µs lands in the year 55,000 or so | Some database exports | The round sorts after every live round forever | Validate `tsMs` ∈ [2015-01-01, now + 5 min]; scale by digit count |
| I6 | **Rejections have no reasons, and some values are altered silently.** `"2.31x"`, `"2,31"` and `0.99` all count as `rejected`; multipliers above 1e7 are clamped | Pasted text, European locales | Nobody can tell a formatting problem from bad data | Parse `x` suffixes and decimal commas explicitly; store `reject_reasons` (App. A); quarantine instead of dropping |
| I7 | **Large batches skip incremental sessions.** Batches > 200 rows leave `session_id` NULL until someone runs `/sessions/rebuild` | Imports, backfills | Session views and per-session statistics miss new rounds | Always sessionise, with one set-based `UPDATE … WHERE ts_ms BETWEEN` per session |
| I8 | **Heavy work inside the ingest request.** Caches for all sources are cleared even when `inserted = 0`, and `calibrateNewRounds()` runs synchronously | Every live batch | Ingest latency grows with ledger size and blocks other requests on the single DO (T3) | Invalidate only when `inserted > 0`, per source; move calibration to the alarm (Ch 04 §4.2.3) |
| I9 | **No near-duplicate or burst check.** The unique key includes `ts_ms`, so the same round written twice a few ms apart is stored twice | Two collectors, retries, DOM re-render | Measured: 484 pairs < 50 ms apart in `clean_data.csv` raise χ² from 26.1 to 54.5; a 7,696-row burst in `avfs.db` raises χ² from 27.5 to 869 (Ch 06 §6.8) | Quarantine same-m rows within 50 ms and any > 20 rows/s burst; add `batch_id` and `kind` columns |

## 3.11 Measuring I1: how much a timestamp-less batch loses
Simulation: fair tapes drawn as \(m = \max(1, \lfloor 0.97/(1-r)\cdot 100\rfloor/100)\). Each batch of n rounds is ingested with the same fallback timestamp, so only unique values survive. There are 400 repetitions per row. On this law, 3.99% of rounds are exactly 1.00×.

| Batch size n | Share of rounds kept | True P(≥2) | P(≥2) after ingest | Bias |
|---|---|---|---|---|
| 50 | 90.7% | 48.4% | 52.2% | +3.8 pp |
| 200 | 74.7% | 48.5% | 60.1% | +11.6 pp |
| 500 | 58.0% | 48.3% | 70.0% | +21.7 pp |
| 2,000 | 34.1% | 48.5% | 85.4% | +36.8 pp |

The loss is severe and always in the same direction: it removes low values, so every statistic afterwards looks "hotter" than the game. The canonical P(≥2) of 50.47% is only +2 pp above 48.5%. That fits a **small** share of timestamp-less or string-timestamp input (I1 plus I3), not a tape built mainly from pasted lists. The committed `avfs.db` points to another mechanism with the same signature: an inserted burst of high-skewed rows (I9, Ch 06 §6.8). This is one more reason to store `ts_synthetic` and `ingest` per round, and to compute every statistic per ingest method until they agree.

```python
import numpy as np
rng = np.random.default_rng(1)
def tape(n, h=0.03):
    u = rng.random(n); return np.maximum(np.floor((1 - h) / (1 - u) * 100) / 100, 1.0)
for n in (50, 200, 500, 2000):
    kept, p2 = [], []
    for _ in range(400):
        t = tape(n); s = np.unique(t); kept.append(len(s) / n); p2.append((s >= 2).mean())
    print(n, np.mean(kept), np.mean(p2))
```

## 3.12 Reference implementation: a strict normaliser (TypeScript)
```ts
export type Norm = { ok: true; tsMs: number; m: number; tsSynthetic: boolean }
                 | { ok: false; reason: string; raw: unknown };
const MIN_TS = Date.UTC(2015, 0, 1);

export function parseMultiplier(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/x$/, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

export function parseTs(v: unknown, tzOffsetMin: number | null): number | null {
  if (typeof v === "number" || (typeof v === "string" && /^\d{9,16}$/.test(v.trim()))) {
    const n = Number(v); const digits = String(Math.trunc(n)).length;
    return digits <= 10 ? n * 1000 : digits <= 13 ? n : Math.trunc(n / 1000);   // s, ms, µs
  }
  if (typeof v !== "string") return null;
  const hasZone = /(z|[+-]\d{2}:?\d{2})$/i.test(v.trim());
  if (!hasZone && tzOffsetMin === null) return null;                             // ambiguous → quarantine
  const p = Date.parse(hasZone ? v : v.replace(" ", "T") + "Z");
  return Number.isNaN(p) ? null : hasZone ? p : p - tzOffsetMin! * 60_000;
}

export function normalise(raw: unknown, i: number, batchTs: number, tz: number | null, now = Date.now()): Norm {
  const o = (typeof raw === "object" && raw !== null) ? raw as Record<string, unknown> : { multiplier: raw };
  const m = parseMultiplier(o.multiplier ?? o.value ?? o.crash_point ?? o.result ?? o.payout);
  if (m === null) return { ok: false, reason: "multiplier_unparseable", raw };
  if (m < 1) return { ok: false, reason: "multiplier_below_1", raw };
  if (m > 1e7) return { ok: false, reason: "multiplier_above_cap", raw };
  if (Math.abs(m * 100 - Math.round(m * 100)) > 1e-6)
    return { ok: false, reason: "multiplier_off_grid", raw };
  const tsRaw = o.timestamp ?? o.time ?? o.ts ?? o.created_at;
  if (tsRaw === undefined || tsRaw === null || tsRaw === "")
    return { ok: true, tsMs: batchTs + i, m, tsSynthetic: true };                // strictly increasing
  const ts = parseTs(tsRaw, tz);
  if (ts === null) return { ok: false, reason: "timestamp_unparseable_or_zone_missing", raw };
  if (ts < MIN_TS || ts > now + 5 * 60_000) return { ok: false, reason: "timestamp_out_of_range", raw };
  return { ok: true, tsMs: ts, m, tsSynthetic: false };
}
```
The ingest handler then:
1. writes rejected rows to `ingest_quarantine` with their reason;
2. inserts accepted rows in one transaction;
3. returns `{inserted, duplicates, quarantined, reasons: {reason: count}, collapsed: 0}`.

With synthetic timestamps, `collapsed` is always 0. The field stays as a regression tripwire.

### 3.12.1 Golden cases (unit tests)
| Input | Expected |
|---|---|
| `[1.00, 2.31, 1.00]` with no timestamps | 3 rows, `ts_synthetic = 1`, strictly increasing `ts_ms` |
| `{"multiplier": "2.31x", "ts": "1727000000"}` | m = 2.31, tsMs = 1,727,000,000,000 |
| `{"multiplier": "2,31", "ts": 1727000000123456}` | m = 2.31, tsMs = 1,727,000,000,123 (µs scaled) |
| `{"multiplier": 2.315}` | quarantined: `multiplier_off_grid` |
| `{"multiplier": 3, "ts": "2026-09-26 12:00:00"}` with no source tz | quarantined: `timestamp_unparseable_or_zone_missing` |
| same with tz = +120 | tsMs = 2026-09-26T10:00:00Z |
| `{"multiplier": 0.99}` | quarantined: `multiplier_below_1` |
| batch of 500 with 0 inserted | caches not invalidated (I8) |

## 3.13 Test plan
| Test | Type | Assertion |
|---|---|---|
| `plain_list_repeats` | unit | `[1.00, 1.00, 1.00]` without timestamps inserts 3 rows (I1) |
| `backfill_out_of_order` | integration | backfill of an older day leaves today's `session_id`s unchanged (I2) |
| `watcher_restart_idempotent` | integration | restart ingests 0 rows (port of `test_watcher`) |
| `growing_file_offsets` | integration | appending N lines inserts exactly N rows |
| `decoder_golden_frames` | unit | each decoder version parses its recorded frames exactly |
| `hmac_replay` | security | a replayed batch older than 300 s is rejected |
| `db_inspect_decoys` | unit | a monotonic id column never outranks the real crash column (port of the terminal tests) |
| `gap_detector_synthetic` | property | randomly deleting rounds from a synthetic tape recovers ≥ 90% of the deletions as gaps |

## 3.14 Measurement
| Metric | Target | Source |
|---|---|---|
| Duplicate rate after dedupe | 0 | `ingest_log` |
| Collapsed rounds (I1) | 0 | ingest response |
| Capture completeness (estimated) | ≥ 99.5% per session | `tape_gaps` |
| Low-end share (< 1.2×, < 2×) vs fair curve | within Wilson 95% CI | F-01 |
| Collector heartbeat gaps | < 1 per day | heartbeats |
| Ingest p95 latency (batch of 100) | < 150 ms | Worker analytics |
| Quarantine rate | < 0.1% of rows | `ingest_quarantine` |

## 3.15 Features this chapter unlocks (Ch 18)
- **F-01 Tape Integrity Score:** a completeness, cadence and low-round-share score per session.
- **F-02 Multi-collector consensus:** WS and DOM collectors on one source, reconciled by the §3.8 layers.
- **F-03 Source fingerprinting:** detect when a source's statistical signature changes (operator change, config change, edge change).
- Prerequisite for all of these: fix **Defects 1 and 2**, then add **heartbeats** and **quarantine**.
