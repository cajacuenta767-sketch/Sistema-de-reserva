import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import type {} from 'express-serve-static-core';
import { AppError } from '@erp/core';

type Part = 'body' | 'query' | 'params';

declare module 'express-serve-static-core' {
  interface Request {
    validatedQuery?: unknown;
  }
}

/**
 * Validación en el borde: nada entra al dominio sin pasar por un esquema.
 *
 * Ojo con Express 5: `req.query` es un getter de solo lectura, así que el
 * resultado parseado se guarda aparte y se lee con el helper `q<T>(req)`.
 * Escribir `req.query = ...` lanza en tiempo de ejecución.
 */
export const validate = (schemas: Partial<Record<Part, ZodType>>): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction) => {
    for (const part of ['params', 'query', 'body'] as Part[]) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);
      if (!result.success) {
        return next(
          AppError.validation(
            'Datos inválidos',
            result.error.issues.map((i) => ({
              path: [part, ...i.path.map(String)].join('.'),
              message: i.message,
            })),
          ),
        );
      }

      if (part === 'query') {
        req.validatedQuery = result.data;
      } else if (part === 'body') {
        req.body = result.data;
      } else {
        Object.assign(req.params, result.data);
      }
    }
    next();
  };
};

/** Lee la query ya validada. NUNCA uses `req.query` directamente tras validar. */
export const q = <T>(req: Request): T => (req.validatedQuery as T) ?? (req.query as T);
