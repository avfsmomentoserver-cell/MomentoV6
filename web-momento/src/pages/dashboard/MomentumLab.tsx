import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, Gauge, Rocket, Waves } from "lucide-react";
import { api } from "@/lib/api";
import { fmtInt } from "@/lib/format";
import type { AssessmentResult, MomentumOverview, PipelineForecast } from "@/lib/types";
import { Bar, Loading, PageHeader, Panel, Row, StatTile } from "@/components/bits";
import { Candles, TrendLine } from "@/components/charts";
import { cn } from "@/lib/utils";

const BUCKETS = [
  { label: "1m", ms: 60_000 },
  { label: "5m", ms: 300_000 },
  { label: "15m", ms: 900_000 },
];

const SIDE_WINDOWS = ["15m", "1h", "4h"];
const SIDE_THRESHOLDS = [2, 5, 10];

const trendTone = (t: string) => (t === "accelerating" ? "text-emerald-400" : t === "cooling" ? "text-rose-400" : "text-muted-foreground");

/** Momentum Lab — hit points, anchors, range momentum, moonshot research, inverted lens, continuous assessment. */
export default function MomentumLab() {
  const [bucketMs, setBucketMs] = useState(300_000);

  const overview = useQuery({
    queryKey: ["momentum", bucketMs],
    queryFn: () => api.get<MomentumOverview>(`/api/v1/momentum/overview?bucketMs=${bucketMs}`),
    refetchInterval: 20_000,
  });
  const pipeline = useQuery({
    queryKey: ["pipeline", "forecast"],
    queryFn: () => api.get<PipelineForecast>("/api/v1/pipeline/forecast"),
    refetchInterval: 20_000,
  });
  const assessment = useQuery({
    queryKey: ["momentum", "assessment"],
    queryFn: () => api.get<AssessmentResult>("/api/v1/momentum/assessment"),
    refetchInterval: 15_000,
  });

  if (overview.isLoading || pipeline.isLoading) return <Loading rows={6} />;
  const m = overview.data;
  const p = pipeline.data;
  if (!m || !p) return null;

  const tiles = [
    {
      label: "Moonshot readiness",
      value: m.moonshot.readiness !== null ? `${m.moonshot.readiness}%` : "—",
      sub: `${m.moonshot.hits} historical ≥${m.moonshot.threshold}× · share ${(m.moonshot.share * 100).toFixed(2)}%`,
      tone: m.moonshot.readiness !== null && m.moonshot.readiness >= 60 ? ("signal" as const) : ("default" as const),
      pulse: true,
    },
    {
      label: "Anchor phase",
      value: m.anchors.state.phase,
      sub:
        m.anchors.state.phase === "forming"
          ? `rising run ${m.anchors.state.risingRun}r · potential ${m.anchors.state.potential}×`
          : m.anchors.state.lastPeak !== null
            ? `last peak ${m.anchors.state.lastPeak}× · ${fmtInt(m.anchors.state.roundsSincePeak ?? 0)}r ago`
            : "no anchor yet",
      tone: m.anchors.state.phase === "forming" ? ("signal" as const) : ("default" as const),
    },
    {
      label: "5x+ momentum",
      value: m.momentum.find((r) => r.min === 5)?.momentum !== null && m.momentum.find((r) => r.min === 5)?.momentum !== undefined ? String(m.momentum.find((r) => r.min === 5)?.momentum) : "—",
      sub: `${m.momentum.find((r) => r.min === 5)?.trend ?? "—"} · run ${fmtInt(m.momentum.find((r) => r.min === 5)?.currentRun ?? 0)}r`,
      tone: "default" as const,
    },
    {
      label: "Bucket agreement",
      value: assessment.data?.buckets.agreement !== null && assessment.data?.buckets.agreement !== undefined ? `${Math.round(assessment.data.buckets.agreement * 100)}%` : "—",
      sub: `hit-point energy vs trailing mean · n ${assessment.data?.buckets.tested ?? 0}`,
      tone: "default" as const,
    },
  ];

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Momentum Lab"
        subtitle={`${fmtInt(m.rounds)} rounds · time-bucketed hit points, anchor structures, gap momentum, moonshot condition research, and the inverted lens — side-by-side with the standard pipeline.`}
        actions={
          <Link to="/dashboard/fx-lab" className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] hover:border-primary/40">
            <Waves className="h-4 w-4 text-primary" /> FX Analysis Lab <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {tiles.map((t) => (
          <StatTile key={t.label} label={t.label} value={t.value} sub={t.sub} tone={t.tone} pulse={t.pulse} />
        ))}
      </div>

      <Panel
        title="Standard vs inverted forecast — same windows, opposite lens"
        right={<span className="font-data text-[11px] text-muted-foreground">inverted anchor {m.inverted.anchor}× · tail {fmtInt(m.inverted.tailRounds)}r</span>}
      >
        <div className="grid gap-3 md:grid-cols-3">
          {SIDE_WINDOWS.map((wid) => {
            const std = p.windows.find((w) => w.window === wid);
            const inv = m.inverted.windows.find((w) => w.window === wid);
            if (!std || !inv) return null;
            return (
              <div key={wid} className="rounded-lg border border-border/60 bg-background/40 p-3">
                <p className="text-[12px] font-medium">
                  {std.label} <span className="font-data text-muted-foreground">· ~{fmtInt(std.expectedRounds)} rounds</span>
                </p>
                <div className="mt-2 space-y-2">
                  {SIDE_THRESHOLDS.map((t) => {
                    const sp = std.predictions.find((x) => x.threshold === t)?.probability ?? 0;
                    const dip = inv.readings.find((x) => x.threshold === t)?.dipProbability ?? 0;
                    const agree = sp >= 0.5 && dip <= 0.5;
                    return (
                      <div key={t} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-data w-8 text-[11px] text-muted-foreground">{t}×</span>
                          <div className="flex-1">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">standard P(hit)</p>
                            <Bar value={sp * 100} tone={sp >= 0.5 ? "good" : "primary"} />
                          </div>
                          <div className="flex-1">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">inverted dip P</p>
                            <Bar value={dip * 100} tone={dip >= 0.5 ? "bad" : "primary"} />
                          </div>
                          <span className={cn("font-data w-9 text-right text-[11px]", agree ? "text-emerald-400" : "text-muted-foreground")}>
                            {agree ? "AGREE" : ""}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">{m.inverted.note}</p>
      </Panel>

      <Panel
        title="Combined hit points — mega hits divided across their span"
        right={
          <div className="flex gap-1">
            {BUCKETS.map((b) => (
              <button
                key={b.ms}
                onClick={() => setBucketMs(b.ms)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                  bucketMs === b.ms ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {b.label}
              </button>
            ))}
          </div>
        }
      >
        {m.hitPoints.length > 2 ? (
          <>
            <Candles
              candles={m.hitPoints.slice(-64).map((b) => ({ t: Math.floor(b.t / 1000), o: b.open, h: b.high, l: b.low, c: b.close, n: b.count }))}
              height={240}
            />
            <p className="mt-2 text-[11px] text-muted-foreground">Candles: open/high/low/close of raw multipliers per {BUCKETS.find((b) => b.ms === bucketMs)?.label} bucket.</p>
            <div className="mt-3">
              <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">Combined hit-point energy (≥10× hits split across buckets)</p>
              <TrendLine data={m.hitPoints.slice(-120).map((b) => ({ x: new Date(b.t).toLocaleTimeString(), y: b.energy }))} height={140} />
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {m.hitPoints.slice(-12).filter((b) => b.megaCount > 0).map((b) => (
                <span key={b.t} className="font-data rounded-md border border-amber-400/30 bg-amber-400/5 px-2 py-0.5 text-[11px] text-amber-400">
                  {new Date(b.t).toLocaleTimeString()} · {b.megaCount} mega · energy {b.energy}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="text-[13px] text-muted-foreground">Not enough rounds yet for bucketed hit points.</p>
        )}
      </Panel>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Anchor structures — peaks and their direction effect" right={<Rocket className="h-3.5 w-3.5 text-primary" />}>
          <div className="space-y-2 text-[13px]">
            <Row label="State" value={`${m.anchors.state.phase}${m.anchors.state.phase === "forming" ? ` · run ${m.anchors.state.risingRun}r · potential ${m.anchors.state.potential}×` : ""}`} />
            <Row label="Anchor count / median peak / size" value={`${m.anchors.count} · ${m.anchors.medianPeak}× · ${m.anchors.medianSize}r`} />
            <Row label="Direction effect (next 10 rounds)" value={m.anchors.direction.pctUpward !== null ? `${Math.round(m.anchors.direction.pctUpward * 100)}% upward · next mean ${m.anchors.direction.nextMean}× vs ${m.anchors.direction.globalMean}×` : "—"} />
          </div>
          <div className="mt-3 space-y-2">
            {m.anchors.direction.bySize.map((b) => (
              <div key={b.band} className="flex items-center gap-2">
                <span className="w-24 text-[12px] text-muted-foreground">{b.band}</span>
                <Bar value={(b.pctUpward ?? 0) * 100} tone={(b.pctUpward ?? 0) >= 0.5 ? "good" : "bad"} />
                <span className="font-data w-28 text-right text-[11px]">{b.n ? `${Math.round((b.pctUpward ?? 0) * 100)}% · n ${b.n}` : "no sample"}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {m.anchors.recent.slice(-10).reverse().map((a) => (
              <span key={a.peakTsMs} className="font-data rounded-md border border-border bg-background/60 px-2 py-1 text-[11px]">
                peak <span className="text-primary">{a.peak}×</span> · size {a.size}r
              </span>
            ))}
          </div>
        </Panel>

        <Panel title="Range momentum — gap compression per threshold" right={<Gauge className="h-3.5 w-3.5 text-primary" />}>
          <div className="space-y-2.5">
            {m.momentum.map((r) => (
              <div key={r.id} className="flex items-center gap-3">
                <span className="font-data w-12 text-[12px] font-medium">{r.id}</span>
                <div className="flex-1">
                  <Bar value={(r.momentum ?? 0) * 33.4} tone={r.trend === "accelerating" ? "good" : r.trend === "cooling" ? "bad" : "primary"} />
                </div>
                <span className={cn("font-data w-24 text-right text-[11px]", trendTone(r.trend))}>
                  {r.momentum !== null ? r.momentum : "—"} · {r.trend}
                </span>
                <span className="font-data hidden w-36 text-right text-[11px] text-muted-foreground md:block">
                  gap {r.medianGap}r · run {fmtInt(r.currentRun)}r
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11.5px] text-muted-foreground">
            Momentum = long-run median gap ÷ recent median gap. Very short intervals between e.g. 5×+ hits push the score above 1 — the range is heating.
          </p>
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Moonshot conditions — researched before every ≥10× hit">
          <div className="space-y-2">
            {m.moonshot.conditions.map((c) => (
              <div key={c.key} className="flex items-center gap-3 border-b border-border/50 pb-2 last:border-0">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", c.met === true ? "bg-emerald-400" : c.met === false ? "bg-border" : "bg-muted-foreground")} />
                <span className="flex-1 text-[12.5px]">{c.label}</span>
                <span className="font-data text-[11.5px] text-muted-foreground">
                  now <span className="text-foreground">{c.current ?? "—"}</span> · typical {c.median}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">{m.moonshot.note}</p>
        </Panel>

        <Panel title="Range-filtered prediction — each band on its own series">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-4">Band</th>
                  <th className="py-2 pr-4">Rate</th>
                  <th className="py-2 pr-4">Median gap</th>
                  <th className="py-2 pr-4">15m</th>
                  <th className="py-2">1h</th>
                </tr>
              </thead>
              <tbody>
                {m.rangeForecast.map((b) => {
                  const w15 = b.windows.find((w) => w.window === "15m");
                  const w1h = b.windows.find((w) => w.window === "1h");
                  return (
                    <tr key={b.id} className="border-t border-border/50">
                      <td className="py-2 pr-4 font-medium">{b.id}</td>
                      <td className="font-data py-2 pr-4">{(b.rate * 100).toFixed(2)}%</td>
                      <td className="font-data py-2 pr-4">{b.medianGap}r</td>
                      <td className="font-data py-2 pr-4 text-primary">{w15 ? `${(w15.probability * 100).toFixed(1)}%` : "—"}</td>
                      <td className="font-data py-2">{w1h ? `${(w1h.probability * 100).toFixed(1)}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11.5px] text-muted-foreground">
            Per-round probability blends each band's measured rate with the geometric estimate from its median gap; window probabilities follow the live cadence.
          </p>
        </Panel>
      </div>

      <Panel title="Continuous assessment — open predictions watched between resolutions">
        {assessment.isLoading || !assessment.data ? (
          <p className="text-[13px] text-muted-foreground">Loading…</p>
        ) : assessment.data.predictions.length ? (
          <div className="space-y-2">
            {assessment.data.predictions.slice(0, 8).map((a) => (
              <div key={a.id} className="flex items-center gap-3">
                <span className="font-data w-10 text-[11px] text-muted-foreground">{a.window}</span>
                <span className="font-data w-8 text-[11px]">{a.threshold}×</span>
                <div className="flex-1">
                  <Bar value={a.progress * 100} tone={a.hitYet ? "good" : "primary"} />
                </div>
                <span className="font-data w-16 text-right text-[11px]">{Math.round(a.progress * 100)}%</span>
                <span className="font-data hidden w-40 text-right text-[11px] text-muted-foreground md:block">
                  max {a.maxSeen}× · pace {a.onPace} · p {(a.p * 100).toFixed(0)}%
                </span>
                <span
                  className={cn(
                    "w-16 rounded-md px-1.5 py-0.5 text-center text-[10.5px] font-medium",
                    a.verdictNow === "cleared" ? "bg-emerald-400/10 text-emerald-400" : a.verdictNow === "expired" ? "bg-rose-400/10 text-rose-400" : "bg-primary/10 text-primary",
                  )}
                >
                  {a.verdictNow}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">No open predictions right now — the Accuracy Engine scheduler will populate this as windows are scheduled.</p>
        )}
        {assessment.data?.buckets.tested ? (
          <p className="mt-3 text-[11.5px] text-muted-foreground">
            Bucket energy agreement {Math.round((assessment.data.buckets.agreement ?? 0) * 100)}% over {assessment.data.buckets.tested} recent 5-min buckets · drift index {assessment.data.buckets.driftIndex} (1.0 = flat).
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
