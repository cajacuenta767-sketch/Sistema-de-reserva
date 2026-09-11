import type { PermissionScope } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { Membership, Role, Team, User } from '../../domain/User.js';
import type {
  InvitationRepository,
  MembershipRepository,
  RefreshTokenRepository,
  RoleRepository,
  TeamRepository,
  UserRepository,
} from '../../application/ports/IdentityRepositories.js';

// ── Usuarios ────────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  avatar_file_id: string | null;
  locale: string;
  status: string;
  totp_secret: string | null;
  totp_enabled: boolean;
  last_login_at: Date | null;
  is_super_admin: boolean;
  created_at: Date;
  updated_at: Date;
}

export const userFromRow = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  passwordHash: r.password_hash,
  firstName: r.first_name,
  lastName: r.last_name,
  phone: r.phone,
  avatarFileId: r.avatar_file_id,
  locale: r.locale,
  status: r.status as User['status'],
  totpSecret: r.totp_secret,
  totpEnabled: r.totp_enabled,
  lastLoginAt: r.last_login_at,
  isSuperAdmin: r.is_super_admin,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const USER_COLS = `id, email, password_hash, first_name, last_name, phone, avatar_file_id, locale,
  status, totp_secret, totp_enabled, last_login_at, is_super_admin, created_at, updated_at`;

export class PgUserRepository implements UserRepository {
  async findById(tx: Tx, id: string): Promise<User | null> {
    const { rows } = await tx.client.query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]);
    return rows[0] ? userFromRow(rows[0]) : null;
  }

  async findByEmail(tx: Tx, email: string): Promise<User | null> {
    const { rows } = await tx.client.query<UserRow>(
      `SELECT ${USER_COLS} FROM users WHERE lower(email) = lower($1)`,
      [email],
    );
    return rows[0] ? userFromRow(rows[0]) : null;
  }

  async save(tx: Tx, u: User): Promise<void> {
    await tx.client.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, phone, avatar_file_id,
                          locale, status, is_super_admin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        u.id,
        u.email,
        u.passwordHash,
        u.firstName,
        u.lastName,
        u.phone,
        u.avatarFileId,
        u.locale,
        u.status,
        u.isSuperAdmin,
      ],
    );
  }

  async update(tx: Tx, u: User): Promise<void> {
    await tx.client.query(
      `UPDATE users SET email=$2, password_hash=$3, first_name=$4, last_name=$5, phone=$6,
                        avatar_file_id=$7, locale=$8, status=$9, totp_secret=$10, totp_enabled=$11
       WHERE id=$1`,
      [
        u.id,
        u.email,
        u.passwordHash,
        u.firstName,
        u.lastName,
        u.phone,
        u.avatarFileId,
        u.locale,
        u.status,
        u.totpSecret,
        u.totpEnabled,
      ],
    );
  }

  async touchLogin(tx: Tx, id: string, at: Date): Promise<void> {
    await tx.client.query('UPDATE users SET last_login_at = $2 WHERE id = $1', [id, at]);
  }
}

// ── Membresías ──────────────────────────────────────────────────────────────

interface MembershipRow {
  id: string;
  user_id: string;
  organization_id: string;
  default_branch_id: string | null;
  job_title: string | null;
  status: string;
  is_owner: boolean;
}

const membershipFromRow = (r: MembershipRow): Membership => ({
  id: r.id,
  userId: r.user_id,
  organizationId: r.organization_id,
  defaultBranchId: r.default_branch_id,
  jobTitle: r.job_title,
  status: r.status as Membership['status'],
  isOwner: r.is_owner,
});

const MEMBERSHIP_COLS = 'id, user_id, organization_id, default_branch_id, job_title, status, is_owner';

export class PgMembershipRepository implements MembershipRepository {
  async findById(tx: Tx, id: string): Promise<Membership | null> {
    const { rows } = await tx.client.query<MembershipRow>(
      `SELECT ${MEMBERSHIP_COLS} FROM memberships WHERE id = $1`,
      [id],
    );
    return rows[0] ? membershipFromRow(rows[0]) : null;
  }

