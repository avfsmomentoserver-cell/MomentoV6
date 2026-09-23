import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import type { Candle, RoundDto, SessionPhase } from "@/lib/types";
import { PageHeader, Panel, Loading } from "@/components/bits";
import { Candles, PointsChart } from "@/components/charts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function AppCharts() {
  const candles = useQuery({
    queryKey: ["market-candles", 60],
    queryFn: () => api.get<{ candles: Candle[] }>("/api/v1/market/candles?tf=60&limit=120"),
    refetchInterval: 8_000,
  });
  const points = useQuery({
    queryKey: ["market-points", 150],
    queryFn: () => api.get<{ points: { t: string; m: number }[] }>("/api/v1/market/points?limit=150"),
    refetchInterval: 8_000,
  });
  const phases = useQuery({
    queryKey: ["session-phases"],
    queryFn: () => api.get<{ sessions: SessionPhase[] }>("/api/v1/market/session-phases"),
  });
  const latest = useQuery({
    queryKey: ["rounds", "latest", "charts"],
    queryFn: () => api.get<{ rounds: RoundDto[] }>("/api/v1/rounds/latest?limit=60"),
    refetchInterval: 6_000,
  });

  if (candles.isLoading || points.isLoading) return <Loading rows={5} />;

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="Charts" subtitle="Server-computed candles, points, and session phases — one multiplexed view of the stored series." />
      <Tabs defaultValue="candles">
        <TabsList>
          <TabsTrigger value="candles">Candles 1m</TabsTrigger>
          <TabsTrigger value="points">Points</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
        </TabsList>
        <TabsContent value="candles">
          <Panel>
            {candles.data && candles.data.candles.length > 0 ? (
              <Candles candles={candles.data.candles} />
            ) : (
              <p className="py-16 text-center text-[13px] text-muted-foreground">No rounds in the last window yet.</p>
            )}
          </Panel>
        </TabsContent>
        <TabsContent value="points">
          <Panel>
            <PointsChart points={(points.data?.points ?? []).map((p) => ({ t: fmtTime(p.t), m: p.m }))} />
          </Panel>
        </TabsContent>
        <TabsContent value="sessions">
          <Panel>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {(phases.data?.sessions ?? []).slice(0, 12).map((s) => (
                <div key={s.sessionId} className="rounded-lg border border-border/70 bg-background/40 p-3">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="font-data text-muted-foreground">Session #{s.sessionId}</span>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-primary">{s.phase}</span>
                  </div>
                  <p className="font-data mt-1.5 text-[13px]">max {s.max}× · mean {s.mean}× · P(≥2×) {s.p2}%</p>
                  <p className="text-[11px] text-muted-foreground">{s.rounds} rounds</p>
                </div>
              ))}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>

      <Panel title="Recent points feed">
        <div className="flex flex-wrap gap-1.5">
          {latest.data?.rounds.map((r) => (
            <span key={r.id} className="font-data rounded-md border border-border bg-background/40 px-2 py-1 text-[11px]" style={{ color: r.multiplier >= 10 ? "#F59E0B" : r.multiplier >= 2 ? "#8B5CF6" : "#3B82F6" }}>
              {r.multiplier.toFixed(2)}
            </span>
          ))}
        </div>
      </Panel>
    </div>
  );
}
