// F-08 narrated replay · F-24 replay mode
import { useEffect, useMemo, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { Loading, PageHeader, Panel } from "@/components/bits";
import { Note, Verdict, btnGhost, inputCls, useV1 } from "@/components/v65/kit";
import { hueColor } from "@/lib/v64";

type Frame = { id: number; ts: string; tsMs: number; multiplier: number; origin: string; forecast: { id: number; expected: number; lo: number; hi: number; state: string; origin: string } | null; caption: string };
type Rep = { from: number; to: number; frames: Frame[]; storedForecasts: number; note: string };

export default function Replay() {
  const [mins, setMins] = useState(30);
  const [end, setEnd] = useState<string>("");
  const toMs = end ? Date.parse(end) : undefined;
  const q = useV1<Rep>(`replay?minutes=${mins}${toMs ? `&to=${toMs}&from=${toMs - mins * 60_000}` : ""}`);
  const frames = q.data?.frames ?? [];
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  useEffect(() => { setI(0); setPlaying(false); }, [q.data]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setI((x) => (x + 1 < frames.length ? x + 1 : (setPlaying(false), x))), 3000 / speed);
    return () => clearInterval(id);
  }, [playing, speed, frames.length]);
  const shown = useMemo(() => frames.slice(Math.max(0, i - 59), i + 1), [frames, i]);
  const f = frames[i];
  const max = Math.max(2, ...shown.map((x) => x.multiplier));
  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="Replay" subtitle="Platform Book F-08/F-24. Play the tape back round by round with the forecast that was actually stored at the time and a plain-language caption for each round." actions={<><select className={inputCls} value={mins} onChange={(e) => setMins(Number(e.target.value))}>{[10, 30, 60, 120].map((m) => <option key={m} value={m}>{m} min</option>)}</select><input className={inputCls} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} title="window end (blank = latest)" /></>} />
      {q.isLoading ? <Loading rows={6} /> : !frames.length ? <Note>No rounds in this window.</Note> : (
        <>
          <Panel>
            <div className="flex items-end gap-[2px]" style={{ height: 200 }}>
              {shown.map((x) => <div key={x.id} className="flex-1 rounded-t-sm" title={`${x.multiplier}×`} style={{ height: `${Math.max(3, (Math.log(x.multiplier) / Math.log(max)) * 100)}%`, background: hueColor(x.multiplier), opacity: x.id === f?.id ? 1 : 0.6, outline: x.origin === "reconstructed" ? "1px dashed #f59e0b" : undefined }} />)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" className={btnGhost} onClick={() => setI(Math.max(0, i - 1))}><SkipBack className="h-4 w-4" /></button>
              <button type="button" className={btnGhost} onClick={() => setPlaying(!playing)}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{playing ? "Pause" : "Play"}</button>
              <button type="button" className={btnGhost} onClick={() => setI(Math.min(frames.length - 1, i + 1))}><SkipForward className="h-4 w-4" /></button>
              <select className={inputCls} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>{[1, 2, 4, 8, 16].map((s) => <option key={s} value={s}>{s}×</option>)}</select>
              <input type="range" className="flex-1" min={0} max={frames.length - 1} value={i} onChange={(e) => setI(Number(e.target.value))} />
              <span className="font-data text-[12px] text-muted-foreground">{i + 1}/{frames.length}</span>
            </div>
          </Panel>
          {f && (
            <Panel title={`${new Date(f.ts).toLocaleString()} · round ${f.id}`}>
              <p className="text-[26px] font-semibold font-data" style={{ color: hueColor(f.multiplier) }}>{f.multiplier.toFixed(2)}× {f.origin === "reconstructed" && <Verdict tone="warn">reconstructed</Verdict>}</p>
              <p className="mt-2 text-[14px] leading-relaxed">{f.caption}</p>
              {f.forecast && <p className="mt-2 text-[12px] text-muted-foreground">Stored forecast #{f.forecast.id} ({f.forecast.origin}): {f.forecast.expected}× · range {f.forecast.lo}–{f.forecast.hi}× · {f.forecast.state}</p>}
            </Panel>
          )}
          <Note>{q.data?.note}</Note>
        </>
      )}
    </div>
  );
}
