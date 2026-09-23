import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, Gauge, History, Play, RefreshCw, Scale, Target, Trophy } from "lucide-react";
import { api } from "@/lib/api";
import { fmtInt, fmtPct, timeAgo } from "@/lib/format";
import type { AccuracyOverview, VerifyResult } from "@/lib/types";
import { Bar, EmptyState, Loading, PageHeader, Panel, StatTile } from "@/components/bits";
import { MultiLine } from "@/components/charts";
import { cn } from "@/lib/utils";

const WINDOW_ORDER = ["15m", "1h", "4h", "1d", "7d"];

/** Accuracy Engine v2 — multi-window scheduled predictions, verified against history. */
export default function AccuracyEngine() {
  const qc = useQueryClient();
  const overview = useQuery({
    queryKey: ["accuracy", "overview"],
    queryFn: () => api.get<AccuracyOverview>("/api/v1/accuracy/overview"),
    refetchInterval: 15_000,
  });
  const tick = useMutation({
    mutationFn: () => api.post<Record<string, unknown>>("/api/v1/accuracy/tick"),
    onSuccess: (d) => {
      toast.success(`Tick complete — ${d.resolved ?? 0} resolved, ${d.scheduled ?? 0} scheduled`);
      qc.invalidateQueries({ queryKey: ["accuracy"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
    },
  });
  const verify = useMutation({
    mutationFn: () => api.post<VerifyResult>("/api/v1/accuracy/verify", { source: "all" }),
    onSuccess: (d) => {
      toast.success(`Verified ${fmtInt(d.blocks)} blocks over ${fmtInt(d.scanned)} rounds — ledger updated`);
      qc.invalidateQueries({ queryKey: ["accuracy"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
    },
  });

  if (overview.isLoading) return <Loading rows={6} />;
  const o = overview.data;
  if (!o) return null;

  const t = o.totals;
  const windows = [...o.config.windows].sort((a, b) => WINDOW_ORDER.indexOf(a.id) - WINDOW_ORDER.indexOf(b.id));

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Accuracy Engine v2"
        subtitle="Scheduled multi-window predictions (15m · 1h · 4h · 1d · 7d) are stored before they land, resolved against the rounds history, and accumulated into an O(1) ledger that never resets — Brier skill vs baseline earns each engine its weight in the prediction pipeline."
        actions={
          <>
            <button
              onClick={() => tick.mutate()}
              disabled={tick.isPending}
              className="flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-60"
            >
              <Play className="h-3.5 w-3.5" /> Run tick now
            </button>
            <button
              onClick={() => verify.mutate()}
              disabled={verify.isPending}
              className="flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-[13px] hover:border-primary/40 disabled:opacity-60"
            >
              <History className={cn("h-3.5 w-3.5", verify.isPending && "animate-pulse")} />
              {verify.isPending ? "Verifying…" : "Verify against full history"}
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Open predictions" value={fmtInt(t.open)} sub={`${fmtInt(t.scheduled)} scheduled lifetime`} tone="signal" pulse />
        <StatTile label="Resolved (live)" value={fmtInt(t.resolved)} sub={`ledger n ${fmtInt(t.ledgerN)}`} />
        <StatTile label="Accumulative Brier" value={t.brier !== null ? t.brier.toFixed(4) : "—"} sub={`baseline ${t.base !== null ? t.base.toFixed(4) : "—"}`} />
        <StatTile label="Skill vs baseline" value={t.liftPct !== null ? `${t.liftPct > 0 ? "+" : ""}${t.liftPct}%` : "—"} sub="negative lift = baseline governs" tone={t.liftPct !== null && t.liftPct > 0 ? "good" : "default"} />
        <StatTile label="Hit rate" value={fmtPct(t.hitRate, 1)} sub="directional (p≥0.5 correct)" />
        <StatTile label="Last tick" value={o.lastTickMs ? timeAgo(o.lastTickMs) : "—"} sub={`cadence ~${Math.round(o.cadenceMs / 1000)}s · alarm scheduled`} />
      </div>

      <Panel
        title="Multi-window scorecard — scheduled predictions per window × threshold"
        right={<Link to="/dashboard/fx-lab" className="text-[11px] text-primary hover:underline">FX engines →</Link>}
      >
        {o.perWindow.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-4">Window</th>
                  <th className="py-2 pr-4">Threshold</th>
                  <th className="py-2 pr-4">Resolved</th>
                  <th className="py-2 pr-4">Brier (pipeline)</th>
                  <th className="py-2 pr-4">Brier (baseline)</th>
                  <th className="py-2 pr-4">Lift</th>
                  <th className="py-2 pr-4">Hit rate</th>
                  <th className="py-2">Skill share</th>
                </tr>
              </thead>
              <tbody>
                {o.perWindow
                  .slice()
                  .sort((a, b) => WINDOW_ORDER.indexOf(a.window) - WINDOW_ORDER.indexOf(b.window) || a.threshold - b.threshold)
                  .map((r) => {
                    const lift = r.brier !== null && r.base ? ((r.brier - r.base) / r.base) * 100 : null;
                    return (
                      <tr key={`${r.window}-${r.threshold}`} className="border-t border-border/50">
                        <td className="py-2 pr-4 font-medium">{r.window}</td>
                        <td className="font-data py-2 pr-4">{r.threshold}×</td>
                        <td className="font-data py-2 pr-4">{fmtInt(r.n)}</td>
                        <td className="font-data py-2 pr-4">{r.brier?.toFixed(5) ?? "—"}</td>
                        <td className="font-data py-2 pr-4">{r.base?.toFixed(5) ?? "—"}</td>
                        <td className={cn("font-data py-2 pr-4", lift !== null && lift > 0 && "text-emerald-400", lift !== null && lift < 0 && "text-rose-400")}>
                          {lift !== null ? `${lift > 0 ? "+" : ""}${lift.toFixed(2)}%` : "—"}
                        </td>
                        <td className="font-data py-2 pr-4">{r.hitRate !== null ? fmtPct(r.hitRate, 1) : "—"}</td>
                        <td className="py-2"><Bar value={r.n} max={Math.max(...o.perWindow.map((x) => x.n), 1)} /></td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No resolved predictions yet" hint="The scheduler stores one open prediction per window × threshold; each resolves when its window matures. Run a tick, or verify against full history to seed the ledger immediately." />
        )}
      </Panel>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Engine weights — earned from Brier skill, never assigned">
          <div className="space-y-2.5">
            {o.weights.map((w) => (
              <div key={w.model} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-[12.5px] font-medium">{w.model}</span>
                <Bar value={w.weight * 100} tone={w.weight > 0 ? "good" : "primary"} />
                <span className="font-data w-28 shrink-0 text-right text-[11.5px]">
                  w {(w.weight * 100).toFixed(1)}% · skill {w.skill >= 0 ? "+" : ""}{w.skill.toFixed(4)}
                </span>
              </div>
            ))}
            {!o.weights.length && <EmptyState title="No weights yet" hint="Weights appear once the ledger has ≥5 resolved blocks per model." />}
          </div>
          <p className="mt-3 flex items-start gap-2 text-[11.5px] leading-relaxed text-muted-foreground">
            <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Skill = baseline Brier − model Brier, accumulated across every window and threshold at unlimited scale. Positive skill earns pipeline weight; zero or negative skill earns nothing.
          </p>
        </Panel>

        <Panel title="Accumulative accuracy history — rolling Brier per window">
          <HistoryChart o={o} />
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Open scheduled predictions" right={<CalendarClock className="h-3.5 w-3.5 text-primary" />}>
          {o.open.length ? (
            <div className="space-y-1.5">
              {o.open.slice(0, 10).map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-[12.5px]">
                  <Target className="h-3.5 w-3.5 text-primary" />
                  <span className="font-medium">{p.window}</span>
                  <span className="font-data">{p.threshold}×</span>
                  <span className="font-data text-muted-foreground">P {(p.probability * 100).toFixed(1)}%</span>
                  <span className="ml-auto font-data text-[11px] text-muted-foreground">due {timeAgo(p.due_ms) === "0s ago" ? "now" : `in ${dueIn(p.due_ms)}`}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No open predictions" hint="Run a tick to schedule the next window set." />
          )}
        </Panel>

        <Panel title="Recently resolved — verified against the rounds history" right={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}>
          {o.recent.length ? (
            <div className="space-y-1.5">
              {o.recent.slice(0, 10).map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-[12.5px]">
                  <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">{p.window}</span>
                  <span className="font-data">{p.threshold}×</span>
                  <span className="font-data text-muted-foreground">P {(p.probability * 100).toFixed(1)}%</span>
                  <span className={cn("font-data", p.actual === 1 ? "text-emerald-400" : "text-rose-400")}>{p.actual === 1 ? "HIT" : "MISS"}</span>
                  <span className="font-data text-muted-foreground">brier {p.brier?.toFixed(4)}</span>
                  <span className="ml-auto font-data text-[11px] text-muted-foreground">{p.resolved_ms ? timeAgo(p.resolved_ms) : ""}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Nothing resolved yet" hint="Windows resolve on schedule — 15m first, then hourly and beyond." />
          )}
        </Panel>
      </div>

      {verify.data && (
        <Panel title="Full-history verification — walk-forward, non-overlapping window blocks" right={<Trophy className="h-3.5 w-3.5 text-primary" />}>
          <p className="mb-2 text-[12px] text-muted-foreground">
            {fmtInt(verify.data.blocks)} blocks scored across {fmtInt(verify.data.scanned)} rounds · every model saw only data strictly before each block.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-4">Window</th>
                  <th className="py-2 pr-4">Threshold</th>
                  <th className="py-2 pr-4">Blocks</th>
                  {["markov", "streak", "recent", "ensemble"].map((m) => (
                    <th key={m} className="py-2 pr-4">{m} Brier</th>
                  ))}
                  <th className="py-2">Base Brier</th>
                </tr>
              </thead>
              <tbody>
                {verify.data.runs.map((r) => (
                  <tr key={`${r.window}-${r.threshold}`} className="border-t border-border/50">
                    <td className="py-2 pr-4 font-medium">{r.window}</td>
                    <td className="font-data py-2 pr-4">{r.threshold}×</td>
                    <td className="font-data py-2 pr-4">{fmtInt(r.blocks)}</td>
                    {["markov", "streak", "recent", "ensemble"].map((m) => {
                      const score = r.models.find((x) => x.model === m)?.brier;
                      const best = score !== undefined && score <= Math.min(...r.models.map((x) => x.brier), r.brierBase) + 1e-9;
                      return (
                        <td key={m} className={cn("font-data py-2 pr-4", best && "text-emerald-400")}>
                          {score !== undefined ? score.toFixed(5) : "—"}
                        </td>
                      );
                    })}
                    <td className="font-data py-2">{r.blocks ? r.brierBase.toFixed(5) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="How accuracy compounds">
        <ol className="ml-4 list-decimal space-y-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
          <li><strong className="text-foreground">Schedule</strong> — every window × threshold keeps exactly one open prediction, stored with its full component breakdown before any round lands.</li>
          <li><strong className="text-foreground">Resolve</strong> — when the window matures, the engine counts the actual rounds in that window and scores the prediction (Brier + log-loss) against history.</li>
          <li><strong className="text-foreground">Accumulate</strong> — every resolution adds to the O(1) ledger (running sums, never pruned) — accuracy figures stay exact from the first prediction to the millionth.</li>
          <li><strong className="text-foreground">Earn weight</strong> — models with positive Brier skill vs baseline gain pipeline weight automatically; the rest drop to zero.</li>
          <li><strong className="text-foreground">Verify at scale</strong> — "Verify against full history" replays the entire dataset in honest walk-forward blocks and folds those blocks into the same ledger.</li>
        </ol>
        <p className="mt-3 text-[12px] text-muted-foreground">
          Scheduler runs on a Durable Object alarm and on every dashboard tick — double coverage, single ledger. Config lives in{" "}
          <Link to="/dashboard/settings" className="text-primary hover:underline">Master Settings</Link>.
        </p>
      </Panel>
    </div>
  );
}

function dueIn(dueMs: number): string {
  const s = Math.max(0, Math.floor((dueMs - Date.now()) / 1000));
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  if (s < 172800) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function HistoryChart({ o }: { o: AccuracyOverview }) {
  const series = useMemo(() => {
    const byKey = new Map<string, AccuracyOverview["history"]>();
    for (const h of o.history) {
      const key = `${h.window}|${h.threshold}`;
      const arr = byKey.get(key) ?? [];
      arr.push(h);
      byKey.set(key, arr);
    }
    const keys = [...byKey.keys()].sort((a, b) => {
      const [wa, ta] = a.split("|");
      const [wb, tb] = b.split("|");
      return WINDOW_ORDER.indexOf(wa) - WINDOW_ORDER.indexOf(wb) || Number(ta) - Number(tb);
    });
    return keys.slice(0, 4).map((key) => {
      const [win, thr] = key.split("|");
      return {
        key,
        label: `${win} ${thr}×`,
        color: COLORS[win] ?? "#06B6D4",
        data: (byKey.get(key) ?? []).map((h) => ({ x: String(h.cumulative_n), y: h.cumulative_brier })),
      };
    });
  }, [o.history]);

  if (!series.length) return <EmptyState title="No history yet" hint="Each resolution appends a cumulative accuracy point." />;
  const merged: Record<string, number | string>[] = [];
  const maxLen = Math.max(...series.map((s) => s.data.length));
  for (let i = 0; i < maxLen; i++) {
    const row: Record<string, number | string> = { x: series[0].data[i]?.x ?? "" };
    for (const s of series) if (s.data[i]) row[s.label] = s.data[i].y;
    merged.push(row);
  }
  return (
    <>
      <MultiLine
        data={merged}
        series={series.map((s) => ({ key: s.label, color: s.color }))}
        height={220}
      />
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} /> {s.label} · n {fmtInt(Number(s.data[s.data.length - 1]?.x ?? 0))}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">X axis = cumulative resolved predictions; Y = running Brier score. Flat-and-low is the goal; falling lines mean accuracy is improving as history accumulates.</p>
    </>
  );
}

const COLORS: Record<string, string> = {
  "15m": "#06B6D4",
  "1h": "#8B5CF6",
  "4h": "#F59E0B",
  "1d": "#34D399",
  "7d": "#F43F5E",
};
