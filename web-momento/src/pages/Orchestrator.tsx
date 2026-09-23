import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Compass, Gauge, Hourglass, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import type { OrchestratorState } from "@/lib/types";
import { Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export default function Orchestrator() {
  const qc = useQueryClient();
  const state = useQuery({
    queryKey: ["orchestrator"],
    queryFn: () => api.get<OrchestratorState>("/api/v1/orchestrator"),
    refetchInterval: 10_000,
  });

  const [patience, setPatience] = useState<number | null>(null);
  const [minConf, setMinConf] = useState<number | null>(null);

  const save = useMutation({
    mutationFn: (vars: Record<string, unknown>) => api.put("/api/v1/orchestrator/settings", vars),
    onSuccess: () => {
      toast.success("Orchestrator settings saved");
      qc.invalidateQueries({ queryKey: ["orchestrator"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const evaluate = useMutation({
    mutationFn: () => api.post("/api/v1/orchestrator/evaluate"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orchestrator"] }),
  });

  if (state.isLoading) return <Loading rows={5} />;
  const s = state.data;
  if (!s) return null;
  const patienceVal = patience ?? s.settings.patience;
  const minConfVal = (minConf ?? s.settings.minConfidence) * 100;

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Decision Orchestrator"
        subtitle="Patience, speed, risk, mistake prevention. The orchestrator converts measured state into one disciplined answer: enter or skip."
        actions={
          <Button variant="outline" className="gap-2" onClick={() => evaluate.mutate()}>
            <Gauge className="h-4 w-4" /> Re-evaluate
          </Button>
        }
      />

      <MetricGrid>
        <StatTile label="Verdict" value={s.guidance.action.toUpperCase()} sub={`confidence ${Math.round(s.guidance.confidence * 100)}%`} tone={s.guidance.action === "enter" ? "good" : "warn"} pulse />
        <StatTile label="Dry streak" value={s.state.streakKind === "below" ? `${s.state.streak} rounds` : "broken"} sub={`patience ${patienceVal}`} tone={s.state.streak >= patienceVal ? "signal" : "default"} />
        <StatTile label="Tail pressure" value={`${s.state.tailPressure}%`} sub={s.state.dryZone ? "dry zone active" : "dry zone off"} tone={s.state.tailPressure >= 65 ? "bad" : "default"} />
        <StatTile label="Speed profile" value={s.settings.speed} sub={`risk: ${s.settings.risk}`} />
      </MetricGrid>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Settings">
          <div className="space-y-6">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label className="flex items-center gap-1.5 text-[13px]"><Hourglass className="h-3.5 w-3.5 text-primary" /> Patience (dry rounds before entering)</Label>
                <span className="font-data text-[13px]">{patienceVal}</span>
              </div>
              <Slider value={[patienceVal]} min={1} max={12} step={1} onValueChange={(v) => setPatience(v[0])} onValueCommit={(v) => save.mutate({ patience: v[0] })} />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label className="flex items-center gap-1.5 text-[13px]"><ShieldAlert className="h-3.5 w-3.5 text-primary" /> Minimum confidence to enter</Label>
                <span className="font-data text-[13px]">{Math.round(minConfVal)}%</span>
              </div>
              <Slider value={[minConfVal]} min={30} max={95} step={5} onValueChange={(v) => setMinConf(v[0] / 100)} onValueCommit={(v) => save.mutate({ minConfidence: v[0] / 100 })} />
            </div>
            <div className="flex flex-wrap gap-2">
              {(["patient", "balanced", "fast"] as const).map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => save.mutate({ speed: sp })}
                  className={cn("rounded-lg border px-3 py-1.5 text-[12.5px]", s.settings.speed === sp ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}
                >
                  {sp}
                </button>
              ))}
              {(["conservative", "moderate", "aggressive"] as const).map((rk) => (
                <button
                  key={rk}
                  type="button"
                  onClick={() => save.mutate({ risk: rk })}
                  className={cn("rounded-lg border px-3 py-1.5 text-[12.5px]", s.settings.risk === rk ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}
                >
                  {rk}
                </button>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="Current guidance">
          <div className="space-y-3">
            <div className={cn("rounded-lg border p-4", s.guidance.action === "enter" ? "border-emerald-400/40 bg-emerald-400/5" : "border-amber-400/40 bg-amber-400/5")}>
              <p className={cn("font-data text-lg font-bold", s.guidance.action === "enter" ? "text-emerald-400" : "text-amber-400")}>
                {s.guidance.action === "enter" ? "ENTER — conditions met" : "SKIP — stay patient"}
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{s.guidance.reason}</p>
            </div>
            {s.guidance.mistakes.length > 0 && (
              <div className="rounded-lg border border-rose-400/30 bg-rose-400/5 p-3">
                <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-rose-400">
                  <Compass className="h-3.5 w-3.5" /> Mistake prevention
                </p>
                <ul className="mt-1.5 space-y-1 text-[12.5px] text-muted-foreground">
                  {s.guidance.mistakes.map((m) => (
                    <li key={m}>· {m}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
