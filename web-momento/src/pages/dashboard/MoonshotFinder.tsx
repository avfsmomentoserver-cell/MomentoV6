import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtInt, fmtMult } from "@/lib/format";
import type { Analysis } from "@/lib/types";
import { Bar, Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";

export default function MoonshotFinder() {
  const analysis = useQuery({
    queryKey: ["analysis", "all", "moonshot"],
    queryFn: () => api.get<Analysis>("/api/v1/analysis?source=all"),
    refetchInterval: 12_000,
  });

  if (analysis.isLoading) return <Loading rows={5} />;
  const a = analysis.data;
  if (!a) return null;
  const m = a.moonshot;
  const factorEntries = Object.entries(m.factors);

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="Moonshot Finder" subtitle="Linguistic moonshot factors over the live series: tail pressure, overdue distances, compression and dry-zone state. Confidence is honest — it reflects measured priors, not a promise." />
      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Scan result" className="xl:col-span-1">
          <div className="flex flex-col items-center gap-3 py-2">
            <div className={`relative flex h-28 w-28 items-center justify-center rounded-full border-4 ${m.imminent ? "border-amber-400 bg-amber-400/10" : "border-border bg-background/40"}`}>
              <span className={`font-data text-3xl font-bold ${m.imminent ? "text-amber-400" : "text-muted-foreground"}`}>{Math.round(m.confidence * 100)}</span>
            </div>
            <p className={`text-[13px] font-semibold ${m.imminent ? "text-amber-400" : "text-muted-foreground"}`}>{m.imminent ? "MOONSHOT CONDITIONS BUILDING" : "NO EDGE DETECTED"}</p>
            <p className="text-center text-[12px] leading-relaxed text-muted-foreground">{m.narrative}</p>
          </div>
        </Panel>

        <Panel title="Factors" className="xl:col-span-2">
          <div className="grid gap-2.5 sm:grid-cols-2">
            {factorEntries.map(([k, v]) => (
              <div key={k} className="rounded-lg border border-border/70 bg-background/40 p-3">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</p>
                <p className="font-data mt-1 text-[14px]">{typeof v === "boolean" ? (v ? "yes" : "no") : v}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <MetricGrid>
        <StatTile label="Rounds ≥ 100×" value={fmtInt(m.historical.count100)} sub="all-time" />
        <StatTile label="Rounds ≥ 1000×" value={fmtInt(m.historical.count1000)} sub="all-time" />
        <StatTile label="Max on record" value={fmtMult(m.historical.max)} sub="merged dataset" tone="warn" />
        <StatTile label="Current dry streak" value={a.streaks.currentKind === "below" ? a.streaks.current : 0} sub="below 2×" />
      </MetricGrid>

      <Panel title="Tail pressure targets">
        <div className="space-y-3">
          {a.pressure.targets.slice(0, 6).map((t) => (
            <div key={t.target}>
              <div className="mb-1 flex items-center justify-between text-[12.5px]">
                <span className="font-data">≥ {t.target.toLocaleString()}×</span>
                <span className="text-muted-foreground">run {t.currentRun} · ETA ~{t.etaMedian ?? "—"} · pressure {t.pressurePct}%</span>
              </div>
              <Bar value={t.pressurePct} tone={t.pressurePct >= 65 ? "bad" : t.pressurePct >= 40 ? "warn" : "good"} />
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
