import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtMult } from "@/lib/format";
import type { Analysis } from "@/lib/types";
import { Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";

interface DnaResponse {
  top: { triplet: string; count: number; forwardMean: number }[];
  unique: number;
}

export default function DnaHunter() {
  const analysis = useQuery({
    queryKey: ["analysis", "all", "dna"],
    queryFn: () => api.get<Analysis>("/api/v1/analysis?source=all"),
    refetchInterval: 15_000,
  });
  const dna = useQuery({
    queryKey: ["analysis-dna", "all"],
    queryFn: () => api.get<DnaResponse>("/api/v1/analysis/dna?source=all"),
    refetchInterval: 30_000,
  });

  if (analysis.isLoading || dna.isLoading) return <Loading rows={5} />;
  const a = analysis.data;
  if (!a || !dna.data) return null;

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="DNA Hunter"
        subtitle="Band-triplet DNA: the six-band classification collapsed into 3-grams with forward statistics. Pattern → DNA → Similarity → Probability — measured, not mystical."
      />
      <MetricGrid>
        <StatTile label="Unique triplets" value={dna.data.unique} sub="across all rounds" />
        <StatTile label="Shape classification" value={a.shape.classification} sub={`skew ${a.shape.skewness} · kurt ${a.shape.kurtosis}`} tone="signal" />
        <StatTile label="Pareto α" value={a.shape.pareto.alpha} sub={a.shape.pareto.plausibility} />
        <StatTile label="Trajectory group" value={a.shape.trajectory.group} sub={`fwd median ${a.shape.trajectory.forwardMedian}`} />
      </MetricGrid>

      <Panel title="Most frequent band triplets">
        <div className="space-y-1.5">
          {dna.data.top.slice(0, 15).map((t) => (
            <div key={t.triplet} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-[13px]">
              <span className="font-data text-[12.5px]">{t.triplet}</span>
              <span className="flex items-center gap-4 text-[12px] text-muted-foreground">
                <span>n = {t.count}</span>
                <span>fwd mean <span className="font-data text-foreground/90">{fmtMult(t.forwardMean)}</span></span>
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Curve anatomy (ShapeShifters port)">
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 text-[13px]">
          {[
            ["Log-slope", a.shape.slope],
            ["Acceleration", a.shape.acceleration],
            ["Skewness", a.shape.skewness],
            ["Kurtosis", a.shape.kurtosis],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-lg border border-border/70 bg-background/40 p-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
              <p className="font-data mt-1">{value}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
