// F-37 Ask Momento: client-side BM25 retrieval over the bundled docs + Platform Book, then a cited answer (refuses without citations)
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { api } from "@/lib/api";
import { DOC_CONTENT } from "@/lib/docs";
import { PageHeader, Panel } from "@/components/bits";
import { Note, Verdict, btnCls, inputCls } from "@/components/v65/kit";

type Passage = { id: string; slug: string; title: string; text: string };
const tok = (s: string) => s.toLowerCase().replace(/[^a-z0-9×.]+/g, " ").split(" ").filter((w) => w.length > 1);

function buildIndex(): { passages: Passage[]; df: Map<string, number>; avg: number; tfs: Map<string, number>[] } {
  const passages: Passage[] = [];
  for (const [slug, md] of Object.entries(DOC_CONTENT)) {
    let title = slug, buf: string[] = [], n = 0;
    const flush = () => { const text = buf.join("\n").trim(); if (text.length > 80) passages.push({ id: `${slug}#${n++}`, slug, title, text: text.slice(0, 1800) }); buf = []; };
    for (const line of md.split("\n")) {
      if (/^#{1,3}\s/.test(line)) { flush(); title = `${slug} › ${line.replace(/^#+\s*/, "")}`; }
      else buf.push(line);
      if (buf.join("\n").length > 1600) flush();
    }
    flush();
  }
  const df = new Map<string, number>();
  const tfs = passages.map((p) => { const m = new Map<string, number>(); for (const w of tok(p.title + " " + p.text)) m.set(w, (m.get(w) ?? 0) + 1); for (const w of m.keys()) df.set(w, (df.get(w) ?? 0) + 1); return m; });
  const avg = tfs.reduce((a, m) => a + [...m.values()].reduce((x, y) => x + y, 0), 0) / (tfs.length || 1);
  return { passages, df, avg, tfs };
}

export default function Ask() {
  const idx = useMemo(buildIndex, []);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<(Passage & { score: number })[]>([]);
  const [ans, setAns] = useState<{ answer: string; refused: boolean; citations: string[]; model?: string; reason?: string; grounding?: "docs" | "data" | "general" | "none" } | null>(null);
  const [busy, setBusy] = useState(false);
  const search = (text: string) => {
    const terms = [...new Set(tok(text))];
    const N = idx.passages.length, k1 = 1.4, b = 0.75;
    return idx.passages.map((p, i) => {
      const tf = idx.tfs[i]; const len = [...tf.values()].reduce((x, y) => x + y, 0);
      let s = 0;
      for (const t of terms) { const f = tf.get(t) ?? 0; if (!f) continue; const d = idx.df.get(t) ?? 0; s += Math.log(1 + (N - d + 0.5) / (d + 0.5)) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len) / idx.avg))); }
      return { ...p, score: s };
    }).filter((p) => p.score > 0).sort((a, b2) => b2.score - a.score).slice(0, 6);
  };
  const ask = async () => {
    if (!q.trim()) return;
    const top = search(q);
    setHits(top); setAns(null); setBusy(true);
    try { setAns(await api.post("/api/v1/knowledge/ask", { q, passages: top.map((p) => ({ id: p.id, title: p.title, text: p.text })) })); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="animate-in-up space-y-4">
      <PageHeader title="Ask Momento" subtitle={`Platform Book F-37. Answers are grounded in ${idx.passages.length.toLocaleString()} documentation passages (cited by id) and a live data snapshot (cited as [data]); methodology answers from general knowledge are labelled. If nothing supports an answer, it refuses.`} />
      <Panel>
        <div className="flex gap-2">
          <input className={`${inputCls} flex-1`} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="e.g. How is the track record made tamper-evident?" />
          <button type="button" className={btnCls} disabled={busy} onClick={ask}><Send className="h-4 w-4" />{busy ? "Thinking…" : "Ask"}</button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">{["What is the house edge?", "How does the ETA board decide a gap is long?", "What does shadow mode mean for an engine?", "Why are reconstructed rounds never scored?", "What's the current intelligence state?", "How do I test a new strategy?", "What patterns should I watch for?"].map((s) => <button key={s} type="button" className="rounded-md border border-border px-2 py-1 text-[11.5px] text-muted-foreground hover:text-foreground" onClick={() => setQ(s)}>{s}</button>)}</div>
      </Panel>
      {ans && (
        <Panel title="Answer" right={<Verdict ok={!ans.refused && ans.grounding !== "general"}>{ans.refused ? "refused — not in sources" : ans.grounding === "data" ? "live data" : ans.grounding === "general" ? "general knowledge — verify" : `${ans.citations.length} citation(s)`}</Verdict>}>
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{ans.answer}</p>
          {ans.model && <p className="mt-2 text-[11px] text-muted-foreground">model {ans.model}</p>}
        </Panel>
      )}
      {hits.length > 0 && (
        <Panel title="Retrieved passages (BM25)">
          <div className="space-y-3">{hits.map((h) => (
            <div key={h.id} className={`rounded-md border p-3 ${ans?.citations.includes(h.id) ? "border-primary/60" : "border-border/60"}`}>
              <div className="flex items-center justify-between text-[12px]"><Link className="font-medium text-primary underline" to={`/dashboard/docs/${h.slug}`}>{h.title}</Link><span className="font-data text-muted-foreground">[{h.id}] · {h.score.toFixed(2)}</span></div>
              <p className="mt-1 line-clamp-4 text-[12px] text-muted-foreground">{h.text}</p>
            </div>
          ))}</div>
        </Panel>
      )}
      <Note>Retrieval runs in your browser; only the question and the top passages are sent to the model. Answers are only as good as the docs — cited passages are highlighted.</Note>
    </div>
  );
}
