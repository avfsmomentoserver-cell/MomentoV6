// v6.4 seeders: Spribe "Top" widget import (Day/Month/Year · X/Win/Rounds),
// span seeder (ordered multipliers spread between two timestamps), and
// labelled gap reconstruction. Every path previews before it writes.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Crown, Loader2, Timer, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { fmtInt, fmtMult } from "@/lib/format";
import { hueColor } from "@/lib/v64";
import { Panel } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

interface TopPreview { blocks: { scope: string; metric: string; rows: number }[]; warnings: string[]; rows: { scope: string; metric: string; multiplier: number; ts: string }[] }
interface SpanPreview { rounds: { multiplier: number; ts: string }[]; cadence: { medianMs: number } }

const localTz = -new Date().getTimezoneOffset();

export function TopRoundsSeeder() {
  const qc = useQueryClient();
  const [html, setHtml] = useState("");
  const [source, setSource] = useState("aviator");
  const [tzMin, setTzMin] = useState(String(localTz));
  const [anchor, setAnchor] = useState(true);
  const [preview, setPreview] = useState<TopPreview | null>(null);
  const body = (dryRun: boolean) => ({ html, source, tzOffsetMin: Number(tzMin), anchor, dryRun });
  const dry = useMutation({ mutationFn: () => api.post<TopPreview>("/api/v1/seed/top-rounds", body(true)), onSuccess: setPreview, onError: (e: Error) => toast.error(e.message) });
  const commit = useMutation({
    mutationFn: () => api.post<{ parsed: number; stored: number; anchored: number; matched: number }>("/api/v1/seed/top-rounds", body(false)),
    onSuccess: (r) => { toast.success(`${r.parsed} top rounds · ${r.stored} stored · ${r.anchored} placed as anchors · ${r.matched} matched existing rounds`); setPreview(null); void qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Panel title="Top rounds import (Spribe Top widget)" right={<Crown className="h-4 w-4 text-[rgb(192,23,180)]" />}>
      <p className="mb-2 text-[11.5px] text-muted-foreground">Paste the widget HTML (or its text) from the in-game Top tab — X / Win / Rounds with Day / Month / Year. Rows from the Rounds tab are placed as real rounds (<code>origin = anchor</code>) at their minute if no matching round exists; all rows become rarity caps for reconstruction.</p>
      <Textarea className="h-28 font-mono text-[11px]" placeholder='<app-top-rounds-list-item …>26.09.26 07:04 … 714.95x' value={html} onChange={(e) => setHtml(e.target.value)} />
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <div><Label className="text-[10.5px] text-muted-foreground">Source</Label><Input className="h-8 w-32 text-xs" value={source} onChange={(e) => setSource(e.target.value)} /></div>
        <div><Label className="text-[10.5px] text-muted-foreground">Widget timezone (min from UTC)</Label><Input className="h-8 w-28 font-mono text-xs" value={tzMin} onChange={(e) => setTzMin(e.target.value)} /></div>
        <div className="flex items-center gap-2 pb-1"><Switch checked={anchor} onCheckedChange={setAnchor} /><span className="text-[11.5px] text-muted-foreground">Place Rounds rows as anchors</span></div>
        <Button size="sm" variant="outline" disabled={!html.trim() || dry.isPending} onClick={() => dry.mutate()}>{dry.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Preview</Button>
        <Button size="sm" disabled={!preview || commit.isPending} onClick={() => commit.mutate()}>{commit.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Import {preview ? preview.rows.length : ""}</Button>
      </div>
      {preview && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-1.5 text-[11px]">{preview.blocks.map((b, i) => <span key={i} className="rounded border border-border/60 px-2 py-0.5">{b.scope} · {b.metric} · {b.rows} rows</span>)}</div>
          {preview.warnings.map((w) => <p key={w} className="text-[11px] text-amber-300">{w}</p>)}
          <div className="max-h-48 overflow-y-auto rounded border border-border/50">
            <table className="w-full text-[11.5px]">
              <tbody>{preview.rows.map((r, i) => (
                <tr key={i} className="border-t border-border/30"><td className="px-2 py-1 text-muted-foreground">{r.scope}</td><td>{r.metric}</td><td className="font-data">{new Date(r.ts).toLocaleString()}</td><td className="px-2 text-right font-data font-semibold" style={{ color: hueColor(r.multiplier) }}>{fmtMult(r.multiplier)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}

export function SpanSeeder() {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [order, setOrder] = useState<"newest-first" | "oldest-first">("newest-first");
  const [source, setSource] = useState("aviator");
  const [preview, setPreview] = useState<SpanPreview | null>(null);
  const body = (dryRun: boolean) => ({ text, start: start ? new Date(start).toISOString() : "", end: end ? new Date(end).toISOString() : "", order, source, dryRun });
  const dry = useMutation({ mutationFn: () => api.post<SpanPreview>("/api/v1/seed/span", body(true)), onSuccess: setPreview, onError: (e: Error) => toast.error(e.message) });
  const commit = useMutation({
    mutationFn: () => api.post<{ inserted: number; rejected?: number }>("/api/v1/seed/span", body(false)),
    onSuccess: (r) => { toast.success(`${fmtInt(r.inserted)} seeded rounds recorded`); setPreview(null); setText(""); void qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Panel title="Span seeder — record rounds between two timestamps" right={<Timer className="h-4 w-4 text-muted-foreground" />}>
      <p className="mb-2 text-[11.5px] text-muted-foreground">Paste multipliers you know by order only (e.g. the in-game history strip). They are spread between start and end using the fitted cadence (longer flights take longer), stored as <code>origin = seeded</code>.</p>
      <Textarea className="h-20 font-mono text-[11px]" placeholder="1.23x 4.56x 1.02 2.11 …" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <div><Label className="text-[10.5px] text-muted-foreground">Start</Label><Input type="datetime-local" step="1" className="h-8 text-xs" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div><Label className="text-[10.5px] text-muted-foreground">End</Label><Input type="datetime-local" step="1" className="h-8 text-xs" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        <div><Label className="text-[10.5px] text-muted-foreground">Source</Label><Input className="h-8 w-28 text-xs" value={source} onChange={(e) => setSource(e.target.value)} /></div>
        <div className="flex items-center gap-2 pb-1"><Switch checked={order === "newest-first"} onCheckedChange={(v) => setOrder(v ? "newest-first" : "oldest-first")} /><span className="text-[11.5px] text-muted-foreground">{order}</span></div>
        <Button size="sm" variant="outline" disabled={!text.trim() || !start || !end || dry.isPending} onClick={() => dry.mutate()}>Preview</Button>
        <Button size="sm" disabled={!preview || commit.isPending} onClick={() => commit.mutate()}>Record {preview?.rounds.length ?? ""}</Button>
      </div>
      {preview && (
        <div className="mt-3 flex max-h-40 flex-wrap gap-1 overflow-y-auto">
          {preview.rounds.map((r, i) => <span key={i} title={new Date(r.ts).toLocaleString()} className="rounded px-1.5 py-0.5 font-data text-[11px]" style={{ color: hueColor(r.multiplier), background: "rgba(255,255,255,0.04)" }}>{new Date(r.ts).toLocaleTimeString()} {r.multiplier.toFixed(2)}</span>)}
        </div>
      )}
    </Panel>
  );
}

export function ReconstructQuick() {
  const qc = useQueryClient();
  const [maxH, setMaxH] = useState("8");
  const plan = useMutation({ mutationFn: () => api.get<{ sources: { source: string; gaps: number; fills: number }[] }>(`/api/v1/reconstruct/plan?maxGapHours=${maxH}`), onError: (e: Error) => toast.error(e.message) });
  const run = useMutation({ mutationFn: () => api.post<{ inserted: number }>("/api/v1/reconstruct/run", { maxGapHours: Number(maxH) }), onSuccess: (r) => { toast.success(`${r.inserted} labelled rounds reconstructed`); void qc.invalidateQueries(); } });
  const prime = useMutation({ mutationFn: () => api.post<{ jobs: string[] }>("/api/v1/seed/prime", {}), onSuccess: (r) => { toast.success(`Intelligence primed: ${r.jobs.length} deep jobs ran`); void qc.invalidateQueries(); } });
  return (
    <Panel title="Session gaps & priming" right={<Wand2 className="h-4 w-4 text-amber-300" />}>
      <div className="flex flex-wrap items-end gap-3">
        <div><Label className="text-[10.5px] text-muted-foreground">Fill gaps up to (h)</Label><Input className="h-8 w-24 font-mono text-xs" value={maxH} onChange={(e) => setMaxH(e.target.value)} /></div>
        <Button size="sm" variant="outline" onClick={() => plan.mutate()} disabled={plan.isPending}>Plan</Button>
        <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>{run.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Reconstruct</Button>
        <Button size="sm" variant="outline" onClick={() => prime.mutate()} disabled={prime.isPending}>{prime.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Prime intelligence</Button>
      </div>
      {plan.data && <p className="mt-2 font-data text-[11.5px] text-muted-foreground">{plan.data.sources.map((s) => `${s.source}: ${s.gaps} gaps → ${fmtInt(s.fills)} fills`).join(" · ") || "no gaps"}</p>}
      <p className="mt-2 text-[11px] text-muted-foreground">Reconstructed rounds are labelled, faded in every view, excluded from scoring, and can be removed in Investigation → Gaps. Priming rebuilds sessions and runs the DNA, linguistics, vocabulary and shape jobs so a fresh import is immediately intelligent.</p>
    </Panel>
  );
}
