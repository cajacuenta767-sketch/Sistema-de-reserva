import type { Tokens } from '@erp/contracts';

/**
 * Cliente HTTP.
 *
 * Portado del sistema de reservas, que ya tenía bien resuelto lo difícil: el
 * refresco automático en 401 DEDUPLICADO. Sin esa deduplicación, una pantalla
 * que lanza seis peticiones al montarse dispara seis refrescos simultáneos; con
 * rotación de token, cinco de ellos llegan con un token ya rotado y el servidor
 * interpreta robo de credenciales y cierra la sesión.
 *
 * Lo nuevo es la cabecera de organización, que permite cambiar de empresa sin
 * reemitir el token de acceso.
 */

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';
const TOKENS_KEY = 'erp.tokens';
const ORG_KEY = 'erp.organization';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Errores que conviene mostrar tal cual: el mensaje del servidor es útil. */
  get isUserFacing(): boolean {
    return this.status < 500 && this.status !== 401;
  }
}

const readStorage = <T>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: unknown): void => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* almacenamiento bloqueado: la sesión vive solo en memoria */
  }
};

let tokens: Tokens | null = readStorage<Tokens>(TOKENS_KEY);
let organizationId: string | null = readStorage<string>(ORG_KEY);

const listeners = new Set<() => void>();
export const onAuthChange = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const notify = (): void => listeners.forEach((fn) => fn());

export const getTokens = (): Tokens | null => tokens;
export const setTokens = (next: Tokens | null): void => {
  tokens = next;
  writeStorage(TOKENS_KEY, next);
  notify();
};

export const getOrganizationId = (): string | null => organizationId;
export const setOrganizationId = (next: string | null): void => {
  organizationId = next;
  writeStorage(ORG_KEY, next);
  notify();
};

/** Una sola promesa de refresco compartida por todas las peticiones en vuelo. */
let refreshing: Promise<boolean> | null = null;

const tryRefresh = async (): Promise<boolean> => {
  if (!tokens?.refreshToken) return false;
  refreshing ??= fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: tokens.refreshToken }),
  })
    .then(async (res) => {
      if (!res.ok) {
        // Solo se cierra la sesión si el servidor dice que el token YA NO VALE.
        // Un 429 por límite de peticiones, un 503 o una caída momentánea son
        // problemas pasajeros: cerrar la sesión por ellos echa a alguien que
        // estaba trabajando y le hace perder lo que tuviera a medio escribir.
        if (res.status === 401 || res.status === 403) setTokens(null);
        return false;
      }
      const data = (await res.json()) as { tokens: Tokens };
      setTokens(data.tokens);
      return true;
    })
    // Un fallo de red tampoco invalida el token: al recuperar la conexión, la
    // siguiente petición vuelve a intentarlo.
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
};

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Se serializa como querystring; `undefined` y cadenas vacías se omiten. */
  query?: URLSearchParams | Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  /** Uso interno para no reintentar en bucle tras un refresco. */
  retry?: boolean;
}

const buildUrl = (path: string, query: RequestOptions['query']): string => {
  const url = new URL(BASE + path, window.location.origin);
  if (query instanceof URLSearchParams) {
    query.forEach((value, key) => url.searchParams.append(key, value));
  } else if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
};

export const api = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (tokens?.accessToken) headers.authorization = `Bearer ${tokens.accessToken}`;
  if (organizationId) headers['x-organization-id'] = organizationId;

  const response = await fetch(buildUrl(path, options.query), {
    method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (response.status === 401 && options.retry !== false && tokens && (await tryRefresh())) {
    return api<T>(path, { ...options, retry: false });
  }

  if (response.status === 204) return undefined as T;

  const data: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    const envelope = (data as { error?: Record<string, unknown> }).error ?? {};
    throw new ApiError(
      response.status,
      String(envelope.code ?? 'ERROR'),
      String(envelope.message ?? 'Error inesperado'),
      envelope.details,
      typeof envelope.requestId === 'string' ? envelope.requestId : undefined,
    );
  }

  return data as T;
};

export const get = <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) =>
  api<T>(path, { query, ...(signal ? { signal } : {}) });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T = void>(path: string) => api<T>(path, { method: 'DELETE' });
