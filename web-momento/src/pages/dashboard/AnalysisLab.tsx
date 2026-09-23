import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Activity, ArrowUpRight, BrainCircuit, Radar } from "lucide-react";
import { api, qs } from "@/lib/api";
import { fmtInt } from "@/lib/format";
import type { FxPayload, PipelineForecast } from "@/lib/types";
import { Bar, Loading, PageHeader, Panel, Row, StatTile } from "@/components/bits";
import { CatBars, MultiLine, TrendLine } from "@/components/charts";
import { cn } from "@/lib/utils";

/** FX Analysis Lab — the v6 forex toolset, all engines wired into the prediction pipeline. */
export default function AnalysisLab() {
  const fx = useQuery({
    queryKey: ["fx", "all"],
    queryFn: () => api.get<FxPayload>("/api/v1/fx"),
    refetchInterval: 20_000,
  });
  const pipeline = useQuery({
    queryKey: ["pipeline", "forecast"],
    queryFn: () => api.get<PipelineForecast>("/api/v1/pipeline/forecast"),
    refetchInterval: 20_000,
  });

  if (fx.isLoading || pipeline.isLoading) return <Loading rows={6} />;
  const f = fx.data;
  const p = pipeline.data;
  if (!f || !p) return null;

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="FX Analysis Lab"
        subtitle={`${fmtInt(f.rounds)} rounds · nine engines over the live series — correlation, volatility regime, order-flow imbalance, support density, breakout, mean reversion, trend quality, event risk, divergence. Every engine feeds the prediction pipeline.`}
        actions={
          <Link
            to="/dashboard/accuracy"
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] hover:border-primary/40"
          >
            <BrainCircuit className="h-4 w-4 text-primary" /> Accuracy Engine <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        }
      />

      <MetricRow f={f} />

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Composite signal vector — feeds the pipeline" className="xl:col-span-2">
          <div className="space-y-2.5">
            {f.signals.map((s) => (
              <div key={s.key} className="flex items-center gap-3">
                <div className="w-36 shrink-0 text-[12.5px] font-medium">{s.label}</div>
                <div className="relative h-1.5 flex-1 rounded-full bg-muted">
                  <div className="absolute left-1/2 top-0 h-full w-[2px] bg-border" />
                  <div
                    className={cn("absolute top-0 h-full rounded-full", s.dir >= 0 ? "bg-emerald-400" : "bg-rose-400")}
                    style={{ left: s.dir >= 0 ? "50%" : `${50 + s.dir * 50}%`, width: `${Math.abs(s.dir) * 50}%` }}
                  />
                </div>
                <div className="font-data w-40 shrink-0 text-right text-[11.5px]">{s.value}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">{f.trend.note}</p>
        </Panel>

        <Panel title="Pipeline forecast (live, multi-window)" right={<Radar className="h-3.5 w-3.5 text-primary" />}>
          <div className="space-y-3">
            {p.windows.slice(0, 3).map((w) => (
              <div key={w.window} className="rounded-lg border border-border/60 bg-background/40 p-2.5">
                <p className="text-[12px] font-medium">{w.label} <span className="font-data text-muted-foreground">· ~{fmtInt(w.expectedRounds)} rounds</span></p>
                <div className="mt-1.5 space-y-1">
                  {w.predictions.map((pred) => (
                    <div key={pred.threshold} className="flex items-center gap-2">
                      <span className="font-data w-10 text-[11px] text-muted-foreground">{pred.threshold}×</span>
                      <Bar value={pred.probability * 100} />
                      <span className="font-data w-12 text-right text-[11px]">{(pred.probability * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Earned weights: {Object.entries(p.weights).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(" · ") || "baseline only (no skill yet)"}.
              <Link to="/dashboard/accuracy" className="ml-1 text-primary hover:underline">How weights are earned →</Link>
            </p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Volatility regime — rolling realized vol (log returns)">
          <TrendLine data={f.volatility.series.map((v) => ({ x: v.t, y: v.vol }))} height={200} />
          <div className="mt-2">
            <Row label="Regime" value={`${f.volatility.regime} · p${Math.round(f.volatility.volPercentile * 100)}`} />
            <Row label="EWMA vol" value={String(f.volatility.ewmaVol)} />
            <Row label="Vol-of-vol" value={String(f.volatility.volOfVol)} />
          </div>
        </Panel>

        <Panel title="Order-flow imbalance — cumulative delta (≥2× share per 20-round bucket)">
          <TrendLine data={f.orderFlow.cumulative.map((v) => ({ x: v.t, y: v.cvd }))} height={200} />
          <div className="mt-2">
            <Row label="Current bucket imbalance" value={f.orderFlow.currentImbalance} />
            <Row label="Z vs recent norm" value={f.orderFlow.currentZ} />
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Support / resistance density — log-binned shelf clusters">
          <CatBars data={f.density.bins.map((b) => ({ name: `${b.from}`, value: b.count }))} height={200} />
          <div className="mt-2">
            <Row label="Nearest support" value={f.density.nearestSupport ? `${f.density.nearestSupport}×` : "—"} />
            <Row label="Nearest resistance" value={f.density.nearestResistance ? `${f.density.nearestResistance}×` : "—"} />
          </div>
        </Panel>

        <Panel title="Autocorrelation — log series vs ≥2× flag stream">
          <MultiLine
            data={f.correlation.logAcf.map((l) => ({ x: `L${l.lag}`, log: l.acf, flag: f.correlation.flagAcf.find((r) => r.lag === l.lag)?.acf ?? 0 }))}
            series={[{ key: "log", color: "#06B6D4" }, { key: "flag", color: "#F59E0B" }]}
            height={200}
          />
          <div className="mt-2">
            <Row label="Ljung-Box (log / flag)" value={`${f.correlation.ljungBoxLog} / ${f.correlation.ljungBoxFlag}`} />
            <Row label="Reading" value={f.correlation.note} />
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Mean reversion — Hurst & variance ratios">
          <div className="space-y-2 text-[13px]">
            <Row label="Hurst (R/S)" value={String(f.reversion.hurst)} />
            {f.reversion.varianceRatios.map((v) => (
              <Row key={v.q} label={`VR(${v.q})`} value={String(v.vr)} />
            ))}
            <Row label="AR(1) / half-life" value={`${f.reversion.ar1}${f.reversion.halfLife !== null ? ` · ${f.reversion.halfLife}r` : ""}`} />
            <Row label="Z-score" value={String(f.reversion.zScore)} />
          </div>
          <p className="mt-2 text-[11.5px] text-muted-foreground">{f.reversion.interpretation}</p>
        </Panel>

        <Panel title="Breakout lab — compression & resolution rates">
          <div className="space-y-2 text-[13px]">
            <Row label="Squeeze percentile" value={`${Math.round(f.breakout.compressionPercentile * 100)}%`} />
            <Row label="Break rate after squeeze" value={`${(f.breakout.postCompressionBreakRate * 100).toFixed(1)}% (n ${fmtInt(f.breakout.sample)})`} />
            <Row label="Base break rate" value={`${(f.breakout.baseBreakRate * 100).toFixed(1)}%`} />
          </div>
          <p className="mt-2 text-[11.5px] text-muted-foreground">{f.breakout.note}</p>
        </Panel>

        <Panel title="Event risk — q99.5 extremes & anomalies">
          <div className="space-y-2 text-[13px]">
            <Row label="Extreme threshold" value={`${f.events.extremeThreshold}×`} />
            <Row label="Since last extreme" value={f.events.sinceLastExtreme !== null ? `${fmtInt(f.events.sinceLastExtreme)} rounds` : "—"} />
            <Row label="Anomaly rate (|z|>3)" value={`${(f.events.anomalyRate * 100).toFixed(3)}%`} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {f.events.anomalies.slice(0, 8).map((a) => (
              <span key={a.ts} className="font-data rounded-md border border-amber-400/30 bg-amber-400/5 px-2 py-1 text-[11px] text-amber-400">
                {a.multiplier}× · z {a.z}
              </span>
            ))}
            {!f.events.anomalies.length && <span className="text-[12px] text-muted-foreground">No anomalies in the scanned window.</span>}
          </div>
        </Panel>
      </div>

      <Panel title="Cross-source divergence — who deviates from the blended baseline">
        {f.divergence.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-4">Source</th>
                  <th className="py-2 pr-4">Rounds</th>
                  {f.divergence[0].divergences.map((d) => (
                    <th key={d.threshold} className="py-2 pr-4">{d.threshold}× rate vs base</th>
                  ))}
                  <th className="py-2">Max Δ</th>
                </tr>
              </thead>
              <tbody>
                {f.divergence.map((row) => (
                  <tr key={row.source} className="border-t border-border/50">
                    <td className="py-2 pr-4 font-medium">{row.source}</td>
                    <td className="font-data py-2 pr-4">{fmtInt(row.rounds)}</td>
                    {row.divergences.map((d) => (
                      <td key={d.threshold} className={cn("font-data py-2 pr-4", Math.abs(d.deltaPct) > 5 ? (d.deltaPct > 0 ? "text-emerald-400" : "text-rose-400") : "")}>
                        {(d.rate * 100).toFixed(2)}% vs {(d.base * 100).toFixed(2)}% ({d.deltaPct > 0 ? "+" : ""}{d.deltaPct}%)
                      </td>
                    ))}
                    <td className="font-data py-2">{row.score}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Activity className="h-4 w-4" /> Need a source with 200+ rounds to compute divergence.
          </p>
        )}
      </Panel>
    </div>
  );
}

function MetricRow({ f }: { f: FxPayload }) {
  const tiles: { label: string; value: string; sub: string; tone: "default" | "good" | "warn" | "bad" | "signal" }[] = [
    { label: "Trend state", value: f.trend.classification, sub: `ER ${f.trend.efficiency} · R² ${f.trend.r2}`, tone: f.trend.classification === "trending" ? "signal" : "default" },
    { label: "Vol regime", value: f.volatility.regime, sub: `percentile ${Math.round(f.volatility.volPercentile * 100)}`, tone: f.volatility.regime === "compressed" ? "warn" : "default" },
    { label: "Hurst", value: String(f.reversion.hurst), sub: f.reversion.hurst < 0.45 ? "mean-reverting" : f.reversion.hurst > 0.55 ? "persistent" : "random-walk", tone: "default" },
    { label: "Flow z-score", value: String(f.orderFlow.currentZ), sub: f.orderFlow.note, tone: Math.abs(f.orderFlow.currentZ) > 1 ? "warn" : "default" },
    { label: "Squeeze", value: `${Math.round(f.breakout.compressionPercentile * 100)}%`, sub: `break ${(f.breakout.postCompressionBreakRate * 100).toFixed(0)}% vs ${(f.breakout.baseBreakRate * 100).toFixed(0)}% base`, tone: f.breakout.compressionPercentile > 0.8 ? "warn" : "default" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {tiles.map((t) => (
        <StatTile key={t.label} label={t.label} value={t.value} sub={t.sub} tone={t.tone} />
      ))}
    </div>
  );
}
