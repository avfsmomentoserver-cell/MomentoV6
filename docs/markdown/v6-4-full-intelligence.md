# Momento v6.4 — Full Intelligence Platform

v6.4 changes three things. Charts now behave like TradingView. Every research surface can be filtered, scheduled and reads as a shape as well as a number. The system is realtime: every new round updates every screen, on top of scheduled deep computation, and an AI summary reads all the metrics.

This page is the reference for everything new. The honesty rules come first, because they govern every other section.

## Honesty rules

- Aviator rounds come from a provably-fair RNG. No engine in this platform can predict the next round better than the base rates over the long run, and every surface measures itself against a baseline so you can see that for yourself. Expect skill vs baseline to hover near 0.
- Reconstructed rounds carry no outcome information. They restore sequence continuity across session gaps, so window-based engines see a continuous tape instead of a jump. They are:
  - labelled `origin = reconstructed`;
  - faded or dashed in every view;
  - never scored by calibration or the shape ledger;
  - excluded from session rebuilds;
  - removable in one click.
  - Whether they are used as forecast context is a toggle, and the ledgers measure the effect.
- Named shapes, DNA patterns and vocabulary phrases are descriptions of the past. They are tested with Wilson intervals, KS and z tests, and multiple-testing counts (expected false positives) before they are presented as meaningful.

## Main dashboard (Command Center)

- **Forecast first.** The full-intelligence next-round forecast is the top-most panel. The AI forecast summary sits directly below it, followed by the other forecasts (chart prediction, accuracy engine, Moonshot, Mega pressure, full-range strip, ShapeShifters signal layer).
- **Rounds feed** (top right): a scrollable table of the latest 100 rounds with the Aviator colour scheme:
  - blue `rgb(52,180,255)` below 2×;
  - purple `rgb(145,62,248)` from 2× to below 10×;
  - pink `rgb(192,23,180)` from 10×.
  - Reconstructed and anchor rounds are labelled.
- **Realtime.** The shell polls `/api/v1/live/pulse` every 2.5 s. When the latest round or round count changes, every query on screen is invalidated and recomputed. The bottom-right badge shows the pulse.

## Two-tier computation

| Tier | When it runs | What it computes |
|---|---|---|
| Realtime | on every new round (cache keyed by max round id) | forecasts, counters, feed, stats, projections |
| Deep | scheduled jobs (Durable Object alarm, 2 min tick; local dev emulates every 5 s) | wide DNA scans, linguistics over full history, vocabulary discovery, shape ledger record/score, gap reconstruction, AI summary |

Realtime views read the latest deep result and layer fresh computation on top. For example, the live DNA chain is matched against the last scheduled wide scan, and the AI card summarises the latest forecast with the latest deep results.

### Scheduler (`/dashboard/scheduler`)

- Create, edit, enable or disable, run, and delete jobs. Each job has a kind, a JSON parameter block and an interval in minutes.
- DNA parameters:
  - `alphabet` (band | hue | binary | tempo), `kMin`/`kMax` (up to 12), `targetLo`/`targetHi` (any multiplier range) and `minSupport`;
  - optional range filters: `lastN`, `from`, `to`, `minX`, `maxX`, `session`.

| API | Purpose |
|---|---|
| `GET /api/v1/deep/jobs` | list jobs with `nextRunMs` |
| `POST /api/v1/deep/jobs` | create, or update when `id` is present |
| `POST /api/v1/deep/jobs/delete` | `{id}` |
| `POST /api/v1/deep/run` | `{id}` runs one job; `{}` runs every due job |
| `GET /api/v1/deep/result?job=` | latest result payload |

## Charts (TradingView-style, lightweight-charts v5)

`components/tv/TvChart.tsx` now powers Market, Momentum Lab, the consumer charts, MomentoFX and Chart Lab.

- **Chart types:** candles, Heikin-Ashi, bars, line, area; LOG scale; Aviator hue mode, which colours each bar by its round colour.
- **Indicators:** EMA 20, EMA 50, Bollinger Bands, volume, and RSI in its own pane.
- **Drawing tools:** trend line, horizontal line, rectangle, Fibonacci retracement, erase. Drawings are anchored to time and price, so they stay attached through zoom and pan. They are saved per chart in `localStorage` (`momento.tv.<key>`).
- **Navigation and export:** zoom in, zoom out, fit, reset, PNG snapshot, fullscreen, and an OHLC crosshair legend.
- **Projection overlay:** a p50 path with a p25–p75 fan, drawn past the last bar.

## ShapeShifter Darkboard (`/dashboard/darkboard`)

