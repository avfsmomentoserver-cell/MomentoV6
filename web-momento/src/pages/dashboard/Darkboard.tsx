// ShapeShifter Darkboard — the market read as shapes, not numbers.
// Current named shape at five windows (drawn), the projected shape as a fan,
// and the shape atlas: how often each shape appears and what followed it.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Shapes } from "lucide-react";
import { api } from "@/lib/api";
import { fmtInt, fmtPct } from "@/lib/format";
import { AV, getProjection } from "@/lib/v64";
import { PageHeader, Panel, StatTile } from "@/components/bits";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShapeGlyph, ShapeSketch } from "@/components/v64/ShapeViz";
import DarkboardClassic from "@/pages/dashboard/DarkboardClassic";
import { cn } from "@/lib/utils";

interface Family { name: string; family: string; description: string; samples: number; share: number; nextGe2: number; pinkWithin: number; liftGe2: number; liftPink: number; example: number[] }
interface Gallery { current: { window: number; name: string; family: string; description: string; path: number[] }[]; families: Family[]; base: { ge2: number; pinkWithin: number; follow: number }; sampledWindow: number; analysed: number }

const FAMILY_COLOR: Record<string, string> = { spike: AV.pink, rebound: "rgb(52, 211, 153)", arch: "rgb(251, 191, 36)", rise: AV.purple, slide: AV.blue, range: "rgb(148, 163, 184)", flat: "rgb(100, 116, 139)" };

