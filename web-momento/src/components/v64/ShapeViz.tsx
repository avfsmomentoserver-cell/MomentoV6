// ShapeShifter visuals: named shapes drawn as paths, projection drawn as a
// fan (p25–p75) with the median path, the flat no-drift baseline, and the
// decomputed rounds as Aviator-coloured beads along the projection.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Shapes } from "lucide-react";
import { AV, getProjection, type ShapeProjection } from "@/lib/v64";
import { cn } from "@/lib/utils";

const HUE: Record<string, string> = { blue: AV.blue, purple: AV.purple, pink: AV.pink };

export function ShapeSketch({
  p,
  width = 640,
  height = 220,
  showBeads = true,
  showAxis = true,
  className,
}: {
  p: ShapeProjection;
  width?: number;
  height?: number;
  showBeads?: boolean;
  showAxis?: boolean;
  className?: string;
}) {
  const hist = p.currentShape?.path ?? [];
  const proj = p.path ?? [];
  const total = hist.length + proj.length;
  if (!hist.length) return null;
  const all = [...hist, ...proj.flatMap((x) => [x.p25, x.p75]), ...(p.baselinePath ?? [])];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = 14;
  const X = (i: number) => pad + (i / Math.max(1, total - 1)) * (width - pad * 2);
  const Y = (v: number) => pad + (1 - (v - lo) / Math.max(1e-6, hi - lo)) * (height - pad * 2);
  const h0 = hist.length - 1;
  const histD = hist.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const last = hist[h0];
  const fanTop = [`M${X(h0)},${Y(last)}`, ...proj.map((q, i) => `L${X(h0 + i + 1).toFixed(1)},${Y(q.p75).toFixed(1)}`)];
  const fanBot = [...proj].reverse().map((q, i) => `L${X(h0 + proj.length - i).toFixed(1)},${Y(q.p25).toFixed(1)}`);
  const fanD = `${fanTop.join(" ")} ${fanBot.join(" ")} L${X(h0)},${Y(last)} Z`;
  const medD = [`M${X(h0)},${Y(last)}`, ...proj.map((q, i) => `L${X(h0 + i + 1).toFixed(1)},${Y(q.p50).toFixed(1)}`)].join(" ");
  const baseD = [`M${X(h0)},${Y(last)}`, ...(p.baselinePath ?? []).map((v, i) => `L${X(h0 + i + 1).toFixed(1)},${Y(v).toFixed(1)}`)].join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn("h-auto w-full", className)} role="img" aria-label={`${p.name} projection`}>
      <defs>
        <linearGradient id="shape-hist" x1="0" x2="1">
          <stop offset="0%" stopColor={AV.blue} stopOpacity="0.5" />
          <stop offset="100%" stopColor={AV.purple} />
        </linearGradient>
      </defs>
      {showAxis && (
        <>
          <line x1={X(h0)} x2={X(h0)} y1={pad / 2} y2={height - pad / 2} stroke="rgba(148,163,184,0.35)" strokeDasharray="3 3" />
          <text x={X(h0) + 4} y={pad} fontSize="10" fill="rgba(148,163,184,0.8)">now</text>
          <text x={pad} y={height - 3} fontSize="9.5" fill="rgba(148,163,184,0.6)">cumulative log-excess over {hist.length - 1} rounds</text>
        </>
      )}
      <path d={fanD} fill="rgba(255,213,79,0.14)" stroke="none" />
      <path d={baseD} fill="none" stroke="rgba(148,163,184,0.55)" strokeWidth="1.2" strokeDasharray="2 4" />
      <path d={histD} fill="none" stroke="url(#shape-hist)" strokeWidth="2.2" strokeLinejoin="round" />
      <path d={medD} fill="none" stroke="#FFD54F" strokeWidth="2.2" strokeDasharray="6 4" strokeLinejoin="round" />
      {showBeads &&
        p.rounds.map((r, i) => (
          <circle key={r.step} cx={X(h0 + i + 1)} cy={Y(proj[i]?.p50 ?? last)} r={2.8} fill={HUE[r.hue] ?? AV.blue}>
            <title>{`h+${r.step} · ETA ${r.eta} · p50 ${r.p50.toFixed(2)}x · P(≥2x) ${(r.pGe2 * 100).toFixed(0)}% · P(≥10x) ${(r.pGe10 * 100).toFixed(0)}%`}</title>
          </circle>
        ))}
      <circle cx={X(h0)} cy={Y(last)} r={3.5} fill="#fff" />
    </svg>
  );
}

/** Tiny glyph of a named shape family, used on the Darkboard shape cards. */
export function ShapeGlyph({ name, className }: { name: string; className?: string }) {
  const paths: Record<string, string> = {
    "Spike & Fade": "M2,26 L10,24 L16,4 L22,18 L30,22 L38,24",
    "V-Rebound": "M2,6 L10,14 L18,26 L26,14 L38,6",
    Arch: "M2,26 L10,12 L20,6 L30,12 L38,26",
    "Rising Staircase": "M2,26 L10,26 L10,18 L20,18 L20,10 L30,10 L30,4 L38,4",
    "Choppy Ascent": "M2,26 L8,18 L12,22 L18,14 L22,18 L28,8 L32,12 L38,4",
    "Sliding Ramp": "M2,4 L38,26",
    "Choppy Slide": "M2,4 L8,12 L12,8 L18,16 L22,12 L28,22 L32,18 L38,26",
    "Sawtooth Range": "M2,20 L8,8 L12,20 L18,8 L22,20 L28,8 L32,20 L38,8",
    "Flat Coil": "M2,16 L8,14 L14,18 L20,15 L26,17 L32,15 L38,16",
  };
  return (
    <svg viewBox="0 0 40 30" className={cn("h-8 w-10", className)} aria-hidden="true">
      <path d={paths[name] ?? paths["Flat Coil"]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ShapeMiniCard({ className }: { className?: string }) {
  const q = useQuery({ queryKey: ["shapes", "project", "mini"], queryFn: () => getProjection({ window: 30, horizon: 20 }), refetchInterval: 20_000 });
  const p = q.data;
  return (
    <section className={cn("rounded-xl border border-amber-300/25 bg-card/60", className)} aria-label="Chart prediction">
      <header className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Shapes className="h-3.5 w-3.5 text-amber-300" />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em]">Chart prediction · ShapeShifter</h2>
        </div>
        <Link to="/dashboard/chart-lab" className="text-[11px] text-primary hover:underline">Chart Lab →</Link>
      </header>
      <div className="px-4 py-3">
        {p ? (
          <>
            <div className="mb-1 flex flex-wrap items-baseline gap-2">
              <span className="text-[15px] font-semibold text-amber-200">{p.name}</span>
              <span className="text-[11px] text-muted-foreground">now: {p.currentShape.name} · {p.analogues} analogues · confidence {(p.confidence * 100).toFixed(0)}%</span>
            </div>
            <ShapeSketch p={p} height={170} showAxis={false} />
            <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
              {p.etas.map((e) => (
                <div key={e.threshold} className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
                  <p className="text-muted-foreground">≥{e.threshold}x ETA</p>
                  <p className="font-data font-semibold">{e.eta ?? "beyond horizon"}</p>
                  <p className="font-data text-[10px] text-muted-foreground">{e.expectedRounds ?? "—"} rds vs base {e.baselineRounds}</p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="py-6 text-center text-[12px] text-muted-foreground">{q.isLoading ? "Projecting shape…" : "Not enough rounds for a shape projection."}</p>
        )}
      </div>
    </section>
  );
}
