import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarCheck, Sparkles, Target } from "lucide-react";
import { api, qs } from "@/lib/api";
import { fmtInt, fmtMult, fmtPct, timeAgo } from "@/lib/format";
import type { Analysis, RoundDto } from "@/lib/types";
import { PageHeader, Panel, StatTile, Loading, Bar } from "@/components/bits";

export default function Today() {
  const analysis = useQuery({
    queryKey: ["analysis", "all", "today"],
    queryFn: () => api.get<Analysis>(`/api/v1/analysis${qs({ source: "all" })}`),
    refetchInterval: 10_000,
  });
  const latest = useQuery({
    queryKey: ["rounds", "latest", "today"],
    queryFn: () => api.get<{ rounds: RoundDto[] }>("/api/v1/rounds/latest?limit=12"),
    refetchInterval: 5_000,
  });

  if (analysis.isLoading) return <Loading rows={6} />;
  const a = analysis.data;
  if (!a) return null;

  const t2 = a.exceedance.find((e) => e.threshold === 2);
  const t10 = a.exceedance.find((e) => e.threshold === 10);

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Today"
        subtitle="Simple daily guidance from the measured baseline — the same honest engine the operator console uses, simplified."
      />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label="Last round" value={fmtMult(latest.data?.rounds[0]?.multiplier)} sub={timeAgo(latest.data?.rounds[0]?.ts)} pulse />
        <StatTile label="Chance of ≥2× today" value={fmtPct(t2?.rate)} sub={`Wilson CI ${fmtPct(t2?.ci[0], 1)}–${fmtPct(t2?.ci[1], 1)}`} tone="signal" />
        <StatTile label="Dry streak" value={a.streaks.currentKind === "below" ? `${a.streaks.current} rounds` : "broken"} sub={`max on record: ${a.streaks.maxBelow}`} tone={a.streaks.currentKind === "below" && a.streaks.current > 6 ? "warn" : "default"} />
        <StatTile label="Round since 10×" value={t10?.currentRun ?? "—"} sub={`typical wait ~${t10?.etaMedian ?? "—"} rounds`} />
      </div>

      <Panel title="Guidance">
        <div className="space-y-3 text-[13.5px] leading-relaxed">
          <p className="flex items-start gap-2">
            <Target className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            The measured baseline is the forecast: at any moment, the chance the next round reaches 2× is{" "}
            <strong className="font-data">{fmtPct(t2?.rate)}</strong>, with a 95% CI of {fmtPct(t2?.ci[0], 1)}–{fmtPct(t2?.ci[1], 1)}. Nothing on record beats it — so treat every "system" claim accordingly.
          </p>
          <p className="flex items-start gap-2">
            <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            After a high round (≥10×) the next round is ≥2× in <strong className="font-data">{fmtPct(a.streaks.postHigh.rate)}</strong> of cases (n={fmtInt(a.streaks.postHigh.n)}) — statistically indistinguishable from baseline.
          </p>
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            House edge is real: the observed mean is <strong className="font-data">{a.houseEdge.observedMean}×</strong> — every cashout strategy converges against that edge over time.
          </p>
        </div>
      </Panel>

      <Panel title="Latest rounds">
        <div className="space-y-2">
          {latest.data?.rounds.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border-b border-border/50 pb-2 text-[13px] last:border-0 last:pb-0">
              <span className="font-data w-16 text-right font-semibold" style={{ color: r.multiplier >= 10 ? "#F59E0B" : r.multiplier >= 2 ? "#8B5CF6" : "#3B82F6" }}>
                {fmtMult(r.multiplier)}
              </span>
              <span className="text-muted-foreground">{r.source}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">{timeAgo(r.ts)}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Exceedance outlook">
        <div className="space-y-3">
          {a.exceedance.filter((e) => [1.5, 2, 3, 5, 10, 50, 100].includes(e.threshold)).map((e) => (
            <div key={e.threshold}>
              <div className="mb-1 flex items-center justify-between text-[12px]">
                <span className="font-data">≥ {e.threshold}×</span>
                <span className="text-muted-foreground">{fmtPct(e.rate)} · ETA ~{e.etaMedian ?? "—"} rounds</span>
              </div>
              <Bar value={e.rate * 100} />
            </div>
          ))}
        </div>
      </Panel>

      <p className="flex items-center gap-2 text-[11.5px] text-muted-foreground/70">
        <Sparkles className="h-3.5 w-3.5" /> Full research tooling lives in the operator console — <a className="text-primary hover:underline" href="/dashboard">open Command Center</a>.
      </p>
    </div>
  );
}
