// F-18 Tamper-evident track record: hash chain, daily heads, export and in-browser verification
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/state/auth";
import { Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";
import { DataTable, Note, Verdict, btnCls, btnGhost, useV1 } from "@/components/v65/kit";

type Head = { seq: number; head: string; at: number; genesis: string; daily: { day: string; seq: number; head: string }[] };
type Ver = { rows: number; valid: boolean; firstBadSeq: number | null; tamperedForecasts: number; head: string };
type Fc = { stats: { n: number; resolved: number; voided: number; live: number; skill: number }; rows: Record<string, unknown>[] };

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function TrackRecord() {
  const { isOperator } = useAuth();
  const qc = useQueryClient();
  const head = useV1<Head>("ledger/head", { refetch: 15_000 });
  const ver = useV1<Ver>("ledger/verify");
  const fc = useV1<Fc>("ledger/forecasts?limit=200", { refetch: 15_000 });
  const [local, setLocal] = useState<{ ok: boolean; rows: number; head: string; bad: number | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const verifyInBrowser = async () => {
    setBusy(true);
    try {
      let from = 1, prev = "", rows = 0, bad: number | null = null;
      for (let page = 0; page < 200; page++) {
        const r = await api.live<{ rows: { seq: number; payload: string; prev_hash: string; row_hash: string }[]; genesis: string }>(`/api/v1/ledger/export?from=${from}&limit=2000`);
        if (page === 0) prev = r.genesis;
        if (!r.rows.length) break;
        for (const row of r.rows) {
          const h = await sha256(prev + "|" + row.payload);
          if (row.prev_hash !== prev || h !== row.row_hash) { bad = row.seq; break; }
          prev = h; rows++;
        }
        if (bad !== null || r.rows.length < 2000) break;
        from = r.rows[r.rows.length - 1].seq + 1;
      }
      setLocal({ ok: bad === null, rows, head: prev, bad });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const backfill = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ created: number }>("/api/v1/ledger/backfill", { n: 300 });
      toast.success(`${r.created} causal back-fill forecasts chained`);
      qc.invalidateQueries({ queryKey: ["v65"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Track Record"
        subtitle="Platform Book F-18. Every forecast, prediction and decision is stored when it is made and appended to a SHA-256 hash chain. Change one stored number and the chain breaks — anyone can verify it in their own browser."
        actions={
          <>
            <button type="button" className={btnCls} disabled={busy} onClick={verifyInBrowser}><ShieldCheck className="h-4 w-4" />Verify in my browser</button>
            {isOperator && <button type="button" className={btnGhost} disabled={busy} onClick={backfill}>Back-fill 300 (causal)</button>}
          </>
        }
      />
      <MetricGrid>
        <StatTile label="Chain rows" value={head.data?.seq?.toLocaleString() ?? "—"} sub={head.data ? `head ${head.data.head.slice(0, 12)}…` : ""} pulse />
        <StatTile label="Server verify" value={ver.data ? (ver.data.valid ? "VALID" : "BROKEN") : "—"} sub={ver.data ? `${ver.data.tamperedForecasts} tampered forecast rows` : ""} tone={ver.data?.valid ? "good" : "bad"} />
        <StatTile label="Browser verify" value={local ? (local.ok ? "VALID" : `BROKEN @${local.bad}`) : "not run"} sub={local ? `${local.rows} rows · head ${local.head.slice(0, 12)}…` : "WebCrypto SHA-256"} tone={local ? (local.ok ? "good" : "bad") : "default"} />
        <StatTile label="Stored forecasts" value={fc.data?.stats.n ?? "—"} sub={fc.data ? `${fc.data.stats.resolved} resolved · ${fc.data.stats.voided} void · skill ${fc.data.stats.skill?.toFixed(4)}` : ""} tone="signal" />
      </MetricGrid>
      {local && head.data && <Note>Your browser recomputed {local.rows} hashes. Its final head {local.head === head.data.head ? "matches" : "does NOT match"} the server's published head.</Note>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Daily published heads" className="lg:col-span-1">
          {head.isLoading ? <Loading /> : <DataTable rows={(head.data?.daily ?? []) as unknown as Record<string, unknown>[]} cols={[{ key: "day", label: "day" }, { key: "seq", label: "seq" }, { key: "head", label: "head", render: (r) => <span title={String(r.head)}>{String(r.head).slice(0, 16)}…</span> }]} />}
        </Panel>
        <Panel title="Stored forecasts (newest first)" className="lg:col-span-2">
          {fc.isLoading ? <Loading /> : <DataTable rows={fc.data?.rows ?? []} max={460} cols={[
            { key: "id", label: "id" },
            { key: "origin", label: "origin", render: (r) => <Verdict tone={r.origin === "live" ? "good" : "muted"}>{String(r.origin)}</Verdict> },
            { key: "created_ms", label: "stored", render: (r) => new Date(r.created_ms as number).toLocaleString() },
            { key: "state", label: "state" },
            { key: "expected", label: "exp" },
            { key: "range", label: "50% range", render: (r) => `${r.range_lo}–${r.range_hi}` },
            { key: "actual", label: "actual" },
            { key: "void", label: "", render: (r) => (r.void ? <Verdict tone="warn">void</Verdict> : r.actual == null ? <Verdict>open</Verdict> : <Verdict ok={(r.mix_loss as number) <= (r.base_loss as number)}>{(r.mix_loss as number) <= (r.base_loss as number) ? "beat base" : "lost"}</Verdict>) },
            { key: "chain_seq", label: "chain" },
          ]} />}
        </Panel>
      </div>
      <Note>Algorithm: row_hash = sha256(prev_hash + "|" + canonical_json(payload)), genesis = 64 zeros. Back-filled rows are causal walk-forward forecasts created now, labelled origin = backfill, and can be excluded from any metric.</Note>
    </div>
  );
}
