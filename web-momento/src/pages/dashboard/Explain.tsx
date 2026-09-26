// F-35 Explain-this-forecast · F-14 forecast diff · F-15 distribution explorer
import { useEffect } from "react";
import { api } from "@/lib/api";
import { Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";
import { DataTable, MiniLines, Note, Verdict, useV1 } from "@/components/v65/kit";

type Explain = { available: boolean; forecastId: number; createdAt: string; headline: { expected: number; lo: number; hi: number; reach: number; state: string; baselineMid: number; mixtureMid: number }; dimensions: { dimension: string; value: string; engine: string; skill: number; informative: boolean }[]; waterfall: { key: string; weight: number; engineMid: number; contribution: number; skill: number; skillVerdict: string }[]; signals: { key: string; label: string; active: boolean; lift: number; significant: boolean }[]; wouldChange: string[]; narrator: { sentence: string; numbersCheck: { ok: boolean; unknown: string[] } } };
type Diff = { available: boolean; from: { id: number; at: string; state: string; expected: number; lo: number; hi: number; reach: number }; to: Diff["from"]; delta: { expected: number; lo: number; hi: number; reach: number; stateChanged: boolean }; topEngines: { key: string; weightFrom: number; weightTo: number; deltaLog: number; deltaWeight: number }[]; bandShift: { band: string; from: number; to: number; delta: number }[] };
type Dist = { forecastId: number; bands: string[]; mixture: number[]; engines: { key: string; weight: number; dist: number[] }[]; survival: { x: number; mixture: number; base: number; law: number }[] };

export default function Explain() {
  const ex = useV1<Explain>("forecast/latest/explain", { refetch: 20_000 });
  const diff = useV1<Diff>("forecast/diff", { refetch: 20_000 });
  const dist = useV1<Dist>("intelligence/distribution", { refetch: 20_000 });
  useEffect(() => { api.post("/api/v1/events", { kind: "explain.open" }).catch(() => undefined); }, []);
  const e = ex.data;
  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="Explain this forecast" subtitle="Platform Book F-35/F-14/F-15. Why the latest stored forecast says what it says: which engines moved it, which signals are active (and whether they're significant), what changed since the previous forecast, and the full distribution." />
      {ex.isLoading ? <Loading rows={6} /> : !e?.available ? <Note>No stored forecast yet — ingest a round or back-fill the ledger on the Track Record page.</Note> : (
        <>
          <MetricGrid>
            <StatTile label={`Forecast #${e.forecastId}`} value={`${e.headline.expected}×`} sub={`50% range ${e.headline.lo}–${e.headline.hi}× · ${e.headline.state}`} pulse tone="signal" />
            <StatTile label="Moonshot reach (p90)" value={`${e.headline.reach}×`} sub={`stored ${new Date(e.createdAt).toLocaleTimeString()}`} />
            <StatTile label="Baseline median" value={`${e.headline.baselineMid}×`} sub={`mixture median ${e.headline.mixtureMid}×`} />
            <StatTile label="Narrator numbers check" value={e.narrator.numbersCheck.ok ? "PASS" : "FAIL"} sub={e.narrator.numbersCheck.ok ? "every number traces to data" : `unknown: ${e.narrator.numbersCheck.unknown.join(", ")}`} tone={e.narrator.numbersCheck.ok ? "good" : "bad"} />
          </MetricGrid>
          <Panel title="In plain words"><p className="text-[14px] leading-relaxed">{e.narrator.sentence}</p></Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Waterfall — how each engine pulled the median">
              <div className="space-y-1.5">
                {e.waterfall.map((w) => {
                  const mx = Math.max(0.01, ...e.waterfall.map((x) => Math.abs(x.contribution)));
                  return (
                    <div key={w.key} className="grid grid-cols-[90px_1fr_70px] items-center gap-2 text-[12px]">
                      <span className="truncate font-data">{w.key}</span>
                      <div className="relative h-3 rounded bg-muted/40"><div className="absolute top-0 h-3 rounded" style={{ left: w.contribution >= 0 ? "50%" : `${50 - (Math.abs(w.contribution) / mx) * 50}%`, width: `${(Math.abs(w.contribution) / mx) * 50}%`, background: w.contribution >= 0 ? "#10b981" : "#f43f5e" }} /><div className="absolute left-1/2 top-0 h-3 w-px bg-border" /></div>
                      <span className="text-right font-data">{w.contribution >= 0 ? "+" : ""}{w.contribution.toFixed(2)}×</span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[11.5px] text-muted-foreground">Contribution = weight × (engine median − baseline median).</p>
            </Panel>
            <Panel title="Dimensions">
              <DataTable rows={e.dimensions as unknown as Record<string, unknown>[]} cols={[{ key: "dimension", label: "dimension" }, { key: "value", label: "value" }, { key: "engine", label: "engine" }, { key: "informative", label: "", render: (r) => <Verdict ok={r.informative as boolean}>{r.informative ? "informative" : "not proven"}</Verdict> }]} />
              <p className="mb-1 mt-3 text-[11px] uppercase tracking-wider text-muted-foreground">What would change it</p>
              <ul className="list-disc space-y-0.5 pl-5 text-[12.5px]">{e.wouldChange.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </Panel>
          </div>
          <Panel title="Active signals">
            <div className="flex flex-wrap gap-2">{e.signals.map((s) => <span key={s.key} className="rounded-md border border-border px-2 py-1 text-[12px]">{s.label} <span className="font-data">×{s.lift?.toFixed(2)}</span> <Verdict ok={s.significant}>{s.significant ? "significant" : "noise"}</Verdict></span>)}</div>
          </Panel>
        </>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Forecast diff (previous → latest)">
          {diff.data?.available ? (
            <>
              <p className="text-[13px]">#{diff.data.from.id} {diff.data.from.expected}× ({diff.data.from.state}) → #{diff.data.to.id} {diff.data.to.expected}× ({diff.data.to.state}) · Δ {diff.data.delta.expected >= 0 ? "+" : ""}{diff.data.delta.expected}× {diff.data.delta.stateChanged && <Verdict tone="warn">state changed</Verdict>}</p>
              <DataTable rows={diff.data.topEngines as unknown as Record<string, unknown>[]} cols={[{ key: "key", label: "engine" }, { key: "weightFrom", label: "w from" }, { key: "weightTo", label: "w to" }, { key: "deltaLog", label: "Δ log-median" }]} />
              <DataTable rows={diff.data.bandShift as unknown as Record<string, unknown>[]} cols={[{ key: "band", label: "band" }, { key: "from", label: "from" }, { key: "to", label: "to" }, { key: "delta", label: "Δ" }]} />
            </>
          ) : <Loading />}
        </Panel>
        <Panel title="Distribution explorer — survival P(X ≥ x)">
          {dist.data ? (
            <MiniLines yMin={0} yMax={1} series={[{ name: "mixture", color: "#06B6D4", points: dist.data.survival.map((s) => [Math.log10(s.x), s.mixture]) }, { name: "empirical base", color: "#f59e0b", points: dist.data.survival.map((s) => [Math.log10(s.x), s.base]) }, { name: "0.97/x law", color: "#64748b", dashed: true, points: dist.data.survival.map((s) => [Math.log10(s.x), s.law]) }]} />
          ) : <Loading />}
          <p className="mt-1 text-[11px] text-muted-foreground">x-axis: log10(multiplier). Where the curves overlap, the forecast adds nothing over the base rate.</p>
        </Panel>
      </div>
    </div>
  );
}
