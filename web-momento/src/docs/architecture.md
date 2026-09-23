# Architecture

## Stack

- **Backend** — a single Cloudflare Worker (`functions/index.ts`) dispatching every request into one **Durable Object** (`MomentoCore`, instance `global`) that owns the relational **SQLite** database and all business logic. No mock data path exists: every number on every screen is computed from rows that are actually in the database.
- **Frontend** — Vite + React 19 + TypeScript, Tailwind (Graphite Aurora tokens), shadcn/ui, React Query for all server state, React Router for the sitemap, Recharts for charts.

## Why Worker + Durable Object SQLite

The original Momento core was FastAPI + SQLite. The coordinated rebuild keeps the exact same data model and engine contracts, lifted into the Rork backend: one strongly consistent actor owning one relational store. Cross-feature queries, reporting, search, export/import and the audit log all run server-side. (Supabase Postgres remains a drop-in upgrade path behind the same API boundary — the frontend never touches the database directly.)

## Data flow

```
Ingest (REST push / upload / live engine)
  → normalize + dedupe on (source, ts_ms, multiplier)
  → rounds table (immutable) + ingest_log + audit_log
  → sessionization (30-min gap rule)
  → analysis payload cache (invalidated on any insert)
  → REST responses → React Query → UI
```

## Module boundaries

| Module | Responsibility |
| --- | --- |
| `functions/analysis.ts` | Pure analysis functions — rounds in, metrics out, no I/O |
| `functions/core.ts` | The DO: schema, bootstrap, auth, all routes, caching, feed engine |
| `functions/docs.ts` | Docs manifest + reference constants (calibration, range-lab) |
| `functions/index.ts` | Entrypoint: CORS + dispatch into the DO |

## Analysis caching

The full analysis payload is computed from the rounds table and cached in the DO's memory keyed by `(source, max_round_id)`. Any insert invalidates it. That keeps the 177,905-round dataset snappy: first request computes, subsequent requests read the cache until new data lands.

## Frontend state

- **React Query** for everything server-side (keys like `["analysis", source, page]`), with interval refetching on live views.
- **Auth context** for the operator session (bearer token in `localStorage`, verified via `/api/v1/auth/me`).
- Command palette (⌘K) enumerates every nav destination + docs.

## Realtime

The live engine is client-driven by design: the console posts `feed/step` on an interval while live mode is on, and React Query invalidation repaints every open view. WebSocket upgrade paths are documented in the API reference as the upgrade path for multi-client push.
