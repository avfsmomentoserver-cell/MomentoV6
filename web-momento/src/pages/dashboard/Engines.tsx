// F-09 Workbench · F-12 registry · F-13 regime weights · F-16 counterfactual · F-20 auto-demotion history
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/state/auth";
import { Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, Field, Note, Verdict, btnCls, btnGhost, ci, inputCls, useV1 } from "@/components/v65/kit";

type Param = { key: string; label: string; min: number; max: number; default: number; step?: number };
type Families = Record<string, { label: string; params: Param[] }>;
type Eng = { key: string; label: string; kind: string; family: string | null; state: string; owner: string; n: number; logLoss: number; skill: number; skillPct: number; lo: number; hi: number; avgWeight: number; verdict: string; admission: Record<string, unknown> | null };
type Board = { ledger: string; n: number; mixture: { n: number; skill: number; lo: number; hi: number; logLoss: number; baseLogLoss: number }; engines: Eng[]; families: Families };
type Mix = { keys: string[]; trainN: number; testN: number; global: Record<string, number>; byState: Record<string, { n: number; weights: Record<string, number> }>; heldOutGain: number; lo: number; hi: number; real: boolean; note: string };
type Cf = { rows: { without: string; n: number; withLogLoss: number; withoutLogLoss: number; marginalValue: number; lo: number; hi: number; verdict: string }[] };
type Run = { id: number; spec: { family: string; params: Record<string, number> }; result: { n: number; logLoss: number; skill: number; lo: number; hi: number }; created: number };

const stateTone = (s: string) => (s === "live" ? "good" : s === "shadow" ? "warn" : s === "demoted" ? "bad" : "muted") as "good" | "warn" | "bad" | "muted";

