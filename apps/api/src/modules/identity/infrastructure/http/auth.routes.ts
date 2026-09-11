import { Router } from 'express';
import { z } from 'zod';
import {
  changePasswordSchema,
  listQuerySchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  switchOrganizationSchema,
  updateProfileSchema,
  idParam,
} from '@erp/contracts';
import { toPublicUser } from '../../domain/User.js';
import type { ModuleContext } from '../../../../platform/modules/types.js';
import { validate } from '../../../../platform/http/middlewares/validate.js';
import { requireAuth, requireOrganization } from '../../../../platform/http/middlewares/auth.js';
import { listQueryOf, route, tenantRoute } from '../../../../platform/http/handlers.js';
import { requireContext } from '../../../../platform/authz/RequestContext.js';
import type { AuthUseCases } from '../../application/use-cases/AuthUseCases.js';
import type { AccessUseCases } from '../../application/use-cases/AccessUseCases.js';

const inviteBody = z.object({
  email: z.email(),
  roleIds: z.array(z.uuid()).default([]),
});

export const authRoutes = (
  ctx: ModuleContext,
  api: { auth: AuthUseCases; access: AccessUseCases },
): Router => {
  const r = Router();
  const { requirePermission, pool } = ctx;
  const meta = (req: { ip?: string | undefined; header(n: string): string | undefined }) => ({
    ip: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  });

  r.post(
    '/auth/register',
    validate({ body: registerSchema }),
    route((req) => api.auth.register(req.body, meta(req)), 201),
  );

  r.post(
    '/auth/login',
    validate({ body: loginSchema }),
    route((req) => api.auth.login(req.body, meta(req))),
  );

  r.post(
    '/auth/refresh',
    validate({ body: refreshSchema }),
    route((req) => api.auth.refresh(req.body.refreshToken, meta(req))),
  );

  r.post(
    '/auth/logout',
    validate({ body: refreshSchema }),
    route(async (req) => {
      await api.auth.logout(req.body.refreshToken);
      return null;
    }),
  );

  r.post(
    '/auth/logout-everywhere',
    requireAuth,
    route(async (req) => ({ revoked: await api.auth.logoutEverywhere(requireContext(req.ctx)) })),
  );

  /** Sesión completa: usuario, organizaciones, permisos y roles. */
  r.get(
    '/auth/session',
    requireOrganization,
    route((req) => api.auth.session(requireContext(req.ctx))),
  );

  r.patch(
    '/auth/profile',
    requireAuth,
    validate({ body: updateProfileSchema }),
    route(async (req) => toPublicUser(await api.auth.updateProfile(requireContext(req.ctx), req.body))),
  );

  r.post(
    '/auth/change-password',
    requireAuth,
    validate({ body: changePasswordSchema }),
    route(async (req) => {
      await api.auth.changePassword(requireContext(req.ctx), req.body.currentPassword, req.body.newPassword);
      return null;
    }),
  );

  r.post(
    '/auth/switch-organization',
    requireAuth,
    validate({ body: switchOrganizationSchema }),
    route((req) => api.auth.switchOrganization(requireContext(req.ctx), req.body.organizationId)),
  );

  r.post(
    '/auth/accept-invitation',
    requireAuth,
    validate({ body: z.object({ token: z.string().min(10) }) }),
    route(async (req) => ({
      organizationId: await api.auth.acceptInvitation(req.body.token, requireContext(req.ctx).user.id),
    })),
  );

  // ── Invitaciones ──────────────────────────────────────────────────────────

  r.get(
    '/invitations',
    requireOrganization,
    requirePermission('identity:invitation:read'),
    route(async (req) => ({ items: await api.auth.listInvitations(requireContext(req.ctx)) })),
  );

  r.post(
    '/invitations',
    requireOrganization,
    requirePermission('identity:invitation:create'),
    validate({ body: inviteBody }),
    route(async (req) => {
      const result = await api.auth.invite(requireContext(req.ctx), req.body);
      // El token se devuelve porque en desarrollo no hay servidor de correo;
      // en producción el adaptador SMTP lo entrega y esto sirve para reenviarlo.
      return { id: result.id, token: result.token };
    }, 201),
  );

  r.delete(
    '/invitations/:id',
    requireOrganization,
    requirePermission('identity:invitation:create'),
    validate({ params: idParam }),
    route(async (req) => {
      await api.auth.revokeInvitation(requireContext(req.ctx), req.params.id as string);
      return null;
    }),
  );

  // ── Auditoría ─────────────────────────────────────────────────────────────

  r.get(
    '/audit',
    requireOrganization,
    requirePermission('identity:audit:read'),
    validate({ query: listQuerySchema }),
    tenantRoute(pool, (tx, c, req) => api.access.listAudit(c, tx, listQueryOf(req))),
  );

  return r;
};
