import type { RequestHandler } from 'express';
import { AppError } from '@erp/core';
import type { PermissionCatalog } from '../../authz/catalog.js';

/**
 * Puerta gruesa: rechaza sin tocar la base de datos.
 *
 * Verifica además que el permiso EXISTA en el catálogo. Un typo como
 * `sales:invoce:create` no concedería nada a nadie y el endpoint quedaría
 * inaccesible en silencio; aquí revienta al arrancar los tests.
 */
export const createRequirePermission = (catalog: PermissionCatalog) => {
  const requirePermission = (...keys: string[]): RequestHandler => {
    for (const key of keys) {
      if (!catalog.has(key)) {
        throw new Error(
          `El permiso "${key}" no está declarado en ningún módulo. ` +
            'Decláralo en el module.ts correspondiente antes de exigirlo en una ruta.',
        );
      }
    }
    return (req, _res, next) => {
      if (!req.auth) return next(AppError.unauthorized('Necesitas iniciar sesión'));
      if (!req.ctx) return next(AppError.forbidden('No has seleccionado una organización'));
      // Basta con uno: varias claves significan "cualquiera de estas".
      if (!req.ctx.permissions.canAny(keys)) {
        return next(
          AppError.forbidden(
            keys.length === 1
              ? `Te falta el permiso ${keys[0]}`
              : `Te falta alguno de estos permisos: ${keys.join(', ')}`,
            { permissions: keys },
          ),
        );
      }
      next();
    };
  };
  return requirePermission;
};

export type RequirePermission = ReturnType<typeof createRequirePermission>;
