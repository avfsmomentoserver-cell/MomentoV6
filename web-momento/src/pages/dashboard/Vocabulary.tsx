// Vocabulary v2 — phrases discovered by the deep tier, graded against base rates,
// plus the formal registry (v6.3) for promotion / deprecation.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { fmtInt, fmtPct, timeAgo } from "@/lib/format";
import { PageHeader, Panel, StatTile } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Word } from "@/pages/dashboard/Linguistics";
import VocabularyRegistry from "@/pages/dashboard/VocabularyRegistry";
import { cn } from "@/lib/utils";

interface Entry { token: string; layer: string; layers: string[]; definition: string; uses: number; hits: number; misses: number; score: number; lift: number; z: number }
interface Job { id: number; kind: string; name: string; every_min: number; last_run_ms: number | null }

const HUE_OF: Record<string, string> = { dust: "blue", low: "blue", soft: "blue", lift: "purple", climb: "purple", rise: "purple", surge: "pink", blast: "pink", moon: "pink", legend: "pink" };

export default function Vocabulary() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "up" | "down" | "sig">("all");
  const jobs = useQuery({ queryKey: ["deep", "jobs"], queryFn: () => api.get<{ jobs: Job[] }>("/api/v1/deep/jobs") });
  const job = jobs.data?.jobs.find((j) => j.kind === "vocabulary");
  const res = useQuery({
    queryKey: ["deep", "result", job?.id],
    enabled: !!job,
    queryFn: () => api.get<{ result: { created_ms: number; rounds: number; duration_ms: number; payload: { discovered: number; written: number; top: Entry[] } } | null }>(`/api/v1/deep/result?job=${job?.id}`),
  });
  const run = useMutation({ mutationFn: () => api.post("/api/v1/deep/run", { id: job?.id }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["deep"] }) });
  const r = res.data?.result;
  const all = r?.payload.top ?? [];
  const rows = all.filter((e) => (filter === "up" ? e.lift > 1 : filter === "down" ? e.lift < 1 : filter === "sig" ? Math.abs(e.z) >= 3 : true));
  const sig = all.filter((e) => Math.abs(e.z) >= 3).length;

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Vocabulary"
        subtitle="Phrases the market uses more (or less) often than chance before a ≥2× round, discovered on the deep tier from the full history and graded with z-scores. The registry tab holds the formal, promotable vocabulary."
        actions={<Button size="sm" variant="outline" className="gap-1.5" onClick={() => run.mutate()} disabled={!job || run.isPending}><Play className="h-3.5 w-3.5" /> Rediscover now</Button>}
      />
      <Tabs defaultValue="discovered">
        <TabsList>
          <TabsTrigger value="discovered">Discovered phrases</TabsTrigger>
          <TabsTrigger value="registry">Registry</TabsTrigger>
        </TabsList>
        <TabsContent value="discovered" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Phrases graded" value={fmtInt(r?.payload.discovered)} sub={r ? `computed ${timeAgo(r.created_ms)} on ${fmtInt(r.rounds)} rounds` : "—"} tone="signal" />
            <StatTile label="|z| ≥ 3" value={sig} sub="survive the strict bar" tone={sig ? "warn" : "default"} />
            <StatTile label="Written to registry" value={fmtInt(r?.payload.written)} sub="validated when |z| ≥ 3 and n ≥ 100" />
            <StatTile label="Schedule" value={job ? `${job.every_min} min` : "—"} sub={job?.last_run_ms ? `last ${timeAgo(job.last_run_ms)}` : "deep tier"} />
          </div>
          <div className="flex gap-1.5">
            {(["all", "up", "down", "sig"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setFilter(k)} className={cn("rounded-md border px-2.5 py-1 text-[11.5px]", filter === k ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground")}>
                {k === "all" ? "All" : k === "up" ? "Raises P(≥2×)" : k === "down" ? "Lowers P(≥2×)" : "|z| ≥ 3 only"}
              </button>
            ))}
          </div>
          <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((e) => (
              <div key={e.token} className={cn("rounded-xl border bg-card/60 p-3", Math.abs(e.z) >= 3 ? "border-amber-400/40" : "border-border/70")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap gap-1">{e.layers.map((w, i) => <Word key={i} w={w} hue={HUE_OF[w] ?? "blue"} big />)}</div>
                  <span className="rounded bg-muted px-1.5 py-0.5 font-data text-[10px] text-muted-foreground">{e.layer}</span>
                </div>
                <p className="mt-2 text-[12px] leading-snug text-muted-foreground">{e.definition}</p>
                <div className="mt-2 grid grid-cols-4 gap-1.5 text-center font-data text-[11px]">
                  <div className="rounded bg-background/50 py-1"><p className="text-[9.5px] text-muted-foreground">uses</p>{fmtInt(e.uses)}</div>
                  <div className="rounded bg-background/50 py-1"><p className="text-[9.5px] text-muted-foreground">P(≥2×)</p>{fmtPct(e.score, 1)}</div>
                  <div className={cn("rounded bg-background/50 py-1", e.lift > 1 ? "text-emerald-300" : "text-rose-300")}><p className="text-[9.5px] text-muted-foreground">lift</p>{e.lift.toFixed(2)}×</div>
                  <div className={cn("rounded bg-background/50 py-1", Math.abs(e.z) >= 3 && "text-amber-300")}><p className="text-[9.5px] text-muted-foreground">z</p>{e.z}</div>
                </div>
              </div>
            ))}
          </div>
          {!rows.length && (
            <Panel><p className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted-foreground"><Sparkles className="h-4 w-4" />{res.isLoading ? "Loading…" : "No discovered phrases yet — press Rediscover."}</p></Panel>
          )}
        </TabsContent>
        <TabsContent value="registry">
          <VocabularyRegistry />
        </TabsContent>
      </Tabs>
    </div>
  );
}
