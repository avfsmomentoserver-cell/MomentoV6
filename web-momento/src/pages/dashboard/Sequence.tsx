// F-07 sequence search (tokens L M H V X Z) · F-10 cross-source comparator
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Loading, PageHeader, Panel } from "@/components/bits";
import { DataTable, Field, Note, Verdict, ci, inputCls, pct, useV1 } from "@/components/v65/kit";

type Search = { pattern: string; k: number; target: number; occurrences: number; scored: number; rate: number; lo: number; hi: number; base: number; p: number; differs: boolean; verdict: string; recent?: { ts: string; next: number[] }[]; error?: string };
type Cmp = { a: string; b: string; nA: number; nB: number; rows: { metric: string; a: number; b: number; diff: number; lo: number; hi: number; p: number; q: number; differs: boolean }[]; gaps10: { medianA: number; medianB: number; z: number; p: number; q: number }; edgeA: number; edgeB: number };

export default function Sequence() {
  const [pat, setPat] = useState("LLL");
  const [k, setK] = useState(1);
  const [T, setT] = useState(2);
  const [go, setGo] = useState({ pat: "LLL", k: 1, T: 2 });
  const s = useV1<Search>(`sequence/search?pattern=${go.pat}&k=${go.k}&T=${go.T}`);
  const srcs = useQuery({ queryKey: ["sources"], queryFn: () => api.get<{ sources: { name: string; rounds: number }[] }>("/api/v1/sources") });
  const names = (srcs.data?.sources ?? []).filter((x) => x.rounds > 0).map((x) => x.name);
  const [A, setA] = useState("avfs");
  const [B, setB] = useState("momento_prev");
  const c = useV1<Cmp>(`compare?a=${A}&b=${B}`, { enabled: !!A && !!B && A !== B });
  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="Sequence Search & Comparator" subtitle="Platform Book F-07/F-10. Search the tape for any band sequence and see what followed — with a Wilson interval against the base rate. Compare two sources metric by metric with BH-corrected tests." />
      <Panel title="Sequence search">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Pattern (L <1.5 · M 1.5–2 · H 2–5 · V 5–10 · X 10–100 · Z 100+)"><input className={`${inputCls} w-64 uppercase`} value={pat} onChange={(e) => setPat(e.target.value.toUpperCase().replace(/[^LMHVXZ]/g, ""))} /></Field>
          <Field label="Next k rounds"><input className={`${inputCls} w-24`} type="number" min={1} max={50} value={k} onChange={(e) => setK(Number(e.target.value))} /></Field>
          <Field label="Hit ≥ T×"><input className={`${inputCls} w-24`} type="number" min={1.01} step={0.5} value={T} onChange={(e) => setT(Number(e.target.value))} /></Field>
          <button type="button" className="inline-flex h-9 items-center rounded-md bg-primary px-3.5 text-[13px] font-medium text-primary-foreground" onClick={() => setGo({ pat, k, T })}>Search</button>
        </div>
        {s.isLoading ? <Loading /> : s.data && (s.data.error ? <Note>{s.data.error}</Note> : (
          <div className="mt-3 space-y-2 text-[13px]">
            <p><b className="font-data">{s.data.pattern}</b> occurred {s.data.occurrences.toLocaleString()} times. In the next {s.data.k} round(s), ≥{s.data.target}× happened {pct(s.data.rate)} {ci(s.data.lo, s.data.hi)} vs base {pct(s.data.base)} · p {s.data.p}</p>
            <Verdict ok={s.data.differs ? true : null}>{s.data.verdict}</Verdict>
          </div>
        ))}
      </Panel>
      <Panel title="Cross-source comparator" right={<div className="flex gap-2"><select className={inputCls} value={A} onChange={(e) => setA(e.target.value)}>{names.map((n) => <option key={n}>{n}</option>)}</select><span className="self-center text-muted-foreground">vs</span><select className={inputCls} value={B} onChange={(e) => setB(e.target.value)}>{names.map((n) => <option key={n}>{n}</option>)}</select></div>}>
        {A === B ? <Note>Pick two different sources.</Note> : c.isLoading ? <Loading /> : c.data && (
          <>
            <DataTable rows={c.data.rows as unknown as Record<string, unknown>[]} cols={[{ key: "metric", label: "metric" }, { key: "a", label: A }, { key: "b", label: B }, { key: "diff", label: "diff" }, { key: "ci", label: "95% CI", render: (r) => ci(r.lo as number, r.hi as number, 4) }, { key: "q", label: "q" }, { key: "differs", label: "", render: (r) => <Verdict ok={r.differs ? false : true}>{r.differs ? "differs" : "same"}</Verdict> }]} />
            <p className="mt-2 text-[12px] text-muted-foreground">10× gap median {c.data.gaps10.medianA} vs {c.data.gaps10.medianB} (q {c.data.gaps10.q}) · house edge {pct(c.data.edgeA, 2)} vs {pct(c.data.edgeB, 2)} · n {c.data.nA.toLocaleString()} / {c.data.nB.toLocaleString()}</p>
          </>
        )}
      </Panel>
    </div>
  );
}
