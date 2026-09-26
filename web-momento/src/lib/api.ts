// Typed API client for the Momento backend (Cloudflare Worker).
import { safeStorage } from "@/lib/storage";
import { withAsOf } from "@/lib/asof";

export const BASE = import.meta.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL ?? "https://prosync-backend.rork.app";
const TOKEN_KEY = "momento.token";

export function getToken(): string | null {
  return safeStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) safeStorage.setItem(TOKEN_KEY, token);
  else safeStorage.removeItem(TOKEN_KEY);
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
  get: <T,>(path: string) => request<T>(withAsOf(path)),
  /** GET that ignores the time machine (live values only). */
  live: <T,>(path: string) => request<T>(path),
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