- **The path:** the cumulative log-excess over the last N rounds, \(\sum (\ln m_i - \mu)\), capped at 1000×.
- **Named shapes:** Spike & Fade, V-Rebound, Arch, Rising Staircase, Choppy Ascent, Sliding Ramp, Choppy Slide, Sawtooth Range, Flat Coil.
- **Projected next shape:** drawn as a fan from the k nearest historical analogues of the current path, with a flat baseline and beads for the implied rounds.
- **Current shape at five windows** (12 / 20 / 30 / 50 / 80) with a window-agreement count.
- **Shape atlas:** the history sampled every 5 rounds. For each shape it shows the share, P(next ≥2×) and P(pink within 10), each with its lift vs base.
- The classic darkboard (anatomy, Pareto, dry zones) is kept as a tab.

## Chart Lab (`/dashboard/chart-lab`)

A chart prediction is a named shape. Chart Lab draws it and then decomputes it into actual rounds.

- **Controls:** source, shape window, horizon and analogue count k.
- **Live chart:** each round is plotted as a point, with the projection overlay placed at each implied round's clock ETA.
- **Decomputed rounds table:** step, clock ETA from the fitted cadence \(\Delta t = a + b\ln m_{prev}\), p25/p50/p75 multiplier, P(≥2×), P(≥10×) and hue.
- **ETA tiles** for ≥2×, ≥10× and ≥100×: expected rounds vs the baseline median wait, and P(within horizon) vs baseline.
- **Walk-forward backtest:** past projections that use only prior rounds. It reports skill = 1 − MAE(model)/MAE(flat), IQR coverage (well calibrated is about 50%) and wins.
- **Live ledger:** the deep tier records one projection every 5 minutes and scores it once enough real rounds have arrived.

| API | Purpose |
|---|---|
| `GET /api/v1/shapes/project?window&horizon&k&source` | projection, decomputed rounds, ETAs, ledger |
| `GET /api/v1/shapes/backtest?window&horizon&n&source` | walk-forward replay |
| `GET /api/v1/shapes/gallery?follow&source` | current shapes and shape atlas |
| `GET /api/v1/shapes/ledger` | recorded / resolved / skill |

## DNA Hunter and Pattern DNA

- **DNA Hunter:** band alphabet, targeting ≥2×.
- **Pattern DNA:** hue alphabet, targeting pink (≥10×).
- Both run on the shared DNA lab and support:
  - alphabets: band (6 bands), hue (blue/purple/pink), binary (below / at-or-above a pivot) and tempo (hue × long-wait flag);
  - k range 2–12, any target range (`2-`, `10-100`, `-1.2`), minimum support, and range filters (last N, time window, multiplier bounds, session);
  - a verdict with the expected false-positive count, a by-k chart, over- and under-represented tables with Wilson intervals and z scores, the live chain matched now, and scheduled wide scans.
- `GET /api/v1/dna/scan`, `GET /api/v1/dna/live`.

## Linguistics and Vocabulary

- **Linguistics:** every round is a word, and the tape reads as sentences. The page shows:
  - word frequencies with outcome lift;
  - bigram and trigram grammar;
  - a sentiment / energy stream;
  - "tone" per session;
  - the current sentence;
  - the scheduled full-history result.
- **Vocabulary:** phrases are discovered by the deep job and evaluated on out-of-sample halves. Each shows support, hit rate, lift and a stability verdict. The formal registry (promote / deprecate) is a tab.

## Eagle Eye (`/dashboard/eagle-eye`)

V5 structure with the full round history.

- **Stat tiles:** totals, colour counts, max, and origin mix.
- **Filters:** three multiplier ranges, hue, ingest method, origin (observed / anchor / seeded / reconstructed), session, from–to time, page size, order, and auto refresh.
- **Views:** a 20-column Aviator-colour grid, or a table.
- **Paging** and fullscreen.
- **Export:** CSV or JSON of the full filtered set (`/api/v1/rounds/export`), or CSV of the current page.

## Investigation Suite (`/dashboard/investigation`)

- **Round:**
  - rarity (1-in-N, percentile, rank from top);
  - timing vs cadence;
  - dry run before the round;
  - session position;
  - DNA of the 6 rounds before;
  - what the engine forecast for the round (hit / near / miss);
  - 30-round context either side, as colours and as a sentence;
  - threshold counters;
  - nearest analogues and what followed them.
- **Range:** any slice vs full history. KS test, z tests for ≥2× and ≥10×, a metric delta table and the colour mix.
- **Gaps & reconstruction:** a gap timeline, estimated missing rounds, the plan, run and clear actions, and the forecast-context toggle.
- **Backtests:** the walk-forward bench.