  async find(tx: Tx, userId: string, organizationId: string): Promise<Membership | null> {
    const { rows } = await tx.client.query<MembershipRow>(
      `SELECT ${MEMBERSHIP_COLS} FROM memberships WHERE user_id = $1 AND organization_id = $2`,
      [userId, organizationId],
    );
    return rows[0] ? membershipFromRow(rows[0]) : null;
  }

  async listForUser(tx: Tx, userId: string): Promise<Membership[]> {
    const { rows } = await tx.client.query<MembershipRow>(
      `SELECT ${MEMBERSHIP_COLS} FROM memberships WHERE user_id = $1 AND status = 'ACTIVE'`,
      [userId],
    );
    return rows.map(membershipFromRow);
  }

  async save(tx: Tx, m: Membership): Promise<void> {
    await tx.client.query(
      `INSERT INTO memberships (id, user_id, organization_id, default_branch_id, job_title, status, is_owner)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [m.id, m.userId, m.organizationId, m.defaultBranchId, m.jobTitle, m.status, m.isOwner],
    );
  }

  async update(tx: Tx, m: Membership): Promise<void> {
    await tx.client.query(
      `UPDATE memberships SET default_branch_id=$2, job_title=$3, status=$4, is_owner=$5 WHERE id=$1`,
      [m.id, m.defaultBranchId, m.jobTitle, m.status, m.isOwner],
    );
  }

  async teammateIds(tx: Tx, membershipId: string): Promise<string[]> {
    const { rows } = await tx.client.query<{ membership_id: string }>(
      `SELECT DISTINCT other.membership_id
         FROM team_members mine
         JOIN team_members other ON other.team_id = mine.team_id
        WHERE mine.membership_id = $1 AND other.membership_id <> $1`,
      [membershipId],
    );
    return rows.map((r) => r.membership_id);
  }
}

// ── Roles y permisos ────────────────────────────────────────────────────────

interface RoleRow {
  id: string;
  organization_id: string;
  code: string | null;
  name: string;
  description: string | null;
  is_system: boolean;
}

const roleFromRow = (r: RoleRow): Role => ({
  id: r.id,
  organizationId: r.organization_id,
  code: r.code,
  name: r.name,
  description: r.description,
  isSystem: r.is_system,
});

export class PgRoleRepository implements RoleRepository {
  async findById(tx: Tx, id: string): Promise<Role | null> {
    const { rows } = await tx.client.query<RoleRow>(
      'SELECT id, organization_id, code, name, description, is_system FROM roles WHERE id = $1',
      [id],
    );
    return rows[0] ? roleFromRow(rows[0]) : null;
  }

  async findByCode(tx: Tx, organizationId: string, code: string): Promise<Role | null> {
    const { rows } = await tx.client.query<RoleRow>(
      `SELECT id, organization_id, code, name, description, is_system
         FROM roles WHERE organization_id = $1 AND code = $2`,
      [organizationId, code],
    );
    return rows[0] ? roleFromRow(rows[0]) : null;
  }

  async list(tx: Tx, organizationId: string): Promise<Array<Role & { memberCount: number }>> {
    const { rows } = await tx.client.query<RoleRow & { member_count: string }>(
      `SELECT r.id, r.organization_id, r.code, r.name, r.description, r.is_system,
              count(mr.membership_id)::bigint AS member_count
         FROM roles r
         LEFT JOIN membership_roles mr ON mr.role_id = r.id
        WHERE r.organization_id = $1
        GROUP BY r.id
        ORDER BY r.is_system DESC, r.name`,
      [organizationId],
    );
    return rows.map((r) => ({ ...roleFromRow(r), memberCount: Number(r.member_count) }));
  }

  async save(tx: Tx, r: Role): Promise<void> {
    await tx.client.query(
      `INSERT INTO roles (id, organization_id, code, name, description, is_system)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [r.id, r.organizationId, r.code, r.name, r.description, r.isSystem],
    );
  }

