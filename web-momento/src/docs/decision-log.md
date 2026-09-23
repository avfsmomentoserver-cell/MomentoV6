# Decision Log

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | **One backend: Cloudflare Worker + Durable Object SQLite** instead of a separate Postgres service. | The platform is workspace-scoped (one dataset, one operator team); a single strongly-consistent actor owning the relational store matches the original FastAPI+SQLite design 1:1, keeps every query server-side, and adds zero moving parts. The API boundary makes a Supabase Postgres swap a backend-only change later. |
| 2 | **Rebuild in the archived stack's shape (pure-function analysis core), not a rewrite of the math.** | The archive's math was verified over 177,905 rounds. Porting the contracts (Round model, analysis payloads, honesty ledger) preserves that verification instead of gambling it. |
| 3 | **Keep SQLite as the database engine** (inside the DO). | Same engine as the previous builds; the dedupe unique index, WAL-style durability semantics and window-function reports port directly. |
| 4 | **Sessionization = 30-minute gaps**, rebuilt server-side, incremental for small live batches. | The investigationsuite methodology from the archives; keeps session IDs stable and the sessions table queryable. |
| 5 | **Provably-fair live engine instead of scraping a real site.** | The original core shipped the same design ("no mock data — every number computed from rounds actually in the database"); a hash-chain engine is verifiable, deterministic, and safe. Seeded real data covers the statistical surfaces. |
| 6 | **Forecast honesty ledger kept as a first-class table.** | Stored-before-landing + Brier scoring is the platform's core trust property; nothing can be back-dated. |
| 7 | **Earned-weight conditional models.** | The walk-forward verdict (no model beats baseline at this sample size) ships *as a feature*, not a bug report — Range Lab + Investigation make the measurement inspectable. |
| 8 | **Graphite Aurora theme.** | Operator console: dense data needs a dark, low-chroma canvas with one electric accent; cyan carries "signal", semantic tones (emerald/amber/rose) carry states. Inter + JetBrains Mono for data. |
| 9 | **Client-driven live loop** (console posts feed/step on an interval) instead of server timers/WebSockets. | Observable, works everywhere, no idle DO timers; WebSocket push is a documented upgrade path on the same endpoints. |
| 10 | **Docs as markdown in the app bundle + manifest in the API.** | The Documentation Center renders from the same files that ship inside the source bundle — docs can never drift from the download. |
| 11 | **Versioned release bundles registered server-side.** | The Download button always serves the running version; scripts can verify via `/releases/latest`. |
| 12 | **Aliases preserved** (`/dashboard/crash-studio`, `/dashboard/charts`, `/dashboard/source`, `/app/auth`). | Old bookmarks from both archives keep working — zero dead links was the acceptance contract. |
