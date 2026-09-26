import { memo } from "react";
import { TvChart, type TvProjectionPoint } from "@/components/tv/TvChart";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { multColor } from "@/lib/format";

const AXIS = { stroke: "#5B6472", fontSize: 10, fontFamily: "JetBrains Mono, monospace" } as const;
const TOOLTIP_STYLE = {
  backgroundColor: "#161B22",
  border: "1px solid #232A33",
  borderRadius: 8,
  fontSize: 12,
  fontFamily: "JetBrains Mono, monospace",
} as const;

export const SparkArea = memo(function SparkArea({ data, height = 56, color = "#06B6D4" }: { data: { x: string | number; y: number }[]; height?: number; color?: string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`sg-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="y" stroke={color} strokeWidth={1.5} fill={`url(#sg-${color.replace("#", "")})`} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
});

export const TrendLine = memo(function TrendLine({ data, height = 220, yScale = "linear" }: { data: { x: string | number; y: number }[]; height?: number; yScale?: "linear" | "log" }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="#1D232B" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="x" tick={AXIS} tickLine={false} axisLine={false} minTickGap={40} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} scale={yScale} domain={yScale === "log" ? ["auto", "auto"] : undefined} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Line type="monotone" dataKey="y" stroke="#06B6D4" strokeWidth={1.6} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
});

export const MultiLine = memo(function MultiLine({ data, series, height = 220, yScale = "linear" }: { data: Record<string, string | number>[]; series: { key: string; color: string }[]; height?: number; yScale?: "linear" | "log" }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="#1D232B" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="x" tick={AXIS} tickLine={false} axisLine={false} minTickGap={40} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} scale={yScale} domain={yScale === "log" ? ["auto", "auto"] : undefined} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={1.6} dot={false} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
});

export const CatBars = memo(function CatBars({ data, height = 200, colorize }: { data: { name: string; value: number }[]; height?: number; colorize?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="#1D232B" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} interval={0} angle={data.length > 8 ? -35 : 0} height={data.length > 8 ? 48 : 24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#ffffff08" }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={colorize ? multColor(Number(d.name.replace(/[^\d.]/g, "")) || 1) : "#06B6D4"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
});

export const PointsChart = memo(function PointsChart({ points, height = 260 }: { points: { t: string; m: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
        <defs>
          <linearGradient id="points-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1D232B" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="t" tick={AXIS} tickLine={false} axisLine={false} minTickGap={60} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} scale="log" domain={["auto", "auto"]} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Area type="linear" dataKey="m" stroke="#8B5CF6" strokeWidth={1.2} fill="url(#points-grad)" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
});

/** OHLC candles — now the TradingView-grade TvChart (type switch, log scale, indicators, drawings, zoom, fullscreen). */
export const Candles = memo(function Candles({ candles, height = 300, storageKey = "candles", projection }: { candles: { t: number; o: number; h: number; l: number; c: number; n?: number }[]; height?: number; storageKey?: string; projection?: TvProjectionPoint[] }) {
  return <TvChart candles={candles} height={height} storageKey={storageKey} projection={projection} />;
});
