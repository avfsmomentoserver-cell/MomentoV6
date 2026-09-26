// Investigation Suite v6.4 — round forensics, range comparison, session-gap
// analysis & labelled reconstruction, and the backtest bench.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Loader2, Search, Wand2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, qs } from "@/lib/api";
import { fmtInt, fmtMult, fmtPct } from "@/lib/format";
import { AV, hueColor } from "@/lib/v64";
import { PageHeader, Panel, StatTile } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Pattern } from "@/components/v64/DnaLab";
import BacktestSuite from "@/pages/dashboard/BacktestSuite";
import { cn } from "@/lib/utils";

interface RoundInv {
  round: { id: number; ts: string; multiplier: number; source: string; sessionId: number | null; hue: string; word: string; origin: string };
  rarity: { percentile: number; exceedance: number; oneIn: number; rankFromTop: number };
  timing: { deltaMs: number | null; expectedMs: number; verdict: string };
  counters: { threshold: number; roundsSince: number | null; expectedGap: number; pressure: number }[];
  dryRunBefore: number;
  session: { id: number; rounds: number; position: number; max: number } | null;
  dna: { pattern: string; occurrences: number; rateGe2: number; base2: number };
  sentence: string;
  forecast: { state: string; expected: number; rangeLo: number; rangeHi: number; confidence: number; verdict: string; reason: string } | null;
  analogues: { id: number; ts: string; distance: number; next: number }[];
  analogueNextGe2: number;
  context: { id: number; ts: string; multiplier: number; hue: string; focus: boolean; origin: string }[];
}
interface RangeInv {
  slice: { count: number; mean: number; median: number; max: number; ge2: number; ge10: number; ge100: number; lt12: number };
  overall: RangeInv["slice"];
  ks: { D: number; pValue: number };
  z: { ge2: number; ge10: number };
  verdict: string;
  hues: { blue: number; purple: number; pink: number };
}
interface Gap { source: string; afterId: number; startMs: number; endMs: number; gapSec: number; estMissing: number }

