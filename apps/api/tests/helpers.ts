import type { Express } from 'express';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { FixedClock } from '@erp/core';
import { loadEnv, type Env } from '../src/config/env.js';
import { createApp } from '../src/bootstrap/app.js';
import { buildContainer, type Container } from '../src/platform/modules/container.js';
import { createPool } from '../src/platform/db/client.js';
import { withoutTenant } from '../src/platform/db/tenancy.js';
import { modules } from '../src/modules/index.js';
import { createTestDatabase, type TestDatabase } from './setup/pgTemplate.js';

/**
 * Arranque de la aplicación para tests.
 *
 * Evolución del `makeTestApp()` del sistema de reservas: misma idea (una app
 * real, sobre una base limpia, con reloj fijo), adaptada a PostgreSQL con base
 * plantilla. El reloj fijo es lo que hace que los tests que dependen de fechas
 * no fallen a medianoche ni cambien de resultado según el día.
 */

/** Martes 10 de marzo de 2026, 09:00. Día laborable, mes con 31 días. */
export const NOW = new Date('2026-03-10T09:00:00.000Z');

export interface TestApp {
  app: Express;
  api: TestAgent;
  container: Container;
  clock: FixedClock;
  env: Env;
  database: TestDatabase;
  close(): Promise<void>;
}

export const makeTestApp = async (): Promise<TestApp> => {
  const database = await createTestDatabase();

  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: database.appUrl,
    DATABASE_MIGRATION_URL: database.appUrl,
    JWT_ACCESS_SECRET: 'secreto-de-pruebas-suficientemente-largo',
    JWT_REFRESH_SECRET: 'otro-secreto-de-pruebas-suficientemente-largo',
    JOBS_ENABLED: 'false',
    LOG_LEVEL: 'silent',
  });

  const clock = new FixedClock(NOW);
  const pool = createPool(database.appUrl, 5);
  const container = buildContainer(env, modules, { clock, pool });

  // El catálogo de permisos vive en el código; sin sincronizarlo, las plantillas
  // de rol referencian permisos que no existen en la tabla.
  await withoutTenant(pool, (tx) => container.permissions.sync(tx));

  const app = createApp(container);

  return {
    app,
    api: request(app),
    container,
    clock,
    env,
    database,
    close: async () => {
      // El pool se cierra aquí explícitamente: como se pasó como override, el
      // contenedor no es su dueño y no lo cierra. Si queda abierto, el DROP
      // DATABASE mata sus conexiones y el error sale como excepción no
      // capturada al final de la suite.
      await container.close();
      await pool.end();
      await database.drop();
    },
  };
};

// ── Utilidades de sesión ─────────────────────────────────────────────────────

export interface Account {
  token: string;
  refreshToken: string;
  userId: string;
  organizationId: string;
  membershipId: string;
  email: string;
  /** Petición autenticada como este usuario. */
  as(method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string): request.Test;
}

let sequence = 0;

/** Crea una empresa con su propietario. Cada llamada usa un correo distinto. */
export const registerOrganization = async (
  t: TestApp,
  overrides: Partial<{ email: string; organizationName: string; firstName: string; lastName: string }> = {},
): Promise<Account> => {
  sequence += 1;
  const email = overrides.email ?? `owner${sequence}@test.local`;
  const response = await t.api
    .post('/api/v1/auth/register')
    .send({
      email,
      password: 'Prueba2026Segura!',
      firstName: overrides.firstName ?? 'Ana',
      lastName: overrides.lastName ?? `Prueba${sequence}`,
      organizationName: overrides.organizationName ?? `Empresa ${sequence}`,
    })
    .expect(201);

  return accountFrom(t, response.body, email);
};

/** Añade una persona a una empresa existente, con los roles indicados. */
export const inviteMember = async (
  t: TestApp,
  owner: Account,
  options: { roleCodes?: string[]; email?: string } = {},
): Promise<Account> => {
  sequence += 1;
  const email = options.email ?? `member${sequence}@test.local`;

  const roles = await owner.as('get', '/api/v1/roles').expect(200);
  const roleIds = (options.roleCodes ?? [])
    .map((code) => roles.body.items.find((r: { code: string }) => r.code === code)?.id)
    .filter((id: string | undefined): id is string => Boolean(id));

  const invitation = await owner.as('post', '/api/v1/invitations').send({ email, roleIds }).expect(201);

  const response = await t.api
    .post('/api/v1/auth/register')
    .send({
      email,
      password: 'Prueba2026Segura!',
      firstName: 'Bruno',
      lastName: `Invitado${sequence}`,
      invitationToken: invitation.body.token,
    })
    .expect(201);

  return accountFrom(t, response.body, email);
};

interface AuthBody {
  tokens: { accessToken: string; refreshToken: string };
  session: {
    user: { id: string };
    activeOrganizationId: string;
    organizations: Array<{ id: string; membershipId: string }>;
  };
}

const accountFrom = (t: TestApp, body: AuthBody, email: string): Account => {
  const organizationId = body.session.activeOrganizationId;
  const membership = body.session.organizations.find((o) => o.id === organizationId);

  return {
    token: body.tokens.accessToken,
    refreshToken: body.tokens.refreshToken,
    userId: body.session.user.id,
    organizationId,
    membershipId: membership?.membershipId ?? '',
    email,
    as: (method, path) => t.api[method](path).set('authorization', `Bearer ${body.tokens.accessToken}`),
  };
};
