import { Router } from 'express';
import { z } from 'zod';
import { idParam, listQuerySchema } from '@erp/contracts';
import type { ModuleContext } from '../../../../platform/modules/types.js';
import { validate } from '../../../../platform/http/middlewares/validate.js';
import { requireOrganization } from '../../../../platform/http/middlewares/auth.js';
import { listQueryOf, tenantRoute } from '../../../../platform/http/handlers.js';
import type { PartyUseCases } from '../../application/use-cases/PartyUseCases.js';
import type { CrmUseCases } from '../../application/use-cases/CrmUseCases.js';

const TAX_ID_TYPES = ['NIT', 'CC', 'CE', 'TI', 'PP', 'NIT_EXT', 'PEP', 'NUIP', 'SIN_IDENTIFICAR'] as const;
const ADDRESS_KINDS = ['MAIN', 'BILLING', 'SHIPPING', 'OTHER'] as const;
const ACTIVITY_KINDS = ['CALL', 'EMAIL', 'MEETING', 'NOTE', 'WHATSAPP', 'TASK', 'VISIT'] as const;

const addressBody = z.object({
  kind: z.enum(ADDRESS_KINDS).default('MAIN'),
  label: z.string().trim().max(80).nullable().optional(),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  state: z.string().trim().max(120).nullable().optional(),
  country: z.string().length(2).default('CO'),
  postalCode: z.string().trim().max(20).nullable().optional(),
  isDefault: z.boolean().default(false),
});

const partyBody = z.object({
  kind: z.enum(['PERSON', 'COMPANY']).optional(),
  displayName: z.string().trim().min(1).max(200).optional(),
  legalName: z.string().trim().max(200).nullable().optional(),
  taxIdType: z.enum(TAX_ID_TYPES).optional(),
  taxId: z.string().trim().max(30).nullable().optional(),
  taxIdDv: z.string().trim().max(2).nullable().optional(),
  fiscalResponsibilities: z.array(z.string().max(20)).optional(),
  taxRegime: z.enum(['SIMPLIFICADO', 'COMUN', 'GRAN_CONTRIBUYENTE', 'NO_RESIDENTE']).optional(),
  email: z.email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  mobile: z.string().trim().max(40).nullable().optional(),
  website: z.url().nullable().optional(),
  industry: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  isCustomer: z.boolean().optional(),
  isVendor: z.boolean().optional(),
  ownerMembershipId: z.uuid().nullable().optional(),
  tagIds: z.array(z.uuid()).optional(),
  address: addressBody.optional(),
  customerProfile: z
    .object({
      priceListId: z.uuid().nullable().optional(),
      paymentTermsDays: z.number().int().min(0).max(365).optional(),
      creditLimit: z.string().regex(/^\d+(\.\d+)?$/).optional(),
      defaultCurrency: z.string().length(3).optional(),
      salespersonMembershipId: z.uuid().nullable().optional(),
      taxGroupId: z.uuid().nullable().optional(),
    })
    .optional(),
  vendorProfile: z
    .object({
      paymentTermsDays: z.number().int().min(0).max(365).optional(),
      defaultCurrency: z.string().length(3).optional(),
      taxGroupId: z.uuid().nullable().optional(),
      leadTimeDays: z.number().int().min(0).max(365).optional(),
    })
    .optional(),
});

