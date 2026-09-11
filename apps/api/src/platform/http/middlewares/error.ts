import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express';
import { AppError } from '@erp/core';
import type { Logger } from '../../logging/logger.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } });
};

/** Códigos de PostgreSQL que corresponden a un error del cliente, no del servidor. */
const PG_ERRORS: Record<string, { code: string; status: number; message: string }> = {
  '23505': { code: 'CONFLICT', status: 409, message: 'Ya existe un registro con esos datos' },
  '23503': { code: 'CONFLICT', status: 409, message: 'El registro está referenciado por otros datos' },
  '23514': { code: 'VALIDATION_ERROR', status: 400, message: 'Los datos no cumplen una restricción' },
  '22P02': { code: 'VALIDATION_ERROR', status: 400, message: 'Formato de dato inválido' },
  // Violación de RLS: el usuario intentó escribir en otra organización.
  '42501': { code: 'FORBIDDEN', status: 403, message: 'No tienes acceso a ese recurso' },
};

export const createErrorHandler = (logger: Logger): ErrorRequestHandler => {
  return (err: unknown, req: Request, res: Response, _next) => {
    const requestId = req.requestId;

    if (AppError.is(err)) {
      res.status(err.status).json({
        error: { code: err.code, message: err.message, details: err.details ?? null, requestId },
      });
      return;
    }

    const e = err as { type?: string; code?: string; message?: string; constraint?: string };

    if (e?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'JSON inválido', requestId } });
      return;
    }

    const pg = e?.code ? PG_ERRORS[e.code] : undefined;
    if (pg) {
      logger.warn({ err, requestId, constraint: e.constraint }, 'error de base de datos');
      res.status(pg.status).json({
        error: { code: pg.code, message: pg.message, details: e.constraint ?? null, requestId },
      });
      return;
    }

    logger.error({ err, requestId, path: req.path }, 'error no controlado');
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno del servidor', requestId } });
  };
};
