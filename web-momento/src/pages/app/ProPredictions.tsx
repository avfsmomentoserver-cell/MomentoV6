import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardList, Loader2 } from "lucide-react";
import { api, qs } from "@/lib/api";
import { fmtInt, fmtMult, fmtPct } from "@/lib/format";
import type { Analysis, ForecastAccuracy } from "@/lib/types";
import { PageHeader, Panel, StatTile, Loading } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ProPredictions() {
  const qc = useQueryClient();
  const [threshold, setThreshold] = useState("2");
  const [model, setModel] = useState("baseline");

  const analysis = useQuery({
    queryKey: ["analysis", "all", "pro"],
    queryFn: () => api.get<Analysis>(`/api/v1/analysis${qs({ source: "all" })}`),
    refetchInterval: 15_000,
  });
  const accuracy = useQuery({
    queryKey: ["forecast-accuracy", "all"],
    queryFn: () => api.get<ForecastAccuracy>("/api/v1/forecasts/accuracy?source=all"),
    refetchInterval: 10_000,
  });

  const record = useMutation({
    mutationFn: (vars: { threshold: number; probability: number; model: string }) =>
      api.post("/api/v1/forecasts/record", { source: "all", ...vars, note: "recorded from Pro Predictions" }),
    onSuccess: () => {
      toast.success("Forecast stored before the round lands");
      qc.invalidateQueries({ queryKey: ["forecast-accuracy"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (analysis.isLoading) return <Loading rows={6} />;
  const a = analysis.data;
  if (!a) return null;
  const t = a.exceedance.find((e) => e.threshold === Number(threshold)) ?? a.exceedance[0];

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Pro Predictions"
        subtitle="Forecasts are stored server-side before the round resolves and scored with the Brier rule — nothing can be back-dated."
      />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label="Open forecasts" value={accuracy.data?.open ?? 0} sub="awaiting resolution" />
        <StatTile label="Resolved" value={accuracy.data?.resolved ?? 0} sub="scored honestly" />
        <StatTile label="Brier score" value={accuracy.data?.brier !== null && accuracy.data?.brier !== undefined ? accuracy.data.brier.toFixed(4) : "—"} sub="lower is better" tone="signal" />
        <StatTile label="Threshold" value={`${threshold}×`} sub={`P = ${fmtPct(t?.rate)}`} />
      </div>

      <Panel title="Record a forecast">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="threshold">Threshold (×)</Label>
            <Input id="threshold" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="w-24 font-data" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="model">Model</Label>
            <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} className="w-40" />
          </div>
          <div className="rounded-lg border border-border bg-background/40 px-3 py-2 text-[13px]">
            Measured probability: <strong className="font-data text-primary">{fmtPct(t?.rate)}</strong>{" "}
            <span className="text-muted-foreground">({fmtInt(t?.hits ?? 0)}/{fmtInt(a.overview.count)} rounds)</span>
          </div>
          <Button
            className="gap-2"
            disabled={record.isPending}
            onClick={() => record.mutate({ threshold: Number(threshold), probability: t?.rate ?? 0.5, model })}
          >
            {record.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
            Store forecast
          </Button>
        </div>
        <p className="mt-3 text-[12px] text-muted-foreground">
          Conditional models (markov, streak, ensemble) apply with earned weight only — the walk-forward lab shows they carry no Brier edge on this dataset.
        </p>
      </Panel>

      <Panel title="Recent resolved forecasts">
        <div className="space-y-1.5 font-data text-[12px]">
          {accuracy.data?.recent.filter((f) => f.actual !== null).slice(0, 12).map((f) => (
            <div key={f.id} className="flex items-center justify-between border-b border-border/40 pb-1.5 last:border-0">
              <span className="text-muted-foreground">{new Date(f.created_ms).toLocaleTimeString()}</span>
              <span>≥{f.threshold}× · p={f.probability.toFixed(3)}</span>
              <span className={f.actual === 1 ? "text-emerald-400" : "text-rose-400"}>{f.actual === 1 ? "HIT" : "MISS"}</span>
              <span className="text-muted-foreground">brier {f.brier?.toFixed(4)}</span>
            </div>
          ))}
          {!accuracy.data?.recent.some((f) => f.actual !== null) && <p className="text-[13px] font-sans text-muted-foreground">No resolved forecasts yet — record one above, then step the live engine from the Ingest Console.</p>}
        </div>
      </Panel>

      <Panel title="Latest rounds">
        <div className="flex flex-wrap gap-1.5">
          {a.exceedance.slice(0, 0).map(() => null)}
          <LastRounds />
        </div>
      </Panel>
    </div>
  );
}

function LastRounds() {
  const latest = useQuery({
    queryKey: ["rounds", "latest", "pro"],
    queryFn: () => api.get<{ rounds: { id: number; ts: string; multiplier: number }[] }>("/api/v1/rounds/latest?limit=40"),
    refetchInterval: 6_000,
  });
  return (
    <>
      {latest.data?.rounds.map((r) => (
        <span key={r.id} className="font-data rounded-md border border-border bg-background/40 px-2 py-1 text-[11px]" style={{ color: r.multiplier >= 10 ? "#F59E0B" : r.multiplier >= 2 ? "#8B5CF6" : "#3B82F6" }}>
          {fmtMult(r.multiplier)}
        </span>
      ))}
    </>
  );
}
