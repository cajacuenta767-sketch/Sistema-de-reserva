import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Comportamiento del refresco de sesión.
 *
 * Se prueba porque el modo de fallo es silencioso y muy molesto: si un 429 o un
 * 503 pasajero borra los tokens, al usuario le cierran la sesión mientras
 * trabaja y pierde lo que estuviera escribiendo, sin ningún error que explique
 * por qué.
 */

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.resetModules();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
  store.set('erp.tokens', JSON.stringify({ accessToken: 'viejo', refreshToken: 'refresco' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Primera respuesta: 401 en la petición. Segunda: la del refresco. */
const withRefreshResponse = (status: number, body: unknown = {}) => {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      calls.push(String(url));
      if (String(url).includes('/auth/refresh')) {
        return Promise.resolve({
          ok: status >= 200 && status < 300,
          status,
          json: () => Promise.resolve(body),
        } as Response);
      }
      return Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { message: 'expirado' } }),
      } as Response);
    }),
  );
  return calls;
};

describe('refresco de sesión', () => {
  it('un 401 en el refresco cierra la sesión: el token ya no vale', async () => {
    withRefreshResponse(401);
    const { api, getTokens } = await import('@/lib/api/client');
    await expect(api('/parties')).rejects.toThrow();
    expect(getTokens()).toBeNull();
  });

  it('un 429 NO cierra la sesión: el límite de peticiones es pasajero', async () => {
    withRefreshResponse(429);
    const { api, getTokens } = await import('@/lib/api/client');
    await expect(api('/parties')).rejects.toThrow();
    expect(getTokens()?.refreshToken).toBe('refresco');
  });

  it('un 503 NO cierra la sesión', async () => {
    withRefreshResponse(503);
    const { api, getTokens } = await import('@/lib/api/client');
    await expect(api('/parties')).rejects.toThrow();
    expect(getTokens()?.refreshToken).toBe('refresco');
  });

  it('un fallo de red tampoco cierra la sesión', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).includes('/auth/refresh')
          ? Promise.reject(new Error('sin red'))
          : Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) } as Response),
      ),
    );
    const { api, getTokens } = await import('@/lib/api/client');
    await expect(api('/parties')).rejects.toThrow();
    expect(getTokens()?.refreshToken).toBe('refresco');
  });

  it('un refresco correcto guarda los tokens nuevos y reintenta', async () => {
    let refreshed = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (String(url).includes('/auth/refresh')) {
          refreshed = true;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ tokens: { accessToken: 'nuevo', refreshToken: 'refresco2' } }),
          } as Response);
        }
        return Promise.resolve(
          refreshed
            ? ({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }) } as Response)
            : ({ ok: false, status: 401, json: () => Promise.resolve({}) } as Response),
        );
      }),
    );
    const { api, getTokens } = await import('@/lib/api/client');
    await expect(api('/parties')).resolves.toEqual({ items: [] });
    expect(getTokens()?.accessToken).toBe('nuevo');
  });

  it('varias peticiones en vuelo comparten UN solo refresco', async () => {
    // Con rotación de token, dos refrescos simultáneos hacen que el segundo
    // llegue con un token ya rotado: el servidor lo interpreta como robo de
    // credenciales y cierra la sesión entera.
    let refreshCalls = 0;
    let refreshed = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (String(url).includes('/auth/refresh')) {
          refreshCalls += 1;
          return new Promise((resolve) =>
            setTimeout(() => {
              refreshed = true;
              resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ tokens: { accessToken: 'nuevo', refreshToken: 'r2' } }),
              } as Response);
            }, 10),
          );
        }
        return Promise.resolve(
          refreshed
            ? ({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) } as Response)
            : ({ ok: false, status: 401, json: () => Promise.resolve({}) } as Response),
        );
      }),
    );
    const { api } = await import('@/lib/api/client');
    await Promise.all([api('/a'), api('/b'), api('/c'), api('/d')]);
    expect(refreshCalls).toBe(1);
  });
});
