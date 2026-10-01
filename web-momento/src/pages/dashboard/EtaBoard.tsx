// F-26 ETA Board · F-27 hazard timeline · F-29 in-round ETA
import { useState } from "react";
import { Loading, PageHeader, Panel } from "@/components/bits";
import { DataTable, MiniLines, Note, Verdict, ci, inputCls, pct, useV1 } from "@/components/v65/kit";

type Row = { threshold: number; events: number; currentGap: number; rate: number; kmPercentile: number; pressure: number; hazardNow: number; pNext: number; pWithin10: number; etaMedian: number; etaP90: number; etaMedianAt: string; etaP90At: string; medianGap: number; memoryless: { beta1: number; lo: number; hi: number; verdict: string }; hazardModel: { beatsKM: boolean; adjustedEtaMedian: number | null }; calibration: { n: number; beforeMedian: number; target: number }; note: string };
type Board = { cadenceMs: number; generatedAt: string; lastTs: string; rows: Row[]; intelligence?: Record<string, unknown> };
type Haz = { threshold: number; rate: number; currentGap: number; series: { g: number; hazard: number; lo: number; hi: number; atRisk: number }[] };
type InRound = { m0: number; sample: number; rows: { target: number; law: number; empirical: number; lo: number; hi: number; secondsFromStart: number; secondsFromNow: number }[]; note: string };

export default function EtaBoard() {
  const [T, setT] = useState(10);
  const [m0, setM0] = useState(1);
  const b = useV1<Board>("eta/board", { refetch: 10_000 });
  const h = useV1<Haz>(`eta/hazard?T=${T}`);
  const ir = useV1<InRound>(`eta/inround?m0=${m0}`);
  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="ETA Board" subtitle="Platform Book F-26/27/29. How long until the next ≥ T× round? Kaplan–Meier survival over gaps, a logistic hazard test for 'due' effects (memorylessness β₁), and the in-round clock. Honest by design: if gaps are memoryless, pressure is just a percentile, not a prediction." />
      <Panel title="Board">
        {b.isLoading ? <Loading rows={6} /> : (
          <DataTable rows={(b.data?.rows ?? []) as unknown as Record<string, unknown>[]} cols={[
            { key: "threshold", label: "≥ T×", render: (r) => <b>{String(r.threshold)}×</b> },
            { key: "currentGap", label: "gap now" },
            { key: "medianGap", label: "median gap" },
            { key: "kmPercentile", label: "KM pct", render: (r) => <span className={(r.kmPercentile as number) >= 0.9 ? "text-amber-400" : ""}>{pct(r.kmPercentile as number, 0)}</span> },
            { key: "pNext", label: "P(next)", render: (r) => pct(r.pNext as number) },
            { key: "pWithin10", label: "P(≤10)", render: (r) => pct(r.pWithin10 as number) },
            { key: "eta", label: "ETA median / p90", render: (r) => `${r.etaMedian} / ${r.etaP90} rounds` },
            { key: "at", label: "clock", render: (r) => `${new Date(String(r.etaMedianAt)).toLocaleTimeString()}` },
            { key: "memoryless", label: "memoryless β₁", render: (r) => { const m = r.memoryless as Row["memoryless"]; return <span title={m.verdict}>{m.beta1} {ci(m.lo, m.hi, 3)} <Verdict ok={m.lo <= 0 && m.hi >= 0}>{m.lo <= 0 && m.hi >= 0 ? "memoryless" : "due-effect?"}</Verdict></span>; } },
          ]} />
        )}
        {b.data && (
          <>
            <p className="mt-2 text-[11.5px] text-muted-foreground">Cadence {(b.data.cadenceMs / 1000).toFixed(1)} s · last round {new Date(b.data.lastTs).toLocaleString()}</p>
            {b.data.intelligence && (
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                Intelligence state: <span className="font-medium text-foreground">{String((b.data.intelligence as Record<string, unknown>).state ?? "N/A")}</span>
                {(b.data.intelligence as Record<string, unknown>).confidence && (
                  <span> · confidence {pct((b.data.intelligence as Record<string, unknown>).confidence as number)}</span>
                )}
              </p>
            )}
          </>
        )}
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={`Hazard timeline · P(≥ ${T}× at gap g)`} right={<select className={inputCls} value={T} onChange={(e) => setT(Number(e.target.value))}>{[2, 5, 10, 20, 50, 100].map((t) => <option key={t} value={t}>{t}×</option>)}</select>}>
          {h.data ? (
            <>
              <MiniLines yMin={0} series={[{ name: "hazard", color: "#06B6D4", points: h.data.series.map((s) => [s.g, s.hazard]) }, { name: "CI low", color: "#0e7490", dashed: true, points: h.data.series.map((s) => [s.g, s.lo]) }, { name: "CI high", color: "#0e7490", dashed: true, points: h.data.series.map((s) => [s.g, s.hi]) }, { name: "base rate", color: "#f59e0b", dashed: true, points: [[0, h.data.rate], [h.data.series.at(-1)?.g ?? 1, h.data.rate]] }]} />
              <p className="mt-1 text-[11.5px] text-muted-foreground">A flat line at the base rate means no gap is ever "due". Current gap: {h.data.currentGap}.</p>
            </>
          ) : <Loading />}
        </Panel>
        <Panel title="In-round ETA" right={<input className={`${inputCls} w-24`} type="number" min={1} step={0.1} value={m0} onChange={(e) => setM0(Math.max(1, Number(e.target.value)))} title="current in-flight multiplier" />}>
          {ir.data ? (
            <>
              <DataTable rows={ir.data.rows as unknown as Record<string, unknown>[]} cols={[{ key: "target", label: "target" }, { key: "law", label: "P law", render: (r) => pct(r.law as number) }, { key: "empirical", label: "P tape", render: (r) => pct(r.empirical as number) }, { key: "ci", label: "CI", render: (r) => ci(r.lo as number, r.hi as number, 3) }, { key: "secondsFromNow", label: "seconds from now" }]} />
              <Note>{ir.data.note}</Note>
            </>
          ) : <Loading />}
        </Panel>
      </div>
    </div>
  );
}
