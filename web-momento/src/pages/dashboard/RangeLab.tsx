import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtInt, fmtPct } from "@/lib/format";
import type { RangeLab } from "@/lib/types";
import { Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";

export default function RangeLabPage() {
  const lab = useQuery({
    queryKey: ["range-lab"],
    queryFn: () => api.get<RangeLab>("/api/v1/range-lab"),
    refetchInterval: 60_000,
  });

  if (lab.isLoading) return <Loading rows={6} />;
  const r = lab.data;
  if (!r) return null;

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Range Lab"
        subtitle="The honest full-range test lab: every threshold, every model, walk-forward verified. The shipped forecast is the measured exceedance rate with its Wilson CI — conditional adjustments apply with earned weight only."
      />
      <MetricGrid>
        <StatTile label="Dataset" value={fmtInt(r.dataset.rounds)} sub={`source: ${r.dataset.source}`} />
        <StatTile label="Split" value={r.live ? `${fmtInt(r.live.split.train)} / ${fmtInt(r.live.split.test)}` : "—"} sub="train / test (warmup 300)" tone="signal" />
        <StatTile label="Verdict" value={r.live ? "measured live" : "reference only"} sub={r.live ? "recomputed on stored rounds" : "need ≥600 rounds"} />
        <StatTile label="Accepted models" value={r.live ? r.live.verdicts.filter((v) => v.verdict === "accepted").length : 0} sub="Brier edge > 0.5%" tone={r.live && r.live.verdicts.some((v) => v.verdict === "accepted") ? "good" : "default"} />
      </MetricGrid>

      {r.live && (
        <Panel title="Live walk-forward verdicts (all 12 thresholds)">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] font-data text-[12px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2">t</th><th className="pb-2">rate</th><th className="pb-2">Wilson 95% CI</th>
                  <th className="pb-2">Brier base</th><th className="pb-2">Brier ens</th><th className="pb-2">lift</th><th className="pb-2">verdict</th>
                </tr>
              </thead>
              <tbody>
                {r.live.verdicts.map((v) => (
                  <tr key={v.threshold} className="border-t border-border/50">
                    <td className="py-1.5 font-semibold">{v.threshold}×</td>
                    <td className="py-1.5">{fmtPct(v.rate)}</td>
                    <td className="py-1.5 text-muted-foreground">{fmtPct(v.ci[0], 1)}–{fmtPct(v.ci[1], 1)}</td>
                    <td className="py-1.5">{v.brierBase.toFixed(5)}</td>
                    <td className="py-1.5">{v.brierEnsemble.toFixed(5)}</td>
                    <td className={`py-1.5 ${v.lift > 0 ? "text-emerald-400" : "text-rose-400"}`}>{v.lift > 0 ? "+" : ""}{v.lift}%</td>
                    <td className={`py-1.5 ${v.verdict === "accepted" ? "text-emerald-400" : "text-muted-foreground"}`}>{v.verdict}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Reference verdicts — merged 177,905-round dataset (model version merged-177905-2026-08)">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] font-data text-[12px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="pb-2">threshold</th><th className="pb-2">rate</th><th className="pb-2">ETA med</th><th className="pb-2">ETA p90</th>
                <th className="pb-2">Brier base</th><th className="pb-2">lift</th><th className="pb-2">verdict</th>
              </tr>
            </thead>
            <tbody>
              {r.reference.map((v) => (
                <tr key={v.threshold} className="border-t border-border/50">
                  <td className="py-1.5 font-semibold">{v.threshold}×</td>
                  <td className="py-1.5">{v.rate}%</td>
                  <td className="py-1.5 text-muted-foreground">{v.etaMed}</td>
                  <td className="py-1.5 text-muted-foreground">{v.etaP90}</td>
                  <td className="py-1.5">{v.brierBase.toFixed(5)}</td>
                  <td className="py-1.5 text-rose-400">{v.lift}%</td>
                  <td className="py-1.5 text-muted-foreground">{v.verdict}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r.live?.leaderboard && (
          <p className="mt-3 text-[12px] text-muted-foreground">
            Live leaderboard: {r.live.leaderboard.map((m) => `${m.name} ${m.lift > 0 ? "+" : ""}${m.lift}%`).join(" · ")}
          </p>
        )}
      </Panel>
    </div>
  );
}
