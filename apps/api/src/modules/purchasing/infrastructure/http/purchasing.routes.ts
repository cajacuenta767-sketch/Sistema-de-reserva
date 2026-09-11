import { Router } from 'express';
import { z } from 'zod';
import { idParam, listQuerySchema } from '@erp/contracts';
import type { ModuleContext } from '../../../../platform/modules/types.js';
import { validate } from '../../../../platform/http/middlewares/validate.js';
import { requireOrganization } from '../../../../platform/http/middlewares/auth.js';
import { listQueryOf, tenantRoute } from '../../../../platform/http/handlers.js';
import type { PurchaseOrderUseCases } from '../../application/use-cases/PurchaseUseCases.js';
import type { ReceiptUseCases } from '../../application/use-cases/ReceiptUseCases.js';
import type { BillUseCases } from '../../application/use-cases/BillUseCases.js';

const money = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Importe inválido');
const quantity = z.string().regex(/^\d+(\.\d{1,6})?$/, 'Cantidad inválida');
const rate = z.string().regex(/^\d+(\.\d{1,6})?$/, 'Porcentaje inválido');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)');
const reasonBody = z.object({ reason: z.string().trim().min(1).max(500) });

const orderBody = z.object({
  partyId: z.uuid(),
  warehouseId: z.uuid().nullable().optional(),
  orderDate: isoDate.optional(),
  expectedDate: isoDate.nullable().optional(),
  currencyCode: z.string().length(3).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  terms: z.string().trim().max(2000).nullable().optional(),
  lines: z
    .array(
      z.object({
        productId: z.uuid().nullable().optional(),
        description: z.string().trim().max(300).optional(),
        quantity: quantity,
        unitPrice: money.optional(),
        discountPercent: rate.optional(),
        taxId: z.uuid().nullable().optional(),
      }),
    )
    .min(1),
});

const receiptBody = z.object({
  partyId: z.uuid(),
  orderId: z.uuid().nullable().optional(),
  warehouseId: z.uuid(),
  receiptDate: isoDate.optional(),
  reference: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  lines: z
    .array(
      z.object({
        orderLineId: z.uuid().nullable().optional(),
        productId: z.uuid(),
        lotId: z.uuid().nullable().optional(),
        description: z.string().trim().max(300).optional(),
        quantity: quantity,
        unitCost: money.optional(),
      }),
    )
    .min(1),
});

const billBody = z.object({
  supplierNumber: z.string().trim().min(1).max(60),
  partyId: z.uuid(),
  orderId: z.uuid().nullable().optional(),
  receiptId: z.uuid().nullable().optional(),
  issueDate: isoDate.optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  currencyCode: z.string().length(3).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  withholdingTaxIds: z.array(z.uuid()).optional(),
  lines: z
    .array(
      z.object({
        productId: z.uuid().nullable().optional(),
        accountId: z.uuid().nullable().optional(),
        description: z.string().trim().max(300).optional(),
        quantity: quantity,
        unitPrice: money,
        discountPercent: rate.optional(),
      }),
    )
    .min(1),
});

