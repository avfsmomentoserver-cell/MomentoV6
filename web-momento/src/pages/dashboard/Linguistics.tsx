// Linguistics v2 — the round stream read as language.
// Every round is a word (dust … legend); a pink round (≥10×) ends a sentence.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpenText, Quote } from "lucide-react";
import { api, qs } from "@/lib/api";
import { fmtInt, fmtPct } from "@/lib/format";
import { AV } from "@/lib/v64";
import { PageHeader, Panel, StatTile } from "@/components/bits";
import { TrendLine } from "@/components/charts";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface Ling {
  analysed: number;
  lexicon: { word: string; gloss: string; lo: number; hi: number; count: number; share: number; hue: string }[];
  entropyBits: number;
  maxEntropyBits: number;
  entropyTrend: { index: number; bits: number }[];
  typeTokenRatio: number;
  stream: { id: number; word: string; hue: string; multiplier: number; ts: string; tempo: string; origin: string }[];
  sentences: { count: number; meanLength: number; expectedLength: number; current: { words: string[]; length: number }; recent: { words: string[]; length: number; closer: string; closedAt: string }[]; lengthHist?: { length: number; count: number; expected: number }[] };
  phrases: { phrase: string; n: number; count: number; expected: number; lift: number; z: number }[];
  underPhrases: { phrase: string; n: number; count: number; expected: number; lift: number; z: number }[];
  nextWord: { context: string; order: number; support: number; dist: { word: string; p: number; base: number }[]; pGe2?: number; baseGe2?: number };
  narrative: string;
}

const HUE: Record<string, string> = { blue: AV.blue, purple: AV.purple, pink: AV.pink };
const WORD_TONE: Record<string, number> = { dust: 0.35, low: 0.5, soft: 0.7, lift: 0.55, climb: 0.7, rise: 0.85, surge: 0.8, blast: 0.9, moon: 1, legend: 1 };

export function Word({ w, hue, faded, big }: { w: string; hue: string; faded?: boolean; big?: boolean }) {
  return (
    <span
      className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 font-medium", big ? "text-[14px]" : "text-[11.5px]", faded && "opacity-50 italic")}
      style={{ color: HUE[hue], background: (HUE[hue] ?? AV.blue).replace("rgb", "rgba").replace(")", `, ${0.08 + (WORD_TONE[w] ?? 0.5) * 0.16})`) }}
    >
      {w}
    </span>
  );
}