  async update(tx: Tx, r: Role): Promise<void> {
    await tx.client.query('UPDATE roles SET name=$2, description=$3 WHERE id=$1', [
      r.id,
      r.name,
      r.description,
    ]);
  }

  async delete(tx: Tx, id: string): Promise<void> {
    await tx.client.query('DELETE FROM roles WHERE id = $1', [id]);
  }

  async permissionsOf(tx: Tx, roleId: string): Promise<Array<{ key: string; scope: PermissionScope }>> {
    const { rows } = await tx.client.query<{ permission_key: string; scope: string }>(
      'SELECT permission_key, scope FROM role_permissions WHERE role_id = $1 ORDER BY permission_key',
      [roleId],
    );
    return rows.map((r) => ({ key: r.permission_key, scope: r.scope as PermissionScope }));
  }

  async setPermissions(
    tx: Tx,
    organizationId: string,
    roleId: string,
    grants: ReadonlyArray<{ key: string; scope: PermissionScope }>,
  ): Promise<void> {
    await tx.client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    if (grants.length === 0) return;

    // Un único INSERT con UNNEST: insertar 300 permisos fila a fila es 300 viajes.
    await tx.client.query(
      `INSERT INTO role_permissions (organization_id, role_id, permission_key, scope)
       SELECT $1, $2, k, s FROM unnest($3::text[], $4::text[]) AS t(k, s)`,
      [organizationId, roleId, grants.map((g) => g.key), grants.map((g) => g.scope)],
    );
  }

  async rolesOf(tx: Tx, membershipId: string): Promise<Role[]> {
    const { rows } = await tx.client.query<RoleRow>(
      `SELECT r.id, r.organization_id, r.code, r.name, r.description, r.is_system
         FROM roles r JOIN membership_roles mr ON mr.role_id = r.id
        WHERE mr.membership_id = $1 ORDER BY r.name`,
      [membershipId],
    );
    return rows.map(roleFromRow);
  }

  async assignRoles(tx: Tx, organizationId: string, membershipId: string, roleIds: string[]): Promise<void> {
    await tx.client.query('DELETE FROM membership_roles WHERE membership_id = $1', [membershipId]);
    if (roleIds.length === 0) return;
    await tx.client.query(
      `INSERT INTO membership_roles (organization_id, membership_id, role_id)
       SELECT $1, $2, id FROM unnest($3::uuid[]) AS id`,
      [organizationId, membershipId, roleIds],
    );
  }

  async effectivePermissions(
    tx: Tx,
    membershipId: string,
  ): Promise<{
    fromRoles: Array<{ key: string; scope: PermissionScope }>;
    overrides: Array<{ key: string; effect: 'ALLOW' | 'DENY'; scope: PermissionScope }>;
  }> {
    // Secuencial: comparten el cliente de la transacción.
    const roles = await tx.client.query<{ permission_key: string; scope: string }>(
      `SELECT rp.permission_key, rp.scope
         FROM membership_roles mr
         JOIN role_permissions rp ON rp.role_id = mr.role_id
        WHERE mr.membership_id = $1`,
      [membershipId],
    );
    const overrides = await tx.client.query<{ permission_key: string; effect: string; scope: string }>(
      'SELECT permission_key, effect, scope FROM permission_overrides WHERE membership_id = $1',
      [membershipId],
    );

    return {
      fromRoles: roles.rows.map((r) => ({ key: r.permission_key, scope: r.scope as PermissionScope })),
      overrides: overrides.rows.map((r) => ({
        key: r.permission_key,
        effect: r.effect as 'ALLOW' | 'DENY',
        scope: r.scope as PermissionScope,
      })),
    };
  }

