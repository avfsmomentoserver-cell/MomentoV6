# 16 · Front-end & UX

Momento has four front-ends:
- the operator console (V5 → v6.3);
- the consumer app;
- the ShapeShifters terminal;
- the MomentoFX MT5-style terminal.

This chapter maps what exists in the v6.3 console at file level and records three front-end findings: polling, token storage and the build plugin. It then specifies:
- the information architecture;
- real-time delivery with a latency budget;
- the forecast card standard;
- a chart layer that follows the Ch 09 contract.

## 16.1 What exists
### 16.1.1 v6.3 console (`MomentoV5@v6.3-full-intelligence:web-momento/`)
- **Stack:** Vite + React 19, Tailwind with the "Graphite Aurora" theme, shadcn/ui (`components/ui/*`), React Query, Recharts and a ⌘K `CommandPalette.tsx`.
- **Shell:** `components/layout/{AppShell, Sidebar, TopBar}.tsx`.
- **Routes:** `App.tsx` declares 57 routes.
- **Pages (`src/pages/dashboard/`):** AccuracyEngine, AnalysisLab, Autopilot, BirdEye, BuildSteps, Calibration, CommandCenter (516 lines), Darkboard, DnaHunter, Docs, Downloads, EagleEye, ForecastStudio, FullIntelligence (411), Ingest, Investigation, LadderDash, Linguistics, Market, MegaPressure, MomentoFX, MomentoFXV2, MomentumLab (325), MoonshotFinder, PatternDna, RangeLab, Resistance, RoundTesting, Settings, Sources, Users, Vocabulary.
- **Consumer app (`src/pages/app/`):** Today, ProPredictions, AppCharts, Premium.
- **Other pages:** Landing, Login, Index, Inventory, Orchestrator.
- **Charts (`components/charts.tsx`, 134 lines):** memoised Recharts wrappers: `SparkArea`, `TrendLine` and `MultiLine` (both with log y-scale), `CatBars`, `PointsChart` and `Candles`.
- **API client (`lib/api.ts`):**
  - `BASE = EXPO_PUBLIC_RORK_FUNCTIONS_URL ?? "https://prosync-backend.rork.app"`;
  - the bearer token is stored in browser local storage under the key `momento.token`;
  - every response uses the `{ok, data} | {ok:false, error}` envelope;
  - `qs()` builds query strings.
- **In-app docs:** `docs/generated.ts`, 23 markdown docs compiled in, including the API reference, which lists about 110 endpoints under `/api/v1/*`.

### 16.1.2 Live loop (by design)
`docs/decision-log.md` #9: "Client-driven live loop (console posts feed/step on an interval) instead of server timers/WebSockets. Observable, works everywhere, no idle DO timers; WebSocket push is a documented upgrade path." Views repaint through React Query invalidation. In v6.3.0 the feed endpoints (`/feed/start`, `/feed/step`, `/feed/verify`) return 410 "feed engine disabled", so live data now arrives only through ingest, and the console sees it only when a poll fires.

### 16.1.3 Other front-ends
- **ShapeShifters terminal:** Accuracy, Bankroll, EV, Exceedance, Fairness, Phases, Randomness, Responsible, Skill, Strategy, Windows, BacktestLab and FullForecast. It has an EMA headline and a unified forecast dashboard (`ShapeShifters@main`), and ChartLab's six-view contract (Ch 09).
- **MomentoFX:** an MT5-style terminal with engine panels (Ch 09).
- **momento-core3 vibe branches:** fairness visualisations.

## 16.2 Findings
- **U1 · Polling fan-out.**
  - The console declares **58 `refetchInterval`** timers. For example, CommandCenter and FullIntelligence poll at 10 s and 20 s, MomentumLab at 15 s and 20 s ×2, and AccuracyEngine at 15 s.
  - Each open tab polls on its own.
  - Result: data can be up to 20 s old, and the request count grows with tabs × views. This conflicts with the Ch 19 latency budget (≤ 250 ms p95 from ingest to a new forecast on screen).
