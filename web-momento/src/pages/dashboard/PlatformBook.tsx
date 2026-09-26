// Platform Book implementation status: 38 features (Ch 18), Phase 0 security (Ch 17), and links into the bundled book
import { Link } from "react-router-dom";
import { Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";
import { DataTable, Note, Verdict, useV1 } from "@/components/v65/kit";
import { DOC_CONTENT } from "@/lib/docs";

type Book = { version: string; stored: Record<string, number>; features: { id: string; name: string; status: string; where: string; api: string }[] };
type Sec = { version: string; passing: number; total: number; checks: { id: string; title: string; ok: boolean; detail: string }[] };

export default function PlatformBook() {
  const b = useV1<Book>("platform/book", { refetch: 30_000 });
  const s = useV1<Sec>("security/status");
  const chapters = Object.keys(DOC_CONTENT).filter((k) => k.startsWith("book-")).sort();
  const live = b.data?.features.filter((f) => f.status === "live").length ?? 0;
  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="Platform Book" subtitle="v6.5 implements The Momento Platform Book: every feature in the Chapter 18 catalogue, the Chapter 17 Phase 0 security fixes, and the full book bundled into the docs." />
      {b.isLoading ? <Loading rows={4} /> : b.data && (
        <MetricGrid>
          <StatTile label="Features" value={`${live}/${b.data.features.length} live`} sub={`${b.data.features.length - live} partial`} tone="good" pulse />
          <StatTile label="Stored forecasts" value={b.data.stored.forecasts} sub={`${b.data.stored.resolved} resolved · ${b.data.stored.voided} void · chain ${b.data.stored.chain}`} />
          <StatTile label="Engines · experiments" value={`${b.data.stored.engines} · ${b.data.stored.experiments}`} sub={`${b.data.stored.predictions} predictions · ${b.data.stored.decisions} decisions`} />
          <StatTile label="Security (Phase 0)" value={s.data ? `${s.data.passing}/${s.data.total}` : "—"} sub="checks passing — see below" tone={s.data && s.data.passing === s.data.total ? "good" : "warn"} />
        </MetricGrid>
      )}
      <Panel title="Chapter 18 feature catalogue">
        <DataTable rows={(b.data?.features ?? []) as unknown as Record<string, unknown>[]} max={640} cols={[
          { key: "id", label: "id" }, { key: "name", label: "feature" },
          { key: "status", label: "status", render: (r) => <Verdict ok={r.status === "live" ? true : null}>{String(r.status)}</Verdict> },
          { key: "where", label: "where", render: (r) => { const w = String(r.where); const m = w.match(/\/(dashboard|app)[^\s,]*/); return m ? <Link className="text-primary underline" to={m[0]}>{w}</Link> : w; } },
          { key: "api", label: "api", className: "text-muted-foreground" },
        ]} />
      </Panel>
      <Panel title="Chapter 17 · Phase 0 security posture">
        {s.data ? <DataTable rows={s.data.checks as unknown as Record<string, unknown>[]} cols={[{ key: "id", label: "id" }, { key: "title", label: "check" }, { key: "ok", label: "", render: (r) => <Verdict ok={r.ok as boolean}>{r.ok ? "pass" : "action"}</Verdict> }, { key: "detail", label: "detail", className: "text-muted-foreground" }]} /> : <Loading />}
        <Note>Checks marked "action" are configuration, not code: set INGEST_HMAC_SECRET, SETUP_PASSWORD and CORS_ORIGINS on the deployed worker, then rotate the default operator password.</Note>
      </Panel>
      <Panel title="Read the book">
        <div className="grid gap-1 md:grid-cols-2">{chapters.map((c) => <Link key={c} to={`/dashboard/docs/${c}`} className="rounded-md px-2 py-1 text-[13px] text-primary hover:bg-muted/40">{c.replace(/^book-/, "").replace(/-/g, " ")}</Link>)}</div>
      </Panel>
    </div>
  );
}
