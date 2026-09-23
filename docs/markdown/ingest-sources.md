# Ingest & Sources

## Getting data in

Four paths, all converging on the same immutable `rounds` table:

1. **REST push** — `POST /api/v1/ingest` with `{source, method, rounds:[...]}`. Accepted multiplier keys: `multiplier`, `value`, `crash_point`, `result`, `payout`. Timestamps accept ISO-8601, epoch seconds or epoch milliseconds. Shapes: JSON arrays, objects with `rounds/data/results/items/history/records`, CSV with or without header, or a plain list of numbers.
2. **File upload** — drop a JSON/CSV/TXT file into the Ingest Console; it's parsed with the same rules, previewed, then pushed.
3. **SQLite `.db` import** — drop a `.db`/`.sqlite` file into the Ingest Console and every table is scanned automatically. The detector maps any schema onto the round shape: a multiplier column by name or value distribution, percent-encoded scales (integer medians ≥ 100 → ÷100, ≥ 10000 → ÷10000), timestamps in epoch ms/s, Julian day or ISO strings, and color columns — each table shows a confidence chip, the detected mapping, sample rows, and notes before import. Tables without timestamps get a synthetic 2-minute cadence so the `(source, ts_ms, multiplier)` dedupe never collapses rows. Pushes are chunked (2,000 rounds/request) with a progress readout and logged as ingest method `db-upload`.
4. **Live engine** — a provably-fair round generator: `SHA-256(seed:cursor)` → uniform → `m = floor(0.97/(1−r)·100)/100`, house edge 1%. Start/stop from the Ingest Console or Command Center; verify historical rounds from Round Testing.

## Provenance

The seeded dataset carries three original sources, preserved exactly:

| source | rounds | window |
| --- | --- | --- |
| `avfs` | 150,410 | 2024-01-01 → 2026-07-24 |
| `momento_prev` | 18,805 | 2026-07-29 → 2026-07-30 |
| `momento_project` | 8,690 | 2026-08-01 → 2026-08-02 |

Dedupe is enforced by the unique index `(source, ts_ms, multiplier)` — re-pushing the same data is always safe. Every ingest writes an `ingest_log` row (method, inserted, rejected) and mutations land in the audit log.

## Sessionization

Rounds are grouped into sessions at 30-minute gaps. Small live batches extend the current session incrementally; bulk imports can trigger a full rebuild (`POST /api/v1/sessions/rebuild`, operator-only) which recomputes sessions and per-session metadata in one pass.

## Sources page

`/dashboard/sources` lists every registered source with round counts, last-round time, and kind. Operators can register new sources and delete empty ones. The Market, Eagle Eye and Bird's Eye surfaces can filter any view by source.
