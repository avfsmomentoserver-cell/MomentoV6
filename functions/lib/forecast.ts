// functions/lib/forecast.ts — Momento Lib: probabilistic next-event forecaster.
//
// One pure, dependency-free module. Rounds in, a full next-round probability
// distribution and next-event probabilities out. Built for accuracy on proper
// scores (log loss / Brier), not for a point "prediction":
//
//   * every model emits a distribution over 11 fine bins (edges below), so
//     P(M >= x) is always coherent (monotone, in [0, 1]) for every threshold;
//   * eight model families run online, strictly causal (a model only ever sees
//     rounds before the one it forecasts);
//   * a fixed-share Bayesian mixture learns the ensemble weights on log loss,
//     so the blend tracks the best model and is never worse than it (or the
//     base rate) by more than about log K nats in total;
//   * next-event layer: P(event within k rounds), expected wait, rounds since.
//
// Pure module: no I/O, no Date.now(), deterministic.

export interface LibRound {
  multiplier: number;
  tsMs?: number;
}

/** Fine bin edges. Bin i = [EDGES[i-1], EDGES[i]); bin 0 = below 1.01 (instant crash). */
export const LIB_EDGES = [1.01, 1.2, 1.5, 2, 3, 5, 10, 20, 50, 100] as const;
export const LIB_BINS = LIB_EDGES.length + 1; // 11
export const LIB_BIN_LABELS = ["<1.01x", "1.01–1.2x", "1.2–1.5x", "1.5–2x", "2–3x", "3–5x", "5–10x", "10–20x", "20–50x", "50–100x", "100x+"];
/** Thresholds reported as P(M >= x). Each is a bin edge, so the survival is exact. */
export const LIB_THRESHOLDS = [1.2, 1.5, 2, 3, 5, 10, 20, 50, 100] as const;
/** Platform (v6) six-band partition, for compatibility with bandLogLoss in intelligence.ts. */
export const V6_BAND_EDGES = [1.5, 2, 5, 10, 100];

export function libBin(m: number): number {
  let i = 0;
  while (i < LIB_EDGES.length && m >= LIB_EDGES[i]) i++;
  return i;
}

const EPS = 1e-9;
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const normalize = (p: number[]): number[] => {
  let s = 0;
  for (const v of p) s += v;
  return p.map((v) => (s > 0 ? v / s : 1 / p.length));
};

/** Survival S(x) = P(M >= x) from a bin distribution (x must be a bin edge for exactness). */
export function survivalAt(dist: number[], x: number): number {
  const k = LIB_EDGES.findIndex((e) => Math.abs(e - x) < 1e-9);
  if (k >= 0) {
    let s = 0;
    for (let i = k + 1; i < LIB_BINS; i++) s += dist[i];
    return s;
  }
  // between edges: log-linear (1/x-shaped) interpolation inside the bin
  const b = libBin(x);
  let above = 0;
  for (let i = b + 1; i < LIB_BINS; i++) above += dist[i];
  const lo = b === 0 ? 1 : LIB_EDGES[b - 1];
  const hi = b < LIB_EDGES.length ? LIB_EDGES[b] : Infinity;
  if (!isFinite(hi)) return dist[b] * clamp(lo / x, 0, 1);
  const frac = (1 / x - 1 / hi) / (1 / lo - 1 / hi); // share of the bin at or above x under a 1/x law
  return above + dist[b] * clamp(frac, 0, 1);
}

/** Quantile q of M from the bin distribution (1/x-shaped interpolation inside bins). */
export function quantileOf(dist: number[], q: number): number {
  let c = 0;
  for (let i = 0; i < LIB_BINS; i++) {
    const next = c + dist[i];
    if (next >= q || i === LIB_BINS - 1) {
      const lo = i === 0 ? 1 : LIB_EDGES[i - 1];
      const hi = i < LIB_EDGES.length ? LIB_EDGES[i] : 1000;
      const f = dist[i] > 0 ? clamp((q - c) / dist[i], 0, 1) : 0;
      // inverse of the 1/x law on [lo, hi)
      const inv = 1 / lo - f * (1 / lo - 1 / hi);
      return Math.round((1 / inv) * 100) / 100;
    }
    c = next;
  }
  return LIB_EDGES[LIB_EDGES.length - 1];
}

// ---------------------------------------------------------------- fair law

