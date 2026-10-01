// functions/docs.ts — documentation manifest served by the API.
// The full markdown content ships inside the web bundle (Documentation Center);
// the API exposes the authoritative index so any client can discover it.

export interface DocMeta {
  slug: string;
  title: string;
  section: string;
  summary: string;
  audience: "operator" | "developer" | "client";
}

export const DOCS: DocMeta[] = [
  { slug: "v6-5-platform-book", title: "v6.5 Platform Book Edition", section: "Start here", summary: "Everything new in v6.5: all 38 Platform Book features (proof, lab, time machine, ETA, decisions, fairness, alerts, Ask Momento), Phase 0 security and the bundled book.", audience: "operator" },
  { slug: "v6-4-full-intelligence", title: "v6.4 Full Intelligence Platform", section: "Start here", summary: "Everything new in v6.4: TradingView charts, realtime + deep tiers, Scheduler, ShapeShifter Darkboard, Chart Lab, DNA/linguistics filters, Eagle Eye, Investigation, reconstruction, Top-round seeding and the Entrim AI summary.", audience: "operator" },
  { slug: "overview", title: "Platform Overview", section: "Start here", summary: "What Momento v5 is, the pipeline, and how the coordinated platform is organized.", audience: "client" },
  { slug: "architecture", title: "Architecture", section: "Start here", summary: "Worker + Durable Object SQLite backend, web console, data flow, and module boundaries.", audience: "developer" },
  { slug: "api-reference", title: "API Reference", section: "Developer", summary: "Every backend endpoint: method, path, params, response shape.", audience: "developer" },
  { slug: "data-model", title: "Data Model", section: "Developer", summary: "All tables, columns, indexes, and the sessionization rules.", audience: "developer" },
  { slug: "ingest-sources", title: "Ingest & Sources", section: "Features", summary: "REST push, bulk import, the provably-fair live engine, and source management.", audience: "operator" },
  { slug: "analysis-engines", title: "Analysis Engines", section: "Features", summary: "Ladders, resistance, streaks, bands, distribution, gaps, house edge, Moonshot, pressure.", audience: "operator" },
  { slug: "fx-analysis-lab", title: "FX Analysis Lab", section: "Features", summary: "The v6 forex toolset: correlation, volatility regimes, order-flow imbalance, support density, breakout, mean reversion, trend quality, event risk, divergence — all feeding the pipeline.", audience: "operator" },
  { slug: "accuracy-engine", title: "Accuracy Engine v2", section: "Features", summary: "Multi-window scheduled predictions verified against history; accumulative Brier skill at unlimited scale; earned engine weights.", audience: "operator" },
  { slug: "momentum-lab", title: "Momentum Lab", section: "Features", summary: "Time-bucketed hit points with mega-hit splitting, anchor structures and their direction effect, gap momentum per range, moonshot condition research, range-filtered prediction, the inverted lens, and continuous assessment.", audience: "operator" },
  { slug: "source-bundle", title: "Source Bundle & Step Docs", section: "Delivery", summary: "The one-click bundle: full source, per-step build documentation, checksums — refreshed on every build and served from /downloads.", audience: "developer" },
  { slug: "build-walkthrough", title: "Build Walkthrough", section: "Delivery", summary: "Every build step documented — purpose, files, and verification — generated automatically on each build.", audience: "developer" },
  { slug: "full-intelligence", title: "Full Intelligence Forecast", section: "Features", summary: "The V5.01-backtd next-round engine (Markov states, percentiles, DNA, ladders, exhaustion, ML) fused with every v6 engine; mixture weights earned on a calibration ledger; confidence earned by out-of-sample skill.", audience: "operator" },
  { slug: "forecast-studio", title: "Forecast Studio & Range Lab", section: "Features", summary: "Honest walk-forward evaluation, Wilson CIs, Brier scoring, earned weighting.", audience: "operator" },
  { slug: "shape-darkboard", title: "ShapeShifters & Darkboard", section: "Features", summary: "Curve anatomy, Pareto fit, dry zones, ETA bands, trajectory groups.", audience: "operator" },
  { slug: "linguistics-vocabulary", title: "Linguistics & Vocabulary", section: "Features", summary: "Eight-layer semantic tokens and the vocabulary learning lifecycle.", audience: "operator" },
  { slug: "orchestrator-autopilot", title: "Orchestrator & Autopilot", section: "Features", summary: "Decision settings, mistake prevention, and the paper-P&L ledger.", audience: "operator" },
  { slug: "market-charts", title: "Market & Charts", section: "Features", summary: "Candles, points, session phases, and the FX surfaces.", audience: "operator" },
  { slug: "keyboard-shortcuts", title: "Keyboard Shortcuts", section: "Using the app", summary: "Command palette, navigation, and live-mode controls.", audience: "client" },
  { slug: "parity-report", title: "Parity & Verification Report", section: "Delivery", summary: "Feature-by-feature matrix vs the two previous archives, with per-link status.", audience: "client" },
  { slug: "calibration-report", title: "Calibration & Data Provenance", section: "Delivery", summary: "The merged 177,905-round dataset, recomputed constants, and match checks.", audience: "developer" },
  { slug: "changelog", title: "Changelog", section: "Delivery", summary: "Versioned release notes for the coordinated platform.", audience: "client" },
  { slug: "decision-log", title: "Decision Log", section: "Delivery", summary: "Every architectural decision and why it was made.", audience: "developer" },
  { slug: "runbook", title: "Operations Runbook", section: "Delivery", summary: "Deploy, seed, back up, export/import, and troubleshoot the platform.", audience: "developer" },
];

