import type { PermissionScope } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { Membership, Role, Team, User } from '../../domain/User.js';

export interface UserRepository {
  findById(tx: Tx, id: string): Promise<User | null>;
  findByEmail(tx: Tx, email: string): Promise<User | null>;
  save(tx: Tx, user: User): Promise<void>;
  update(tx: Tx, user: User): Promise<void>;
  touchLogin(tx: Tx, id: string, at: Date): Promise<void>;
}

export interface MembershipRepository {
  findById(tx: Tx, id: string): Promise<Membership | null>;
  find(tx: Tx, userId: string, organizationId: string): Promise<Membership | null>;
  listForUser(tx: Tx, userId: string): Promise<Membership[]>;
  save(tx: Tx, membership: Membership): Promise<void>;
  update(tx: Tx, membership: Membership): Promise<void>;
  /** Membresías que comparten equipo: resuelve el alcance TEAM. */
  teammateIds(tx: Tx, membershipId: string): Promise<string[]>;
}

export interface RoleRepository {
  findById(tx: Tx, id: string): Promise<Role | null>;
  findByCode(tx: Tx, organizationId: string, code: string): Promise<Role | null>;
  list(tx: Tx, organizationId: string): Promise<Array<Role & { memberCount: number }>>;
  save(tx: Tx, role: Role): Promise<void>;
  update(tx: Tx, role: Role): Promise<void>;
  delete(tx: Tx, id: string): Promise<void>;

  permissionsOf(tx: Tx, roleId: string): Promise<Array<{ key: string; scope: PermissionScope }>>;
  setPermissions(
    tx: Tx,
    organizationId: string,
    roleId: string,
    grants: ReadonlyArray<{ key: string; scope: PermissionScope }>,
  ): Promise<void>;

  rolesOf(tx: Tx, membershipId: string): Promise<Role[]>;
  assignRoles(tx: Tx, organizationId: string, membershipId: string, roleIds: string[]): Promise<void>;

  /** Permisos efectivos ya resueltos: roles ∪ ALLOW − DENY. */
  effectivePermissions(
    tx: Tx,
    membershipId: string,
  ): Promise<{
    fromRoles: Array<{ key: string; scope: PermissionScope }>;
    overrides: Array<{ key: string; effect: 'ALLOW' | 'DENY'; scope: PermissionScope }>;
  }>;

  setOverride(
    tx: Tx,
    organizationId: string,
    membershipId: string,
    key: string,
    effect: 'ALLOW' | 'DENY',
    scope: PermissionScope,
    reason: string | null,
  ): Promise<void>;
  clearOverride(tx: Tx, membershipId: string, key: string): Promise<void>;
}

export interface TeamRepository {
  findById(tx: Tx, id: string): Promise<Team | null>;
  list(tx: Tx, organizationId: string): Promise<Array<Team & { memberCount: number }>>;
  save(tx: Tx, team: Team): Promise<void>;
  update(tx: Tx, team: Team): Promise<void>;
  delete(tx: Tx, id: string): Promise<void>;
  setMembers(tx: Tx, organizationId: string, teamId: string, membershipIds: string[]): Promise<void>;
  memberIds(tx: Tx, teamId: string): Promise<string[]>;
}

export interface RefreshTokenRepository {
  save(
    tx: Tx,
    input: {
      id: string;
      userId: string;
      tokenHash: string;
      expiresAt: Date;
      userAgent?: string | null;
      ip?: string | null;
    },
  ): Promise<void>;
  /** `now` viene del reloj inyectado: si la consulta usara `now()` de
   *  PostgreSQL, un test con reloj fijo compararía contra dos relojes distintos. */
  findActiveByHash(
    tx: Tx,
    tokenHash: string,
    now: Date,
  ): Promise<{ id: string; userId: string; revokedAt: Date | null } | null>;
  /** Marca el token como usado y enlaza el que lo sustituye (detección de reuso). */
  rotate(tx: Tx, oldId: string, newId: string): Promise<void>;
  revokeAllForUser(tx: Tx, userId: string): Promise<number>;
  revoke(tx: Tx, id: string): Promise<void>;
}

export interface InvitationRepository {
  save(
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
  ): Promise<void>;
  findPendingByHash(
    tx: Tx,
    tokenHash: string,
    now: Date,
  ): Promise<{ id: string; organizationId: string; email: string; roleIds: string[] } | null>;
  markAccepted(tx: Tx, id: string, at: Date): Promise<void>;
  listPending(
    tx: Tx,
    organizationId: string,
  ): Promise<Array<{ id: string; email: string; roleIds: string[]; expiresAt: Date; createdAt: Date }>>;
  revoke(tx: Tx, organizationId: string, id: string): Promise<void>;
}