/** Two-edge fair law (MV6-6): a point mass h0 below 1.01 and S(x) = c / x above. */
export function twoEdgeLaw(h0: number, c: number): number[] {
  const S = (x: number) => Math.min(1 - h0, c / x);
  const cuts = [1, ...LIB_EDGES];
  const p: number[] = [];
  p.push(h0);
  for (let i = 1; i < LIB_BINS; i++) {
    const lo = cuts[i];
    const hi = i < cuts.length - 1 ? cuts[i + 1] : Infinity;
    p.push(Math.max(EPS, S(lo) - (isFinite(hi) ? S(hi) : 0)));
  }
  return normalize(p);
}

/** MLE fit of (h0, c) to bin counts. */
export function fitTwoEdge(counts: number[]): { h0: number; c: number; dist: number[] } {
  const n = counts.reduce((a, b) => a + b, 0);
  const h0 = clamp((counts[0] + 1) / (n + 25), 0.001, 0.2);
  let best = { c: 0.97, ll: -Infinity };
  for (let c = 0.9; c <= 1.0000001; c += 0.0005) {
    const d = twoEdgeLaw(h0, c);
    let ll = 0;
    for (let i = 0; i < LIB_BINS; i++) ll += counts[i] * Math.log(d[i]);
    if (ll > best.ll) best = { c, ll };
  }
  return { h0, c: best.c, dist: twoEdgeLaw(h0, best.c) };
}

export const DEFAULT_LAW = twoEdgeLaw(0.039, 0.97);

// ---------------------------------------------------------------- models

interface Model {
  key: string;
  label: string;
  predict(ctx: Ctx): number[];
  update(ctx: Ctx, bin: number): void;
}

/** Causal context: everything known before the round being forecast. */
interface Ctx {
  n: number; // rounds seen
  last: number[]; // recent multipliers, newest last (<= 64)
  lastBins: number[];
  runBelow2: number; // current run of rounds < 2x
  runAbove2: number;
  sinceBin: number[]; // rounds since last round landing at or above each edge index
  lastGapSec: number; // interval between the two most recent rounds
  hour: number; // UTC hour of the most recent round (-1 unknown)
  newSession: boolean; // most recent interval > 180 s
  globalCounts: number[];
}

class GlobalEmpirical implements Model {
  key = "empirical";
  label = "Empirical base rate (all history, Dirichlet prior on the fair law)";
  predict(ctx: Ctx) {
    const a = 200;
    const n = ctx.globalCounts.reduce((x, y) => x + y, 0);
    return ctx.globalCounts.map((c, i) => (c + a * DEFAULT_LAW[i]) / (n + a));
  }
  update() {}
}

class FairLaw implements Model {
  key = "fairlaw";
  label = "Two-edge fair law fitted to history";
  private cache: number[] = DEFAULT_LAW;
  private at = -1;
  predict(ctx: Ctx) {
    if (ctx.n >= 200 && (this.at < 0 || ctx.n - this.at >= 500)) {
      this.cache = fitTwoEdge(ctx.globalCounts).dist;
      this.at = ctx.n;
    }
    return this.cache;
  }
  update() {}
}

class Ewma implements Model {
  key: string;
  label: string;
  private p: number[] = DEFAULT_LAW.slice();
  private lam: number;
  constructor(halfLife: number) {
    this.key = `ewma${halfLife}`;
    this.label = `Recency-weighted empirical (half-life ${halfLife} rounds)`;
    this.lam = Math.pow(0.5, 1 / halfLife);
  }
  predict() {
    return this.p;
  }
  update(_ctx: Ctx, bin: number) {
    for (let i = 0; i < LIB_BINS; i++) this.p[i] = this.lam * this.p[i] + (1 - this.lam) * (i === bin ? 1 : 0);
  }
}

/** Conditional frequency table on a discrete state, shrunk toward the global distribution. */
class Conditional implements Model {
  key: string;
  label: string;
  private tab = new Map<string, number[]>();
  constructor(key: string, label: string, private state: (ctx: Ctx) => string | null, private prior = 300) {
    this.key = key;
    this.label = label;
  }
  predict(ctx: Ctx) {
    const s = this.state(ctx);
    const g = normalize(ctx.globalCounts.map((c, i) => c + 50 * DEFAULT_LAW[i]));
    if (s === null) return g;
    const t = this.tab.get(s);
    if (!t) return g;
    const n = t.reduce((a, b) => a + b, 0);
    return t.map((c, i) => (c + this.prior * g[i]) / (n + this.prior));
  }
  update(ctx: Ctx, bin: number) {
    const s = this.state(ctx);
    if (s === null) return;
    let t = this.tab.get(s);
    if (!t) this.tab.set(s, (t = new Array(LIB_BINS).fill(0)));
    t[bin]++;
  }
}

