import type { PermissionSet } from '@erp/contracts';
import { AppError } from '@erp/core';

/**
 * Todo lo que un caso de uso necesita saber sobre QUIÉN está pidiendo algo.
 * Se construye una vez por petición y se pasa como primer argumento a cada caso
 * de uso, que así nunca toca `req` ni conoce el protocolo HTTP.
 */
export interface RequestContext {
  requestId: string;
  organizationId: string;
  membershipId: string;
  branchId: string | null;
  user: { id: string; email: string; fullName: string };
  permissions: PermissionSet;
  /** Membresías del equipo del usuario: resuelve el alcance TEAM. */
  teamMemberIds: string[];
  /** Sucursales a las que tiene acceso: resuelve el alcance BRANCH. */
  branchIds: string[];
  isOwner: boolean;
  isSuperAdmin: boolean;
  /**
   * El actor es el sistema, no una persona.
   *
   * Importa porque `membershipId` apunta a una fila de `memberships` en varias
   * claves foráneas (auditoría, quién contabilizó, quién cerró el periodo) y el
   * sistema no tiene membresía. Sin distinguirlo, cualquier módulo que escriba
   * desde un suscriptor de eventos viola la clave foránea, y el error sale como
   * un 409 en la operación del usuario sin nada que lo relacione con la causa.
   */
  isSystem?: boolean;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

/** Contexto anónimo: se usa en endpoints públicos y en trabajos de plataforma. */
export type MaybeContext = RequestContext | null;

export const requireContext = (ctx: MaybeContext): RequestContext => {
  if (!ctx) throw AppError.unauthorized('Necesitas iniciar sesión');
  return ctx;
};

/** Contexto sintético para trabajos en segundo plano y semillas. */
export const systemContext = (organizationId: string, requestId = 'system'): RequestContext => ({
  requestId,
  organizationId,
  membershipId: '00000000-0000-4000-8000-000000000000',
  branchId: null,
  user: { id: '00000000-0000-4000-8000-000000000000', email: 'system', fullName: 'Sistema' },
  permissions: {
    can: () => true,
    scopeOf: () => 'ORG',
    canWithScope: () => true,
    canAny: () => true,
    canAll: () => true,
    toJSON: () => ({ '*': 'ORG' }),
    isSuperAdmin: true,
    size: 0,
  } as unknown as PermissionSet,
  teamMemberIds: [],
  branchIds: [],
  isOwner: true,
  isSuperAdmin: true,
  isSystem: true,
});

/**
 * Membresía a la que atribuir un cambio, o `null` si lo hizo el sistema.
 *
 * Todas las columnas `*_by` con clave foránea a `memberships` pasan por aquí.
 * El sistema queda identificado por la etiqueta del actor, que es texto libre y
 * no depende de que exista una fila.
 */
export const actorMembershipId = (ctx: RequestContext): string | null =>
  ctx.isSystem ? null : ctx.membershipId;