  async setOverride(
    tx: Tx,
    organizationId: string,
    membershipId: string,
    key: string,
    effect: 'ALLOW' | 'DENY',
    scope: PermissionScope,
    reason: string | null,
  ): Promise<void> {
    await tx.client.query(
      `INSERT INTO permission_overrides (id, organization_id, membership_id, permission_key, effect, scope, reason)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
       ON CONFLICT (membership_id, permission_key)
       DO UPDATE SET effect = EXCLUDED.effect, scope = EXCLUDED.scope, reason = EXCLUDED.reason`,
      [organizationId, membershipId, key, effect, scope, reason],
    );
  }

  async clearOverride(tx: Tx, membershipId: string, key: string): Promise<void> {
    await tx.client.query(
      'DELETE FROM permission_overrides WHERE membership_id = $1 AND permission_key = $2',
      [membershipId, key],
    );
  }
}

// ── Equipos ─────────────────────────────────────────────────────────────────

interface TeamRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  parent_team_id: string | null;
  lead_membership_id: string | null;
}

const teamFromRow = (r: TeamRow): Team => ({
  id: r.id,
  organizationId: r.organization_id,
  name: r.name,
  description: r.description,
  parentTeamId: r.parent_team_id,
  leadMembershipId: r.lead_membership_id,
});

const TEAM_COLS = 'id, organization_id, name, description, parent_team_id, lead_membership_id';

export class PgTeamRepository implements TeamRepository {
  async findById(tx: Tx, id: string): Promise<Team | null> {
    const { rows } = await tx.client.query<TeamRow>(`SELECT ${TEAM_COLS} FROM teams WHERE id = $1`, [id]);
    return rows[0] ? teamFromRow(rows[0]) : null;
  }

  async list(tx: Tx, organizationId: string): Promise<Array<Team & { memberCount: number }>> {
    const { rows } = await tx.client.query<TeamRow & { member_count: string }>(
      `SELECT t.id, t.organization_id, t.name, t.description, t.parent_team_id, t.lead_membership_id,
              count(tm.membership_id)::bigint AS member_count
         FROM teams t LEFT JOIN team_members tm ON tm.team_id = t.id
        WHERE t.organization_id = $1 GROUP BY t.id ORDER BY t.name`,
      [organizationId],
    );
    return rows.map((r) => ({ ...teamFromRow(r), memberCount: Number(r.member_count) }));
  }