const coarse = (b: number) => (b <= 1 ? 0 : b <= 3 ? 1 : b <= 5 ? 2 : b <= 6 ? 3 : 4); // <1.2, 1.2–2, 2–5, 5–10, 10+

/** Online multinomial logistic regression (softmax over 11 bins), SGD with L2. */
class Softmax implements Model {
  key = "softmax";
  label = "Online multinomial logistic model on streak, recency, timing and session features";
  private W: number[][];
  private lr: number;
  private l2 = 1e-5;
  private nf: number;
  private cached: { x: number[]; p: number[] } | null = null;
  constructor(lr = 0.01) {
    this.lr = lr;
    this.nf = Softmax.features(emptyCtx()).length;
    this.W = Array.from({ length: LIB_BINS }, (_, k) => {
      const w = new Array(this.nf).fill(0);
      w[0] = Math.log(DEFAULT_LAW[k]);
      return w;
    });
  }
  static features(ctx: Ctx): number[] {
    const L = ctx.last;
    const lg = (m: number) => Math.log(Math.max(1, m));
    const m1 = L.length ? L[L.length - 1] : 2;
    const m2 = L.length > 1 ? L[L.length - 2] : 2;
    const tail = (k: number) => L.slice(-k);
    const share2 = (k: number) => {
      const t = tail(k);
      return t.length ? t.filter((m) => m >= 2).length / t.length - 0.485 : 0;
    };
    const meanLog = (k: number) => {
      const t = tail(k);
      return t.length ? t.reduce((a, m) => a + lg(m), 0) / t.length - 0.7 : 0;
    };
    const b1 = L.length ? coarse(ctx.lastBins[ctx.lastBins.length - 1]) : -1;
    const hr = ctx.hour;
    const f = [
      1,
      clamp(lg(m1) - 0.7, -1, 4) / 2,
      clamp(lg(m2) - 0.7, -1, 4) / 2,
      m1 < 1.01 ? 1 : 0,
      b1 === 0 ? 1 : 0,
      b1 === 1 ? 1 : 0,
      b1 === 2 ? 1 : 0,
      b1 === 3 ? 1 : 0,
      b1 === 4 ? 1 : 0,
      share2(5) * 2,
      share2(20) * 3,
      meanLog(10),
      Math.min(ctx.runBelow2, 12) / 6,
      Math.min(ctx.runAbove2, 8) / 4,
      Math.log1p(ctx.sinceBin[6]) / 4 - 0.8, // since >= 10x
      Math.log1p(ctx.sinceBin[9]) / 6 - 0.8, // since >= 100x
      clamp(Math.log1p(Math.max(0, ctx.lastGapSec)) - 3, -3, 3) / 2,
      ctx.newSession ? 1 : 0,
      hr >= 0 ? Math.sin((2 * Math.PI * hr) / 24) : 0,
      hr >= 0 ? Math.cos((2 * Math.PI * hr) / 24) : 0,
    ];
    return f;
  }
  predict(ctx: Ctx) {
    const x = Softmax.features(ctx);
    const z = this.W.map((w) => {
      let s = 0;
      for (let j = 0; j < x.length; j++) s += w[j] * x[j];
      return s;
    });
    const mx = Math.max(...z);
    const e = z.map((v) => Math.exp(v - mx));
    const p = normalize(e).map((v) => Math.max(v, 1e-7));
    this.cached = { x, p };
    return p;
  }
  update(ctx: Ctx, bin: number) {
    const { x, p } = this.cached ?? { x: Softmax.features(ctx), p: this.predict(ctx) };
    const lr = this.lr / Math.sqrt(1 + ctx.n / 20000);
    for (let k = 0; k < LIB_BINS; k++) {
      const g = p[k] - (k === bin ? 1 : 0);
      const w = this.W[k];
      for (let j = 0; j < x.length; j++) w[j] -= lr * (g * x[j] + (j ? this.l2 * w[j] : 0));
    }
    this.cached = null;
  }
}

