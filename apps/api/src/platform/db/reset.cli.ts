import { loadEnv, migrationUrl } from '../../config/env.js';
import { createLogger } from '../logging/logger.js';
import { grantAppPrivileges, migrate, resetSchema, roleFromUrl } from './migrator.js';

const env = loadEnv();
const logger = createLogger(env);

if (env.NODE_ENV === 'production') throw new Error('db:reset no se ejecuta en producción.');

const url = migrationUrl(env);
await resetSchema(url);
logger.info('Esquema recreado.');

const result = await migrate(url, logger);
const appRole = roleFromUrl(env.DATABASE_URL);
if (appRole && appRole !== roleFromUrl(url)) await grantAppPrivileges(url, appRole);

logger.info(`${result.applied.length} migración(es) aplicada(s).`);
