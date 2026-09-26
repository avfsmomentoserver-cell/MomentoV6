// Chart Lab — named chart predictions, drawn, then decomputed into actual
// rounds with ETAs; scored by a walk-forward backtest and a live ledger.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, Loader2, Shapes } from "lucide-react";
import { api, qs } from "@/lib/api";
import { fmtInt, fmtMult, fmtPct, timeAgo } from "@/lib/format";
import { AV, getProjection, hueColor } from "@/lib/v64";
import { PageHeader, Panel, StatTile } from "@/components/bits";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TvChart } from "@/components/tv/TvChart";
import { ShapeSketch } from "@/components/v64/ShapeViz";
import { cn } from "@/lib/utils";

interface Backtest { n: number; window: number; horizon: number; maeModel: number | null; maeBase: number | null; skill: number | null; coverage: number | null; wins: number; rows: { anchorId: number; name: string; skill: number; maeModel: number; maeBase: number; coverage: number }[]; note: string }

const HUE: Record<string, string> = { blue: AV.blue, purple: AV.purple, pink: AV.pink };
const tint = (c: string, a: number) => c.replace("rgb", "rgba").replace(")", `, ${a})`);

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-2 text-center">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="font-data text-[14px] font-semibold">{value}</p>
    </div>
  );
}

