// AI forecast summary (Entrim) — synthesises every metric into one read.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Markdown } from "@/components/Markdown";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

interface AiSummary { id: number; createdAt?: string; model: string; status: string; headline?: string; content: string; durationMs?: number; maxId?: number; rounds?: number }

export function AiSummaryCard({ className }: { className?: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["ai", "summary"],
    queryFn: () => api.get<{ summary: AiSummary | null; configured: boolean; roundsSince?: number }>("/api/v1/ai/summary"),
    refetchInterval: 60_000,
  });
  const run = useMutation({
    mutationFn: () => api.post<{ summary: AiSummary }>("/api/v1/ai/summary", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const s = q.data?.summary;
  const [headline, ...rest] = (s?.content ?? "").split("\n");
  const created = s?.createdAt;
  return (
    <section className={cn("rounded-xl border border-violet-400/30 bg-gradient-to-br from-violet-500/[0.07] via-card/60 to-card/60", className)} aria-label="AI forecast summary">
      <header className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Bot className="h-3.5 w-3.5 shrink-0 text-violet-300" />
          <h2 className="truncate text-[11px] font-semibold uppercase tracking-[0.16em]">AI forecast summary</h2>
          <span className="truncate font-data text-[10.5px] text-muted-foreground">
            {s ? `${s.model} · ${s.status}${created ? ` · ${timeAgo(created)}` : ""}${q.data?.roundsSince ? ` · ${q.data.roundsSince} new rounds since` : ""}` : q.data?.configured === false ? "no key — deterministic summary" : "—"}
          </span>
        </div>
        <button type="button" onClick={() => run.mutate()} disabled={run.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-violet-400/40 px-2 py-1 text-[11px] text-violet-200 hover:bg-violet-400/10 disabled:opacity-50">
          <RefreshCw className={cn("h-3 w-3", run.isPending && "animate-spin")} /> {run.isPending ? "Analysing…" : "Re-analyse"}
        </button>
      </header>
      <div className="px-4 py-3">
        {s ? (
          <>
            <p className="text-[13.5px] font-medium leading-snug text-foreground">{headline}</p>
            <div className="prose-sm mt-2 max-h-[300px] overflow-y-auto pr-1 text-[12.5px] [&_h3]:mt-3 [&_h3]:text-[11px] [&_h3]:uppercase [&_h3]:tracking-wider [&_h3]:text-violet-200">
              <Markdown>{rest.join("\n").trim()}</Markdown>
            </div>
          </>
        ) : (
          <p className="py-6 text-center text-[12px] text-muted-foreground">{q.isLoading ? "Loading…" : "No summary yet — the deep tier writes one every 30 min, or press Re-analyse."}</p>
        )}
      </div>
    </section>
  );
}
