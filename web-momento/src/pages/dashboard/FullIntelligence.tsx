import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { api, qs } from "@/lib/api";
import { fmtDateTime, fmtMult, fmtPct } from "@/lib/format";
import type { ForecastEvidence, IntelCalibrationSummary, MarketState, NextRoundForecast } from "@/lib/types";
import { EmptyState, Loading, PageHeader, Panel, StatTile } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// V5.01-backtd state palette (STATE_META)
const STATE_COLOR: Record<MarketState, string> = {
  Normal: "#8b95b7",
  Collapse: "#ef4444",
  Ignition: "#2ee6c0",
  Moonshot: "#38bdf8",
  Exhaustion: "#f59e0b",
  Shelf: "#a3a3a3",
  Bait: "#fb923c",
};
const STATES: MarketState[] = ["Normal", "Collapse", "Ignition", "Moonshot", "Exhaustion", "Shelf", "Bait"];
const BAND_SHORT = ["<1.5", "1.5–2", "2–5", "5–10", "10–100", "100+"];

const POINT_LABEL: Record<string, string> = { median: "median", geomean: "geometric mean", trimmed: "trimmed log-mean" };

const EVIDENCE_META: Record<ForecastEvidence["status"], { label: string; cls: string }> = {
  "insufficient-data": { label: "Insufficient evidence", cls: "border-amber-400/40 bg-amber-400/10 text-amber-300" },
  "no-demonstrated-skill": { label: "No demonstrated skill", cls: "border-rose-400/40 bg-rose-400/10 text-rose-300" },
  "demonstrated-skill": { label: "Skill demonstrated on locked holdout", cls: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" },
};

function EvidencePanel({ ev }: { ev: ForecastEvidence }) {
  const meta = EVIDENCE_META[ev.status] ?? EVIDENCE_META["insufficient-data"];
  const ll = (x: number | null) => (x == null ? "—" : x.toFixed(4));
  const pct = (x: number | null) => (x == null ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(2)}%`);
  return (
    <Panel
      title="Locked-holdout evidence"
      right={<span className={cn("rounded-md border px-2 py-0.5 text-[11px] font-semibold", meta.cls)}>{meta.label}</span>}
    >
      <div className="space-y-3">
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {ev.reason}
          {ev.confidenceGated && ev.confidenceLabelUngated ? ` Confidence label capped at LOW (model alone would say ${ev.confidenceLabelUngated}).` : ""}
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Holdout rounds" value={String(ev.holdoutSample)} sub={`trained on ${ev.trainingSample} earlier`} />
          <StatTile label="Log loss vs baseline" value={`${ll(ev.logLoss.published)} / ${ll(ev.logLoss.baseline)}`} sub={`skill ${pct(ev.baselineSkillPct)}`} />
          <StatTile label="Threshold Brier skill" value={pct(ev.meanBrierSkillPct)} sub="mean over 2×–100×" />
          {ev.rangeCoverage != null && ev.rangeNominal != null ? (
            <StatTile label={`Range coverage (${ev.rangeProfile ?? "loose"})`} value={fmtPct(ev.rangeCoverage, 0)} sub={`target ${fmtPct(ev.rangeNominal, 0)} · p25–p75 ${ev.coverage50 == null ? "—" : fmtPct(ev.coverage50, 0)}`} />
          ) : (
            <StatTile label="p25–p75 coverage" value={ev.coverage50 == null ? "—" : fmtPct(ev.coverage50, 0)} sub="target 50%" />
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full font-data text-[11px] tabular-nums">
            <thead className="text-muted-foreground">
              <tr><th className="text-left font-normal">≥ threshold</th><th className="text-right font-normal">predicted</th><th className="text-right font-normal">observed</th><th className="text-right font-normal">Brier skill</th></tr>
            </thead>
            <tbody>
              {ev.thresholds.map((t) => (
                <tr key={t.threshold}>
                  <td>{t.threshold}×</td>
                  <td className="text-right">{fmtPct(t.predicted, 1)}</td>
                  <td className="text-right">{fmtPct(t.observed, 1)}</td>
                  <td className="text-right">{pct(t.brierSkillPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {ev.version} · recalibration {ev.recalibrationActive ? "on" : "off"}/{ev.quantileRecalibrationActive ? "on" : "off"} · data cutoff {ev.dataCutoffMs ? fmtDateTime(ev.dataCutoffMs) : "—"}
          {ev.rejectedSample ? ` · ${ev.rejectedSample} corrupt ledger rows skipped` : ""}
        </p>
      </div>
    </Panel>
  );
}

const VERDICT_CHIP: Record<string, string> = {
  hit: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  adjacent: "border-cyan-400/40 bg-cyan-400/10 text-cyan-300",
  near: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  "miss-high": "border-rose-400/40 bg-rose-400/10 text-rose-300",
  "miss-low": "border-orange-400/40 bg-orange-400/10 text-orange-300",
};

function Ring({ value, color, label }: { value: number; color: string; label: string }) {
  const r = 50;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: 116, height: 116 }}>
      <svg width="116" height="116" className="-rotate-90" aria-hidden="true">
        <circle cx="58" cy="58" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="9" />
        <circle
          cx="58"
          cy="58"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value)}
          style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-data text-xl font-semibold tabular-nums">{Math.round(value * 100)}%</span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

function DistBars({ dist, height = 36 }: { dist: number[]; height?: number }) {
  const max = Math.max(...dist, 0.0001);
  return (
    <div className="flex items-end gap-0.5" style={{ height }}>
      {dist.map((p, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-sm bg-primary"
          style={{ height: `${Math.max(4, (p / max) * 100)}%`, opacity: 0.35 + 0.65 * (p / max) }}
          title={`${BAND_SHORT[i]}×: ${fmtPct(p, 1)}`}
        />
      ))}
    </div>
  );
}

export default function FullIntelligence() {
  const qc = useQueryClient();
  const source = "all";
  const fc = useQuery({
    queryKey: ["intelligence", "forecast", source],
    queryFn: () => api.get<NextRoundForecast>(`/api/v1/intelligence/forecast${qs({ source })}`),
    refetchInterval: 10_000,
  });
  const cal = useQuery({
    queryKey: ["intelligence", "calibrations"],
    queryFn: () => api.get<IntelCalibrationSummary>("/api/v1/intelligence/calibrations?limit=20"),
    refetchInterval: 20_000,
  });
  const recal = useMutation({
    mutationFn: () => api.post<{ scored: number }>("/api/v1/intelligence/recalibrate"),
    onSuccess: (d) => {
      toast.success(`Re-ran the backtest: ${d.scored} rounds scored`);
      qc.invalidateQueries({ queryKey: ["intelligence"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const f = fc.data;
  const intel = f?.intelligence;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Full Intelligence"
        subtitle="The V5.01-backtd next-round forecast (Markov states, percentiles, DNA, ladders, exhaustion, ML) fused with every v6 engine. Mixture weights are earned on the calibration ledger."
        actions={
          <Button size="sm" variant="outline" onClick={() => recal.mutate()} disabled={recal.isPending}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", recal.isPending && "animate-spin")} /> Re-run backtest
          </Button>
        }
      />

      {!f || !intel ? (
        fc.isError ? <EmptyState title="Forecast unavailable" hint={(fc.error as Error)?.message} /> : <Loading rows={4} />
      ) : (
        <>
          {/* headline */}
          <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
            <Panel>
              <div className="flex items-center gap-4">
                <Ring value={f.confidence} color={STATE_COLOR[f.state]} label={f.confidenceLabel} />
                <div className="space-y-1.5">
                  <span
                    className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1 font-data text-[11px] font-semibold uppercase tracking-[0.14em]"
                    style={{ color: STATE_COLOR[f.state], borderColor: `${STATE_COLOR[f.state]}66` }}
                  >
                    {f.state}
                  </span>
                  <p className="font-data text-2xl font-semibold tabular-nums text-primary">{fmtMult(f.expectedMultiplier)}</p>
                  <p className="font-data text-[12px] text-muted-foreground">
                    {f.rangeProfile?.label ?? "p25–p75"} {fmtMult(f.rangeLo)} – {fmtMult(f.rangeHi)} · reach p{Math.round((f.rangeProfile?.reach ?? 0.9) * 100)} {fmtMult(f.moonshotReach)}
                    {f.rangeProfile ? ` · holds ~${fmtPct(f.rangeProfile.nominal, 0)} of rounds` : ""}
                  </p>
                  {f.pointRange ? (
                    <p className="text-[11px] text-muted-foreground" title={f.pointRange.reason}>
                      expected = {POINT_LABEL[f.pointRange.pointMethod] ?? f.pointRange.pointMethod}
                      {f.pointRange.pointMethod !== "median" ? ` (median ${fmtMult(f.pointRange.median)})` : ""} · range {f.pointRange.intervalMethod === "shortest" ? "shortest" : "equal-tailed"}
                      {f.pointRange.adaptive ? ` · adaptive ${fmtPct(f.pointRange.coverage, 0)}` : ""}
                    </p>
                  ) : null}
                  {f.quantiles ? (
                    <p className="font-data text-[11px] tabular-nums text-muted-foreground">
                      p10 {fmtMult(f.quantiles.p10)} · p25 {fmtMult(f.quantiles.p25)} · p50 {fmtMult(f.quantiles.p50)} · p75 {fmtMult(f.quantiles.p75)} · p90 {fmtMult(f.quantiles.p90)} · p95 {fmtMult(f.quantiles.p95)}
                    </p>
                  ) : null}
                  <p className="text-[11px] text-muted-foreground">{f.band} band · state conviction {fmtPct(f.stateConviction ?? 0, 0)}</p>
                </div>
              </div>
            </Panel>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile
                label="Skill vs baseline"
                value={intel.skillPct == null ? "—" : `${intel.skillPct > 0 ? "+" : ""}${intel.skillPct.toFixed(1)}%`}
                sub={`log-score over ${intel.calibrationSample} scored rounds`}
                tone={intel.skillPct != null && intel.skillPct >= 3 ? "good" : intel.skillPct != null && intel.skillPct < 0 ? "bad" : "default"}
              />
              <StatTile label="Loose hit rate" value={intel.calibratedHitRate == null ? "—" : fmtPct(intel.calibratedHitRate, 0)} sub="hit + adjacent, trailing ledger" />
              <StatTile label="Engine agreement" value={fmtPct(intel.agreement, 0)} sub="1 − weighted JS divergence" />
              <StatTile
                label="Independent draws?"
                value={intel.independence.independent ? "yes" : "no"}
                sub={`χ² ${intel.independence.chiSquare} · band transitions`}
                tone={intel.independence.independent ? "warn" : "signal"}
              />
            </div>
          </div>
          <p className="rounded-md border border-border/60 bg-background/40 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">{f.note} {intel.honesty}</p>
          {f.evidence ? <EvidencePanel ev={f.evidence} /> : null}

          <div className="grid gap-4 xl:grid-cols-2">
            {/* candidates */}
            <Panel title="Markov state candidates" right={<span className="text-[11px] text-muted-foreground">V5 tilts: DNA · overdue · pressure · moonshot · ladder</span>}>
              <div className="space-y-1.5">
                {(f.candidates ?? []).map((c) => (
                  <div key={c.state} className="grid grid-cols-[92px_1fr_110px_56px] items-center gap-2 text-[12px]" title={c.label}>
                    <span className="font-medium" style={{ color: c.color }}>{c.state}</span>
                    <div className="h-2 rounded-full bg-muted">
                      <div className="h-2 rounded-full" style={{ width: `${c.probability * 100}%`, background: c.color }} />
                    </div>
                    <span className="font-data text-[11px] text-muted-foreground">{fmtMult(c.rangeLo)}–{fmtMult(c.rangeHi)}</span>
                    <span className="font-data text-right tabular-nums">{fmtPct(c.probability, 1)}</span>
                  </div>
                ))}
              </div>
            </Panel>

            {/* transition matrix */}
            <Panel title="Transition matrix" right={<span className="text-[11px] text-muted-foreground">rolling 40-round labels · Laplace 0.5</span>}>
              {f.transitionMatrix && (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr>
                        <th className="px-1 py-1 text-left text-muted-foreground">from → to</th>
                        {STATES.map((s) => (
                          <th key={s} className="px-1 py-1 font-medium" style={{ color: STATE_COLOR[s] }}>{s.slice(0, 4)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {STATES.map((a) => (
                        <tr key={a} className={cn(a === (f.stateScores ? Object.entries(f.stateScores).sort((x, y) => y[1] - x[1])[0][0] : "") && "outline outline-1 outline-primary/40")}>
                          <td className="px-1 py-0.5 font-medium" style={{ color: STATE_COLOR[a] }}>{a}</td>
                          {STATES.map((b) => {
                            const p = f.transitionMatrix![a][b];
                            return (
                              <td key={b} className="font-data px-1 py-0.5 text-center tabular-nums" style={{ background: `hsl(var(--primary) / ${Math.min(0.7, p)})` }}>
                                {Math.round(p * 100)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          {/* components */}
          <Panel title="Engines & earned mixture weights" right={<span className="text-[11px] text-muted-foreground">weight ∝ prior · e^(−n·Δlog-loss) · floors 8% baseline / 2% engine</span>}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {intel.components.map((c) => (
                <div key={c.key} className="rounded-md border border-border/60 bg-background/40 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-data text-[12px] font-semibold">{c.key}</span>
                    <span className="font-data text-[12px] text-primary">{fmtPct(c.weight, 1)}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground" title={c.label}>{c.label}</p>
                  <div className="mt-2">
                    <DistBars dist={c.distribution} height={32} />
                  </div>
                  <p className="font-data mt-1.5 text-[10px] text-muted-foreground">
                    mid {fmtMult(c.mid)} · P≥2 {fmtPct(c.p2, 0)} · P≥10 {fmtPct(c.p10, 1)}
                  </p>
                  <p className="font-data text-[10px] text-muted-foreground">
                    log-loss {c.logLoss == null ? "—" : c.logLoss.toFixed(4)} · n {c.samples}
                  </p>
                </div>
              ))}
            </div>
          </Panel>

          <div className="grid gap-4 xl:grid-cols-3">
            {/* horizon */}
            <Panel title={`Outlook · h+${f.horizon ?? 5}`}>
              <table className="w-full text-[12px]">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-1 text-left">target</th>
                    <th className="text-right">/round</th>
                    <th className="text-right">base</th>
                    <th className="text-right">in h</th>
                    <th className="text-right">ETA</th>
                    <th className="text-right">run</th>
                  </tr>
                </thead>
                <tbody className="font-data tabular-nums">
                  {intel.horizonOutlook.map((h) => (
                    <tr key={h.threshold} className="border-t border-border/40">
                      <td className="py-1">≥{h.threshold}×</td>
                      <td className="text-right">{fmtPct(h.perRound, 1)}</td>
                      <td className="text-right text-muted-foreground">{fmtPct(h.baseline, 1)}</td>
                      <td className="text-right">{fmtPct(h.withinHorizon, 0)}</td>
                      <td className="text-right">{h.etaMedian ?? "—"}/{h.etaP90 ?? "—"}</td>
                      <td className="text-right text-muted-foreground">{h.currentRun}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[10px] text-muted-foreground">ETA = median / p90 rounds to the first hit at the mixture rate.</p>
            </Panel>

            {/* DNA */}
            <Panel title="DNA analogues" right={<span className="font-data text-[11px] text-muted-foreground">{intel.dna.matchCount} matches · conf {fmtPct(intel.dna.confidence, 0)}</span>}>
              <div className="flex flex-wrap gap-1">
                {intel.dna.signature.map((k, i) => (
                  <span key={i} className="font-data rounded border border-border/60 px-1.5 py-0.5 text-[10px]">{k}</span>
                ))}
              </div>
              {intel.dna.outcomes ? (
                <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                  <div><p className="text-[10px] text-muted-foreground">median</p><p className="font-data">{fmtMult(intel.dna.outcomes.median)}</p></div>
                  <div><p className="text-[10px] text-muted-foreground">p75</p><p className="font-data">{fmtMult(intel.dna.outcomes.p75)}</p></div>
                  <div><p className="text-[10px] text-muted-foreground">p90</p><p className="font-data">{fmtMult(intel.dna.outcomes.p90)}</p></div>
                  <div><p className="text-[10px] text-muted-foreground">≥2×</p><p className="font-data">{fmtPct(intel.dna.outcomes.over2, 0)}</p></div>
                  <div><p className="text-[10px] text-muted-foreground">≥5×</p><p className="font-data">{fmtPct(intel.dna.outcomes.over5, 0)}</p></div>
                  <div><p className="text-[10px] text-muted-foreground">≥10×</p><p className="font-data">{fmtPct(intel.dna.outcomes.over10, 1)}</p></div>
                </div>
              ) : (
                <p className="mt-3 text-[12px] text-muted-foreground">No analogue at ≥85% similarity yet.</p>
              )}
            </Panel>

            {/* ML */}
            <Panel title="Logistic ML ensemble" right={<span className="text-[11px] text-muted-foreground">0.6 model · 0.4 empirical</span>}>
              <table className="w-full text-[12px]">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr><th className="py-1 text-left">target</th><th className="text-right">model</th><th className="text-right">empirical</th><th className="text-right">blend</th><th className="text-right">edge</th></tr>
                </thead>
                <tbody className="font-data tabular-nums">
                  {Object.entries(intel.ml.predictions).map(([k, p]) => (
                    <tr key={k} className="border-t border-border/40">
                      <td className="py-1">{k.replace("over", "≥")}×</td>
                      <td className="text-right">{fmtPct(p.model, 1)}</td>
                      <td className="text-right text-muted-foreground">{fmtPct(p.empirical, 1)}</td>
                      <td className="text-right">{fmtPct(p.blended, 1)}</td>
                      <td className={cn("text-right", p.edge > 0 ? "text-emerald-300" : "text-rose-300")}>{p.edge > 0 ? "+" : ""}{(p.edge * 100).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="font-data mt-2 text-[10px] text-muted-foreground">
                regime {intel.regime.label} · σ {intel.regime.volatility} · p50 {fmtMult(intel.percentiles.p50)} · p90 {fmtMult(intel.percentiles.p90)}
              </p>
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {/* signals */}
            <Panel title="Signal layer" right={<span className="text-[11px] text-muted-foreground">direction −1 … +1 tilts the signals engine</span>}>
              <div className="space-y-1">
                {intel.signals.map((s) => (
                  <div key={s.engine} className="grid grid-cols-[150px_1fr_52px] items-center gap-2 text-[12px]" title={s.note}>
                    <span className="truncate text-muted-foreground">{s.engine}</span>
                    <span className="font-data truncate">{s.reading}</span>
                    <span className={cn("font-data text-right tabular-nums", s.direction > 0 ? "text-emerald-300" : s.direction < 0 ? "text-rose-300" : "text-muted-foreground")}>
                      {s.direction > 0 ? "+" : ""}{s.direction.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>

            {/* exhaustion + ladders */}
            <Panel title="Band exhaustion & ladder release">
              <div className="grid grid-cols-7 gap-1">
                {intel.exhaustion.bands.map((b) => (
                  <div
                    key={b.threshold}
                    className={cn(
                      "rounded-md border px-1 py-1.5 text-center",
                      b.status === "overdue" ? "border-rose-400/50 bg-rose-400/10" : b.status === "due" ? "border-amber-400/50 bg-amber-400/10" : "border-border/60",
                    )}
                    title={`${b.roundsSince} rounds since · expected gap ${b.expectedGap ?? "—"}`}
                  >
                    <p className="font-data text-[10px] text-muted-foreground">{b.threshold}×</p>
                    <p className="font-data text-[12px] tabular-nums">{b.overdueRatio.toFixed(2)}</p>
                    <p className="text-[9px] text-muted-foreground">{b.status}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] md:grid-cols-4">
                <div><p className="text-[10px] text-muted-foreground">release</p><p className="font-data">{intel.ladders.releasePrediction}</p></div>
                <div><p className="text-[10px] text-muted-foreground">moonshot p</p><p className="font-data">{fmtPct(intel.ladders.moonshotProbability, 0)}</p></div>
                <div><p className="text-[10px] text-muted-foreground">ETA ≥20×</p><p className="font-data">{intel.ladders.etaToMoonshot} rds</p></div>
                <div>
                  <p className="text-[10px] text-muted-foreground">current ladder</p>
                  <p className="font-data">{intel.ladders.currentLadder ? `${intel.ladders.currentLadder.type} ×${intel.ladders.currentLadder.length}` : "—"}</p>
                </div>
              </div>
            </Panel>
          </div>
        </>
      )}

      {/* calibration ledger */}
      <Panel
        title="Intelligence calibration ledger"
        right={
          cal.data && (
            <span className="font-data text-[11px] text-muted-foreground">
              mixture {cal.data.ledger.mixLogLoss?.toFixed(4) ?? "—"} vs baseline {cal.data.ledger.baseLogLoss?.toFixed(4) ?? "—"} nats · correction {(cal.data.correction * 100).toFixed(1)}%
            </span>
          )
        }
      >
        {!cal.data ? (
          <Loading rows={3} />
        ) : !cal.data.rows.length ? (
          <EmptyState title="No scored rounds yet" hint="Every round is scored against the forecast that existed before it landed. The backtest runs automatically once 150 rounds exist." />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {Object.entries(cal.data.verdicts).map(([v, n]) => (
                <span key={v} className={cn("font-data rounded-md border px-2 py-0.5 text-[11px]", VERDICT_CHIP[v])}>{v} {n}</span>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-1 text-left">round</th>
                    <th className="text-left">state</th>
                    <th className="text-right">expected</th>
                    <th className="text-right">range</th>
                    <th className="text-right">actual</th>
                    <th className="text-right">mix / base nats</th>
                    <th className="pl-3 text-left">verdict</th>
                  </tr>
                </thead>
                <tbody className="font-data tabular-nums">
                  {cal.data.rows.map((r) => (
                    <tr key={r.id} className="border-t border-border/40" title={r.reason}>
                      <td className="py-1 text-muted-foreground">{fmtDateTime(new Date(r.created_ms).toISOString())}</td>
                      <td style={{ color: STATE_COLOR[r.state as MarketState] }}>{r.state}</td>
                      <td className="text-right">{fmtMult(r.expected)}</td>
                      <td className="text-right text-muted-foreground">{fmtMult(r.range_lo)}–{fmtMult(r.range_hi)}</td>
                      <td className="text-right">{r.actual != null ? fmtMult(r.actual) : "—"}</td>
                      <td className="text-right text-muted-foreground">{r.mix_loss?.toFixed(3) ?? "—"} / {r.base_loss?.toFixed(3) ?? "—"}</td>
                      <td className="pl-3">
                        <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px]", VERDICT_CHIP[r.verdict])}>{r.verdict}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
