// Safe storage: sandboxed iframes / privacy modes throw on any localStorage
// access. Fall back to an in-memory map so features degrade instead of crashing.
const memory = new Map<string, string>();

function store(): Storage | null {
  try {
    const s = window.localStorage;
    const probe = "__momento_probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}
let cached: Storage | null | undefined;
const get = () => (cached === undefined ? (cached = store()) : cached);

export const safeStorage = {
  getItem(key: string): string | null {
    try {
      const s = get();
      return s ? s.getItem(key) : memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },
  setItem(key: string, value: string): void {
    memory.set(key, value);
    try {
      get()?.setItem(key, value);
    } catch {
      // quota / sandbox — memory copy is enough
    }
  },
  removeItem(key: string): void {
    memory.delete(key);
    try {
      get()?.removeItem(key);
    } catch {
      // ignore
    }
  },
};
