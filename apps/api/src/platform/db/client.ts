import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Env } from '../../config/env.js';

const { Pool, types } = pg;

/**
 * PostgreSQL devuelve NUMERIC como string y así debe quedarse: convertirlo a
 * `number` perdería precisión en importes grandes. La clase Money lee esa cadena.
 * Lo mismo con int8 (bigint), que excede el entero seguro de JavaScript.
 */
types.setTypeParser(types.builtins.NUMERIC, (v) => v);
types.setTypeParser(types.builtins.INT8, (v) => v);
/** `date` también se queda como 'YYYY-MM-DD': una fecha contable no tiene zona horaria. */
types.setTypeParser(types.builtins.DATE, (v) => v);

/** Constructor de consultas de Drizzle. Puede envolver el pool o un cliente
 *  concreto de transacción; el tipo no distingue a propósito. */
export type Db = NodePgDatabase<Record<string, never>>;
export type PoolClient = pg.PoolClient;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

export const createPool = (connectionString: string, max = 10): pg.Pool =>
  new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Un statement que tarde más de 30 s en un ERP es siempre un bug.
    statement_timeout: 30_000,
  });

export const openDatabase = (env: Env, connectionString?: string): DbHandle => {
  const pool = createPool(connectionString ?? env.DATABASE_URL, env.DATABASE_POOL_MAX);
  const db: Db = drizzle(pool);
  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
};
