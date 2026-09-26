import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDateTime, fmtMult } from "@/lib/format";
import type { Analysis, Candle, RoundDto } from "@/lib/types";
import { Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";
import { TvChart } from "@/components/tv/TvChart";

/** MomentoFX — the forex-style research interface over crash series (v1 surface). */
export default function MomentoFX() {
  const candles = useQuery({
    queryKey: ["fx-candles", 300],
    queryFn: () => api.get<{ candles: Candle[] }>("/api/v1/market/candles?tf=300&limit=150"),
    refetchInterval: 8_000,
  });
  const analysis = useQuery({
    queryKey: ["analysis", "all", "fx"],
    queryFn: () => api.get<Analysis>("/api/v1/analysis?source=all"),
    refetchInterval: 15_000,
  });
  const latest = useQuery({
    queryKey: ["rounds", "latest", "fx"],
    queryFn: () => api.get<{ rounds: RoundDto[] }>("/api/v1/rounds/latest?limit=30"),
    refetchInterval: 5_000,
  });

  if (candles.isLoading || analysis.isLoading) return <Loading rows={5} />;
  const a = analysis.data;
  if (!a) return null;
  const data = (candles.data?.candles ?? []).map((c) => ({ x: fmtDateTime(c.t * 1000), y: c.c }));

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="MomentoFX" subtitle="Forex-style research interface: 5-minute close series over the crash curve, indicator strip, and the session state. The v2 surface adds the drawing workbench." />

      <MetricGrid>
        <StatTile label="Last close" value={fmtMult(data[data.length - 1]?.y)} sub={fmtDateTime(latest.data?.rounds[0]?.ts)} pulse tone="signal" />
        <StatTile label="EMA slope" value={a.shape.slope > 0 ? "rising" : "fading"} sub={`log-slope ${a.shape.slope}`} tone={a.shape.slope > 0 ? "good" : "warn"} />
        <StatTile label="Volatility proxy" value={a.shape.kurtosis > 3.2 ? "fat-tailed" : "normal"} sub={`kurtosis ${a.shape.kurtosis}`} />
        <StatTile label="Session" value={a.overview.sessions > 0 ? `#${a.overview.sessions}` : "—"} sub="30-min gap rule" />
      </MetricGrid>

      <Panel title="5-minute candles — TradingView workbench">
        <TvChart candles={candles.data?.candles ?? []} height={380} storageKey="fx-5m" defaultIndicators={["ema20", "ema50", "volume"]} />
      </Panel>

      <Panel title="Indicator strip">
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 text-[13px]">
          {[
            ["P(≥2×)", `${(a.exceedance.find((e) => e.threshold === 2)?.rate ?? 0) * 100}%`],
            ["Momentum (5-round)", a.shape.acceleration > 0 ? "up" : "down"],
            ["Dry zone", a.shape.dryZone.active ? "active" : "clear"],
            ["Trajectory", a.shape.trajectory.group],
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
