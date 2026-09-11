import { Router } from 'express';
import { crudPermissions, definePermission } from '@erp/contracts';
import { defineModule } from '../../platform/modules/types.js';
import { AuthUseCases, type OrganizationCreator } from './application/use-cases/AuthUseCases.js';
import { AccessUseCases } from './application/use-cases/AccessUseCases.js';
import {
  PgInvitationRepository,
  PgMembershipRepository,
  PgRefreshTokenRepository,
  PgRoleRepository,
  PgTeamRepository,
  PgUserRepository,
} from './infrastructure/persistence/PgIdentityRepositories.js';
import { PgContextLoader } from './infrastructure/PgContextLoader.js';
import { authRoutes } from './infrastructure/http/auth.routes.js';
import { accessRoutes } from './infrastructure/http/access.routes.js';

export const identityModule = defineModule({
  id: 'identity',
  // Solo para ordenar el registro: al crear una cuenta hay que crear antes su
  // organización. La comunicación en caliente va por la API pública del módulo.
  dependsOn: ['organization'],

  permissions: [
    ...crudPermissions('identity', 'member', 'personas', ['TEAM', 'BRANCH', 'ORG']),
    definePermission('identity:member:assign_roles', 'Asignar roles y permisos', { sensitive: true }),
    definePermission('identity:role:read', 'Ver roles'),
    definePermission('identity:role:create', 'Crear roles', { sensitive: true }),
    definePermission('identity:role:update', 'Editar roles y sus permisos', { sensitive: true }),
    definePermission('identity:role:delete', 'Eliminar roles', { sensitive: true }),
    definePermission('identity:team:read', 'Ver equipos'),
    definePermission('identity:team:create', 'Crear equipos'),
    definePermission('identity:team:update', 'Editar equipos'),
    definePermission('identity:team:delete', 'Eliminar equipos'),
    definePermission('identity:invitation:read', 'Ver invitaciones'),
    definePermission('identity:invitation:create', 'Invitar personas', { sensitive: true }),
    definePermission('identity:audit:read', 'Ver el registro de auditoría', {
      description: 'Acceso al historial completo de cambios de la organización.',
    }),
  ],

  register(ctx) {
    const users = new PgUserRepository();
    const memberships = new PgMembershipRepository();
    const roles = new PgRoleRepository();
    const teams = new PgTeamRepository();

    const auth = new AuthUseCases(
      ctx.pool,
      users,
      memberships,
      roles,
      teams,
      new PgRefreshTokenRepository(),
      new PgInvitationRepository(),
      ctx.hasher,
      ctx.tokens,
      ctx.permissions,
      ctx.mailer,
      ctx.audit,
      ctx.events,
      ctx.clock,
      // Perezoso a propósito: en `register()` el otro módulo puede no existir aún.
      () => ctx.module<OrganizationCreator>('organization'),
    );

    const access = new AccessUseCases(memberships, roles, teams, ctx.permissions, ctx.audit, ctx.clock);

    return {
      auth,
      access,
      /** La plataforma lo usa para construir el RequestContext de cada petición. */
      contextLoader: new PgContextLoader(ctx.pool, users, memberships, roles),
    };
  },

  routes(ctx, api) {
    const r = Router();
    r.use(authRoutes(ctx, api));
    r.use(accessRoutes(ctx, api.access));
    return r;
  },
});

export type IdentityApi = ReturnType<typeof identityModule.register>;
