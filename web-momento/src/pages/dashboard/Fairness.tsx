// F-36 Fairness Console (battery, verifier, convention solver, seed chain) · F-03 CUSUM source fingerprint
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, Field, MiniLines, Note, Verdict, btnCls, inputCls, pct, useV1 } from "@/components/v65/kit";

type Battery = { n: number; houseEdge: number; edges: { cashout: number; rtp: number; rtpLo: number; rtpHi: number; edge: number }[]; tests: { test: string; statistic: number; p: number; n: number; note: string; q: number; flagged: boolean }[]; expectedShares: { band: string; expected: number; observed: number }[]; verdict: string };
type Fp = { source: string; stats: { key: string; label: string; reference: number; sd: number; series: { day: string; n: number; value: number; cusumHi: number; cusumLo: number }[]; alarm: boolean; firstAlarm: string | null }[]; alarm: boolean; note: string };

export default function Fairness() {
  const bat = useV1<Battery>("fair/battery");
  const fp = useV1<Fp>("fingerprint");
  const [v, setV] = useState({ server: "", client: "", nonce: "", observed: "" });
  const [vr, setVr] = useState<{ results: { convention: string; value: number; match: boolean | null }[]; matches: string[] } | null>(null);
  const [solveText, setSolveText] = useState("");
  const [solved, setSolved] = useState<Record<string, unknown> | null>(null);
  const [chain, setChain] = useState({ revealed: "", committed: "" });
  const [chainRes, setChainRes] = useState<{ found: boolean; depth: number | null } | null>(null);
  const verify = async () => { try { setVr(await api.post("/api/v1/fair/verify", { server: v.server, client: v.client || undefined, nonce: v.nonce ? Number(v.nonce) : undefined, observed: v.observed ? Number(v.observed) : undefined })); } catch (e) { toast.error(String(e)); } };
  const solve = async () => {
    try {
      const rounds = solveText.trim().split("\n").map((l) => { const [server, client, nonce, observed] = l.split(/[,\t]/).map((s) => s.trim()); return { server, client, nonce: Number(nonce), observed: Number(observed) }; });
      setSolved(await api.post("/api/v1/fair/solve", { rounds }));
    } catch (e) { toast.error(String(e)); }
  };
  const checkChain = async () => { try { setChainRes(await api.post("/api/v1/fair/chain", chain)); } catch (e) { toast.error(String(e)); } };
  const b = bat.data;
  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="Fairness Console" subtitle="Platform Book F-36/F-03. Is the tape consistent with a fair provably-fair game? Return-to-player by cash-out, a battery of distribution and independence tests with multiple-testing correction, a round verifier for common hash conventions (incl. Spribe SHA-512), and daily CUSUM fingerprints that alarm when a source drifts." />
      {bat.isLoading ? <Loading rows={4} /> : b && (
        <MetricGrid>
          <StatTile label="Verdict" value={b.verdict.split(" ")[0].toUpperCase()} sub={b.verdict} tone={b.tests.some((t) => t.flagged) ? "warn" : "good"} pulse />
          <StatTile label="House edge (tape)" value={pct(b.houseEdge, 2)} sub={`n=${b.n.toLocaleString()}`} tone="signal" />
          <StatTile label="Tests flagged" value={`${b.tests.filter((t) => t.flagged).length}/${b.tests.length}`} sub="BH q < 0.05" />
          <StatTile label="Fingerprint" value={fp.data ? (fp.data.alarm ? "ALARM" : "STABLE") : "—"} sub={fp.data?.note?.slice(0, 60)} tone={fp.data?.alarm ? "warn" : "good"} />
        </MetricGrid>
      )}
      <Tabs defaultValue="battery">
        <TabsList><TabsTrigger value="battery">Battery</TabsTrigger><TabsTrigger value="verify">Verify a round</TabsTrigger><TabsTrigger value="solve">Solve convention</TabsTrigger><TabsTrigger value="chain">Seed chain</TabsTrigger><TabsTrigger value="fingerprint">Fingerprint</TabsTrigger></TabsList>
        <TabsContent value="battery">
          {b && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Return to player by cash-out"><DataTable rows={b.edges as unknown as Record<string, unknown>[]} cols={[{ key: "cashout", label: "cash out" }, { key: "rtp", label: "RTP", render: (r) => pct(r.rtp as number, 2) }, { key: "ci", label: "95% CI", render: (r) => `${pct(r.rtpLo as number, 1)}–${pct(r.rtpHi as number, 1)}` }, { key: "edge", label: "edge", render: (r) => pct(r.edge as number, 2) }]} /></Panel>
              <Panel title="Tests"><DataTable rows={b.tests as unknown as Record<string, unknown>[]} cols={[{ key: "test", label: "test" }, { key: "statistic", label: "stat" }, { key: "p", label: "p" }, { key: "q", label: "q" }, { key: "flagged", label: "", render: (r) => <Verdict ok={!r.flagged}>{r.flagged ? "flag" : "ok"}</Verdict> }, { key: "note", label: "note", className: "max-w-[260px] text-muted-foreground" }]} /></Panel>
              <Panel title="Band shares — expected under 0.97/x vs observed" className="lg:col-span-2"><DataTable rows={b.expectedShares as unknown as Record<string, unknown>[]} cols={[{ key: "band", label: "band" }, { key: "expected", label: "expected", render: (r) => pct(r.expected as number, 2) }, { key: "observed", label: "observed", render: (r) => pct(r.observed as number, 2) }]} /></Panel>
            </div>
          )}
        </TabsContent>
        <TabsContent value="verify">
          <Panel>
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Server seed"><input className={inputCls} value={v.server} onChange={(e) => setV({ ...v, server: e.target.value })} /></Field>
              <Field label="Client seed(s)"><input className={inputCls} value={v.client} onChange={(e) => setV({ ...v, client: e.target.value })} /></Field>
              <Field label="Nonce"><input className={inputCls} value={v.nonce} onChange={(e) => setV({ ...v, nonce: e.target.value })} /></Field>
              <Field label="Observed ×"><input className={inputCls} value={v.observed} onChange={(e) => setV({ ...v, observed: e.target.value })} /></Field>
            </div>
            <button type="button" className={`${btnCls} mt-3`} onClick={verify} disabled={!v.server}>Verify</button>
            {vr && <div className="mt-3"><p className="mb-2 text-[13px]">Matches: {vr.matches.length ? vr.matches.join(", ") : "none"}</p><DataTable rows={vr.results as unknown as Record<string, unknown>[]} cols={[{ key: "convention", label: "convention" }, { key: "value", label: "result ×" }, { key: "match", label: "", render: (r) => (r.match == null ? "—" : <Verdict ok={r.match as boolean}>{r.match ? "match" : "no"}</Verdict>) }]} /></div>}
          </Panel>
        </TabsContent>
        <TabsContent value="solve">
          <Panel>
            <Field label="One round per line: server, client, nonce, observed (3+ rounds)"><textarea className={`${inputCls} h-32 w-full py-2`} value={solveText} onChange={(e) => setSolveText(e.target.value)} /></Field>
            <button type="button" className={`${btnCls} mt-3`} onClick={solve}>Find the convention</button>
            {solved && <pre className="mt-3 overflow-auto rounded-md bg-muted/40 p-3 font-data text-[11.5px]">{JSON.stringify(solved, null, 2)}</pre>}
          </Panel>
        </TabsContent>
        <TabsContent value="chain">
          <Panel>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Revealed seed"><input className={inputCls} value={chain.revealed} onChange={(e) => setChain({ ...chain, revealed: e.target.value })} /></Field>
              <Field label="Committed hash"><input className={inputCls} value={chain.committed} onChange={(e) => setChain({ ...chain, committed: e.target.value })} /></Field>
            </div>
            <button type="button" className={`${btnCls} mt-3`} onClick={checkChain}>Walk the chain</button>
            {chainRes && <p className="mt-3 text-[13px]">{chainRes.found ? <Verdict ok>found at depth {chainRes.depth}</Verdict> : <Verdict ok={false}>not found within depth</Verdict>}</p>}
          </Panel>
        </TabsContent>
        <TabsContent value="fingerprint">
          {fp.data ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {fp.data.stats.map((s) => (
                <Panel key={s.key} title={`${s.label} · ref ${s.reference}`} right={<Verdict ok={!s.alarm}>{s.alarm ? `alarm ${s.firstAlarm ?? ""}` : "stable"}</Verdict>}>
                  <MiniLines series={[{ name: "daily value", color: "#06B6D4", points: s.series.map((x, i) => [i, x.value]) }, { name: "reference", color: "#64748b", dashed: true, points: [[0, s.reference], [Math.max(1, s.series.length - 1), s.reference]] }]} height={140} />
                </Panel>
              ))}
              <div className="lg:col-span-2"><Note>{fp.data.note}</Note></div>
            </div>
          ) : <Loading />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
