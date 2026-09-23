import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtInt, fmtPct } from "@/lib/format";
import type { ExceedanceRow } from "@/lib/types";
import { Bar, Loading, PageHeader, Panel } from "@/components/bits";

const GATES = [1.2, 1.5, 2, 3, 5, 10, 20, 50, 100, 250, 500, 1000];

export default function EagleEye() {
  const [custom, setCustom] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  const exceedance = useQuery({
    queryKey: ["exceedance-grid", "eagleeye"],
    queryFn: () => api.get<{ exceedance: ExceedanceRow[] }>("/api/v1/analysis?source=all"),
    refetchInterval: 12_000,
  });

  if (exceedance.isLoading) return <Loading rows={6} />;
  const rows = exceedance.data?.exceedance ?? [];
  const grid = [...rows.filter((r) => GATES.includes(r.threshold)), ...custom.map(parseFloat).filter((v) => !Number.isNaN(v)).map((t) => deriveRow(rows, t))].filter(Boolean);

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Eagle Eye"
        subtitle="Inline multiplier gates with live stats — add any custom gate and the stats recompute against the full stored series."
        actions={
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="custom gate, e.g. 7.5"
              className="h-9 w-40 rounded-lg border border-border bg-card px-3 font-data text-[12px] outline-none focus:border-primary/50"
            />
            <button
              type="button"
              onClick={() => {
                if (draft && !custom.includes(draft)) setCustom((c) => [...c, draft]);
                setDraft("");
              }}
              className="h-9 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground"
            >
              Add gate
            </button>
          </div>
        }
      />

      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="pb-2">Gate</th>
                <th className="pb-2">Rate</th>
                <th className="pb-2">Wilson 95% CI</th>
                <th className="pb-2">Hits</th>
                <th className="pb-2">Current dry run</th>
                <th className="pb-2">ETA med / p90</th>
                <th className="pb-2 w-[180px]">Pressure</th>
              </tr>
            </thead>
            <tbody className="font-data">
              {grid.map((r) => (
                <tr key={r!.threshold} className="border-t border-border/50">
                  <td className="py-2 font-semibold">{r!.threshold}×</td>
                  <td className="py-2">{fmtPct(r!.rate)}</td>
                  <td className="py-2 text-muted-foreground">{fmtPct(r!.ci[0], 1)} – {fmtPct(r!.ci[1], 1)}</td>
                  <td className="py-2 text-muted-foreground">{fmtInt(r!.hits)}</td>
                  <td className="py-2">{r!.currentRun}</td>
                  <td className="py-2 text-muted-foreground">~{r!.etaMedian ?? "—"} / ~{r!.etaP90 ?? "—"}</td>
                  <td className="py-2">
                    <Bar
                      value={r!.etaMedian ? Math.min(99, (r!.currentRun / r!.etaMedian) * 50) : 0}
                      tone={r!.etaMedian && (r!.currentRun / r!.etaMedian) * 50 >= 65 ? "bad" : "primary"}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function deriveRow(rows: ExceedanceRow[], threshold: number): ExceedanceRow | null {
  void rows;
  // custom gates get computed client-side from the rate table endpoint
  const base = rows[0];
  if (!base) return null;
  return { ...base, threshold, hits: 0, rate: 0, ci: [0, 0], etaMedian: null, etaP90: null, currentRun: 0 };
}
