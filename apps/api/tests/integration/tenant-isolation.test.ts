import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, registerOrganization, inviteMember, type Account, type TestApp } from '../helpers.js';
import { collectRoutes } from '../setup/routes.js';

/**
 * Aislamiento entre empresas.
 *
 * Es la propiedad de seguridad más importante de un SaaS multi-empresa y la más
 * fácil de romper sin enterarse: basta con olvidar un `WHERE organization_id` en
 * una consulta de las trescientas que tendrá el sistema. Por eso el aislamiento
 * no depende de la disciplina de quien escribe consultas sino de RLS, y por eso
 * este test recorre TODAS las rutas de lectura buscando fugas.
 *
 * El fallo que motivó este fichero fue real: el listado de personas devolvía
 * usuarios de otras empresas porque `memberships` estaba exenta de RLS para
 * poder consultarla antes de elegir empresa.
 */

let t: TestApp;
let alpha: Account;
let beta: Account;

beforeAll(async () => {
  t = await makeTestApp();
  alpha = await registerOrganization(t, { organizationName: 'Empresa Alfa', email: 'alfa@test.local' });
  beta = await registerOrganization(t, { organizationName: 'Empresa Beta', email: 'beta@test.local' });
  await inviteMember(t, alpha, { roleCodes: ['ADMIN'], email: 'equipo.alfa@test.local' });
});

afterAll(async () => {
  await t.close();
});

describe('aislamiento entre empresas', () => {
  it('cada empresa ve solo a su propia gente', async () => {
    const inAlpha = await alpha.as('get', '/api/v1/members').expect(200);
    const inBeta = await beta.as('get', '/api/v1/members').expect(200);

    const alphaEmails = inAlpha.body.items.map((m: { email: string }) => m.email);
    const betaEmails = inBeta.body.items.map((m: { email: string }) => m.email);

    expect(alphaEmails).toContain('alfa@test.local');
    expect(alphaEmails).toContain('equipo.alfa@test.local');
    expect(alphaEmails).not.toContain('beta@test.local');

    expect(betaEmails).toEqual(['beta@test.local']);
  });

  it('los roles de una empresa no se ven desde otra', async () => {
    const alphaRoles = await alpha.as('get', '/api/v1/roles').expect(200);
    const betaRoles = await beta.as('get', '/api/v1/roles').expect(200);

    const alphaIds = alphaRoles.body.items.map((r: { id: string }) => r.id);
    const betaIds = betaRoles.body.items.map((r: { id: string }) => r.id);

    // Cada empresa tiene su propia copia de las plantillas: mismos nombres,
    // identificadores distintos.
    expect(alphaIds).toHaveLength(5);
    expect(betaIds).toHaveLength(5);
    expect(alphaIds.some((id: string) => betaIds.includes(id))).toBe(false);
  });

  it('pedir la organización de otra empresa por cabecera devuelve 403', async () => {
    const response = await t.api
      .get('/api/v1/members')
      .set('authorization', `Bearer ${alpha.token}`)
      .set('x-organization-id', beta.organizationId)
      .expect(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('no se puede leer un recurso concreto de otra empresa por su id', async () => {
    const betaRoles = await beta.as('get', '/api/v1/roles').expect(200);
    const betaRoleId = betaRoles.body.items[0].id;

    await alpha.as('get', `/api/v1/roles/${betaRoleId}`).expect(404);
  });

  it('no se puede modificar un recurso de otra empresa', async () => {
    const betaRoles = await beta.as('get', '/api/v1/roles').expect(200);
    const betaRoleId = betaRoles.body.items.find((r: { code: string }) => r.code === 'SALES').id;

    await alpha.as('patch', `/api/v1/roles/${betaRoleId}`).send({ name: 'Secuestrado' }).expect(404);

    // Y sigue intacto.
    const after = await beta.as('get', `/api/v1/roles/${betaRoleId}`).expect(200);
    expect(after.body.role.name).toBe('Comercial');
  });

  it('la auditoría de una empresa no contiene eventos de la otra', async () => {
    await alpha.as('patch', '/api/v1/organization').send({ city: 'Medellín' }).expect(200);

    const alphaAudit = await alpha.as('get', '/api/v1/audit').expect(200);
    const betaAudit = await beta.as('get', '/api/v1/audit').expect(200);

    const alphaLabels = alphaAudit.body.items.map((a: { entity_label: string }) => a.entity_label);
    const betaLabels = betaAudit.body.items.map((a: { entity_label: string }) => a.entity_label);

    expect(alphaLabels).toContain('Empresa Alfa');
    expect(betaLabels).not.toContain('Empresa Alfa');
  });

  it('ninguna ruta de lectura devuelve datos de la otra empresa', async () => {
    const readRoutes = collectRoutes(t.container).filter(
      (r) => r.method === 'get' && !r.path.includes(':') && !r.path.includes('/auth/'),
    );
    expect(readRoutes.length).toBeGreaterThan(3);

    const leaks: string[] = [];
    for (const route of readRoutes) {
      const response = await beta.as('get', route.path);
      if (response.status !== 200) continue;
      // Ningún identificador ni correo de Alfa debe aparecer en respuestas de Beta.
      const body = JSON.stringify(response.body);
      if (body.includes(alpha.organizationId) || body.includes('alfa@test.local')) {
        leaks.push(route.path);
      }
    }

    expect(leaks, `Rutas que filtran datos de otra empresa:\n  ${leaks.join('\n  ')}`).toEqual([]);
  });
});

describe('aislamiento en la propia base de datos', () => {
  it('sin organización fijada, una tabla de negocio no devuelve nada', async () => {
    const { rows } = await t.container.pool.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM roles',
    );
    // Las dos empresas tienen 5 roles cada una, pero sin `app.organization_id`
    // la política RLS no deja ver ninguno. Es la red de seguridad que hace que
    // olvidar un filtro no sea una fuga.
    expect(rows[0]?.total).toBe('0');
  });

  it('escribir en otra organización viola la política de la base de datos', async () => {
    const client = await t.container.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.organization_id', alpha.organizationId]);
      await expect(
        client.query(
          `INSERT INTO roles (id, organization_id, name) VALUES (gen_random_uuid(), $1, 'Intruso')`,
          [beta.organizationId],
        ),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });
});
