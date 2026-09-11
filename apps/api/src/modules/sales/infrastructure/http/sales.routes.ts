import { Router } from 'express';
import { z } from 'zod';
import { idParam, listQuerySchema } from '@erp/contracts';
import type { ModuleContext } from '../../../../platform/modules/types.js';
import { validate } from '../../../../platform/http/middlewares/validate.js';
import { requireOrganization } from '../../../../platform/http/middlewares/auth.js';
import { listQueryOf, tenantRoute } from '../../../../platform/http/handlers.js';
import type { InvoiceUseCases } from '../../application/use-cases/InvoiceUseCases.js';
import type { QuoteUseCases } from '../../application/use-cases/QuoteUseCases.js';
import type { PaymentUseCases } from '../../application/use-cases/PaymentUseCases.js';

/** Importes y cantidades viajan como texto: un float pierde centavos en silencio. */
const money = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Importe inválido');
const quantity = z.string().regex(/^\d+(\.\d{1,6})?$/, 'Cantidad inválida');
const percent = z.string().regex(/^\d+(\.\d{1,6})?$/, 'Porcentaje inválido');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)');

const lineBody = z.object({
  productId: z.uuid().nullable().optional(),
  variantId: z.uuid().nullable().optional(),
  description: z.string().trim().max(500).optional(),
  quantity,
  unitPrice: money.optional(),
  discountPercent: percent.optional(),
  taxId: z.uuid().nullable().optional(),
});

const invoiceBody = z.object({
  partyId: z.uuid(),
  issueDate: isoDate.optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  currencyCode: z.string().length(3).optional(),
  priceListId: z.uuid().nullable().optional(),
  globalDiscountPercent: percent.optional(),
  lines: z.array(lineBody).min(1),
  withholdingCodes: z.array(z.string().max(30)).optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  terms: z.string().trim().max(4000).nullable().optional(),
  ownerMembershipId: z.uuid().nullable().optional(),
});

const quoteBody = z.object({
  partyId: z.uuid(),
  contactId: z.uuid().nullable().optional(),
  issueDate: isoDate.optional(),
  validForDays: z.number().int().min(1).max(365).optional(),
  currencyCode: z.string().length(3).optional(),
  priceListId: z.uuid().nullable().optional(),
  globalDiscountPercent: percent.optional(),
  lines: z.array(lineBody).min(1),
  notes: z.string().trim().max(4000).nullable().optional(),
  terms: z.string().trim().max(4000).nullable().optional(),
  ownerMembershipId: z.uuid().nullable().optional(),
});

const paymentBody = z.object({
  partyId: z.uuid(),
  amount: money,
  paymentDate: isoDate.optional(),
  method: z.enum(['CASH', 'TRANSFER', 'CARD', 'CHECK', 'OTHER']).optional(),
  currencyCode: z.string().length(3).optional(),
  reference: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  allocations: z.array(z.object({ invoiceId: z.uuid(), amount: money })).optional(),
});

const reasonBody = z.object({ reason: z.string().trim().min(3).max(500) });

