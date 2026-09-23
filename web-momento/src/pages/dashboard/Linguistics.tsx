import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtMult, timeAgo } from "@/lib/format";
import type { LinguisticRound } from "@/lib/types";
import { Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";

interface LinguisticsResponse {
  recent: LinguisticRound[];
  tokens: { token: string; layers: string[]; count: number }[];
  layers: string[];
}

export default function Linguistics() {
  const ling = useQuery({
    queryKey: ["linguistics"],
    queryFn: () => api.get<LinguisticsResponse>("/api/v1/linguistics?depth=200"),
    refetchInterval: 12_000,
  });

  if (ling.isLoading) return <Loading rows={5} />;
  const l = ling.data;
  if (!l) return null;

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="MomentoLinguistics"
        subtitle="Eight-layer semantic vocabulary over the live series. Every round becomes a token composed of measurable layers: band · chroma · streak · transition · momentum · pressure · shape."
      />
      <MetricGrid>
        <StatTile label="Layers" value={l.layers.length} sub={l.layers.join(" · ")} />
        <StatTile label="Recent tokens" value={l.recent.length} sub="depth 200 rounds" />
        <StatTile label="Unique tokens" value={l.tokens.length} sub="in window" tone="signal" />
        <StatTile label="Dominant token" value={l.tokens[0]?.token ?? "—"} sub={`n=${l.tokens[0]?.count ?? 0}`} />
      </MetricGrid>

      <Panel title="Token frequency">
        <div className="space-y-1.5">
          {l.tokens.slice(0, 12).map((t) => (
            <div key={t.token} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <span className="font-data text-[12.5px]">{t.token}</span>
              <span className="text-[12px] text-muted-foreground">×{t.count}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Live token stream">
        <div className="space-y-1">
          {l.recent.slice(-30).reverse().map((r, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-border/40 py-1.5 text-[12.5px] last:border-0">
              <span className="font-data w-14 text-right" style={{ color: r.multiplier >= 10 ? "#F59E0B" : r.multiplier >= 2 ? "#8B5CF6" : "#3B82F6" }}>{fmtMult(r.multiplier)}</span>
              <span className="font-data text-muted-foreground">{r.token}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">{timeAgo(r.ts)}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
