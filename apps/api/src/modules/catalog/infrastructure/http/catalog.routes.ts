import { Router } from 'express';
import { z } from 'zod';
import { idParam, listQuerySchema } from '@erp/contracts';
import type { ModuleContext } from '../../../../platform/modules/types.js';
import { validate } from '../../../../platform/http/middlewares/validate.js';
import { requireOrganization } from '../../../../platform/http/middlewares/auth.js';
import { listQueryOf, tenantRoute } from '../../../../platform/http/handlers.js';
import type { ProductUseCases } from '../../application/use-cases/ProductUseCases.js';
import type {
  CategoryUseCases,
  PriceListUseCases,
  TaxUseCases,
  UomUseCases,
} from '../../application/use-cases/CatalogUseCases.js';

const DIMENSIONS = ['UNIT', 'WEIGHT', 'VOLUME', 'LENGTH', 'AREA', 'TIME'] as const;
const TAX_KINDS = [
  'VAT',
  'INC',
  'WITHHOLDING_INCOME',
  'WITHHOLDING_VAT',
  'WITHHOLDING_ICA',
  'OTHER',
] as const;

/** Importe monetario: texto, nunca `number`. Un float pierde centavos en silencio. */
const money = z.string().regex(/^-?\d+(\.\d{1,4})?$/, 'Importe inválido');
const quantity = z.string().regex(/^\d+(\.\d{1,6})?$/, 'Cantidad inválida');
const rate = z.string().regex(/^\d+(\.\d{1,6})?$/, 'Porcentaje inválido');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)');

const productBody = z.object({
  sku: z.string().trim().max(60).nullable().optional(),
  barcode: z.string().trim().max(60).nullable().optional(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  kind: z.enum(['GOOD', 'SERVICE', 'KIT']).optional(),
  categoryId: z.uuid().nullable().optional(),
  uomId: z.uuid().nullable().optional(),
  uomCode: z.string().trim().max(20).nullable().optional(),
  saleUomId: z.uuid().nullable().optional(),
  purchaseUomId: z.uuid().nullable().optional(),
  salePrice: money.optional(),
  purchasePrice: money.optional(),
  currencyCode: z.string().length(3).optional(),
  priceIncludesTax: z.boolean().optional(),
  saleTaxId: z.uuid().nullable().optional(),
  purchaseTaxId: z.uuid().nullable().optional(),
  trackInventory: z.boolean().optional(),
  costMethod: z.enum(['AVERAGE', 'FIFO', 'STANDARD']).optional(),
  standardCost: money.optional(),
  minStock: quantity.nullable().optional(),
  maxStock: quantity.nullable().optional(),
  tracking: z.enum(['NONE', 'LOT', 'SERIAL']).optional(),
  brand: z.string().trim().max(120).nullable().optional(),
  manufacturerSku: z.string().trim().max(60).nullable().optional(),
  weightKg: quantity.nullable().optional(),
  isSellable: z.boolean().optional(),
  isPurchasable: z.boolean().optional(),
  isActive: z.boolean().optional(),
  ownerMembershipId: z.uuid().nullable().optional(),
  variants: z
    .array(
      z.object({
        sku: z.string().trim().max(60).nullable().optional(),
        attributes: z.record(z.string().max(40), z.string().max(80)),
        priceDelta: money.optional(),
      }),
    )
    .optional(),
});

const uomBody = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(80),
  dimension: z.enum(DIMENSIONS),
  factor: quantity.optional(),
  precision: z.number().int().min(0).max(6).optional(),
  dianCode: z.string().trim().max(10).nullable().optional(),
});

const categoryBody = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.uuid().nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});

const taxBody = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(TAX_KINDS),
  rate,
  appliesTo: z.enum(['SALE', 'PURCHASE', 'BOTH']).optional(),
  minBase: money.nullable().optional(),
  dianTaxCode: z.string().trim().max(10).nullable().optional(),
});

const priceListBody = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['SALE', 'PURCHASE']).optional(),
  currencyCode: z.string().length(3).optional(),
  mode: z.enum(['FIXED', 'DERIVED']).optional(),
  basedOnId: z.uuid().nullable().optional(),
  adjustmentPercent: z.string().regex(/^-?\d+(\.\d{1,6})?$/).optional(),
  rounding: money.optional(),
  includesTax: z.boolean().optional(),
  validFrom: isoDate.nullable().optional(),
  validTo: isoDate.nullable().optional(),
  isDefault: z.boolean().optional(),
});

