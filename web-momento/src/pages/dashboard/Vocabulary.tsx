import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { VocabItem } from "@/lib/types";
import { Loading, PageHeader, Panel, StatTile } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface VocabResponse {
  vocabulary: VocabItem[];
  counts: { status: string; n: number }[];
}

const STATUS_TONE: Record<string, string> = {
  candidate: "bg-amber-400/10 text-amber-400 border-amber-400/30",
  validated: "bg-emerald-400/10 text-emerald-400 border-emerald-400/30",
  formalized: "bg-primary/10 text-primary border-primary/30",
  deprecated: "bg-rose-400/10 text-rose-400 border-rose-400/30",
};

export default function Vocabulary() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [newToken, setNewToken] = useState("");
  const [newDef, setNewDef] = useState("");

  const vocab = useQuery({
    queryKey: ["vocabulary", statusFilter],
    queryFn: () => api.get<VocabResponse>(`/api/v1/vocabulary${statusFilter ? `?status=${statusFilter}` : ""}`),
  });
  const learning = useQuery({
    queryKey: ["vocabulary-learning"],
    queryFn: () => api.get<{ total: number; byStatus: { status: string; n: number }[] }>("/api/v1/vocabulary/learning/status"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["vocabulary"] });
    qc.invalidateQueries({ queryKey: ["vocabulary-learning"] });
  };

  const create = useMutation({
    mutationFn: () => api.post("/api/v1/vocabulary", { token: newToken, definition: newDef, layer: "manual" }),
    onSuccess: () => {
      toast.success("Token added");
      setNewToken("");
      setNewDef("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const discover = useMutation({
    mutationFn: () => api.post<{ added: number; candidates: number }>("/api/v1/vocabulary/discover", {}),
    onSuccess: (d) => {
      toast.success(`Discovery pass: ${d.added} new candidate tokens from ${d.candidates} observations`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const formalize = useMutation({
    mutationFn: (id: number) => api.post(`/api/v1/vocabulary/${id}/formalize`),
    onSuccess: () => {
      toast.success("Token formalized into the vocabulary");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deprecate = useMutation({
    mutationFn: (id: number) => api.post(`/api/v1/vocabulary/${id}/deprecate`),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/v1/vocabulary/${id}`),
    onSuccess: invalidate,
  });

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Vocabulary Learning System"
        subtitle="Candidates are discovered from the live series, evaluated against outcomes, formalized when their score earns it, and deprecated when it doesn't."
        actions={
          <Button className="gap-2" onClick={() => discover.mutate()} disabled={discover.isPending}>
            {discover.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Run discovery pass
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Total tokens" value={learning.data?.total ?? 0} sub="vocabulary size" />
        {(learning.data?.byStatus ?? []).slice(0, 3).map((s) => (
          <StatTile key={s.status} label={s.status} value={s.n} sub="tokens" tone={s.status === "validated" ? "good" : "default"} />
        ))}
      </div>

      <Panel title="Add a token manually">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 space-y-1.5 min-w-[160px]">
            <Input placeholder="token, e.g. 2–5x·purple→10–100x" value={newToken} onChange={(e) => setNewToken(e.target.value)} />
          </div>
          <div className="flex-1 space-y-1.5 min-w-[200px]">
            <Input placeholder="definition (optional)" value={newDef} onChange={(e) => setNewDef(e.target.value)} />
          </div>
          <Button className="gap-2" disabled={!newToken || create.isPending} onClick={() => create.mutate()}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setStatusFilter(null)}>
          <Search className="h-3 w-3" /> All
        </Button>
        {["candidate", "validated", "formalized", "deprecated"].map((s) => (
          <Button key={s} variant={statusFilter === s ? "default" : "outline"} size="sm" onClick={() => setStatusFilter(s)}>
            {s}
          </Button>
        ))}
      </div>

      <Panel>
        {vocab.isLoading ? (
          <Loading rows={4} />
        ) : (
          <div className="space-y-1.5">
            {vocab.data?.vocabulary.map((v) => (
              <div key={v.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2">
                <span className="font-data text-[12.5px]">{v.token}</span>
                <Badge variant="outline" className={`text-[10px] ${STATUS_TONE[v.status] ?? ""}`}>{v.status}</Badge>
                {v.definition && <span className="hidden flex-1 truncate text-[11.5px] text-muted-foreground md:block">{v.definition}</span>}
                <span className="ml-auto font-data text-[11px] text-muted-foreground">score {v.score.toFixed(2)} · n={v.hits + v.misses}</span>
                {v.status === "candidate" && (
                  <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => formalize.mutate(v.id)}>
                    formalize
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-muted-foreground" onClick={() => deprecate.mutate(v.id)}>
                  deprecate
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => remove.mutate(v.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {!vocab.data?.vocabulary.length && (
              <p className="py-8 text-center text-[13px] text-muted-foreground">
                No tokens yet — run a discovery pass to harvest candidates from the live series.
              </p>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
