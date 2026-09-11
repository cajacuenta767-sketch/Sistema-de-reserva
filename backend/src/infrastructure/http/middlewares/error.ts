import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../../shared/AppError.js';
import { logger } from '../../../shared/logger.js';

export const notFoundHandler = (_req: Request, res: Response) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } });
};

export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details ?? null } });
    return;
  }
  const anyErr = err as { type?: string; status?: number; message?: string };
  if (anyErr?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'JSON inválido' } });
    return;
  }
  logger.error({ err }, 'Error no controlado');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno del servidor' } });
};
