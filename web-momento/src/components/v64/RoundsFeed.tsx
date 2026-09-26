// Live rounds feed — scrollable table of the latest 100 rounds, Aviator hues, origin badges.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Radio } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { hueColor } from "@/lib/v64";

interface FeedRound { id: number; ts: string; multiplier: number; source: string; session_id?: number | null; sessionId?: number | null; origin?: string; ingest?: string }

export function RoundsFeed({ className, limit = 100, height = 520 }: { className?: string; limit?: number; height?: number }) {
  const q = useQuery({
    queryKey: ["rounds", "latest", "feed", limit],
    queryFn: () => api.get<{ rounds: FeedRound[] }>(`/api/v1/rounds/latest?limit=${limit}`),
    refetchInterval: 5_000,
  });
  const rows = q.data?.rounds ?? [];
  const pinks = rows.filter((r) => r.multiplier >= 10).length;
  const purples = rows.filter((r) => r.multiplier >= 2 && r.multiplier < 10).length;
  return (
    <section className={cn("flex flex-col overflow-hidden rounded-xl border border-border/70 bg-card/60", className)} aria-label="Rounds feed">
      <header className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Radio className="h-3.5 w-3.5 animate-pulse text-primary" />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em]">Rounds feed</h2>
          <span className="font-data text-[10.5px] text-muted-foreground">last {rows.length}</span>
        </div>
        <div className="flex items-center gap-2 font-data text-[10.5px]">
          <span style={{ color: hueColor(1) }}>{rows.length - pinks - purples}</span>
          <span style={{ color: hueColor(3) }}>{purples}</span>
          <span style={{ color: hueColor(20) }}>{pinks}</span>
          <Link to="/dashboard/eagle-eye" className="text-primary hover:underline">Eagle Eye →</Link>
        </div>
      </header>
      <div className="overflow-y-auto" style={{ maxHeight: height }}>
        <table className="w-full text-[11.5px]">
          <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-1.5 font-medium">#</th>
              <th className="px-2 py-1.5 font-medium">Time</th>
              <th className="px-2 py-1.5 text-right font-medium">Multiplier</th>
              <th className="px-3 py-1.5 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={cn("border-t border-border/40", i === 0 && "bg-primary/5")}>
                <td className="px-3 py-1 font-data text-muted-foreground">{r.id}</td>
                <td className="px-2 py-1 font-data text-muted-foreground">{new Date(r.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                <td className="px-2 py-1 text-right">
                  <span className="inline-block min-w-[62px] rounded-full px-2 py-0.5 text-center font-data font-semibold" style={{ color: hueColor(r.multiplier), background: `${hueColor(r.multiplier).replace("rgb", "rgba").replace(")", ", 0.12)")}` }}>
                    {r.multiplier >= 1000 ? r.multiplier.toLocaleString("en-US", { maximumFractionDigits: 2 }) : r.multiplier.toFixed(2)}x
                  </span>
                </td>
                <td className="px-3 py-1 text-[10.5px] text-muted-foreground">
                  {r.source}
                  {r.origin && r.origin !== "observed" && (
                    <span className={cn("ml-1 rounded px-1 py-px text-[9.5px] uppercase", r.origin === "reconstructed" ? "bg-amber-400/15 text-amber-300" : "bg-sky-400/15 text-sky-300")}>{r.origin}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="py-8 text-center text-[12px] text-muted-foreground">{q.isLoading ? "Loading…" : "No rounds yet."}</p>}
      </div>
    </section>
  );
}
