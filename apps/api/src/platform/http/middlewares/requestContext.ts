import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
// Necesario para que la ampliación de abajo resuelva el módulo.
import type {} from 'express-serve-static-core';
import type { RequestContext } from '../../authz/RequestContext.js';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
    /** Contexto completo. Null en endpoints públicos o si no hay organización activa. */
    ctx: RequestContext | null;
    /** Identidad autenticada antes de resolver la organización. */
    auth: { userId: string; email: string; isSuperAdmin: boolean } | null;
  }
}

/**
 * Asigna un identificador a cada petición. Aparece en los logs, en las
 * respuestas de error y en la auditoría, de modo que un usuario puede reportar
 * un error con su código y se encuentra la traza exacta.
 */
export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && incoming.length <= 100 ? incoming : randomUUID();
  req.ctx = null;
  req.auth = null;
  res.setHeader('x-request-id', req.requestId);
  next();
};
