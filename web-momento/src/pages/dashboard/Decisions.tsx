// F-30 Decision Ledger + producer leaderboard · F-31 Auto-Tells v2 (fractional Kelly on the CI lower bound)
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { safeStorage } from "@/lib/storage";
import { Loading, PageHeader, Panel } from "@/components/bits";
import { DataTable, Field, Note, Verdict, btnCls, ci, inputCls, pct, useV1 } from "@/components/v65/kit";

type Lb = { producers: { producer: string; total: number; resolved: number; acted: number; hitRate: number; baseRate: number; delta: number; deltaLo: number; deltaHi: number; pnlPer100: number; drawdown: number; guardVetoes: number; ranked: boolean }[]; reconciliation: { autopilotRows: number; ledgerRows: number; mismatches: number } };
type Tells = { kappa: number; tells: { target: number; n: number; pHat: number; pLower: number; ev: number; evLower: number; fraction: number; action: string; reasons: string[] }[]; rule: string };

export default function Decisions() {
  const qc = useQueryClient();
  const lb = useV1<Lb>("decisions/leaderboard", { refetch: 20_000 });
  const rows = useV1<{ rows: Record<string, unknown>[] }>("decisions", { refetch: 15_000 });
  const tells = useV1<Tells>("tells", { refetch: 30_000 });
  const [target, setTarget] = useState(2);
  const [stake, setStake] = useState(1);
  const [action, setAction] = useState("stake");
  const record = async () => {
    let id = safeStorage.getItem("momento.clientId");
    if (!id) { id = Math.random().toString(36).slice(2, 12); safeStorage.setItem("momento.clientId", id); }
    try { await api.post("/api/v1/decisions", { target, stake, action, clientId: id, reason: "manual entry" }); toast.success("Decision recorded; it resolves on the next round"); qc.invalidateQueries({ queryKey: ["v65"] }); } catch (e) { toast.error(String(e)); }
  };
  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="Decision Ledger" subtitle="Platform Book F-30/F-31. Every decision — autopilot, auto-tells or a person — is written before the round and resolved after it. Producers are ranked by hit-rate delta over the base rate with a confidence interval, not by raw profit." />
      <Panel title="Producer leaderboard">
        {lb.isLoading ? <Loading /> : (
          <>
            <DataTable rows={(lb.data?.producers ?? []) as unknown as Record<string, unknown>[]} cols={[
              { key: "producer", label: "producer" }, { key: "total", label: "decisions" }, { key: "acted", label: "acted" },
              { key: "hitRate", label: "hit", render: (r) => pct(r.hitRate as number) }, { key: "baseRate", label: "base", render: (r) => pct(r.baseRate as number) },
              { key: "delta", label: "Δ vs base", render: (r) => <span>{pct(r.delta as number)} <span className="text-muted-foreground">{ci(r.deltaLo as number, r.deltaHi as number, 2)}</span></span> },
              { key: "pnlPer100", label: "P&L /100" }, { key: "drawdown", label: "max DD" }, { key: "guardVetoes", label: "vetoes" },
              { key: "ranked", label: "", render: (r) => <Verdict ok={(r.deltaLo as number) > 0 ? true : null}>{(r.deltaLo as number) > 0 ? "edge" : r.ranked ? "no edge" : "provisional"}</Verdict> },
            ]} />
            {lb.data && <p className="mt-2 text-[11.5px] text-muted-foreground">Reconciliation: {lb.data.reconciliation.autopilotRows} autopilot rows ↔ {lb.data.reconciliation.ledgerRows} ledger rows · {lb.data.reconciliation.mismatches} mismatches</p>}
          </>
        )}
      </Panel>
      <div className="grid gap-4 lg:grid-cols-5">
        <Panel title="Auto-Tells v2 (κ-fractional Kelly on the lower bound)" className="lg:col-span-3">
          {tells.data ? (
            <>
              <DataTable rows={tells.data.tells as unknown as Record<string, unknown>[]} cols={[{ key: "target", label: "cash out" }, { key: "n", label: "n" }, { key: "pHat", label: "p̂", render: (r) => pct(r.pHat as number) }, { key: "pLower", label: "p lower", render: (r) => pct(r.pLower as number) }, { key: "evLower", label: "EV (lower)", render: (r) => (r.evLower as number).toFixed(4) }, { key: "fraction", label: "stake %", render: (r) => pct(r.fraction as number, 2) }, { key: "action", label: "tell", render: (r) => <Verdict ok={r.action === "stake" ? true : null}>{String(r.action)}</Verdict> }]} />
              <Note>{tells.data.rule}</Note>
            </>
          ) : <Loading />}
        </Panel>
        <Panel title="Record a decision" className="lg:col-span-2">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Target ×"><input className={inputCls} type="number" min={1.01} step={0.1} value={target} onChange={(e) => setTarget(Number(e.target.value))} /></Field>
            <Field label="Stake"><input className={inputCls} type="number" min={0} value={stake} onChange={(e) => setStake(Number(e.target.value))} /></Field>
            <Field label="Action"><select className={inputCls} value={action} onChange={(e) => setAction(e.target.value)}><option value="stake">stake</option><option value="skip">skip</option></select></Field>
          </div>
          <button type="button" className={`${btnCls} mt-3`} onClick={record}>Record before the round</button>
        </Panel>
      </div>
      <Panel title="Ledger">
        <DataTable rows={rows.data?.rows ?? []} cols={[{ key: "id", label: "#" }, { key: "producer", label: "producer" }, { key: "action", label: "action" }, { key: "target", label: "target" }, { key: "stake", label: "stake" }, { key: "created_ms", label: "made", render: (r) => new Date(r.created_ms as number).toLocaleString() }, { key: "outcome", label: "outcome", render: (r) => (r.outcome == null ? <Verdict>open</Verdict> : <Verdict ok={r.outcome === "hit"}>{String(r.outcome)}</Verdict>) }, { key: "pnl", label: "P&L" }]} />
      </Panel>
    </div>
  );
}
