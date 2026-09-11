import type pg from 'pg';
import { SystemClock, type Clock } from '@erp/core';
import type { Env } from '../../config/env.js';
import { createLogger, type Logger } from '../logging/logger.js';
import { openDatabase } from '../db/client.js';
import { AuditRecorder } from '../audit/AuditRecorder.js';
import { PermissionCatalog } from '../authz/catalog.js';
import { EventBus } from '../events/EventBus.js';
import { InMemoryJobQueue, type JobQueue } from '../jobs/Jobs.js';
import { ConsoleMailer, type Mailer } from '../mail/Mailer.js';
import { SequenceAllocator } from '../numbering/SequenceAllocator.js';
import { GlobalSearchRegistry } from '../search/GlobalSearchRegistry.js';
import { LocalDiskStorage, type FileStorage } from '../storage/FileStorage.js';
import { JwtTokenService } from '../security/JwtTokenService.js';
import { ScryptPasswordHasher } from '../security/ScryptPasswordHasher.js';
import { createRequirePermission } from '../http/middlewares/requirePermission.js';
import { ModuleRegistry } from './registry.js';
import type { AnyModule, ModuleContext } from './types.js';

export interface ContainerOverrides {
  clock?: Clock;
  pool?: pg.Pool;
  logger?: Logger;
  mailer?: Mailer;
  storage?: FileStorage;
  jobs?: JobQueue;
}

export interface Container {
  env: Env;
  logger: Logger;
  pool: pg.Pool;
  ctx: ModuleContext;
  registry: ModuleRegistry;
  permissions: PermissionCatalog;
  events: EventBus;
  mailer: Mailer;
  close(): Promise<void>;
}

/**
 * Raíz de composición.
 *
 * Este archivo NO crece con el sistema: da igual que haya 5 módulos o 30, porque
 * construye la plataforma una vez y luego recorre la lista en bucle. La única
 * lista que crece es `modules/index.ts`.
 */
export const buildContainer = (
  env: Env,
  modules: readonly AnyModule[],
  overrides: ContainerOverrides = {},
): Container => {
  const logger = overrides.logger ?? createLogger(env);
  const clock = overrides.clock ?? new SystemClock();

  let ownedClose: (() => Promise<void>) | null = null;
  let pool: pg.Pool;
  if (overrides.pool) {
    pool = overrides.pool;
  } else {
    const handle = openDatabase(env);
    pool = handle.pool;
    ownedClose = handle.close;
  }

  const permissions = new PermissionCatalog();
  const events = new EventBus(logger, clock);
  const search = new GlobalSearchRegistry();
  const jobs = overrides.jobs ?? new InMemoryJobQueue(logger);
  const mailer = overrides.mailer ?? new ConsoleMailer(logger, clock);
  const storage = overrides.storage ?? new LocalDiskStorage(env.STORAGE_LOCAL_PATH);
  const registry = new ModuleRegistry();

  const ctx: ModuleContext = {
    env,
    logger,
    clock,
    pool,
    events,
    audit: new AuditRecorder(),
    sequences: new SequenceAllocator(),
    storage,
    mailer,
    tokens: new JwtTokenService({
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessTtl: env.JWT_ACCESS_TTL,
      refreshTtl: env.JWT_REFRESH_TTL,
    }),
    hasher: new ScryptPasswordHasher(),
    permissions,
    jobs,
    search,
    requirePermission: createRequirePermission(permissions),
    module: <T>(id: string): T => registry.get<T>(id),
  };

  for (const def of ModuleRegistry.sort(modules)) {
    registry.register(def, ctx);
  }
  registry.wire(ctx);

  return {
    env,
    logger,
    pool,
    ctx,
    registry,
    permissions,
    events,
    mailer,
    close: async () => {
      await jobs.stop();
      if (ownedClose) await ownedClose();
    },
  };
};