function emptyCtx(): Ctx {
  return {
    n: 0,
    last: [],
    lastBins: [],
    runBelow2: 0,
    runAbove2: 0,
    sinceBin: new Array(LIB_EDGES.length).fill(0),
    lastGapSec: 20,
    hour: -1,
    newSession: false,
    globalCounts: new Array(LIB_BINS).fill(0),
  };
}

function buildModels(): Model[] {
  return [
    new GlobalEmpirical(),
    new FairLaw(),
    new Ewma(300),
    new Ewma(2000),
    new Ewma(10000),
    new Conditional("markov1", "Markov order 1 on the previous round's band", (c) => (c.lastBins.length ? `${coarse(c.lastBins[c.lastBins.length - 1])}` : null)),
    new Conditional("markov2", "Markov order 2 on the previous two bands", (c) =>
      c.lastBins.length > 1 ? `${coarse(c.lastBins[c.lastBins.length - 2])}${coarse(c.lastBins[c.lastBins.length - 1])}` : null,
    ),
    new Conditional("streak", "Streak state (run length above / below 2x)", (c) => (c.runBelow2 ? `L${Math.min(c.runBelow2, 8)}` : `H${Math.min(c.runAbove2, 5)}`)),
    new Conditional("drought", "Drought state (rounds since the last 10x, log buckets)", (c) => `${Math.min(7, Math.floor(Math.log2(1 + c.sinceBin[6])))}`),
    new Conditional("session", "Session position and timing (new session, interval bucket)", (c) =>
      `${c.newSession ? "S" : "C"}${Math.min(5, Math.floor(Math.log2(1 + Math.max(0, c.lastGapSec) / 5)))}`,
    ),
    new Softmax(),
  ];
}

// ---------------------------------------------------------------- engine

export interface LibOptions {
  /** Learning rate of the Bayesian mixture (1 = exact Bayes). */
  eta?: number;
  /** Per-round floor on each mixture weight (fixed share), keeps adaptivity. */
  share?: number;
}

export interface NextEvent {
  threshold: number;
  /** P(next round >= threshold). */
  pNext: number;
  /** Long-run base rate P(M >= threshold). */
  pBase: number;
  /** pNext / pBase. */
  lift: number;
  /** P(at least one round >= threshold within the next k rounds). */
  within: { k: number; p: number }[];
  /** Expected rounds until the next round >= threshold (1 = next round). */
  expectedWait: number;
  /** Median rounds until the next round >= threshold. */
  medianWait: number;
  /** Rounds since the last round >= threshold. */
  roundsSince: number;
}

export interface LibForecast {
  version: "lib-1";
  rounds: number;
  /** Full next-round distribution over the 11 fine bins. */
  bins: { label: string; lo: number; hi: number | null; p: number }[];
  /** Same distribution on the platform's six v6 bands (<1.5, 1.5–2, 2–5, 5–10, 10–100, 100+). */
  v6Bands: number[];
  /** P(next >= x) for each reported threshold. */
  survival: { x: number; p: number; base: number }[];
  quantiles: { q: number; x: number }[];
  mostLikelyBin: string;
  nextEvents: NextEvent[];
  weights: { key: string; label: string; weight: number; logLoss: number }[];
  /** Rolling skill of the blend vs the base rate, nats per round (positive = better). */
  skill: { window: number; blendLogLoss: number; baseLogLoss: number; skillNats: number; se: number };
}

const WITHIN_K = [1, 3, 5, 10, 25, 50];

export class LibForecaster {
  private models = buildModels();
  private w: number[];
  private ctx = emptyCtx();
  private lastTs: number | null = null;
  private prevTs: number | null = null;
  private eta: number;
  private share: number;
  private modelLoss: number[];
  private lossHist: { blend: number; base: number }[] = [];
  private pending: number[][] | null = null;
  private mixPending: number[] | null = null;
  constructor(opts: LibOptions = {}) {
    this.eta = opts.eta ?? 1;
    this.share = opts.share ?? 0.0001;
    const K = this.models.length;
    this.w = new Array(K).fill(1 / K);
    this.modelLoss = new Array(K).fill(0);
  }

  get n() {
    return this.ctx.n;
  }

  /** Distribution for the next round (causal: uses only rounds already fed). */
  predictDist(): number[] {
    const P = this.models.map((m) => m.predict(this.ctx));
    const mix = new Array(LIB_BINS).fill(0);
    for (let k = 0; k < P.length; k++) for (let i = 0; i < LIB_BINS; i++) mix[i] += this.w[k] * P[k][i];
    this.pending = P;
    this.mixPending = normalize(mix);
    return this.mixPending;
  }

