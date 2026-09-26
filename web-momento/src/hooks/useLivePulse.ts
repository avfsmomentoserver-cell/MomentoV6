// Realtime layer: polls the cheap /live/pulse endpoint and, whenever the round
// table changes (new ingest, seed, import, reconstruction), invalidates every
// active query so all stats recompute on top of the deep-tier results.
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface Pulse { maxId: number; count: number; last: { id: number; ts: string; multiplier: number; source: string; origin: string } | null; deepRunMs: number | null; serverTime: number }

export function useLivePulse(intervalMs = 2500) {
  const qc = useQueryClient();
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [online, setOnline] = useState(true);
  const sig = useRef<string>("");
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const p = await api.get<Pulse>("/api/v1/live/pulse");
        if (stop) return;
        setOnline(true);
        setPulse(p);
        const s = `${p.maxId}:${p.count}:${p.deepRunMs ?? 0}`;
        if (sig.current && s !== sig.current) {
          // everything except the pulse itself refreshes
          void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "live-pulse" });
        }
        sig.current = s;
      } catch {
        if (!stop) setOnline(false);
      }
    };
    void tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [qc, intervalMs]);
  return { pulse, online };
}
