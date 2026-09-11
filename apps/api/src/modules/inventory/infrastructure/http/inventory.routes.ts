import { Router } from 'express';
import { z } from 'zod';
import { idParam, listQuerySchema } from '@erp/contracts';
import type { ModuleContext } from '../../../../platform/modules/types.js';
import { q, validate } from '../../../../platform/http/middlewares/validate.js';
import { requireOrganization } from '../../../../platform/http/middlewares/auth.js';
import { listQueryOf, tenantRoute } from '../../../../platform/http/handlers.js';
import type { WarehouseUseCases } from '../../application/use-cases/WarehouseUseCases.js';
import type { StockUseCases } from '../../application/use-cases/StockUseCases.js';
import type { CountUseCases } from '../../application/use-cases/CountUseCases.js';

const quantity = z.string().regex(/^-?\d+(\.\d{1,6})?$/, 'Cantidad inválida');
const money = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Importe inválido');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)');

const warehouseBody = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  branchId: z.uuid().nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const moveBody = z.object({
  productId: z.uuid(),
  warehouseId: z.uuid().nullable().optional(),
  lotId: z.uuid().nullable().optional(),
  quantity: quantity,
  unitCost: money.optional(),
  kind: z.enum(['RECEIPT', 'ISSUE', 'RETURN_IN', 'RETURN_OUT', 'OPENING']),
  moveDate: isoDate.optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

const adjustBody = z.object({
  productId: z.uuid(),
  warehouseId: z.uuid().nullable().optional(),
  counted: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Cantidad inválida'),
  reason: z.string().trim().min(1).max(500),
});

const kardexQuery = z.object({
  productId: z.uuid(),
  warehouseId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const inventoryRoutes = (
  ctx: ModuleContext,
  api: { warehouses: WarehouseUseCases; stock: StockUseCases; counts: CountUseCases },
): Router => {
  const r = Router();
  const { pool, requirePermission: can } = ctx;
  r.use(requireOrganization);

  // ── Bodegas ───────────────────────────────────────────────────────────────
  r.get(
    '/warehouses',
    can('inventory:warehouse:read'),
    validate({ query: listQuerySchema }),
    tenantRoute(pool, (tx, c, req) => api.warehouses.list(c, tx, listQueryOf(req))),
  );

  r.get(
    '/warehouses/all',
    can('inventory:warehouse:read'),
    tenantRoute(pool, async (tx, c) => ({ items: await api.warehouses.all(c, tx) })),
  );

  r.get(
    '/warehouses/:id',
    can('inventory:warehouse:read'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.warehouses.get(c, tx, String(req.params.id))),
  );

  r.post(
    '/warehouses',
    can('inventory:warehouse:create'),
    validate({ body: warehouseBody }),
    tenantRoute(pool, (tx, c, req) => api.warehouses.create(c, tx, warehouseBody.parse(req.body)), 201),
  );

  r.patch(
    '/warehouses/:id',
    can('inventory:warehouse:update'),
    validate({ params: idParam, body: warehouseBody.partial() }),
    tenantRoute(pool, (tx, c, req) =>
      api.warehouses.update(c, tx, String(req.params.id), warehouseBody.partial().parse(req.body)),
    ),
  );

  r.delete(
    '/warehouses/:id',
    can('inventory:warehouse:delete'),
    validate({ params: idParam }),
    tenantRoute(pool, async (tx, c, req) => {
      await api.warehouses.remove(c, tx, String(req.params.id));
      return null;
    }),
  );

  // ── Existencias y movimientos ─────────────────────────────────────────────
  r.get(
    '/stock',
    can('inventory:stock:read'),
    validate({ query: listQuerySchema }),
    tenantRoute(pool, (tx, c, req) => api.stock.levels(c, tx, listQueryOf(req))),
  );

  r.get(
    '/stock/moves',
    can('inventory:move:read'),
    validate({ query: listQuerySchema }),
    tenantRoute(pool, (tx, c, req) => api.stock.listMoves(c, tx, listQueryOf(req))),
  );

  /** Kardex: el movimiento de un producto en orden, con su saldo en cada paso. */
  r.get(
    '/stock/kardex',
    can('inventory:move:read'),
    validate({ query: kardexQuery }),
    tenantRoute(pool, async (tx, c, req) => {
      const query = q<z.infer<typeof kardexQuery>>(req);
      const today = api.stock.today();
      return {
        items: await api.stock.kardex(
          c,
          tx,
          query.productId,
          query.warehouseId ?? null,
          query.from ?? `${today.slice(0, 4)}-01-01`,
          query.to ?? today,
        ),
      };
    }),
  );

  r.post(
    '/stock/moves',
    can('inventory:move:create'),
    validate({ body: moveBody }),
    tenantRoute(pool, (tx, c, req) => api.stock.move(c, tx, moveBody.parse(req.body)), 201),
  );

  r.post(
    '/stock/adjust',
    can('inventory:move:adjust'),
    validate({ body: adjustBody }),
    tenantRoute(pool, (tx, c, req) => api.stock.adjust(c, tx, adjustBody.parse(req.body)), 201),
  );

  // ── Conteos ───────────────────────────────────────────────────────────────
  r.get(
    '/stock-counts',
    can('inventory:count:read'),
    validate({ query: listQuerySchema }),
    tenantRoute(pool, (tx, c, req) => api.counts.list(c, tx, listQueryOf(req))),
  );

  r.get(
    '/stock-counts/:id',
    can('inventory:count:read'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.counts.get(c, tx, String(req.params.id))),
  );

  r.post(
    '/stock-counts',
    can('inventory:count:create'),
    validate({
      body: z.object({
        warehouseId: z.uuid(),
        countDate: isoDate.optional(),
        notes: z.string().trim().max(500).nullable().optional(),
      }),
    }),
    tenantRoute(
      pool,
      (tx, c, req) =>
        api.counts.open(
          c,
          tx,
          z
            .object({
              warehouseId: z.uuid(),
              countDate: isoDate.optional(),
              notes: z.string().trim().nullable().optional(),
            })
            .parse(req.body),
        ),
      201,
    ),
  );

  r.patch(
    '/stock-counts/:id/lines/:lineId',
    can('inventory:count:update'),
    validate({
      params: z.object({ id: z.uuid(), lineId: z.uuid() }),
      body: z.object({
        counted: z.string().regex(/^\d+(\.\d{1,6})?$/).nullable(),
        notes: z.string().trim().max(300).nullable().optional(),
      }),
    }),
    tenantRoute(pool, (tx, c, req) => {
      const body = z
        .object({ counted: z.string().nullable(), notes: z.string().trim().nullable().optional() })
        .parse(req.body);
      return api.counts.setCounted(
        c,
        tx,
        String(req.params.id),
        String(req.params.lineId),
        body.counted,
        body.notes ?? null,
      );
    }),
  );

  r.post(
    '/stock-counts/:id/apply',
    can('inventory:count:apply'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.counts.apply(c, tx, String(req.params.id))),
  );

  r.post(
    '/stock-counts/:id/cancel',
    can('inventory:count:update'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.counts.cancel(c, tx, String(req.params.id))),
  );

  return r;
};
