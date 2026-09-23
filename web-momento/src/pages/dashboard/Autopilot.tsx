import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Gauge, Pause, Play, RotateCcw, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { fmtInt } from "@/lib/format";
import type { AutopilotDecision } from "@/lib/types";
import { Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Autopilot() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["autopilot", "status"],
    queryFn: () => api.get<{ running: boolean; feedEnabled: boolean; stake: number; threshold: number }>("/api/v1/autopilot/status"),
    refetchInterval: 8_000,
  });
  const decisions = useQuery({
    queryKey: ["autopilot", "decisions"],
    queryFn: () => api.get<{ decisions: AutopilotDecision[]; pnl: number; wins: number; resolved: number }>("/api/v1/autopilot/decisions"),
    refetchInterval: 8_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["autopilot"] });

  const start = useMutation({
    mutationFn: () => api.post("/api/v1/autopilot/start"),
    onSuccess: () => { toast.success("Autopilot armed — it evaluates on every round"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const stop = useMutation({
    mutationFn: () => api.post("/api/v1/autopilot/stop"),
    onSuccess: () => { toast("Autopilot disarmed"); invalidate(); },
  });
  const reset = useMutation({
    mutationFn: () => api.post("/api/v1/autopilot/reset"),
    onSuccess: () => { toast("Ledger cleared"); invalidate(); },
  });
  const evaluate = useMutation({
    mutationFn: () => api.post<{ decision: string; pnl: number }>("/api/v1/autopilot/evaluate"),
    onSuccess: (d) => {
      toast.success(`Decision: ${d.decision} (paper P&L ${d.pnl >= 0 ? "+" : ""}${d.pnl.toFixed(2)})`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const saveConfig = useMutation({
    mutationFn: (vars: { stake: number; threshold: number }) => api.put("/api/v1/autopilot/config", vars),
    onSuccess: () => { toast.success("Config saved"); invalidate(); },
  });

  if (status.isLoading || decisions.isLoading) return <Loading rows={5} />;
  const st = status.data;
  const d = decisions.data;
  const pnl = d?.pnl ?? 0;

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Autopilot Ledger"
        subtitle="Recorded decisions with measured paper P&L — every entry scored against the actual round. This is a discipline tool, not a profit engine."
        actions={
          <>
            {st?.running ? (
              <Button variant="outline" className="gap-2" onClick={() => stop.mutate()}>
                <Pause className="h-4 w-4" /> Disarm
              </Button>
            ) : (
              <Button className="gap-2 glow-signal" onClick={() => start.mutate()}>
                <Play className="h-4 w-4" /> Arm autopilot
              </Button>
            )}
            <Button variant="outline" className="gap-2" onClick={() => evaluate.mutate()}>
              <Zap className="h-4 w-4" /> Evaluate now
            </Button>
            <Button variant="ghost" className="gap-2 text-muted-foreground" onClick={() => reset.mutate()}>
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
          </>
        }
      />

      <MetricGrid>
        <StatTile label="Status" value={st?.running ? "ARMED" : "IDLE"} sub={st?.running ? "evaluating every round" : "manual evaluation only"} tone={st?.running ? "good" : "default"} pulse={st?.running} />
        <StatTile label="Paper P&L" value={`${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}u`} sub="resolved decisions" tone={pnl >= 0 ? "good" : "bad"} />
        <StatTile label="Win rate" value={d?.resolved ? `${Math.round((d.wins / d.resolved) * 100)}%` : "—"} sub={`${fmtInt(d?.wins ?? 0)} / ${fmtInt(d?.resolved ?? 0)}`} />
        <StatTile label="Stake / threshold" value={`${st?.stake ?? 1}u @ ${st?.threshold ?? 2}×`} sub="paper configuration" />
      </MetricGrid>

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Configuration">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              saveConfig.mutate({ stake: Number(fd.get("stake")), threshold: Number(fd.get("threshold")) });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="stake">Stake (units)</Label>
              <Input id="stake" name="stake" type="number" step="0.1" defaultValue={st?.stake ?? 1} className="w-24 font-data" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="thr">Cashout threshold</Label>
              <Input id="thr" name="thr" type="number" step="0.1" defaultValue={st?.threshold ?? 2} className="w-24 font-data" />
            </div>
            <Button type="submit" variant="outline" className="gap-2" disabled={saveConfig.isPending}>
              <Gauge className="h-4 w-4" /> Save
            </Button>
          </form>
          <p className="mt-3 text-[12px] text-muted-foreground">
            Decisions follow the Orchestrator's measured guidance (patience, dry zone, tail pressure). Long-run expectation at threshold T is P(≥T)·T − 1 — the house edge does not disappear because a ledger is tidy.
          </p>
        </Panel>

        <Panel title="Decision ledger" className="xl:col-span-2">
          <div className="no-scrollbar max-h-[420px] space-y-1 overflow-y-auto">
            {d?.decisions.map((dec) => (
              <div key={dec.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-[12.5px]">
                <span className="font-data text-muted-foreground">{new Date(dec.created_ms).toLocaleTimeString()}</span>
                <span className={`font-data rounded px-1.5 py-0.5 text-[11px] ${dec.decision === "enter" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{dec.decision}</span>
                <span className="truncate text-muted-foreground">{dec.reason}</span>
                <span className={`ml-auto font-data ${dec.pnl > 0 ? "text-emerald-400" : dec.pnl < 0 ? "text-rose-400" : "text-muted-foreground"}`}>
                  {dec.pnl > 0 ? "+" : ""}{dec.pnl.toFixed(2)}u
                </span>
              </div>
            ))}
            {!d?.decisions.length && <p className="py-8 text-center text-[13px] text-muted-foreground">No decisions yet — arm the autopilot or evaluate manually.</p>}
          </div>
        </Panel>
      </div>
    </div>
  );
}
