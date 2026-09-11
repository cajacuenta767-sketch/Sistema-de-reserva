import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, registerOrganization, inviteMember, type Account, type TestApp } from '../helpers.js';
import { collectRoutes } from '../setup/routes.js';

/**
 * Matriz de permisos.
 *
 * El test transversal más valioso del sistema: recorre TODAS las rutas montadas
 * y comprueba que ninguna deja pasar a alguien sin permisos. Un endpoint nuevo
 * que se olvide de proteger falla aquí el día que se escribe, no el día que
 * alguien lee datos que no debería.
 *
 * Las rutas públicas se declaran de forma explícita: la lista es corta y cada
 * entrada tiene que justificarse al añadirse.
 */

/** Rutas que NO exigen permisos, con el motivo. */
const PUBLIC_ROUTES = new Map<string, string>([
  ['get /api/v1/health', 'sonda de salud'],
  ['post /api/v1/auth/register', 'crear cuenta: aún no hay sesión'],
  ['post /api/v1/auth/login', 'iniciar sesión'],
  ['post /api/v1/auth/refresh', 'renovar sesión'],
  ['post /api/v1/auth/logout', 'cerrar sesión'],
  ['post /api/v1/auth/logout-everywhere', 'cerrar todas las sesiones propias'],
  ['get /api/v1/auth/session', 'la sesión propia'],
  ['patch /api/v1/auth/profile', 'el perfil propio'],
  ['post /api/v1/auth/change-password', 'la contraseña propia'],
  ['post /api/v1/auth/switch-organization', 'cambiar de empresa propia'],
  ['post /api/v1/auth/accept-invitation', 'aceptar una invitación recibida'],
]);

/** Valores de ejemplo para los parámetros de ruta. */
const SAMPLE: Record<string, string> = {
  id: '00000000-0000-4000-8000-000000000000',
  key: 'identity:member:read',
};

const fillParams = (path: string): string =>
  path.replace(/:(\w+)/g, (_, name: string) => SAMPLE[name] ?? SAMPLE['id'] ?? '');

let t: TestApp;
let owner: Account;
let nobody: Account;

beforeAll(async () => {
  t = await makeTestApp();
  owner = await registerOrganization(t);
  // Una persona de la MISMA empresa, sin ningún rol: pertenece, pero no puede
  // hacer nada. Es el peor caso realista.
  nobody = await inviteMember(t, owner, { roleCodes: [] });
});

afterAll(async () => {
  await t.close();
});

describe('matriz de permisos', () => {
  it('descubre las rutas montadas en la aplicación', () => {
    const routes = collectRoutes(t.container);
    // Si esto baja de golpe, el recorrido del router se rompió y el resto de
    // este fichero estaría comprobando nada.
    expect(routes.length).toBeGreaterThan(20);
    expect(routes.map((r) => `${r.method} ${r.path}`)).toContain('get /api/v1/members');
  });

  it('ninguna ruta privada responde 2xx a alguien sin permisos', async () => {
    const routes = collectRoutes(t.container);
    const leaks: string[] = [];

    for (const route of routes) {
      const key = `${route.method} ${route.path}`;
      if (PUBLIC_ROUTES.has(key)) continue;

      const response = await nobody
        .as(route.method, fillParams(route.path))
        .send({})
        .catch((err: { status?: number }) => ({ status: err.status ?? 500 }));

      // 403 es lo esperado. 400 (cuerpo inválido) y 404 también son aceptables:
      // significan que la petición ni siquiera llegó a leer datos ajenos.
      // Un 2xx aquí es una fuga.
      if (response.status >= 200 && response.status < 300) leaks.push(key);
    }

    expect(leaks, `Rutas accesibles sin permisos:\n  ${leaks.join('\n  ')}`).toEqual([]);
  });

  it('el propietario sí puede con las mismas rutas de lectura', async () => {
    await owner.as('get', '/api/v1/members').expect(200);
    await owner.as('get', '/api/v1/roles').expect(200);
    await owner.as('get', '/api/v1/audit').expect(200);
    await owner.as('get', '/api/v1/organization').expect(200);
  });

  it('el error de permiso dice cuál falta', async () => {
    const response = await nobody.as('get', '/api/v1/members').expect(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(response.body.error.message).toContain('identity:member:read');
  });

  it('todo permiso del catálogo está declarado en la base de datos', async () => {
    const catalog = await owner.as('get', '/api/v1/roles/catalog').expect(200);
    const declared = catalog.body.items.flatMap((m: { permissions: Array<{ key: string }> }) =>
      m.permissions.map((p) => p.key),
    );
    expect(declared.length).toBe(t.container.permissions.size);
    expect(declared).toContain('identity:member:read');
    expect(declared).toContain('org:organization:update');
  });
});
