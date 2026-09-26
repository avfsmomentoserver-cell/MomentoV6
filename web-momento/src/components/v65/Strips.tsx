// Small v6.5 add-ons embedded in existing pages
import { Link } from "react-router-dom";
import { useV1, pct } from "@/components/v65/kit";

type Sig = { base: number; window: number; rows: { key: string; label: string; active: boolean; lift: number; q: number; significant: boolean; n: number }[] };

/** F-19: signal significance strip — only BH-significant signals are highlighted; everything else is labelled noise. */
export function SignificanceStrip() {
  const s = useV1<Sig>("signals/significance", { refetch: 30_000 });
  if (!s.data) return null;
  const sig = s.data.rows.filter((r) => r.significant).length;
  return (
    <div className="rounded-xl border border-border bg-card/60 p-3">
      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        <span>Signal significance · base P(≥2×) {pct(s.data.base)} · n {s.data.window.toLocaleString()}</span>
        <Link to="/dashboard/explain" className="normal-case tracking-normal text-primary underline">{sig} of {s.data.rows.length} significant (BH q&lt;0.05)</Link>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {s.data.rows.map((r) => (
          <span key={r.key} title={`lift ${r.lift} · q ${r.q} · n ${r.n}`} className={`rounded-md border px-2 py-0.5 font-data text-[10.5px] ${r.significant ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300" : "border-border text-muted-foreground"} ${r.active ? "ring-1 ring-primary/50" : ""}`}>
            {r.label} · ×{r.lift} {r.significant ? "" : "· noise"}
          </span>
        ))}
      </div>
    </div>
  );
}

type Gate = { label: string; showBaseRate: boolean; note: string };
/** F-34: consumer gate — cards only show a model when it has earned skill; otherwise the labelled base rate. */
export function GateBadge() {
  const g = useV1<Gate>("app/gate", { refetch: 60_000 });
  if (!g.data) return null;
  return (
    <div className={`rounded-lg border px-3 py-2 text-[12px] ${g.data.showBaseRate ? "border-amber-500/40 bg-amber-500/10 text-amber-200" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"}`}>
      <b className="uppercase tracking-wider">{g.data.label}</b> — {g.data.note}
    </div>
  );
}

type Cone = { forecastId: number | null; cone: { h: number; p25: number; p50: number; p75: number; p90: number; max50: number; max90: number }[]; etaMarkers?: { threshold: number; rounds: number | null }[] };
/** F-12: forecast cone overlay summary (the full chart overlay lives on /dashboard/predict). */
export function ConeStrip() {
  const c = useV1<Cone>("intelligence/cone", { refetch: 15_000 });
  if (!c.data?.cone?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-card/60 p-3">
      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        <span>Forecast cone · next {c.data.cone.length} rounds · forecast #{c.data.forecastId ?? "—"}</span>
        <Link to="/dashboard/predict" className="normal-case tracking-normal text-primary underline">open cone on chart</Link>
      </div>
      <div className="grid grid-cols-5 gap-2 font-data text-[11px]">
        {c.data.cone.map((x) => (
          <div key={x.h} className="rounded-md border border-border/60 p-2">
            <p className="text-muted-foreground">+{x.h}</p>
            <p>p50 {x.p50}× · p90 {x.p90}×</p>
            <p className="text-muted-foreground">max-so-far p50 {x.max50}×</p>
          </div>
        ))}
      </div>
    </div>
  );
}