export default function ChartLab() {
  const [win, setWin] = useState("30");
  const [hor, setHor] = useState("20");
  const [k, setK] = useState("40");
  const [source, setSource] = useState("all");
  const sources = useQuery({ queryKey: ["sources"], queryFn: () => api.get<{ sources: { name: string; rounds: number }[] }>("/api/v1/sources") });
  const src = source === "all" ? null : source;
  const p = useQuery({
    queryKey: ["shapes", "project", win, hor, k, source],
    queryFn: () => getProjection({ window: Number(win), horizon: Number(hor), k: Number(k), source: src }),
    refetchInterval: 15_000,
    placeholderData: (x) => x,
  });
  const bt = useQuery({
    queryKey: ["shapes", "backtest", win, hor, source],
    queryFn: () => api.get<Backtest>(`/api/v1/shapes/backtest${qs({ window: win, horizon: hor, n: 40, source: src ?? undefined })}`),
    staleTime: 120_000,
  });
  const d = p.data;
  const tail = (d?.tail ?? []).map((r) => {
    const t = Math.floor((r.tsMs ?? Date.parse(r.ts)) / 1000);
    return { t, o: r.multiplier, h: r.multiplier, l: r.multiplier, c: r.multiplier };
  });
  const projection = (d?.rounds ?? []).map((r) => ({ t: Math.floor(r.etaMs / 1000), p25: r.p25, p50: r.p50, p75: r.p75 }));
  const pct = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Chart Lab"
        subtitle="Chart predictions as drawings: the projected shape is named and drawn as a fan on the live chart, then decomputed into the actual rounds it implies — each with a clock ETA, median multiplier and hit probabilities — and scored against a flat baseline."
        actions={<Shapes className="h-5 w-5 text-amber-300" />}
      />

      <Panel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1">
            <Label className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {(sources.data?.sources ?? []).map((s) => <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Shape window (rounds)</Label><Input className="h-8 font-mono text-xs" value={win} onChange={(e) => setWin(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Horizon (rounds)</Label><Input className="h-8 font-mono text-xs" value={hor} onChange={(e) => setHor(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Analogues k</Label><Input className="h-8 font-mono text-xs" value={k} onChange={(e) => setK(e.target.value)} /></div>
          <div className="flex items-end text-[11px] text-muted-foreground">
            {p.isFetching ? <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> projecting…</span> : d ? `cadence ~${((d.cadence?.medianMs ?? 0) / 1000).toFixed(0)} s per round` : ""}
          </div>
        </div>
      </Panel>

      {d && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile label="Chart prediction" value={d.name} sub={`from ${d.currentShape.name} · ${d.analogues} analogues`} tone="warn" />
            <StatTile label="Confidence" value={fmtPct(d.confidence, 0)} sub={`drift ${d.drift > 0 ? "+" : ""}${d.drift} log-units`} />
            {d.etas.map((e) => (
              <StatTile key={e.threshold} label={`ETA ≥${e.threshold}×`} value={e.eta ?? "beyond horizon"} sub={`${e.expectedRounds ?? "—"} rds (base median ${e.baselineRounds}) · P in ${d.horizon}: ${fmtPct(e.pWithinHorizon, 0)} vs ${fmtPct(e.baselineWithinHorizon, 0)}`} />
            ))}
          </div>

          <Panel title="Live chart with the drawn projection (yellow median path, p25–p75 fan)">
            <TvChart candles={tail} projection={projection} projectionLabel={d.name} height={380} storageKey="chart-lab" defaultKind="line" defaultIndicators={[]} defaultLog />
          </Panel>

          <div className="grid gap-3 xl:grid-cols-5">
            <Panel title={`Shape drawing — ${d.currentShape.name} → ${d.name}`} className="xl:col-span-3">
              <ShapeSketch p={d} height={260} />
              <p className="mt-2 text-[11px] text-muted-foreground">{d.honesty}</p>
            </Panel>
            <Panel title="Decomputed rounds — what the drawing implies" className="xl:col-span-2" right={<Clock className="h-3.5 w-3.5 text-muted-foreground" />}>
              <div className="max-h-[330px] overflow-y-auto">
                <table className="w-full text-[11.5px]">
                  <thead className="sticky top-0 bg-card">
                    <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground"><th className="py-1">h+</th><th>ETA</th><th>p25</th><th>p50</th><th>p75</th><th>≥2×</th><th>≥10×</th></tr>
                  </thead>
                  <tbody>
                    {d.rounds.map((r) => (
                      <tr key={r.step} className="border-t border-border/40">
                        <td className="py-1 font-data text-muted-foreground">{r.step}</td>
                        <td className="font-data">{r.eta}</td>
                        <td className="font-data text-muted-foreground">{r.p25.toFixed(2)}</td>
                        <td><span className="rounded px-1.5 py-0.5 font-data font-semibold" style={{ color: HUE[r.hue], background: tint(HUE[r.hue] ?? AV.blue, 0.14) }}>{fmtMult(r.p50)}</span></td>
                        <td className="font-data text-muted-foreground">{r.p75.toFixed(2)}</td>
                        <td className={cn("font-data", r.pGe2 >= 0.5 && "text-emerald-300")}>{fmtPct(r.pGe2, 0)}</td>
                        <td className="font-data" style={{ color: r.pGe10 >= 0.15 ? AV.pink : undefined }}>{fmtPct(r.pGe10, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <Panel title={`Walk-forward backtest — ${bt.data?.n ?? "…"} past projections`}>
              {bt.data ? (
                <>
                  <div className="grid grid-cols-4 gap-2">
                    <Metric label="Skill vs flat" value={pct(bt.data.skill)} />
                    <Metric label="MAE model" value={bt.data.maeModel?.toFixed(3) ?? "—"} />
                    <Metric label="MAE baseline" value={bt.data.maeBase?.toFixed(3) ?? "—"} />
                    <Metric label="IQR coverage" value={bt.data.coverage == null ? "—" : fmtPct(bt.data.coverage, 0)} />
                  </div>
                  <div className="mt-3 flex h-[90px] items-center gap-[2px]">
                    {bt.data.rows.map((r) => {
                      const s = Math.max(-1, Math.min(1, r.skill));
                      return (
                        <div key={r.anchorId} className="flex h-full flex-1 flex-col" title={`#${r.anchorId} ${r.name} · skill ${(r.skill * 100).toFixed(1)}%`}>
                          <div className="flex h-1/2 items-end"><div className="w-full rounded-t bg-emerald-400/80" style={{ height: `${Math.max(0, s) * 100}%` }} /></div>
                          <div className="flex h-1/2 items-start"><div className="w-full rounded-b bg-rose-400/80" style={{ height: `${Math.max(0, -s) * 100}%` }} /></div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">{bt.data.wins} of {bt.data.n} projections beat the flat baseline. {bt.data.note}</p>
                </>
              ) : (
                <p className="flex items-center gap-2 py-6 text-[12px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Replaying history…</p>
              )}
            </Panel>
            <Panel title="Live chart-prediction ledger (deep tier records one every 5 min)">
              <div className="grid grid-cols-3 gap-2">
                <Metric label="recorded" value={fmtInt(d.ledger?.total)} />
                <Metric label="resolved" value={fmtInt(d.ledger?.resolved)} />
                <Metric label="skill" value={d.ledger?.skill == null ? "pending" : pct(d.ledger.skill)} />
              </div>
              <div className="mt-3 max-h-[160px] overflow-y-auto">
                <table className="w-full text-[11.5px]">
                  <tbody>
                    {(d.ledger?.recent ?? []).map((r) => (
                      <tr key={r.id} className="border-t border-border/40">
                        <td className="py-1 font-data text-muted-foreground">#{r.id}</td>
                        <td>{r.name}</td>
                        <td className="text-muted-foreground">{timeAgo(r.anchor_ts_ms)}</td>
                        <td className={cn("text-right font-data", (r.skill ?? 0) > 0 ? "text-emerald-300" : "text-muted-foreground")}>{r.resolved_ms ? pct(r.skill) : "waiting for rounds"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[10.5px] text-muted-foreground">A prediction resolves once {hor} real rounds (reconstructed fills excluded) have arrived after its anchor.</p>
            </Panel>
          </div>
          <p className="text-center text-[10.5px] text-muted-foreground">
            Bead colours: <span style={{ color: hueColor(1.5) }}>blue p50 &lt; 2×</span> · <span style={{ color: hueColor(3) }}>purple 2–10×</span> · <span style={{ color: hueColor(20) }}>pink ≥ 10×</span>.
          </p>
        </>
      )}
    </div>
  );
}
