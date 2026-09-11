import { loadEnv, migrationUrl } from '../config/env.js';
import { createApp } from './app.js';
import { buildContainer } from '../platform/modules/container.js';
import { migrate } from '../platform/db/migrator.js';
import { withoutTenant } from '../platform/db/tenancy.js';
import { modules } from '../modules/index.js';

const env = loadEnv();
const container = buildContainer(env, modules);
const { logger } = container;

// Migrar al arrancar mantiene desarrollo y tests siempre al día. En producción
// se ejecuta como paso previo del despliegue, no aquí.
if (env.NODE_ENV !== 'production') {
  await migrate(migrationUrl(env), logger);
}

// El catálogo de permisos vive en el código; la base de datos es solo su reflejo.
await withoutTenant(container.pool, (tx) => container.permissions.sync(tx));
logger.info({ permisos: container.permissions.size }, 'catálogo de permisos sincronizado');

await container.registry.boot(container.ctx);
if (env.JOBS_ENABLED) await container.ctx.jobs.start();

const app = createApp(container);
const server = app.listen(env.PORT, () => {
  logger.info(
    { puerto: env.PORT, modulos: container.registry.ids().length },
    `API escuchando en http://localhost:${env.PORT}/api/v1`,
  );
});

const shutdown = (signal: string): void => {
  logger.info({ signal }, 'cerrando');
  server.close(() => {
    void container.close().then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
