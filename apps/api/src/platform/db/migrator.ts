import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { Logger } from '../logging/logger.js';

/**
 * Migrador propio, evolución del que ya usaba ReservaFlow.
 *
 * El SQL escrito a mano es la fuente de verdad del esquema, no un generador:
 * las políticas RLS, las restricciones diferidas (débito = crédito) y los índices
 * únicos parciales no se expresan con `drizzle-kit generate`. Drizzle se usa solo
 * como constructor de consultas tipado, y un test de deriva verifica que su
 * esquema y la base de datos coincidan.
 *
 * Un advisory lock impide que dos instancias migren a la vez al desplegar.
 */

const MIGRATION_LOCK_ID = 4_820_113;

const migrationsDir = (): string => path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export interface AppliedMigration {
  name: string;
  checksum: string;
  appliedAt: Date;
}

const ensureTable = async (client: pg.PoolClient): Promise<void> => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name        text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
};

const checksumOf = (sql: string): string =>
  createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex').slice(0, 32);

export const listMigrationFiles = async (): Promise<string[]> => {
  const entries = await readdir(migrationsDir());
  return entries.filter((f) => f.endsWith('.sql')).sort();
};

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export const migrate = async (
  connectionString: string,
  logger?: Pick<Logger, 'info' | 'warn'>,
): Promise<MigrateResult> => {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await ensureTable(client);

    const { rows } = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM _migrations',
    );
    const done = new Map(rows.map((r) => [r.name, r.checksum]));

    for (const file of await listMigrationFiles()) {
      const sql = await readFile(path.join(migrationsDir(), file), 'utf8');
      const checksum = checksumOf(sql);
      const previous = done.get(file);

      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(
            `La migración ${file} ya aplicada ha cambiado de contenido. ` +
              'Las migraciones son inmutables: crea una nueva en lugar de editarla.',
          );
        }
        skipped.push(file);
        continue;
      }

      // Cada migración es atómica: o entra entera o no entra.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Falló la migración ${file}: ${(err as Error).message}`, { cause: err });
      }
      applied.push(file);
      logger?.info({ migration: file }, 'migración aplicada');
    }

    return { applied, skipped };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
    await pool.end();
  }
};

/**
 * Concede al rol de aplicación lo justo para operar, y nada más.
 *
 * El rol de aplicación NO es dueño de las tablas: esa es exactamente la razón por
 * la que RLS se le aplica. Como el dueño va creando tablas en cada migración, se
 * fijan además privilegios por defecto para que las futuras queden cubiertas sin
 * tener que acordarse.
 */
export const grantAppPrivileges = async (
  migrationConnectionString: string,
  appRole: string,
): Promise<void> => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(appRole)) {
    throw new Error(`Nombre de rol inválido: ${appRole}`);
  }
  const pool = new pg.Pool({ connectionString: migrationConnectionString, max: 1 });
  try {
    const { rows } = await pool.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists',
      [appRole],
    );
    if (!rows[0]?.exists) return;

    await pool.query(`GRANT USAGE ON SCHEMA public TO "${appRole}"`);
    await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${appRole}"`);
    await pool.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${appRole}"`);
    await pool.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO "${appRole}"`);
    await pool.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public
         GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${appRole}"`,
    );
    await pool.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${appRole}"`,
    );
  } finally {
    await pool.end();
  }
};

/** Extrae el usuario de una URL de conexión de PostgreSQL. */
export const roleFromUrl = (connectionString: string): string | null => {
  try {
    return decodeURIComponent(new URL(connectionString).username) || null;
  } catch {
    return null;
  }
};

/** Borra y recrea el esquema público. Solo para desarrollo y tests. */
export const resetSchema = async (connectionString: string): Promise<void> => {
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
  } finally {
    await pool.end();
  }
};
