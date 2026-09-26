// Mawillah's Eagle Eye — v6.4 rebuild on the V5.01 structure.
// Full-history round explorer: stat tiles → filter panel (3 ranges, hue,
// ingest, origin, session, time window, auto-refresh) → Aviator-coloured
// multiplier stream (server paged, fullscreen) → CSV / JSON exports.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Download, Expand, Eye, Filter, Loader2, Minimize, RefreshCw, Table2, Grid3X3 } from "lucide-react";
import { toast } from "sonner";
import { api, BASE, qs } from "@/lib/api";
import { fmtInt, fmtMult } from "@/lib/format";
import { AV, hueColor } from "@/lib/v64";
import { PageHeader, Panel, StatTile } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface Row { id: number; ts: string; ts_ms: number; multiplier: number; source: string; session_id: number | null; ingest: string; origin: string }
interface PageData {
  rounds: Row[];
  page: number;
  pageSize: number;
  pages: number;
  filtered: number;
  total: number;
  stats: { n: number; avgCapped: number; max: number; min: number; blue: number; purple: number; pink: number; reconstructed: number; anchors: number; firstMs: number; lastMs: number };
  ingests: { ingest: string; n: number }[];
}
interface Session { id: number; source: string; started_ms: number; ended_ms: number; rounds: number; max_multiplier: number }

const PAGE_SIZES = [100, 200, 500, 1000];

