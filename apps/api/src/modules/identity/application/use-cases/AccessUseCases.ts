import { AppError, newId, type Clock } from '@erp/core';
import { PERMISSION_SCOPES, type ListQuery, type PermissionScope, type PermissionDef } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { RequestContext } from '../../../../platform/authz/RequestContext.js';
import type { AuditRecorder } from '../../../../platform/audit/AuditRecorder.js';
import type { PermissionCatalog } from '../../../../platform/authz/catalog.js';
import { assertCan, scopeFilter } from '../../../../platform/authz/scope.js';
import { runList, type ListResult, type ListSpec } from '../../../../platform/http/list.js';
import type { Role, Team } from '../../domain/User.js';
import type { MembershipRepository, RoleRepository, TeamRepository } from '../ports/IdentityRepositories.js';

export interface MemberRow extends Record<string, unknown> {
  membership_id: string;
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  job_title: string | null;
  status: string;
  is_owner: boolean;
  roles: string[];
  last_login_at: Date | null;
  created_at: Date;
}

/**
 * Listado de personas de la organización.
 *
 * Los roles se traen con subconsultas en lugar de JOIN + GROUP BY: con el JOIN,
 * `count(*)` contaría filas del producto (una persona con tres roles contaría
 * tres veces) y el WHERE del builder tendría que colocarse antes del GROUP BY,
 * que es justo lo que un constructor genérico no puede saber hacer.
 */
const memberListSpec = (): ListSpec => ({
  from: 'FROM memberships m JOIN users u ON u.id = m.user_id',
  select: `m.id AS membership_id, u.id AS user_id, u.email, u.first_name, u.last_name,
           (u.first_name || ' ' || u.last_name) AS full_name, m.job_title, m.status, m.is_owner,
           ARRAY(SELECT r.name FROM membership_roles mr JOIN roles r ON r.id = mr.role_id
                  WHERE mr.membership_id = m.id ORDER BY r.name) AS roles,
           u.last_login_at, m.created_at`,
  fields: {
    email: { column: 'u.email', type: 'text', sortable: true, filterable: true, searchable: true },
    full_name: {
      column: `(u.first_name || ' ' || u.last_name)`,
      type: 'text',
      sortable: true,
      filterable: true,
      searchable: true,
    },
    job_title: { column: 'm.job_title', type: 'text', sortable: true, filterable: true, searchable: true },
    status: { column: 'm.status', type: 'text', sortable: true, filterable: true },
    is_owner: { column: 'm.is_owner', type: 'boolean', sortable: true, filterable: true },
    // Tipo `array`: `filter[role_id]=<uuid>` se traduce a `$1 = ANY(...)`.
    role_id: {
      column: 'ARRAY(SELECT mr.role_id FROM membership_roles mr WHERE mr.membership_id = m.id)',
      type: 'array',
      sortable: false,
      filterable: true,
    },
    last_login_at: { column: 'u.last_login_at', type: 'timestamp', sortable: true, filterable: true },
    created_at: { column: 'm.created_at', type: 'timestamp', sortable: true, filterable: true },
  },
  defaultSort: [{ field: 'full_name', dir: 'asc' }],
  ownerColumn: 'm.id',
  aggregates: {
    active: `count(*) FILTER (WHERE m.status = 'ACTIVE')::int`,
    suspended: `count(*) FILTER (WHERE m.status = 'SUSPENDED')::int`,
  },
});

export class AccessUseCases {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly roles: RoleRepository,
    private readonly teams: TeamRepository,
    private readonly catalog: PermissionCatalog,
    private readonly audit: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  // ── Personas ──────────────────────────────────────────────────────────────

  async listMembers(ctx: RequestContext, tx: Tx, query: ListQuery): Promise<ListResult<MemberRow>> {
    assertCan(ctx, 'identity:member:read');
    return runList<MemberRow>(tx, memberListSpec(), query, scopeFilter(ctx, 'identity:member:read'));
  }

