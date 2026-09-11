import type { RequestHandler } from 'express';
import { AppError } from '@erp/core';
import type { RequestContext } from '../../authz/RequestContext.js';
import type { TokenService } from '../../security/JwtTokenService.js';

/**
 * Puerto que resuelve la identidad. La plataforma NO puede importar el módulo
 * `identity` (la regla de boundaries lo impide y con razón: la plataforma debe
 * poder existir sin ningún módulo), así que el módulo implementa esta interfaz
 * y el contenedor la inyecta.
 */
export interface ContextLoader {
  /** Organización a usar si la petición no indica ninguna. */
  defaultOrganizationFor(userId: string): Promise<string | null>;
  /** Construye el contexto completo: membresía, roles, permisos, equipos, sucursales. */
  loadContext(input: {
    userId: string;
    organizationId: string;
    requestId: string;
    ip?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<RequestContext | null>;
}

const bearer = (header: string | undefined): string | null => {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
};

/**
 * Autenticación permisiva: si hay token válido puebla `req.auth` y `req.ctx`;
 * si no, deja pasar como anónimo. Son `requireAuth` y `requirePermission` los
 * que deciden qué exige cada ruta, de modo que un endpoint público y uno privado
 * se declaran igual de explícitamente.
 */
export const createAuthenticate = (tokens: TokenService, loader: ContextLoader): RequestHandler => {
  return (req, _res, next) => {
    const token = bearer(req.header('authorization'));
    if (!token) return next();

    void (async () => {
      try {
        const payload = tokens.verifyAccess(token);
        req.auth = {
          userId: payload.sub,
          email: payload.email,
          isSuperAdmin: payload.sa === true,
        };

        // La organización activa puede cambiarse por cabecera sin reemitir el
        // token: el frontend la manda en cada petición al cambiar de empresa.
        const requested = req.header('x-organization-id') ?? payload.org ?? null;
        const organizationId = requested ?? (await loader.defaultOrganizationFor(payload.sub));
        if (!organizationId) return next();

        req.ctx = await loader.loadContext({
          userId: payload.sub,
          organizationId,
          requestId: req.requestId,
          ip: req.ip,
          userAgent: req.header('user-agent'),
        });
        next();
      } catch (err) {
        next(err);
      }
    })();
  };
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(AppError.unauthorized('Necesitas iniciar sesión'));
  next();
};

/** Exige sesión iniciada Y una organización activa a la que pertenezca. */
export const requireOrganization: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(AppError.unauthorized('Necesitas iniciar sesión'));
  if (!req.ctx) {
    return next(AppError.forbidden('No perteneces a esta organización o no has seleccionado ninguna'));
  }
  next();
};