  /** Component distributions behind the last predictDist() call (same order as modelKeys). */
  componentDists(): number[][] {
    if (!this.pending) this.predictDist();
    return this.pending!;
  }

  get modelKeys(): string[] {
    return this.models.map((m) => m.key);
  }

  /** Feed the outcome of the round that was just forecast (or any next round). */
  update(r: LibRound): { logLoss: number; baseLogLoss: number } {
    if (!this.pending || !this.mixPending) this.predictDist();
    const P = this.pending!;
    const mix = this.mixPending!;
    const bin = libBin(r.multiplier);
    const pm = Math.max(mix[bin], EPS);
    // Fixed-share Bayesian mixture on log loss: w_k <- w_k * p_k(y)^eta, then
    // mix a small share back to uniform so the blend can switch if a model
    // starts to earn skill. eta = 1 is exact Bayesian model averaging: its
    // total regret to the best single model is at most log K nats.
    let s = 0;
    for (let k = 0; k < this.w.length; k++) {
      this.w[k] *= Math.pow(Math.max(P[k][bin], EPS) / pm, this.eta);
      s += this.w[k];
    }
    const K = this.w.length;
    for (let k = 0; k < K; k++) this.w[k] = (1 - this.share) * (this.w[k] / s) + this.share / K;
    for (let k = 0; k < K; k++) this.modelLoss[k] = 0.999 * this.modelLoss[k] + 0.001 * -Math.log(Math.max(P[k][bin], EPS));
    const baseP = this.models[0].predict(this.ctx)[bin];
    const ll = -Math.log(pm);
    const bl = -Math.log(Math.max(baseP, EPS));
    this.lossHist.push({ blend: ll, base: bl });
    if (this.lossHist.length > 5000) this.lossHist.shift();
    for (const m of this.models) m.update(this.ctx, bin);
    this.advance(r, bin);
    this.pending = null;
    this.mixPending = null;
    return { logLoss: ll, baseLogLoss: bl };
  }

  private advance(r: LibRound, bin: number) {
    const c = this.ctx;
    c.n++;
    c.globalCounts[bin]++;
    c.last.push(r.multiplier);
    c.lastBins.push(bin);
    if (c.last.length > 64) {
      c.last.shift();
      c.lastBins.shift();
    }
    if (r.multiplier >= 2) {
      c.runAbove2++;
      c.runBelow2 = 0;
    } else {
      c.runBelow2++;
      c.runAbove2 = 0;
    }
    for (let e = 0; e < LIB_EDGES.length; e++) c.sinceBin[e] = r.multiplier >= LIB_EDGES[e] ? 0 : c.sinceBin[e] + 1;
    if (typeof r.tsMs === "number" && isFinite(r.tsMs)) {
      this.prevTs = this.lastTs;
      this.lastTs = r.tsMs;
      c.lastGapSec = this.prevTs !== null ? (this.lastTs - this.prevTs) / 1000 : 20;
      c.newSession = c.lastGapSec > 180;
      c.hour = new Date(r.tsMs).getUTCHours();
    }
  }

