import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Activity, ArrowUpRight, Gauge, Package, Play, RefreshCw, Square, Telescope, Zap } from "lucide-react";
import { api, qs } from "@/lib/api";
import { fmtInt, fmtMult, fmtPct, timeAgo } from "@/lib/format";
import type { AccuracyOverview, Analysis, NextRoundForecast, PipelineForecast, Pressure, RoundDto } from "@/lib/types";
import { Bar, Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";
import { DownloadSourceButton } from "@/components/DownloadSourceButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// V5 state vocabulary, rendered on the v6 pipeline signals.
const STATE_COLOR: Record<string, string> = {
  Moonshot: "#22d3ee",
  Ignition: "#34d399",
  Bait: "#f59e0b",
  Exhaustion: "#fb923c",
  Collapse: "#f43f5e",
  Shelf: "#94a3b8",
};

const STATE_CHIP: Record<string, string> = {
  Moonshot: "border-cyan-400/40 bg-cyan-400/10 text-cyan-300",
  Ignition: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  Bait: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  Exhaustion: "border-orange-400/40 bg-orange-400/10 text-orange-300",
  Collapse: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  Shelf: "border-border/70 bg-background/40 text-muted-foreground",
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
    queryFn: () => api.get<{ rounds: RoundDto[] }>("/api/v1/rounds/latest?limit=24"),
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
  const bundleStats = useQuery({
    queryKey: ["bundle", "stats"],
    queryFn: () =>
      fetch("/downloads/bundle-stats.json")
        .then((r) => r.json() as Promise<{ files: number; sizeMb: number; version: string }>)
        .catch(() => null),
    staleTime: 60_000,
  });

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

      <MetricGrid>
        <StatTile label="Last round" value={fmtMult(last?.multiplier)} sub={`${last?.source ?? "—"} · ${timeAgo(last?.ts)}`} pulse tone={last && last.multiplier >= 10 ? "warn" : "signal"} />
        <StatTile label="P(≥ 2×)" value={fmtPct(a.exceedance.find((e) => e.threshold === 2)?.rate)} sub={`CI ${fmtPct(a.exceedance.find((e) => e.threshold === 2)?.ci[0], 1)}–${fmtPct(a.exceedance.find((e) => e.threshold === 2)?.ci[1], 1)}`} />
        <StatTile label="Tail pressure" value={`${a.pressure.overallPressure}%`} sub={a.pressure.status} tone={a.pressure.overallPressure >= 65 ? "bad" : a.pressure.overallPressure >= 40 ? "warn" : "good"} />
        <StatTile label="Dry streak" value={a.streaks.currentKind === "below" ? `${a.streaks.current}` : "broken"} sub={`max ${a.streaks.maxBelow} · p(contin) ${fmtPct(a.streaks.markov.pStayBelow, 0)}`} tone={a.streaks.currentKind === "below" && a.streaks.current > 6 ? "warn" : "default"} />
      </MetricGrid>

      <div className="grid gap-3 xl:grid-cols-3">
        <Card
          className="border-primary/30 bg-primary/[0.04] shadow-[0_0_0_1px_hsl(var(--primary)/0.08),0_0_28px_-8px_hsl(var(--primary)/0.25)] xl:col-span-2"
          aria-label="Next-round forecast"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <Telescope className="h-3.5 w-3.5 shrink-0 text-primary" />
              <div className="min-w-0">
                <h2 className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/90">Forecast</h2>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">Next-round projection · pipeline ensemble</p>
              </div>
            </div>
            <span className="font-data shrink-0 text-[11px] text-muted-foreground">
              {nr ? `cadence ~${Math.round(nr.cadenceMs / 1000)}s · h+1` : "—"}
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
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Expected</p>
                      <p className="font-data mt-0.5 text-xl font-semibold tabular-nums text-primary">{fmtMult(nr.expectedMultiplier)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Range</p>
                      <p className="font-data mt-0.5 text-sm tabular-nums">{fmtMult(nr.rangeLo)} — {fmtMult(nr.rangeHi)}</p>
                    </div>
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{nr.note}</p>
                  <div className="flex flex-wrap gap-1.5 border-t border-border/50 pt-2.5">
                    {nr.components.map((c) => (
                      <span key={c.model} className="font-data rounded-md border border-border/70 bg-background/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                        {c.model} {c.mid.toFixed(2)}
                      </span>
                    ))}
                    <span className="font-data rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] text-primary/80">
                      ensemble {nr.expectedMultiplier.toFixed(2)}
                    </span>
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
              <Link to="/dashboard/fx-lab" className="inline-flex items-center gap-1 text-primary hover:underline">
                FX Lab <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          </CardContent>
        </Card>

        <Panel
          title="Source bundle & step docs — the full platform, zipped"
          className="border-primary/30 bg-primary/[0.04]"
          right={<Package className="h-4 w-4 text-primary" />}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[14px] font-semibold">momento-platform-{bundleStats.data?.version ?? "6.2.0"}.zip</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                Complete runnable source + per-step build documentation, refreshed on every build and served from the platform's own downloads folder.
                {bundleStats.data && ` ${fmtInt(bundleStats.data.files)} files · ${bundleStats.data.sizeMb} MB.`}
              </p>
            </div>
            <DownloadSourceButton />
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-[12px]">
            <Link to="/dashboard/downloads" className="text-primary hover:underline">Downloads & release history →</Link>
            <Link to="/dashboard/build-steps" className="text-primary hover:underline">Build steps →</Link>
            <Link to="/dashboard/docs/source-bundle" className="text-primary hover:underline">Bundle documentation →</Link>
          </div>
        </Panel>

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
        <Panel title="Latest rounds" right={<Link to="/dashboard/market" className="text-[11px] text-primary hover:underline">Market →</Link>}>
          <div className="flex flex-wrap gap-1.5">
            {latest.data?.rounds.map((r) => (
              <span
                key={r.id}
                className="font-data rounded-md border border-border bg-background/40 px-2 py-1 text-[11px]"
                style={{ color: r.multiplier >= 100 ? "#F43F5E" : r.multiplier >= 10 ? "#F59E0B" : r.multiplier >= 2 ? "#8B5CF6" : "#3B82F6" }}
              >
                {r.multiplier.toFixed(2)}
              </span>
            ))}
          </div>
        </Panel>

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
