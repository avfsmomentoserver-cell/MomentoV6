// F-38 Alerts Center · F-25 anchor alerts · F-28 ETA alerts
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Loading, PageHeader, Panel } from "@/components/bits";
import { DataTable, Field, Note, Verdict, btnCls, btnGhost, inputCls, pct, useV1 } from "@/components/v65/kit";

type Fields = { fields: { field: string; label: string; unit: string }[]; current: Record<string, number>; presets: { name: string; field: string; op: string; value: number }[] };

export default function Alerts() {
  const qc = useQueryClient();
  const f = useV1<Fields>("alerts/fields", { refetch: 10_000 });
  const rules = useV1<{ rules: Record<string, unknown>[] }>("alerts/rules");
  const al = useV1<{ rows: Record<string, unknown>[]; unread: number; precision: number | null }>("alerts", { refetch: 10_000 });
  const [form, setForm] = useState({ name: "", field: "eta.10.kmPercentile", op: ">=", value: 90, debounce_s: 300, daily_cap: 20 });
  const refresh = () => qc.invalidateQueries({ queryKey: ["v65"] });
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast.success(msg); refresh(); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } };
  const create = (r = form) => act(() => api.post("/api/v1/alerts/rules", r), "Rule created");
  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="Alerts Center" subtitle="Platform Book F-38/F-25/F-28. Rules over live fields (ETA percentiles, streaks, anchors, the forecast). Each rule has debounce, a daily cap and optional quiet hours; rate fired alerts so precision is measured, not assumed." actions={<button type="button" className={btnGhost} onClick={() => act(() => api.post("/api/v1/alerts/read", {}), "All marked read")}>Mark all read</button>} />
      <div className="grid gap-4 lg:grid-cols-5">
        <Panel title="New rule" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="my alert" /></Field>
            <Field label="Field"><select className={inputCls} value={form.field} onChange={(e) => setForm({ ...form, field: e.target.value })}>{f.data?.fields.map((x) => <option key={x.field} value={x.field}>{x.label}</option>)}</select></Field>
            <Field label="Operator"><select className={inputCls} value={form.op} onChange={(e) => setForm({ ...form, op: e.target.value })}>{[">=", "<=", ">", "<", "="].map((o) => <option key={o}>{o}</option>)}</select></Field>
            <Field label={`Value (now ${f.data?.current[form.field] ?? "—"})`}><input className={inputCls} type="number" value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} /></Field>
            <Field label="Debounce s"><input className={inputCls} type="number" value={form.debounce_s} onChange={(e) => setForm({ ...form, debounce_s: Number(e.target.value) })} /></Field>
            <Field label="Daily cap"><input className={inputCls} type="number" value={form.daily_cap} onChange={(e) => setForm({ ...form, daily_cap: Number(e.target.value) })} /></Field>
          </div>
          <button type="button" className={`${btnCls} mt-3`} onClick={() => create()}>Create rule</button>
          <p className="mb-1 mt-4 text-[11px] uppercase tracking-wider text-muted-foreground">Presets</p>
          <div className="flex flex-wrap gap-2">{f.data?.presets.map((p) => <button key={p.name} type="button" className="rounded-md border border-border px-2 py-1 text-[11.5px] hover:border-primary/50" onClick={() => create({ ...form, ...p })}>{p.name}</button>)}</div>
        </Panel>
        <Panel title="Live field values" className="lg:col-span-3">
          {f.data ? <div className="grid grid-cols-2 gap-x-6 gap-y-1 font-data text-[11.5px] md:grid-cols-3">{Object.entries(f.data.current).map(([k, v]) => <div key={k} className="flex justify-between border-b border-border/40 py-0.5"><span className="text-muted-foreground">{k}</span><span>{typeof v === "number" ? +v.toFixed(2) : String(v)}</span></div>)}</div> : <Loading />}
        </Panel>
      </div>
      <Panel title="Rules">
        <DataTable rows={rules.data?.rules ?? []} empty="No rules yet." cols={[{ key: "name", label: "name" }, { key: "cond", label: "condition", render: (r) => `${r.field} ${r.op} ${r.value}` }, { key: "debounce_s", label: "debounce" }, { key: "daily_cap", label: "cap" }, { key: "last_fired_ms", label: "last fired", render: (r) => (r.last_fired_ms ? new Date(r.last_fired_ms as number).toLocaleString() : "—") }, { key: "enabled", label: "", render: (r) => <button type="button" onClick={() => act(() => api.post(`/api/v1/alerts/rules/${r.id}/toggle`), "Toggled")}><Verdict ok={!!r.enabled}>{r.enabled ? "on" : "off"}</Verdict></button> }, { key: "del", label: "", render: (r) => <button type="button" aria-label="delete rule" onClick={() => act(() => api.del(`/api/v1/alerts/rules/${r.id}`), "Deleted")}><Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-rose-400" /></button> }]} />
      </Panel>
      <Panel title={`Fired alerts · ${al.data?.unread ?? 0} unread`} right={<span className="text-[12px] text-muted-foreground">measured precision {pct(al.data?.precision)}</span>}>
        <DataTable rows={al.data?.rows ?? []} empty="Nothing has fired yet. Rules are evaluated on every ingest." cols={[{ key: "created_ms", label: "when", render: (r) => new Date(r.created_ms as number).toLocaleString() }, { key: "title", label: "alert" }, { key: "body", label: "detail", className: "max-w-[360px] text-muted-foreground" }, { key: "read", label: "", render: (r) => (r.read ? "" : <Verdict tone="warn">new</Verdict>) }, { key: "rate", label: "useful?", render: (r) => <div className="flex gap-2"><button type="button" aria-label="useful" onClick={() => act(() => api.post("/api/v1/alerts/rate", { id: r.id, rating: 1 }), "Rated")}><ThumbsUp className={`h-3.5 w-3.5 ${r.rating === 1 ? "text-emerald-400" : "text-muted-foreground"}`} /></button><button type="button" aria-label="not useful" onClick={() => act(() => api.post("/api/v1/alerts/rate", { id: r.id, rating: -1 }), "Rated")}><ThumbsDown className={`h-3.5 w-3.5 ${r.rating === -1 ? "text-rose-400" : "text-muted-foreground"}`} /></button></div> }]} />
      </Panel>
      <Note>Anchor (F-25) and ETA (F-28) alerts are presets over the same engine. An ETA alert means "the gap is long relative to history", never "a big round is due".</Note>
    </div>
  );
}
