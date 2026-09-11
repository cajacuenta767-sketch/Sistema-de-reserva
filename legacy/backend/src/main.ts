import { loadEnv } from './config/env.js';
import { buildContainer } from './infrastructure/container.js';
import { createApp } from './infrastructure/http/app.js';
import { logger } from './shared/logger.js';

const env = loadEnv();
const container = buildContainer(env);
const app = createApp(container);

const server = app.listen(env.PORT, () => {
  logger.info(`🗓️  ReservaFlow API escuchando en http://localhost:${env.PORT}/api/v1  (${env.NODE_ENV})`);
});

// Recordatorios automáticos cada hora (citas de las próximas 24h).
const reminderTimer = setInterval(() => {
  container.useCases.bookings.sendReminders(24).catch((e) => logger.error({ e }, 'Error enviando recordatorios'));
}, 60 * 60_000);
reminderTimer.unref();

const shutdown = () => {
  logger.info('Apagando…');
  clearInterval(reminderTimer);
  server.close(() => {
    container.db.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
