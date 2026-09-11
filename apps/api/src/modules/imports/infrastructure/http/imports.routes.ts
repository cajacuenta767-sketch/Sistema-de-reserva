import { Router } from 'express';
import { z } from 'zod';
import { idParam, listQuerySchema } from '@erp/contracts';
import type { ModuleContext } from '../../../../platform/modules/types.js';
import { validate } from '../../../../platform/http/middlewares/validate.js';
import { requireOrganization } from '../../../../platform/http/middlewares/auth.js';
import { listQueryOf, tenantRoute } from '../../../../platform/http/handlers.js';
import type { ImportUseCases } from '../../application/use-cases/ImportUseCases.js';

/**
 * 8 MB de CSV son del orden de 80.000 filas: más que suficiente para el catálogo
 * o la cartera de clientes de una pyme, y poco para que una petición mal formada
 * agote la memoria del proceso.
 */
const MAX_CONTENT = 8 * 1024 * 1024;

const uploadBody = z.object({
  entityType: z.string().trim().min(1).max(60),
  filename: z.string().trim().min(1).max(255),
  content: z.string().min(1).max(MAX_CONTENT, 'El fichero supera los 8 MB'),
  delimiter: z.enum([',', ';', '\t', '|']).optional(),
});

export const importsRoutes = (ctx: ModuleContext, api: { imports: ImportUseCases }): Router => {
  const r = Router();
  const { requirePermission, pool } = ctx;
  const guard = [requireOrganization] as const;

  /** Qué puede importar este usuario, con los campos de cada entidad. */
  r.get(
    '/imports/catalog',
    ...guard,
    requirePermission('platform:import:read'),
    tenantRoute(pool, async (_tx, c) => ({ items: api.imports.catalog(c) })),
  );

  r.get(
    '/imports',
    ...guard,
    requirePermission('platform:import:read'),
    validate({ query: listQuerySchema }),
    tenantRoute(pool, (tx, c, req) => api.imports.list(c, tx, listQueryOf(req))),
  );

  r.post(
    '/imports',
    ...guard,
    requirePermission('platform:import:create'),
    validate({ body: uploadBody }),
    tenantRoute(pool, (tx, c, req) => api.imports.upload(c, tx, req.body), 201),
  );

  r.get(
    '/imports/:id',
    ...guard,
    requirePermission('platform:import:read'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.imports.get(c, tx, req.params.id as string)),
  );

  /** Filas con su estado y su error: el informe que se revisa tras importar. */
  r.get(
    '/imports/:id/rows',
    ...guard,
    requirePermission('platform:import:read'),
    validate({ params: idParam, query: listQuerySchema }),
    tenantRoute(pool, (tx, c, req) => api.imports.rows(c, tx, req.params.id as string, listQueryOf(req))),
  );

  r.patch(
    '/imports/:id/mapping',
    ...guard,
    requirePermission('platform:import:create'),
    validate({
      params: idParam,
      body: z.object({ mapping: z.record(z.string().max(60), z.string().max(200)) }),
    }),
    tenantRoute(pool, (tx, c, req) =>
      api.imports.setMapping(c, tx, req.params.id as string, req.body.mapping),
    ),
  );

  r.post(
    '/imports/:id/run',
    ...guard,
    requirePermission('platform:import:create'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.imports.run(c, tx, req.params.id as string)),
  );

  r.delete(
    '/imports/:id',
    ...guard,
    requirePermission('platform:import:create'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.imports.remove(c, tx, req.params.id as string), 204),
  );

  return r;
};
