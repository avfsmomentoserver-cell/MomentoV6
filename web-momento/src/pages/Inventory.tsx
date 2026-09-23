import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Blocks, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { PluginDto } from "@/lib/types";
import { Loading, PageHeader, Panel, StatTile } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

export default function Inventory() {
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");

  const plugins = useQuery({ queryKey: ["inventory"], queryFn: () => api.get<{ plugins: PluginDto[] }>("/api/v1/inventory") });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["inventory"] });

  const toggle = useMutation({
    mutationFn: (vars: { id: number; enabled: boolean }) => api.put(`/api/v1/inventory/${vars.id}/enabled`, { enabled: vars.enabled }),
    onSuccess: invalidate,
  });
  const weight = useMutation({
    mutationFn: (vars: { id: number; w: number }) => api.put(`/api/v1/inventory/${vars.id}/config`, { weight: vars.w, config: {} }),
    onSuccess: invalidate,
  });
  const add = useMutation({
    mutationFn: () => api.post("/api/v1/inventory", { key, name, category: "custom" }),
    onSuccess: () => {
      toast.success("Plugin registered");
      setKey("");
      setName("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/v1/inventory/${id}`),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  if (plugins.isLoading) return <Loading rows={5} />;
  const list = plugins.data?.plugins ?? [];
  const enabled = list.filter((p) => p.enabled === 1).length;

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Plugin Inventory"
        subtitle="Analyzer registry with live weights. Every engine that computes on the series is registered here — enable, disable, and adjust earned weight from one place."
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Plugins" value={list.length} sub="registered" />
        <StatTile label="Enabled" value={enabled} sub="active analyzers" tone="good" />
        <StatTile label="Forecast plugins" value={list.filter((p) => p.category === "forecast").length} sub="earned-weight gated" tone="signal" />
        <StatTile label="Registry" value="SQLite" sub="persistent config" />
      </div>

      <Panel title="Register a plugin">
        <div className="flex flex-wrap items-end gap-3">
          <Input placeholder="key, e.g. my_analyzer" value={key} onChange={(e) => setKey(e.target.value)} className="w-44 font-data" />
          <Input placeholder="display name" value={name} onChange={(e) => setName(e.target.value)} className="w-52" />
          <Button className="gap-2" disabled={!key || add.isPending} onClick={() => add.mutate()}>
            <Plus className="h-4 w-4" /> Register
          </Button>
        </div>
      </Panel>

      <div className="grid gap-2 md:grid-cols-2">
        {list.map((p) => (
          <div key={p.id} className="rounded-xl border border-border/80 bg-card/70 p-4">
            <div className="flex items-center gap-2">
              <Blocks className={`h-4 w-4 ${p.enabled ? "text-primary" : "text-muted-foreground"}`} />
              <p className="text-[14px] font-semibold">{p.name}</p>
              <Badge variant="outline" className="ml-auto text-[10px] uppercase tracking-wider">{p.category}</Badge>
              <Switch checked={p.enabled === 1} onCheckedChange={(v) => toggle.mutate({ id: p.id, enabled: v })} />
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{p.description}</p>
            <div className="mt-3 flex items-center gap-3">
              <label className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                weight
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  defaultValue={p.weight}
                  onBlur={(e) => weight.mutate({ id: p.id, w: Number(e.target.value) })}
                  className="font-data h-7 w-16 rounded border border-border bg-background/60 px-2 text-[12px]"
                />
              </label>
              <span className="font-data text-[11px] text-muted-foreground">runs: {p.runs}</span>
              <Button size="sm" variant="ghost" className="ml-auto h-7 text-destructive" onClick={() => remove.mutate(p.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
