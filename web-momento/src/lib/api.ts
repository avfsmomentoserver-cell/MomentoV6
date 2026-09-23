// Typed API client for the Momento backend (Cloudflare Worker).

const BASE = import.meta.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL ?? "https://prosync-backend.rork.app";
const TOKEN_KEY = "momento.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable
  }
}

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string>) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const payload = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as { ok: boolean; data?: T; error?: string };
  if (!res.ok || !payload.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
  return payload.data as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, json?: unknown) => request<T>(path, { method: "POST", json }),
  put: <T,>(path: string, json?: unknown) => request<T>(path, { method: "PUT", json }),
  del: <T,>(path: string, json?: unknown) => request<T>(path, { method: "DELETE", json }),
};

/** Build a querystring, skipping null/undefined/empty values. */
export function qs(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
