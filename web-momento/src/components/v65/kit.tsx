// Shared primitives for the v6.5 Platform Book surfaces.
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { getAsOf, subscribeAsOf } from "@/lib/asof";
import { cn } from "@/lib/utils";

export function useAsOf(): number | null {
  const [v, setV] = useState<number | null>(getAsOf());
  useEffect(() => subscribeAsOf(setV), []);
  return v;
}

/** GET a v1 endpoint; the query key includes the active as_of so time travel never mixes caches. */
export function useV1<T>(path: string, opts: { refetch?: number; enabled?: boolean } = {}) {
  const asOf = useAsOf();
  return useQuery({
    queryKey: ["v65", path, asOf],
    queryFn: () => api.get<T>(`/api/v1/${path}`),
    refetchInterval: asOf ? false : opts.refetch ?? false,
    enabled: opts.enabled ?? true,
  });
}

export function Verdict({ ok, children, tone }: { ok?: boolean | null; tone?: "good" | "bad" | "warn" | "muted"; children: ReactNode }) {
  const t = tone ?? (ok === true ? "good" : ok === false ? "bad" : "muted");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 font-data text-[10.5px] uppercase tracking-wider",
        t === "good" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
        t === "bad" && "border-rose-500/40 bg-rose-500/10 text-rose-400",
        t === "warn" && "border-amber-500/40 bg-amber-500/10 text-amber-400",
        t === "muted" && "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

export interface Col<R> { key: string; label: string; render?: (r: R) => ReactNode; className?: string }
export function DataTable<R extends Record<string, unknown>>({ rows, cols, max = 400, empty = "No rows yet." }: { rows: R[]; cols: Col<R>[]; max?: number; empty?: string }) {
  if (!rows?.length) return <p className="py-6 text-center text-[12.5px] text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-auto" style={{ maxHeight: max }}>
      <table className="w-full min-w-[520px] font-data text-[12px]">
        <thead className="sticky top-0 bg-card">
          <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            {cols.map((c) => <th key={c.key} className="px-2 pb-2 font-medium">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/50 hover:bg-muted/30">
              {cols.map((c) => <td key={c.key} className={cn("px-2 py-1.5 align-top", c.className)}>{c.render ? c.render(r) : fmtCell(r[c.key])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function fmtCell(v: unknown): ReactNode {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 80);
  return String(v);
}

export const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d)}%`);
export const ci = (lo?: number | null, hi?: number | null, d = 3) => (lo == null || hi == null ? "" : `[${lo.toFixed(d)}, ${hi.toFixed(d)}]`);

/** Minimal inline bars (no chart lib needed). */
export function MiniBars({ values, labels, height = 120, max, highlight, color = "hsl(var(--primary))" }: { values: number[]; labels?: string[]; height?: number; max?: number; highlight?: number; color?: string }) {
  const m = max ?? Math.max(1e-9, ...values);
  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {values.map((v, i) => (
          <div key={i} className="flex-1 rounded-t-sm transition-all" title={`${labels?.[i] ?? i}: ${v}`} style={{ height: `${Math.max(1, (v / m) * 100)}%`, background: i === highlight ? "#f59e0b" : color, opacity: 0.85 }} />
        ))}
      </div>
      {labels && (
        <div className="mt-1 flex gap-[3px] font-data text-[9px] text-muted-foreground">
          {labels.map((l, i) => <span key={i} className="flex-1 truncate text-center">{l}</span>)}
        </div>
      )}
    </div>
  );
}

/** SVG line chart for small series: series = [{name,color,points:[x,y][]}]. */
export function MiniLines({ series, height = 180, yMin, yMax, diagonal }: { series: { name: string; color: string; points: [number, number][]; dashed?: boolean }[]; height?: number; yMin?: number; yMax?: number; diagonal?: boolean }) {
  const all = series.flatMap((s) => s.points);
  if (!all.length) return <p className="py-6 text-center text-[12px] text-muted-foreground">No data.</p>;
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || 1;
  const y0 = yMin ?? Math.min(...ys), y1 = yMax ?? Math.max(...ys);
  const W = 600, H = height;
  const X = (x: number) => ((x - x0) / (x1 - x0 || 1)) * (W - 30) + 25;
  const Y = (y: number) => H - 18 - ((y - y0) / (y1 - y0 || 1)) * (H - 28);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
        {[0, 0.5, 1].map((f) => {
          const y = y0 + f * (y1 - y0);
          return (
            <g key={f}>
              <line x1={25} x2={W - 5} y1={Y(y)} y2={Y(y)} stroke="currentColor" className="text-border" strokeDasharray="3 3" />
              <text x={0} y={Y(y) + 3} fontSize={9} className="fill-muted-foreground font-data">{y.toFixed(2)}</text>
            </g>
          );
        })}
        {diagonal && <line x1={X(x0)} y1={Y(y0)} x2={X(x1)} y2={Y(y1)} stroke="#64748b" strokeDasharray="4 4" />}
        {series.map((s) => (
          <polyline key={s.name} fill="none" stroke={s.color} strokeWidth={1.8} strokeDasharray={s.dashed ? "5 4" : undefined} points={s.points.map((p) => `${X(p[0])},${Y(p[1])}`).join(" ")} />
        ))}
      </svg>
      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        {series.map((s) => <span key={s.name} className="flex items-center gap-1"><span className="h-0.5 w-3" style={{ background: s.color }} />{s.name}</span>)}
      </div>
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">{children}</p>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

export const inputCls = "h-9 rounded-md border border-border bg-background px-2.5 font-data text-[13px] text-foreground outline-none focus:border-primary/60";
export const btnCls = "inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[13px] font-medium text-primary-foreground disabled:opacity-50";
export const btnGhost = "inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] text-muted-foreground hover:text-foreground";

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-300">{error instanceof Error ? error.message : String(error)}</p>;
}