export default function Linguistics() {
  const [depth, setDepth] = useState("120");
  const [source, setSource] = useState("all");
  const [lastN, setLastN] = useState("");
  const sources = useQuery({ queryKey: ["sources"], queryFn: () => api.get<{ sources: { name: string; rounds: number }[] }>("/api/v1/sources") });
  const q = useQuery({
    queryKey: ["linguistics", "v2", depth, source, lastN],
    queryFn: () => api.get<Ling>(`/api/v1/linguistics/v2${qs({ depth, source: source === "all" ? undefined : source, lastN: lastN || undefined })}`),
    placeholderData: (p) => p,
  });
  const d = q.data;
  const hueOfWord = (w: string) => d?.lexicon.find((x) => x.word === w)?.hue ?? "blue";
  const maxShare = Math.max(0.0001, ...(d?.lexicon ?? []).map((l) => l.share));
  const sentencePct = d ? Math.min(1, d.sentences.current.length / Math.max(1, d.sentences.expectedLength * 2)) : 0;

  return (
    <div className="animate-in-up space-y-4">
      <PageHeader
        title="Linguistics"
        subtitle="The round stream as language: ten words from dust (instant crash) to legend (1000×+), sentences that end at a pink round, phrase statistics against their expected counts, and a back-off next-word model."
        actions={
          <div className="flex items-center gap-2">
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {(sources.data?.sources ?? []).map((s) => <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input className="h-8 w-28 text-xs" placeholder="last N rounds" value={lastN} onChange={(e) => setLastN(e.target.value)} />
            <Select value={depth} onValueChange={setDepth}>
              <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{["60", "120", "240", "500"].map((v) => <SelectItem key={v} value={v}>stream {v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        }
      />
      {!d ? (
        <p className="py-16 text-center text-[12px] text-muted-foreground">Reading the stream…</p>
      ) : (
        <>
          <div className="rounded-xl border border-violet-400/30 bg-gradient-to-r from-violet-500/10 via-card/60 to-card/60 p-4">
            <div className="flex gap-3">
              <Quote className="mt-0.5 h-5 w-5 shrink-0 text-violet-300" />
              <p className="text-[14px] leading-relaxed">{d.narrative}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile label="Words read" value={fmtInt(d.analysed)} sub={`${d.sentences.count} sentences`} tone="signal" />
            <StatTile label="Current sentence" value={`${d.sentences.current.length} words`} sub={`expected ${d.sentences.expectedLength} (geometric)`} tone={d.sentences.current.length > d.sentences.expectedLength * 2 ? "warn" : "default"} />
            <StatTile label="Mean sentence" value={d.sentences.meanLength.toFixed(2)} sub={`vs ${d.sentences.expectedLength} expected`} />
            <StatTile label="Vocabulary entropy" value={`${d.entropyBits.toFixed(2)} bits`} sub={`of ${d.maxEntropyBits.toFixed(2)} max · ${fmtPct(d.entropyBits / d.maxEntropyBits, 0)}`} />
            <StatTile label="Next-word context" value={`“${d.nextWord.context}”`} sub={`order ${d.nextWord.order} · n ${d.nextWord.support}`} />
          </div>

          <Panel title="The sentence being spoken now" right={<BookOpenText className="h-4 w-4 text-violet-300" />}>
            <div className="flex flex-wrap items-center gap-1.5">
              {d.sentences.current.words.map((w, i) => <Word key={i} w={w} hue={hueOfWord(w)} big />)}
              <span className="ml-1 animate-pulse text-[16px] text-violet-300">▍</span>
            </div>
            <div className="mt-3">
              <div className="flex justify-between text-[10.5px] text-muted-foreground"><span>sentence length</span><span>expected {d.sentences.expectedLength} · 2× expected at right edge</span></div>
              <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full" style={{ width: `${sentencePct * 100}%`, background: `linear-gradient(90deg, ${AV.blue}, ${AV.purple}, ${AV.pink})` }} />
                <div className="absolute top-0 h-full w-px bg-white/60" style={{ left: "50%" }} />
              </div>
            </div>
            <div className="mt-4 space-y-1.5">
              <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Recent sentences (each closed by a pink word)</p>
              {d.sentences.recent.slice(0, 6).map((s, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1 border-l-2 pl-2" style={{ borderColor: AV.pink }}>
                  {s.words.map((w, j) => <Word key={j} w={w} hue={hueOfWord(w)} />)}
                  <span className="ml-1 font-data text-[10px] text-muted-foreground">· {s.length} words · {new Date(s.closedAt).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </Panel>

          <div className="grid gap-3 xl:grid-cols-3">
            <Panel title="Lexicon — ten words across the multiplier scale" className="xl:col-span-2">
              <div className="space-y-1.5">
                {d.lexicon.map((l) => (
                  <div key={l.word} className="grid grid-cols-[80px_1fr_140px] items-center gap-3">
                    <Word w={l.word} hue={l.hue} />
                    <div className="h-4 overflow-hidden rounded bg-muted/50">
                      <div className="h-full rounded" style={{ width: `${(l.share / maxShare) * 100}%`, background: (HUE[l.hue] ?? AV.blue).replace("rgb", "rgba").replace(")", ", 0.65)") }} />
                    </div>
                    <div className="text-right font-data text-[11px]">
                      {fmtPct(l.share, 1)} <span className="text-muted-foreground">· {l.lo}–{l.hi >= 1e6 ? "∞" : l.hi}× · {l.gloss}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title={`Next word after “${d.nextWord.context}”`}>
              <div className="space-y-1">
                {d.nextWord.dist.map((x) => (
                  <div key={x.word} className="grid grid-cols-[64px_1fr_76px] items-center gap-2">
                    <Word w={x.word} hue={hueOfWord(x.word)} />
                    <div className="relative h-3 rounded bg-muted/40">
                      <div className="absolute h-full rounded bg-violet-400/70" style={{ width: `${Math.min(100, x.p * 250)}%` }} />
                      <div className="absolute top-[-2px] h-[calc(100%+4px)] w-0.5 bg-white/70" style={{ left: `${Math.min(100, x.base * 250)}%` }} title="base rate" />
                    </div>
                    <span className={cn("text-right font-data text-[11px]", x.p > x.base ? "text-emerald-300" : "text-muted-foreground")}>{fmtPct(x.p, 1)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10.5px] text-muted-foreground">Bar = conditional probability; white tick = base rate. Order {d.nextWord.order} back-off, support {d.nextWord.support}.</p>
            </Panel>
          </div>

          <Panel title={`Word stream — last ${d.stream.length} rounds (tempo: italic = quick, bold = slow)`}>
            <div className="flex flex-wrap gap-1">
              {d.stream.map((w) => (
                <span key={w.id} title={`#${w.id} · ${w.multiplier}× · ${new Date(w.ts).toLocaleTimeString()} · ${w.tempo}${w.origin !== "observed" ? ` · ${w.origin}` : ""}`} className={cn(w.tempo === "slow" && "font-bold", w.tempo === "quick" && "italic")}>
                  <Word w={w.word} hue={w.hue} faded={w.origin === "reconstructed"} />
                  {w.hue === "pink" && <span className="mx-0.5 text-[13px]" style={{ color: AV.pink }}>.</span>}
                </span>
              ))}
            </div>
          </Panel>

          <div className="grid gap-3 xl:grid-cols-3">
            <Panel title="Phrasebook — over-used phrases">
              <PhraseList rows={d.phrases} hueOfWord={hueOfWord} />
            </Panel>
            <Panel title="Avoided phrases — under-used">
              <PhraseList rows={d.underPhrases} hueOfWord={hueOfWord} />
            </Panel>
            <Panel title="Entropy over history (bits per word)">
              <TrendLine data={d.entropyTrend.map((e) => ({ x: e.index, y: e.bits }))} height={230} />
              <p className="mt-1 text-[10.5px] text-muted-foreground">Rolling vocabulary entropy. A fair RNG sits flat near its long-run value; dips mean a repetitive stretch.</p>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function PhraseList({ rows, hueOfWord }: { rows: Ling["phrases"]; hueOfWord: (w: string) => string }) {
  return (
    <div className="max-h-[300px] space-y-1.5 overflow-y-auto pr-1">
      {rows.map((p) => (
        <div key={p.phrase} className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
          <div className="flex flex-wrap gap-1">{p.phrase.split(" ").map((w, i) => <Word key={i} w={w} hue={hueOfWord(w)} />)}</div>
          <p className="mt-1 font-data text-[10.5px] text-muted-foreground">
            seen {p.count} vs {p.expected} expected · lift <span className={p.lift > 1 ? "text-emerald-300" : "text-rose-300"}>{p.lift}×</span> · z <span className={Math.abs(p.z) >= 3 ? "text-amber-300" : ""}>{p.z}</span>
          </p>
        </div>
      ))}
      {!rows.length && <p className="text-[12px] text-muted-foreground">None.</p>}
    </div>
  );
}
