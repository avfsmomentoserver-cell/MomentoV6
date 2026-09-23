import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FlaskConical, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { fmtInt, fmtMult } from "@/lib/format";
import { Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";
import { Button } from "@/components/ui/button";

interface FeedVerify {
  seedFingerprint: string;
  cursor: number;
  sample: { cursor: number; multiplier: number }[];
  algorithm: string;
}

/** Round Testing — provably-fair verification and round exercise. */
export default function RoundTesting() {
  const verify = useQuery({
    queryKey: ["feed", "verify"],
    queryFn: () => api.get<FeedVerify>("/api/v1/feed/verify"),
  });
  const latest = useQuery({
    queryKey: ["rounds", "latest", "testing"],
    queryFn: () => api.get<{ rounds: { id: number; ts: string; multiplier: number; color: string | null; source: string }[] }>("/api/v1/rounds/latest?limit=25"),
  });

  const step = useMutation({
    mutationFn: () => api.post<{ generated: number }>("/api/v1/feed/step", { count: 5 }),
    onSuccess: (d) => {
      toast.success(`${d.generated} test rounds generated`);
      verify.refetch();
      latest.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (verify.isLoading) return <Loading rows={5} />;
  const v = verify.data;

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Round Testing"
        subtitle="Verify the provably-fair engine and exercise rounds. Every generated round is reproducible from the seed fingerprint and cursor — recompute any of them, the values must match."
        actions={
          <Button className="gap-2" onClick={() => step.mutate()} disabled={step.isPending}>
            {step.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />} Generate 5 test rounds
          </Button>
        }
      />
      <MetricGrid>
        <StatTile label="Seed fingerprint" value={v?.seedFingerprint ?? "—"} sub="first 8 hex of the server seed" tone="signal" />
        <StatTile label="Cursor" value={v?.cursor ?? 0} sub="rounds generated" />
        <StatTile label="Algorithm" value="SHA-256" sub="seed:cursor → u32 → 0.97/(1−r)" />
        <StatTile label="Reproducible" value="yes" sub="deterministic under the seed" tone="good" />
      </MetricGrid>

      <Panel title="Verification sample (last 5 generated rounds)">
        <div className="space-y-1.5">
          {(v?.sample ?? []).slice().reverse().map((s) => (
            <div key={s.cursor} className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2 font-data text-[12.5px]">
              <span className="text-muted-foreground">cursor {s.cursor}</span>
              <span className="font-semibold">{fmtMult(s.multiplier)}</span>
            </div>
          ))}
          {!v?.sample.length && <p className="py-6 text-center text-[13px] text-muted-foreground">No engine rounds yet — generate some above.</p>}
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">{v?.algorithm}</p>
      </Panel>

      <Panel title="Latest rounds (all sources)">
        <div className="space-y-1">
          {latest.data?.rounds.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border-b border-border/40 py-1.5 text-[12.5px] last:border-0">
              <span className="font-data w-14 text-right">{fmtMult(r.multiplier)}</span>
              <span className="font-data text-muted-foreground">{r.source}</span>
              <span className="font-data text-muted-foreground/60">{r.color ?? "—"}</span>
              <span className="ml-auto font-data text-[11px] text-muted-foreground">id {fmtInt(r.id)}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
