// F-21 forecast cone on the chart · F-22 drawn predictions + honest leaderboard
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { safeStorage } from "@/lib/storage";
import { TvChart } from "@/components/tv/TvChart";
import { Loading, MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";
import { DataTable, Field, Note, Verdict, btnCls, inputCls, pct, useV1 } from "@/components/v65/kit";

type Cone = { forecastId: number | null; lastTs: number; cadenceMs: number; cone: { h: number; p25: number; p50: number; p75: number; p90: number; max50: number; max90: number; t: number }[]; etaMarkers: { threshold: number; rounds: number; at: string }[]; coverage: { p25p75: number | null; belowP90: number | null; n: number } };
type Pts = { points: { t: string; m: number; c: string }[] };
type Lb = { period: string; minN: number; users: { user: string; name: string; n: number; skill: number; lo: number; hi: number; ranked: boolean }[]; rankedUsers: number; positiveSkillUsers: number; expectedByChance: number | null; scoring: string };

function clientId(): string {
  let id = safeStorage.getItem("momento.clientId");
  if (!id) { id = Math.random().toString(36).slice(2, 12); safeStorage.setItem("momento.clientId", id); }
  return id;
}

export default function Predict() {
  const qc = useQueryClient();
  const cone = useV1<Cone>("intelligence/cone?h=10", { refetch: 10_000 });
  const pts = useV1<Pts>("market/points?limit=150", { refetch: 10_000 });
  const preds = useV1<{ rows: Record<string, unknown>[] }>("predictions", { refetch: 15_000 });
  const [period, setPeriod] = useState("all");
  const lb = useV1<Lb>(`leaderboard?period=${period}&minN=10`);
  const [level, setLevel] = useState(10);
  const [horizon, setHorizon] = useState(20);
  const [prob, setProb] = useState<string>("");
  const [name, setName] = useState("");

  const candles = useMemo(() => (pts.data?.points ?? []).map((p) => { const t = Math.floor(Date.parse(p.t) / 1000); return { t, o: 1, h: p.m, l: 1, c: p.m }; }).filter((c, i, a) => i === 0 || c.t > a[i - 1].t), [pts.data]);
  const projection = useMemo(() => (cone.data?.cone ?? []).map((c) => ({ t: Math.floor(c.t / 1000), p25: c.p25, p50: c.p50, p75: c.p75 })), [cone.data]);

  const submit = async () => {
    try {
      const r = await api.post<{ id: number; probability: number; mixtureP: number; horizon: number; etaMinutes: number; chainSeq: number }>("/api/v1/predictions", { level, horizon, probability: prob ? Number(prob) / 100 : undefined, displayName: name || undefined, clientId: clientId(), drawing: { kind: "level", level, horizon } });
      toast.success(`Prediction #${r.id} chained (seq ${r.chainSeq}). Your P ${pct(r.probability)} vs mixture ${pct(r.mixtureP)} over ${r.horizon} rounds (~${r.etaMinutes} min).`);
      qc.invalidateQueries({ queryKey: ["v65"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="Predict" subtitle="Platform Book F-21/F-22. The forecast cone projects the next rounds' p25–p75 fan from the stored distribution. Draw a level, state how likely you think it is to be hit, and it is scored by log-score against the platform mixture — stored and hash-chained the moment you submit." />
      <MetricGrid>
        <StatTile label="Cone from forecast" value={cone.data?.forecastId ? `#${cone.data.forecastId}` : "live"} sub={`cadence ${((cone.data?.cadenceMs ?? 0) / 1000).toFixed(1)} s`} pulse />
        <StatTile label="Measured 50% coverage" value={pct(cone.data?.coverage.p25p75)} sub={`n=${cone.data?.coverage.n ?? 0} stored forecasts`} tone={Math.abs((cone.data?.coverage.p25p75 ?? 0.5) - 0.5) < 0.05 ? "good" : "warn"} />
        <StatTile label="Below p90" value={pct(cone.data?.coverage.belowP90)} sub="target 90%" />
        <StatTile label="ETA markers" value={cone.data?.etaMarkers.map((m) => `${m.threshold}×: ${m.rounds}r`).join(" · ") ?? "—"} sub="KM median rounds" tone="signal" />
      </MetricGrid>
      <Panel title="Rounds with forecast cone (1 bar = 1 round)">
        {candles.length ? <TvChart candles={candles} projection={projection} projectionLabel="cone" storageKey="predict" height={380} defaultKind="bars" defaultLog /> : <Loading rows={6} />}
      </Panel>
      <div className="grid gap-4 lg:grid-cols-5">
        <Panel title="Make a prediction" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Level (×)"><input className={inputCls} type="number" min={1.01} step={0.5} value={level} onChange={(e) => setLevel(Number(e.target.value))} /></Field>
            <Field label="Within rounds"><input className={inputCls} type="number" min={1} max={500} value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} /></Field>
            <Field label="Your probability % (blank = mixture)"><input className={inputCls} type="number" min={0.1} max={99.9} value={prob} onChange={(e) => setProb(e.target.value)} /></Field>
            <Field label="Display name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="guest" /></Field>
          </div>
          <button type="button" className={`${btnCls} mt-3`} onClick={submit}>Submit & chain</button>
          <Note>Skill is your log-score minus the mixture's. Ranking needs a minimum sample; with many players, some will look skilled by chance — the board shows how many to expect.</Note>
        </Panel>
        <Panel title="Leaderboard" className="lg:col-span-3" right={<select className={inputCls} value={period} onChange={(e) => setPeriod(e.target.value)}><option value="all">all time</option><option value="weekly">weekly</option><option value="daily">daily</option></select>}>
          {lb.data ? (
            <>
              <p className="mb-2 text-[12px] text-muted-foreground">{lb.data.rankedUsers} ranked · {lb.data.positiveSkillUsers} with positive skill{lb.data.expectedByChance != null ? ` · ~${lb.data.expectedByChance} expected by chance` : ""} · min n {lb.data.minN}</p>
              <DataTable rows={lb.data.users as unknown as Record<string, unknown>[]} empty="No resolved predictions yet — they resolve as new rounds arrive." cols={[{ key: "name", label: "player" }, { key: "n", label: "n" }, { key: "skill", label: "skill" }, { key: "ranked", label: "", render: (r) => <Verdict ok={r.ranked as boolean}>{r.ranked ? "ranked" : "provisional"}</Verdict> }]} />
            </>
          ) : <Loading />}
          <p className="mb-1 mt-4 text-[11px] uppercase tracking-wider text-muted-foreground">Recent predictions</p>
          <DataTable rows={preds.data?.rows ?? []} max={240} cols={[{ key: "id", label: "#" }, { key: "display_name", label: "by" }, { key: "level", label: "level" }, { key: "horizon", label: "rounds" }, { key: "probability", label: "P", render: (r) => pct(r.probability as number) }, { key: "mixture_p", label: "mix P", render: (r) => pct(r.mixture_p as number) }, { key: "actual", label: "outcome", render: (r) => (r.void ? <Verdict tone="warn">void</Verdict> : r.actual == null ? <Verdict>open</Verdict> : <Verdict ok={r.actual === 1}>{r.actual === 1 ? "hit" : "miss"}</Verdict>) }]} />
        </Panel>
      </div>
    </div>
  );
}
