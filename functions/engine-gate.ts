// engine-gate.ts — admit an engine to the blend only if it improves it.
//
// The ledger stores, for every resolved round, each engine's log loss at the
// band that landed (comp_loss = −log p_c(actual)) and the mixture weights used.
// Because the mixture is a linear pool, the mixture's probability at the actual
// band can be recomputed exactly with or without any one engine:
//
//   without c:  Σ_{j≠c} w_j p_j / Σ_{j≠c} w_j
//   with c:     (Σ_{j≠c} w_j p_j + s_c p_c) / (Σ_{j≠c} w_j + s_c)
//
// s_c is the engine's own weight when it was live, or a trial share when it
// was not (shadow / new engines), so engines out of the blend can earn their
// way in and engines in it can be dropped. An engine is admitted only if the
// mean per-round gain (loss without − loss with) exceeds `seMultiple` standard
// errors over the most recent `window` rounds. The baseline is always kept.
//
// Pure module: no I/O.

export interface GateRow {
  weights: Record<string, number>;
  compLoss: Record<string, number>;
}

export interface EngineVerdict {
  key: string;
  sample: number;
  /** mean per-round log-loss gain of adding the engine (positive = improves) */
  gain: number;
  se: number;
  /** share used when testing the engine */
  trialShare: number;
  admitted: boolean;
  status: "admitted" | "excluded" | "insufficient-data" | "always";
  reason: string;
}

export interface GateResult {
  sample: number;
  admitted: string[];
  excluded: string[];
  verdicts: EngineVerdict[];
  reason: string;
}

export interface GateOptions {
  window?: number;
  minSample?: number;
  seMultiple?: number;
  /** engines never gated (always in the blend) */
  always?: string[];
  /** trial share for engines that were not live in a row (default 1 / #engines) */
  trialShare?: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const seOf = (xs: number[]) => {
  if (xs.length < 2) return Infinity;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / (xs.length - 1) / xs.length);
};
const P_FLOOR = 1e-6;

export function blendAdmission(input: readonly GateRow[], keys: readonly string[], opts: GateOptions = {}): GateResult {
  const window = opts.window ?? 600;
  const minSample = opts.minSample ?? 100;
  const k = opts.seMultiple ?? 2;
  const always = new Set(opts.always ?? ["baseline"]);
  const rows = input
    .slice(-window)
    .filter((r) => r && r.weights && r.compLoss && Object.values(r.compLoss).every((v) => Number.isFinite(v)));
  const verdicts: EngineVerdict[] = [];
  for (const c of keys) {
    if (always.has(c)) {
      verdicts.push({ key: c, sample: rows.length, gain: 0, se: 0, trialShare: 0, admitted: true, status: "always", reason: "Always kept as the reference engine." });
      continue;
    }
    const gains: number[] = [];
    let shareSum = 0;
    for (const r of rows) {
      const lc = r.compLoss[c];
      if (!Number.isFinite(lc)) continue;
      const others = Object.keys(r.compLoss).filter((j) => j !== c && Number.isFinite(r.compLoss[j]) && (r.weights[j] ?? 0) > 0);
      const wSum = others.reduce((a, j) => a + (r.weights[j] ?? 0), 0);
      if (!(wSum > 0)) continue;
      const pOthers = others.reduce((a, j) => a + (r.weights[j] ?? 0) * Math.exp(-r.compLoss[j]), 0);
      const wc = r.weights[c] ?? 0;
      const s = wc > 0.021 ? wc : opts.trialShare ?? 1 / Math.max(2, keys.length);
      shareSum += s;
      const without = Math.max(P_FLOOR, pOthers / wSum);
      const withC = Math.max(P_FLOOR, (pOthers + s * Math.exp(-lc)) / (wSum + s));
      gains.push(Math.log(withC) - Math.log(without));
    }
    const g = mean(gains);
    const se = seOf(gains);
    const trialShare = gains.length ? shareSum / gains.length : 0;
    const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
    if (gains.length < minSample) {
      verdicts.push({ key: c, sample: gains.length, gain: r5(g), se: Number.isFinite(se) ? r5(se) : -1, trialShare: r5(trialShare), admitted: false, status: "insufficient-data", reason: `${gains.length}/${minSample} scored rounds — not yet tested.` });
      continue;
    }
    const admitted = g > 0 && g > k * se;
    verdicts.push({
      key: c,
      sample: gains.length,
      gain: r5(g),
      se: r5(se),
      trialShare: r5(trialShare),
      admitted,
      status: admitted ? "admitted" : "excluded",
      reason: admitted
        ? `Improves the blend: +${r5(g)} log-loss per round (± ${r5(se)} SE) over ${gains.length} rounds.`
        : `Does not improve the blend: ${g >= 0 ? "+" : ""}${r5(g)} per round (± ${r5(se)} SE) over ${gains.length} rounds.`,
    });
  }
  const tested = verdicts.filter((v) => v.status !== "insufficient-data" && v.status !== "always");
  return {
    sample: rows.length,
    admitted: verdicts.filter((v) => v.admitted).map((v) => v.key),
    excluded: verdicts.filter((v) => v.status === "excluded").map((v) => v.key),
    verdicts,
    reason: rows.length < minSample
      ? `Blend gate collecting evidence: ${rows.length}/${minSample} resolved rounds.`
      : `${tested.filter((v) => v.admitted).length} of ${tested.length} tested engines improve the blend by more than ${k} SE.`,
  };
}

/**
 * Registry states after gating. Operator choices that remove an engine
 * (shadow, demoted, retired) always win; otherwise an engine is live only if
 * it was admitted, or — while it has not been tested yet — if it is a built-in
 * component (existing behaviour) and shadow if it is new.
 */
export function gatedStates(
  operator: Record<string, string>,
  gate: GateResult | null,
  builtIn: readonly string[],
  candidates: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = { ...operator };
  if (!gate) return out;
  for (const v of gate.verdicts) {
    const op = operator[v.key];
    if (op === "shadow" || op === "demoted" || op === "retired") continue;
    if (v.status === "always") continue;
    if (v.status === "insufficient-data") {
      out[v.key] = builtIn.includes(v.key) ? op ?? "live" : "shadow";
      continue;
    }
    out[v.key] = v.admitted ? "live" : "shadow";
  }
  for (const c of candidates) if (!(c in out)) out[c] = "shadow";
  return out;
}
