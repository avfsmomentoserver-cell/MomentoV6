import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Bands } from "@/lib/types";
import { Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";
import { CatBars } from "@/components/charts";

const BAND_LABELS = ["<1.5×", "1.5–2×", "2–5×", "5–10×", "10–100×", "100×+"];

export default function PatternDna() {
  const bands = useQuery({
    queryKey: ["bands"],
    queryFn: () => api.get<Bands>("/api/v1/bands?source=all"),
    refetchInterval: 20_000,
  });

  if (bands.isLoading) return <Loading rows={5} />;
  const b = bands.data;
  if (!b) return null;

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Pattern DNA Tracker"
        subtitle="Six-band Markov structure of the merged series. The chi-square test says bands are NOT independent — the structure is real, the edge it offers is not."
      />
      <MetricGrid>
        <StatTile label="Chi-square" value={b.chiSquare.toFixed(1)} sub={`25 dof · ${b.independent ? "independent" : "NOT independent (p < 0.001)"}`} tone={b.independent ? "default" : "signal"} />
        <StatTile label="Dominant band" value={BAND_LABELS[b.counts.indexOf(Math.max(...b.counts))]} sub={`${((Math.max(...b.counts) / b.counts.reduce((a, c) => a + c, 0)) * 100).toFixed(1)}% of rounds`} />
        <StatTile label="100×+ share" value={`${(b.shares[5] * 100).toFixed(3)}%`} sub="all-time" />
        <StatTile label="Bands" value={BAND_LABELS.length} sub="edges 1.5 / 2 / 5 / 10 / 100" />
      </MetricGrid>

      <Panel title="Band distribution">
        <CatBars data={BAND_LABELS.map((name, i) => ({ name, value: b.counts[i] }))} />
      </Panel>

      <Panel title="Band transition matrix (row → column)">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] font-data text-[12px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className="pb-2 text-left font-medium">from \ to</th>
                {BAND_LABELS.map((l) => (
                  <th key={l} className="pb-2 text-right font-medium">{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.transition.map((row, i) => (
                <tr key={i} className="border-t border-border/50">
                  <td className="py-1.5 pr-3 text-muted-foreground">{BAND_LABELS[i]}</td>
                  {row.map((v, j) => (
                    <td key={j} className={`py-1.5 text-right ${v > 0.3 ? "text-primary" : v > 0.1 ? "text-foreground/90" : "text-muted-foreground"}`}>
                      {(v * 100).toFixed(1)}%
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