  async getMember(ctx: RequestContext, tx: Tx, membershipId: string) {
    assertCan(ctx, 'identity:member:read');
    const membership = await this.memberships.findById(tx, membershipId);
    if (!membership || membership.organizationId !== ctx.organizationId) {
      throw AppError.notFound('Miembro');
    }
    const roles = await this.roles.rolesOf(tx, membershipId);
    const { fromRoles, overrides } = await this.roles.effectivePermissions(tx, membershipId);
    return { membership, roles, permissions: { fromRoles, overrides } };
  }

  async setMemberRoles(ctx: RequestContext, tx: Tx, membershipId: string, roleIds: string[]): Promise<void> {
    assertCan(ctx, 'identity:member:assign_roles');
    const membership = await this.memberships.findById(tx, membershipId);
    if (!membership || membership.organizationId !== ctx.organizationId) {
      throw AppError.notFound('Miembro');
    }

    const before = await this.roles.rolesOf(tx, membershipId);
    // Dejar al propietario sin roles bloquearía la organización para siempre.
    if (membership.isOwner && roleIds.length === 0) {
      throw AppError.rule('El propietario no puede quedarse sin roles');
    }

    await this.roles.assignRoles(tx, ctx.organizationId, membershipId, roleIds);
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'membership_roles',
      entityId: membershipId,
      before: { roles: before.map((r) => r.name) },
      after: { roleIds },
    });
  }

  async setMemberStatus(
    ctx: RequestContext,
    tx: Tx,
    membershipId: string,
    status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED',
  ): Promise<void> {
    assertCan(ctx, 'identity:member:update');
    const membership = await this.memberships.findById(tx, membershipId);
    if (!membership || membership.organizationId !== ctx.organizationId) {
      throw AppError.notFound('Miembro');
    }
    if (membership.isOwner && status !== 'ACTIVE') {
      throw AppError.rule('No puedes suspender ni eliminar al propietario de la organización');
    }
    if (membership.id === ctx.membershipId) {
      throw AppError.rule('No puedes cambiar tu propio estado');
    }

    await this.memberships.update(tx, { ...membership, status });
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'membership',
      entityId: membershipId,
      before: { status: membership.status },
      after: { status },
    });
  }

  // ── Roles ─────────────────────────────────────────────────────────────────

  async listRoles(ctx: RequestContext, tx: Tx): Promise<Array<Role & { memberCount: number }>> {
    assertCan(ctx, 'identity:role:read');
    return this.roles.list(tx, ctx.organizationId);
  }

  async getRole(ctx: RequestContext, tx: Tx, id: string) {
    assertCan(ctx, 'identity:role:read');
    const role = await this.roles.findById(tx, id);
    if (!role || role.organizationId !== ctx.organizationId) throw AppError.notFound('Rol');
    return { role, permissions: await this.roles.permissionsOf(tx, id) };
  }

  async createRole(
    ctx: RequestContext,
    tx: Tx,
    input: {
      name: string;
      description?: string | null;
      permissions?: Array<{ key: string; scope: PermissionScope }>;
    },
  ): Promise<Role> {
    assertCan(ctx, 'identity:role:create');
    const role: Role = {
      id: newId(),
      organizationId: ctx.organizationId,
      code: null,
      name: input.name.trim(),
      description: input.description ?? null,
      isSystem: false,
    };
    await this.roles.save(tx, role);
    if (input.permissions?.length) {
      await this.setRolePermissions(ctx, tx, role.id, input.permissions);
    }
    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'role',
      entityId: role.id,
      entityLabel: role.name,
      after: { ...role },
    });
    return role;
  }

  async updateRole(
    ctx: RequestContext,
    tx: Tx,
    id: string,
    input: { name?: string; description?: string | null },
  ): Promise<Role> {
    assertCan(ctx, 'identity:role:update');
    const before = await this.roles.findById(tx, id);
    if (!before || before.organizationId !== ctx.organizationId) throw AppError.notFound('Rol');
    // Los roles del sistema sí se editan en permisos, pero no se renombran: la
    // UI y las plantillas los localizan por su código.
    if (before.isSystem && input.name && input.name !== before.name) {
      throw AppError.rule('Los roles del sistema no se pueden renombrar');
    }

    const after = { ...before, ...input };
    await this.roles.update(tx, after);
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'role',
      entityId: id,
      entityLabel: after.name,
      before: { ...before },
      after: { ...after },
    });
    return after;
  }

  async setRolePermissions(
    ctx: RequestContext,
    tx: Tx,
    roleId: string,
    grants: Array<{ key: string; scope: PermissionScope }>,
  ): Promise<void> {
    assertCan(ctx, 'identity:role:update');
    const role = await this.roles.findById(tx, roleId);
    if (!role || role.organizationId !== ctx.organizationId) throw AppError.notFound('Rol');

    // Un permiso inexistente en un rol es una mentira sobre lo que alguien puede
    // hacer: se rechaza al escribirlo, no al comprobarlo.
    const unknown = grants.filter((g) => !this.catalog.has(g.key)).map((g) => g.key);
    if (unknown.length > 0) {
      throw AppError.validation('Hay permisos que no existen', { unknown });
    }
    const badScope = grants.filter((g) => !PERMISSION_SCOPES.includes(g.scope));
    if (badScope.length > 0) {
      throw AppError.validation('Alcance inválido', { invalid: badScope });
    }

    const before = await this.roles.permissionsOf(tx, roleId);
    await this.roles.setPermissions(tx, ctx.organizationId, roleId, grants);
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'role_permissions',
      entityId: roleId,
      entityLabel: role.name,
      before: { count: before.length, keys: before.map((p) => p.key) },
      after: { count: grants.length, keys: grants.map((g) => g.key) },
    });
  }

  async deleteRole(ctx: RequestContext, tx: Tx, id: string): Promise<void> {
    assertCan(ctx, 'identity:role:delete');
    const role = await this.roles.findById(tx, id);
    if (!role || role.organizationId !== ctx.organizationId) throw AppError.notFound('Rol');
    if (role.isSystem) throw AppError.rule('Los roles del sistema no se pueden eliminar');

    await this.roles.delete(tx, id);
    await this.audit.record(tx, ctx, {
      action: 'DELETE',
      entityType: 'role',
      entityId: id,
      entityLabel: role.name,
      before: { ...role },
    });
  }

  /** Catálogo agrupado por módulo, para el editor de roles del frontend. */
  permissionCatalog(ctx: RequestContext): Array<{ module: string; permissions: PermissionDef[] }> {
    assertCan(ctx, 'identity:role:read');
    return [...this.catalog.byModule()].map(([module, permissions]) => ({ module, permissions }));
  }

  // ── Excepciones de permisos ───────────────────────────────────────────────

  async setOverride(
    ctx: RequestContext,
    tx: Tx,
    membershipId: string,
    input: { key: string; effect: 'ALLOW' | 'DENY'; scope?: PermissionScope; reason?: string | null },
  ): Promise<void> {
    assertCan(ctx, 'identity:member:assign_roles');
    if (!this.catalog.has(input.key)) throw AppError.validation(`El permiso ${input.key} no existe`);

    await this.roles.setOverride(
      tx,
      ctx.organizationId,
      membershipId,
      input.key,
      input.effect,
      input.scope ?? 'ORG',
      input.reason ?? null,
    );
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'permission_override',
      entityId: membershipId,
      after: { ...input },
    });
  }

  async clearOverride(ctx: RequestContext, tx: Tx, membershipId: string, key: string): Promise<void> {
    assertCan(ctx, 'identity:member:assign_roles');
    await this.roles.clearOverride(tx, membershipId, key);
  }

  // ── Equipos ───────────────────────────────────────────────────────────────

  async listTeams(ctx: RequestContext, tx: Tx): Promise<Array<Team & { memberCount: number }>> {
    assertCan(ctx, 'identity:team:read');
    return this.teams.list(tx, ctx.organizationId);
  }

  async createTeam(
    ctx: RequestContext,
    tx: Tx,
    input: {
      name: string;
      description?: string | null;
      leadMembershipId?: string | null;
      memberIds?: string[];
    },
  ): Promise<Team> {
    assertCan(ctx, 'identity:team:create');
    const team: Team = {
      id: newId(),
      organizationId: ctx.organizationId,
      name: input.name.trim(),
      description: input.description ?? null,
      parentTeamId: null,
      leadMembershipId: input.leadMembershipId ?? null,
    };
    await this.teams.save(tx, team);
    if (input.memberIds?.length) {
      await this.teams.setMembers(tx, ctx.organizationId, team.id, input.memberIds);
    }
    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'team',
      entityId: team.id,
      entityLabel: team.name,
      after: { ...team },
    });
    return team;
  }

  async updateTeam(
    ctx: RequestContext,
    tx: Tx,
    id: string,
    input: {
      name?: string;
      description?: string | null;
      leadMembershipId?: string | null;
      memberIds?: string[];
    },
  ): Promise<Team> {
    assertCan(ctx, 'identity:team:update');
    const before = await this.teams.findById(tx, id);
    if (!before || before.organizationId !== ctx.organizationId) throw AppError.notFound('Equipo');

    const after: Team = {
      ...before,
      name: input.name ?? before.name,
      description: input.description ?? before.description,
      leadMembershipId: input.leadMembershipId ?? before.leadMembershipId,
    };
    await this.teams.update(tx, after);
    if (input.memberIds) await this.teams.setMembers(tx, ctx.organizationId, id, input.memberIds);

    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'team',
      entityId: id,
      entityLabel: after.name,
      before: { ...before },
      after: { ...after },
    });
    return after;
  }

  async deleteTeam(ctx: RequestContext, tx: Tx, id: string): Promise<void> {
    assertCan(ctx, 'identity:team:delete');
    const team = await this.teams.findById(tx, id);
    if (!team || team.organizationId !== ctx.organizationId) throw AppError.notFound('Equipo');
    await this.teams.delete(tx, id);
    await this.audit.record(tx, ctx, {
      action: 'DELETE',
      entityType: 'team',
      entityId: id,
      entityLabel: team.name,
      before: { ...team },
    });
  }

  async teamMembers(ctx: RequestContext, tx: Tx, teamId: string): Promise<string[]> {
    assertCan(ctx, 'identity:team:read');
    return this.teams.memberIds(tx, teamId);
  }

  // ── Auditoría ─────────────────────────────────────────────────────────────

  async listAudit(
    ctx: RequestContext,
    tx: Tx,
    query: ListQuery,
  ): Promise<ListResult<Record<string, unknown>>> {
    assertCan(ctx, 'identity:audit:read');
    return runList(
      tx,
      {
        from: `FROM audit_logs a LEFT JOIN memberships m ON m.id = a.actor_membership_id
               LEFT JOIN users u ON u.id = m.user_id`,
        select: `a.id, a.action, a.entity_type, a.entity_id, a.entity_label, a.changed_fields,
                 a.before, a.after, a.occurred_at, a.request_id,
                 COALESCE(a.actor_label, u.first_name || ' ' || u.last_name) AS actor`,
        fields: {
          action: { column: 'a.action', type: 'text', sortable: true, filterable: true },
          entity_type: { column: 'a.entity_type', type: 'text', sortable: true, filterable: true },
          entity_id: { column: 'a.entity_id', type: 'uuid', sortable: false, filterable: true },
          entity_label: {
            column: 'a.entity_label',
            type: 'text',
            sortable: true,
            filterable: true,
            searchable: true,
          },
          actor: {
            column: `COALESCE(a.actor_label, u.first_name || ' ' || u.last_name)`,
            type: 'text',
            sortable: true,
            filterable: true,
            searchable: true,
          },
          actor_membership_id: {
            column: 'a.actor_membership_id',
            type: 'uuid',
            filterable: true,
            sortable: false,
          },
          occurred_at: { column: 'a.occurred_at', type: 'timestamp', sortable: true, filterable: true },
        },
        defaultSort: [{ field: 'occurred_at', dir: 'desc' }],
      },
      query,
    );
  }

  now(): Date {
    return this.clock.now();
  }
}