- **U2 · Token in browser local storage.** Any script running on the origin can read it, and the Worker's CORS is `*` (Ch 17). Move to an **HttpOnly, Secure, SameSite=Strict cookie** with a CSRF token for state-changing calls, or keep the bearer token in memory only with a short-lived refresh cookie.
- **U3 · Silent build step.** `vite.config.ts` runs `scripts/build-source-bundle.mjs` and `generate-docs.mjs` on every production build, zipping the **full platform source** into `public/downloads`. The first script is **not present** in the branch, and the `catch` only prints `source-bundle step skipped`. Two consequences:
  - the Download Source button can point to a stale or missing file;
  - if the script is restored, it would publish the entire source, and any committed secret with it, from the public web root.

  Keep the bundle behind operator auth. Build it in CI from a clean checkout with a secret scan, not from the working tree.
- **U4 · Too many screens.** About 35 screens across products, with overlapping content (DnaHunter / PatternDna, MomentoFX / MomentoFXV2, BirdEye / EagleEye). Users cannot tell which number is authoritative.

## 16.3 Reference design
### 16.3.1 Information architecture
Collapse everything into **five workspaces**. Old screens become tabs, and duplicates are merged:

| Workspace | Tabs | Replaces |
|---|---|---|
| **Now** | Command Center, Full Intelligence, ETA Board (F-26), Explain (F-35) | CommandCenter, FullIntelligence, MegaPressure, MoonshotFinder |
| **Terminal** | Charts (six views), Momentum, FX engines, Replay (F-24), Drawn predictions (F-22) | Market, MomentumLab, MomentoFX/V2, LadderDash, Resistance, Darkboard |
| **Proof** | Accuracy, Reliability Studio (F-17), Decision Ledger (F-30), Fairness Console (F-36), Track record (F-18) | AccuracyEngine, Calibration, RangeLab, Autopilot history |
| **Lab** | Engine Workbench (F-09), Experiment Registry (F-34), Backtest Lab, Dictionary (F-06), DNA | AnalysisLab, Investigation, DnaHunter + PatternDna, Linguistics + Vocabulary, RoundTesting |
| **Ops** | Ingest, Sources, Tape Integrity (F-01), Plugins, Users, Settings, Build Steps, Alerts (F-38) | Ingest, Sources, Inventory, Settings, Users, BuildSteps, BirdEye + EagleEye |

The consumer app keeps four tabs: Today, Predictions, Charts, Premium. Every prediction shows its earned tier and track record.

### 16.3.2 Real-time delivery
Replace polling with **push** from the per-source Durable Object (Ch 03).
- **Transport:** WebSockets with the **Hibernation API**, so clients stay connected while the DO is evicted from memory when idle ([DO WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/); [hibernation example](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/)).
- **Fallback:** SSE for simple consumers ([MDN SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)). The Express `avfs-backend` already has SSE broadcast code worth reusing.
- **Protocol:**
```ts
type Msg =
  | { t: "round";      seq: number; source: string; round: RoundV1 }
  | { t: "forecast";   seq: number; source: string; forecast: ForecastV1 }      // Ch 07 contract
  | { t: "resolution"; seq: number; source: string; forecastId: string; outcome: number; score: number }
  | { t: "alert";      seq: number; alert: AlertV1 }
  | { t: "snapshot";   seq: number; source: string; state: AnalysisSnapshot };  // on (re)connect
// client → server
type Hello = { t: "hello"; sources: string[]; lastSeq?: number };
```
- **Resume:** the client sends `lastSeq`. The DO replays from its ring buffer (the last 1,000 messages), or sends a `snapshot` if the gap is too large.
- **React Query integration:** one socket per tab. Each message calls `queryClient.setQueryData` on the matching key, so existing components keep working, and `refetchInterval` is removed. Polling remains only as a degraded mode when the socket is down, at 30 s with a status banner.

```ts
function useLiveFeed(sources: string[]) {
  const qc = useQueryClient();
  useEffect(() => {
    let seq = seqStore.get(), ws: WebSocket, retry = 0, stop = false;
    const open = () => {
      ws = new WebSocket(`${WS_BASE}/live`);
      ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ t: "hello", sources, lastSeq: seq })); };
      ws.onmessage = (e) => {
        const m: Msg = JSON.parse(e.data); seq = m.seq; seqStore.set(seq);   // per-tab store
        if (m.t === "round") qc.setQueryData(["rounds", m.source], (old?: RoundV1[]) => [m.round, ...(old ?? [])].slice(0, 2000));
        if (m.t === "forecast") qc.setQueryData(["forecast", m.source], m.forecast);
        if (m.t === "snapshot") qc.setQueryData(["analysis", m.source], m.state);
      };
      ws.onclose = () => { if (!stop) setTimeout(open, Math.min(30000, 500 * 2 ** retry++)); };  // backoff
    };
    open(); return () => { stop = true; ws?.close(); };
  }, [sources.join(",")]);
}
```

