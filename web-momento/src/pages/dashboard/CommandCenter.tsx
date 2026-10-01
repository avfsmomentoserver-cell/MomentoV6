import { SignificanceStrip } from "@/components/v65/Strips";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Activity, ArrowUpRight, Gauge, Play, RefreshCw, Square, Telescope, Zap } from "lucide-react";
import { api, qs } from "@/lib/api";
import { fmtInt, fmtMult, fmtPct, timeAgo } from "@/lib/format";
import type { AccuracyOverview, Analysis, NextRoundForecast, PipelineForecast, Pressure, RoundDto } from "@/lib/types";
import { Bar, Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";
import { DownloadSourceButton } from "@/components/DownloadSourceButton";
import { RoundsFeed } from "@/components/v64/RoundsFeed";
import { AiSummaryCard } from "@/components/v64/AiSummaryCard";
import { ShapeMiniCard } from "@/components/v64/ShapeViz";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useV1 } from "@/components/v65/kit";

// V5 state vocabulary, rendered on the v6 pipeline signals.
const STATE_COLOR: Record<string, string> = {
  Moonshot: "#22d3ee",
  Ignition: "#34d399",
  Bait: "#f59e0b",
  Exhaustion: "#fb923c",
  Collapse: "#f43f5e",
  Shelf: "#94a3b8",
  Normal: "#8b95b7",
};

const STATE_CHIP: Record<string, string> = {
  Moonshot: "border-cyan-400/40 bg-cyan-400/10 text-cyan-300",
  Ignition: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  Bait: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  Exhaustion: "border-orange-400/40 bg-orange-400/10 text-orange-300",
  Collapse: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  Shelf: "border-border/70 bg-background/40 text-muted-foreground",
  Normal: "border-slate-400/40 bg-slate-400/10 text-slate-300",
};

