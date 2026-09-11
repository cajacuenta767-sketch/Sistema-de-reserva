import type pg from 'pg';
import { AppError } from '@erp/core';
import { makeTx, type Tx } from './unitOfWork.js';

/**
 * Aislamiento entre organizaciones.
 *
 * Cada petición abre una transacción y fija `app.organization_id`; las políticas
 * RLS de cada tabla comparan contra ese valor. El rol de aplicación NO es dueño
 * de las tablas y no tiene BYPASSRLS, así que olvidar un `WHERE organization_id`
 * no filtra datos de otro tenant: simplemente no devuelve filas.
 *
 * Es la única defensa que sigue funcionando cuando el sistema tiene 300 endpoints.
 */

export const APP_ORG_SETTING = 'app.organization_id';
export const APP_USER_SETTING = 'app.membership_id';
export const APP_USER_ID_SETTING = 'app.user_id';

export interface TenantContext {
  organizationId: string;
  membershipId?: string | undefined;
  userId?: string | undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const assertUuid = (value: string, what: string): string => {
  if (!UUID_RE.test(value)) throw AppError.validation(`${what} inválido`);
  return value;
};

/**
 * Ejecuta `fn` dentro de una transacción con el tenant fijado.
 * `SET LOCAL` se deshace solo al terminar la transacción, así que una conexión
 * devuelta al pool nunca arrastra el tenant de la petición anterior.
 */
export const withTenant = async <T>(
  pool: pg.Pool,
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> => {
  const orgId = assertUuid(ctx.organizationId, 'Identificador de organización');
  const client = await pool.connect();
  const tx = makeTx(client);
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', [APP_ORG_SETTING, orgId]);
    if (ctx.membershipId) {
      await client.query('SELECT set_config($1, $2, true)', [
        APP_USER_SETTING,
        assertUuid(ctx.membershipId, 'Identificador de membresía'),
      ]);
    }
    if (ctx.userId) {
      await client.query('SELECT set_config($1, $2, true)', [
        APP_USER_ID_SETTING,
        assertUuid(ctx.userId, 'Identificador de usuario'),
      ]);
    }
    const result = await fn(tx);
    await client.query('COMMIT');
    await tx._runAfterCommit();
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Transacción SIN tenant, para operaciones previas a conocer la organización
 * (login, registro, aceptar invitación) y para trabajos de plataforma.
 * Las tablas con RLS no son accesibles aquí, que es justamente lo que se quiere.
 */
export interface NoTenantOptions {
  /** Identidad ya demostrada por el token. Habilita "verse a sí mismo". */
  userId?: string | undefined;
  /**
   * Modo autenticación: permite buscar un usuario por correo cuando todavía no
   * hay identidad demostrada. Es el único resquicio, y se limita a las rutas de
   * registro e inicio de sesión, que son las que tienen límite de peticiones.
   */
  authenticating?: boolean | undefined;
}

export const withoutTenant = async <T>(
  pool: pg.Pool,
  fn: (tx: Tx) => Promise<T>,
  options: NoTenantOptions = {},
): Promise<T> => {
  const client = await pool.connect();
  const tx = makeTx(client);
  try {
    await client.query('BEGIN');
    if (options.authenticating) {
      await client.query('SELECT set_config($1, $2, true)', ['app.authenticating', 'on']);
    }
    if (options.userId) {
      await client.query('SELECT set_config($1, $2, true)', [
        APP_USER_ID_SETTING,
        assertUuid(options.userId, 'Identificador de usuario'),
      ]);
    }
    const result = await fn(tx);
    await client.query('COMMIT');
    await tx._runAfterCommit();
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
};
