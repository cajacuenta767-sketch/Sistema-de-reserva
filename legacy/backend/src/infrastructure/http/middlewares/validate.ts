import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../../../shared/AppError.js';

type Part = 'body' | 'query' | 'params';

export const validate = (schemas: Partial<Record<Part, ZodType>>) => (req: Request, _res: Response, next: NextFunction) => {
  for (const part of ['params', 'query', 'body'] as Part[]) {
    const schema = schemas[part];
    if (!schema) continue;
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      return next(
        AppError.validation(
          'Datos inválidos',
          result.error.issues.map((i) => ({ path: `${part}.${i.path.join('.')}`, message: i.message })),
        ),
      );
    }
    if (part === 'query') {
      // Express 5 expone req.query como getter; guardamos la versión parseada aparte.
      (req as Request & { validatedQuery?: unknown }).validatedQuery = result.data;
    } else {
      (req as any)[part] = result.data;
    }
  }
  next();
};

export const q = <T>(req: Request): T => ((req as Request & { validatedQuery?: T }).validatedQuery ?? (req.query as T));
