import type { Router } from 'express';
import type { PermissionDef } from '@erp/contracts';
import type { Clock } from '@erp/core';
import type pg from 'pg';
import type { Env } from '../../config/env.js';
import type { Logger } from '../logging/logger.js';
import type { AuditRecorder } from '../audit/AuditRecorder.js';
import type { PermissionCatalog } from '../authz/catalog.js';
import type { EventBus, EventSubscription } from '../events/EventBus.js';
import type { JobDefinition, JobQueue } from '../jobs/Jobs.js';
import type { Mailer } from '../mail/Mailer.js';
import type { SequenceAllocator } from '../numbering/SequenceAllocator.js';
import type { GlobalSearchRegistry, SearchProvider } from '../search/GlobalSearchRegistry.js';
import type { ImportDefinition, ImportRegistry } from '../imports/ImportRegistry.js';
import type { FileStorage } from '../storage/FileStorage.js';
import type { PasswordHasher } from '../security/ScryptPasswordHasher.js';
import type { TokenService } from '../security/JwtTokenService.js';
import type { RequirePermission } from '../http/middlewares/requirePermission.js';

/** Todo lo que la plataforma ofrece a un módulo. Nada más, y nada menos. */
export interface ModuleContext {
  env: Env;
  logger: Logger;
  clock: Clock;
  pool: pg.Pool;
  events: EventBus;
  audit: AuditRecorder;
  sequences: SequenceAllocator;
  storage: FileStorage;
  mailer: Mailer;
  tokens: TokenService;
  hasher: PasswordHasher;
  permissions: PermissionCatalog;
  jobs: JobQueue;
  search: GlobalSearchRegistry;
  imports: ImportRegistry;
  requirePermission: RequirePermission;
  /** Acceso a la API pública de otro módulo. Resuélvelo dentro del caso de uso,
   *  nunca en `register()`: en `register()` aún puede no existir. */
  module: <T = unknown>(id: string) => T;
}

/**
 * Contrato de un módulo de negocio.
 *
 * El módulo se registra a sí mismo: declara sus permisos, construye sus
 * repositorios y casos de uso, y devuelve su API pública. `container.ts` no
 * conoce ningún módulo concreto y por eso no crece: la única lista que crece es
 * `modules/index.ts`, con una línea por módulo.
 */
export interface ModuleDefinition<Id extends string = string, TApi = unknown> {
  id: Id;
  /** Solo para ordenar el registro. La comunicación real va por eventos. */
  dependsOn?: readonly string[];
  permissions?: readonly PermissionDef[];
  /** Prefijo de montaje, p. ej. `/sales`. Vacío monta en la raíz de /api/v1. */
  basePath?: string;
  register(ctx: ModuleContext): TApi;
  routes?(ctx: ModuleContext, api: TApi): Router;
  subscriptions?(ctx: ModuleContext, api: TApi): readonly EventSubscription[];
  jobs?(ctx: ModuleContext, api: TApi): readonly JobDefinition[];
  search?(ctx: ModuleContext, api: TApi): readonly SearchProvider[];
  /** Entidades que este módulo sabe crear desde un CSV. */
  imports?(ctx: ModuleContext, api: TApi): readonly ImportDefinition[];
  /** Se ejecuta una vez tras registrar todos los módulos. */
  onBoot?(ctx: ModuleContext, api: TApi): Promise<void>;
}

/**
 * Declara un módulo conservando el tipo literal de su `id` y el de su API,
 * que es lo que permite que `module('invoicing')` esté tipado sin genéricos
 * escritos a mano en cada llamada.
 */
export const defineModule = <Id extends string, TApi>(
  def: ModuleDefinition<Id, TApi>,
): ModuleDefinition<Id, TApi> => def;

/** Cualquier módulo, sin conocer su API. `unknown` (no `never`) permite
 *  asignar módulos concretos gracias a la bivarianza de los métodos. */
export type AnyModule = ModuleDefinition<string, unknown>;

type ApiOf<M> = M extends ModuleDefinition<string, infer A> ? A : never;

/** Mapa `id → API pública`, derivado de la lista de módulos. */
export type ModuleApis<T extends readonly AnyModule[]> = {
  [M in T[number] as M['id']]: ApiOf<M>;
};