function RoundTab() {
  const [id, setId] = useState("");
  const [target, setTarget] = useState<string>("");
  const q = useQuery({
    queryKey: ["investigate", "round", target],
    queryFn: () => api.get<RoundInv>(`/api/v1/investigate/round${qs({ id: target || undefined })}`),
    placeholderData: (p) => p,
  });
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Round ID (empty = latest)</Label>
          <Input className="h-8 w-48 font-mono text-xs" value={id} onChange={(e) => setId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setTarget(id)} />
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setTarget(id)}>{q.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Investigate</Button>
      </div>
      {d && (
        <>
          <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
            <div className="flex flex-col items-center justify-center rounded-xl border p-5 text-center" style={{ borderColor: hueColor(d.round.multiplier), background: hueColor(d.round.multiplier).replace("rgb", "rgba").replace(")", ", 0.08)") }}>
              <p className="font-data text-[11px] text-muted-foreground">round #{d.round.id} · {d.round.source}</p>
              <p className="mt-1 font-data text-4xl font-bold" style={{ color: hueColor(d.round.multiplier) }}>{fmtMult(d.round.multiplier)}</p>
              <p className="mt-1 text-[12px]">“{d.round.word}” · {d.round.hue}{d.round.origin !== "observed" && <span className="ml-1 text-amber-300">· {d.round.origin}</span>}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{new Date(d.round.ts).toLocaleString()}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile label="Rarity" value={`1 in ${d.rarity.oneIn}`} sub={`percentile ${fmtPct(d.rarity.percentile, 1)} · rank ${fmtInt(d.rarity.rankFromTop)} from top`} tone={d.rarity.oneIn > 50 ? "warn" : "default"} />
              <StatTile label="Timing" value={d.timing.deltaMs ? `${(d.timing.deltaMs / 1000).toFixed(1)} s` : "—"} sub={`${d.timing.verdict} · cadence ${(d.timing.expectedMs / 1000).toFixed(1)} s`} />
              <StatTile label="Dry run before" value={d.dryRunBefore} sub="rounds below 2× leading in" />
              <StatTile label="Session" value={d.session ? `#${d.session.id}` : "—"} sub={d.session ? `position ${fmtInt(d.session.position)} / ${fmtInt(d.session.rounds)} · peak ${fmtMult(d.session.max)}` : "not sessionised"} />
              {d.forecast && (
                <div className="rounded-xl border border-border/80 bg-card/70 p-3.5 sm:col-span-2">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">What the engine forecast for this round</p>
                  <p className="mt-1 text-[13px]"><b>{d.forecast.state}</b> · expected {fmtMult(d.forecast.expected)} · range {fmtMult(d.forecast.rangeLo)}–{fmtMult(d.forecast.rangeHi)} · conf {fmtPct(d.forecast.confidence, 0)}</p>
                  <p className={cn("mt-1 text-[12px]", d.forecast.verdict === "hit" ? "text-emerald-300" : d.forecast.verdict === "near" ? "text-amber-300" : "text-rose-300")}>{d.forecast.verdict.toUpperCase()} — {d.forecast.reason}</p>
                </div>
              )}
              <div className="rounded-xl border border-border/80 bg-card/70 p-3.5 sm:col-span-2">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">DNA of the 6 rounds before</p>
                <div className="mt-1.5"><Pattern s={d.dna.pattern} /></div>
                <p className="mt-1 font-data text-[11px] text-muted-foreground">seen {d.dna.occurrences}× · next ≥2× {fmtPct(d.dna.rateGe2, 0)} vs base {fmtPct(d.dna.base2, 1)}</p>
              </div>
            </div>
          </div>

          <Panel title="Context — 30 rounds either side">
            <div className="flex flex-wrap gap-1">
              {d.context.map((c) => (
                <span key={c.id} title={`#${c.id} · ${new Date(c.ts).toLocaleTimeString()}${c.origin !== "observed" ? ` · ${c.origin}` : ""}`} className={cn("rounded px-1.5 py-0.5 font-data text-[11px] font-semibold", c.focus && "ring-2 ring-white", c.origin === "reconstructed" && "opacity-50")} style={{ color: hueColor(c.multiplier), background: hueColor(c.multiplier).replace("rgb", "rgba").replace(")", ", 0.13)") }}>
                  {c.multiplier.toFixed(2)}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[11.5px] italic text-muted-foreground">“{d.sentence}”</p>
          </Panel>

          <div className="grid gap-3 xl:grid-cols-2">
            <Panel title="Counters — rounds since each threshold at this point">
              <div className="space-y-1.5">
                {d.counters.map((c) => (
                  <div key={c.threshold} className="grid grid-cols-[56px_1fr_200px] items-center gap-2 text-[11.5px]">
                    <span className="font-data" style={{ color: hueColor(c.threshold) }}>≥{c.threshold}×</span>
                    <div className="h-2 overflow-hidden rounded bg-muted"><div className="h-full rounded bg-primary/70" style={{ width: `${Math.min(100, c.pressure * 50)}%` }} /></div>
                    <span className="text-right font-data text-muted-foreground">{c.roundsSince ?? "—"} since · gap ~{c.expectedGap}</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title={`Nearest analogues — next ≥2× in ${fmtPct(d.analogueNextGe2, 0)} of them`}>
              <div className="max-h-[220px] overflow-y-auto">
                <table className="w-full text-[11.5px]">
                  <tbody>
                    {d.analogues.map((a) => (
                      <tr key={a.id} className="border-t border-border/40">
                        <td className="py-1 font-data text-muted-foreground">#{a.id}</td>
                        <td className="py-1">{new Date(a.ts).toLocaleString()}</td>
                        <td className="py-1 font-data text-muted-foreground">d {a.distance}</td>
                        <td className="py-1 text-right font-data font-semibold" style={{ color: hueColor(a.next) }}>→ {fmtMult(a.next)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function RangeTab() {
  const [f, setF] = useState({ lastN: "500", from: "", to: "", minX: "", maxX: "", session: "" });
  const [applied, setApplied] = useState(f);
  const q = useQuery({
    queryKey: ["investigate", "range", applied],
    queryFn: () => api.get<RangeInv>(`/api/v1/investigate/range${qs({ lastN: applied.lastN || undefined, from: applied.from ? Date.parse(applied.from) : undefined, to: applied.to ? Date.parse(applied.to) : undefined, minX: applied.minX || undefined, maxX: applied.maxX || undefined, session: applied.session || undefined })}`),
  });
  const d = q.data;
  const rows: [string, keyof RangeInv["slice"], "x" | "p"][] = [["Mean", "mean", "x"], ["Median", "median", "x"], ["Max", "max", "x"], ["P(≥2×)", "ge2", "p"], ["P(≥10×)", "ge10", "p"], ["P(≥100×)", "ge100", "p"], ["P(<1.2×)", "lt12", "p"]];
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
        <Input className="h-8 text-xs" placeholder="last N" value={f.lastN} onChange={(e) => setF({ ...f, lastN: e.target.value })} />
        <Input type="datetime-local" className="h-8 text-xs" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <Input type="datetime-local" className="h-8 text-xs" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <Input className="h-8 text-xs" placeholder="min ×" value={f.minX} onChange={(e) => setF({ ...f, minX: e.target.value })} />
        <Input className="h-8 text-xs" placeholder="max ×" value={f.maxX} onChange={(e) => setF({ ...f, maxX: e.target.value })} />
        <Input className="h-8 text-xs" placeholder="session id" value={f.session} onChange={(e) => setF({ ...f, session: e.target.value })} />
        <Button size="sm" onClick={() => setApplied(f)}>Compare</Button>
      </div>
      {d && (
        <>
          <div className={cn("rounded-xl border px-4 py-3 text-[13px]", d.ks.pValue < 0.01 ? "border-amber-400/40 bg-amber-400/5" : "border-border/70 bg-card/60")}>
            <b>Verdict · </b>{d.verdict} <span className="font-data text-muted-foreground">(KS D={d.ks.D}, p={d.ks.pValue} · z(≥2×)={d.z.ge2} · z(≥10×)={d.z.ge10})</span>
          </div>
          <div className="grid gap-3 xl:grid-cols-3">
            <Panel title="Range vs full history" className="xl:col-span-2">
              <table className="w-full text-[12px]">
                <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground"><th className="py-1">Metric</th><th>Range ({fmtInt(d.slice.count)})</th><th>History ({fmtInt(d.overall.count)})</th><th>Δ</th></tr></thead>
                <tbody>
                  {rows.map(([label, k, t]) => {
                    const a = d.slice[k];
                    const b = d.overall[k];
                    return (
                      <tr key={k} className="border-t border-border/40">
                        <td className="py-1.5">{label}</td>
                        <td className="font-data">{t === "x" ? fmtMult(a) : fmtPct(a, 1)}</td>
                        <td className="font-data text-muted-foreground">{t === "x" ? fmtMult(b) : fmtPct(b, 1)}</td>
                        <td className={cn("font-data", a > b ? "text-emerald-300" : a < b ? "text-rose-300" : "")}>{t === "x" ? `${(a - b).toFixed(2)}` : `${((a - b) * 100).toFixed(1)} pp`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
            <Panel title="Colour mix in range">
              {(["blue", "purple", "pink"] as const).map((h) => {
                const n = d.hues[h];
                const share = n / Math.max(1, d.slice.count);
                return (
                  <div key={h} className="mb-2">
                    <div className="flex justify-between text-[11.5px]"><span style={{ color: AV[h] }}>{h}</span><span className="font-data">{fmtInt(n)} · {fmtPct(share, 1)}</span></div>
                    <div className="mt-1 h-2.5 rounded bg-muted"><div className="h-full rounded" style={{ width: `${share * 100}%`, background: AV[h] }} /></div>
                  </div>
                );
              })}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function GapsTab() {
  const qc = useQueryClient();
  const [minGap, setMinGap] = useState("120");
  const [maxH, setMaxH] = useState("8");
  const gaps = useQuery({ queryKey: ["investigate", "gaps", minGap], queryFn: () => api.get<{ count: number; totalMissing: number; gaps: Gap[]; cadence: { a: number; b: number; medianMs: number } }>(`/api/v1/investigate/gaps${qs({ minGapSec: minGap, limit: 200 })}`) });
  const status = useQuery({ queryKey: ["reconstruct", "status"], queryFn: () => api.get<{ byOrigin: { source: string; origin: string; n: number }[]; useInForecast: boolean }>("/api/v1/reconstruct/status") });
  const plan = useQuery({ queryKey: ["reconstruct", "plan", minGap, maxH], queryFn: () => api.get<{ sources: { source: string; gaps: number; fills: number; anchors: number }[] }>(`/api/v1/reconstruct/plan${qs({ minGapSec: minGap, maxGapHours: maxH })}`) });
  const inv = () => void qc.invalidateQueries();
  const run = useMutation({ mutationFn: () => api.post<{ inserted: number; anchorsPlaced: number }>("/api/v1/reconstruct/run", { minGapSec: Number(minGap), maxGapHours: Number(maxH) }), onSuccess: (r) => { toast.success(`Reconstructed ${r.inserted} rounds (labelled)`); inv(); } });
  const clear = useMutation({ mutationFn: () => api.post<{ removed: number }>("/api/v1/reconstruct/clear", {}), onSuccess: (r) => { toast(`Removed ${r.removed} reconstructed rounds`); inv(); } });
  const toggle = useMutation({ mutationFn: (on: boolean) => api.post("/api/v1/reconstruct/config", { useInForecast: on }), onSuccess: inv, onError: (e: Error) => toast.error(e.message) });
  const recon = (status.data?.byOrigin ?? []).filter((r) => r.origin === "reconstructed").reduce((a, b) => a + b.n, 0);
  const planned = (plan.data?.sources ?? []).reduce((a, b) => a + b.fills, 0);
  const maxGapSec = Math.max(1, ...(gaps.data?.gaps ?? []).map((g) => g.gapSec));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Session gaps" value={fmtInt(gaps.data?.count)} sub={`≥ ${minGap}s without a round`} tone="signal" />
        <StatTile label="Estimated missing" value={fmtInt(gaps.data?.totalMissing)} sub="by fitted cadence per source" />
        <StatTile label="Reconstructed in DB" value={fmtInt(recon)} sub={status.data?.useInForecast ? "used as forecast context" : "excluded from forecasts"} tone={recon ? "warn" : "default"} />
        <StatTile label="Plan (next run)" value={fmtInt(planned)} sub={`gaps ≤ ${maxH} h get filled`} />
      </div>
      <Panel title="Reconstruction — labelled gap fills" right={<Wand2 className="h-4 w-4 text-amber-300" />}>
        <div className="flex flex-wrap items-end gap-3">
          <div><Label className="text-[10.5px] text-muted-foreground">Min gap (s)</Label><Input className="h-8 w-24 text-xs" value={minGap} onChange={(e) => setMinGap(e.target.value)} /></div>
          <div><Label className="text-[10.5px] text-muted-foreground">Max gap to fill (h)</Label><Input className="h-8 w-24 text-xs" value={maxH} onChange={(e) => setMaxH(e.target.value)} /></div>
          <Button size="sm" className="gap-1.5" onClick={() => run.mutate()} disabled={run.isPending}>{run.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Reconstruct gaps</Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => clear.mutate()} disabled={clear.isPending}><Trash2 className="h-3.5 w-3.5" /> Clear all fills</Button>
          <div className="flex items-center gap-2"><Switch checked={!!status.data?.useInForecast} onCheckedChange={(v) => toggle.mutate(v)} /><span className="text-[11.5px] text-muted-foreground">Use fills as forecast context</span></div>
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
          Missing rounds are placed on the fitted cadence (Δt = a + b·ln(previous multiplier)) and drawn from the source's own empirical distribution, capped by any Top-round lists you imported; imported Top rounds are placed as real anchors at their minute. Every fill is stored with <code>origin = reconstructed</code>, shown dashed / faded everywhere, never scored by calibration, and removable in one click. Fills restore sequence continuity, not information — the ledgers measure whether they help.
        </p>
      </Panel>
      <Panel title="Gap timeline — largest first">
        <div className="max-h-[360px] space-y-1 overflow-y-auto pr-1">
          {(gaps.data?.gaps ?? []).map((g) => (
            <div key={`${g.source}${g.startMs}`} className="grid grid-cols-[110px_1fr_220px] items-center gap-2 text-[11.5px]">
              <span className="truncate text-muted-foreground">{g.source}</span>
              <div className="h-2.5 rounded bg-muted"><div className="h-full rounded bg-amber-400/70" style={{ width: `${Math.max(2, (g.gapSec / maxGapSec) * 100)}%` }} /></div>
              <span className="text-right font-data">{new Date(g.startMs).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {(g.gapSec / 60).toFixed(1)} min · ~{fmtInt(g.estMissing)} rds</span>
            </div>
          ))}
          {!gaps.data?.gaps.length && <p className="text-[12px] text-muted-foreground">No gaps above the threshold.</p>}
        </div>
      </Panel>
    </div>
  );
}

export default function Investigation() {
  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="Investigation Suite" subtitle="Round forensics (rarity, timing, counters, DNA, analogues, what the engine forecast), range-vs-history tests (KS, z), session-gap analysis with labelled reconstruction, and the backtest bench." actions={<FlaskConical className="h-5 w-5 text-primary" />} />
      <Tabs defaultValue="round">
        <TabsList>
          <TabsTrigger value="round">Round</TabsTrigger>
          <TabsTrigger value="range">Range</TabsTrigger>
          <TabsTrigger value="gaps">Gaps & reconstruction</TabsTrigger>
          <TabsTrigger value="backtests">Backtests</TabsTrigger>
        </TabsList>
        <TabsContent value="round"><RoundTab /></TabsContent>
        <TabsContent value="range"><RangeTab /></TabsContent>
        <TabsContent value="gaps"><GapsTab /></TabsContent>
        <TabsContent value="backtests"><BacktestSuite /></TabsContent>
      </Tabs>
    </div>
  );
}
