import pg from 'pg';
import { config as loadDotenv } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { grantAppPrivileges, migrate, resetSchema, roleFromUrl } from '../../src/platform/db/migrator.js';

// `globalSetup` corre en el proceso principal de vitest y los ficheros de test
// en procesos hijos. Los hijos cargan `.env` sin querer, por el efecto de
// importar `src/config/env.ts`; el principal no importa nada de eso. Sin esta
// línea las dos mitades leían URLs distintas: la plantilla se migraba y se
// concedía para un rol, y los tests se conectaban con otro. El síntoma era
// `relation "permissions" does not exist`, porque PostgreSQL oculta las tablas
// de un esquema sobre el que el rol no tiene USAGE en vez de decir que le falta
// el permiso.
loadDotenv();

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

/**
 * Prepara la plantilla una sola vez para toda la ejecución de los tests.
 *
 * Al final comprueba que el rol de aplicación ve de verdad las tablas. Es una
 * afirmación aparentemente redundante sobre código que acaba de ejecutarse, pero
 * cubre el único fallo de esta pieza que no se manifiesta aquí: si la plantilla
 * queda sin conceder, los tests fallan mucho después con un error que no
 * menciona ni permisos ni plantillas.
 */
export const prepareTemplate = async (): Promise<void> => {
  const url = adminUrl(baseUrl(), TEMPLATE_DB);
  await ensureTemplateExists();
  await resetSchema(url);
  await migrate(url);
  const role = appRole();
  if (role) await grantAppPrivileges(url, role);
  await assertTemplateUsable(url, role);
};

/** Falla con un mensaje que dice qué arreglar, no con uno que haya que investigar. */
const assertTemplateUsable = async (migrationUrl: string, role: string | null): Promise<void> => {
  const client = new pg.Client({ connectionString: migrationUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ tables: string; usage: boolean | null; readable: boolean | null }>(
      `SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') AS tables,
              CASE WHEN $1::text IS NULL THEN NULL
                   ELSE has_schema_privilege($1, 'public', 'USAGE') END AS usage,
              CASE WHEN $1::text IS NULL OR to_regclass('public.permissions') IS NULL THEN NULL
                   ELSE has_table_privilege($1, 'public.permissions', 'SELECT') END AS readable`,
      [role],
    );
    const row = rows[0];
    if (!row || Number(row.tables) === 0) {
      throw new Error(`La plantilla ${TEMPLATE_DB} quedó vacía: las migraciones no se aplicaron.`);
    }
    if (role && (row.usage !== true || row.readable !== true)) {
      throw new Error(
        `La plantilla ${TEMPLATE_DB} está migrada pero el rol "${role}" no puede leerla. ` +
          `Comprueba que DATABASE_URL y DATABASE_MIGRATION_URL apunten al mismo servidor ` +
          `y que el rol "${role}" exista.`,
      );
    }
  } finally {
    await client.end();
  }
};

/**
 * Crea la base plantilla si no existe.
 *
 * `resetSchema` se conecta a ella, así que tiene que existir antes. En una
 * máquina donde ya se ha trabajado, existe de ejecuciones anteriores y esto no
 * hace nada; en una limpia —CI, o alguien que acaba de clonar— no existe, y sin
 * este paso los tests mueren con `database "erp_test_base" does not exist`, un
 * error que no dice quién debía crearla.
 */
const ensureTemplateExists = async (): Promise<void> => {
  await withAdmin(async (client) => {
    const { rows } = await client.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
      [TEMPLATE_DB],
    );
    // El nombre no se puede pasar como parámetro en un CREATE DATABASE, así que
    // se valida antes: viene de una variable de entorno, no de una petición,
    // pero un identificador sin comprobar en DDL es una puerta que no se deja
    // abierta ni en los tests.
    if (!rows[0]?.exists) {
      if (!/^[a-z_][a-z0-9_]*$/i.test(TEMPLATE_DB)) {
        throw new Error(`Nombre de base plantilla inválido: ${TEMPLATE_DB}`);
      }
      await client.query(`CREATE DATABASE "${TEMPLATE_DB}"`);
    }
  });
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
