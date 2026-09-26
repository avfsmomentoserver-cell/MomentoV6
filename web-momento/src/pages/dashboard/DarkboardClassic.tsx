import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtMult, fmtPct, timeAgo } from "@/lib/format";
import type { Analysis, RoundDto } from "@/lib/types";
import { Loading, PageHeader, Panel, StatTile } from "@/components/bits";
import { PointsChart } from "@/components/charts";
import { cn } from "@/lib/utils";

const SCREENS = ["Live Shape Feed", "Shape Atlas", "Trajectory Groups", "Build Plan & Library"] as const;

export default function DarkboardClassic() {
  const [screen, setScreen] = useState<(typeof SCREENS)[number]>("Live Shape Feed");

  const analysis = useQuery({
    queryKey: ["analysis", "all", "darkboard"],
    queryFn: () => api.get<Analysis>("/api/v1/analysis?source=all"),
    refetchInterval: 10_000,
  });
  const points = useQuery({
    queryKey: ["market-points", "darkboard"],
    queryFn: () => api.get<{ points: { t: string; m: number }[] }>("/api/v1/market/points?limit=120"),
    refetchInterval: 8_000,
  });
  const latest = useQuery({
    queryKey: ["rounds", "latest", "darkboard"],
    queryFn: () => api.get<{ rounds: RoundDto[] }>("/api/v1/rounds/latest?limit=40"),
    refetchInterval: 5_000,
  });

  if (analysis.isLoading) return <Loading rows={6} />;
  const a = analysis.data;
  if (!a) return null;

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="ShapeShifters Darkboard"
        subtitle="Four-screen research terminal: curve anatomy, Pareto fits, dry zones, ETA bands and trajectory groups — the full math port, live."
      />
      <div className="flex flex-wrap gap-1.5">
        {SCREENS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScreen(s)}
            className={cn(
              "rounded-lg border px-3.5 py-2 text-[13px] transition-colors",
              screen === s ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-card/60 text-muted-foreground hover:text-foreground",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {screen === "Live Shape Feed" && (
        <div className="grid gap-3 xl:grid-cols-3">
          <Panel title="Curve" className="xl:col-span-2">
            <PointsChart points={(points.data?.points ?? []).map((p) => ({ t: p.t.slice(11, 19), m: p.m }))} height={280} />
          </Panel>
          <Panel title="Anatomy">
            <div className="space-y-2 text-[13px]">
              <KV k="classification" v={a.shape.classification} />
              <KV k="log-slope" v={String(a.shape.slope)} />
              <KV k="acceleration" v={String(a.shape.acceleration)} />
              <KV k="skew / kurt" v={`${a.shape.skewness} / ${a.shape.kurtosis}`} />
              <KV k="dry zone" v={a.shape.dryZone.active ? `active · sev ${a.shape.dryZone.severity}` : "inactive"} />
            </div>
          </Panel>
          <Panel title="Round feed" className="xl:col-span-3">
            <div className="flex flex-wrap gap-1.5">
              {latest.data?.rounds.map((r) => (
                <span key={r.id} className="font-data rounded-md border border-border bg-background/40 px-2 py-1 text-[11px]" style={{ color: r.multiplier >= 100 ? "#F43F5E" : r.multiplier >= 10 ? "#F59E0B" : r.multiplier >= 2 ? "#8B5CF6" : "#3B82F6" }}>
                  {r.multiplier.toFixed(2)}
                </span>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {screen === "Shape Atlas" && (
        <div className="grid gap-3 xl:grid-cols-2">
          <Panel title="Pareto fit (MLE)">
            <div className="grid grid-cols-2 gap-2.5 text-[13px]">
              <StatTile label="α" value={a.shape.pareto.alpha} sub="tail exponent" />
              <StatTile label="KS statistic" value={a.shape.pareto.ks} sub={`p ≈ ${a.shape.pareto.pValue}`} />
              <div className="col-span-2 rounded-lg border border-border/70 bg-background/40 p-3 text-[12.5px] leading-relaxed text-muted-foreground">
                {a.shape.pareto.plausibility === "pareto-plausible"
                  ? "The recent tail is consistent with a Pareto law — survival P(X>t|X>s) = (s/t)^α governs the ETA bands below."
                  : "The recent tail rejects the Pareto hypothesis at the 5% level — treat ETA bands as descriptive only."}
              </div>
            </div>
          </Panel>
          <Panel title="ETA bands (95% inverse-survival)">
            <div className="space-y-2">
              {a.shape.eta.map((e) => (
                <div key={e.target} className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-[13px]">
                  <span className="font-data">≥ {e.target}×</span>
                  <span className="text-muted-foreground">median ~{e.median ?? "—"} · band {e.band ? `${e.band[0]}–${e.band[1]}` : "—"}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {screen === "Trajectory Groups" && (
        <Panel title="Grouped trajectory regimes">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {["<1.5×", "1.5–2×", "2–5×", "5–10×", "10–100×", "100×+"].map((g) => (
              <div key={g} className={cn("rounded-lg border p-4", a.shape.trajectory.group === g ? "border-primary/50 bg-primary/5" : "border-border/70 bg-background/40")}>
                <p className="text-[12px] uppercase tracking-wider text-muted-foreground">Group</p>
                <p className="font-data mt-1 text-[16px] font-semibold">{g}</p>
                <p className="mt-1 text-[11.5px] text-muted-foreground">fwd median {a.shape.trajectory.forwardMedian}× · live group: {a.shape.trajectory.group === g ? "current" : "—"}</p>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {screen === "Build Plan & Library" && (
        <Panel title="Build plan & library">
          <div className="space-y-3 text-[13.5px] leading-relaxed text-muted-foreground">
            <p><strong className="text-foreground">Shipped:</strong> curve anatomy, Pareto MLE + KS, Markov streaks, dry zones, moonshot GMM, survival ETA bands, trajectory groups, house-edge correction — all causal, all server-side.</p>
            <p><strong className="text-foreground">Honest verdict:</strong> every conditional predictor was evaluated walk-forward on 177,905 rounds. None beats the baseline — shipped measured-but-down-weighted, earned weight 0. See <a href="/dashboard/range-lab" className="text-primary hover:underline">Range Lab</a>.</p>
            <p><strong className="text-foreground">Library:</strong> full methodology notes in the Documentation Center → ShapeShifters & Darkboard.</p>
          </div>
        </Panel>
      )}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 pb-1.5 last:border-0">
      <span className="font-data text-muted-foreground">{k}</span>
      <span className="font-data">{v}</span>
    </div>
  );
}
