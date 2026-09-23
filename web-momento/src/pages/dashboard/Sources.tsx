import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDateTime, fmtInt } from "@/lib/format";
import type { SourceDto } from "@/lib/types";
import { Loading, PageHeader, Panel, StatTile } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Sources() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");

  const sources = useQuery({ queryKey: ["sources", "page"], queryFn: () => api.get<{ sources: SourceDto[] }>("/api/v1/sources") });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["sources"] });

  const add = useMutation({
    mutationFn: () => api.post("/api/v1/sources", { name, label: label || name, kind: "collector" }),
    onSuccess: () => {
      toast.success("Source registered");
      setName("");
      setLabel("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (n: string) => api.del(`/api/v1/sources/${encodeURIComponent(n)}`),
    onSuccess: () => {
      toast("Source and its rounds deleted");
      invalidate();
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalRounds = sources.data?.sources.reduce((a, s) => a + s.rounds, 0) ?? 0;

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Sources"
        subtitle="Every collector that ever fed the platform. The three seeded sources are the merged provenance from the original archives; live-engine is the built-in generator."
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Sources" value={sources.data?.sources.length ?? 0} sub="registered" />
        <StatTile label="Total rounds" value={fmtInt(totalRounds)} sub="across all sources" tone="signal" />
        <StatTile label="Active" value={sources.data?.sources.filter((s) => s.rounds > 0).length ?? 0} sub="with data" />
        <StatTile label="Ingest methods" value="api · import · live-feed" sub="tracked per round" />
      </div>

      <Panel title="Register a source">
        <div className="flex flex-wrap items-end gap-3">
          <Input placeholder="name, e.g. aviator-eu" value={name} onChange={(e) => setName(e.target.value)} className="w-48 font-data" />
          <Input placeholder="label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} className="w-56" />
          <Button className="gap-2" disabled={!name || add.isPending} onClick={() => add.mutate()}>
            <Plus className="h-4 w-4" /> Register
          </Button>
        </div>
      </Panel>

      <Panel>
        {sources.isLoading ? (
          <Loading rows={3} />
        ) : (
          <div className="space-y-1.5">
            {sources.data?.sources.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5">
                <Activity className={`h-4 w-4 ${s.rounds > 0 ? "text-emerald-400" : "text-muted-foreground"}`} />
                <div className="min-w-[140px]">
                  <p className="font-data text-[13px]">{s.name}</p>
                  <p className="text-[11px] text-muted-foreground">{s.label} · {s.kind}</p>
                </div>
                <div className="ml-auto flex items-center gap-6 text-right">
                  <div>
                    <p className="font-data text-[13px]">{fmtInt(s.rounds)}</p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">rounds</p>
                  </div>
                  <div className="hidden md:block">
                    <p className="text-[12px]">{s.last_round ? fmtDateTime(s.last_round) : "—"}</p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">last round</p>
                  </div>
                  {s.name !== "aviator" && s.rounds === 0 && (
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(s.name)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