export const catalogRoutes = (
  ctx: ModuleContext,
  api: {
    products: ProductUseCases;
    uoms: UomUseCases;
    categories: CategoryUseCases;
    taxes: TaxUseCases;
    priceLists: PriceListUseCases;
  },
): Router => {
  const r = Router();
  const { requirePermission, pool } = ctx;
  const guard = [requireOrganization] as const;

  // ── Productos ─────────────────────────────────────────────────────────────

  r.get(
    '/products',
    ...guard,
    requirePermission('catalog:product:read'),
    validate({ query: listQuerySchema }),
    tenantRoute(pool, (tx, c, req) => api.products.list(c, tx, listQueryOf(req))),
  );

  r.get(
    '/products/overview',
    ...guard,
    requirePermission('catalog:product:read'),
    tenantRoute(pool, (tx, c) => api.products.overview(c, tx)),
  );

  r.get(
    '/products/search',
    ...guard,
    requirePermission('catalog:product:read'),
    validate({
      query: z.object({
        q: z.string().trim().min(1).max(100),
        limit: z.coerce.number().int().min(1).max(25).default(10),
      }),
    }),
    tenantRoute(pool, async (tx, c, req) => {
      const q = (req.validatedQuery ?? {}) as { q: string; limit: number };
      return { items: await api.products.search(c, tx, q.q, q.limit) };
    }),
  );

  /**
   * Precio aplicable. Lo consulta cada línea de cada documento, así que vive en
   * el catálogo y no en ventas: si lo resolviera cada módulo por su cuenta, la
   * cotización y la factura acabarían dando precios distintos.
   */
  r.get(
    '/products/:id/price',
    ...guard,
    requirePermission('catalog:product:read'),
    validate({
      params: idParam,
      query: z.object({
        quantity: quantity.default('1'),
        priceListId: z.uuid().optional(),
        variantId: z.uuid().optional(),
        on: isoDate.optional(),
      }),
    }),
    tenantRoute(pool, (tx, c, req) => {
      const q = (req.validatedQuery ?? {}) as {
        quantity: string;
        priceListId?: string;
        variantId?: string;
        on?: string;
      };
      return api.priceLists.priceFor(c, tx, {
        productId: req.params.id as string,
        quantity: q.quantity,
        ...(q.priceListId ? { priceListId: q.priceListId } : {}),
        ...(q.variantId ? { variantId: q.variantId } : {}),
        ...(q.on ? { on: q.on } : {}),
      });
    }),
  );

  r.get(
    '/products/:id',
    ...guard,
    requirePermission('catalog:product:read'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.products.get(c, tx, req.params.id as string)),
  );

  r.post(
    '/products',
    ...guard,
    requirePermission('catalog:product:create'),
    validate({ body: productBody }),
    tenantRoute(pool, (tx, c, req) => api.products.create(c, tx, req.body), 201),
  );

  r.patch(
    '/products/:id',
    ...guard,
    requirePermission('catalog:product:update'),
    validate({ params: idParam, body: productBody.partial() }),
    tenantRoute(pool, (tx, c, req) => api.products.update(c, tx, req.params.id as string, req.body)),
  );

  r.delete(
    '/products/:id',
    ...guard,
    requirePermission('catalog:product:delete'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.products.remove(c, tx, req.params.id as string), 204),
  );

  // ── Variantes ─────────────────────────────────────────────────────────────

  r.post(
    '/products/:id/variants',
    ...guard,
    requirePermission('catalog:product:update'),
    validate({
      params: idParam,
      body: z.object({
        sku: z.string().trim().max(60).nullable().optional(),
        attributes: z.record(z.string().max(40), z.string().max(80)),
        priceDelta: money.optional(),
      }),
    }),
    tenantRoute(pool, (tx, c, req) => api.products.addVariant(c, tx, req.params.id as string, req.body), 201),
  );

  r.delete(
    '/variants/:id',
    ...guard,
    requirePermission('catalog:product:update'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.products.removeVariant(c, tx, req.params.id as string), 204),
  );

  // ── Unidades de medida ────────────────────────────────────────────────────

  r.get(
    '/uoms',
    ...guard,
    requirePermission('catalog:uom:read'),
    tenantRoute(pool, async (tx, c) => ({ items: await api.uoms.list(c, tx) })),
  );

  r.post(
    '/uoms',
    ...guard,
    requirePermission('catalog:uom:manage'),
    validate({ body: uomBody }),
    tenantRoute(pool, (tx, c, req) => api.uoms.create(c, tx, req.body), 201),
  );

  r.patch(
    '/uoms/:id',
    ...guard,
    requirePermission('catalog:uom:manage'),
    validate({ params: idParam, body: uomBody.partial().extend({ isActive: z.boolean().optional() }) }),
    tenantRoute(pool, (tx, c, req) => api.uoms.update(c, tx, req.params.id as string, req.body)),
  );

  r.delete(
    '/uoms/:id',
    ...guard,
    requirePermission('catalog:uom:manage'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.uoms.remove(c, tx, req.params.id as string), 204),
  );

  // ── Categorías ────────────────────────────────────────────────────────────

  r.get(
    '/product-categories',
    ...guard,
    requirePermission('catalog:product:read'),
    tenantRoute(pool, async (tx, c) => ({ items: await api.categories.tree(c, tx) })),
  );

  r.post(
    '/product-categories',
    ...guard,
    requirePermission('catalog:category:manage'),
    validate({ body: categoryBody }),
    tenantRoute(pool, (tx, c, req) => api.categories.create(c, tx, req.body), 201),
  );

  r.patch(
    '/product-categories/:id',
    ...guard,
    requirePermission('catalog:category:manage'),
    validate({
      params: idParam,
      body: categoryBody.partial().extend({ isActive: z.boolean().optional() }),
    }),
    tenantRoute(pool, (tx, c, req) => api.categories.update(c, tx, req.params.id as string, req.body)),
  );

  r.delete(
    '/product-categories/:id',
    ...guard,
    requirePermission('catalog:category:manage'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.categories.remove(c, tx, req.params.id as string), 204),
  );

  // ── Impuestos ─────────────────────────────────────────────────────────────

  r.get(
    '/taxes',
    ...guard,
    requirePermission('catalog:tax:read'),
    tenantRoute(pool, async (tx, c) => ({ items: await api.taxes.list(c, tx) })),
  );

  r.post(
    '/taxes',
    ...guard,
    requirePermission('catalog:tax:manage'),
    validate({ body: taxBody }),
    tenantRoute(pool, (tx, c, req) => api.taxes.create(c, tx, req.body), 201),
  );

  r.patch(
    '/taxes/:id',
    ...guard,
    requirePermission('catalog:tax:manage'),
    validate({
      params: idParam,
      body: z.object({
        code: z.string().trim().max(30).optional(),
        name: z.string().trim().max(120).optional(),
        rate: rate.optional(),
        applies_to: z.enum(['SALE', 'PURCHASE', 'BOTH']).optional(),
        min_base: money.nullable().optional(),
        dian_tax_code: z.string().trim().max(10).nullable().optional(),
        is_active: z.boolean().optional(),
      }),
    }),
    tenantRoute(pool, (tx, c, req) => api.taxes.update(c, tx, req.params.id as string, req.body)),
  );

  r.delete(
    '/taxes/:id',
    ...guard,
    requirePermission('catalog:tax:manage'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.taxes.remove(c, tx, req.params.id as string), 204),
  );

  // ── Listas de precios ─────────────────────────────────────────────────────

  r.get(
    '/price-lists',
    ...guard,
    requirePermission('catalog:pricelist:read'),
    validate({ query: z.object({ kind: z.enum(['SALE', 'PURCHASE']).optional() }) }),
    tenantRoute(pool, async (tx, c, req) => {
      const q = (req.validatedQuery ?? {}) as { kind?: 'SALE' | 'PURCHASE' };
      return { items: await api.priceLists.list(c, tx, q.kind) };
    }),
  );

  r.post(
    '/price-lists',
    ...guard,
    requirePermission('catalog:pricelist:manage'),
    validate({ body: priceListBody }),
    tenantRoute(pool, (tx, c, req) => api.priceLists.create(c, tx, req.body), 201),
  );

  r.patch(
    '/price-lists/:id',
    ...guard,
    requirePermission('catalog:pricelist:manage'),
    validate({ params: idParam, body: priceListBody.partial().extend({ isActive: z.boolean().optional() }) }),
    tenantRoute(pool, (tx, c, req) => api.priceLists.update(c, tx, req.params.id as string, req.body)),
  );

  r.delete(
    '/price-lists/:id',
    ...guard,
    requirePermission('catalog:pricelist:manage'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.priceLists.remove(c, tx, req.params.id as string), 204),
  );

  r.get(
    '/price-lists/:id/items',
    ...guard,
    requirePermission('catalog:pricelist:read'),
    validate({ params: idParam, query: listQuerySchema }),
    tenantRoute(pool, (tx, c, req) =>
      api.priceLists.items(c, tx, req.params.id as string, listQueryOf(req)),
    ),
  );

  r.post(
    '/price-lists/:id/items',
    ...guard,
    requirePermission('catalog:pricelist:manage'),
    validate({
      params: idParam,
      body: z.object({
        productId: z.uuid(),
        variantId: z.uuid().nullable().optional(),
        minQuantity: quantity.optional(),
        price: money,
      }),
    }),
    tenantRoute(pool, (tx, c, req) => api.priceLists.setItem(c, tx, req.params.id as string, req.body), 201),
  );

  r.delete(
    '/price-list-items/:id',
    ...guard,
    requirePermission('catalog:pricelist:manage'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.priceLists.removeItem(c, tx, req.params.id as string), 204),
  );

  return r;
};
