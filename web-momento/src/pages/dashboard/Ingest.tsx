import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Database, FileUp, Loader2, Pause, Play, Plus, Radio, RefreshCw, Upload } from "lucide-react";
import { detectSchemas, mapRounds, openSqlite, type DbMapping } from "@/lib/dbIngest";
import { api } from "@/lib/api";
import { fmtInt, fmtMult, timeAgo } from "@/lib/format";
import type { RoundDto } from "@/lib/types";
import { Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface FeedStatus {
  enabled: boolean;
  cursor: number;
  seedFingerprint?: string;
  rounds: number;
  intervalMs: number;
}

/** Rounds per POST when pushing a mapped .db — keeps payloads well under limits. */
const DB_CHUNK = 2_000;

export default function Ingest() {
  const qc = useQueryClient();
  const [source, setSource] = useState("aviator");
  const [raw, setRaw] = useState("");
  const [liveMode, setLiveMode] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dbFileRef = useRef<File | null>(null);
  const dbInputRef = useRef<HTMLInputElement>(null);
  const [dbState, setDbState] = useState<{ file: string; mappings: DbMapping[]; busy: false | "parsing" | "importing"; progress: number } | null>(null);

  const feed = useQuery({
    queryKey: ["feed", "ingest"],
    queryFn: () => api.get<FeedStatus>("/api/v1/feed/status"),
    refetchInterval: 8_000,
  });
  const latest = useQuery({
    queryKey: ["rounds", "latest", "ingest"],
    queryFn: () => api.get<{ rounds: RoundDto[] }>("/api/v1/rounds/latest?limit=15"),
    refetchInterval: 5_000,
  });
  const sources = useQuery({ queryKey: ["sources", "ingest"], queryFn: () => api.get<{ sources: { name: string }[] }>("/api/v1/sources") });

  const invalidate = () => qc.invalidateQueries();

  const push = useMutation({
    mutationFn: (rounds: unknown[]) => api.post<{ inserted: number; rejected: number }>("/api/v1/ingest", { source, method: "api", rounds }),
    onSuccess: (d) => {
      toast.success(`${fmtInt(d.inserted)} rounds ingested${d.rejected ? `, ${d.rejected} rejected` : ""}`);
      setRaw("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startFeed = useMutation({
    mutationFn: () => api.post("/api/v1/feed/start"),
    onSuccess: () => {
      toast.success("Live engine running");
      invalidate();
    },
  });
  const stopFeed = useMutation({
    mutationFn: () => api.post("/api/v1/feed/stop"),
    onSuccess: () => {
      toast("Live engine stopped");
      invalidate();
    },
  });
  const step = useMutation({
    mutationFn: () => api.post<{ generated: number }>("/api/v1/feed/step", { count: 1 }),
    onSuccess: invalidate,
  });
  const rebuild = useMutation({
    mutationFn: () => api.post<{ rebuilt: string[] }>("/api/v1/sessions/rebuild", {}),
    onSuccess: (d) => {
      toast.success(`Sessions rebuilt for ${d.rebuilt.join(", ")}`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const parseRaw = (): unknown[] => {
    const text = raw.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
      const obj = parsed as Record<string, unknown>;
      for (const key of ["rounds", "data", "results", "items", "history", "records"]) {
        if (Array.isArray(obj[key])) return obj[key] as unknown[];
      }
      return [parsed];
    } catch {
      // plain numbers / CSV
      return text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean).map((s) => ({ multiplier: Number(s.replace(/x$/i, "")) }));
    }
  };

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setRaw(String(reader.result ?? ""));
      toast("File loaded — review then push");
    };
    reader.readAsText(file);
  };

  // SQLite files: open, scan every table, auto-map the schema, preview.
  const onDbFile = async (file: File) => {
    dbFileRef.current = file;
    setDbState({ file: file.name, mappings: [], busy: "parsing", progress: 0 });
    try {
      const db = await openSqlite(file);
      const mappings = detectSchemas(db);
      db.close();
      if (!mappings.length) {
        toast.error("No round-like table found in this database");
        setDbState(null);
        return;
      }
      setDbState({ file: file.name, mappings, busy: false, progress: 0 });
      toast.success(`${mappings.length} importable table${mappings.length === 1 ? "" : "s"} detected`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read database file");
      setDbState(null);
    }
  };

  // Push the mapped rounds in chunks so no request hits payload limits.
  const importDb = async (mapping: DbMapping) => {
    if (!dbState || dbState.busy) return;
    setDbState({ ...dbState, busy: "importing", progress: 0 });
    try {
      const file = dbFileRef.current;
      if (!file) throw new Error("Database file is gone — pick it again");
      const db = await openSqlite(file);
      const rounds = mapRounds(db, mapping);
      db.close();
      if (!rounds.length) {
        toast.error("No valid rounds mapped from this table");
        setDbState({ ...dbState, busy: false });
        return;
      }
      let inserted = 0;
      let rejected = 0;
      for (let i = 0; i < rounds.length; i += DB_CHUNK) {
        const res = await api.post<{ inserted: number; rejected: number }>("/api/v1/ingest", {
          source,
          method: "db-upload",
          rounds: rounds.slice(i, i + DB_CHUNK),
        });
        inserted += res.inserted;
        rejected += res.rejected;
        setDbState((s) => (s ? { ...s, progress: Math.min(i + DB_CHUNK, rounds.length) / rounds.length } : s));
      }
      toast.success(`${fmtInt(inserted)} rounds imported from ${mapping.table}${rejected ? `, ${fmtInt(rejected)} rejected` : ""}`);
      toast("Large import? Hit “Rebuild sessions” to re-sessionize", { duration: 6_000 });
      invalidate();
      setDbState(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
      setDbState((s) => (s ? { ...s, busy: false } : s));
    }
  };

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Ingest Console"
        subtitle="REST push, file upload (JSON/CSV/plain numbers), SQLite .db import with auto-schema detection. Accepted multiplier keys: multiplier, value, crash_point, result, payout."
        actions={
          <Button variant="outline" size="sm" className="gap-2" onClick={() => rebuild.mutate()}>
            <RefreshCw className="h-3.5 w-3.5" /> Rebuild sessions
          </Button>
        }
      />

      <MetricGrid>
        <StatTile label="Feed engine" value="disabled" sub="no synthetic data" tone="default" />
        <StatTile label="Rounds" value={fmtInt(feed.data?.rounds ?? 0)} sub="from collectors" />
        <StatTile label="Sources" value={sources.data?.sources.length ?? 0} sub="registered" />
        <StatTile label="Last round" value={fmtMult(latest.data?.rounds[0]?.multiplier)} sub={timeAgo(latest.data?.rounds[0]?.ts)} pulse />
      </MetricGrid>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Push rounds">
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ing-src">Source</Label>
                <Input id="ing-src" value={source} onChange={(e) => setSource(e.target.value)} className="w-40 font-data" />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()}>
                  <FileUp className="h-3.5 w-3.5" /> Upload file
                </Button>
                <input ref={fileRef} type="file" accept=".json,.csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              </div>
            </div>
            <Textarea
              rows={7}
              placeholder={'[{"multiplier": 2.41}, {"multiplier": 1.08}]\nor CSV / plain numbers: 2.41, 1.08, 3.15'}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              className="font-data text-[12px]"
            />
            <div className="flex gap-2">
              <Button className="gap-2" disabled={!raw.trim() || push.isPending} onClick={() => push.mutate(parseRaw())}>
                {push.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Push to database
              </Button>
              <Button variant="outline" onClick={() => setRaw("")}>Clear</Button>
            </div>
          </div>
        </Panel>

        <Panel title="Provably-fair live engine">
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Rounds are generated from a hash chain: SHA-256(seed:cursor) → m = floor(0.97/(1−r)·100)/100. The seed never leaves the server; every generated round is reproducible and verifiable after the fact
              from the Round Testing screen.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button className="gap-2" onClick={() => { startFeed.mutate(); setLiveMode(true); }} disabled={feed.data?.enabled}>
                <Play className="h-4 w-4" /> Start engine
              </Button>
              <Button variant="outline" className="gap-2" onClick={() => { stopFeed.mutate(); setLiveMode(false); }} disabled={!feed.data?.enabled}>
                <Pause className="h-4 w-4" /> Stop
              </Button>
              <Button variant="outline" className="gap-2" onClick={() => step.mutate()} disabled={step.isPending}>
                <Radio className="h-4 w-4" /> Step 1 round
              </Button>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/40 p-3 text-[12px] text-muted-foreground">
              Seed fingerprint: <span className="font-data text-foreground/90">{feed.data?.seedFingerprint ?? "—"}</span> · cursor <span className="font-data text-foreground/90">{feed.data?.cursor ?? 0}</span>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="SQLite .db import — auto schema">
        <div className="space-y-3">
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Drop a SQLite database file and every table is scanned automatically: the multiplier column (any
            naming), percent-encoded values (9600 → <span className="font-data">96.00x</span>), timestamps in
            epoch ms/s, Julian day or ISO strings, and color columns are detected without configuration.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => dbInputRef.current?.click()} disabled={dbState?.busy === "parsing"}>
              {dbState?.busy === "parsing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
              Choose .db file
            </Button>
            <input
              ref={dbInputRef}
              type="file"
              accept=".db,.sqlite,.sqlite3,.sqlite2,application/vnd.sqlite3"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onDbFile(e.target.files[0])}
            />
            {dbState && (
              <span className="font-data text-[12px] text-muted-foreground">
                {dbState.file} · {dbState.busy === "parsing" ? "scanning…" : `${dbState.mappings.length} table(s) detected`}
              </span>
            )}
          </div>

          {dbState && dbState.busy !== "parsing" && (
            <div className="space-y-3">
              {dbState.mappings.map((m) => (
                <div key={m.table} className="rounded-lg border border-border/70 bg-background/40 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-data text-[13px] font-semibold text-foreground/90">{m.table}</span>
                    <span className="font-data text-[11px] text-muted-foreground">{fmtInt(m.rowCount)} rows</span>
                    <span
                      className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide"
                      style={{
                        color: m.confidence === "high" ? "#34D399" : m.confidence === "medium" ? "#F59E0B" : "#94A3B8",
                        borderColor: "currentColor",
                      }}
                    >
                      {m.confidence} confidence
                    </span>
                    <Button
                      size="sm"
                      className="ml-auto gap-1.5"
                      disabled={dbState.busy === "importing"}
                      onClick={() => importDb(m)}
                    >
                      {dbState.busy === "importing" ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {Math.round(dbState.progress * 100)}%
                        </>
                      ) : (
                        <>
                          <Upload className="h-3.5 w-3.5" /> Import to feed
                        </>
                      )}
                    </Button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-data text-[11.5px] text-muted-foreground">
                    <span>
                      <span className="text-foreground/80">{m.multiplierColumn}</span> → multiplier
                      {m.scale > 1 ? ` (÷${m.scale})` : ""}
                    </span>
                    {m.timestampColumn && (
                      <span>
                        <span className="text-foreground/80">{m.timestampColumn}</span> → timestamp ({m.timestampUnit})
                      </span>
                    )}
                    {m.colorColumn && (
                      <span>
                        <span className="text-foreground/80">{m.colorColumn}</span> → color
                      </span>
                    )}
                  </div>
                  {m.notes.map((n) => (
                    <p key={n} className="mt-1 text-[11px] text-amber-400/80">{n}</p>
                  ))}
                  {m.sample.length > 0 && (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full font-data text-[11px]">
                        <thead>
                          <tr className="border-b border-border/50 text-left text-muted-foreground/70">
                            {Object.keys(m.sample[0]).map((c) => (
                              <th key={c} className="py-1 pr-3 font-normal">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {m.sample.map((row, i) => (
                            <tr key={i} className="text-muted-foreground">
                              {Object.keys(m.sample[0]).map((c) => (
                                <td key={c} className="py-0.5 pr-3">{String(row[c] ?? "—")}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Ingest feed (latest 15)">
        <div className="space-y-1">
          {latest.data?.rounds.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border-b border-border/40 py-1.5 text-[12.5px] last:border-0">
              <span className="font-data w-16 text-right" style={{ color: r.multiplier >= 10 ? "#F59E0B" : r.multiplier >= 2 ? "#8B5CF6" : "#3B82F6" }}>{fmtMult(r.multiplier)}</span>
              <span className="font-data text-muted-foreground">{r.source}</span>
              <span className="font-data text-muted-foreground/70">session #{r.session_id ?? "—"}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">{timeAgo(r.ts)}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
