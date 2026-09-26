// DNA lab — k-mer sequence scanning with full range filters, selectable
// alphabets, k window, target band, multiple-comparison honesty, the live
// context chain, and scheduled (deep-tier) scans that realtime overlays read.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Dna, Loader2, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, qs } from "@/lib/api";
import { fmtInt, fmtPct, timeAgo } from "@/lib/format";
import { AV } from "@/lib/v64";
import { PageHeader, Panel, StatTile } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface Pat { pattern: string; k: number; n: number; hits: number; rate: number; ci: [number, number]; base: number; lift: number; z: number; avgNext: number; lastSeenMs: number | null }
interface Scan {
  alphabet: string;
  alphabetLabel: string;
  target: { lo: number; hi: number; label: string };
  kRange: [number, number];
  analysed: number;
  baseRate: number;
  tested: number;
  expectedFalsePositives: number;
  significant: number;
  top: Pat[];
  under: Pat[];
  live: Pat[];
  byK: { k: number; patterns: number; significant: number; maxAbsZ: number }[];
  verdict: string;
  alphabets?: Record<string, { label: string; symbols: string[] }>;
}
interface Job { id: number; name: string; kind: string; params: Record<string, unknown>; every_min: number; enabled: number; last_run_ms: number | null; last_status: string | null; last_duration_ms: number | null; nextRunMs: number }
interface LiveScan { job: { id: number; name: string; every: number; lastRunMs?: number }; result: (Omit<Scan, "alphabets"> & { computedAt: string; roundsAtCompute: number; newSinceCompute: number }) | null; overlay?: { k: number; pattern: string; n: number; rate: number; lift: number; z: number }[] }

const SYM_COLOR: Record<string, string> = { A: AV.blue, B: "rgb(96, 165, 250)", C: AV.purple, D: "rgb(168, 85, 247)", E: AV.pink, F: "rgb(244, 63, 94)", b: AV.blue, p: AV.purple, k: AV.pink, B2: AV.blue, P: AV.purple, K: AV.pink, "0": AV.blue, "1": AV.purple };

export function Pattern({ s }: { s: string }) {
  return (
    <span className="inline-flex gap-[2px] font-data">
      {s.split("").map((c, i) => (
        <span key={i} className={cn("inline-flex h-5 min-w-[18px] items-center justify-center rounded px-0.5 text-[10.5px] font-bold", c === c.toUpperCase() && /[bpk]/i.test(c) && "ring-1 ring-white/40")} style={{ background: (SYM_COLOR[c] ?? AV.purple).replace("rgb", "rgba").replace(")", ", 0.22)"), color: SYM_COLOR[c] ?? AV.purple }}>
          {c}
        </span>
      ))}
    </span>
  );
}

function ZBar({ z }: { z: number }) {
  const w = Math.min(100, (Math.abs(z) / 5) * 100);
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative h-1.5 w-20 overflow-hidden rounded bg-muted">
        <div className={cn("absolute top-0 h-full", z >= 0 ? "left-1/2 bg-emerald-400" : "right-1/2 bg-rose-400")} style={{ width: `${w / 2}%` }} />
        <div className="absolute left-1/2 top-0 h-full w-px bg-foreground/40" />
      </div>
      <span className={cn("font-data text-[11px]", Math.abs(z) >= 3 ? "font-semibold text-amber-300" : "text-muted-foreground")}>{z > 0 ? "+" : ""}{z.toFixed(2)}</span>
    </div>
  );
}

function PatTable({ rows, title }: { rows: Pat[]; title: string }) {
  return (
    <Panel title={title}>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-[11.5px]">
          <thead className="sticky top-0 bg-card">
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Pattern</th>
              <th className="px-2 font-medium">n</th>
              <th className="px-2 font-medium">Rate · 95% CI</th>
              <th className="px-2 font-medium">Lift</th>
              <th className="px-2 font-medium">z</th>
              <th className="px-2 font-medium">Seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={`${p.k}:${p.pattern}`} className="border-t border-border/40">
                <td className="py-1 pr-2"><Pattern s={p.pattern} /></td>
                <td className="px-2 font-data">{fmtInt(p.n)}</td>
                <td className="px-2 font-data">{fmtPct(p.rate, 1)} <span className="text-muted-foreground">[{fmtPct(p.ci[0], 0)}–{fmtPct(p.ci[1], 0)}]</span></td>
                <td className={cn("px-2 font-data", p.lift > 1 ? "text-emerald-300" : "text-rose-300")}>{p.lift.toFixed(2)}×</td>
                <td className="px-2"><ZBar z={p.z} /></td>
                <td className="px-2 text-[10.5px] text-muted-foreground">{p.lastSeenMs ? timeAgo(p.lastSeenMs) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="py-6 text-center text-[12px] text-muted-foreground">No patterns meet the support threshold.</p>}
      </div>
    </Panel>
  );
}

