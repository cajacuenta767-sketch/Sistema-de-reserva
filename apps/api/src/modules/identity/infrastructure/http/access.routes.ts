import { Router } from 'express';
import { z } from 'zod';
import { PERMISSION_SCOPES, idParam, listQuerySchema } from '@erp/contracts';
import type { ModuleContext } from '../../../../platform/modules/types.js';
import { validate } from '../../../../platform/http/middlewares/validate.js';
import { requireOrganization } from '../../../../platform/http/middlewares/auth.js';
import { listQueryOf, tenantRoute } from '../../../../platform/http/handlers.js';
import type { AccessUseCases } from '../../application/use-cases/AccessUseCases.js';

const grantSchema = z.object({ key: z.string().min(3).max(120), scope: z.enum(PERMISSION_SCOPES) });

const roleBody = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(400).nullable().optional(),
  permissions: z.array(grantSchema).optional(),
});

const teamBody = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(400).nullable().optional(),
  leadMembershipId: z.uuid().nullable().optional(),
  memberIds: z.array(z.uuid()).optional(),
});

export const accessRoutes = (ctx: ModuleContext, api: AccessUseCases): Router => {
  const r = Router();
  const { requirePermission, pool } = ctx;
  const guard = [requireOrganization] as const;

  // ── Personas ──────────────────────────────────────────────────────────────

  r.get(
    '/members',
    ...guard,
    requirePermission('identity:member:read'),
    validate({ query: listQuerySchema }),
    tenantRoute(pool, (tx, c, req) => api.listMembers(c, tx, listQueryOf(req))),
  );

  r.get(
    '/members/:id',
    ...guard,
    requirePermission('identity:member:read'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.getMember(c, tx, req.params.id as string)),
  );

  r.put(
    '/members/:id/roles',
    ...guard,
    requirePermission('identity:member:assign_roles'),
    validate({ params: idParam, body: z.object({ roleIds: z.array(z.uuid()) }) }),
    tenantRoute(pool, async (tx, c, req) => {
      await api.setMemberRoles(c, tx, req.params.id as string, req.body.roleIds);
      return null;
    }),
  );

  r.patch(
    '/members/:id/status',
    ...guard,
    requirePermission('identity:member:update'),
    validate({
      params: idParam,
      body: z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'REMOVED']) }),
    }),
    tenantRoute(pool, async (tx, c, req) => {
      await api.setMemberStatus(c, tx, req.params.id as string, req.body.status);
      return null;
    }),
  );

  r.put(
    '/members/:id/permissions/:key',
    ...guard,
    requirePermission('identity:member:assign_roles'),
    validate({
      params: z.object({ id: z.uuid(), key: z.string().min(3).max(120) }),
      body: z.object({
        effect: z.enum(['ALLOW', 'DENY']),
        scope: z.enum(PERMISSION_SCOPES).optional(),
        reason: z.string().max(300).nullable().optional(),
      }),
    }),
    tenantRoute(pool, async (tx, c, req) => {
      await api.setOverride(c, tx, req.params.id as string, {
        key: req.params.key as string,
        ...req.body,
      });
      return null;
    }),
  );

  r.delete(
    '/members/:id/permissions/:key',
    ...guard,
    requirePermission('identity:member:assign_roles'),
    validate({ params: z.object({ id: z.uuid(), key: z.string().min(3).max(120) }) }),
    tenantRoute(pool, async (tx, c, req) => {
      await api.clearOverride(c, tx, req.params.id as string, req.params.key as string);
      return null;
    }),
  );

  // ── Roles ─────────────────────────────────────────────────────────────────

  r.get(
    '/roles',
    ...guard,
    requirePermission('identity:role:read'),
    tenantRoute(pool, async (tx, c) => ({ items: await api.listRoles(c, tx) })),
  );

  /** Catálogo de permisos agrupado por módulo, para el editor de roles. */
  r.get(
    '/roles/catalog',
    ...guard,
    requirePermission('identity:role:read'),
    tenantRoute(pool, async (_tx, c) => ({ items: api.permissionCatalog(c) })),
  );

  r.get(
    '/roles/:id',
    ...guard,
    requirePermission('identity:role:read'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.getRole(c, tx, req.params.id as string)),
  );

  r.post(
    '/roles',
    ...guard,
    requirePermission('identity:role:create'),
    validate({ body: roleBody }),
    tenantRoute(pool, (tx, c, req) => api.createRole(c, tx, req.body), 201),
  );

  r.patch(
    '/roles/:id',
    ...guard,
    requirePermission('identity:role:update'),
    validate({ params: idParam, body: roleBody.partial() }),
    tenantRoute(pool, (tx, c, req) => api.updateRole(c, tx, req.params.id as string, req.body)),
  );

  r.put(
    '/roles/:id/permissions',
    ...guard,
    requirePermission('identity:role:update'),
    validate({ params: idParam, body: z.object({ permissions: z.array(grantSchema) }) }),
    tenantRoute(pool, async (tx, c, req) => {
      await api.setRolePermissions(c, tx, req.params.id as string, req.body.permissions);
      return null;
    }),
  );

  r.delete(
    '/roles/:id',
    ...guard,
    requirePermission('identity:role:delete'),
    validate({ params: idParam }),
    tenantRoute(pool, async (tx, c, req) => {
      await api.deleteRole(c, tx, req.params.id as string);
      return null;
    }),
  );

  // ── Equipos ───────────────────────────────────────────────────────────────

  r.get(
    '/teams',
    ...guard,
    requirePermission('identity:team:read'),
    tenantRoute(pool, async (tx, c) => ({ items: await api.listTeams(c, tx) })),
  );

  r.get(
    '/teams/:id/members',
    ...guard,
    requirePermission('identity:team:read'),
    validate({ params: idParam }),
    tenantRoute(pool, async (tx, c, req) => ({
      items: await api.teamMembers(c, tx, req.params.id as string),
    })),
  );

  r.post(
    '/teams',
    ...guard,
    requirePermission('identity:team:create'),
    validate({ body: teamBody }),
    tenantRoute(pool, (tx, c, req) => api.createTeam(c, tx, req.body), 201),
  );

  r.patch(
    '/teams/:id',
    ...guard,
    requirePermission('identity:team:update'),
    validate({ params: idParam, body: teamBody.partial() }),
    tenantRoute(pool, (tx, c, req) => api.updateTeam(c, tx, req.params.id as string, req.body)),
  );

  r.delete(
    '/teams/:id',
    ...guard,
    requirePermission('identity:team:delete'),
    validate({ params: idParam }),
    tenantRoute(pool, async (tx, c, req) => {
      await api.deleteTeam(c, tx, req.params.id as string);
      return null;
    }),
  );

  return r;
};
