import type pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Db } from './client.js';

/**
 * Transacción en curso. Todos los repositorios reciben un `Tx`, nunca el pool:
 * así una operación que toca cinco tablas se confirma o se revierte entera, y el
 * `SET LOCAL app.organization_id` de la transacción aplica a todas ellas.
 */
export interface Tx {
  /** Cliente crudo, para SQL que Drizzle no expresa bien (CTEs, upserts complejos). */
  client: pg.PoolClient;
  /** Constructor de consultas tipado sobre el MISMO cliente de la transacción. */
  db: Db;
  /** Se ejecuta tras el COMMIT. Para efectos que no deben ocurrir si algo falla. */
  afterCommit(fn: () => void | Promise<void>): void;
  /**
   * Fija el usuario de la transacción. Habilita las políticas RLS que permiten
   * a alguien verse a sí mismo antes de elegir organización (login, refresco,
   * perfil). Se descarta sola al terminar la transacción.
   */
  setUser(userId: string): Promise<void>;
}

export interface TxInternal extends Tx {
  _runAfterCommit(): Promise<void>;
}

export const makeTx = (client: pg.PoolClient): TxInternal => {
  const hooks: Array<() => void | Promise<void>> = [];
  return {
    client,
    db: drizzle(client),
    afterCommit: (fn) => {
      hooks.push(fn);
    },
    setUser: async (userId: string) => {
      await client.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);
    },
    _runAfterCommit: async () => {
      for (const fn of hooks) await fn();
    },
  };
};
