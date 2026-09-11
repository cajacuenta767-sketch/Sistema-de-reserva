import { loadEnv, migrationUrl } from '../../config/env.js';
import { createLogger } from '../logging/logger.js';
import { grantAppPrivileges, migrate, roleFromUrl } from './migrator.js';

const env = loadEnv();
const logger = createLogger(env);

const url = migrationUrl(env);
const result = await migrate(url, logger);

const appRole = roleFromUrl(env.DATABASE_URL);
if (appRole && appRole !== roleFromUrl(url)) {
  await grantAppPrivileges(url, appRole);
  logger.info({ role: appRole }, 'privilegios del rol de aplicación actualizados');
}

if (result.applied.length === 0) {
  logger.info(`Sin migraciones pendientes (${result.skipped.length} ya aplicadas).`);
} else {
  logger.info(`${result.applied.length} migración(es) aplicada(s): ${result.applied.join(', ')}`);
}
