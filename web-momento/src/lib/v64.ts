// v6.4 client types + helpers (Aviator palette, projection → chart points).
import { api, qs } from "@/lib/api";

export const AV = { blue: "rgb(52, 180, 255)", purple: "rgb(145, 62, 248)", pink: "rgb(192, 23, 180)" } as const;
export const hueOf = (m: number) => (m < 2 ? "blue" : m < 10 ? "purple" : "pink") as "blue" | "purple" | "pink";
export const hueColor = (m: number) => AV[hueOf(m)];
export const ORIGIN_LABEL: Record<string, string> = { observed: "observed", anchor: "top-anchor", seeded: "seeded", reconstructed: "reconstructed" };

export interface ProjRound { step: number; etaMs: number; eta: string; p25: number; p50: number; p75: number; pGe2: number; pGe10: number; hue: string }
export interface ShapeProjection {
  name: string;
  currentShape: { name: string; family?: string; description?: string; path: number[] };
  drift: number;
  confidence: number;
  analogues: number;
  window: number;
  horizon: number;
  path: { step: number; p25: number; p50: number; p75: number }[];
  family?: string;
  description?: string;
  anchorTsMs?: number;
  baselinePath: number[];
  rounds: ProjRound[];
  etas: { threshold: number; expectedRounds: number | null; baselineRounds: number; meanWait: number; etaMs: number | null; eta: string | null; pWithinHorizon: number; baselineWithinHorizon: number }[];
  honesty: string;
  cadence?: { a: number; b: number; medianMs: number };
  tail?: { id: number; ts: string; multiplier: number; tsMs?: number }[];
  ledger?: { total: number; resolved: number; pending: number; maeModel: number | null; maeBase: number | null; skill: number | null; coverage: number | null; byName: { name: string; n: number; skill: number | null }[]; recent: { id: number; anchor_ts_ms: number; name: string; skill: number | null; coverage: number | null; resolved_ms: number | null }[] };
}

export const getProjection = (p: { window?: number; horizon?: number; k?: number; source?: string | null }) =>
  api.get<ShapeProjection>(`/api/v1/shapes/project${qs({ window: p.window, horizon: p.horizon, k: p.k, source: p.source ?? undefined })}`);

/** Decomputed projected rounds → chart projection points (unix seconds). */
export const toProjectionPoints = (p?: ShapeProjection | null) =>
  (p?.rounds ?? []).map((r) => ({ t: Math.floor(r.etaMs / 1000), p25: r.p25, p50: r.p50, p75: r.p75 }));
