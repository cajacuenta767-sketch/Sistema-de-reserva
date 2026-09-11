import { loadEnv } from '../config/env.js';
import { buildContainer } from '../platform/modules/container.js';
import { drainOutbox } from '../platform/events/outbox.js';
import { modules } from '../modules/index.js';

/**
 * Trabajador de segundo plano.
 *
 * Vacía la bandeja de salida: correos, PDF, webhooks y cualquier reacción
 * diferida a un evento de negocio. Es un proceso aparte del que sirve HTTP —se
 * despliega y se escala por separado— pero comparte el mismo código, porque los
 * manejadores son los mismos que registran los módulos. Separarlo en otro
 * paquete obligaría a exportar media API como librería sin ganar nada.
 *
 * `FOR UPDATE SKIP LOCKED` permite levantar varias réplicas sin que se pisen.
 */

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_MS ?? 2000);

const env = loadEnv();
const container = buildContainer(env, modules);
const { logger } = container;

await container.registry.boot(container.ctx);
await container.ctx.jobs.start();

logger.info({ intervalo: POLL_INTERVAL_MS }, 'trabajador en marcha');

let running = true;
let idle = 0;

const loop = async (): Promise<void> => {
  while (running) {
    try {
      const { processed, failed } = await drainOutbox(container.pool, container.events, logger);
      if (processed > 0 || failed > 0) {
        idle = 0;
        logger.info({ processed, failed }, 'lote de eventos procesado');
      } else {
        idle += 1;
      }
    } catch (err) {
      logger.error({ err }, 'el trabajador falló al vaciar la bandeja de salida');
    }

    // Espera progresiva cuando no hay nada que hacer: con la bandeja vacía no
    // tiene sentido consultar cada dos segundos, y la latencia importa poco
    // porque el primer evento que llegue reinicia el contador.
    const wait = Math.min(POLL_INTERVAL_MS * Math.min(idle + 1, 8), 30_000);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
};

const shutdown = (signal: string): void => {
  logger.info({ signal }, 'deteniendo el trabajador');
  running = false;
  void container.close().then(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

await loop();
