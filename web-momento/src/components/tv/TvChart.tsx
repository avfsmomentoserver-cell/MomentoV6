// TradingView-grade chart for Momento (lightweight-charts v5).
//
// Ported and hardened from the user's MomentoFX LightweightChartWrapper +
// momento-core DrawingManager: chart-type switch, log/linear scale,
// indicators (EMA 20/50, Bollinger, volume, RSI pane), drawing tools on an
// overlay canvas anchored to (time, price) so they survive zoom/scroll,
// zoom in/out/fit, fullscreen, PNG snapshot, crosshair OHLC legend and a
// forecast overlay (projected p50 path + p25–p75 fan).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  PriceScaleMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  BarChart3,
  Camera,
  CandlestickChart,
  Eraser,
  Maximize2,
  Minus,
  MousePointer2,
  RectangleHorizontal,
  RotateCcw,
  Slash,
  TrendingUp,
  ZoomIn,
  ZoomOut,
  AreaChart as AreaIcon,
  LineChart as LineIcon,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface TvCandle {
  t: number; // unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  n?: number;
}

export interface TvProjectionPoint {
  t: number; // unix seconds
  p25: number;
  p50: number;
  p75: number;
}

type ChartKind = "candles" | "heikin" | "bars" | "line" | "area";
type Tool = "none" | "trend" | "hline" | "rect" | "fib" | "erase";
type Indicator = "ema20" | "ema50" | "bb" | "volume" | "rsi";

interface Anchor {
  time: number;
  price: number;
}
interface Drawing {
  id: string;
  type: Exclude<Tool, "none" | "erase">;
  a: Anchor;
  b: Anchor;
}

const AV_BLUE = "rgb(52, 180, 255)";
const AV_PURPLE = "rgb(145, 62, 248)";
const AV_PINK = "rgb(192, 23, 180)";
const UP = "#26A69A";
const DOWN = "#EF5350";
const hue = (m: number) => (m < 2 ? AV_BLUE : m < 10 ? AV_PURPLE : AV_PINK);
const TZ_SHIFT = -new Date().getTimezoneOffset() * 60; // show local clock on the UTC time axis
const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

function ema(values: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const out: (number | null)[] = [];
  let prev: number | null = null;
  values.forEach((v, i) => {
    if (i < period - 1) {
      out.push(null);
      return;
    }
    if (prev === null) prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    else prev = v * k + prev * (1 - k);
    out.push(prev);
  });
  return out;
}

function bollinger(values: number[], period = 20, mult = 2) {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    const w = values.slice(i - period + 1, i + 1);
    const m = w.reduce((a, b) => a + b, 0) / period;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / period);
    return { mid: m, up: m + mult * sd, lo: Math.max(1e-6, m - mult * sd) };
  });
}

function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = [null];
  let g = 0;
  let l = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const up = Math.max(0, d);
    const dn = Math.max(0, -d);
    if (i <= period) {
      g += up / period;
      l += dn / period;
      out.push(i === period ? 100 - 100 / (1 + g / (l || 1e-9)) : null);
    } else {
      g = (g * (period - 1) + up) / period;
      l = (l * (period - 1) + dn) / period;
      out.push(100 - 100 / (1 + g / (l || 1e-9)));
    }
  }
  return out;
}

function heikin(c: TvCandle[]): TvCandle[] {
  const out: TvCandle[] = [];
  c.forEach((k, i) => {
    const close = (k.o + k.h + k.l + k.c) / 4;
    const open = i === 0 ? (k.o + k.c) / 2 : (out[i - 1].o + out[i - 1].c) / 2;
    out.push({ t: k.t, o: open, c: close, h: Math.max(k.h, open, close), l: Math.min(k.l, open, close), n: k.n });
  });
  return out;
}

/** Deduplicate + sort (lightweight-charts requires strictly ascending time). */
function clean(c: TvCandle[]): TvCandle[] {
  const m = new Map<number, TvCandle>();
  for (const k of c) if (Number.isFinite(k.t) && k.h > 0) m.set(Math.floor(k.t), { ...k, t: Math.floor(k.t) });
  return [...m.values()].sort((a, b) => a.t - b.t);
}

