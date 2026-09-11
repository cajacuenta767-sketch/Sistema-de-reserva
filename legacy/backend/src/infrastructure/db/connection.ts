import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { runMigrations } from './migrator.js';

export type Db = DatabaseSync;

export const openDatabase = (path: string): Db => {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  runMigrations(db);
  return db;
};

/** Ejecuta `fn` dentro de una transacción (BEGIN/COMMIT/ROLLBACK). */
export const transaction = <T>(db: Db, fn: () => T): T => {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
};
