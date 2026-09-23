// Formatting helpers for the operator console.

export function fmtMult(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return "—";
  if (m >= 1000) return `${(m / 1000).toFixed(1)}k×`;
  if (m >= 100) return `${m.toFixed(1)}×`;
  return `${m.toFixed(2)}×`;
}

export function fmtPct(p: number | null | undefined, digits = 2): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(digits)}%`;
}

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

export function fmtTime(ts: string | number | null | undefined): string {
  if (!ts) return "—";
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtDateTime(ts: string | number | null | undefined): string {
  if (!ts) return "—";
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(ts: string | number | null | undefined): string {
  if (!ts) return "—";
  const t = typeof ts === "number" ? ts : Date.parse(ts);
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Canonical multiplier color used across charts and feeds. */
export function multColor(m: number): string {
  if (m < 2) return "#3B82F6"; // blue
  if (m < 5) return "#8B5CF6"; // violet
  if (m < 10) return "#A855F7"; // purple
  if (m < 100) return "#F59E0B"; // amber
  return "#F43F5E"; // rose — mega
}