  forecast(): LibForecast {
    const dist = this.predictDist();
    const base = this.models[0].predict(this.ctx);
    const cuts = [1, ...LIB_EDGES];
    const survival = LIB_THRESHOLDS.map((x) => ({ x, p: r4(survivalAt(dist, x)), base: r4(survivalAt(base, x)) }));
    const v6 = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < LIB_BINS; i++) {
      const lo = cuts[i];
      let b = 0;
      while (b < V6_BAND_EDGES.length && lo >= V6_BAND_EDGES[b]) b++;
      v6[b] += dist[i];
    }
    const nextEvents: NextEvent[] = [2, 3, 5, 10, 20, 50, 100].map((x) => {
      const p1 = survivalAt(dist, x);
      const pb = Math.max(survivalAt(base, x), 1e-6);
      const within = WITHIN_K.map((k) => ({ k, p: r4(1 - (1 - p1) * Math.pow(1 - pb, k - 1)) }));
      // first round uses the conditional p1, later rounds the base rate
      const expectedWait = 1 + (1 - p1) / pb;
      let med = 1;
      if (p1 < 0.5) med = 1 + Math.ceil(Math.log(0.5 / (1 - p1)) / Math.log(1 - pb));
      const ei = LIB_EDGES.findIndex((e) => e === x);
      return {
        threshold: x,
        pNext: r4(p1),
        pBase: r4(pb),
        lift: r4(p1 / pb),
        within,
        expectedWait: Math.round(expectedWait * 10) / 10,
        medianWait: Math.max(1, med),
        roundsSince: ei >= 0 ? this.ctx.sinceBin[ei] : -1,
      };
    });
    let mi = 0;
    for (let i = 1; i < LIB_BINS; i++) if (dist[i] > dist[mi]) mi = i;
    const H = this.lossHist.slice(-2000);
    const d = H.map((h) => h.base - h.blend);
    const mean = d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0;
    const sd = d.length > 1 ? Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / (d.length - 1)) : 0;
    return {
      version: "lib-1",
      rounds: this.ctx.n,
      bins: dist.map((p, i) => ({ label: LIB_BIN_LABELS[i], lo: cuts[i], hi: i < LIB_EDGES.length ? LIB_EDGES[i] : null, p: r4(p) })),
      v6Bands: v6.map(r4),
      survival,
      quantiles: [0.1, 0.25, 0.5, 0.75, 0.9].map((q) => ({ q, x: quantileOf(dist, q) })),
      mostLikelyBin: LIB_BIN_LABELS[mi],
      nextEvents,
      weights: this.models
        .map((m, k) => ({ key: m.key, label: m.label, weight: r4(this.w[k]), logLoss: r4(this.modelLoss[k]) }))
        .sort((a, b) => b.weight - a.weight),
      skill: {
        window: H.length,
        blendLogLoss: r4(H.reduce((a, h) => a + h.blend, 0) / Math.max(1, H.length)),
        baseLogLoss: r4(H.reduce((a, h) => a + h.base, 0) / Math.max(1, H.length)),
        skillNats: Math.round(mean * 1e5) / 1e5,
        se: Math.round((sd / Math.sqrt(Math.max(1, d.length))) * 1e5) / 1e5,
      },
    };
  }
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Replay a tape (oldest first) and return the forecast for the round after it. */
export function libForecast(rounds: LibRound[], opts: LibOptions & { maxHistory?: number } = {}): LibForecast {
  const f = new LibForecaster(opts);
  const start = Math.max(0, rounds.length - (opts.maxHistory ?? 30000));
  for (let i = start; i < rounds.length; i++) f.update(rounds[i]);
  return f.forecast();
}

// ---------------------------------------------------------------- scoring

export interface BacktestReport {
  rounds: number;
  warmup: number;
  logLoss: { lib: number; base: number; fairLaw: number; skillNats: number; skillSe: number; skillPct: number };
  v6BandLogLoss: { lib: number; base: number };
  thresholds: {
    x: number;
    brierLib: number;
    brierBase: number;
    brierSkillPct: number;
    auc: number;
    meanP: number;
    hitRate: number;
    calibration: { bin: string; n: number; meanP: number; observed: number }[];
  }[];
  finalWeights: { key: string; weight: number }[];
  /** Standalone walk-forward log loss of every component, and its skill vs the base rate. */
  components: { key: string; logLoss: number; skillNats: number }[];
}

/**
 * Walk-forward backtest: forecast every round from `warmup` on using only
 * earlier rounds, then score. Baseline = the same history's empirical base rate.
 */
