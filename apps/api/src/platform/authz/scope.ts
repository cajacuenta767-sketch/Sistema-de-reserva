import { AppError } from '@erp/core';
import type { PermissionScope } from '@erp/contracts';
import type { RequestContext } from './RequestContext.js';

/**
 * Traduce el alcance de un permiso a un filtro de repositorio.
 *
 * El error clásico de los ERP es listar todo y filtrar en memoria: funciona con
 * 10 filas y filtra datos ajenos con 10.000. Aquí el alcance se EMPUJA a la
 * consulta, y `ListQuery` no tiene forma de recibir la lista sin filtro porque el
 * caso de uso siempre fusiona este resultado.
 *
 * Además, los contadores y agregados de los widgets usan exactamente el mismo
 * filtro, así que el Escritorio nunca muestra cifras que el usuario no pueda abrir.
 */
export interface ScopeFilter {
  /** Solo lo que le pertenece a esta membresía. */
  ownerMembershipId?: string;
  /** Lo de cualquier miembro de sus equipos. */
  ownerMembershipIdIn?: string[];
  /** Lo de las sucursales a las que tiene acceso. */
  branchIdIn?: string[];
}

export const scopeFilter = (ctx: RequestContext, permissionKey: string): ScopeFilter => {
  if (ctx.isSuperAdmin) return {};

  const scope: PermissionScope | null = ctx.permissions.scopeOf(permissionKey);
  if (scope === null) {
    throw AppError.forbidden(`Te falta el permiso ${permissionKey}`, { permission: permissionKey });
  }

  switch (scope) {
    case 'OWN':
      return { ownerMembershipId: ctx.membershipId };
    case 'TEAM':
      // Incluye siempre al propio usuario: alguien sin equipo asignado
      // seguiría viendo lo suyo.
      return { ownerMembershipIdIn: [...new Set([ctx.membershipId, ...ctx.teamMemberIds])] };
    case 'BRANCH':
      return { branchIdIn: ctx.branchIds };
    case 'ORG':
      // RLS ya limita a la organización: no hace falta filtro adicional.
      return {};
  }
};

/**
 * Comprueba si un registro concreto cae dentro del alcance del usuario.
 * Se usa al leer o modificar UNA fila, donde no hay consulta que filtrar.
 */
export const isWithinScope = (
  ctx: RequestContext,
  permissionKey: string,
  record: { ownerMembershipId?: string | null; branchId?: string | null },
): boolean => {
  if (ctx.isSuperAdmin) return true;
  const scope = ctx.permissions.scopeOf(permissionKey);
  if (scope === null) return false;

  switch (scope) {
    case 'OWN':
      return record.ownerMembershipId === ctx.membershipId;
    case 'TEAM':
      return (
        record.ownerMembershipId === ctx.membershipId ||
        (record.ownerMembershipId != null && ctx.teamMemberIds.includes(record.ownerMembershipId))
      );
    case 'BRANCH':
      return record.branchId == null || ctx.branchIds.includes(record.branchId);
    case 'ORG':
      return true;
  }
};

export const assertWithinScope = (
  ctx: RequestContext,
  permissionKey: string,
  record: { ownerMembershipId?: string | null; branchId?: string | null },
  what = 'este registro',
): void => {
  if (!isWithinScope(ctx, permissionKey, record)) {
    throw AppError.forbidden(`No tienes acceso a ${what}`, { permission: permissionKey });
  }
};

export const assertCan = (ctx: RequestContext, permissionKey: string): void => {
  if (!ctx.permissions.can(permissionKey)) {
    throw AppError.forbidden(`Te falta el permiso ${permissionKey}`, { permission: permissionKey });
  }
};
