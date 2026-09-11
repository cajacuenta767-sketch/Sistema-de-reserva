import type pg from 'pg';
import { PermissionSet } from '@erp/contracts';
import { fullName } from '../domain/User.js';
import { withTenant, withoutTenant } from '../../../platform/db/tenancy.js';
import type { RequestContext } from '../../../platform/authz/RequestContext.js';
import type { ContextLoader } from '../../../platform/http/middlewares/auth.js';
import type {
  MembershipRepository,
  RoleRepository,
  UserRepository,
} from '../application/ports/IdentityRepositories.js';

/**
 * Construye el `RequestContext` de cada petición.
 *
 * Son dos transacciones por petición: una sin tenant para usuario y membresía
 * (tablas de frontera) y otra con tenant para permisos, equipos y sucursales
 * (tablas con RLS). Es el precio de que el aislamiento lo garantice la base de
 * datos y no la disciplina de quien escribe las consultas, y se paga una vez
 * por petición, no por consulta.
 */
export class PgContextLoader implements ContextLoader {
  constructor(
    private readonly pool: pg.Pool,
    private readonly users: UserRepository,
    private readonly memberships: MembershipRepository,
    private readonly roles: RoleRepository,
  ) {}

  async defaultOrganizationFor(userId: string): Promise<string | null> {
    return withoutTenant(
      this.pool,
      async (tx) => {
        const list = await this.memberships.listForUser(tx, userId);
        return list[0]?.organizationId ?? null;
      },
      { userId },
    );
  }

  async loadContext(input: {
    userId: string;
    organizationId: string;
    requestId: string;
    ip?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<RequestContext | null> {
    const base = await withoutTenant(
      this.pool,
      async (tx) => {
        const user = await this.users.findById(tx, input.userId);
        if (!user || user.status !== 'ACTIVE') return null;

        const membership = await this.memberships.find(tx, input.userId, input.organizationId);
        // Devolver null en lugar de lanzar: quien no pertenece a la organización
        // queda como anónimo y `requireOrganization` decide qué responder.
        if (!membership || membership.status !== 'ACTIVE') return null;

        return { user, membership };
      },
      { userId: input.userId },
    );

    if (!base) return null;
    const { user, membership } = base;

    const scoped = await withTenant(
      this.pool,
      { organizationId: input.organizationId, membershipId: membership.id, userId: user.id },
      async (tx) => {
        const { fromRoles, overrides } = await this.roles.effectivePermissions(tx, membership.id);
        const teammates = await this.memberships.teammateIds(tx, membership.id);
        const branches = await tx.client.query<{ id: string }>('SELECT id FROM branches WHERE is_active');
        return {
          permissions: PermissionSet.resolve(fromRoles, overrides, user.isSuperAdmin),
          teammates,
          branchIds: branches.rows.map((b) => b.id),
        };
      },
    );

    return {
      requestId: input.requestId,
      organizationId: input.organizationId,
      membershipId: membership.id,
      branchId: membership.defaultBranchId,
      user: { id: user.id, email: user.email, fullName: fullName(user) },
      permissions: scoped.permissions,
      teamMemberIds: scoped.teammates,
      // Alcance BRANCH: quien tiene una sucursal asignada ve solo la suya;
      // quien no la tiene no está adscrito a ninguna y ve todas. Restringirle a
      // cero dejaría sin datos a todo el mundo hasta asignar sucursales a mano.
      branchIds: membership.defaultBranchId ? [membership.defaultBranchId] : scoped.branchIds,
      isOwner: membership.isOwner,
      isSuperAdmin: user.isSuperAdmin,
      ip: input.ip,
      userAgent: input.userAgent,
    };
  }
}
