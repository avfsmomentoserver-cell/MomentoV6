import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { fmtInt, fmtPct } from "@/lib/format";
import type { Calibration } from "@/lib/types";
import { Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";

export default function CalibrationLab() {
  const cal = useQuery({
    queryKey: ["calibration"],
    queryFn: () => api.get<Calibration>("/api/v1/calibration"),
    refetchInterval: 120_000,
  });

  if (cal.isLoading) return <Loading rows={6} />;
  const c = cal.data;
  if (!c) return null;

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Calibration Lab"
        subtitle="Transparency dashboard: constants recomputed live from the database against the reference constants recorded in DATA_CALIBRATION.md from the merged 177,905-round dataset."
      />
      <MetricGrid>
        <StatTile label="Verification" value={c.allMatch ? "ALL MATCH" : "MISMATCH"} sub={`${c.checks.filter((k) => k.match).length}/${c.checks.length} constants within 1%`} tone={c.allMatch ? "good" : "bad"} pulse />
        <StatTile label="Rounds" value={fmtInt(c.dataset.rounds)} sub={`reference ${fmtInt(c.reference.dataset.rounds)}`} />
        <StatTile label="Mean / median" value={`${c.dataset.mean} / ${c.dataset.median}`} sub={`max ${c.dataset.max}×`} />
        <StatTile label="Tail fit" value={`b = ${c.tail.b}`} sub={`reference b = ${c.reference.tail.b}`} tone="signal" />
      </MetricGrid>

      <Panel title="Constant checks — live vs reference">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] font-data text-[12.5px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="pb-2">threshold</th><th className="pb-2">reference</th><th className="pb-2">live</th><th className="pb-2">Δ</th><th className="pb-2">status</th>
              </tr>
            </thead>
            <tbody>
              {c.checks.map((k) => (
                <tr key={k.threshold} className="border-t border-border/50">
                  <td className="py-1.5 font-semibold">{k.threshold}×</td>
                  <td className="py-1.5">{k.referencePct}%</td>
                  <td className="py-1.5">{k.livePct}%</td>
                  <td className="py-1.5 text-muted-foreground">{k.deltaPct !== null ? `${k.deltaPct > 0 ? "+" : ""}${k.deltaPct}%` : "—"}</td>
                  <td className="py-1.5">
                    {k.match ? (
                      <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> match</span>
                    ) : (
                      <span className="flex items-center gap-1 text-rose-400"><XCircle className="h-3.5 w-3.5" /> off</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Post-high effect">
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            After ≥10× rounds, P(next ≥2×) = <strong className="font-data text-foreground">{fmtPct(c.postHigh.rate)}</strong> (n={fmtInt(c.postHigh.n)}) — reference value {c.reference.dataset ? "49.4%" : "—"}.
            Statistically indistinguishable from the 50.47% baseline: there is no "hot hand" to chase.
          </p>
        </Panel>
        <Panel title="What calibration guarantees">
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Reliability bins match observed frequencies — when the engine says 50%, rounds clear the threshold 50% of the time. That is calibration, not clairvoyance: the walk-forward lab shows the ensemble is
            well calibrated but carries no Brier edge. Both facts are shipped on purpose.
          </p>
        </Panel>
      </div>
    </div>
  );
}