export default function EagleEye() {
  const qc = useQueryClient();
  const [source, setSource] = useState("all");
  const [ranges, setRanges] = useState<{ on: boolean; lo: string; hi: string }[]>([
    { on: false, lo: "1", hi: "2" },
    { on: false, lo: "2", hi: "10" },
    { on: false, lo: "10", hi: "" },
  ]);
  const [hue, setHue] = useState("all");
  const [ingest, setIngest] = useState("all");
  const [origin, setOrigin] = useState("all");
  const [session, setSession] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(200);
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const [view, setView] = useState<"grid" | "table">("grid");
  const [full, setFull] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);

  const rangeParam = ranges.filter((r) => r.on && r.lo !== "").map((r) => `${r.lo}-${r.hi}`).join(",");
  const params = {
    source,
    ranges: rangeParam || undefined,
    hue: hue === "all" ? undefined : hue,
    ingest: ingest === "all" ? undefined : ingest,
    origin: origin === "all" ? undefined : origin,
    session: session === "all" ? undefined : session,
    from: from ? Date.parse(from) : undefined,
    to: to ? Date.parse(to) : undefined,
  };
  const key = JSON.stringify(params);
  useEffect(() => setPage(1), [key, pageSize]);

  const data = useQuery({
    queryKey: ["eagle-eye", key, page, pageSize, order],
    queryFn: () => api.get<PageData>(`/api/v1/rounds/page${qs({ ...params, page, pageSize, order })}`),
    refetchInterval: autoRefresh ? 5_000 : false,
    placeholderData: (prev) => prev,
  });
  const sources = useQuery({ queryKey: ["sources"], queryFn: () => api.get<{ sources: { name: string; rounds: number }[] }>("/api/v1/sources") });
  const sessions = useQuery({ queryKey: ["sessions", source], queryFn: () => api.get<{ sessions: Session[] }>(`/api/v1/sessions${qs({ source })}`) });

  const rebuild = useMutation({
    mutationFn: () => api.post<{ sessionsRebuilt: number }>("/api/v1/seed/prime", {}),
    onSuccess: () => {
      toast.success("Sessions rebuilt and deep scans refreshed");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void streamRef.current?.requestFullscreen?.();
  };

  const d = data.data;
  const st = d?.stats;
  const exportUrl = (format: "csv" | "json") => `${BASE}/api/v1/rounds/export${qs({ ...params, format })}`;
  const pageCsv = () => {
    if (!d) return;
    const lines = ["id,ts,multiplier,source,session_id,ingest,origin", ...d.rounds.map((r) => [r.id, r.ts, r.multiplier, r.source, r.session_id ?? "", r.ingest, r.origin].join(","))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `eagle-eye-page-${page}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };
  const colorShare = useMemo(() => {
    if (!st || !st.n) return null;
    return { blue: st.blue / st.n, purple: st.purple / st.n, pink: st.pink / st.n };
  }, [st]);

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Mawillah's Eagle Eye"
        subtitle="Continuous, filterable full-round history — Aviator colours, server-side paging over every stored round, exports of exactly what you filtered."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => data.refetch()}>
              {data.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
            </Button>
            <a href={exportUrl("csv")} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[12px] hover:bg-muted"><Download className="h-3.5 w-3.5" /> CSV (all filtered)</a>
            <a href={exportUrl("json")} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[12px] hover:bg-muted"><Download className="h-3.5 w-3.5" /> JSON</a>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Total rounds" value={fmtInt(d?.total)} sub={`${fmtInt(d?.filtered)} match filters`} tone="signal" pulse />
        <StatTile label="Average multiplier" value={fmtMult(st?.avgCapped)} sub="capped at 100× per round" />
        <StatTile label="Total range" value={st ? `${fmtMult(st.min)} – ${fmtMult(st.max)}` : "—"} sub={st?.firstMs ? `${new Date(st.firstMs).toLocaleDateString()} → ${new Date(st.lastMs).toLocaleDateString()}` : "—"} />
        <StatTile label="Ingest methods" value={d ? d.ingests.length : "—"} sub={d?.ingests.map((i) => `${i.ingest} ${fmtInt(i.n)}`).join(" · ") || "—"} />
        <div className="rounded-xl border border-border/80 bg-card/70 p-3.5">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Color distribution</p>
          {colorShare ? (
            <>
              <div className="mt-2 flex h-2.5 overflow-hidden rounded-full">
                <div style={{ width: `${colorShare.blue * 100}%`, background: AV.blue }} />
                <div style={{ width: `${colorShare.purple * 100}%`, background: AV.purple }} />
                <div style={{ width: `${colorShare.pink * 100}%`, background: AV.pink }} />
              </div>
              <div className="mt-2 flex justify-between font-data text-[11px]">
                <span style={{ color: AV.blue }}>{(colorShare.blue * 100).toFixed(1)}% &lt;2×</span>
                <span style={{ color: AV.purple }}>{(colorShare.purple * 100).toFixed(1)}%</span>
                <span style={{ color: AV.pink }}>{(colorShare.pink * 100).toFixed(1)}% ≥10×</span>
              </div>
              {(st?.reconstructed ?? 0) > 0 && <p className="mt-1 text-[10.5px] text-amber-300">{fmtInt(st?.reconstructed)} reconstructed · {fmtInt(st?.anchors)} anchors</p>}
            </>
          ) : (
            <p className="mt-2 text-[12px] text-muted-foreground">—</p>
          )}
        </div>
      </div>

      <Panel title="Filters — advanced round filtering" right={<Filter className="h-3.5 w-3.5 text-primary" />}>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Source</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  {(sources.data?.sources ?? []).map((s) => (
                    <SelectItem key={s.name} value={s.name}>{s.name} ({fmtInt(s.rounds)})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Aviator colour</Label>
              <Select value={hue} onValueChange={setHue}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All colours</SelectItem>
                  <SelectItem value="blue">Blue · &lt; 2×</SelectItem>
                  <SelectItem value="purple">Purple · 2× – 10×</SelectItem>
                  <SelectItem value="pink">Pink · ≥ 10×</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Ingest method</Label>
                <Select value={ingest} onValueChange={setIngest}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All methods</SelectItem>
                    {(d?.ingests ?? []).map((i) => (
                      <SelectItem key={i.ingest} value={i.ingest}>{i.ingest} ({fmtInt(i.n)})</SelectItem>
                    ))}
                    {["api", "file", "import", "live-feed", "seed", "top-rounds", "reconstruct"].filter((m) => !(d?.ingests ?? []).some((i) => i.ingest === m)).map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Origin</Label>
                <Select value={origin} onValueChange={setOrigin}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All origins</SelectItem>
                    <SelectItem value="real">Real only (no fills)</SelectItem>
                    <SelectItem value="observed">Observed</SelectItem>
                    <SelectItem value="anchor">Top-round anchors</SelectItem>
                    <SelectItem value="seeded">Seeded spans</SelectItem>
                    <SelectItem value="reconstructed">Reconstructed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Multiplier ranges (OR-combined; empty max = open)</Label>
            {ranges.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Switch checked={r.on} onCheckedChange={(on) => setRanges(ranges.map((x, j) => (j === i ? { ...x, on } : x)))} aria-label={`Enable range ${i + 1}`} />
                <span className="w-14 text-[10.5px] text-muted-foreground">Range {i + 1}</span>
                <Input type="number" min="1" step="0.01" value={r.lo} onChange={(e) => setRanges(ranges.map((x, j) => (j === i ? { ...x, lo: e.target.value } : x)))} className="h-8 font-mono text-xs" placeholder="min" />
                <span className="text-xs text-muted-foreground">–</span>
                <Input type="number" min="1" step="0.01" value={r.hi} onChange={(e) => setRanges(ranges.map((x, j) => (j === i ? { ...x, hi: e.target.value } : x)))} className="h-8 font-mono text-xs" placeholder="∞" />
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: hueColor(Number(r.lo) || 1) }} />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="space-y-1">
                <Label className="text-[10.5px] text-muted-foreground">From</Label>
                <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10.5px] text-muted-foreground">To</Label>
                <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 text-xs" />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Session</Label>
              <div className="flex gap-2">
                <Select value={session} onValueChange={setSession}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="All history" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All history</SelectItem>
                    {(sessions.data?.sessions ?? []).map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        #{s.id} {s.source} · {fmtInt(s.rounds)} rds · peak {fmtMult(s.max_multiplier)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={() => rebuild.mutate()} disabled={rebuild.isPending} title="Rebuild sessions from full database history">
                  {rebuild.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Page size</Label>
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Order</Label>
                <Select value={order} onValueChange={(v) => setOrder(v as "asc" | "desc")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desc">Newest first</SelectItem>
                    <SelectItem value="asc">Oldest first</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Auto refresh (5 s)</Label>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-[11px] text-muted-foreground"
              onClick={() => {
                setRanges(ranges.map((r) => ({ ...r, on: false })));
                setHue("all"); setIngest("all"); setOrigin("all"); setSession("all"); setFrom(""); setTo(""); setSource("all");
              }}
            >
              Reset all filters
            </Button>
          </div>
        </div>
      </Panel>

      <div ref={streamRef} className={cn(full && "overflow-y-auto bg-background p-4")}>
        <Panel
          title={`Multiplier stream — ${fmtInt(d?.filtered)} rounds (page ${d?.page ?? 1} of ${fmtInt(d?.pages ?? 1)})`}
          right={
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={() => setPage(1)} disabled={page <= 1}>«</Button>
              <Button size="sm" variant="outline" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}>Previous</Button>
              <Input
                aria-label="Page"
                className="h-8 w-16 text-center font-mono text-xs"
                value={page}
                onChange={(e) => setPage(Math.min(d?.pages ?? 1, Math.max(1, Number(e.target.value) || 1)))}
              />
              <Button size="sm" variant="outline" onClick={() => setPage(Math.min(d?.pages ?? 1, page + 1))} disabled={page >= (d?.pages ?? 1)}>Next</Button>
              <Button size="sm" variant="outline" onClick={() => setPage(d?.pages ?? 1)} disabled={page >= (d?.pages ?? 1)}>»</Button>
              <Button size="sm" variant="ghost" onClick={() => setView(view === "grid" ? "table" : "grid")} className="gap-1.5">
                {view === "grid" ? <Table2 className="h-3.5 w-3.5" /> : <Grid3X3 className="h-3.5 w-3.5" />} {view === "grid" ? "Table" : "Grid"}
              </Button>
              <Button size="sm" variant="ghost" onClick={pageCsv} className="gap-1.5"><Download className="h-3.5 w-3.5" /> Page CSV</Button>
              <Button size="sm" variant="ghost" onClick={toggleFull} className="gap-1.5">
                {full ? <Minimize className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />} {full ? "Exit Fullscreen" : "Fullscreen"}
              </Button>
            </div>
          }
        >
          {!d ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[12px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading rounds…</div>
          ) : d.rounds.length === 0 ? (
            <div className="py-16 text-center text-[12px] text-muted-foreground"><Eye className="mx-auto mb-2 h-5 w-5" />No rounds match these filters.</div>
          ) : view === "grid" ? (
            <div className="grid grid-cols-5 gap-1 sm:grid-cols-10 lg:grid-cols-[repeat(20,minmax(0,1fr))]">
              {d.rounds.map((r) => (
                <div
                  key={r.id}
                  title={`#${r.id} · ${new Date(r.ts).toLocaleString()} · ${r.source} · session ${r.session_id ?? "—"} · ${r.ingest} · ${r.origin}`}
                  className={cn(
                    "relative rounded-md px-1 py-1.5 text-center font-data text-[11px] font-semibold tabular-nums",
                    r.origin === "reconstructed" && "border border-dashed border-amber-300/60 opacity-70",
                    r.origin === "anchor" && "ring-1 ring-sky-300/70",
                  )}
                  style={{ color: hueColor(r.multiplier), background: hueColor(r.multiplier).replace("rgb", "rgba").replace(")", ", 0.13)") }}
                >
                  {r.multiplier >= 1000 ? `${(r.multiplier / 1000).toFixed(1)}k` : r.multiplier.toFixed(2)}
                  {r.origin === "reconstructed" && <span className="absolute right-0.5 top-0 text-[8px] text-amber-300">R</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
                    {["ID", "Time", "Multiplier", "Source", "Session", "Ingest", "Origin"].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {d.rounds.map((r) => (
                    <tr key={r.id} className="border-t border-border/40">
                      <td className="px-2 py-1 font-data text-muted-foreground">{r.id}</td>
                      <td className="px-2 py-1 font-data">{new Date(r.ts).toLocaleString()}</td>
                      <td className="px-2 py-1 font-data font-semibold" style={{ color: hueColor(r.multiplier) }}>{r.multiplier.toFixed(2)}×</td>
                      <td className="px-2 py-1">{r.source}</td>
                      <td className="px-2 py-1 font-data">{r.session_id ?? "—"}</td>
                      <td className="px-2 py-1">{r.ingest}</td>
                      <td className={cn("px-2 py-1", r.origin === "reconstructed" && "text-amber-300")}>{r.origin}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-[10.5px] text-muted-foreground">
            Colours follow Spribe Aviator: <span style={{ color: AV.blue }}>blue &lt; 2×</span>, <span style={{ color: AV.purple }}>purple 2–10×</span>, <span style={{ color: AV.pink }}>pink ≥ 10×</span>. Dashed tiles marked R are reconstructed gap fills (never scored); ringed tiles are real top-round anchors.
          </p>
        </Panel>
      </div>
    </div>
  );
}
