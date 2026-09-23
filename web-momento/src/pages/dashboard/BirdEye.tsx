import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDateTime, fmtInt, fmtMult } from "@/lib/format";
import type { Analysis, SessionPhase, SourceDto } from "@/lib/types";
import { Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";
import { SparkArea } from "@/components/charts";

export default function BirdEye() {
  const sources = useQuery({ queryKey: ["sources", "birdeye"], queryFn: () => api.get<{ sources: SourceDto[] }>("/api/v1/sources") });
  const analysis = useQuery({
    queryKey: ["analysis", "all", "birdeye"],
    queryFn: () => api.get<Analysis>("/api/v1/analysis?source=all"),
    refetchInterval: 20_000,
  });
  const phases = useQuery({
    queryKey: ["session-phases", "birdeye"],
    queryFn: () => api.get<{ sessions: SessionPhase[] }>("/api/v1/market/session-phases"),
    refetchInterval: 30_000,
  });

  if (analysis.isLoading || sources.isLoading) return <Loading rows={6} />;
  const a = analysis.data;
  if (!a) return null;

  const sessionSpark = (phases.data?.sessions ?? []).slice(0, 33).reverse().map((s) => ({ x: `#${s.sessionId}`, y: s.max }));

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="Bird's Eye" subtitle="The whole platform at a glance: every source, every session, every engine — one page." />

      <MetricGrid>
        <StatTile label="Total rounds" value={fmtInt(a.overview.count)} sub={`${a.overview.sessions} sessions`} />
        <StatTile label="Sources" value={sources.data?.sources.length ?? 0} sub="registered collectors" />
        <StatTile label="Dataset span" value={`${a.overview.firstTs?.slice(0, 7) ?? "—"} → ${a.overview.lastTs?.slice(0, 7) ?? "—"}`} sub="UTC" />
        <StatTile label="Max on record" value={fmtMult(a.overview.max)} sub="merged dataset" tone="warn" />
      </MetricGrid>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Session maxima">
          <SparkArea data={sessionSpark} height={180} color="#8B5CF6" />
        </Panel>
        <Panel title="Sources">
          <div className="space-y-1.5">
            {sources.data?.sources.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-[13px]">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-[11px] text-muted-foreground">{s.kind}</p>
                </div>
                <div className="text-right">
                  <p className="font-data">{fmtInt(s.rounds)} rounds</p>
                  <p className="text-[11px] text-muted-foreground">{s.last_round ? fmtDateTime(s.last_round) : "no data"}</p>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Engine health">
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 text-[13px]">
          {[
            ["Analysis cache", a.generatedAt ? "warm" : "cold"],
            ["Chi-square (bands)", a.bands.chiSquare.toFixed(1)],
            ["Markov p(jump)", a.streaks.markov.pJump.toFixed(3)],
            ["Pareto α", a.shape.pareto.alpha],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border/70 bg-background/40 p-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
              <p className="font-data mt-1">{value}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
