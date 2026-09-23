import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtInt, fmtPct } from "@/lib/format";
import type { Pressure } from "@/lib/types";
import { Bar, Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";

export default function MegaPressure() {
  const pressure = useQuery({
    queryKey: ["mega-pressure"],
    queryFn: () => api.get<Pressure>("/api/v1/mega-pressure"),
    refetchInterval: 15_000,
  });

  if (pressure.isLoading) return <Loading rows={5} />;
  const p = pressure.data;
  if (!p) return null;

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Mega Pressure Tracker v2.0"
        subtitle="Survival analysis on the power-law tail: measured exceedance where we have hits, power-law extrapolation (p = a·t^-b) where we don't, blended automatically."
      />
      <MetricGrid>
        <StatTile label="Overall pressure" value={`${p.overallPressure}%`} sub={p.status} tone={p.overallPressure >= 65 ? "bad" : p.overallPressure >= 40 ? "warn" : "good"} pulse />
        <StatTile label="Tail exponent b" value={p.powerLaw.b} sub={`p(t) = ${p.powerLaw.a} · t^-${p.powerLaw.b}`} tone="signal" />
        <StatTile label="Fit range" value={`≥ ${p.powerLaw.fitFrom}×`} sub="log-log OLS" />
        <StatTile label="Targets" value={p.targets.length} sub="100× → 100,000×" />
      </MetricGrid>

      <Panel title="Mega targets 100× – 100,000×">
        <div className="space-y-4">
          {p.targets.map((t) => (
            <div key={t.target}>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-1 text-[12.5px]">
                <span className="font-data font-semibold">≥ {fmtInt(t.target)}×</span>
                <span className="text-muted-foreground">
                  p = {fmtPct(t.rate, 4)} · dry run <span className="font-data text-foreground/90">{fmtInt(t.currentRun)}</span> · ETA med ~{t.etaMedian ?? "—"} · p90 ~{t.etaP90 ?? "—"}
                </span>
              </div>
              <Bar value={t.pressurePct} tone={t.pressurePct >= 65 ? "bad" : t.pressurePct >= 40 ? "warn" : "good"} />
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Reading the gauge">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Pressure is the current dry run length measured against the expected median wait (50% = "on schedule"). It is a descriptive survival statistic — the hazard rate of a memoryless tail is constant, so
          pressure <em>describes</em> the drought, it does not <em>predict</em> release. The EV guardrails from the original developer guide still apply.
        </p>
      </Panel>
    </div>
  );
}
