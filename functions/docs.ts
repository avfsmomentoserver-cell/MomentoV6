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
];