export const purchasingRoutes = (
  ctx: ModuleContext,
  api: { orders: PurchaseOrderUseCases; receipts: ReceiptUseCases; bills: BillUseCases },
): Router => {
  const r = Router();
  const { pool, requirePermission: can } = ctx;
  r.use(requireOrganization);

  // ── Órdenes ───────────────────────────────────────────────────────────────
  r.get(
    '/orders',
    can('purchasing:order:read'),
    validate({ query: listQuerySchema }),
    tenantRoute(pool, (tx, c, req) => api.orders.list(c, tx, listQueryOf(req))),
  );

  r.get(
    '/overview',
    can('purchasing:order:read'),
    tenantRoute(pool, (tx, c) => api.orders.overview(c, tx)),
  );

  r.get(
    '/orders/:id',
    can('purchasing:order:read'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.orders.get(c, tx, String(req.params.id))),
  );

  r.post(
    '/orders',
    can('purchasing:order:create'),
    validate({ body: orderBody }),
    tenantRoute(pool, (tx, c, req) => api.orders.create(c, tx, orderBody.parse(req.body)), 201),
  );

  r.put(
    '/orders/:id',
    can('purchasing:order:update'),
    validate({ params: idParam, body: orderBody }),
    tenantRoute(pool, (tx, c, req) =>
      api.orders.update(c, tx, String(req.params.id), orderBody.parse(req.body)),
    ),
  );

  r.post(
    '/orders/:id/send',
    can('purchasing:order:send'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.orders.send(c, tx, String(req.params.id))),
  );

  r.post(
    '/orders/:id/cancel',
    can('purchasing:order:update'),
    validate({ params: idParam, body: reasonBody }),
    tenantRoute(pool, (tx, c, req) =>
      api.orders.cancel(c, tx, String(req.params.id), reasonBody.parse(req.body).reason),
    ),
  );

  r.delete(
    '/orders/:id',
    can('purchasing:order:delete'),
    validate({ params: idParam }),
    tenantRoute(pool, async (tx, c, req) => {
      await api.orders.remove(c, tx, String(req.params.id));
      return null;
    }),
  );

  // ── Recepciones ───────────────────────────────────────────────────────────
  r.get(
    '/receipts',
    can('purchasing:receipt:read'),
    validate({ query: listQuerySchema }),
    tenantRoute(pool, (tx, c, req) => api.receipts.list(c, tx, listQueryOf(req))),
  );

  r.get(
    '/receipts/:id',
    can('purchasing:receipt:read'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.receipts.get(c, tx, String(req.params.id))),
  );

  r.post(
    '/receipts',
    can('purchasing:receipt:create'),
    validate({ body: receiptBody }),
    tenantRoute(pool, (tx, c, req) => api.receipts.create(c, tx, receiptBody.parse(req.body)), 201),
  );

  r.post(
    '/receipts/:id/post',
    can('purchasing:receipt:post'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.receipts.post(c, tx, String(req.params.id))),
  );

  r.post(
    '/receipts/:id/void',
    can('purchasing:receipt:void'),
    validate({ params: idParam, body: reasonBody }),
    tenantRoute(pool, (tx, c, req) =>
      api.receipts.void(c, tx, String(req.params.id), reasonBody.parse(req.body).reason),
    ),
  );

  // ── Facturas de proveedor ─────────────────────────────────────────────────
  r.get(
    '/bills',
    can('purchasing:bill:read'),
    validate({ query: listQuerySchema }),
    tenantRoute(pool, (tx, c, req) => api.bills.list(c, tx, listQueryOf(req))),
  );

  r.get(
    '/bills/payable',
    can('purchasing:bill:read'),
    tenantRoute(pool, async (tx, c) => ({ items: await api.bills.payable(c, tx) })),
  );

  r.get(
    '/bills/open/:partyId',
    can('purchasing:bill:read'),
    validate({ params: z.object({ partyId: z.uuid() }) }),
    tenantRoute(pool, async (tx, c, req) => ({
      items: await api.bills.openForParty(c, tx, String(req.params.partyId)),
    })),
  );

  r.get(
    '/bills/:id',
    can('purchasing:bill:read'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.bills.get(c, tx, String(req.params.id))),
  );

  r.post(
    '/bills',
    can('purchasing:bill:create'),
    validate({ body: billBody }),
    tenantRoute(pool, (tx, c, req) => api.bills.create(c, tx, billBody.parse(req.body)), 201),
  );

  r.post(
    '/bills/:id/post',
    can('purchasing:bill:post'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.bills.post(c, tx, String(req.params.id))),
  );

  r.post(
    '/bills/:id/void',
    can('purchasing:bill:void'),
    validate({ params: idParam, body: reasonBody }),
    tenantRoute(pool, (tx, c, req) =>
      api.bills.void(c, tx, String(req.params.id), reasonBody.parse(req.body).reason),
    ),
  );

  return r;
};
