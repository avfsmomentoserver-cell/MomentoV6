import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { Download, FileJson, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { AuditRow } from "@/lib/types";
import { Loading, PageHeader, Panel } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/state/auth";

const SETTING_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: "session_gap_minutes", label: "Session gap (minutes)", hint: "Rounds farther apart than this start a new session" },
  { key: "feed_interval_ms", label: "Live engine interval (ms)" },
  { key: "orchestrator_patience", label: "Orchestrator patience (rounds)" },
  { key: "orchestrator_min_confidence", label: "Orchestrator min confidence (0–1)" },
  { key: "autopilot_stake", label: "Autopilot stake (units)" },
  { key: "autopilot_threshold", label: "Autopilot cashout threshold (×)" },
];

export default function Settings() {
  const qc = useQueryClient();
  const { user, isOperator, logout } = useAuth();
  const [values, setValues] = useState<Record<string, string>>({});

  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<{ settings: Record<string, string> }>("/api/v1/settings") });
  const audit = useQuery({
    queryKey: ["audit"],
    queryFn: () => api.get<{ log: AuditRow[] }>("/api/v1/audit?limit=30"),
    refetchInterval: 20_000,
    enabled: isOperator,
  });

  useEffect(() => {
    if (settings.data?.settings) setValues(settings.data.settings);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => api.put("/api/v1/settings", { values }),
    onSuccess: () => {
      toast.success("Settings persisted to the database");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changePassword = useMutation({
    mutationFn: (vars: { password: string }) => api.post("/api/v1/users", { email: user?.email, password: vars.password, name: user?.name, role: user?.role }),
    onSuccess: () => toast.error("Email already registered — password changes go through the operator account (see runbook)"),
    onError: () => toast.info("Use the runbook flow: create a new operator, verify, then disable the old one"),
  });

  const exportAll = useMutation({
    mutationFn: async () => {
      const data = await api.get<Record<string, unknown>>("/api/v1/export?entity=all&limit=250000");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `momento-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => toast.success("Full JSON export downloaded"),
    onError: (e: Error) => toast.error(e.message),
  });

  if (settings.isLoading) return <Loading rows={5} />;

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Master Settings"
        subtitle="Platform configuration persisted in the settings table — every value is env-overridable server-side and editable here."
        actions={
          <Button variant="outline" className="gap-2" onClick={() => exportAll.mutate()} disabled={exportAll.isPending}>
            <FileJson className="h-4 w-4" /> Export all data (JSON)
          </Button>
        }
      />

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Configuration">
          <div className="space-y-3">
            {SETTING_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={f.key} className="text-[13px]">{f.label}</Label>
                <Input
                  id={f.key}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  className="w-44 font-data"
                />
                {f.hint && <p className="text-[11px] text-muted-foreground">{f.hint}</p>}
              </div>
            ))}
            <Button className="gap-2" onClick={() => save.mutate()} disabled={save.isPending}>
              <Download className="h-4 w-4" /> Save settings
            </Button>
          </div>
        </Panel>

        <div className="space-y-3">
          <Panel title="Account">
            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between border-b border-border/50 pb-2">
                <span className="text-muted-foreground">Signed in as</span>
                <span className="font-data">{user?.email ?? "guest"}</span>
              </div>
              <div className="flex justify-between border-b border-border/50 pb-2">
                <span className="text-muted-foreground">Role</span>
                <span className="font-data">{user?.role ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Backend</span>
                <span className="font-data">momento-core v6.2.0</span>
              </div>
              {user && (
                <Button variant="outline" size="sm" className="mt-2" onClick={() => { logout(); }}>
                  Sign out
                </Button>
              )}
            </div>
          </Panel>

          <Panel title="Import data">
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              Bulk imports go through <span className="font-data">POST /api/v1/import</span> with rows in the export format — round-trip safe with the export above. See the API reference in the Documentation Center.
            </p>
          </Panel>
        </div>
      </div>

      {isOperator && (
        <Panel title="Activity log (server-side audit trail)">
          <div className="no-scrollbar max-h-[320px] space-y-1 overflow-y-auto font-data text-[12px]">
            {audit.data?.log.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center gap-2 border-b border-border/40 py-1.5 last:border-0">
                <span className="text-muted-foreground">{fmtDateTime(row.created_ms)}</span>
                <span className="text-primary">{row.actor}</span>
                <span>{row.action}</span>
                {row.target && <span className="text-muted-foreground">→ {row.target}</span>}
              </div>
            ))}
            {!audit.data?.log.length && <p className="py-6 text-center text-muted-foreground">No activity recorded yet.</p>}
          </div>
        </Panel>
      )}
    </div>
  );
}