export function DnaLab({ title, subtitle, defaults }: { title: string; subtitle: string; defaults: { alphabet: string; targetLo: number; targetHi?: number; kMin: number; kMax: number; minSupport: number } }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    source: "all",
    alphabet: defaults.alphabet,
    kMin: String(defaults.kMin),
    kMax: String(defaults.kMax),
    targetLo: String(defaults.targetLo),
    targetHi: defaults.targetHi ? String(defaults.targetHi) : "",
    minSupport: String(defaults.minSupport),
    pivot: "2",
    lastN: "",
    minX: "",
    maxX: "",
    from: "",
    to: "",
  });
  const [applied, setApplied] = useState(f);
  const [every, setEvery] = useState("30");
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const params = {
    source: applied.source === "all" ? undefined : applied.source,
    alphabet: applied.alphabet,
    kMin: applied.kMin,
    kMax: applied.kMax,
    targetLo: applied.targetLo,
    targetHi: applied.targetHi || undefined,
    minSupport: applied.minSupport,
    pivot: applied.pivot,
    lastN: applied.lastN || undefined,
    minX: applied.minX || undefined,
    maxX: applied.maxX || undefined,
    from: applied.from ? Date.parse(applied.from) : undefined,
    to: applied.to ? Date.parse(applied.to) : undefined,
  };
  const scan = useQuery({ queryKey: ["dna", "scan", params], queryFn: () => api.get<Scan>(`/api/v1/dna/scan${qs(params)}`), placeholderData: (p) => p });
  const live = useQuery({ queryKey: ["dna", "live"], queryFn: () => api.get<{ scans: LiveScan[] }>("/api/v1/dna/live"), refetchInterval: 15_000 });
  const jobs = useQuery({ queryKey: ["deep", "jobs"], queryFn: () => api.get<{ jobs: Job[] }>("/api/v1/deep/jobs") });
  const sources = useQuery({ queryKey: ["sources"], queryFn: () => api.get<{ sources: { name: string; rounds: number }[] }>("/api/v1/sources") });
  const inv = () => void qc.invalidateQueries({ queryKey: ["deep"] }).then(() => qc.invalidateQueries({ queryKey: ["dna"] }));
  const schedule = useMutation({
    mutationFn: () => {
      const p: Record<string, unknown> = { alphabet: applied.alphabet, kMin: Number(applied.kMin), kMax: Number(applied.kMax), targetLo: Number(applied.targetLo), minSupport: Number(applied.minSupport), pivot: Number(applied.pivot) };
      if (applied.targetHi) p.targetHi = Number(applied.targetHi);
      if (applied.source !== "all") p.source = applied.source;
      if (applied.lastN) p.lastN = Number(applied.lastN);
      if (applied.minX) p.minX = Number(applied.minX);
      if (applied.maxX) p.maxX = Number(applied.maxX);
      if (applied.from) p.fromMs = Date.parse(applied.from);
      if (applied.to) p.toMs = Date.parse(applied.to);
      const name = `DNA · ${applied.alphabet} k${applied.kMin}-${applied.kMax} → ${applied.targetHi ? `${applied.targetLo}–${applied.targetHi}x` : `≥${applied.targetLo}x`}${applied.lastN ? ` · last ${applied.lastN}` : ""}`;
      return api.post("/api/v1/deep/jobs", { name, kind: "dna", params: p, every_min: Number(every) });
    },
    onSuccess: () => {
      toast.success("Scan scheduled on the deep tier");
      inv();
    },
  });
  const runJob = useMutation({ mutationFn: (id: number) => api.post("/api/v1/deep/run", { id }), onSuccess: inv });
  const toggle = useMutation({ mutationFn: (j: Job) => api.post("/api/v1/deep/jobs", { id: j.id, enabled: !j.enabled }), onSuccess: inv });
  const del = useMutation({ mutationFn: (id: number) => api.post("/api/v1/deep/jobs/delete", { id }), onSuccess: inv });

  const s = scan.data;
  const excess = s ? s.significant - s.expectedFalsePositives : 0;
  const alphabets = s?.alphabets ?? {};
  const dnaJobs = (jobs.data?.jobs ?? []).filter((j) => j.kind === "dna");
  const maxPat = Math.max(1, ...(s?.byK ?? []).map((b) => b.patterns));

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title={title} subtitle={subtitle} />

      <Panel title="Scan specification — range filters, alphabet, window, target" right={<Dna className="h-4 w-4 text-primary" />}>
        <div className="grid gap-4 lg:grid-cols-4">
          <div className="space-y-2">
            <Label className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Source</Label>
            <Select value={f.source} onValueChange={set("source")}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {(sources.data?.sources ?? []).map((x) => <SelectItem key={x.name} value={x.name}>{x.name} ({fmtInt(x.rounds)})</SelectItem>)}
              </SelectContent>
            </Select>
            <Label className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Alphabet</Label>
            <Select value={f.alphabet} onValueChange={set("alphabet")}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(alphabets).length ? Object.keys(alphabets) : ["band", "hue", "binary", "tempo"]).map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[10.5px] leading-snug text-muted-foreground">{alphabets[f.alphabet]?.label}</p>
          </div>
          <div className="space-y-2">
            <Label className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Pattern length k (min – max)</Label>
            <div className="flex gap-2"><Input className="h-8 font-mono text-xs" value={f.kMin} onChange={(e) => set("kMin")(e.target.value)} /><Input className="h-8 font-mono text-xs" value={f.kMax} onChange={(e) => set("kMax")(e.target.value)} /></div>
            <Label className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Target next round (lo – hi, empty = open)</Label>
            <div className="flex gap-2"><Input className="h-8 font-mono text-xs" value={f.targetLo} onChange={(e) => set("targetLo")(e.target.value)} /><Input className="h-8 font-mono text-xs" placeholder="∞" value={f.targetHi} onChange={(e) => set("targetHi")(e.target.value)} /></div>
            <div className="flex gap-2">
              <div className="flex-1"><Label className="text-[10px] text-muted-foreground">Min support</Label><Input className="h-8 font-mono text-xs" value={f.minSupport} onChange={(e) => set("minSupport")(e.target.value)} /></div>
              <div className="flex-1"><Label className="text-[10px] text-muted-foreground">Binary pivot</Label><Input className="h-8 font-mono text-xs" value={f.pivot} onChange={(e) => set("pivot")(e.target.value)} /></div>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Analysed rounds — range filter</Label>
            <Input className="h-8 font-mono text-xs" placeholder="last N rounds (empty = full history)" value={f.lastN} onChange={(e) => set("lastN")(e.target.value)} />
            <div className="flex gap-2"><Input className="h-8 font-mono text-xs" placeholder="min ×" value={f.minX} onChange={(e) => set("minX")(e.target.value)} /><Input className="h-8 font-mono text-xs" placeholder="max ×" value={f.maxX} onChange={(e) => set("maxX")(e.target.value)} /></div>
            <Input type="datetime-local" className="h-8 text-xs" value={f.from} onChange={(e) => set("from")(e.target.value)} />
            <Input type="datetime-local" className="h-8 text-xs" value={f.to} onChange={(e) => set("to")(e.target.value)} />
          </div>
          <div className="flex flex-col justify-between gap-2">
            <Button onClick={() => setApplied(f)} className="gap-1.5">{scan.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run scan now</Button>
            <div className="space-y-1.5 rounded-lg border border-border/70 bg-background/40 p-2.5">
              <Label className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Schedule this spec on the deep tier</Label>
              <Select value={every} onValueChange={setEvery}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{[["5", "every 5 min"], ["15", "every 15 min"], ["30", "every 30 min"], ["60", "hourly"], ["360", "every 6 h"], ["1440", "daily"]].map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => schedule.mutate()} disabled={schedule.isPending}><Plus className="h-3.5 w-3.5" /> Schedule scan</Button>
            </div>
          </div>
        </div>
      </Panel>

      {s && (
        <>
          <div className={cn("rounded-xl border px-4 py-3 text-[13px]", excess > 3 ? "border-amber-400/40 bg-amber-400/5 text-amber-100" : "border-border/70 bg-card/60")}>
            <span className="font-semibold">Verdict · </span>{s.verdict}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile label="Rounds analysed" value={fmtInt(s.analysed)} sub={`alphabet ${s.alphabet} · k ${s.kRange[0]}–${s.kRange[1]}`} tone="signal" />
            <StatTile label={`Base rate ${s.target.label}`} value={fmtPct(s.baseRate, 1)} sub="unconditional" />
            <StatTile label="Patterns tested" value={fmtInt(s.tested)} sub={`min support ${applied.minSupport}`} />
            <StatTile label="Significant |z| ≥ 3" value={s.significant} sub={`~${s.expectedFalsePositives} expected by chance`} tone={excess > 3 ? "warn" : "default"} />
            <StatTile label="Excess over chance" value={excess > 0 ? `+${excess.toFixed(1)}` : excess.toFixed(1)} sub="multiple-comparison control" tone={excess > 3 ? "warn" : "good"} />
          </div>

          <div className="grid gap-3 xl:grid-cols-3">
            <Panel title="Live context chain — what the latest rounds spell">
              <div className="space-y-2">
                {s.live.map((p) => (
                  <div key={`${p.k}:${p.pattern}`} className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
                    <div className="flex items-center gap-2"><span className="w-6 font-data text-[10px] text-muted-foreground">k{p.k}</span><Pattern s={p.pattern} /></div>
                    <div className="text-right">
                      <p className="font-data text-[11.5px]">{fmtPct(p.rate, 1)} <span className="text-muted-foreground">n {p.n}</span></p>
                      <ZBar z={p.z} />
                    </div>
                  </div>
                ))}
                {!s.live.length && <p className="text-[12px] text-muted-foreground">Current context has no supported history.</p>}
              </div>
            </Panel>
            <Panel title="Pattern space by k — tested vs significant" className="xl:col-span-2">
              <div className="flex h-[220px] items-end gap-3 px-2">
                {s.byK.map((b) => (
                  <div key={b.k} className="flex flex-1 flex-col items-center gap-1">
                    <span className="font-data text-[10px] text-amber-300">{b.significant || ""}</span>
                    <div className="relative w-full rounded-t bg-primary/25" style={{ height: `${(b.patterns / maxPat) * 170}px` }}>
                      <div className="absolute bottom-0 w-full rounded-t bg-amber-400/80" style={{ height: `${b.patterns ? (b.significant / b.patterns) * 100 : 0}%` }} />
                    </div>
                    <span className="font-data text-[10.5px] text-muted-foreground">k={b.k}</span>
                    <span className="font-data text-[9.5px] text-muted-foreground">{b.patterns} · |z|max {b.maxAbsZ}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <PatTable rows={s.top} title={`Over-represented before ${s.target.label}`} />
            <PatTable rows={s.under} title={`Under-represented before ${s.target.label}`} />
          </div>
        </>
      )}

      <Panel title="Scheduled scans — deep tier (realtime overlays read these)" right={<CalendarClock className="h-4 w-4 text-primary" />}>
        <div className="space-y-2">
          {dnaJobs.map((j) => {
            const L = live.data?.scans.find((x) => x.job.id === j.id);
            return (
              <div key={j.id} className="rounded-lg border border-border/70 bg-background/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">{j.name}</p>
                    <p className="font-data text-[10.5px] text-muted-foreground">
                      every {j.every_min} min · last {j.last_run_ms ? timeAgo(j.last_run_ms) : "never"} ({j.last_status ?? "—"}, {j.last_duration_ms ?? "—"} ms)
                      {L?.result ? ` · ${fmtInt(L.result.newSinceCompute)} new rounds since compute` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={!!j.enabled} onCheckedChange={() => toggle.mutate(j)} aria-label="Enabled" />
                    <Button size="sm" variant="outline" onClick={() => runJob.mutate(j.id)} disabled={runJob.isPending}><Play className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => del.mutate(j.id)}><Trash2 className="h-3.5 w-3.5 text-rose-300" /></Button>
                  </div>
                </div>
                {L?.result && (
                  <div className="mt-2 grid gap-2 lg:grid-cols-[1fr_auto]">
                    <p className="text-[12px] text-muted-foreground">{L.result.verdict}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(L.overlay ?? []).slice(0, 4).map((o) => (
                        <span key={`${o.k}${o.pattern}`} className="inline-flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 text-[10.5px]">
                          <Pattern s={o.pattern} /> <span className="font-data">{fmtPct(o.rate, 0)} z{o.z}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {!dnaJobs.length && <p className="text-[12px] text-muted-foreground">No scheduled DNA scans.</p>}
        </div>
      </Panel>
    </div>
  );
}