export const BUILD_STEPS = [
  { step: 1, title: "Architecture & configuration" },
  { step: 2, title: "Database & persistence" },
  { step: 3, title: "Linguistics layer" },
  { step: 4, title: "Analysis engine" },
  { step: 5, title: "Forecast engine" },
  { step: 6, title: "Ingest & live engine" },
  { step: 7, title: "Plugin registry" },
  { step: 8, title: "Orchestrator & autopilot" },
  { step: 9, title: "API & WebSocket" },
  { step: 10, title: "Frontend foundation" },
  { step: 11, title: "Operator console" },
  { step: 12, title: "Consumer app" },
  { step: 13, title: "Deployment & handover" },
  { step: 14, title: "FX analysis engines (v6)" },
  { step: 15, title: "Accuracy Engine v2 + scheduling" },
  { step: 16, title: "Source bundle & step-doc pipeline" },
];

/** Reference constants from the merged dataset (DATA_CALIBRATION.md). */
export const CALIBRATION_REFERENCE = {
  dataset: { rounds: 177905, sessions: 33, mean: 10.604, median: 2.01, max: 58938.65 },
  exceedance: {
    "1.5": 66.4281, "2": 50.4651, "3": 33.1536, "5": 18.6779, "10": 9.2167,
    "25": 3.6834, "50": 1.8763, "100": 0.941, "250": 0.3654, "500": 0.1748, "1000": 0.0922,
  },
  tail: { a: 0.9497, b: 1.006, from: 25 },
  postHigh2x: 49.4,
};