### 16.3.3 Latency budget: ingest to forecast on screen ≤ 250 ms p95
| Stage | Budget |
|---|---|
| Collector → Worker ingest (network) | 60 ms |
| Validation + dedupe + insert (Ch 03) | 15 ms |
| Incremental analysis `applyRound` (Ch 09) | 20 ms |
| Engines + mixture (Ch 07), cached heavy engines | 40 ms |
| Broadcast to sockets | 15 ms |
| Network to client | 60 ms |
| React render (memoised charts, no layout thrash) | 40 ms |

Measure it with `round.ts_ms`, `forecast.created_ms` and a client beacon at render (`performance.now()` mapped to server time using the socket's clock offset). Report p50 and p95 per source on the Ops workspace.

### 16.3.4 Forecast card standard
Every forecast anywhere is rendered by one component:
```ts
interface ForecastCardProps {
  forecast: ForecastV1;          // expected, range, reach, bands (Ch 07)
  tier: "LOW" | "MEDIUM" | "HIGH";  // earned (Ch 08 §8.4.4), never self-reported
  skill: { value: number; lo: number; hi: number; n: number; baseline: string };
  explainId?: string;            // opens F-35
  ledgerId: string;              // forecast row id
}
```
- **Headline:** expected value, range and reach probability.
- **Tier chip:** a tooltip shows the lower CI bound that earned it.
- **Skill line:** "skill vs base rate over last N".
- **"Why" chip:** opens the decomposition (Ch 12, F-35).
- **Footer:** timestamp and forecast id, linking to the ledger row.

No other component may show a probability, so no screen can display an unscored number.

### 16.3.5 Charts
- Keep Recharts for small panels.
- Use a canvas-based library for the terminal. Lightweight Charts handles candles and markers at high point counts ([TradingView Lightweight Charts](https://tradingview.github.io/lightweight-charts/)).
- Implement ChartLab's six-view contract (Ch 09) as one `<SeriesChart view=…>`, fed by incremental updates (`series.update(bar)`) rather than a full re-render.
- Draw predictions (F-22) as an overlay layer that records the drawing into a forecast row.

### 16.3.6 Design tokens
Keep Graphite Aurora. Map the Linguistics band colours (`BANDS[].color`) to CSS variables (`--band-1…--band-6`), so a band has the same colour on every screen and in every product. Use one number format module (`lib/format.ts`): multipliers with 2 decimals and "×", probabilities with 1 decimal and "%", and skill with a sign.

### 16.3.7 Accessibility and performance
- Charts get a table alternative, colour is never the only encoding, and live regions announce new rounds politely.
- Code-split by workspace.
- The first contentful paint target for the Now workspace is < 1.5 s on mid-range mobile.

## 16.4 Tests
| Test | Assertion |
|---|---|
| `no_polling` | No `refetchInterval` below 30 s in `src/` (lint rule) |
| `ws_resume` | Disconnect for 10 messages, reconnect with lastSeq, and state equals the uninterrupted state |
| `card_only` | Lint: probability formatting is only used inside `ForecastCard` |
| `latency_p95` | Synthetic ingest → render p95 ≤ 250 ms in staging |
| `token_not_in_storage` | After login, browser storage has no auth token (U2) |
| `bundle_auth` | `/downloads/*` returns 401 without an operator session (U3) |

## 16.5 Measurement
- Latency p50 and p95;
- socket reconnect rate;
- requests per active user per minute (should drop by an order of magnitude after U1);
- workspace usage share;
- Core Web Vitals.

## 16.6 Features
- **UI-heavy features:** F-15, F-17, F-21–F-26, F-35 and F-36 (Ch 18).
- **New: F-38 Alerts Center.** Users set rules on any engine output, delivered by push, email or Telegram. It uses the `alerts` table, and each alert links to the forecast card that triggered it.
