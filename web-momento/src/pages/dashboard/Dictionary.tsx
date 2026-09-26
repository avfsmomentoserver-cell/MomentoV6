// F-06 Living Dictionary: every vocabulary token validated on a discovery block and a held-out block
import { useState } from "react";
import { Loading, PageHeader, Panel } from "@/components/bits";
import { DataTable, Note, Verdict, ci, inputCls, pct, useV1 } from "@/components/v65/kit";

type Row = { id: number; token: string; layer: string; status: string; definition: string; blockA: { n: number; rate: number; p: number }; blockB: { n: number; rate: number; lo: number; hi: number; p: number; lift: number; liftLo: number; liftHi: number }; qA: number; qB: number };
type Dict = { base: { blockA: number; blockB: number }; split: number; rows: Row[]; formalisable: string[]; precision: number | null; rule: string };
type Page = { token: Record<string, unknown>; examples: { ts: string; next: number }[]; occurrences: number; history: Record<string, unknown>[] };

export default function Dictionary() {
  const d = useV1<Dict>("dictionary");
  const [filter, setFilter] = useState("");
  const [sel, setSel] = useState<number | null>(null);
  const page = useV1<Page>(`vocabulary/${sel}/page`, { enabled: sel !== null });
  const rows = (d.data?.rows ?? []).filter((r) => !filter || r.token.includes(filter) || r.layer.includes(filter));
  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="Living Dictionary" subtitle="Platform Book F-06. Each word and phrase is tested on the first 60% of the tape (discovery) and re-tested on the last 40% (held out). A token is only 'formalised' when the held-out block agrees after Benjamini–Hochberg correction." actions={<input className={inputCls} placeholder="filter tokens" value={filter} onChange={(e) => setFilter(e.target.value)} />} />
      {d.isLoading ? <Loading rows={6} /> : d.data && (
        <>
          <Note>{d.data.rule} Base P(≥2×): discovery {pct(d.data.base.blockA)} · held out {pct(d.data.base.blockB)}. Formalisable now: {d.data.formalisable.length ? d.data.formalisable.join(", ") : "none — no token survives the held-out test"}.</Note>
          <div className="grid gap-4 xl:grid-cols-3">
            <Panel title={`${rows.length} tokens`} className="xl:col-span-2">
              <DataTable rows={rows as unknown as Record<string, unknown>[]} max={620} cols={[
                { key: "token", label: "token", render: (r) => <button type="button" className="text-primary underline" onClick={() => setSel(r.id as number)}>{String(r.token)}</button> },
                { key: "layer", label: "layer" }, { key: "status", label: "status" },
                { key: "a", label: "discovery", render: (r) => { const a = r.blockA as Row["blockA"]; return `${pct(a.rate)} n${a.n}`; } },
                { key: "qA", label: "q A" },
                { key: "b", label: "held out", render: (r) => { const b = r.blockB as Row["blockB"]; return `${pct(b.rate)} n${b.n}`; } },
                { key: "lift", label: "lift B", render: (r) => { const b = r.blockB as Row["blockB"]; return `${b.lift} ${ci(b.liftLo, b.liftHi, 2)}`; } },
                { key: "qB", label: "q B", render: (r) => <Verdict ok={(r.qB as number) < 0.05 ? true : null}>{String(r.qB)}</Verdict> },
              ]} />
            </Panel>
            <Panel title={sel ? `Token page #${sel}` : "Token page"}>
              {!sel ? <p className="text-[12.5px] text-muted-foreground">Pick a token to see its definition, recent occurrences and history.</p> : page.isLoading ? <Loading /> : page.data && (
                <div className="space-y-2 text-[12.5px]">
                  <p className="text-[16px] font-semibold">{String(page.data.token.token)}</p>
                  <p>{String(page.data.token.definition ?? "")}</p>
                  <p className="text-muted-foreground">{page.data.occurrences} occurrences · status {String(page.data.token.status)}</p>
                  <DataTable rows={page.data.examples as unknown as Record<string, unknown>[]} max={300} cols={[{ key: "ts", label: "when", render: (r) => new Date(String(r.ts)).toLocaleString() }, { key: "next", label: "next round ×" }]} />
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
