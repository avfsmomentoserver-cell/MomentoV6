import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { fmtDateTime, fmtTime } from "@/lib/format";
import type { Candle, RoundDto, SessionPhase } from "@/lib/types";
import { Loading, PageHeader, Panel, StatTile } from "@/components/bits";
import { Candles, PointsChart } from "@/components/charts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TFS: { value: number; label: string }[] = [
  { value: 60, label: "1m" },
  { value: 300, label: "5m" },
  { value: 900, label: "15m" },
  { value: 3600, label: "1h" },
  { value: 86400, label: "1d" },
];

export default function Market() {
  const [tf, setTf] = useState(60);
  const [source, setSource] = useState("all");

  const candles = useQuery({
    queryKey: ["market-candles", tf, source],
    queryFn: () => api.get<{ candles: Candle[] }>(`/api/v1/market/candles${qs({ tf, source, limit: 140 })}`),
    refetchInterval: 8_000,
  });
  const points = useQuery({
    queryKey: ["market-points", source],
    queryFn: () => api.get<{ points: { t: string; m: number }[] }>(`/api/v1/market/points${qs({ source, limit: 200 })}`),
    refetchInterval: 8_000,
  });
  const phases = useQuery({
    queryKey: ["session-phases", source],
    queryFn: () => api.get<{ sessions: SessionPhase[] }>(`/api/v1/market/session-phases${qs({ source })}`),
  });
  const latest = useQuery({
    queryKey: ["rounds", "latest", "market", source],
    queryFn: () => api.get<{ rounds: RoundDto[] }>(`/api/v1/rounds/latest${qs({ source, limit: 60 })}`),
    refetchInterval: 6_000,
  });

  const sources = useQuery({ queryKey: ["sources", "market"], queryFn: () => api.get<{ sources: { name: string }[] }>("/api/v1/sources") });
  const last = latest.data?.rounds[0];
  const hi = candles.data?.candles.reduce<Candle | null>((acc, c) => (!acc || c.h > acc.h ? c : acc), null);

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Market"
        subtitle="Candles, points and session phases computed server-side from the stored series. Pick a source and timeframe."
        actions={
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="h-9 rounded-lg border border-border bg-card px-2.5 font-data text-[12px] text-foreground"
          >
            <option value="all">all sources</option>
            {sources.data?.sources.map((s) => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
        }
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label="Last" value={last ? `${last.multiplier.toFixed(2)}×` : "—"} sub={fmtDateTime(last?.ts)} pulse />
        <StatTile label="Session high (window)" value={hi ? `${hi.h.toFixed(2)}×` : "—"} sub={hi ? fmtTime(hi.t * 1000) : "—"} tone="warn" />
        <StatTile label="Candles" value={candles.data?.candles.length ?? 0} sub={`tf ${TFS.find((t) => t.value === tf)?.label}`} />
        <StatTile label="Sessions" value={phases.data?.sessions.length ?? 0} sub="30-min gap rule" />
      </div>

      <Tabs defaultValue="candles">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="candles">Candles</TabsTrigger>
            <TabsTrigger value="points">Points</TabsTrigger>
            <TabsTrigger value="phases">Session phases</TabsTrigger>
          </TabsList>
          <div className="hidden gap-1 sm:flex">
            {TFS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTf(t.value)}
                className={`font-data rounded-md border px-2.5 py-1 text-[11px] ${tf === t.value ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <TabsContent value="candles">
          <Panel>
            {candles.data && candles.data.candles.length ? <Candles candles={candles.data.candles} height={340} /> : <p className="py-20 text-center text-[13px] text-muted-foreground">No rounds in this window for the selected source.</p>}
          </Panel>
        </TabsContent>
        <TabsContent value="points">
          <Panel>
            <PointsChart points={(points.data?.points ?? []).map((p) => ({ t: fmtTime(p.t), m: p.m }))} height={340} />
          </Panel>
        </TabsContent>
        <TabsContent value="phases">
          <Panel>
            {phases.isLoading ? (
              <Loading rows={4} />
            ) : (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {(phases.data?.sessions ?? []).slice(0, 24).map((s) => (
                  <div key={s.sessionId} className="rounded-lg border border-border/70 bg-background/40 p-3">
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="font-data text-muted-foreground">#{s.sessionId} · {s.rounds} rounds</span>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-primary">{s.phase}</span>
                    </div>
                    <p className="font-data mt-1.5 text-[13px]">max {s.max}× · mean {s.mean}×</p>
                    <p className="text-[11px] text-muted-foreground">P(≥2×) {s.p2}% · {fmtDateTime(s.started)}</p>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
