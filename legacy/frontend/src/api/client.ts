import type { Tokens } from './types';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';
const STORAGE_KEY = 'reservaflow.tokens';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

let tokens: Tokens | null = null;
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) tokens = JSON.parse(raw);
} catch { /* ignore */ }

const listeners = new Set<() => void>();
export const onAuthChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export const setTokens = (t: Tokens | null) => {
  tokens = t;
  try {
    if (t) localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
  listeners.forEach((fn) => fn());
};
export const getTokens = () => tokens;

let refreshing: Promise<boolean> | null = null;
const tryRefresh = async (): Promise<boolean> => {
  if (!tokens?.refreshToken) return false;
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    })
      .then(async (r) => { if (!r.ok) { setTokens(null); return false; } const d = await r.json(); setTokens(d.tokens); return true; })
      .catch(() => false)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
};

interface Options { method?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined>; retry?: boolean }

export const api = async <T>(path: string, opts: Options = {}): Promise<T> => {
  const url = new URL(BASE + path, window.location.origin);
  if (opts.query) for (const [k, v] of Object.entries(opts.query)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (tokens?.accessToken) headers.authorization = `Bearer ${tokens.accessToken}`;
  const res = await fetch(url.toString(), { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401 && opts.retry !== false && tokens && (await tryRefresh())) return api<T>(path, { ...opts, retry: false });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? 'Error inesperado', e.details);
  }
  return data as T;
};

export const get = <T>(path: string, query?: Options['query']) => api<T>(path, { query });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T = void>(path: string) => api<T>(path, { method: 'DELETE' });