  async save(tx: Tx, t: Team): Promise<void> {
    await tx.client.query(
      `INSERT INTO teams (id, organization_id, name, description, parent_team_id, lead_membership_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [t.id, t.organizationId, t.name, t.description, t.parentTeamId, t.leadMembershipId],
    );
  }

  async update(tx: Tx, t: Team): Promise<void> {
    await tx.client.query(
      'UPDATE teams SET name=$2, description=$3, parent_team_id=$4, lead_membership_id=$5 WHERE id=$1',
      [t.id, t.name, t.description, t.parentTeamId, t.leadMembershipId],
    );
  }

  async delete(tx: Tx, id: string): Promise<void> {
    await tx.client.query('DELETE FROM teams WHERE id = $1', [id]);
  }

  async setMembers(tx: Tx, organizationId: string, teamId: string, membershipIds: string[]): Promise<void> {
    await tx.client.query('DELETE FROM team_members WHERE team_id = $1', [teamId]);
    if (membershipIds.length === 0) return;
    await tx.client.query(
      `INSERT INTO team_members (organization_id, team_id, membership_id)
       SELECT $1, $2, id FROM unnest($3::uuid[]) AS id`,
      [organizationId, teamId, membershipIds],
    );
  }

  async memberIds(tx: Tx, teamId: string): Promise<string[]> {
    const { rows } = await tx.client.query<{ membership_id: string }>(
      'SELECT membership_id FROM team_members WHERE team_id = $1',
      [teamId],
    );
    return rows.map((r) => r.membership_id);
  }
}

// ── Sesiones ────────────────────────────────────────────────────────────────

export class PgRefreshTokenRepository implements RefreshTokenRepository {
  async save(
    tx: Tx,
    input: {
      id: string;
      userId: string;
      tokenHash: string;
      expiresAt: Date;
      userAgent?: string | null;
      ip?: string | null;
    },
  ): Promise<void> {
    await tx.client.query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, user_agent, ip)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [input.id, input.userId, input.tokenHash, input.expiresAt, input.userAgent ?? null, input.ip ?? null],
    );
  }

  async findActiveByHash(
    tx: Tx,
    tokenHash: string,
  ): Promise<{ id: string; userId: string; revokedAt: Date | null } | null> {
    const { rows } = await tx.client.query<{ id: string; user_id: string; revoked_at: Date | null }>(
      'SELECT id, user_id, revoked_at FROM refresh_tokens WHERE token_hash = $1 AND expires_at > now()',
      [tokenHash],
    );
    const row = rows[0];
    return row ? { id: row.id, userId: row.user_id, revokedAt: row.revoked_at } : null;
  }

  async rotate(tx: Tx, oldId: string, newId: string): Promise<void> {
    await tx.client.query('UPDATE refresh_tokens SET revoked_at = now(), replaced_by_id = $2 WHERE id = $1', [
      oldId,
      newId,
    ]);
  }

  async revokeAllForUser(tx: Tx, userId: string): Promise<number> {
    const result = await tx.client.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
    return result.rowCount ?? 0;
  }

  async revoke(tx: Tx, id: string): Promise<void> {
    await tx.client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [id]);
  }
}

// ── Invitaciones ────────────────────────────────────────────────────────────

export class PgInvitationRepository implements InvitationRepository {
  async save(
    tx: Tx,
    input: {
      id: string;
      organizationId: string;
      email: string;
      roleIds: string[];
      tokenHash: string;
      invitedBy: string | null;
      expiresAt: Date;
    },
  ): Promise<void> {
    await tx.client.query(
      `INSERT INTO invitations (id, organization_id, email, role_ids, token_hash, invited_by, expires_at)
       VALUES ($1,$2,$3,$4::uuid[],$5,$6,$7)`,
      [
        input.id,
        input.organizationId,
        input.email,
        input.roleIds,
        input.tokenHash,
        input.invitedBy,
        input.expiresAt,
      ],
    );
  }

  async findPendingByHash(
    tx: Tx,
    tokenHash: string,
  ): Promise<{ id: string; organizationId: string; email: string; roleIds: string[] } | null> {
    // Sin RLS aquí a propósito: quien acepta una invitación todavía no pertenece
    // a la organización, así que la consulta va por el hash del token, que es el
    // secreto que demuestra que fue invitado.
    const { rows } = await tx.client.query<{
      id: string;
      organization_id: string;
      email: string;
      role_ids: string[];
    }>(
      `SELECT id, organization_id, email, role_ids FROM invitations
        WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
      [tokenHash],
    );
    const row = rows[0];
    return row
      ? { id: row.id, organizationId: row.organization_id, email: row.email, roleIds: row.role_ids }
      : null;
  }

  async markAccepted(tx: Tx, id: string, at: Date): Promise<void> {
    await tx.client.query('UPDATE invitations SET accepted_at = $2 WHERE id = $1', [id, at]);
  }

  async listPending(
    tx: Tx,
    organizationId: string,
  ): Promise<Array<{ id: string; email: string; roleIds: string[]; expiresAt: Date; createdAt: Date }>> {
    const { rows } = await tx.client.query<{
      id: string;
      email: string;
      role_ids: string[];
      expires_at: Date;
      created_at: Date;
    }>(
      `SELECT id, email, role_ids, expires_at, created_at FROM invitations
        WHERE organization_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
        ORDER BY created_at DESC`,
      [organizationId],
    );
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      roleIds: r.role_ids,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    }));
  }

  async revoke(tx: Tx, organizationId: string, id: string): Promise<void> {
    // La tabla no tiene RLS, así que la organización se acota aquí a mano.
    await tx.client.query(
      'UPDATE invitations SET revoked_at = now() WHERE id = $1 AND organization_id = $2',
      [id, organizationId],
    );
  }
}
