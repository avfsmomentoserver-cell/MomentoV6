// F-01 Tape Integrity · F-02 multi-collector consensus · F-05 federated view
import { Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";
import { DataTable, Note, Verdict, pct, useV1 } from "@/components/v65/kit";

type Session = { sessionId: number; source: string; from: string; to: string; rounds: number; observed: number; reconstructed: number; estMissing: number; completeness: number; lowShare: number; lowShareZ: number; integrity: number; voidWindows: number; fairMatch: number | null; agreement: number | null };
type Integrity = { summary: Record<string, number | string>; sessions: Session[] };
type Collectors = { sources: { source: string; collectors: { method: string; rounds: number; lastTs: string; lagSeconds: number }[]; multiCollector: boolean; pairs: number; agreement: number | null; disagreements: number; note: string }[] };
type Fed = { mode: string; sources: { source: string; rounds: number; last: string }[]; fanOutMs: number; note: string };

export default function IntegrityPage() {
  const q = useV1<Integrity>("integrity", { refetch: 60_000 });
  const s = useV1<Record<string, number | string>>("integrity/summary", { refetch: 60_000 });
  const c = useV1<Collectors>("collectors");
  const f = useV1<Fed>("federation");
  if (q.isLoading) return <Loading rows={6} />;
  const sum = s.data ?? q.data?.summary ?? {};
  const n = (k: string) => Number(sum[k] ?? 0);
  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="Tape Integrity" subtitle="Platform Book F-01. Every session gets a completeness and plausibility score; forecasts whose resolving round sits in a gap or a reconstructed stretch are voided, never scored." />
      <MetricGrid>
        <StatTile label="Integrity" value={pct(n("integrity"))} sub={`${n("sessions")} sessions · ${n("highQuality")} high quality`} tone={n("integrity") > 0.95 ? "good" : "warn"} pulse />
        <StatTile label="Completeness" value={pct(n("completeness"))} sub={`${n("observed").toLocaleString()} observed · ~${n("estMissing").toLocaleString()} missing`} />
        <StatTile label="< 1.2× share" value={pct(n("tapeLowShare"), 2)} sub={`law ${pct(n("lawLowShare"), 2)}`} tone="signal" />
        <StatTile label="Void windows" value={n("voidWindows").toLocaleString()} sub={`ledger: ${n("ledgerVoided")} voided / ${n("ledgerResolved")} resolved · ${n("quarantined")} quarantined`} />
      </MetricGrid>
      {sum.note && <Note>{String(sum.note)}</Note>}
      <Panel title="Sessions">
        <DataTable rows={(q.data?.sessions ?? []) as unknown as Record<string, unknown>[]} cols={[
          { key: "sessionId", label: "session" },
          { key: "source", label: "source" },
          { key: "from", label: "from", render: (r) => String(r.from).slice(0, 16).replace("T", " ") },
          { key: "rounds", label: "rounds" },
          { key: "reconstructed", label: "recon" },
          { key: "estMissing", label: "missing" },
          { key: "completeness", label: "complete", render: (r) => pct(r.completeness as number) },
          { key: "lowShareZ", label: "<1.2× z" },
          { key: "integrity", label: "score", render: (r) => <Verdict ok={(r.integrity as number) >= 0.95}>{pct(r.integrity as number)}</Verdict> },
          { key: "voidWindows", label: "voids" },
        ]} />
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Collectors (F-02 consensus)">
          {c.data?.sources.map((src) => (
            <div key={src.source} className="border-b border-border/50 py-2 text-[12.5px] last:border-0">
              <div className="flex items-center justify-between"><span className="font-data">{src.source}</span><Verdict ok={src.multiCollector ? (src.agreement ?? 0) > 0.98 : null}>{src.multiCollector ? `${src.pairs} pairs · ${src.disagreements} disagree` : "single collector"}</Verdict></div>
              <p className="mt-1 text-[11.5px] text-muted-foreground">{src.collectors.map((k) => `${k.method}: ${k.rounds.toLocaleString()}`).join(" · ")}</p>
            </div>
          )) ?? <Loading />}
        </Panel>
        <Panel title="Federated view (F-05)">
          {f.data ? (
            <>
              <p className="mb-2 text-[12px] text-muted-foreground">Mode: <span className="font-data text-foreground">{f.data.mode}</span> · fan-out {f.data.fanOutMs} ms</p>
              <DataTable rows={f.data.sources as unknown as Record<string, unknown>[]} cols={[{ key: "source", label: "source" }, { key: "rounds", label: "rounds" }, { key: "last", label: "last", render: (r) => String(r.last).slice(0, 19).replace("T", " ") }]} />
              <p className="mt-2 text-[11.5px] text-muted-foreground">{f.data.note}</p>
            </>
          ) : <Loading />}
        </Panel>
      </div>
    </div>
  );
}
