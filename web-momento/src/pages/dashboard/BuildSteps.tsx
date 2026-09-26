import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Download } from "lucide-react";
import { api } from "@/lib/api";
import { Loading, PageHeader, Panel, StatTile } from "@/components/bits";
import { DownloadSourceButton } from "@/components/DownloadSourceButton";

interface BuildStep {
  step: number;
  title: string;
  status: string;
  updated_ms: number;
}

export default function BuildSteps() {
  const steps = useQuery({ queryKey: ["build-steps"], queryFn: () => api.get<{ steps: BuildStep[] }>("/api/v1/platform/build-steps") });

  if (steps.isLoading) return <Loading rows={4} />;

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Build Steps"
        subtitle="The thirteen-step implementation record of the platform — architecture through handover. The full source for every step ships inside the downloadable bundle."
        actions={<DownloadSourceButton />}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Steps" value={steps.data?.steps.length ?? 0} sub="implementation record" />
        <StatTile label="Status" value={steps.data?.steps.every((s) => s.status === "done") ? "complete" : "in progress"} tone="good" />
        <StatTile label="Bundle" value="v6.3.0" sub="versioned handover" tone="signal" />
        <StatTile label="Docs shipped" value="17" sub="inside the bundle" />
      </div>
      <Panel>
        <div className="space-y-1">
          {(steps.data?.steps ?? []).map((s) => (
            <div key={s.step} className="flex items-center gap-3 border-b border-border/40 py-2.5 last:border-0">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span className="font-data w-8 text-[12px] text-muted-foreground">{String(s.step).padStart(2, "0")}</span>
              <span className="text-[13.5px]">{s.title}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">{new Date(s.updated_ms).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Regenerating bundles">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Every platform update produces a fresh versioned bundle (source + docs + API reference + manifest + parity report) via the bundler script, registered with the backend so the Download Source button always
          serves the running version. The current bundle also lives on the <a href="/dashboard/downloads" className="text-primary hover:underline">Downloads page</a> with checksums and release notes.
        </p>
      </Panel>
    </div>
  );
}
