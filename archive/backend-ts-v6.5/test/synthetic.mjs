// Seeded synthetic crash tapes for tests and backtests.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Provably-fair style crash draw: X = max(1, floor(100·(1−edge)/U)/100). */
export function crashDraw(rand, edge = 0.03) {
  const u = Math.max(1e-12, rand());
  return Math.max(1, Math.floor((100 * (1 - edge)) / u) / 100);
}

/**
 * @param n rounds
 * @param opts.edge constant edge, or opts.edgeAt(i) for a drifting regime
 */
export function syntheticTape(n, { seed = 7, edge = 0.03, edgeAt = null, startMs = Date.UTC(2026, 0, 1), cadenceMs = 9000 } = {}) {
  const rand = mulberry32(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const e = edgeAt ? edgeAt(i) : edge;
    const tsMs = startMs + i * cadenceMs;
    out.push({ id: i + 1, source: "synthetic", multiplier: crashDraw(rand, e), tsMs, ts: new Date(tsMs).toISOString(), origin: "observed", color: null, sessionId: null });
  }
  return out;
}
