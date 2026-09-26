// F-23 multi-source terminal: 2–4 synced charts
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { TvChart } from "@/components/tv/TvChart";
import { PageHeader, Panel } from "@/components/bits";
import { inputCls, useAsOf } from "@/components/v65/kit";

type Candle = { t: number; o: number; h: number; l: number; c: number; n?: number };

function Pane({ source, tf, idx }: { source: string; tf: string; idx: number }) {
  const asOf = useAsOf();
  const q = useQuery({ queryKey: ["multi", source, tf, asOf], queryFn: () => api.get<{ candles: Candle[] }>(`/api/v1/market/candles${qs({ tf, source: source === "all" ? null : source, limit: 150 })}`), refetchInterval: asOf ? false : 15_000 });
  return (
    <Panel title={`${source} · ${Number(tf) / 60}m`}>
      {q.data?.candles.length ? <TvChart candles={q.data.candles} height={260} storageKey={`multi-${idx}`} compact /> : <p className="py-16 text-center text-[12px] text-muted-foreground">{q.isLoading ? "Loading…" : "No rounds for this source."}</p>}
    </Panel>
  );
}

export default function Multi() {
  const srcs = useQuery({ queryKey: ["sources"], queryFn: () => api.get<{ sources: { name: string; rounds: number }[] }>("/api/v1/sources") });
  const names = ["all", ...(srcs.data?.sources ?? []).filter((s) => s.rounds > 0).map((s) => s.name)];
  const [count, setCount] = useState(4);
  const [tf, setTf] = useState("300");
  const [picks, setPicks] = useState<string[]>(["all", "avfs", "momento_prev", "momento_project"]);
  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="Multi-source terminal" subtitle="Platform Book F-23. Two to four sources side by side on the same timeframe. Use the Sequence page's comparator to test whether any difference is real." actions={<><select className={inputCls} value={count} onChange={(e) => setCount(Number(e.target.value))}>{[2, 3, 4].map((n) => <option key={n} value={n}>{n} panes</option>)}</select><select className={inputCls} value={tf} onChange={(e) => setTf(e.target.value)}>{[["60", "1m"], ["300", "5m"], ["900", "15m"], ["3600", "1h"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></>} />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: count }).map((_, i) => <select key={i} className={inputCls} value={picks[i] ?? "all"} onChange={(e) => { const p = [...picks]; p[i] = e.target.value; setPicks(p); }}>{names.map((n) => <option key={n}>{n}</option>)}</select>)}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">{Array.from({ length: count }).map((_, i) => <Pane key={i + (picks[i] ?? "")} idx={i} source={picks[i] ?? "all"} tf={tf} />)}</div>
    </div>
  );
}
