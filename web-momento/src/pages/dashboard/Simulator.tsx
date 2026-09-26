// F-32 Bankroll Simulator (bootstrap Monte Carlo + closed-form check) · F-33 Session Coach
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { MetricGrid, PageHeader, Panel, StatTile } from "@/components/bits";
import { Field, MiniLines, Note, Verdict, btnCls, inputCls, pct, useV1 } from "@/components/v65/kit";

type Sim = { strategy: Record<string, unknown>; bankroll: number; sessions: number; paths: number; fan: { t: number; p5: number; p25: number; p50: number; p75: number; p95: number }[]; final: { p5: number; p50: number; p95: number; mean: number }; ruin: number; drawdown: { p50: number; p95: number }; takeProfitHits: number; stopLossHits: number; evPerBet: number; pHit: number; closedForm: { expectedFinal: number; mcMean: number; mcError: number; agrees: boolean } };
type Coach = { guard: string; lines: { tone: string; text: string }[]; capUsed: number; sessionMinutes: number };

export default function Simulator() {
  const [s, setS] = useState({ cashout: 2, stakeMode: "flat", stake: 1, stopLoss: "", takeProfit: "", roundsPerSession: 60, bankroll: 100, sessions: 20 });
  const [res, setRes] = useState<Sim | null>(null);
  const [busy, setBusy] = useState(false);
  const [cap, setCap] = useState(50);
  const [spent, setSpent] = useState(0);
  const [startedMin, setStartedMin] = useState(30);
  const coach = useV1<Coach>(`coach?cap=${cap}&spent=${spent}&started=${Date.now() - startedMin * 60_000 - (Date.now() % 60_000)}`, { refetch: 30_000 });
  const run = async () => {
    setBusy(true);
    try { setRes(await api.post<Sim>("/api/v1/simulate", { strategy: s, bankroll: s.bankroll, sessions: s.sessions, paths: 600 })); } catch (e) { toast.error(String(e)); } finally { setBusy(false); }
  };
  const set = (k: string, v: string | number) => setS({ ...s, [k]: v });
  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="Bankroll Simulator" subtitle="Platform Book F-32/F-33. Resamples the real tape to show the spread of outcomes a strategy produces, and cross-checks the Monte Carlo mean against the closed-form expectation. With a house edge, every fixed strategy has negative expected value — the simulator shows how fast." />
      <div className="grid gap-4 lg:grid-cols-5">
        <Panel title="Strategy" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cash out ×"><input className={inputCls} type="number" step={0.1} min={1.01} value={s.cashout} onChange={(e) => set("cashout", Number(e.target.value))} /></Field>
            <Field label="Stake mode"><select className={inputCls} value={s.stakeMode} onChange={(e) => set("stakeMode", e.target.value)}><option value="flat">flat</option><option value="fraction">fraction of bankroll</option></select></Field>
            <Field label={s.stakeMode === "flat" ? "Stake" : "Fraction (0–1)"}><input className={inputCls} type="number" step={0.01} value={s.stake} onChange={(e) => set("stake", Number(e.target.value))} /></Field>
            <Field label="Rounds / session"><input className={inputCls} type="number" value={s.roundsPerSession} onChange={(e) => set("roundsPerSession", Number(e.target.value))} /></Field>
            <Field label="Stop-loss (per session)"><input className={inputCls} type="number" value={s.stopLoss} onChange={(e) => set("stopLoss", e.target.value)} /></Field>
            <Field label="Take-profit (per session)"><input className={inputCls} type="number" value={s.takeProfit} onChange={(e) => set("takeProfit", e.target.value)} /></Field>
            <Field label="Bankroll"><input className={inputCls} type="number" value={s.bankroll} onChange={(e) => set("bankroll", Number(e.target.value))} /></Field>
            <Field label="Sessions"><input className={inputCls} type="number" value={s.sessions} onChange={(e) => set("sessions", Number(e.target.value))} /></Field>
          </div>
          <button type="button" className={`${btnCls} mt-3`} disabled={busy} onClick={run}>{busy ? "Simulating…" : "Run 600 paths"}</button>
        </Panel>
        <Panel title="Outcome fan (bankroll percentiles over bets)" className="lg:col-span-3">
          {res ? (
            <MiniLines series={[{ name: "p95", color: "#10b981", dashed: true, points: res.fan.map((f) => [f.t, f.p95]) }, { name: "p75", color: "#06B6D4", points: res.fan.map((f) => [f.t, f.p75]) }, { name: "median", color: "#FFD54F", points: res.fan.map((f) => [f.t, f.p50]) }, { name: "p25", color: "#06B6D4", points: res.fan.map((f) => [f.t, f.p25]) }, { name: "p5", color: "#f43f5e", dashed: true, points: res.fan.map((f) => [f.t, f.p5]) }]} height={240} />
          ) : <p className="py-16 text-center text-[12.5px] text-muted-foreground">Set a strategy and run it.</p>}
        </Panel>
      </div>
      {res && (
        <MetricGrid>
          <StatTile label="Median final" value={res.final.p50} sub={`p5 ${res.final.p5} · p95 ${res.final.p95} · start ${res.bankroll}`} tone={res.final.p50 >= res.bankroll ? "good" : "bad"} pulse />
          <StatTile label="Risk of ruin" value={pct(res.ruin)} sub={`drawdown median ${pct(res.drawdown.p50, 0)} · p95 ${pct(res.drawdown.p95, 0)}`} tone={res.ruin > 0.05 ? "bad" : "warn"} />
          <StatTile label="EV per bet" value={res.evPerBet.toFixed(4)} sub={`P(hit) ${pct(res.pHit)}`} tone={res.evPerBet < 0 ? "bad" : "good"} />
          <StatTile label="Closed-form check" value={res.closedForm.agrees ? "AGREES" : "DIFFERS"} sub={`E ${res.closedForm.expectedFinal} vs MC ${res.closedForm.mcMean} ± ${res.closedForm.mcError}`} tone={res.closedForm.agrees ? "good" : "warn"} />
        </MetricGrid>
      )}
      <Panel title="Session Coach" right={coach.data ? <Verdict ok={coach.data.guard === "ok"} tone={coach.data.guard === "ok" ? "good" : coach.data.guard === "stop" ? "bad" : "warn"}>{coach.data.guard}</Verdict> : null}>
        <div className="mb-3 flex flex-wrap gap-3">
          <Field label="Loss cap"><input className={`${inputCls} w-28`} type="number" value={cap} onChange={(e) => setCap(Number(e.target.value))} /></Field>
          <Field label="Spent so far"><input className={`${inputCls} w-28`} type="number" value={spent} onChange={(e) => setSpent(Number(e.target.value))} /></Field>
          <Field label="Minutes played"><input className={`${inputCls} w-28`} type="number" value={startedMin} onChange={(e) => setStartedMin(Number(e.target.value))} /></Field>
        </div>
        <ul className="space-y-1.5">{coach.data?.lines.map((l, i) => <li key={i} className={`text-[13px] ${l.tone === "warn" ? "text-amber-400" : l.tone === "stop" ? "text-rose-400" : ""}`}>• {l.text}</li>)}</ul>
        <Note>The coach never tells you a round is "due". It reminds you of the limits you set and what the tape says about streaks.</Note>
      </Panel>
    </div>
  );
}
