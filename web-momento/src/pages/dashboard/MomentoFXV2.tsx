import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { Candle, RoundDto } from "@/lib/types";
import { Loading, PageHeader, Panel } from "@/components/bits";
import { cn } from "@/lib/utils";

interface Tool {
  id: string;
  label: string;
}

const TOOLS: Tool[] = [
  { id: "crosshair", label: "Crosshair" },
  { id: "trend", label: "Trendline" },
  { id: "ray", label: "Ray" },
  { id: "fib", label: "Fib retracement" },
  { id: "rect", label: "Rectangle" },
];

interface Drawing {
  tool: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** MomentoFX v2.0 — canvas chart with the advanced drawing workbench (trendlines, rays, fib, rectangles, crosshair). */
export default function MomentoFXV2() {
  const candles = useQuery({
    queryKey: ["fx-candles", 900],
    queryFn: () => api.get<{ candles: Candle[] }>("/api/v1/market/candles?tf=900&limit=120"),
    refetchInterval: 10_000,
  });
  const latest = useQuery({
    queryKey: ["rounds", "latest", "fxv2"],
    queryFn: () => api.get<{ rounds: RoundDto[] }>("/api/v1/rounds/latest?limit=40"),
    refetchInterval: 6_000,
  });

  const [tool, setTool] = useState("crosshair");
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [draft, setDraft] = useState<Drawing | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const data = candles.data?.candles ?? [];
  const max = useMemo(() => Math.max(...data.map((c) => c.h), 2), [data]);

  const toLocal = (e: React.MouseEvent): { x: number; y: number } => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const priceAt = (y: number): number => Math.max(1, max * (1 - y / (canvasRef.current?.clientHeight ?? 300)));

  const onMouseDown = (e: React.MouseEvent) => {
    if (tool === "crosshair") return;
    const p = toLocal(e);
    setDraft({ tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y });
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const p = toLocal(e);
    setHover(p);
    if (draft) setDraft({ ...draft, x2: p.x, y2: p.y });
  };
  const onMouseUp = () => {
    if (draft) setDrawings((ds) => [...ds, draft]);
    setDraft(null);
  };

  if (candles.isLoading) return <Loading rows={5} />;

  const lineStyle = (d: Drawing): React.CSSProperties => {
    const x1 = Math.min(d.x1, d.x2), y1 = Math.min(d.y1, d.y2);
    const w = Math.abs(d.x2 - d.x1), h = Math.abs(d.y2 - d.y1);
    if (d.tool === "rect") return { left: x1, top: y1, width: w, height: h, border: "1px solid #06B6D4AA", background: "#06B6D411" };
    return { left: x1, top: y1, width: Math.hypot(w, h), height: 1, transformOrigin: "0 0", transform: `rotate(${Math.atan2(d.y2 - d.y1, d.x2 - d.x1)}rad)`, background: d.tool === "fib" ? "#8B5CF6AA" : "#06B6D4AA" };
  };

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="MomentoFX v2.0"
        subtitle="The drawing workbench: trendlines, rays, Fibonacci retracement, rectangles and crosshair on the 15-minute series. Drawings persist for the session."
      />

      <div className="flex flex-wrap gap-1.5">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTool(t.id)}
            className={cn("rounded-lg border px-3 py-1.5 text-[12.5px]", tool === t.id ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-card/60 text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </button>
        ))}
        {drawings.length > 0 && (
          <button type="button" onClick={() => setDrawings([])} className="rounded-lg border border-destructive/40 px-3 py-1.5 text-[12.5px] text-destructive">
            Clear {drawings.length}
          </button>
        )}
      </div>

      <Panel>
        <div
          ref={canvasRef}
          className="relative h-[380px] w-full cursor-crosshair select-none overflow-hidden rounded-lg bg-background/60"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={() => { setHover(null); onMouseUp(); }}
        >
          {data.map((c, i) => {
            const up = c.c >= c.o;
            const color = up ? "#34D399" : "#F43F5E";
            const w = `calc(${100 / data.length}% - 1px)`;
            const bodyTop = 100 - (Math.max(c.o, c.c) / max) * 100;
            const bodyH = Math.max(0.6, ((Math.abs(c.o - c.c) / max) * 100));
            const wickTop = 100 - (c.h / max) * 100;
            const wickH = 100 - (c.l / max) * 100 - wickTop;
            return (
              <div key={i} className="absolute" style={{ left: `${(i / data.length) * 100}%`, width: w, top: 0, bottom: 0 }}>
                <div className="absolute inset-x-[45%]" style={{ top: `${wickTop}%`, height: `${wickH}%`, background: color, opacity: 0.5 }} />
                <div className="absolute inset-x-0" style={{ top: `${bodyTop}%`, height: `${bodyH}%`, background: color }} />
              </div>
            );
          })}
          {[...drawings, ...(draft ? [draft] : [])].map((d, i) => (
            <div key={i} className="pointer-events-none absolute" style={lineStyle(d)} />
          ))}
          {hover && (
            <div className="pointer-events-none absolute font-data rounded border border-border bg-popover px-1.5 py-0.5 text-[10px]" style={{ left: hover.x + 10, top: hover.y - 20 }}>
              {priceAt(hover.y).toFixed(2)}×
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Session feed">
        <div className="flex flex-wrap gap-1.5">
          {latest.data?.rounds.map((r) => (
            <span key={r.id} title={fmtDateTime(r.ts)} className="font-data rounded-md border border-border bg-background/40 px-2 py-1 text-[11px]" style={{ color: r.multiplier >= 10 ? "#F59E0B" : r.multiplier >= 2 ? "#8B5CF6" : "#3B82F6" }}>
              {r.multiplier.toFixed(2)}
            </span>
          ))}
        </div>
      </Panel>
    </div>
  );
}