const contactBody = z.object({
  partyId: z.uuid().nullable().optional(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  email: z.email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  mobile: z.string().trim().max(40).nullable().optional(),
  isPrimary: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

const tagBody = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.string().trim().max(40).optional(),
  colorHue: z.number().int().min(0).max(360).nullable().optional(),
});

export const crmRoutes = (
  ctx: ModuleContext,
  api: { parties: PartyUseCases; crm: CrmUseCases },
): Router => {
  const r = Router();
  const { requirePermission, pool } = ctx;
  const guard = [requireOrganization] as const;

  // ── Partes ────────────────────────────────────────────────────────────────

  r.get(
    '/parties',
    ...guard,
    requirePermission('crm:party:read'),
    validate({ query: listQuerySchema }),
    tenantRoute(pool, (tx, c, req) => api.parties.list(c, tx, listQueryOf(req))),
  );

  /** Métricas de la pestaña "Vista general". */
  r.get(
    '/parties/overview',
    ...guard,
    requirePermission('crm:party:read'),
    tenantRoute(pool, (tx, c) => api.parties.overview(c, tx)),
  );

  r.get(
    '/parties/search',
    ...guard,
    requirePermission('crm:party:read'),
    validate({ query: z.object({ q: z.string().trim().min(1).max(100), limit: z.coerce.number().int().min(1).max(25).default(10) }) }),
    tenantRoute(pool, async (tx, c, req) => {
      const q = (req.validatedQuery ?? {}) as { q: string; limit: number };
      return { items: await api.parties.search(c, tx, q.q, q.limit) };
    }),
  );

  r.get(
    '/parties/:id',
    ...guard,
    requirePermission('crm:party:read'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.parties.get(c, tx, req.params.id as string)),
  );

  r.post(
    '/parties',
    ...guard,
    requirePermission('crm:party:create'),
    validate({ body: partyBody }),
    tenantRoute(pool, (tx, c, req) => api.parties.create(c, tx, req.body), 201),
  );

  r.patch(
    '/parties/:id',
    ...guard,
    requirePermission('crm:party:update'),
    validate({ params: idParam, body: partyBody.extend({ status: z.enum(['ACTIVE', 'INACTIVE', 'BLOCKED']).optional() }) }),
    tenantRoute(pool, (tx, c, req) => api.parties.update(c, tx, req.params.id as string, req.body)),
  );

  r.delete(
    '/parties/:id',
    ...guard,
    requirePermission('crm:party:delete'),
    validate({ params: idParam }),
    tenantRoute(pool, async (tx, c, req) => {
      await api.parties.delete(c, tx, req.params.id as string);
      return null;
    }),
  );

  // ── Direcciones ───────────────────────────────────────────────────────────

  r.post(
    '/parties/:id/addresses',
    ...guard,
    requirePermission('crm:party:update'),
    validate({ params: idParam, body: addressBody }),
    tenantRoute(pool, (tx, c, req) => api.crm.addAddress(c, tx, req.params.id as string, req.body), 201),
  );

  r.patch(
    '/addresses/:id',
    ...guard,
    requirePermission('crm:party:update'),
    validate({ params: idParam, body: addressBody.partial() }),
    tenantRoute(pool, (tx, c, req) => api.crm.updateAddress(c, tx, req.params.id as string, req.body)),
  );

  r.delete(
    '/addresses/:id',
    ...guard,
    requirePermission('crm:party:update'),
    validate({ params: idParam }),
    tenantRoute(pool, async (tx, c, req) => {
      await api.crm.deleteAddress(c, tx, req.params.id as string);
      return null;
    }),
  );

  // ── Contactos ─────────────────────────────────────────────────────────────

  r.get(
    '/contacts',
    ...guard,
    requirePermission('crm:contact:read'),
    validate({ query: listQuerySchema }),
    tenantRoute(pool, (tx, c, req) => api.crm.listContacts(c, tx, listQueryOf(req))),
  );

  r.post(
    '/contacts',
    ...guard,
    requirePermission('crm:contact:create'),
    validate({ body: contactBody }),
    tenantRoute(pool, (tx, c, req) => api.crm.createContact(c, tx, req.body), 201),
  );

  r.patch(
    '/contacts/:id',
    ...guard,
    requirePermission('crm:contact:update'),
    validate({ params: idParam, body: contactBody.partial() }),
    tenantRoute(pool, (tx, c, req) => api.crm.updateContact(c, tx, req.params.id as string, req.body)),
  );

  r.delete(
    '/contacts/:id',
    ...guard,
    requirePermission('crm:contact:delete'),
    validate({ params: idParam }),
    tenantRoute(pool, async (tx, c, req) => {
      await api.crm.deleteContact(c, tx, req.params.id as string);
      return null;
    }),
  );

  // ── Actividades ───────────────────────────────────────────────────────────

  r.get(
    '/activities',
    ...guard,
    requirePermission('crm:party:read'),
    validate({ query: z.object({ entityType: z.string().max(40), entityId: z.uuid() }) }),
    tenantRoute(pool, async (tx, c, req) => {
      const q = (req.validatedQuery ?? {}) as { entityType: string; entityId: string };
      return { items: await api.crm.listActivities(c, tx, q.entityType, q.entityId) };
    }),
  );

  r.post(
    '/activities',
    ...guard,
    requirePermission('crm:activity:create'),
    validate({
      body: z.object({
        kind: z.enum(ACTIVITY_KINDS),
        entityType: z.string().trim().max(40),
        entityId: z.uuid(),
        subject: z.string().trim().min(1).max(200),
        body: z.string().trim().max(4000).nullable().optional(),
        dueAt: z.iso.datetime().nullable().optional(),
      }),
    }),
    tenantRoute(
      pool,
      (tx, c, req) =>
        api.crm.logActivity(c, tx, {
          ...req.body,
          dueAt: req.body.dueAt ? new Date(req.body.dueAt) : null,
        }),
      201,
    ),
  );

  r.post(
    '/activities/:id/complete',
    ...guard,
    requirePermission('crm:activity:create'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.crm.completeActivity(c, tx, req.params.id as string)),
  );

  // ── Etiquetas ─────────────────────────────────────────────────────────────

  r.get(
    '/tags',
    ...guard,
    requirePermission('crm:tag:read'),
    validate({ query: z.object({ kind: z.string().max(40).optional() }) }),
    tenantRoute(pool, async (tx, c, req) => {
      const q = (req.validatedQuery ?? {}) as { kind?: string };
      return { items: await api.crm.listTags(c, tx, q.kind) };
    }),
  );

  r.post(
    '/tags',
    ...guard,
    requirePermission('crm:tag:manage'),
    validate({ body: tagBody }),
    tenantRoute(pool, (tx, c, req) => api.crm.createTag(c, tx, req.body), 201),
  );

  r.patch(
    '/tags/:id',
    ...guard,
    requirePermission('crm:tag:manage'),
    validate({ params: idParam, body: tagBody.partial() }),
    tenantRoute(pool, (tx, c, req) => api.crm.updateTag(c, tx, req.params.id as string, req.body)),
  );

  r.delete(
    '/tags/:id',
    ...guard,
    requirePermission('crm:tag:manage'),
    validate({ params: idParam }),
    tenantRoute(pool, async (tx, c, req) => {
      await api.crm.deleteTag(c, tx, req.params.id as string);
      return null;
    }),
  );

  return r;
};
