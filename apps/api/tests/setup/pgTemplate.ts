import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { grantAppPrivileges, migrate, resetSchema, roleFromUrl } from '../../src/platform/db/migrator.js';

/**
 * Aislamiento de los tests de integración con bases de datos plantilla.
 *
 * El sistema de reservas usaba `:memory:` de SQLite: una base limpia por fichero
 * y sin coste. Con PostgreSQL eso no existe, y las alternativas habituales son
 * malas: compartir una base obliga a limpiar tablas entre tests (lento, frágil,
 * y no vale en paralelo), y aplicar las migraciones por fichero tarda segundos.
 *
 * `CREATE DATABASE ... TEMPLATE` copia una base ya migrada en unos 80 ms. Cada
 * fichero de test tiene la suya, completamente aislada, y pueden correr en
 * paralelo. Es lo más cercano al `:memory:` sin renunciar a Postgres real, que
 * es imprescindible aquí: las políticas RLS que protegen el multi-tenant NO
 * existen en SQLite, así que probarlas contra otro motor no probaría nada.
 */

const adminUrl = (base: string, database: string): string => {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
};

export const TEMPLATE_DB = process.env.TEST_TEMPLATE_DB ?? 'erp_test_base';

const baseUrl = (): string =>
  process.env.DATABASE_MIGRATION_URL ??
  process.env.DATABASE_URL ??
  'postgres://erp_migrator:erp_migrator@127.0.0.1:5432/erp_dev';

const appRole = (): string | null => roleFromUrl(process.env.DATABASE_URL ?? '');

/** Prepara la plantilla una sola vez para toda la ejecución de los tests. */
export const prepareTemplate = async (): Promise<void> => {
  const url = adminUrl(baseUrl(), TEMPLATE_DB);
  await resetSchema(url);
  await migrate(url);
  const role = appRole();
  if (role) await grantAppPrivileges(url, role);
};

const withAdmin = async <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> => {
  // Hay que conectarse a OTRA base para poder crear o borrar la de trabajo.
  const client = new pg.Client({ connectionString: adminUrl(baseUrl(), 'postgres') });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
};

export interface TestDatabase {
  name: string;
  /** URL con el rol de aplicación: SIN BYPASSRLS, como en producción. */
  appUrl: string;
  drop(): Promise<void>;
}

/**
 * Clona la plantilla. El nombre lleva un sufijo aleatorio para que dos ficheros
 * en paralelo nunca colisionen.
 */
export const createTestDatabase = async (): Promise<TestDatabase> => {
  const name = `erp_test_${randomBytes(6).toString('hex')}`;

  await withAdmin(async (client) => {
    // Una plantilla con conexiones abiertas no se puede copiar. En los tests no
    // debería haberlas, pero si el runner deja alguna colgada el error es
    // críptico, así que se cierran antes.
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEMPLATE_DB],
    );
    await client.query(`CREATE DATABASE "${name}" TEMPLATE "${TEMPLATE_DB}"`);
  });

  const appConnection = process.env.DATABASE_URL ?? baseUrl();
  const appUrl = adminUrl(appConnection, name);

  return {
    name,
    appUrl,
    drop: async () => {
      await withAdmin(async (client) => {
        await client.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
            WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [name],
        );
        await client.query(`DROP DATABASE IF EXISTS "${name}"`);
      });
    },
  };
};