export default function Engines() {
  const { isOperator } = useAuth();
  const qc = useQueryClient();
  const board = useV1<Board>("engines", { refetch: 30_000 });
  const mix = useV1<Mix>("mixture");
  const cf = useV1<Cf>("accuracy/counterfactual");
  const runs = useV1<{ runs: Run[] }>("workbench/runs");
  const [fam, setFam] = useState("ewma");
  const [params, setParams] = useState<Record<string, number>>({});
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState<{ key: string; rows: Record<string, unknown>[] } | null>(null);
  const families = board.data?.families ?? {};
  const famDef = families[fam];
  const refresh = () => qc.invalidateQueries({ queryKey: ["v65"] });

  const run = async (register: boolean) => {
    setBusy(true);
    try {
      const p = Object.fromEntries((famDef?.params ?? []).map((x) => [x.key, params[x.key] ?? x.default]));
      if (register) {
        const r = await api.post<{ key: string; state: string; admission: { passed: boolean } }>("/api/v1/engines", { family: fam, params: p });
        toast[r.admission.passed ? "success" : "error"](`${r.key}: ${r.admission.passed ? "admitted in shadow mode" : "failed admission"}`);
        refresh();
      } else {
        setResult(await api.post<Record<string, unknown>>("/api/v1/workbench/run", { family: fam, params: p, n: 400 }));
        runs.refetch();
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const setState = async (key: string, state: string) => {
    try { await api.post(`/api/v1/engines/${encodeURIComponent(key)}/state`, { state, reason: "operator change" }); toast.success(`${key} → ${state}`); refresh(); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };
  const showHist = async (key: string) => setHist({ key, rows: (await api.get<{ history: Record<string, unknown>[] }>(`/api/v1/engines/${encodeURIComponent(key)}/history`)).history });
  const demotionCheck = async () => { try { const r = await api.post<Record<string, unknown>>("/api/v1/engines/demotion-check"); toast.success(`demotion check: ${JSON.stringify(r).slice(0, 120)}`); refresh(); } catch (e) { toast.error(String(e)); } };

  const m = board.data?.mixture;
  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="Engine Registry & Workbench" subtitle="Platform Book F-09/12/13/16/20. Engines earn weight from their scored log-loss. New engines pass admission tests, then run in shadow mode before they can go live; engines that stop paying are demoted automatically." actions={isOperator ? <button type="button" className={btnGhost} onClick={demotionCheck}>Run demotion check</button> : null} />
      {board.isLoading ? <Loading rows={5} /> : m && (
        <MetricGrid>
          <StatTile label="Mixture skill vs baseline" value={`${(m.skill * 100).toFixed(2)}%`} sub={`95% CI ${ci(m.lo, m.hi, 4)} · n=${m.n}`} tone={m.lo > 0 ? "good" : m.hi < 0 ? "bad" : "warn"} pulse />
          <StatTile label="Mixture log-loss" value={m.logLoss.toFixed(4)} sub={`baseline ${m.baseLogLoss.toFixed(4)}`} />
          <StatTile label="Engines" value={board.data!.engines.length} sub={`${board.data!.engines.filter((e) => e.state === "live").length} live · ${board.data!.engines.filter((e) => e.state === "shadow").length} shadow`} />
          <StatTile label="Ledger" value={board.data!.ledger} sub="stored forecasts preferred; calibration backtest as fallback" tone="signal" />
        </MetricGrid>
      )}
      <Tabs defaultValue="registry">
        <TabsList><TabsTrigger value="registry">Registry</TabsTrigger><TabsTrigger value="workbench">Workbench</TabsTrigger><TabsTrigger value="regimes">Regime weights</TabsTrigger><TabsTrigger value="counterfactual">Counterfactual</TabsTrigger></TabsList>
        <TabsContent value="registry">
          <Panel>
            <DataTable rows={(board.data?.engines ?? []) as unknown as Record<string, unknown>[]} max={560} cols={[
              { key: "label", label: "engine", render: (r) => <span><b>{String(r.label)}</b><br /><span className="text-muted-foreground">{String(r.key)}</span></span> },
              { key: "state", label: "state", render: (r) => <Verdict tone={stateTone(String(r.state))}>{String(r.state)}</Verdict> },
              { key: "kind", label: "kind" },
              { key: "n", label: "n" },
              { key: "skillPct", label: "skill", render: (r) => `${Number(r.skillPct ?? 0).toFixed(2)}%` },
              { key: "ci", label: "95% CI", render: (r) => ci(r.lo as number, r.hi as number, 4) },
              { key: "avgWeight", label: "avg weight", render: (r) => Number(r.avgWeight ?? 0).toFixed(3) },
              { key: "verdict", label: "verdict", className: "max-w-[220px] text-muted-foreground" },
              { key: "act", label: "", render: (r) => (
                <div className="flex flex-wrap gap-1">
                  <button type="button" className="text-[11px] text-primary underline" onClick={() => showHist(String(r.key))}>history</button>
                  {isOperator && r.key !== "baseline" && ["live", "shadow", "demoted", "retired"].filter((s) => s !== r.state).map((s) => <button key={s} type="button" className="text-[11px] text-muted-foreground underline hover:text-foreground" onClick={() => setState(String(r.key), s)}>{s}</button>)}
                </div>
              ) },
            ]} />
            {hist && <div className="mt-3"><p className="mb-1 text-[12px] text-muted-foreground">History · {hist.key}</p><DataTable rows={hist.rows} cols={[{ key: "created_ms", label: "when", render: (r) => new Date(r.created_ms as number).toLocaleString() }, { key: "from_state", label: "from" }, { key: "to_state", label: "to" }, { key: "reason", label: "reason" }, { key: "actor", label: "by" }]} empty="No state changes yet." /></div>}
          </Panel>
        </TabsContent>
        <TabsContent value="workbench">
          <div className="grid gap-4 lg:grid-cols-5">
            <Panel title="Build an engine" className="lg:col-span-2">
              <div className="space-y-3">
                <Field label="Family"><select className={inputCls} value={fam} onChange={(e) => { setFam(e.target.value); setParams({}); }}>{Object.entries(families).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
                {famDef?.params.map((p) => (
                  <Field key={p.key} label={`${p.label} (${p.min}–${p.max})`}>
                    <input className={inputCls} type="number" min={p.min} max={p.max} step={p.step ?? "any"} value={params[p.key] ?? p.default} onChange={(e) => setParams({ ...params, [p.key]: Number(e.target.value) })} />
                  </Field>
                ))}
                <div className="flex gap-2">
                  <button type="button" className={btnCls} disabled={busy} onClick={() => run(false)}>Backtest (walk-forward)</button>
                  {isOperator && <button type="button" className={btnGhost} disabled={busy} onClick={() => run(true)}>Register → shadow</button>}
                </div>
                <Note>Scored causally: each round is forecast only from rounds before it. Registration runs admission tests — determinism, causality, valid distributions, a null-tape check, and not-a-stub.</Note>
              </div>
            </Panel>
            <Panel title="Result" className="lg:col-span-3">
              {result ? (
                <div className="space-y-1 text-[13px]">
                  <p>log-loss <b className="font-data">{String(result.logLoss)}</b> · skill vs baseline <b className="font-data">{(Number(result.skill) * 100).toFixed(2)}%</b> {ci(result.lo as number, result.hi as number, 4)} · n {String(result.n)}</p>
                  <Verdict ok={Number(result.lo) > 0 ? true : Number(result.hi) < 0 ? false : null}>{Number(result.lo) > 0 ? "beats baseline" : Number(result.hi) < 0 ? "worse than baseline" : "indistinguishable from baseline"}</Verdict>
                </div>
              ) : <p className="text-[12.5px] text-muted-foreground">Run a backtest to see its causal score.</p>}
              <p className="mb-1 mt-4 text-[11px] uppercase tracking-wider text-muted-foreground">Recent runs</p>
              <DataTable rows={(runs.data?.runs ?? []) as unknown as Record<string, unknown>[]} max={260} cols={[{ key: "id", label: "#" }, { key: "spec", label: "spec", render: (r) => { const s = r.spec as Run["spec"]; return `${s.family} ${JSON.stringify(s.params)}`; } }, { key: "ll", label: "log-loss", render: (r) => String((r.result as Run["result"])?.logLoss) }, { key: "sk", label: "skill", render: (r) => `${(((r.result as Run["result"])?.skill ?? 0) * 100).toFixed(2)}%` }]} />
            </Panel>
          </div>
        </TabsContent>
        <TabsContent value="regimes">
          <Panel title="Weights by regime (state) with shrinkage to the global mix">
            {mix.data ? (
              <>
                <DataTable rows={[{ state: "global", n: mix.data.trainN, ...mix.data.global }, ...Object.entries(mix.data.byState).map(([k, v]) => ({ state: k, n: v.n, ...v.weights }))] as Record<string, unknown>[]} cols={[{ key: "state", label: "regime" }, { key: "n", label: "n" }, ...mix.data.keys.map((k) => ({ key: k, label: k, render: (r: Record<string, unknown>) => Number(r[k] ?? 0).toFixed(3) }))]} />
                <p className="mt-3 text-[12.5px]">Held-out gain from regime weights: <b className="font-data">{mix.data.heldOutGain}</b> {ci(mix.data.lo, mix.data.hi, 4)} · <Verdict ok={mix.data.real}>{mix.data.real ? "real" : "not significant"}</Verdict></p>
                <Note>{mix.data.note}</Note>
              </>
            ) : <Loading />}
          </Panel>
        </TabsContent>
        <TabsContent value="counterfactual">
          <Panel title="What if we removed each engine? (leave-one-out, re-normalised weights)">
            {cf.data ? <DataTable rows={cf.data.rows as unknown as Record<string, unknown>[]} cols={[{ key: "without", label: "without" }, { key: "n", label: "n" }, { key: "withLogLoss", label: "with" }, { key: "withoutLogLoss", label: "without" }, { key: "marginalValue", label: "marginal value" }, { key: "ci", label: "95% CI", render: (r) => ci(r.lo as number, r.hi as number, 4) }, { key: "verdict", label: "verdict", render: (r) => <Verdict ok={(r.lo as number) > 0 ? true : (r.hi as number) < 0 ? false : null}>{String(r.verdict)}</Verdict> }]} /> : <Loading />}
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