function ToolBtn({ active, title, onClick, children }: { active?: boolean; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded px-1.5 text-[11px] transition-colors",
        active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export interface TvChartProps {
  candles: TvCandle[];
  height?: number;
  /** localStorage namespace for drawings + preferences */
  storageKey?: string;
  projection?: TvProjectionPoint[];
  projectionLabel?: string;
  defaultKind?: ChartKind;
  defaultIndicators?: Indicator[];
  defaultLog?: boolean;
  compact?: boolean;
}

export function TvChart({
  candles,
  height = 380,
  storageKey = "default",
  projection,
  projectionLabel = "Projection",
  defaultKind = "candles",
  defaultIndicators = ["ema20", "volume"],
  defaultLog = true,
  compact = false,
}: TvChartProps) {
  const prefKey = `momento.tv.${storageKey}`;
  const pref = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(prefKey) ?? "{}") as { kind?: ChartKind; ind?: Indicator[]; log?: boolean; hueMode?: boolean };
    } catch {
      return {};
    }
  }, [prefKey]);

  const [kind, setKind] = useState<ChartKind>(pref.kind ?? defaultKind);
  const [ind, setInd] = useState<Indicator[]>(pref.ind ?? defaultIndicators);
  const [log, setLog] = useState<boolean>(pref.log ?? defaultLog);
  const [hueMode, setHueMode] = useState<boolean>(pref.hueMode ?? false);
  const [tool, setTool] = useState<Tool>("none");
  const [drawings, setDrawings] = useState<Drawing[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(`${prefKey}.drawings`) ?? "[]") as Drawing[];
    } catch {
      return [];
    }
  });
  const [legend, setLegend] = useState<TvCandle | null>(null);
  const [draft, setDraft] = useState<Drawing | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const redrawRef = useRef<() => void>(() => undefined);

  const data = useMemo(() => clean(candles), [candles]);
  const shown = useMemo(() => (kind === "heikin" ? heikin(data) : data), [data, kind]);
  const byTime = useMemo(() => new Map(data.map((c) => [c.t + TZ_SHIFT, c])), [data]);

  useEffect(() => {
    localStorage.setItem(prefKey, JSON.stringify({ kind, ind, log, hueMode }));
  }, [prefKey, kind, ind, log, hueMode]);
  useEffect(() => {
    localStorage.setItem(`${prefKey}.drawings`, JSON.stringify(drawings));
    redrawRef.current();
  }, [prefKey, drawings]);

  // ---------------------------------------------------------------- build
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = createChart(host, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8A94A6", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: "rgba(42,48,60,0.35)" }, horzLines: { color: "rgba(42,48,60,0.35)" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(42,48,60,0.8)", mode: log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal, scaleMargins: { top: 0.08, bottom: ind.includes("volume") ? 0.22 : 0.06 } },
      timeScale: { borderColor: "rgba(42,48,60,0.8)", timeVisible: true, secondsVisible: false, rightOffset: projection?.length ? 4 : 2 },
      handleScroll: tool === "none",
      handleScale: tool === "none",
    });
    chartRef.current = chart;
    const T = (t: number) => (t + TZ_SHIFT) as UTCTimestamp;

    let main: ISeriesApi<SeriesType>;
    if (kind === "line" || kind === "area") {
      const s = kind === "line"
        ? chart.addSeries(LineSeries, { color: AV_PURPLE, lineWidth: 2, priceLineVisible: true })
        : chart.addSeries(AreaSeries, { lineColor: AV_PURPLE, topColor: "rgba(145,62,248,0.35)", bottomColor: "rgba(145,62,248,0.02)", lineWidth: 2 });
      s.setData(shown.map((c) => ({ time: T(c.t), value: c.c })));
      main = s as ISeriesApi<SeriesType>;
    } else {
      const def = kind === "bars" ? BarSeries : CandlestickSeries;
      const s = chart.addSeries(def as typeof CandlestickSeries, {
        upColor: UP,
        downColor: DOWN,
        borderVisible: false,
        wickUpColor: UP,
        wickDownColor: DOWN,
      });
      s.setData(
        shown.map((c) => {
          const col = hueMode ? hue(c.c) : c.c >= c.o ? UP : DOWN;
          return { time: T(c.t), open: c.o, high: c.h, low: c.l, close: c.c, color: col, wickColor: col, borderColor: col };
        }),
      );
      main = s as ISeriesApi<SeriesType>;
    }
    mainRef.current = main;

    const closes = shown.map((c) => c.c);
    const addLine = (vals: (number | null)[], color: string, width = 1, dashed = false) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: width as 1, lineStyle: dashed ? 2 : 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(vals.map((v, i) => (v === null ? { time: T(shown[i].t) } : { time: T(shown[i].t), value: v })));
    };
    if (ind.includes("ema20")) addLine(ema(closes, 20), "#F5B342", 1);
    if (ind.includes("ema50")) addLine(ema(closes, 50), "#4FC3F7", 1);
    if (ind.includes("bb")) {
      const bb = bollinger(closes);
      addLine(bb.map((b) => b?.up ?? null), "rgba(192,23,180,0.7)", 1, true);
      addLine(bb.map((b) => b?.mid ?? null), "rgba(192,23,180,0.4)", 1);
      addLine(bb.map((b) => b?.lo ?? null), "rgba(192,23,180,0.7)", 1, true);
    }
    if (ind.includes("volume")) {
      const v = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      v.setData(shown.map((c) => ({ time: T(c.t), value: c.n ?? 0, color: c.c >= c.o ? "rgba(38,166,154,0.45)" : "rgba(239,83,80,0.45)" })));
    }
    if (ind.includes("rsi")) {
      const r = chart.addSeries(LineSeries, { color: "#B39DDB", lineWidth: 1, priceLineVisible: false, lastValueVisible: true }, 1);
      const rv = rsi(closes);
      r.setData(rv.map((v, i) => (v === null ? { time: T(shown[i].t) } : { time: T(shown[i].t), value: v })));
      r.createPriceLine({ price: 70, color: "rgba(239,83,80,0.5)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
      r.createPriceLine({ price: 30, color: "rgba(38,166,154,0.5)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
      const panes = chart.panes();
      if (panes[1]) panes[1].setStretchFactor(0.28);
    }

    // forecast overlay: p50 path + p25/p75 fan (distinct colour, dashed)
    if (projection && projection.length && shown.length) {
      const last = shown[shown.length - 1];
      const pts = projection.filter((p) => p.t > last.t).sort((a, b) => a.t - b.t);
      const uniq = pts.filter((p, i) => i === 0 || Math.floor(p.t) > Math.floor(pts[i - 1].t));
      if (uniq.length) {
        const mk = (key: "p25" | "p50" | "p75") => [{ time: T(last.t), value: last.c }, ...uniq.map((p) => ({ time: T(Math.floor(p.t)), value: p[key] }))];
        const p50 = chart.addSeries(LineSeries, { color: "#FFD54F", lineWidth: 2, lineStyle: 2, priceLineVisible: false, lastValueVisible: true, title: projectionLabel });
        p50.setData(mk("p50"));
        for (const key of ["p25", "p75"] as const) {
          const s = chart.addSeries(LineSeries, { color: "rgba(255,213,79,0.45)", lineWidth: 1, lineStyle: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
          s.setData(mk(key));
        }
      }
    }

    chart.timeScale().fitContent();

    chart.subscribeCrosshairMove((p) => {
      if (!p.time) {
        setLegend(null);
        return;
      }
      setLegend(byTime.get(p.time as number) ?? null);
    });

    // ------------------------------------------------------------ drawings
    const redraw = () => {
      const cv = canvasRef.current;
      const s = mainRef.current;
      if (!cv || !s || !host) return;
      const dpr = window.devicePixelRatio || 1;
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (cv.width !== w * dpr || cv.height !== h * dpr) {
        cv.width = w * dpr;
        cv.height = h * dpr;
        cv.style.width = `${w}px`;
        cv.style.height = `${h}px`;
      }
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const toXY = (a: Anchor) => {
        const x = chart.timeScale().timeToCoordinate(a.time as Time) ?? chart.timeScale().logicalToCoordinate(nearestLogical(a.time));
        const y = s.priceToCoordinate(a.price);
        return x === null || y === null ? null : { x, y };
      };
      const all = draftRef.current ? [...drawingsRef.current, draftRef.current] : drawingsRef.current;
      for (const d of all) {
        const A = toXY(d.a);
        const B = toXY(d.b);
        if (!A || !B) continue;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = d.type === "fib" ? "#FFD54F" : d.type === "rect" ? AV_PURPLE : AV_BLUE;
        ctx.fillStyle = "rgba(145,62,248,0.10)";
        ctx.font = "10px ui-monospace, monospace";
        if (d.type === "trend") {
          ctx.beginPath();
          ctx.moveTo(A.x, A.y);
          ctx.lineTo(B.x, B.y);
          ctx.stroke();
        } else if (d.type === "hline") {
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(0, A.y);
          ctx.lineTo(w, A.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = AV_BLUE;
          ctx.fillText(`${d.a.price.toFixed(2)}×`, 6, A.y - 3);
        } else if (d.type === "rect") {
          ctx.fillRect(Math.min(A.x, B.x), Math.min(A.y, B.y), Math.abs(B.x - A.x), Math.abs(B.y - A.y));
          ctx.strokeRect(Math.min(A.x, B.x), Math.min(A.y, B.y), Math.abs(B.x - A.x), Math.abs(B.y - A.y));
        } else if (d.type === "fib") {
          const x0 = Math.min(A.x, B.x);
          const x1 = Math.max(A.x, B.x, x0 + 40);
          for (const f of FIB) {
            const price = d.b.price + (d.a.price - d.b.price) * f;
            const y = s.priceToCoordinate(price);
            if (y === null) continue;
            ctx.globalAlpha = f === 0 || f === 1 ? 0.9 : 0.6;
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.lineTo(x1, y);
            ctx.stroke();
            ctx.fillStyle = "#FFD54F";
            ctx.fillText(`${(f * 100).toFixed(1)}%  ${price.toFixed(2)}×`, x1 + 4, y + 3);
          }
          ctx.globalAlpha = 1;
        }
      }
    };
    const nearestLogical = (time: number) => {
      const target = time;
      let lo = 0;
      let hi = shown.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (shown[mid].t + TZ_SHIFT < target) lo = mid + 1;
        else hi = mid;
      }
      return lo as unknown as import("lightweight-charts").Logical;
    };
    redrawRef.current = redraw;
    chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    const ro = new ResizeObserver(() => redraw());
    ro.observe(host);
    requestAnimationFrame(redraw);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, kind, ind, log, hueMode, projection, projectionLabel, tool === "none"]);

  const drawingsRef = useRef(drawings);
  drawingsRef.current = drawings;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => redrawRef.current(), [draft]);

  // --------------------------------------------------------- pointer → anchor
  const anchorAt = useCallback((e: React.PointerEvent) => {
    const chart = chartRef.current;
    const s = mainRef.current;
    const host = hostRef.current;
    if (!chart || !s || !host) return null;
    const r = host.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const price = s.coordinateToPrice(y);
    let time = chart.timeScale().coordinateToTime(x) as number | null;
    if (time === null) {
      const lg = chart.timeScale().coordinateToLogical(x);
      if (lg !== null && shown.length) {
        const last = shown[shown.length - 1].t + TZ_SHIFT;
        const step = shown.length > 1 ? shown[1].t - shown[0].t : 60;
        time = last + (lg - (shown.length - 1)) * step;
      }
    }
    if (price === null || time === null) return null;
    return { time, price: Math.max(1e-6, price) };
  }, [shown]);

  const onDown = (e: React.PointerEvent) => {
    if (tool === "none") return;
    const a = anchorAt(e);
    if (!a) return;
    if (tool === "erase") {
      // remove the drawing whose first anchor is nearest in price
      if (!drawings.length) return;
      let best = 0;
      let bd = Infinity;
      drawings.forEach((d, i) => {
        const dist = Math.abs(Math.log(d.a.price / a.price)) + Math.abs(Math.log(d.b.price / a.price));
        if (dist < bd) {
          bd = dist;
          best = i;
        }
      });
      setDrawings(drawings.filter((_, i) => i !== best));
      return;
    }
    if (tool === "hline") {
      setDrawings([...drawings, { id: crypto.randomUUID(), type: "hline", a, b: a }]);
      return;
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDraft({ id: crypto.randomUUID(), type: tool, a, b: a });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!draft) return;
    const b = anchorAt(e);
    if (b) setDraft({ ...draft, b });
  };
  const onUp = () => {
    if (draft) setDrawings([...drawings, draft]);
    setDraft(null);
  };

  // ----------------------------------------------------------------- actions
  const zoom = (f: number) => {
    const ts = chartRef.current?.timeScale();
    const r = ts?.getVisibleLogicalRange();
    if (!ts || !r) return;
    const mid = (r.from + r.to) / 2;
    const half = ((r.to - r.from) / 2) * f;
    ts.setVisibleLogicalRange({ from: mid - half, to: mid + half });
  };
  const fit = () => chartRef.current?.timeScale().fitContent();
  const reset = () => {
    chartRef.current?.timeScale().resetTimeScale();
    chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
  };
  const fullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };
  const snapshot = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const c = chart.takeScreenshot();
    const out = document.createElement("canvas");
    out.width = c.width;
    out.height = c.height;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#0B0E13";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(c, 0, 0);
    if (canvasRef.current) ctx.drawImage(canvasRef.current, 0, 0, out.width, out.height);
    const a = document.createElement("a");
    a.href = out.toDataURL("image/png");
    a.download = `momento-chart-${storageKey}-${Date.now()}.png`;
    a.click();
  };
  const toggleInd = (i: Indicator) => setInd((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]));

  const L = legend ?? data[data.length - 1] ?? null;

  return (
    <div ref={wrapRef} className="relative flex flex-col rounded-md bg-background/40" data-testid="tv-chart">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border/60 px-1 py-1">
        <ToolBtn title="Candlesticks" active={kind === "candles"} onClick={() => setKind("candles")}><CandlestickChart className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="Heikin-Ashi" active={kind === "heikin"} onClick={() => setKind("heikin")}><span className="font-semibold">HA</span></ToolBtn>
        <ToolBtn title="OHLC bars" active={kind === "bars"} onClick={() => setKind("bars")}><BarChart3 className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="Line" active={kind === "line"} onClick={() => setKind("line")}><LineIcon className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="Area" active={kind === "area"} onClick={() => setKind("area")}><AreaIcon className="h-3.5 w-3.5" /></ToolBtn>
        <span className="mx-1 h-4 w-px bg-border" />
        <ToolBtn title="Log scale" active={log} onClick={() => setLog(!log)}><span className="font-semibold">LOG</span></ToolBtn>
        <ToolBtn title="Aviator hue colouring (blue <2×, purple 2–10×, pink ≥10×)" active={hueMode} onClick={() => setHueMode(!hueMode)}><Layers className="h-3.5 w-3.5" /></ToolBtn>
        {!compact && (
          <>
            <span className="mx-1 h-4 w-px bg-border" />
            {(["ema20", "ema50", "bb", "volume", "rsi"] as Indicator[]).map((i) => (
              <ToolBtn key={i} title={`Toggle ${i.toUpperCase()}`} active={ind.includes(i)} onClick={() => toggleInd(i)}>
                <span className="font-mono">{i === "ema20" ? "EMA20" : i === "ema50" ? "EMA50" : i === "bb" ? "BB" : i === "volume" ? "VOL" : "RSI"}</span>
              </ToolBtn>
            ))}
          </>
        )}
        <span className="mx-1 h-4 w-px bg-border" />
        <ToolBtn title="Pan / zoom (no drawing)" active={tool === "none"} onClick={() => setTool("none")}><MousePointer2 className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="Trend line" active={tool === "trend"} onClick={() => setTool("trend")}><Slash className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="Horizontal level" active={tool === "hline"} onClick={() => setTool("hline")}><Minus className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="Rectangle zone" active={tool === "rect"} onClick={() => setTool("rect")}><RectangleHorizontal className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="Fibonacci retracement" active={tool === "fib"} onClick={() => setTool("fib")}><TrendingUp className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="Erase nearest drawing" active={tool === "erase"} onClick={() => setTool("erase")}><Eraser className="h-3.5 w-3.5" /></ToolBtn>
        {drawings.length > 0 && (
          <ToolBtn title="Clear all drawings" onClick={() => setDrawings([])}><span>clear {drawings.length}</span></ToolBtn>
        )}
        <span className="ml-auto" />
        <ToolBtn title="Zoom in" onClick={() => zoom(0.7)}><ZoomIn className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="Zoom out" onClick={() => zoom(1.4)}><ZoomOut className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="Fit all" onClick={fit}><span className="font-semibold">FIT</span></ToolBtn>
        <ToolBtn title="Reset view" onClick={reset}><RotateCcw className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="Snapshot PNG" onClick={snapshot}><Camera className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn title="Fullscreen" onClick={fullscreen}><Maximize2 className="h-3.5 w-3.5" /></ToolBtn>
      </div>

      <div className="relative" style={{ height: `var(--tv-h, ${height}px)` }}>
        {L && (
          <div className="pointer-events-none absolute left-2 top-1 z-10 flex flex-wrap gap-x-3 font-mono text-[10.5px] text-muted-foreground">
            <span>{new Date(L.t * 1000).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
            <span>O <b style={{ color: hue(L.o) }}>{L.o.toFixed(2)}</b></span>
            <span>H <b style={{ color: hue(L.h) }}>{L.h.toFixed(2)}</b></span>
            <span>L <b style={{ color: hue(L.l) }}>{L.l.toFixed(2)}</b></span>
            <span>C <b style={{ color: hue(L.c) }}>{L.c.toFixed(2)}</b></span>
            {L.n !== undefined && <span>n {L.n}</span>}
            {projection?.length ? <span className="text-[#FFD54F]">- - {projectionLabel} (p50 · p25–p75 fan)</span> : null}
          </div>
        )}
        {data.length === 0 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-xs text-muted-foreground">No candles in this window.</div>
        )}
        <div ref={hostRef} className="absolute inset-0" />
        <canvas
          ref={canvasRef}
          className={cn("absolute inset-0 z-[5]", tool === "none" ? "pointer-events-none" : "cursor-crosshair")}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        />
      </div>
      <style>{`[data-testid="tv-chart"]:fullscreen{background:#0B0E13;--tv-h:calc(100vh - 44px)}`}</style>
    </div>
  );
}

export default TvChart;
