// Scheduler — deep-tier jobs: long-running scans (DNA, linguistics, vocabulary
// discovery, shape ledger, reconstruction, AI summary) on their own cadence.
// The realtime tier recomputes on every round and reads these results on top.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, qs } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { PageHeader, Panel, StatTile } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface Job { id: number; name: string; kind: string; params: Record<string, unknown>; every_min: number; enabled: number; last_run_ms: number | null; last_duration_ms: number | null; last_status: string | null; nextRunMs: number | null }

const KINDS: Record<string, { label: string; params: Record<string, unknown> }> = {
  dna: { label: "DNA scan", params: { alphabet: "band", kMin: 2, kMax: 6, targetLo: 2, targetHi: 1e9, minSupport: 40 } },
  linguistics: { label: "Linguistics", params: { depth: 240 } },
  vocabulary: { label: "Vocabulary discovery", params: { minCount: 25 } },
  shape: { label: "Shape ledger (record + score)", params: { window: 30, horizon: 20, k: 40 } },
  reconstruct: { label: "Gap reconstruction", params: { minGapSec: 120, maxGapHours: 8 } },
  ai: { label: "AI forecast summary (Entrim)", params: {} },
};

function JobRow({ j }: { j: Job }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [every, setEvery] = useState(String(j.every_min));
  const [params, setParams] = useState(JSON.stringify(j.params, null, 1));
  const inv = () => void qc.invalidateQueries({ queryKey: ["deep"] });
  const save = useMutation({ mutationFn: (patch: Partial<Job>) => api.post("/api/v1/deep/jobs", { id: j.id, name: j.name, kind: j.kind, params: j.params, every_min: j.every_min, enabled: j.enabled, ...patch }), onSuccess: inv, onError: (e: Error) => toast.error(e.message) });
  const run = useMutation({ mutationFn: () => api.post("/api/v1/deep/run", { id: j.id }), onSuccess: () => { toast.success(`${j.name} ran`); void qc.invalidateQueries(); } });
  const del = useMutation({ mutationFn: () => api.post("/api/v1/deep/jobs/delete", { id: j.id }), onSuccess: inv });
  const res = useQuery({ queryKey: ["deep", "result", j.id], queryFn: () => api.get<{ result: { payload: unknown; created_ms: number } | null }>(`/api/v1/deep/result${qs({ job: j.id })}`), enabled: open });
  return (
    <>
      <tr className="border-t border-border/40 text-[12px]">
        <td className="py-2"><Switch checked={!!j.enabled} onCheckedChange={(v) => save.mutate({ enabled: v ? 1 : 0 })} /></td>
        <td className="py-2"><button className="text-left hover:underline" onClick={() => setOpen(!open)}>{j.name}</button><p className="text-[10.5px] text-muted-foreground">{KINDS[j.kind]?.label ?? j.kind}</p></td>
        <td className="font-data">every {j.every_min} min</td>
        <td className="text-muted-foreground">{j.last_run_ms ? timeAgo(j.last_run_ms) : "never"}{j.last_duration_ms != null && <span className="font-data"> · {j.last_duration_ms} ms</span>}</td>
        <td className={cn("font-data", j.last_status === "ok" ? "text-emerald-300" : j.last_status ? "text-rose-300" : "text-muted-foreground")}>{j.last_status ?? "—"}</td>
        <td className="text-muted-foreground">{j.nextRunMs ? new Date(j.nextRunMs).toLocaleTimeString() : "—"}</td>
        <td className="text-right">
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => run.mutate()} disabled={run.isPending}>{run.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}</Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-rose-300" onClick={() => confirm(`Delete job “${j.name}”?`) && del.mutate()}><Trash2 className="h-3.5 w-3.5" /></Button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="bg-background/40 p-3">
            <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
              <div className="space-y-2">
                <Label className="text-[10.5px] text-muted-foreground">Interval (minutes)</Label>
                <Input className="h-8 w-32 font-mono text-xs" value={every} onChange={(e) => setEvery(e.target.value)} />
                <Label className="text-[10.5px] text-muted-foreground">Parameters (JSON) — scan width, ranges, depth</Label>
                <textarea className="h-36 w-full rounded-md border border-border bg-background p-2 font-mono text-[11px]" value={params} onChange={(e) => setParams(e.target.value)} />
                <Button size="sm" onClick={() => { try { save.mutate({ every_min: Number(every), params: JSON.parse(params) }); toast.success("Saved"); } catch { toast.error("Parameters must be valid JSON"); } }}>Save</Button>
              </div>
              <div>
                <p className="mb-1 text-[10.5px] text-muted-foreground">Latest result {res.data?.result ? `· ${timeAgo(res.data.result.created_ms)}` : ""}</p>
                <pre className="max-h-64 overflow-auto rounded-md border border-border/60 bg-background p-2 font-mono text-[10.5px] leading-snug">{res.isLoading ? "loading…" : JSON.stringify(res.data?.result?.payload ?? null, null, 1)?.slice(0, 6000)}</pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function Scheduler() {
  const qc = useQueryClient();
  const jobs = useQuery({ queryKey: ["deep", "jobs"], queryFn: () => api.get<{ jobs: Job[] }>("/api/v1/deep/jobs"), refetchInterval: 10_000 });
  const [kind, setKind] = useState("dna");
  const [name, setName] = useState("");
  const [every, setEvery] = useState("30");
  const [params, setParams] = useState(JSON.stringify(KINDS.dna.params));
  const create = useMutation({
    mutationFn: () => api.post("/api/v1/deep/jobs", { name: name || KINDS[kind].label, kind, every_min: Number(every), enabled: 1, params: JSON.parse(params) }),
    onSuccess: () => { toast.success("Job created"); setName(""); void qc.invalidateQueries({ queryKey: ["deep"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const runAll = useMutation({ mutationFn: () => api.post("/api/v1/deep/run", {}), onSuccess: () => { toast.success("All due jobs ran"); void qc.invalidateQueries(); } });
  const list = jobs.data?.jobs ?? [];
  const failing = list.filter((j) => j.last_status && j.last_status !== "ok").length;

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Scheduler — deep computation tier"
        subtitle="Long-run scans run on their own cadence (in production via the Durable Object alarm). The realtime tier recomputes on every new round and layers on top of the latest deep results, so screens update instantly without re-running heavy work."
        actions={<Button size="sm" className="gap-1.5" onClick={() => runAll.mutate()} disabled={runAll.isPending}>{runAll.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run due jobs now</Button>}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Jobs" value={list.length} sub={`${list.filter((j) => j.enabled).length} enabled`} tone="signal" />
        <StatTile label="Failing" value={failing} sub="last status not ok" tone={failing ? "bad" : "good"} />
        <StatTile label="Next run" value={list.length ? new Date(Math.min(...list.filter((j) => j.enabled && j.nextRunMs).map((j) => j.nextRunMs as number))).toLocaleTimeString() : "—"} sub="earliest due job" />
      </div>
      <Panel title="Jobs" right={<CalendarClock className="h-4 w-4 text-muted-foreground" />}>
        <table className="w-full">
          <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground"><th className="w-12">On</th><th>Job</th><th>Cadence</th><th>Last run</th><th>Status</th><th>Next</th><th /></tr></thead>
          <tbody>{list.map((j) => <JobRow key={`${j.id}-${j.every_min}-${JSON.stringify(j.params)}`} j={j} />)}</tbody>
        </table>
        {jobs.isLoading && <p className="py-4 text-[12px] text-muted-foreground">Loading…</p>}
      </Panel>
      <Panel title="New scheduled scan" right={<Plus className="h-4 w-4 text-muted-foreground" />}>
        <div className="grid gap-3 lg:grid-cols-[180px_1fr_110px_2fr_auto] lg:items-end">
          <div className="space-y-1"><Label className="text-[10.5px] text-muted-foreground">Kind</Label>
            <Select value={kind} onValueChange={(v) => { setKind(v); setParams(JSON.stringify(KINDS[v].params)); }}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(KINDS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label className="text-[10.5px] text-muted-foreground">Name</Label><Input className="h-8 text-xs" placeholder={KINDS[kind].label} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-[10.5px] text-muted-foreground">Every (min)</Label><Input className="h-8 font-mono text-xs" value={every} onChange={(e) => setEvery(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-[10.5px] text-muted-foreground">Params JSON (e.g. wider kMax, target range, depth)</Label><Input className="h-8 font-mono text-[11px]" value={params} onChange={(e) => setParams(e.target.value)} /></div>
          <Button size="sm" onClick={() => { try { JSON.parse(params); create.mutate(); } catch { toast.error("Params must be valid JSON"); } }}>Create</Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">DNA params: alphabet band|hue|binary|tempo, kMin/kMax (up to 12), targetLo/targetHi (any multiplier range), minSupport, plus optional range filters lastN, from, to, minX, maxX, session.</p>
      </Panel>
    </div>
  );
}
