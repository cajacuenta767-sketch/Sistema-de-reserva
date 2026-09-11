import { loadEnv, migrationUrl } from '../config/env.js';
import { createLogger } from '../platform/logging/logger.js';
import { migrate } from '../platform/db/migrator.js';
import { withoutTenant, withTenant } from '../platform/db/tenancy.js';
import { buildContainer } from '../platform/modules/container.js';
import { modules } from '../modules/index.js';

/**
 * Datos de demostración.
 *
 * Regla que hace que la demo sirva de algo: cada dato se crea pasando por el
 * MISMO caso de uso que usa la aplicación real. Sembrar con INSERT directos es
 * más rápido pero produce datos que la aplicación nunca habría generado, y eso
 * esconde justo los bugs que hay que encontrar: cuando lleguen las facturas, una
 * factura sembrada a mano no tendría su asiento contable y el balance no
 * cuadraría sin que nadie se enterase.
 *
 * Es idempotente: si el correo ya existe, no vuelve a crear la empresa.
 */

const PASSWORD = 'Demo2026Segura!';

interface DemoPerson {
  email: string;
  firstName: string;
  lastName: string;
  roleCode: string;
  jobTitle: string;
}

const TEAM: DemoPerson[] = [
  {
    email: 'admin@andina.demo',
    firstName: 'Mariana',
    lastName: 'Gómez',
    roleCode: 'ADMIN',
    jobTitle: 'Gerente general',
  },
  {
    email: 'contador@andina.demo',
    firstName: 'Jorge',
    lastName: 'Cárdenas',
    roleCode: 'ACCOUNTANT',
    jobTitle: 'Contador',
  },
  {
    email: 'ventas1@andina.demo',
    firstName: 'Laura',
    lastName: 'Peña',
    roleCode: 'SALES',
    jobTitle: 'Ejecutiva comercial',
  },
  {
    email: 'ventas2@andina.demo',
    firstName: 'Andrés',
    lastName: 'Ruiz',
    roleCode: 'SALES',
    jobTitle: 'Ejecutivo comercial',
  },
  {
    email: 'bodega@andina.demo',
    firstName: 'Camila',
    lastName: 'Torres',
    roleCode: 'EMPLOYEE',
    jobTitle: 'Jefa de bodega',
  },
  {
    email: 'soporte@andina.demo',
    firstName: 'Mateo',
    lastName: 'Vargas',
    roleCode: 'EMPLOYEE',
    jobTitle: 'Soporte técnico',
  },
  {
    email: 'compras@andina.demo',
    firstName: 'Valentina',
    lastName: 'Silva',
    roleCode: 'EMPLOYEE',
    jobTitle: 'Compras',
  },
];

const OWNER = {
  email: 'ana@andina.demo',
  firstName: 'Ana',
  lastName: 'Restrepo',
  organizationName: 'Distribuidora Andina S.A.S.',
};

const env = loadEnv();
const logger = createLogger(env);

await migrate(migrationUrl(env), logger);

const container = buildContainer(env, modules);
await withoutTenant(container.pool, (tx) => container.permissions.sync(tx));

interface IdentityApi {
  auth: {
    register(input: Record<string, unknown>): Promise<{ session: { activeOrganizationId: string } }>;
    invite(ctx: unknown, input: { email: string; roleIds: string[] }): Promise<{ id: string; token: string }>;
  };
}

const identity = container.registry.get<IdentityApi>('identity');

const alreadySeeded = await withoutTenant(
  container.pool,
  async (tx) => {
    const { rows } = await tx.client.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM users WHERE lower(email) = $1) AS exists',
      [OWNER.email],
    );
    return rows[0]?.exists ?? false;
  },
  { authenticating: true },
);

if (alreadySeeded) {
  logger.info('La demostración ya está sembrada; no se hace nada.');
} else {
  const result = await identity.auth.register({ ...OWNER, password: PASSWORD });
  const organizationId = result.session.activeOrganizationId;
  logger.info({ organizationId }, `Empresa creada: ${OWNER.organizationName}`);

  // Los roles se leen dentro del tenant para asignarlos por código.
  const roleIds = await withTenant(container.pool, { organizationId }, async (tx) => {
    const { rows } = await tx.client.query<{ id: string; code: string }>(
      'SELECT id, code FROM roles WHERE code IS NOT NULL',
    );
    return new Map(rows.map((r) => [r.code, r.id]));
  });

  const ownerContext = {
    organizationId,
    membershipId: '',
    user: { id: '', email: OWNER.email, fullName: `${OWNER.firstName} ${OWNER.lastName}` },
  };

  for (const person of TEAM) {
    const roleId = roleIds.get(person.roleCode);
    const invitation = await identity.auth.invite(
      { ...ownerContext, membershipId: await ownerMembership(organizationId) },
      { email: person.email, roleIds: roleId ? [roleId] : [] },
    );
    await identity.auth.register({
      email: person.email,
      password: PASSWORD,
      firstName: person.firstName,
      lastName: person.lastName,
      invitationToken: invitation.token,
    });
    logger.info(`  · ${person.firstName} ${person.lastName} (${person.roleCode})`);
  }

  logger.info(`\nListo. Entra con cualquiera de estos correos y la contraseña "${PASSWORD}":`);
  logger.info(`  ${OWNER.email} (Propietario)`);
  for (const p of TEAM) logger.info(`  ${p.email} (${p.roleCode})`);
}

/** `memberships` lleva RLS: hay que consultarla con la organización fijada. */
async function ownerMembership(organizationId: string): Promise<string> {
  return withTenant(container.pool, { organizationId }, async (tx) => {
    const { rows } = await tx.client.query<{ id: string }>(
      'SELECT id FROM memberships WHERE organization_id = $1 AND is_owner',
      [organizationId],
    );
    return rows[0]?.id ?? '';
  });
}

await container.close();