export const salesRoutes = (
  ctx: ModuleContext,
  api: { invoices: InvoiceUseCases; quotes: QuoteUseCases; payments: PaymentUseCases },
): Router => {
  const r = Router();
  const { requirePermission, pool } = ctx;
  const guard = [requireOrganization] as const;

  // ── Cotizaciones ──────────────────────────────────────────────────────────

  r.get(
    '/quotes',
    ...guard,
    requirePermission('sales:quote:read'),
    validate({ query: listQuerySchema }),
    tenantRoute(pool, (tx, c, req) => api.quotes.list(c, tx, listQueryOf(req))),
  );

  r.get(
    '/quotes/:id',
    ...guard,
    requirePermission('sales:quote:read'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.quotes.get(c, tx, req.params.id as string)),
  );

  r.post(
    '/quotes',
    ...guard,
    requirePermission('sales:quote:create'),
    validate({ body: quoteBody }),
    tenantRoute(pool, (tx, c, req) => api.quotes.create(c, tx, req.body), 201),
  );

  r.patch(
    '/quotes/:id',
    ...guard,
    requirePermission('sales:quote:update'),
    validate({ params: idParam, body: quoteBody.partial() }),
    tenantRoute(pool, (tx, c, req) => api.quotes.update(c, tx, req.params.id as string, req.body)),
  );

  r.post(
    '/quotes/:id/status',
    ...guard,
    requirePermission('sales:quote:update'),
    validate({
      params: idParam,
      body: z.object({ status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']) }),
    }),
    tenantRoute(pool, (tx, c, req) => api.quotes.setStatus(c, tx, req.params.id as string, req.body.status)),
  );

  /** Convierte la cotización en un borrador de factura con el precio negociado. */
  r.post(
    '/quotes/:id/convert',
    ...guard,
    requirePermission('sales:invoice:create'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.quotes.convert(c, tx, req.params.id as string), 201),
  );

  r.delete(
    '/quotes/:id',
    ...guard,
    requirePermission('sales:quote:delete'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.quotes.remove(c, tx, req.params.id as string), 204),
  );

  // ── Facturas ──────────────────────────────────────────────────────────────

  r.get(
    '/invoices',
    ...guard,
    requirePermission('sales:invoice:read'),
    validate({ query: listQuerySchema }),
    tenantRoute(pool, (tx, c, req) => api.invoices.list(c, tx, listQueryOf(req))),
  );

  r.get(
    '/invoices/overview',
    ...guard,
    requirePermission('sales:invoice:read'),
    tenantRoute(pool, (tx, c) => api.invoices.overview(c, tx)),
  );

  /** Cartera por edades: cuánto debe cada cliente y desde cuándo. */
  r.get(
    '/invoices/aging',
    ...guard,
    requirePermission('sales:invoice:read'),
    tenantRoute(pool, async (tx, c) => ({ items: await api.invoices.aging(c, tx) })),
  );

  r.get(
    '/invoices/:id',
    ...guard,
    requirePermission('sales:invoice:read'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.invoices.get(c, tx, req.params.id as string)),
  );

  r.post(
    '/invoices',
    ...guard,
    requirePermission('sales:invoice:create'),
    validate({ body: invoiceBody }),
    tenantRoute(pool, (tx, c, req) => api.invoices.create(c, tx, req.body), 201),
  );

  r.patch(
    '/invoices/:id',
    ...guard,
    requirePermission('sales:invoice:update'),
    validate({ params: idParam, body: invoiceBody.partial() }),
    tenantRoute(pool, (tx, c, req) => api.invoices.update(c, tx, req.params.id as string, req.body)),
  );

  /** Punto de no retorno: asigna el consecutivo y la vuelve inmutable. */
  r.post(
    '/invoices/:id/issue',
    ...guard,
    requirePermission('sales:invoice:issue'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.invoices.issue(c, tx, req.params.id as string)),
  );

  r.post(
    '/invoices/:id/void',
    ...guard,
    requirePermission('sales:invoice:void'),
    validate({ params: idParam, body: reasonBody }),
    tenantRoute(pool, (tx, c, req) => api.invoices.void(c, tx, req.params.id as string, req.body.reason)),
  );

  r.delete(
    '/invoices/:id',
    ...guard,
    requirePermission('sales:invoice:delete'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.invoices.remove(c, tx, req.params.id as string), 204),
  );

  // ── Pagos ─────────────────────────────────────────────────────────────────

  r.get(
    '/payments',
    ...guard,
    requirePermission('sales:payment:read'),
    validate({ query: listQuerySchema }),
    tenantRoute(pool, (tx, c, req) => api.payments.list(c, tx, listQueryOf(req))),
  );

  /** Facturas abiertas del cliente: lo que la pantalla de cobro necesita. */
  r.get(
    '/parties/:id/open-invoices',
    ...guard,
    requirePermission('sales:payment:read'),
    validate({ params: idParam }),
    tenantRoute(pool, async (tx, c, req) => ({
      items: await api.payments.openInvoices(c, tx, req.params.id as string),
    })),
  );

  r.get(
    '/payments/:id',
    ...guard,
    requirePermission('sales:payment:read'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.payments.get(c, tx, req.params.id as string)),
  );

  r.post(
    '/payments',
    ...guard,
    requirePermission('sales:payment:create'),
    validate({ body: paymentBody }),
    tenantRoute(pool, (tx, c, req) => api.payments.register(c, tx, req.body), 201),
  );

  r.post(
    '/payments/:id/void',
    ...guard,
    requirePermission('sales:payment:void'),
    validate({ params: idParam, body: reasonBody }),
    tenantRoute(pool, (tx, c, req) => api.payments.void(c, tx, req.params.id as string, req.body.reason)),
  );

  return r;
};
