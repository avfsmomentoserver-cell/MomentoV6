// F-34 Experiment Registry: hypothesis → drafted spec → pre-registered split test with shuffle baseline and power
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/state/auth";
import { Loading, PageHeader, Panel } from "@/components/bits";
import { DataTable, Field, Note, Verdict, btnCls, btnGhost, inputCls, pct, useV1 } from "@/components/v65/kit";

type Spec = { name: string; hypothesis: string; condition: { kind: string; x?: number; k?: number; pattern?: string }; target: { x: number; h: number }; split?: number };
const verdictTone = (v: string) => (v === "supported" ? "good" : v === "rejected" ? "bad" : "warn") as "good" | "bad" | "warn";

export default function Experiments() {
  const { isOperator } = useAuth();
  const qc = useQueryClient();
  const list = useV1<{ rows: Record<string, unknown>[] }>("experiments", { refetch: 30_000 });
  const [text, setText] = useState("after 3 rounds below 2x the next round is above 2x");
  const [spec, setSpec] = useState<Spec | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, unknown> | null>(null);
  const draft = async () => { try { setSpec((await api.post<{ spec: Spec }>("/api/v1/experiments/draft", { hypothesis: text })).spec); } catch (e) { toast.error(String(e)); } };
  const runIt = async () => {
    if (!spec) return;
    setBusy(true);
    try { const r = await api.post<Record<string, unknown>>("/api/v1/experiments", { spec }); setOpen(r); toast.success(`Experiment #${r.id}: ${r.verdict}`); qc.invalidateQueries({ queryKey: ["v65"] }); } catch (e) { toast.error(String(e)); } finally { setBusy(false); }
  };
  const promote = async (id: number) => { try { const r = await api.post<{ key: string }>(`/api/v1/experiments/${id}/promote`); toast.success(`Promoted to ${r.key} (shadow)`); qc.invalidateQueries({ queryKey: ["v65"] }); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } };
  const view = async (id: number) => setOpen(await api.get<Record<string, unknown>>(`/api/v1/experiments/${id}`));
  const upd = (path: string[], v: unknown) => { if (!spec) return; const s = structuredClone(spec) as unknown as Record<string, Record<string, unknown>>; if (path.length === 1) (s as unknown as Record<string, unknown>)[path[0]] = v; else s[path[0]][path[1]] = v; setSpec(s as unknown as Spec); };
  const res = open?.result as { train: { n: number; rate: number; base: number; p: number }; test: { n: number; rate: number; base: number; p: number; diff: number }; shuffle: { runs: number; p: number }; power: number; sameSign: boolean } | undefined;
  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="Experiment Registry" subtitle="Platform Book F-34. Write a hypothesis in plain words; the parser drafts a spec that a person reviews. Each run is pre-registered: train/test split, Benjamini–Hochberg correction across the family, a shuffled-tape baseline, and a planted-effect power check — so 'no effect' is only reported when the test could have found one." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="1 · Hypothesis">
          <textarea className={`${inputCls} h-20 w-full py-2`} value={text} onChange={(e) => setText(e.target.value)} />
          <button type="button" className={`${btnGhost} mt-2`} onClick={draft}>Draft spec</button>
          {spec && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Condition"><select className={inputCls} value={spec.condition.kind} onChange={(e) => upd(["condition", "kind"], e.target.value)}>{["streak_below", "streak_above", "after_at_least", "after_below", "gap_since", "sequence"].map((k) => <option key={k}>{k}</option>)}</select></Field>
              <Field label="Condition x"><input className={inputCls} type="number" value={spec.condition.x ?? 2} onChange={(e) => upd(["condition", "x"], Number(e.target.value))} /></Field>
              <Field label="Condition k"><input className={inputCls} type="number" value={spec.condition.k ?? 3} onChange={(e) => upd(["condition", "k"], Number(e.target.value))} /></Field>
              <Field label="Pattern (L M H V X Z)"><input className={inputCls} value={spec.condition.pattern ?? ""} onChange={(e) => upd(["condition", "pattern"], e.target.value)} /></Field>
              <Field label="Target ≥ x"><input className={inputCls} type="number" value={spec.target.x} onChange={(e) => upd(["target", "x"], Number(e.target.value))} /></Field>
              <Field label="Within h rounds"><input className={inputCls} type="number" value={spec.target.h} onChange={(e) => upd(["target", "h"], Number(e.target.value))} /></Field>
              <button type="button" className={`${btnCls} col-span-2`} disabled={busy} onClick={runIt}>{busy ? "Running…" : "2 · Approve & run"}</button>
            </div>
          )}
        </Panel>
        <Panel title="Result">
          {res ? (
            <div className="space-y-2 text-[13px]">
              <p className="font-medium">#{String(open?.id)} {String(open?.name)}</p>
              <Verdict tone={verdictTone(String(open?.verdict))}>{String(open?.verdict)}</Verdict>
              <p>Train: {pct(res.train.rate)} vs base {pct(res.train.base)} (n {res.train.n}, p {res.train.p})</p>
              <p>Test: {pct(res.test.rate)} vs base {pct(res.test.base)} (n {res.test.n}, p {res.test.p}, q {String(open?.q)})</p>
              <p>Shuffle baseline: p {res.shuffle.p} over {res.shuffle.runs} shuffles · power {pct(res.power, 0)} · same sign {res.sameSign ? "yes" : "no"}</p>
              {typeof open?.reason === "string" && <Note>{open.reason}</Note>}
            </div>
          ) : <p className="text-[12.5px] text-muted-foreground">Run or open an experiment.</p>}
        </Panel>
      </div>
      <Panel title="Registry">
        {list.isLoading ? <Loading /> : <DataTable rows={list.data?.rows ?? []} cols={[{ key: "id", label: "#" }, { key: "name", label: "name", className: "max-w-[320px]" }, { key: "family", label: "family" }, { key: "q", label: "q" }, { key: "verdict", label: "verdict", render: (r) => <Verdict tone={verdictTone(String(r.verdict))}>{String(r.verdict)}</Verdict> }, { key: "lifecycle", label: "lifecycle" }, { key: "engine_key", label: "engine" }, { key: "act", label: "", render: (r) => <div className="flex gap-2"><button type="button" className="text-[11px] text-primary underline" onClick={() => view(r.id as number)}>open</button>{isOperator && r.verdict === "supported" && !r.engine_key && <button type="button" className="text-[11px] text-emerald-400 underline" onClick={() => promote(r.id as number)}>promote</button>}</div> }]} />}
      </Panel>
    </div>
  );
}