/** Reference range-lab verdicts (RANGE_LAB_REPORT.md). */
export const RANGE_LAB_REFERENCE = [
  { threshold: 1.2, rate: 81.9578, etaMed: 1, etaP90: 2, brierBase: 0.15365, lift: -0.07, verdict: "rejected" },
  { threshold: 1.5, rate: 66.4281, etaMed: 1, etaP90: 3, brierBase: 0.22811, lift: -0.08, verdict: "rejected" },
  { threshold: 2, rate: 50.4651, etaMed: 1, etaP90: 4, brierBase: 0.2505, lift: -0.32, verdict: "rejected" },
  { threshold: 3, rate: 33.1536, etaMed: 2, etaP90: 6, brierBase: 0.21843, lift: -0.88, verdict: "rejected" },
  { threshold: 5, rate: 18.6779, etaMed: 4, etaP90: 11, brierBase: 0.15583, lift: -0.15, verdict: "rejected" },
  { threshold: 10, rate: 9.2167, etaMed: 7, etaP90: 23, brierBase: 0.08722, lift: -0.1, verdict: "rejected" },
  { threshold: 20, rate: 4.6058, etaMed: 15, etaP90: 47, brierBase: 0.04559, lift: -0.09, verdict: "rejected" },
  { threshold: 50, rate: 1.8763, etaMed: 34, etaP90: 119, brierBase: 0.01927, lift: -0.01, verdict: "rejected" },
  { threshold: 100, rate: 0.941, etaMed: 70, etaP90: 236, brierBase: 0.00967, lift: -0.01, verdict: "rejected" },
  { threshold: 250, rate: 0.3654, etaMed: 186, etaP90: 637, brierBase: 0.0037, lift: 0.0, verdict: "rejected" },
  { threshold: 500, rate: 0.1748, etaMed: 385, etaP90: 1275, brierBase: 0.00189, lift: 0.0, verdict: "rejected" },
  { threshold: 1000, rate: 0.0922, etaMed: 612, etaP90: 2431, brierBase: 0.00105, lift: 0.0, verdict: "rejected" },
  { slug: "book-00-readme", title: "The Momento Platform Book", section: "Platform Book", summary: "The engineering book for the Momento Platform, also called AVFS · Momento Core. It is written for the people who build it.", audience: "developer" },
  { slug: "book-01-platform-overview", title: "01 · Platform Overview", section: "Platform Book", summary: "Momento, also called AVFS · Momento Core, is an analytics and forecasting platform for crash-curve round data. The reference source is Aviator. Each round produces a single number: the multiplier m ≥ ", audience: "developer" },
  { slug: "book-02-repo-branch-atlas", title: "02 · Repository & Branch Atlas", section: "Platform Book", summary: "This atlas covers every repository and branch in avfsmomentoserver-cell, as of 26 Sep 2026. Harvest rates how much a branch should feed the unified platform (Chapter 19): ★★★ = core source of truth, ★", audience: "developer" },
  { slug: "book-03-ingestion", title: "03 · Data Collection & Ingestion", section: "Platform Book", summary: "- Multiplier keys: multiplier, value, crashpoint, result, payout.", audience: "developer" },
  { slug: "book-04-storage", title: "04 · Storage & Data Model", section: "Platform Book", summary: "- Tape: rounds, sessions, sources, toprounds, ingestlog", audience: "developer" },
  { slug: "book-05-linguistics", title: "05 · MomentoLinguistics", section: "Platform Book", summary: "Linguistics is Momento's most distinctive idea: a controlled vocabulary between the raw tape and every engine, chart and sentence. This chapter documents all eight layers as implemented, the two band ", audience: "developer" },
  { slug: "book-06-analysis-engines", title: "06 · Analysis Engines", section: "Platform Book", summary: "Analysis engines describe the tape. Forecast engines (Ch 07) predict it. Everything below takes rounds in and returns a report out. The engines are pure functions, so they port easily between TS and P", audience: "developer" },
  { slug: "book-07-forecast-engines", title: "07 · Forecast Engines & Full Intelligence", section: "Platform Book", summary: "This is the heart of Momento. The primary sources are:", audience: "developer" },
  { slug: "book-08-accuracy", title: "08 · Accuracy & Verification", section: "Platform Book", summary: "Momento's most valuable asset is its accuracy ledger. Every forecast is stored before its outcome is known, then scored for ever. This chapter covers:", audience: "developer" },
  { slug: "book-09-momentum-terminal", title: "09 · Momentum Lab & the Trading Terminal", section: "Platform Book", summary: "This chapter covers the \"market\" view of the tape:", audience: "developer" },
  { slug: "book-10-survival-eta", title: "10 · Survival, ETA & Moonshot", section: "Platform Book", summary: "\"When will the next 10× / 50× / 100× arrive?\" is the question users ask most. Momento answers it in at least seven places, with three different definitions of \"pressure\". This chapter:", audience: "developer" },
  { slug: "book-11-decision-autopilot", title: "11 · Decisions, Autopilot & Bankroll", section: "Platform Book", summary: "This chapter covers the layer that turns forecasts into actions: instructions, paper decisions, stake sizes and session limits. It:", audience: "developer" },
  { slug: "book-12-research-suite", title: "12 · Research & Investigation Suite", section: "Platform Book", summary: "Momento's R&D engine decides which ideas get promoted into production engines. The repos already contain one of the most carefully built pieces of the platform: the edge-falsification suite on momento", audience: "developer" },
  { slug: "book-13-fairness", title: "13 · Fairness Verification", section: "Platform Book", summary: "Fairness verification is the one area where Momento can give users an exact answer: whether a round was produced by the committed seed under the stated algorithm. This chapter:", audience: "developer" },
  { slug: "book-14-knowledge-core", title: "14 · Momento Knowledge Core (MKI / MKC)", section: "Platform Book", summary: "MKI (package name mkc) is Momento's memory of what is known and why. This book is effectively a manual MKI extraction. This chapter:", audience: "developer" },
  { slug: "book-15-ai-layer", title: "15 · AI Layer: STRIDE, TSFMs & Agents", section: "Platform Book", summary: "- learned forecasters: foundation models, fine-tuning and STRIDE;", audience: "developer" },
  { slug: "book-16-frontend", title: "16 · Front-end & UX", section: "Platform Book", summary: "This chapter maps what exists in the v6.3 console at file level and records three front-end findings: polling, token storage and the build plugin. It then specifies:", audience: "developer" },
  { slug: "book-17-infra-security", title: "17 · Infrastructure, Security & Ops", section: "Platform Book", summary: "- the v6.3 auth and route protection, read line by line in functions/core.ts;", audience: "developer" },
  { slug: "book-18-feature-catalogue", title: "18 · Feature Invention Catalogue", section: "Platform Book", summary: "There are 38 features here. Each one is built from parts that already exist in the repos, uses the technique from its subsystem chapter, and ships with a measurement plan, so the platform's own ledger", audience: "developer" },
  { slug: "book-19-blueprint", title: "19 · Unified Implementation Blueprint", section: "Platform Book", summary: "┌────────────────────── Cloudflare ──────────────────────┐", audience: "developer" },
  { slug: "book-app-a-data-model", title: "Appendix A · Data Model Reference", section: "Platform Book", summary: "This appendix lists the 25 tables of the v6.3 Durable Object store. Source: MomentoV5@v6.3-full-intelligence:functions/core.ts. Columns are copied from the CREATE TABLE statements. Proposed additions ", audience: "developer" },
  { slug: "book-app-b-api", title: "Appendix B · API Reference", section: "Platform Book", summary: "Paths were extracted from the router source. Methods follow the docs where they are documented. For example, accuracy/tick, accuracy/verify and intelligence/recalibrate are POST.", audience: "developer" },
  { slug: "book-app-c-glossary", title: "Appendix C · Glossary", section: "Platform Book", summary: "For a no-math companion, see InvestigationSuite@decomputation:docs/newbie-glossary.md.", audience: "developer" },
  { slug: "book-app-d-evidence-ledger", title: "Appendix D · Evidence Ledger", section: "Platform Book", summary: "These are measured results recorded in the repositories, quoted as documented. Use them as priors and baselines when you invent or evaluate features. Every new feature should add a row here (or, bette", audience: "developer" },
  { slug: "book-app-e-sources", title: "Appendix E · Sources", section: "Platform Book", summary: "These are the external technical references cited in this book, regenerated from every chapter link. Internal sources are cited inline as repo@branch:path.", audience: "developer" },
];