function PathLine({ path, color, h = 56 }: { path: number[]; color: string; h?: number }) {
  if (path.length < 2) return null;
  const lo = Math.min(...path);
  const hi = Math.max(...path);
  const W = 200;
  const d = path.map((v, i) => `${i ? "L" : "M"}${((i / (path.length - 1)) * W).toFixed(1)},${(4 + (1 - (v - lo) / Math.max(1e-6, hi - lo)) * (h - 8)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${h}`} className="h-auto w-full" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export default function Darkboard() {
  const g = useQuery({ queryKey: ["shapes", "gallery"], queryFn: () => api.get<Gallery>("/api/v1/shapes/gallery"), refetchInterval: 30_000 });
  const p = useQuery({ queryKey: ["shapes", "project", 30, 20], queryFn: () => getProjection({ window: 30, horizon: 20 }), refetchInterval: 20_000 });
  const d = g.data;
  const proj = p.data;
  const agree = d ? d.current.filter((c) => c.family === d.current[2]?.family).length : 0;

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="ShapeShifter Darkboard"
        subtitle="The market as shapes: the path of cumulative log-excess over the last N rounds is named (Spike & Fade, V-Rebound, Arch, Staircase, Ramp, Sawtooth, Coil), the next shape is projected as a drawn fan from historical analogues, and the atlas shows what each shape was followed by."
        actions={<Link to="/dashboard/chart-lab" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-300/40 px-3 text-[12px] text-amber-200 hover:bg-amber-300/10"><Shapes className="h-3.5 w-3.5" /> Open Chart Lab</Link>}
      />
      <Tabs defaultValue="shapes">
        <TabsList>
          <TabsTrigger value="shapes">Shapes</TabsTrigger>
          <TabsTrigger value="classic">Classic darkboard</TabsTrigger>
        </TabsList>
        <TabsContent value="shapes" className="space-y-4">
          {proj && (
            <div className="grid gap-3 xl:grid-cols-3">
              <section className="rounded-xl border border-amber-300/30 bg-gradient-to-br from-amber-400/[0.06] via-card/60 to-card/60 p-4 xl:col-span-2">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">Projected next shape · {proj.horizon} rounds</p>
                    <h2 className="text-2xl font-semibold text-amber-200">{proj.name}</h2>
                    <p className="text-[12px] text-muted-foreground">{proj.description}</p>
                  </div>
                  <div className="text-right text-[11px] text-muted-foreground">
                    <p>current: <b className="text-foreground">{proj.currentShape.name}</b></p>
                    <p>{proj.analogues} analogues · confidence {fmtPct(proj.confidence, 0)} · drift {proj.drift > 0 ? "+" : ""}{proj.drift}</p>
                  </div>
                </div>
                <ShapeSketch p={proj} height={250} />
                <div className="mt-2 flex flex-wrap gap-3 text-[10.5px] text-muted-foreground">
                  <span><span className="mr-1 inline-block h-0.5 w-5 align-middle" style={{ background: `linear-gradient(90deg, ${AV.blue}, ${AV.purple})` }} />recent path</span>
                  <span><span className="mr-1 inline-block h-0.5 w-5 border-t-2 border-dashed border-amber-300 align-middle" />projected median shape</span>
                  <span><span className="mr-1 inline-block h-2.5 w-5 bg-amber-300/20 align-middle" />p25–p75 fan</span>
                  <span><span className="mr-1 inline-block h-0.5 w-5 border-t border-dotted border-slate-400 align-middle" />flat baseline</span>
                  <span>beads = decomputed rounds (hover for ETA)</span>
                </div>
              </section>
              <div className="space-y-3">
                <StatTile label="Window agreement" value={d ? `${agree} / ${d.current.length}` : "—"} sub={`windows sharing the 30-round family (${d?.current[2]?.family ?? "—"})`} tone={agree >= 4 ? "warn" : "default"} />
                <StatTile label="Chart-prediction ledger" value={proj.ledger?.skill == null ? "pending" : `${proj.ledger.skill > 0 ? "+" : ""}${(proj.ledger.skill * 100).toFixed(1)}%`} sub={`${proj.ledger?.resolved ?? 0} resolved · IQR coverage ${proj.ledger?.coverage == null ? "—" : fmtPct(proj.ledger.coverage, 0)}`} />
                <div className="rounded-xl border border-border/70 bg-card/60 p-3 text-[11.5px] leading-relaxed text-muted-foreground">{proj.honesty}</div>
              </div>
            </div>
          )}

          <Panel title="Current shape at five windows">
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
              {(d?.current ?? []).map((c) => (
                <div key={c.window} className="rounded-lg border border-border/70 bg-background/40 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-data text-[10.5px] text-muted-foreground">last {c.window}</span>
                    <span style={{ color: FAMILY_COLOR[c.family] }}><ShapeGlyph name={c.name} className="h-5 w-7" /></span>
                  </div>
                  <p className="text-[13px] font-semibold" style={{ color: FAMILY_COLOR[c.family] }}>{c.name}</p>
                  <PathLine path={c.path} color={FAMILY_COLOR[c.family] ?? AV.purple} />
                </div>
              ))}
            </div>
          </Panel>

          <Panel title={`Shape atlas — ${fmtInt(d?.analysed)} rounds sampled every 5 at window ${d?.sampledWindow ?? 30}; what followed each shape`}>
            <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {(d?.families ?? []).map((f) => (
                <div key={f.name} className={cn("rounded-xl border bg-card/60 p-3", f.name === proj?.currentShape.name ? "border-amber-300/50" : "border-border/70")}>
                  <div className="flex items-center gap-2.5">
                    <span className="rounded-lg bg-background/60 p-1.5" style={{ color: FAMILY_COLOR[f.family] }}><ShapeGlyph name={f.name} /></span>
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold" style={{ color: FAMILY_COLOR[f.family] }}>{f.name}{f.name === proj?.currentShape.name && <span className="ml-1.5 rounded bg-amber-300/15 px-1 text-[9.5px] uppercase text-amber-200">now</span>}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{f.description}</p>
                    </div>
                  </div>
                  <PathLine path={f.example} color={FAMILY_COLOR[f.family] ?? AV.purple} h={44} />
                  <div className="mt-1 grid grid-cols-3 gap-1.5 text-center font-data text-[11px]">
                    <div className="rounded bg-background/50 py-1"><p className="text-[9.5px] text-muted-foreground">share</p>{fmtPct(f.share, 1)}</div>
                    <div className={cn("rounded bg-background/50 py-1", f.liftGe2 > 1.03 ? "text-emerald-300" : f.liftGe2 < 0.97 ? "text-rose-300" : "")}><p className="text-[9.5px] text-muted-foreground">next ≥2×</p>{fmtPct(f.nextGe2, 1)}</div>
                    <div className={cn("rounded bg-background/50 py-1", f.liftPink > 1.03 ? "text-emerald-300" : f.liftPink < 0.97 ? "text-rose-300" : "")}><p className="text-[9.5px] text-muted-foreground">pink ≤{d?.base.follow}</p>{fmtPct(f.pinkWithin, 0)}</div>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">n {fmtInt(f.samples)} · lifts {f.liftGe2}× / {f.liftPink}× vs base {fmtPct(d?.base.ge2, 1)} / {fmtPct(d?.base.pinkWithin, 0)}</p>
                </div>
              ))}
            </div>
          </Panel>
        </TabsContent>
        <TabsContent value="classic"><DarkboardClassic /></TabsContent>
      </Tabs>
    </div>
  );
}