export default function CommandCenter() {
  const qc = useQueryClient();
  const [liveMode, setLiveMode] = useState(false);
  const stepping = useRef(false);

  const source = "all";
  const analysis = useQuery({
    queryKey: ["analysis", source, "cc"],
    queryFn: () => api.get<Analysis>(`/api/v1/analysis${qs({ source })}`),
    refetchInterval: liveMode ? 4_000 : 15_000,
  });
  const latest = useQuery({
    queryKey: ["rounds", "latest", "cc"],
    queryFn: () => api.get<{ rounds: RoundDto[] }>("/api/v1/rounds/latest?limit=100"),
    refetchInterval: liveMode ? 4_000 : 10_000,
  });
  const feed = useQuery({
    queryKey: ["feed", "status"],
    queryFn: () => api.get<{ enabled: boolean; rounds: number; cursor: number }>("/api/v1/feed/status"),
    refetchInterval: 10_000,
  });
  const accuracy = useQuery({
    queryKey: ["accuracy", "overview", "cc"],
    queryFn: () => api.get<AccuracyOverview>("/api/v1/accuracy/overview"),
    refetchInterval: 20_000,
  });
  const forecast = useQuery({
    queryKey: ["pipeline", "forecast", "cc"],
    queryFn: () => api.get<PipelineForecast>("/api/v1/pipeline/forecast"),
    refetchInterval: liveMode ? 4_000 : 15_000,
  });
  const nextRound = useQuery({
    queryKey: ["pipeline", "next-round", "cc"],
    queryFn: () => api.get<NextRoundForecast>(`/api/v1/pipeline/next-round${qs({ source })}`),
    refetchInterval: liveMode ? 4_000 : 15_000,
  });
  const mega = useQuery({
    queryKey: ["mega", "pressure", "cc"],
    queryFn: () => api.get<Pressure>("/api/v1/mega-pressure"),
    refetchInterval: liveMode ? 15_000 : 30_000,
  });
  const eta = useV1<{ cadenceMs: number; generatedAt: string; lastTs: string; rows: Array<{ threshold: number; etaMedian: number; etaP90: number; etaMedianAt: string; kmPercentile: number; pressure: number }> }>("eta/board", { refetch: 15_000 });
  const cone = useV1<{ forecastId: number | null; cadenceMs: number; cone: Array<{ h: number; p25: number; p50: number; p75: number; p90: number; t: number }>; etaMarkers: Array<{ threshold: number; rounds: number; at: string }>; coverage: { p25p75: number | null; belowP90: number | null; n: number }; intelligence?: Record<string, unknown> }>("intelligence/cone?h=5", { refetch: 15_000 });

  const stepFeed = useMutation({
    mutationFn: () => api.post<{ generated: number }>("/api/v1/feed/step", { count: 1 }),
    onSuccess: () => qc.invalidateQueries(),
  });
  // Feed engine disabled — start/stop no-ops
  const startFeed = useMutation({
    mutationFn: () => api.post("/api/v1/feed/start"),
    onSuccess: () => {
      toast.error("Feed engine is disabled in this build");
    },
  });
  const stopFeed = useMutation({
    mutationFn: () => api.post("/api/v1/feed/stop"),
    onSuccess: () => {
      toast("Feed engine is disabled");
      qc.invalidateQueries({ queryKey: ["feed"] });
    },
  });

  // client-driven scheduler assist: tick the Accuracy Engine every 60s so
  // multi-window predictions keep scheduling/resolving even between alarm fires
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        await api.post("/api/v1/accuracy/tick");
        qc.invalidateQueries({ queryKey: ["accuracy"] });
      } catch {
        // transient — next tick retries
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [qc]);

  // client-driven live loop removed — feed engine disabled
  // No synthetic data generation in this build.

  if (analysis.isLoading) return <Loading rows={6} />;
  const a = analysis.data;
  if (!a) return null;

  const liveThresholds = [2, 5, 10, 50, 100];
  const last = latest.data?.rounds[0];
  const f = forecast.data;
  const nr = nextRound.data;
  const firstWin = f?.windows[0];
  const pred2 = firstWin?.predictions.find((p) => p.threshold === 2);
  const cadenceMs = nr?.cadenceMs ?? f?.cadenceMs ?? accuracy.data?.cadenceMs;

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Command Center"
        subtitle={`${fmtInt(a.overview.count)} rounds · ${a.overview.sessions} sessions · ${a.overview.firstTs ? a.overview.firstTs.slice(0, 10) : "—"} → ${a.overview.lastTs?.slice(0, 10) ?? "—"} · source: ${a.source}`}
        actions={
          <>
            <Button
              variant={liveMode ? "default" : "outline"}
              size="sm"
              className={cn("gap-2", liveMode && "glow-signal")}
              onClick={() => {
                if (!liveMode) startFeed.mutate();
                else stopFeed.mutate();
                setLiveMode((v) => !v);
              }}
            >
              {liveMode ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {liveMode ? "Live" : "Go live"}
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => stepFeed.mutate()} disabled={stepFeed.isPending}>
              <RefreshCw className={cn("h-3.5 w-3.5", stepFeed.isPending && "animate-spin")} /> Step round
            </Button>
            <DownloadSourceButton />
          </>
        }
      />
      <SignificanceStrip />


      <div className="grid gap-3 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
        <Card
          className="border-primary/30 bg-primary/[0.04] shadow-[0_0_0_1px_hsl(var(--primary)/0.08),0_0_28px_-8px_hsl(var(--primary)/0.25)]"
          aria-label="Next-round forecast"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <Telescope className="h-3.5 w-3.5 shrink-0 text-primary" />
              <div className="min-w-0">
                <h2 className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/90">Forecast</h2>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {nr?.intelligence
                    ? `Next-round projection · full intelligence (${nr.intelligence.components.length} engines, earned weights)`
                    : "Next-round projection · pipeline ensemble"}
                </p>
              </div>
            </div>
            <span className="font-data shrink-0 text-[11px] text-muted-foreground">
              {nr ? `cadence ~${Math.round(nr.cadenceMs / 1000)}s · h+1${nr.horizon ? ` · outlook h+${nr.horizon}` : ""}` : "—"}
            </span>
          </div>
          <CardContent className="p-4">
            {nr ? (
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: 124, height: 124 }}>
                  <svg width="124" height="124" className="-rotate-90" aria-hidden="true">
                    <circle cx="62" cy="62" r="57.5" fill="none" stroke="hsl(var(--muted))" strokeWidth="9" />
                    <circle
                      cx="62"
                      cy="62"
                      r="57.5"
                      fill="none"
                      stroke={STATE_COLOR[nr.state]}
                      strokeWidth="9"
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 57.5}
                      strokeDashoffset={2 * Math.PI * 57.5 * (1 - nr.confidence)}
                      style={{
                        transition: "stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1), stroke 400ms",
                        filter: `drop-shadow(0 0 10px ${STATE_COLOR[nr.state]})`,
                      }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-center">
                    <div className="font-data text-2xl font-semibold leading-none tabular-nums">{Math.round(nr.confidence * 100)}%</div>
                    <div className="max-w-[80%] text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{nr.confidenceLabel}</div>
                  </div>
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("inline-flex items-center gap-2 rounded-md border px-2.5 py-1 font-data text-[11px] font-semibold uppercase tracking-[0.14em]", STATE_CHIP[nr.state])}>
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                      {nr.state}
                    </span>
                    <span className="rounded-md border border-border/70 bg-background/40 px-2.5 py-1 text-[11px] text-muted-foreground">{nr.band} band</span>
                    <span className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] text-primary">h+1</span>
                    {nr.rectification?.active && (
                      <span
                        title={nr.rectification.note}
                        className="inline-flex items-center gap-1 rounded-md border border-violet-400/40 bg-violet-400/10 px-2.5 py-1 text-[11px] text-violet-300"
                      >
                        rectified {nr.rectification.factor.toFixed(2)}×
                      </span>
                    )}
                    {nr.intelligence?.calibration && (() => {
                      const cal = nr.intelligence.calibration;
                      const on = cal.distributionActive || cal.quantileActive;
                      return (
                        <>
                          <span
                            title={cal.reason}
                            className={cn(
                              "rounded-md border px-2 py-0.5 text-[10px]",
                              on ? "border-emerald-400/40 bg-emerald-400/5 text-emerald-300" : "border-border/70 bg-background/40 text-muted-foreground",
                            )}
                          >
                            {on
                              ? `calibrated${cal.improvementPct != null && cal.distributionActive ? ` · −${cal.improvementPct.toFixed(1)}% log-loss` : ""}`
                              : cal.sample < 60 ? `calibrating ${cal.sample}/60` : "raw mixture (recal not earned)"}
                          </span>
                          <span
                            title={`P(<2x): forecast ${fmtPct(cal.crash.calibrated, 1)} (raw mixture ${fmtPct(cal.crash.raw, 1)}) vs observed ${fmtPct(cal.crash.observed, 1)} over the last 500 rounds`}
                            className="rounded-md border border-border/70 bg-background/40 px-2 py-0.5 text-[10px] text-muted-foreground"
                          >
                            P(&lt;2x) {fmtPct(cal.crash.calibrated, 0)} · seen {fmtPct(cal.crash.observed, 0)}
                          </span>
                          {cal.coverageCal != null && (
                            <span
                              title="Held-out share of rounds that landed inside the published p25–p75 range (target 50%)"
                              className={cn(
                                "rounded-md border px-2 py-0.5 text-[10px]",
                                Math.abs(cal.coverageCal - 0.5) <= 0.06 ? "border-cyan-400/30 text-cyan-300" : "border-orange-400/30 text-orange-300",
                              )}
                            >
                              p25–p75 hit {fmtPct(cal.coverageCal, 0)}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Expected</p>
                      <p className="font-data mt-0.5 text-xl font-semibold tabular-nums text-primary transition-all duration-400 ease-out">{fmtMult(nr.expectedMultiplier)}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground transition-all duration-400 ease-out" title={nr.pointRange?.reason}>{nr.band} band{nr.pointRange && nr.pointRange.pointMethod !== "median" ? ` · ${nr.pointRange.pointMethod} · median ${fmtMult(nr.pointRange.median)}` : ""}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Range · {nr.rangeProfile?.label ?? "p25–p75"}</p>
                      <p className={cn("font-data mt-0.5 text-sm tabular-nums transition-all duration-400 ease-out", nr.confidence >= 0.66 ? "text-cyan-400" : nr.confidence >= 0.38 ? "text-slate-300" : "text-orange-400")}>{fmtMult(nr.rangeLo)} — {fmtMult(nr.rangeHi)}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground transition-all duration-400 ease-out">
                        moonshot reach (p{Math.round((nr.rangeProfile?.reach ?? 0.9) * 100)}) ~{fmtMult(nr.moonshotReach)}
                        {nr.intelligence?.calibration && (
                          <span className="ml-2 text-muted-foreground/60">· mode {nr.intelligence.calibration.modeBand}</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Next-round distribution by band</p>
                    <div className="flex items-end gap-1" style={{ height: 44 }}>
                      {nr.distribution.map((d) => (
                        <div key={d.label} className="flex h-full min-w-0 flex-1 flex-col items-center gap-0.5" title={`${d.label}: ${fmtPct(d.probability, 1)}`}>
                          <div className="flex w-full flex-1 items-end">
                            <div
                              className="w-full rounded-t-sm transition-all duration-400 ease-out"
                              style={{
                                height: `${Math.max(4, (d.probability / Math.max(...nr.distribution.map((x) => x.probability), 0.0001)) * 100)}%`,
                                background: d.edge >= 10 ? "#F59E0B" : d.edge >= 5 ? "#8B5CF6" : d.edge >= 2 ? "#06B6D4" : "#3B82F6",
                                opacity: 0.4 + Math.min(0.6, d.probability * 6),
                              }}
                            />
                          </div>
                          <span className="font-data text-[9px] text-muted-foreground">{d.label.replace("x", "")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {nr.candidates && (
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Markov state candidates</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {nr.candidates.slice(0, 3).map((c) => (
                          <div key={c.state} className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5" title={c.label}>
                            <div className="flex items-center justify-between gap-1">
                              <span className="truncate text-[11px] font-medium" style={{ color: STATE_COLOR[c.state] }}>{c.state}</span>
                              <span className="font-data text-[11px] tabular-nums">{fmtPct(c.probability, 0)}</span>
                            </div>
                            <p className="font-data mt-0.5 text-[10px] text-muted-foreground">{fmtMult(c.rangeLo)}–{fmtMult(c.rangeHi)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {nr.intelligence && (
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Outlook · P(hit within {nr.horizon ?? 5} rounds)</p>
                      <div className="grid grid-cols-6 gap-1">
                        {nr.intelligence.horizonOutlook.map((h) => (
                          <div
                            key={h.threshold}
                            className="rounded-md border border-border/60 bg-background/40 px-1 py-1 text-center"
                            title={`per round ${fmtPct(h.perRound, 1)} (baseline ${fmtPct(h.baseline, 1)}) · ETA median ${h.etaMedian ?? "—"} / p90 ${h.etaP90 ?? "—"} rounds · current run ${h.currentRun}`}
                          >
                            <p className="font-data text-[9px] text-muted-foreground">≥{h.threshold}×</p>
                            <p className="font-data text-[11px] tabular-nums">{fmtPct(h.withinHorizon, 0)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{nr.note}</p>
                  <div className="flex flex-wrap gap-1.5 border-t border-border/50 pt-2.5">
                    {nr.components.map((c) => (
                      <div
                        key={c.model}
                        className={cn(
                          "font-data rounded-md border px-2 py-0.5 text-[11px] transition-all duration-400 ease-out",
                          c.weight > 0.15 ? "border-primary/40 bg-primary/10 text-primary" : "border-border/70 bg-background/40 text-muted-foreground"
                        )}
                        title={nr.intelligence ? `earned weight ${fmtPct(c.weight, 1)} · P(≥2×) ${fmtPct(c.p, 1)}` : undefined}
                      >
                        <div className="flex items-center gap-1">
                          <span>{c.model} {c.mid.toFixed(2)}</span>
                          {nr.intelligence && <span className="text-muted-foreground/60">·{Math.round(c.weight * 100)}%</span>}
                        </div>
                        {nr.intelligence && (
                          <div className="mt-0.5 h-0.5 w-full max-w-[40px] rounded-full bg-border overflow-hidden">
                            <div
                              className="h-full bg-current transition-all duration-400 ease-out"
                              style={{ width: `${Math.min(100, c.weight * 100)}%` }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                    <span className="font-data rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] text-primary/80 transition-all duration-400 ease-out">
                      {nr.intelligence ? "mixture" : "ensemble"} {nr.expectedMultiplier.toFixed(2)}
                    </span>
                    {nr.intelligence && (
                      <span
                        title={nr.intelligence.honesty}
                        className={cn(
                          "font-data rounded-md border px-2 py-0.5 text-[11px] transition-all duration-400 ease-out",
                          (nr.intelligence.skillPct ?? 0) > 0 ? "border-emerald-400/40 text-emerald-300" : "border-border/70 text-muted-foreground",
                        )}
                      >
                        skill vs baseline {nr.intelligence.skillPct == null ? "—" : `${nr.intelligence.skillPct > 0 ? "+" : ""}${nr.intelligence.skillPct.toFixed(1)}%`}
                      </span>
                    )}
                    {nr.intelligence?.rangeAdjustments && (
                      <>
                        {nr.intelligence.rangeAdjustments.regimeScale !== 1 && (
                          <span
                            title={`Regime scale: ${nr.intelligence.rangeAdjustments.regimeScale}`}
                            className="font-data rounded-md border border-blue-400/40 bg-blue-400/10 px-2 py-0.5 text-[11px] text-blue-300"
                          >
                            regime ×{nr.intelligence.rangeAdjustments.regimeScale.toFixed(2)}
                          </span>
                        )}
                        {nr.intelligence.rangeAdjustments.breakoutScale !== 1 && (
                          <span
                            title={`Breakout scale: ${nr.intelligence.rangeAdjustments.breakoutScale}`}
                            className="font-data rounded-md border border-purple-400/40 bg-purple-400/10 px-2 py-0.5 text-[11px] text-purple-300"
                          >
                            breakout ×{nr.intelligence.rangeAdjustments.breakoutScale.toFixed(2)}
                          </span>
                        )}
                        {nr.intelligence.rangeAdjustments.dnaPatternTilt !== 0 && (
                          <span
                            title={`DNA pattern tilt: ${nr.intelligence.rangeAdjustments.dnaPatternTilt}`}
                            className="font-data rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-300"
                          >
                            dna {nr.intelligence.rangeAdjustments.dnaPatternTilt > 0 ? "+" : ""}{Math.round(nr.intelligence.rangeAdjustments.dnaPatternTilt * 100)}%
                          </span>
                        )}
                        {nr.intelligence.rangeAdjustments.linguisticsTilt !== 0 && (
                          <span
                            title={`Linguistics tilt: ${nr.intelligence.rangeAdjustments.linguisticsTilt}`}
                            className="font-data rounded-md border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 text-[11px] text-cyan-300"
                          >
                            ling {nr.intelligence.rangeAdjustments.linguisticsTilt > 0 ? "+" : ""}{Math.round(nr.intelligence.rangeAdjustments.linguisticsTilt * 100)}%
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-3 py-8 text-[12px] text-muted-foreground">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Projecting next round…
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3 text-[12px]">
              <span className="font-data text-[12px] text-muted-foreground">
                {f && firstWin ? `P(≥2×) next round ${fmtPct(pred2?.perRound.p)} · in 15m ${fmtPct(firstWin.predictions.find((p) => p.threshold === 2)?.probability)}` : "—"}
              </span>
              <span className="flex items-center gap-3">
                <Link to="/dashboard/intelligence" className="inline-flex items-center gap-1 text-primary hover:underline">
                  Full intelligence <ArrowUpRight className="h-3 w-3" />
                </Link>
                <Link to="/dashboard/fx-lab" className="inline-flex items-center gap-1 text-primary hover:underline">
                  FX Lab <ArrowUpRight className="h-3 w-3" />
                </Link>
              </span>
            </div>
          </CardContent>
        </Card>
          <AiSummaryCard />
        </div>
        <RoundsFeed className="xl:row-span-1" height={640} />
      </div>

      <MetricGrid>
        <StatTile label="Last round" value={fmtMult(last?.multiplier)} sub={`${last?.source ?? "—"} · ${timeAgo(last?.ts)}`} pulse tone={last && last.multiplier >= 10 ? "warn" : "signal"} />
        <StatTile label="P(≥ 2×)" value={fmtPct(a.exceedance.find((e) => e.threshold === 2)?.rate)} sub={`CI ${fmtPct(a.exceedance.find((e) => e.threshold === 2)?.ci[0], 1)}–${fmtPct(a.exceedance.find((e) => e.threshold === 2)?.ci[1], 1)}`} />
        <StatTile label="Tail pressure" value={`${a.pressure.overallPressure}%`} sub={a.pressure.status} tone={a.pressure.overallPressure >= 65 ? "bad" : a.pressure.overallPressure >= 40 ? "warn" : "good"} />
        <StatTile label="Dry streak" value={a.streaks.currentKind === "below" ? `${a.streaks.current}` : "broken"} sub={`max ${a.streaks.maxBelow} · p(contin) ${fmtPct(a.streaks.markov.pStayBelow, 0)}`} tone={a.streaks.currentKind === "below" && a.streaks.current > 6 ? "warn" : "default"} />
        <StatTile label="ETA 10×" value={eta.data?.rows.find((r) => r.threshold === 10)?.etaMedian ?? "—"} sub={`KM pct ${fmtPct(eta.data?.rows.find((r) => r.threshold === 10)?.kmPercentile)}`} tone="signal" />
        <StatTile label="Cone coverage" value={fmtPct(cone.data?.coverage.p25p75)} sub={`n=${cone.data?.coverage.n ?? 0}`} tone={Math.abs((cone.data?.coverage.p25p75 ?? 0.5) - 0.5) < 0.05 ? "good" : "warn"} />
      </MetricGrid>

      <div className="grid gap-3 xl:grid-cols-3">
        <ShapeMiniCard />


        <Panel title="Accuracy engine — live verification" right={<Gauge className="h-4 w-4 text-primary" />}>
          <div className="space-y-2 text-[13px]">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Open predictions</span>
              <span className="font-data">{fmtInt(accuracy.data?.totals.open ?? 0)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Accumulative Brier</span>
              <span className="font-data">{accuracy.data?.totals.brier !== null && accuracy.data?.totals.brier !== undefined ? accuracy.data.totals.brier.toFixed(4) : "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Skill vs baseline</span>
              <span className={cn("font-data", (accuracy.data?.totals.liftPct ?? 0) > 0 ? "text-emerald-400" : "")}>
                {accuracy.data?.totals.liftPct !== null && accuracy.data?.totals.liftPct !== undefined ? `${accuracy.data.totals.liftPct > 0 ? "+" : ""}${accuracy.data.totals.liftPct}%` : "—"}
              </span>
            </div>
            <Link to="/dashboard/accuracy" className="mt-1 inline-flex items-center gap-1 text-[12px] text-primary hover:underline">
              Accuracy Engine v2 <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </Panel>

        <Panel title="Moonshot scanner">
          <div className="flex items-center gap-3">
            <div className={cn("flex h-16 w-16 items-center justify-center rounded-full border-2 font-data text-lg font-bold", a.moonshot.imminent ? "border-amber-400 text-amber-400" : "border-border text-muted-foreground")}>
              {Math.round(a.moonshot.confidence * 100)}
            </div>
            <div>
              <p className="text-[13px] font-medium">{a.moonshot.imminent ? "Conditions building" : "No moonshot edge"}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{a.moonshot.narrative}</p>
            </div>
          </div>
          <Link to="/dashboard/moonshot" className="mt-3 inline-flex items-center gap-1 text-[12px] text-primary hover:underline">
            Open Moonshot Finder <Zap className="h-3 w-3" />
          </Link>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {a.pressure.targets.slice(0, 3).map((t) => (
              <div key={t.target} className="rounded-lg border border-border/60 bg-background/40 p-2">
                <p className="font-data text-[12px] font-semibold">≥ {t.target.toLocaleString()}×</p>
                <p className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">
                  run {t.currentRun} · ETA ~{t.etaMedian ?? "—"} rounds
                  {t.etaMedian && cadenceMs ? ` · ≈ ${fmtEta(t.etaMedian, cadenceMs)}` : ""}
                </p>
                <div className="mt-1.5">
                  <Bar value={t.etaMedian ? Math.min(99, (t.currentRun / t.etaMedian) * 50) : 0} tone={t.etaMedian && t.currentRun >= t.etaMedian ? "warn" : "primary"} />
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="Mega pressure"
          right={
            <span className="flex items-center gap-2">
              <span className="font-data text-[11px] text-muted-foreground">
                {mega.data ? `${fmtInt(mega.data.overallPressure)}% · ${mega.data.status}` : "—"}
              </span>
              <Link to="/dashboard/mega-pressure" className="text-[11px] text-primary hover:underline">Mega →</Link>
            </span>
          }
        >
          {mega.data ? (
            <div className="space-y-1.5">
              {mega.data.targets.slice(0, 3).map((t) => (
                <div key={t.target}>
                  <Row label={`≥ ${fmtInt(t.target)}×`} value={`dry ${t.currentRun} · ETA ~${t.etaMedian ?? "—"} · p90 ${t.etaP90 ?? "—"}`} />
                  <div className="-mt-1.5 pb-1.5">
                    <Bar value={t.pressurePct} tone={t.pressurePct >= 85 ? "bad" : t.pressurePct >= 65 ? "warn" : "primary"} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-4 text-center text-[12px] text-muted-foreground">—</p>
          )}
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Full-range strip — measured P(≥ t) with Wilson 95% CI" className="xl:col-span-2">
          <div className="flex flex-wrap gap-2">
            {a.exceedance.map((e) => (
              <div
                key={e.threshold}
                className={cn(
                  "min-w-[104px] flex-1 rounded-lg border p-2.5",
                  liveThresholds.includes(e.threshold) ? "border-primary/30 bg-primary/5" : "border-border/70 bg-background/40",
                )}
              >
                <p className="font-data text-[13px] font-semibold">{e.threshold}×</p>
                <p className="font-data mt-0.5 text-[12px] text-foreground/90">{fmtPct(e.rate)}</p>
                <p className="text-[10px] text-muted-foreground">±{fmtPct((e.ci[1] - e.ci[0]) / 2, 1)} · run {e.currentRun}</p>
                <div className="mt-1.5">
                  <Bar value={e.rate * 100} />
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="ShapeShifters signal layer">
          <div className="space-y-2 text-[13px]">
            <Row label="Classification" value={a.shape.classification} />
            <Row label="Dry zone" value={a.shape.dryZone.active ? `active (sev ${a.shape.dryZone.severity})` : "inactive"} />
            <Row label="Pareto fit" value={`α ${a.shape.pareto.alpha} · ${a.shape.pareto.plausibility}`} />
            <Row label="Trajectory group" value={a.shape.trajectory.group} />
            <Row label="ETA to 10×" value={`~${a.shape.eta.find((e) => e.target === 10)?.median ?? "—"} rounds`} />
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Engine status">
          <div className="space-y-2 text-[13px]">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-muted-foreground"><Activity className="h-3.5 w-3.5" /> Feed engine</span>
              <span className="font-data text-muted-foreground">disabled</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-muted-foreground"><Gauge className="h-3.5 w-3.5" /> Rounds</span>
              <span className="font-data">{fmtInt(feed.data?.rounds ?? 0)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Analysis generated</span>
              <span className="font-data">{timeAgo(a.generatedAt)}</span>
            </div>
            <Link to="/dashboard/ingest" className="mt-1 inline-flex items-center gap-1 text-[12px] text-primary hover:underline">
              Ingest Console →
            </Link>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 pb-1.5 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-data">{value}</span>
    </div>
  );
}

/** Convert an ETA in rounds to a wall-clock duration from the live cadence. */
function fmtEta(rounds: number, cadenceMs: number): string {
  const ms = rounds * cadenceMs;
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `≈ ${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `≈ ${h}h ${m}m` : `≈ ${h}h`;
}
