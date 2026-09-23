import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BrainCircuit, Loader2, RefreshCw } from "lucide-react";
import { api, qs } from "@/lib/api";
import { fmtInt, fmtPct } from "@/lib/format";
import type { Analysis, ForecastAccuracy, ForecastDto } from "@/lib/types";
import { Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForecastStudio() {
  const qc = useQueryClient();
  const [threshold, setThreshold] = useState("2");
  const [model, setModel] = useState("measured-baseline");

  const analysis = useQuery({
    queryKey: ["analysis", "all", "studio"],
    queryFn: () => api.get<Analysis>("/api/v1/analysis?source=all"),
    refetchInterval: 15_000,
  });
  const accuracy = useQuery({
    queryKey: ["forecast-accuracy", "studio"],
    queryFn: () => api.get<ForecastAccuracy>("/api/v1/forecasts/accuracy"),
    refetchInterval: 10_000,
  });
  const open = useQuery({
    queryKey: ["forecasts", "open"],
    queryFn: () => api.get<{ forecasts: ForecastDto[] }>("/api/v1/forecasts?status=open&limit=20"),
    refetchInterval: 10_000,
  });

  const record = useMutation({
    mutationFn: (vars: { threshold: number; probability: number; model: string }) =>
      api.post("/api/v1/forecasts/record", { source: "all", ...vars }),
    onSuccess: () => {
      toast.success("Forecast stored — it will be scored when the round lands");
      qc.invalidateQueries({ queryKey: ["forecasts"] });
      qc.invalidateQueries({ queryKey: ["forecast-accuracy"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const resolve = useMutation({
    mutationFn: () => api.post<{ resolved: number }>("/api/v1/forecasts/resolve"),
    onSuccess: (d) => {
      toast(`${d.resolved} forecast(s) resolved against the latest round`);
      qc.invalidateQueries();
    },
  });

  if (analysis.isLoading) return <Loading rows={6} />;
  const a = analysis.data;
  if (!a) return null;
  const t = a.exceedance.find((e) => e.threshold === Number(threshold)) ?? a.exceedance[1];

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Forecast Studio"
        subtitle="Markov + percentile + DNA blend with honest accuracy: every projection is stored before the round lands and scored with the Brier rule. Conditional models apply with earned weight only."
      />
      <MetricGrid>
        <StatTile label="Open forecasts" value={accuracy.data?.open ?? 0} sub="stored, awaiting round" />
        <StatTile label="Resolved" value={accuracy.data?.resolved ?? 0} sub="nothing back-dated" />
        <StatTile label="Brier" value={accuracy.data?.brier != null ? accuracy.data.brier.toFixed(5) : "—"} sub="baseline ≈ rate-dependent" tone="signal" />
        <StatTile label="Round count" value={fmtInt(a.overview.count)} sub="scoring universe" />
      </MetricGrid>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Record a forecast">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="t">Threshold (×)</Label>
              <Input id="t" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="w-24 font-data" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m">Model</Label>
              <Input id="m" value={model} onChange={(e) => setModel(e.target.value)} className="w-48" />
            </div>
            <div className="rounded-lg border border-border bg-background/40 px-3 py-2 text-[13px]">
              p(≥{threshold}×) = <strong className="font-data text-primary">{fmtPct(t?.rate)}</strong>
            </div>
            <Button className="gap-2" disabled={record.isPending} onClick={() => record.mutate({ threshold: Number(threshold), probability: t?.rate ?? 0.5, model })}>
              {record.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BrainCircuit className="h-4 w-4" />}
              Store
            </Button>
          </div>
          <div className="mt-4 space-y-1.5 text-[12px] text-muted-foreground">
            <p>Blended state: markov continuation {fmtPct(a.streaks.markov.pStayBelow, 0)} · streak conditionals n={fmtInt(a.streaks.conditional.reduce((s, c) => s + c.n, 0))} · dry zone {a.shape.dryZone.active ? "active" : "off"}.</p>
          </div>
        </Panel>

        <Panel
          title="Open forecasts"
          right={
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => resolve.mutate()}>
              <RefreshCw className="h-3 w-3" /> Resolve vs latest
            </Button>
          }
        >
          <div className="space-y-1.5 font-data text-[12px]">
            {open.data?.forecasts.map((f) => (
              <div key={f.id} className="flex items-center justify-between rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5">
                <span className="text-muted-foreground">{new Date(f.created_ms).toLocaleTimeString()}</span>
                <span>≥{f.threshold}×</span>
                <span>p={f.probability.toFixed(3)}</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{f.model}</span>
              </div>
            ))}
            {!open.data?.forecasts.length && <p className="font-sans text-[13px] text-muted-foreground">No open forecasts. Record one, then go live from Command Center.</p>}
          </div>
        </Panel>
      </div>

      <Panel title="Per-model accuracy">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {accuracy.data?.perModel.map((m) => (
            <div key={m.model} className="rounded-lg border border-border/70 bg-background/40 p-3">
              <p className="text-[12px] font-medium">{m.model}</p>
              <p className="font-data mt-1 text-[13px] text-muted-foreground">n={m.n} · brier {m.brier.toFixed(4)} · hits {fmtPct(m.hitRate, 1)}</p>
            </div>
          ))}
          {!accuracy.data?.perModel.length && <p className="text-[13px] text-muted-foreground">No resolved forecasts scored yet.</p>}
        </div>
      </Panel>
    </div>
  );
}
