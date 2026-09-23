import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtMult } from "@/lib/format";
import type { Analysis } from "@/lib/types";
import { Bar, Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";

export default function Resistance() {
  const analysis = useQuery({
    queryKey: ["analysis", "all", "resistance"],
    queryFn: () => api.get<Analysis>("/api/v1/analysis?source=all"),
    refetchInterval: 15_000,
  });

  if (analysis.isLoading) return <Loading rows={5} />;
  const a = analysis.data;
  if (!a) return null;
  const ceilings = a.ceilings;
  const maxTouches = ceilings.levels.reduce((m, l) => Math.max(m, l.touches), 1);

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Resistance"
        subtitle="Clustered local-maxima ceilings from the recent window — levels the curve keeps testing. Tolerance 5%, minimum 3 touches."
      />
      <MetricGrid>
        <StatTile label="Dominant ceiling" value={ceilings.dominant ? fmtMult(ceilings.dominant.level) : "—"} sub={ceilings.dominant ? `${ceilings.dominant.touches} touches · ${ceilings.dominant.archetype}` : "no ceiling detected"} tone="signal" />
        <StatTile label="Levels tracked" value={ceilings.levels.length} sub="window 400 rounds" />
        <StatTile label="Min touches" value={3} sub="cluster threshold" />
        <StatTile label="Tolerance" value="±5%" sub="cluster radius" />
      </MetricGrid>

      <Panel title="Ceiling pressure by level">
        <div className="space-y-3">
          {ceilings.levels.map((l) => (
            <div key={l.level}>
              <div className="mb-1 flex items-center justify-between text-[12.5px]">
                <span className="font-data">{fmtMult(l.level)} <span className="text-muted-foreground">· {l.archetype}</span></span>
                <span className="text-muted-foreground">{l.touches} touches</span>
              </div>
              <Bar value={l.touches} max={maxTouches} tone={l.touches === maxTouches ? "primary" : "good"} />
            </div>
          ))}
          {!ceilings.levels.length && <p className="text-[13px] text-muted-foreground">No clustered ceilings in the current window — the curve is in free range.</p>}
        </div>
      </Panel>

      <Panel title="Method">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Peaks are local maxima of the recent 400-round window that reach at least 2×. Peaks within 5% of an existing cluster merge into one level; the level price is the cluster mean and the archetype reflects
          whether the cluster drifted up or down as it accumulated touches. This is the TypeScript port of the original pressure-plugin ceiling detector.
        </p>
      </Panel>
    </div>
  );
}
