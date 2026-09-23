import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BookOpen, CheckCircle2, Download, FileArchive, ListOrdered, Package, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDateTime, fmtInt } from "@/lib/format";
import type { ReleaseDto } from "@/lib/types";
import { Loading, PageHeader, Panel, StatTile } from "@/components/bits";
import { DownloadSourceButton } from "@/components/DownloadSourceButton";

interface BundleContents {
  files: number;
  sizeMb: number;
  version: string;
  sha256: string;
  generated: string;
  steps: number;
}

export default function Downloads() {
  const releases = useQuery({ queryKey: ["releases"], queryFn: () => api.get<{ releases: ReleaseDto[] }>("/api/v1/releases") });
  const stats = useQuery({ queryKey: ["bundle-stats"], queryFn: () => fetch("/downloads/bundle-stats.json").then((r) => r.json() as Promise<BundleContents>).catch(() => null) });

  if (releases.isLoading) return <Loading rows={4} />;
  const list = releases.data?.releases ?? [];
  const latest = list[0];

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Downloads"
        subtitle="Versioned handover bundles — full source, documentation, API reference, manifest and parity report. Produced automatically on every platform update."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Latest release" value={latest ? `v${latest.version}` : stats.data ? `v${stats.data.version}` : "—"} sub={latest ? fmtDateTime(latest.created_ms) : "refreshed every build"} tone="signal" pulse />
        <StatTile label="Files in bundle" value={stats.data ? fmtInt(stats.data.files) : "—"} sub="source + docs + manifest" />
        <StatTile label="Bundle size" value={stats.data ? `${stats.data.sizeMb} MB` : "—"} sub={stats.data?.sha256 ? `sha256 ${stats.data.sha256.slice(0, 10)}…` : "zipped"} />
        <StatTile label="Documented steps" value={stats.data?.steps ?? 16} sub="per-step build walkthrough inside" />
      </div>

      <div className="rounded-xl border border-primary/25 bg-primary/5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Package className="h-7 w-7 text-primary" />
            <div>
              <p className="text-[15px] font-semibold">{latest ? `momento-platform-${latest.version}.zip` : "Source bundle"}</p>
              <p className="text-[12.5px] text-muted-foreground">Complete, runnable handover package — matches the running platform version.</p>
            </div>
          </div>
          <DownloadSourceButton />
        </div>
        <div className="mt-4 grid gap-2 text-[12.5px] text-muted-foreground sm:grid-cols-2">
          <p className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Full web console + backend Worker source</p>
          <p className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> All documentation files + API reference</p>
          <p className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> MANIFEST + parity verification report</p>
          <p className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> BUILD_WALKTHROUGH — every step documented</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-4 border-t border-primary/15 pt-3 text-[12px]">
          <Link to="/dashboard/docs/build-walkthrough" className="flex items-center gap-1.5 text-primary hover:underline"><ListOrdered className="h-3.5 w-3.5" /> Step-by-step walkthrough</Link>
          <Link to="/dashboard/docs/source-bundle" className="flex items-center gap-1.5 text-primary hover:underline"><BookOpen className="h-3.5 w-3.5" /> Bundle pipeline docs</Link>
          <Link to="/dashboard/build-steps" className="flex items-center gap-1.5 text-primary hover:underline"><ListOrdered className="h-3.5 w-3.5" /> Build steps tracker</Link>
        </div>
      </div>

      <Panel title="Release history">
        <div className="space-y-1.5">
          {list.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5">
              <FileArchive className="h-4 w-4 text-primary" />
              <div className="min-w-[180px]">
                <p className="font-data text-[13px]">{r.filename}</p>
                <p className="text-[11px] text-muted-foreground">v{r.version} · {r.created_ms ? fmtDateTime(r.created_ms) : ""}</p>
              </div>
              {r.sha256 && <span className="hidden font-data text-[10.5px] text-muted-foreground/70 md:block">sha256 {r.sha256.slice(0, 24)}…</span>}
              {r.notes && <p className="hidden flex-1 truncate text-[12px] text-muted-foreground lg:block">{r.notes}</p>}
              <a href={r.url} download className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12.5px] hover:border-primary/40">
                <Download className="h-3.5 w-3.5" /> Download
              </a>
            </div>
          ))}
          {!list.length && (
            <p className="py-8 text-center text-[13px] text-muted-foreground">
              No releases registered yet — the bundle is published at the end of the build pipeline.
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Integrity">
        <p className="flex items-start gap-2 text-[13px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          Every release is registered with the backend (version, filename, SHA-256) before the download button points at it. The API exposes <span className="font-data">GET /api/v1/releases</span> and{" "}
          <span className="font-data">GET /api/v1/releases/latest</span> so scripts can verify they're running the same version they downloaded.
        </p>
      </Panel>
    </div>
  );
}