| API | Purpose |
|---|---|
| `GET /api/v1/investigate/round?id=` | round forensics |
| `GET /api/v1/investigate/range?lastN&from&to&minX&maxX&session&source` | range tests |
| `GET /api/v1/investigate/gaps?minGapSec&limit` | session gaps per source |

## Session-gap reconstruction

1. Gaps are detected per source. A gap is at least `minGapSec` (default 120 s) between consecutive real rounds.
2. Gaps up to `maxGapHours` (default 8) are filled. The number of missing rounds comes from the source's fitted cadence.
3. Each fill's multiplier is drawn from the source's own empirical distribution with a fixed seed, so runs are reproducible.
4. Imported Top rounds are placed first as real anchors, and they cap how many extreme values a gap can contain.

| API | Purpose |
|---|---|
| `GET /api/v1/reconstruct/plan` | dry-run preview |
| `POST /api/v1/reconstruct/run` | insert labelled fills |
| `POST /api/v1/reconstruct/clear` | remove fills (optional `source`) |
| `GET /api/v1/reconstruct/status` | counts by origin |
| `POST /api/v1/reconstruct/config` | `{useInForecast}` |

## Seeding

### Top rounds (Spribe "Top" widget)

- Paste the widget HTML or text into Ingest → Top rounds import. The parser reads the X / Win / Rounds tabs with Day / Month / Year blocks. Each row's `DD.MM.YY HH:MM` time is converted from the widget timezone (default: browser offset; SAST = +120) to UTC.
- Preview first (`dryRun`), then import.
- Rows from the Rounds tab are placed as real rounds (`origin = anchor`) at mid-minute, unless a matching round already exists within ±90 s.
- All rows are stored in `top_rounds` as rarity caps.
- `POST /api/v1/seed/top-rounds {html|text, source, tzOffsetMin, scope?, anchor?, dryRun?}`

### Span seeder

- Use it for rounds you know by order only, such as the in-game history strip.
- They are spread between a start and an end timestamp using the fitted cadence, so longer flights take longer. They are stored as `origin = seeded`.
- `POST /api/v1/seed/span {text|multipliers, start, end, order, source, dryRun?}`

### .db import and priming

- SQLite `.db` files are imported in the browser with automatic schema detection: any multiplier column naming, percent-encoded values, epoch / Julian / ISO timestamps.
- After import, `POST /api/v1/seed/prime` runs automatically. It rebuilds sessions and runs the DNA, linguistics, vocabulary and shape jobs, so the imported history seeds every intelligence layer immediately.

## AI forecast summary (Entrim)

- A final summary that reads every metric:
  - the full-intelligence forecast and its candidates;
  - outlook, engine weights and skill vs baseline;
  - shape projection, ETAs and ledger;
  - DNA live matches and scheduled scans;
  - linguistics, pressure, Moonshot and the reconstruction share.
- The model receives this as structured JSON and must copy numbers and ETA strings verbatim. It is told to say plainly that the game is an RNG.
- It runs as a deep job (every 30 min by default) and on demand with the Re-analyse button.
- `GET /api/v1/ai/summary`, `POST /api/v1/ai/summary`.
- **Configuration:** Entrim is OpenAI-compatible, base URL `https://api.entrim.ai/v1`. The key is never stored in the repository.
  - Production: `wrangler secret put ENTRIM_API_KEY`.
  - Local: `ENTRIM_API_KEY=… node functions/local-dev.mjs`.
  - Alternatively, set `entrim_api_key` in Settings; it is masked on read.
  - `entrim_model` and `entrim_base_url` are optional settings.

## Running locally

```bash
cd functions && npm install
ENTRIM_API_KEY=sk-… node local-dev.mjs -p 8000 -d ./momento.sqlite
cd ../web-momento && npm install
EXPO_PUBLIC_RORK_FUNCTIONS_URL=http://localhost:8000 npm run dev
```

## Other new endpoints

| API | Purpose |
|---|---|
| `GET /api/v1/live/pulse` | latest id / count / signal for realtime invalidation |
| `GET /api/v1/rounds/page` | Eagle Eye paged + filtered history |
| `GET /api/v1/rounds/export?format=csv\|json` | full filtered export |
| `GET /api/v1/ai/metrics` | the exact metric bundle the AI summary receives |

## Round origins

| origin | meaning | scored | in sessions |
|---|---|---|---|
| observed | collected / pushed / imported | yes | yes |
| anchor | placed from a Top-rounds import | yes | yes |
| seeded | spread by the span seeder | yes | yes |
| reconstructed | gap fill (no information) | never | no |
