// F-17 Reliability Studio: reliability diagram, Murphy decomposition, PIT histogram, adaptive conformal coverage
import { useState } from "react";
import { Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";
import { MiniBars, MiniLines, Note, Verdict, ci, inputCls, pct, useV1 } from "@/components/v65/kit";

type Rel = { ledger: string; model: string; threshold: number; n: number; brier: number; climatology: number; bss: number; bssCI: [number, number]; murphy: { reliability: number; resolution: number; uncertainty: number }; table: { bin: number; lo: number; hi: number; n: number; meanP: number; observed: number; ciLo: number; ciHi: number }[] };
type Pit = { bins: { bin: number; count: number; share: number }[]; n: number; chi2: number; p: number; uniform: boolean };
type Cov = { n: number; target: number; raw: number; aci: number; rawError: number; aciError: number; alphaNow: number; trail: { i: number; raw: number; aci: number; alpha: number }[]; passes: boolean };

export default function ReliabilityPage() {
  const [T, setT] = useState(2);
  const [ledger, setLedger] = useState("stored");
  const rel = useV1<Rel>(`accuracy/reliability?threshold=${T}&ledger=${ledger}`);
  const pit = useV1<Pit>(`accuracy/pit?ledger=${ledger}`);
  const cov = useV1<Cov>(`accuracy/coverage?ledger=${ledger}`);
  const r = rel.data;
  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Reliability Studio"
        subtitle="Platform Book F-17. Does a 60% forecast come true 60% of the time? Scored only from forecasts stored at creation (the tamper-evident ledger), never recomputed after the fact."
        actions={
          <>
            <select className={inputCls} value={T} onChange={(e) => setT(Number(e.target.value))}>{[1.5, 2, 5, 10].map((t) => <option key={t} value={t}>P(≥ {t}×)</option>)}</select>
            <select className={inputCls} value={ledger} onChange={(e) => setLedger(e.target.value)}><option value="stored">stored ledger</option><option value="calibration">calibration backtest</option></select>
          </>
        }
      />
      {rel.isLoading ? <Loading rows={5} /> : r && (
        <>
          <MetricGrid>
            <StatTile label="Brier skill vs climatology" value={r.bss.toFixed(4)} sub={`95% CI ${ci(r.bssCI?.[0], r.bssCI?.[1])} · n=${r.n}`} tone={r.bssCI?.[0] > 0 ? "good" : r.bssCI?.[1] < 0 ? "bad" : "warn"} pulse />
            <StatTile label="Brier" value={r.brier.toFixed(4)} sub={`climatology ${r.climatology.toFixed(4)}`} />
            <StatTile label="Murphy: reliability" value={r.murphy.reliability.toFixed(4)} sub="lower is better" />
            <StatTile label="Murphy: resolution" value={r.murphy.resolution.toFixed(4)} sub={`uncertainty ${r.murphy.uncertainty.toFixed(4)}`} tone="signal" />
          </MetricGrid>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={`Reliability diagram · P(≥ ${T}×)`}>
              <MiniLines diagonal yMin={0} yMax={1} series={[{ name: "observed frequency", color: "#06B6D4", points: r.table.filter((b) => b.n > 0).map((b) => [b.meanP, b.observed]) }, { name: "perfect", color: "#64748b", dashed: true, points: [[0, 0], [1, 1]] }]} />
              <table className="mt-3 w-full font-data text-[11px]">
                <thead><tr className="text-left text-muted-foreground"><th>bin</th><th>n</th><th>mean p</th><th>observed</th><th>Wilson CI</th></tr></thead>
                <tbody>{r.table.filter((b) => b.n > 0).map((b) => <tr key={b.bin} className="border-t border-border/40"><td>{b.lo.toFixed(1)}–{b.hi.toFixed(1)}</td><td>{b.n}</td><td>{b.meanP.toFixed(3)}</td><td>{b.observed.toFixed(3)}</td><td>{ci(b.ciLo, b.ciHi, 2)}</td></tr>)}</tbody>
              </table>
            </Panel>
            <Panel title="PIT histogram (probability integral transform)">
              {pit.data ? (
                <>
                  <MiniBars values={pit.data.bins.map((b) => b.share)} labels={pit.data.bins.map((b) => String(b.bin))} height={150} />
                  <p className="mt-2 text-[12px] text-muted-foreground">Flat = calibrated across the whole distribution. χ² {pit.data.chi2} · p {pit.data.p} · <Verdict ok={pit.data.uniform}>{pit.data.uniform ? "uniform" : "not uniform"}</Verdict></p>
                </>
              ) : <Loading />}
            </Panel>
          </div>
          <Panel title="Adaptive conformal coverage of the 50% range">
            {cov.data ? (
              <>
                <div className="mb-2 flex flex-wrap gap-4 text-[12.5px]">
                  <span>raw coverage <b className="font-data">{pct(cov.data.raw)}</b> (error {pct(cov.data.rawError)})</span>
                  <span>ACI coverage <b className="font-data">{pct(cov.data.aci)}</b> (error {pct(cov.data.aciError)})</span>
                  <span>target {pct(cov.data.target, 0)}</span>
                  <Verdict ok={cov.data.passes}>{cov.data.passes ? "within 2 pts" : "off target"}</Verdict>
                </div>
                <MiniLines yMin={0} yMax={1} series={[{ name: "raw running coverage", color: "#f59e0b", points: cov.data.trail.map((t) => [t.i, t.raw]) }, { name: "ACI running coverage", color: "#06B6D4", points: cov.data.trail.map((t) => [t.i, t.aci]) }, { name: "target", color: "#64748b", dashed: true, points: [[1, cov.data.target], [cov.data.n, cov.data.target]] }]} />
              </>
            ) : <Loading />}
          </Panel>
          <Note>A negative skill with a confidence interval that crosses zero means the forecast is indistinguishable from the measured base rate. The book's rule: say so plainly rather than dress it up.</Note>
        </>
      )}
    </div>
  );
}
