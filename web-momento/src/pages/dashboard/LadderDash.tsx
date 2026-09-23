import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Analysis } from "@/lib/types";
import { CatBars } from "@/components/charts";
import { Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";

export default function LadderDash() {
  const analysis = useQuery({
    queryKey: ["analysis", "all", "ladder"],
    queryFn: () => api.get<Analysis>("/api/v1/analysis?source=all"),
    refetchInterval: 15_000,
  });

  if (analysis.isLoading) return <Loading rows={5} />;
  const a = analysis.data;
  if (!a) return null;
  const ladder = a.ladders;
  const hist = Object.entries(ladder.histogram).map(([len, count]) => ({ name: `${len}×`, value: count as number }));

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Ladder Telemetry"
        subtitle="Descending collapse sequences inside the 2–5× band: each step lands lower than the last. Run-length histogram shows what 'normal' looks like."
      />
      <MetricGrid>
        <StatTile label="Current ladder" value={ladder.current ? `${ladder.current.length} steps` : "none"} sub={ladder.current ? `ends at ${ladder.current.values[ladder.current.values.length - 1].toFixed(2)}×` : "no active sequence"} tone={ladder.current && ladder.current.length >= 4 ? "warn" : "default"} />
        <StatTile label="Sequences (last 50)" value={ladder.ladders.length} sub="min length 3" />
        <StatTile label="Longest stored" value={ladder.ladders.reduce((m, l) => Math.max(m, l.length), 0)} sub="steps" />
        <StatTile label="Band" value={ladder.current?.band ?? "2–5×"} sub="descending rule" />
      </MetricGrid>

      <Panel title="Run-length histogram">
        <CatBars data={hist} />
      </Panel>

      <Panel title="Recent sequences">
        <div className="space-y-2">
          {ladder.ladders.slice().reverse().slice(0, 12).map((l, i) => (
            <div key={`${l.startIndex}-${i}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-background/40 p-2.5">
              <span className="font-data rounded-md bg-primary/10 px-2 py-0.5 text-[11px] text-primary">{l.length} steps</span>
              <div className="flex flex-wrap gap-1">
                {l.values.map((v, j) => (
                  <span key={j} className="font-data rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{v.toFixed(2)}</span>
                ))}
              </div>
            </div>
          ))}
          {!ladder.ladders.length && <p className="text-[13px] text-muted-foreground">No ladder sequences on record yet.</p>}
        </div>
      </Panel>
    </div>
  );
}