export function libBacktest(rounds: LibRound[], opts: LibOptions & { warmup?: number } = {}): BacktestReport {
  const warm = opts.warmup ?? Math.min(5000, Math.floor(rounds.length / 4));
  const f = new LibForecaster(opts);
  const law = DEFAULT_LAW;
  const TH = [1.5, 2, 3, 5, 10, 20, 100];
  const acc = TH.map(() => ({ bl: 0, bb: 0, pairs: [] as [number, number][], sp: 0, hit: 0 }));
  let ll = 0, bll = 0, fll = 0, n = 0, v6l = 0, v6b = 0;
  const diffs: number[] = [];
  const compLoss = new Array(f.modelKeys.length).fill(0);
  const cuts = [1, ...LIB_EDGES];
  const toV6 = (d: number[]) => {
    const v = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < LIB_BINS; i++) {
      let b = 0;
      while (b < V6_BAND_EDGES.length && cuts[i] >= V6_BAND_EDGES[b]) b++;
      v[b] += d[i];
    }
    return v;
  };
  const v6idx = (m: number) => {
    let b = 0;
    while (b < V6_BAND_EDGES.length && m >= V6_BAND_EDGES[b]) b++;
    return b;
  };
  let base: number[] = law;
  for (let t = 0; t < rounds.length; t++) {
    const m = rounds[t].multiplier;
    if (t >= warm) {
      const d = f.predictDist();
      const counts = (f as unknown as { ctx: Ctx }).ctx.globalCounts;
      const nn = counts.reduce((a, b) => a + b, 0);
      base = counts.map((c, i) => (c + 200 * law[i]) / (nn + 200));
      const b = libBin(m);
      f.componentDists().forEach((P, k) => (compLoss[k] += -Math.log(Math.max(P[b], EPS))));
      const a = -Math.log(Math.max(d[b], EPS));
      const c = -Math.log(Math.max(base[b], EPS));
      ll += a;
      bll += c;
      fll += -Math.log(law[b]);
      diffs.push(c - a);
      const vi = v6idx(m);
      v6l += -Math.log(Math.max(toV6(d)[vi], EPS));
      v6b += -Math.log(Math.max(toV6(base)[vi], EPS));
      TH.forEach((x, j) => {
        const p = survivalAt(d, x);
        const pb = survivalAt(base, x);
        const y = m >= x ? 1 : 0;
        acc[j].bl += (p - y) ** 2;
        acc[j].bb += (pb - y) ** 2;
        acc[j].pairs.push([p, y]);
        acc[j].sp += p;
        acc[j].hit += y;
      });
      n++;
    }
    f.update(rounds[t]);
  }
  const mean = diffs.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const sd = Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  const fin = f.forecast();
  return {
    rounds: n,
    warmup: warm,
    logLoss: {
      lib: r5(ll / n),
      base: r5(bll / n),
      fairLaw: r5(fll / n),
      skillNats: r5(mean),
      skillSe: r5(sd / Math.sqrt(n)),
      skillPct: Math.round((mean / (bll / n)) * 1e4) / 100,
    },
    v6BandLogLoss: { lib: r5(v6l / n), base: r5(v6b / n) },
    thresholds: TH.map((x, j) => {
      const A = acc[j];
      return {
        x,
        brierLib: r5(A.bl / n),
        brierBase: r5(A.bb / n),
        brierSkillPct: Math.round((1 - A.bl / A.bb) * 1e4) / 100,
        auc: r4(auc(A.pairs)),
        meanP: r4(A.sp / n),
        hitRate: r4(A.hit / n),
        calibration: reliability(A.pairs),
      };
    }),
    finalWeights: fin.weights.map((w) => ({ key: w.key, weight: w.weight })),
    components: f.modelKeys.map((key, k) => ({ key, logLoss: r5(compLoss[k] / n), skillNats: r5(bll / n - compLoss[k] / n) })),
  };
}

const r5 = (x: number) => Math.round(x * 1e5) / 1e5;

/** Area under the ROC curve (Mann–Whitney), ties counted half. */
export function auc(pairs: [number, number][]): number {
  const s = pairs.slice().sort((a, b) => a[0] - b[0]);
  let pos = 0, neg = 0, rankSum = 0;
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j < s.length && s[j][0] === s[i][0]) j++;
    const avgRank = (i + j + 1) / 2; // 1-based average rank
    for (let k = i; k < j; k++) if (s[k][1]) { pos++; rankSum += avgRank; } else neg++;
    i = j;
  }
  if (!pos || !neg) return 0.5;
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

/** Reliability table: forecasts split into quintiles by predicted p. */
export function reliability(pairs: [number, number][], groups = 5): { bin: string; n: number; meanP: number; observed: number }[] {
  const s = pairs.slice().sort((a, b) => a[0] - b[0]);
  const out: { bin: string; n: number; meanP: number; observed: number }[] = [];
  for (let g = 0; g < groups; g++) {
    const part = s.slice(Math.floor((g * s.length) / groups), Math.floor(((g + 1) * s.length) / groups));
    if (!part.length) continue;
    out.push({
      bin: `Q${g + 1}`,
      n: part.length,
      meanP: r4(part.reduce((a, p) => a + p[0], 0) / part.length),
      observed: r4(part.reduce((a, p) => a + p[1], 0) / part.length),
    });
  }
  return out;
}
