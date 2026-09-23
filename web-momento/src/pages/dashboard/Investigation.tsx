import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FlaskConical, Loader2, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { fmtInt } from "@/lib/format";
import type { RangeLab } from "@/lib/types";
import { Loading, PageHeader, Panel, StatTile } from "@/components/bits";
import { Button } from "@/components/ui/button";

interface BacktestRun {
  id: number;
  source: string;
  kind: string;
  params: string;
  created_ms: number;
}

export default function Investigation() {
  const qc = useQueryClient();
  const runs = useQuery({
    queryKey: ["backtest-runs"],
    queryFn: () => api.get<{ runs: BacktestRun[] }>("/api/v1/backtest/runs"),
  });
  const status = useQuery({
    queryKey: ["backtest-status"],
    queryFn: () => api.get<{ runs: number; engine: string }>("/api/v1/backtest/status"),
  });

  const [running, setRunning] = useState(false);
  const run = useMutation({
    mutationFn: (kind: string) => api.post<{ runId: number; result: RangeLab["live"] }>("/api/v1/backtest/run", { kind, source: "all" }),
    onSuccess: (d) => {
      toast.success(`Walk-forward complete — run #${d.runId}`);
      setRunning(false);
      qc.invalidateQueries({ queryKey: ["backtest-runs"] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setRunning(false);
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/v1/backtest/run/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["backtest-runs"] }),
  });

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Investigation Suite"
        subtitle="Walk-forward validation engine: warmup 300 · train half fit · held-out test half scored against the constant baseline with the Brier rule."
        actions={
          <Button
            className="gap-2"
            disabled={running}
            onClick={() => {
              setRunning(true);
              run.mutate("threshold-ensemble");
            }}
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
            Run walk-forward backtest
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Runs stored" value={status.data?.runs ?? 0} sub="queryable history" />
        <StatTile label="Engine" value="walk-forward" sub="no lookahead, ever" tone="signal" />
        <StatTile label="Scoring" value="Brier" sub="vs constant baseline" />
        <StatTile label="Thresholds" value={12} sub="1.2× → 1000×" />
      </div>

      <Panel title="Backtest history">
        {runs.isLoading ? (
          <Loading rows={3} />
        ) : (
          <div className="space-y-1.5">
            {runs.data?.runs.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-[13px]">
                <span className="font-data text-primary">#{r.id}</span>
                <span>{r.kind}</span>
                <span className="text-muted-foreground">source: {r.source}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">{new Date(r.created_ms).toLocaleString()}</span>
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {!runs.data?.runs.length && (
              <p className="py-8 text-center text-[13px] text-muted-foreground">
                No runs yet — launch a walk-forward backtest over all {fmtInt(177905)} seeded rounds.
              </p>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Method">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          The engine splits the stored series with a 300-round warmup, fits every conditional model (markov-1, streak, gap, EWMA, ensemble) on the train half only, then scores the held-out test half. A model is
          accepted only if its Brier score beats the constant baseline by more than 0.5% — otherwise its earned weight is zero and the measured exceedance governs. This is the same protocol that produced the
          Range Lab verdicts shipped with the platform.
        </p>
      </Panel>
    </div>
  );
}
