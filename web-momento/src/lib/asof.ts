// Global time machine state (Platform Book F-04). When set, every GET carries ?as_of=<ms>
// and the backend answers with what it knew at that instant.
type Listener = (v: number | null) => void;
let current: number | null = null;
const listeners = new Set<Listener>();

export function getAsOf(): number | null {
  return current;
}
export function setAsOf(v: number | null): void {
  current = v;
  for (const l of listeners) l(v);
}
export function subscribeAsOf(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function withAsOf(path: string): string {
  if (current === null || path.includes("as_of=")) return path;
  return path + (path.includes("?") ? "&" : "?") + "as_of=" + current;
}
