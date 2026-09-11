import { Router } from 'express';
import { z } from 'zod';
import { idParam } from '@erp/contracts';
import type { ModuleContext } from '../../../../platform/modules/types.js';
import { validate } from '../../../../platform/http/middlewares/validate.js';
import { requireOrganization } from '../../../../platform/http/middlewares/auth.js';
import { withTenant } from '../../../../platform/db/tenancy.js';
import { requireContext } from '../../../../platform/authz/RequestContext.js';
import type { OrganizationUseCases } from '../../application/use-cases/OrganizationUseCases.js';

const updateOrganizationBody = z.object({
  legalName: z.string().trim().min(2).max(200).optional(),
  tradeName: z.string().trim().min(2).max(200).optional(),
  taxId: z.string().trim().max(30).nullable().optional(),
  taxIdDv: z.string().trim().max(2).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.email().nullable().optional(),
  website: z.url().nullable().optional(),
  functionalCurrency: z.string().length(3).optional(),
  timezone: z.string().max(60).optional(),
  locale: z.enum(['es-CO', 'en-US']).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  // El matiz de marca: un número recolorea toda la aplicación.
  brandHue: z.number().int().min(0).max(360).nullable().optional(),
  logoFileId: z.uuid().nullable().optional(),
});

const branchBody = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  city: z.string().trim().max(120).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
});

const settingBody = z.object({ key: z.string().min(1).max(120), value: z.unknown() });

export const organizationRoutes = (ctx: ModuleContext, api: OrganizationUseCases): Router => {
  const r = Router();
  const { requirePermission, pool } = ctx;

  /** Ejecuta el caso de uso dentro de una transacción con el tenant fijado. */
  const tenant = requireOrganization;

  r.get('/organization', tenant, requirePermission('org:organization:read'), (req, res, next) => {
    const c = requireContext(req.ctx);
    withTenant(pool, c, (tx) => api.get(c, tx))
      .then((org) => res.json(org))
      .catch(next);
  });

  r.patch(
    '/organization',
    tenant,
    requirePermission('org:organization:update'),
    validate({ body: updateOrganizationBody }),
    (req, res, next) => {
      const c = requireContext(req.ctx);
      withTenant(pool, c, (tx) => api.update(c, tx, req.body))
        .then((org) => res.json(org))
        .catch(next);
    },
  );

  r.get('/organization/settings', tenant, requirePermission('org:settings:read'), (req, res, next) => {
    const c = requireContext(req.ctx);
    withTenant(pool, c, (tx) => api.getSettings(c, tx))
      .then((s) => res.json(s))
      .catch(next);
  });

  r.put(
    '/organization/settings',
    tenant,
    requirePermission('org:settings:update'),
    validate({ body: settingBody }),
    (req, res, next) => {
      const c = requireContext(req.ctx);
      withTenant(pool, c, (tx) => api.setSetting(c, tx, req.body.key, req.body.value))
        .then(() => res.status(204).end())
        .catch(next);
    },
  );

  r.get('/branches', tenant, requirePermission('org:branch:read'), (req, res, next) => {
    const c = requireContext(req.ctx);
    withTenant(pool, c, (tx) => api.listBranches(c, tx))
      .then((items) => res.json({ items }))
      .catch(next);
  });

  r.post(
    '/branches',
    tenant,
    requirePermission('org:branch:create'),
    validate({ body: branchBody }),
    (req, res, next) => {
      const c = requireContext(req.ctx);
      withTenant(pool, c, (tx) => api.createBranch(c, tx, req.body))
        .then((b) => res.status(201).json(b))
        .catch(next);
    },
  );

  r.patch(
    '/branches/:id',
    tenant,
    requirePermission('org:branch:update'),
    validate({ params: idParam, body: branchBody.partial().extend({ isActive: z.boolean().optional() }) }),
    (req, res, next) => {
      const c = requireContext(req.ctx);
      withTenant(pool, c, (tx) => api.updateBranch(c, tx, req.params.id as string, req.body))
        .then((b) => res.json(b))
        .catch(next);
    },
  );

  r.delete(
    '/branches/:id',
    tenant,
    requirePermission('org:branch:delete'),
    validate({ params: idParam }),
    (req, res, next) => {
      const c = requireContext(req.ctx);
      withTenant(pool, c, (tx) => api.deleteBranch(c, tx, req.params.id as string))
        .then(() => res.status(204).end())
        .catch(next);
    },
  );

  return r;
};
