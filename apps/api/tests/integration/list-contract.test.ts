import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, registerOrganization, inviteMember, type Account, type TestApp } from '../helpers.js';
import { collectRoutes } from '../setup/routes.js';

/**
 * Contrato de listado.
 *
 * Todos los endpoints de lista del sistema hablan el mismo idioma. Esa
 * uniformidad es lo que permite que la DataTable del frontend funcione con
 * cualquier módulo sin adaptadores, así que conviene que un test la defienda:
 * el día que un módulo devuelva `{ data, count }` en vez de
 * `{ items, total, page, pageSize }`, la tabla se rompe en esa pantalla y en
 * ninguna otra, que es la forma más cara de descubrirlo.
 */

let t: TestApp;
let owner: Account;

beforeAll(async () => {
  t = await makeTestApp();
  owner = await registerOrganization(t, { organizationName: 'Empresa de prueba' });
  // Varias personas para que haya algo que paginar y ordenar.
  for (const name of ['Beatriz', 'Carlos', 'Diana', 'Esteban']) {
    await inviteMember(t, owner, { roleCodes: ['EMPLOYEE'], email: `${name.toLowerCase()}@test.local` });
  }
});

afterAll(async () => {
  await t.close();
});

const LIST_ENDPOINTS = ['/api/v1/members', '/api/v1/audit'];

describe('sobre de respuesta', () => {
  it.each(LIST_ENDPOINTS)('%s devuelve items, total, page y pageSize', async (path) => {
    const response = await owner.as('get', path).expect(200);
    expect(response.body).toMatchObject({
      items: expect.any(Array),
      total: expect.any(Number),
      page: expect.any(Number),
      pageSize: expect.any(Number),
    });
  });
});

describe('paginación', () => {
  it('respeta pageSize y page, y el total es del conjunto completo', async () => {
    const first = await owner.as('get', '/api/v1/members?pageSize=2&page=1').expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.total).toBe(5);
    expect(first.body.pageSize).toBe(2);

    const second = await owner.as('get', '/api/v1/members?pageSize=2&page=2').expect(200);
    expect(second.body.items).toHaveLength(2);
    expect(second.body.page).toBe(2);

    // Sin solapamiento entre páginas.
    const ids = new Set(first.body.items.map((m: { membership_id: string }) => m.membership_id));
    for (const member of second.body.items) expect(ids.has(member.membership_id)).toBe(false);
  });

  it('rechaza un pageSize desmesurado en lugar de intentar servirlo', async () => {
    await owner.as('get', '/api/v1/members?pageSize=100000').expect(400);
  });
});

describe('orden', () => {
  it('ordena ascendente y descendente por el mismo campo', async () => {
    const asc = await owner.as('get', '/api/v1/members?sort=email').expect(200);
    const desc = await owner.as('get', '/api/v1/members?sort=-email').expect(200);

    const ascEmails = asc.body.items.map((m: { email: string }) => m.email);
    expect(ascEmails).toEqual([...ascEmails].sort());
    expect(desc.body.items.map((m: { email: string }) => m.email)).toEqual([...ascEmails].reverse());
  });

  it('rechaza ordenar por un campo no declarado', async () => {
    const response = await owner.as('get', '/api/v1/members?sort=password_hash').expect(400);
    expect(response.body.error.message).toContain('No se puede ordenar');
  });

  it('rechaza una inyección SQL en el orden', async () => {
    // Sin la lista blanca de campos, `sort` sería una inyección de manual.
    await owner.as('get', '/api/v1/members?sort=-(SELECT 1)').expect(400);
    await owner.as('get', '/api/v1/members?sort=email;DROP TABLE users').expect(400);

    // Y la tabla sigue ahí.
    await owner.as('get', '/api/v1/members').expect(200);
  });
});

describe('filtros', () => {
  it('filtra por igualdad', async () => {
    const response = await owner.as('get', '/api/v1/members?filter[status]=ACTIVE').expect(200);
    expect(response.body.total).toBe(5);
    for (const member of response.body.items) expect(member.status).toBe('ACTIVE');
  });

  it('una lista separada por comas es un IN', async () => {
    const response = await owner.as('get', '/api/v1/members?filter[status]=ACTIVE,SUSPENDED').expect(200);
    expect(response.body.total).toBe(5);
  });

  it('acepta operadores explícitos', async () => {
    const future = await owner.as('get', '/api/v1/members?filter[created_at][gte]=2030-01-01').expect(200);
    expect(future.body.total).toBe(0);

    const past = await owner.as('get', '/api/v1/members?filter[created_at][gte]=2000-01-01').expect(200);
    expect(past.body.total).toBe(5);
  });

  it('isnull distingue presencia de ausencia', async () => {
    const never = await owner.as('get', '/api/v1/members?filter[last_login_at][isnull]=true').expect(200);
    expect(never.body.total).toBe(5); // nadie ha iniciado sesión todavía
  });

  it('rechaza filtrar por un campo no declarado', async () => {
    const response = await owner.as('get', '/api/v1/members?filter[password_hash]=x').expect(400);
    expect(response.body.error.message).toContain('No se puede filtrar');
  });

  it('rechaza un operador inventado', async () => {
    await owner.as('get', '/api/v1/members?filter[created_at][drop]=1').expect(400);
  });
});

describe('búsqueda y agregados', () => {
  it('la búsqueda libre alcanza los campos marcados como buscables', async () => {
    const response = await owner.as('get', '/api/v1/members?q=beatriz').expect(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items[0].email).toBe('beatriz@test.local');
  });

  it('los agregados se calculan sobre el conjunto filtrado, no sobre la página', async () => {
    const response = await owner.as('get', '/api/v1/members?pageSize=1').expect(200);
    expect(response.body.items).toHaveLength(1);
    // Si los agregados se calcularan sobre la página, esto valdría 1.
    expect(response.body.aggregates.active).toBe(5);
  });

  it('el filtro también afecta a los agregados', async () => {
    const response = await owner.as('get', '/api/v1/members?q=beatriz').expect(200);
    expect(response.body.aggregates.active).toBe(1);
  });
});

describe('cobertura del contrato', () => {
  it('todo endpoint de lista devuelve el sobre estándar', async () => {
    // Recorre las rutas GET sin parámetros y comprueba que las que parecen
    // listados (devuelven `items`) cumplen el contrato completo.
    const candidates = collectRoutes(t.container).filter(
      (r) => r.method === 'get' && !r.path.includes(':') && !r.path.includes('/auth/'),
    );

    const offenders: string[] = [];
    for (const route of candidates) {
      const response = await owner.as('get', route.path);
      if (response.status !== 200 || !Array.isArray(response.body?.items)) continue;

      // `{ items }` a secas está permitido para colecciones pequeñas sin
      // paginar (roles, equipos); lo que NO vale es paginar con otros nombres.
      const hasPagination = 'total' in response.body || 'page' in response.body;
      if (hasPagination) {
        const complete =
          typeof response.body.total === 'number' &&
          typeof response.body.page === 'number' &&
          typeof response.body.pageSize === 'number';
        if (!complete) offenders.push(route.path);
      }
    }

    expect(offenders, `Listados que no cumplen el contrato:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});
