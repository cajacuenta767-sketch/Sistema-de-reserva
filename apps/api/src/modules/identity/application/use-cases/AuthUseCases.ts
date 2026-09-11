import { AppError, newId, secureToken, type Clock } from '@erp/core';
import { PermissionSet, type PermissionScope, type Session, type Tokens } from '@erp/contracts';
import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import { withTenant, withoutTenant } from '../../../../platform/db/tenancy.js';
import type { TokenService } from '../../../../platform/security/JwtTokenService.js';
import type { PasswordHasher } from '../../../../platform/security/ScryptPasswordHasher.js';
import type { PermissionCatalog } from '../../../../platform/authz/catalog.js';
import type { Mailer } from '../../../../platform/mail/Mailer.js';
import type { AuditRecorder } from '../../../../platform/audit/AuditRecorder.js';
import type { RequestContext } from '../../../../platform/authz/RequestContext.js';
import { canLogin, toPublicUser, fullName, type Membership, type User } from '../../domain/User.js';
import { resolveTemplate, SYSTEM_ROLE_TEMPLATES } from '../../domain/roleTemplates.js';
import type {
  InvitationRepository,
  MembershipRepository,
  RefreshTokenRepository,
  RoleRepository,
  TeamRepository,
  UserRepository,
} from '../ports/IdentityRepositories.js';

/** Lo que el módulo `organization` expone y aquí se necesita. Se recibe por
 *  inyección para no acoplar los casos de uso a ese módulo. */
export interface OrganizationCreator {
  create(
    tx: Tx,
    input: { legalName: string; tradeName?: string; country?: string },
  ): Promise<{ id: string; tradeName: string; legalName: string }>;
  createDefaultBranch(tx: Tx, organizationId: string, name?: string): Promise<{ id: string }>;
}

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string | undefined;
  organizationName?: string | undefined;
  invitationToken?: string | undefined;
}

export interface AuthResult {
  tokens: Tokens;
  session: Session;
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const INVITATION_TTL_DAYS = 14;

export class AuthUseCases {
  constructor(
    private readonly pool: pg.Pool,
    private readonly users: UserRepository,
    private readonly memberships: MembershipRepository,
    private readonly roles: RoleRepository,
    private readonly teams: TeamRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly invitations: InvitationRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly catalog: PermissionCatalog,
    private readonly mailer: Mailer,
    private readonly audit: AuditRecorder,
    private readonly clock: Clock,
    private readonly organizations: () => OrganizationCreator,
  ) {}

  // ── Registro ──────────────────────────────────────────────────────────────

  async register(input: RegisterInput, meta: RequestMeta = {}): Promise<AuthResult> {
    const email = input.email.toLowerCase().trim();

    return withoutTenant(
      this.pool,
      async (tx) => {
        if (await this.users.findByEmail(tx, email)) {
          throw AppError.conflict('Ya existe una cuenta con ese correo');
        }

        const now = this.clock.now();
        const user: User = {
          id: newId(),
          email,
          passwordHash: await this.hasher.hash(input.password),
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          phone: input.phone ?? null,
          avatarFileId: null,
          locale: 'es-CO',
          status: 'ACTIVE',
          totpSecret: null,
          totpEnabled: false,
          lastLoginAt: null,
          isSuperAdmin: false,
          createdAt: now,
          updatedAt: now,
        };
        await this.users.save(tx, user);

        await tx.setUser(user.id);

        const organizationId = input.invitationToken
          ? await this.acceptInvitationInternal(tx, user, input.invitationToken)
          : await this.createOrganizationFor(
              tx,
              user,
              input.organizationName ?? `Empresa de ${user.firstName}`,
            );

        return this.issueSession(tx, user, organizationId, meta);
      },
      { authenticating: true },
    );
  }

  /**
   * Crea la organización, su sucursal principal, sus roles a partir de las
   * plantillas, y hace al usuario propietario. Todo en una transacción: una
   * organización a medio crear es peor que ninguna.
   */
  private async createOrganizationFor(tx: Tx, user: User, name: string): Promise<string> {
    const orgs = this.organizations();
    const org = await orgs.create(tx, { legalName: name.trim(), country: 'CO' });

    // A partir de aquí las tablas llevan RLS, así que hay que fijar el tenant
    // dentro de la MISMA transacción.
    await tx.client.query('SELECT set_config($1, $2, true)', ['app.organization_id', org.id]);

    await orgs.createDefaultBranch(tx, org.id);
    const roleIds = await this.seedRoles(tx, org.id);

    const membership: Membership = {
      id: newId(),
      userId: user.id,
      organizationId: org.id,
      defaultBranchId: null,
      jobTitle: null,
      status: 'ACTIVE',
      isOwner: true,
    };
    await this.memberships.save(tx, membership);

    const ownerRoleId = roleIds.get('OWNER');
    if (ownerRoleId) await this.roles.assignRoles(tx, org.id, membership.id, [ownerRoleId]);

    await this.audit.recordRaw(tx, {
      organizationId: org.id,
      actorMembershipId: membership.id,
      actorLabel: fullName(user),
      action: 'CREATE',
      entityType: 'organization',
      entityId: org.id,
      entityLabel: org.tradeName,
      after: { legalName: org.legalName, tradeName: org.tradeName, owner: user.email },
    });

    return org.id;
  }

  /** Copia las plantillas de rol a la organización. Idempotente. */
  async seedRoles(tx: Tx, organizationId: string): Promise<Map<string, string>> {
    const allKeys = this.catalog.all().map((p) => p.key);
    const ids = new Map<string, string>();

    for (const template of SYSTEM_ROLE_TEMPLATES) {
      const existing = await this.roles.findByCode(tx, organizationId, template.code);
      const roleId = existing?.id ?? newId();

      if (!existing) {
        await this.roles.save(tx, {
          id: roleId,
          organizationId,
          code: template.code,
          name: template.name,
          description: template.description,
          isSystem: true,
        });
      }

      await this.roles.setPermissions(tx, organizationId, roleId, resolveTemplate(template, allKeys));
      ids.set(template.code, roleId);
    }
    return ids;
  }

  // ── Inicio de sesión ──────────────────────────────────────────────────────

  async login(input: { email: string; password: string }, meta: RequestMeta = {}): Promise<AuthResult> {
    return withoutTenant(
      this.pool,
      async (tx) => {
        const user = await this.users.findByEmail(tx, input.email);

        // Se verifica el hash aunque el usuario no exista: si no, el tiempo de
        // respuesta revelaría qué correos están registrados.
        const valid = user
          ? await this.hasher.verify(input.password, user.passwordHash)
          : await this.hasher.verify(input.password, 'scrypt$00$00').then(() => false);

        if (!user || !valid) throw AppError.unauthorized('Correo o contraseña incorrectos');
        if (!canLogin(user)) throw AppError.forbidden('Esta cuenta está suspendida');

        // A partir de aquí la identidad está demostrada.
        await tx.setUser(user.id);
        await this.users.touchLogin(tx, user.id, this.clock.now());

        const memberships = await this.memberships.listForUser(tx, user.id);
        const organizationId = memberships[0]?.organizationId ?? null;
        if (!organizationId) {
          throw AppError.forbidden('Tu cuenta no pertenece a ninguna organización activa');
        }

        const result = await this.issueSession(tx, user, organizationId, meta);

        // El inicio de sesión es un evento de seguridad: queda en la auditoría
        // de la organización, con la IP desde la que se entró.
        const membership = memberships.find((m) => m.organizationId === organizationId);
        await tx.client.query('SELECT set_config($1, $2, true)', ['app.organization_id', organizationId]);
        await this.audit.recordRaw(tx, {
          organizationId,
          actorMembershipId: membership?.id ?? null,
          actorLabel: fullName(user),
          ip: meta.ip ?? null,
          action: 'LOGIN',
          entityType: 'session',
          entityId: user.id,
          entityLabel: user.email,
        });

        return result;
      },
      { authenticating: true },
    );
  }

  /**
   * Renueva la sesión rotando el token de refresco.
   *
   * Si llega un token ya rotado, es que alguien lo copió: se revocan TODAS las
   * sesiones del usuario. Perder la sesión molesta; que un atacante la conserve,
   * mucho más.
   */
  async refresh(refreshToken: string, meta: RequestMeta = {}): Promise<AuthResult> {
    const { sub } = this.tokens.verifyRefresh(refreshToken);

    const outcome: AuthResult | { readonly reuseDetectedFor: string } = await withoutTenant(
      this.pool,
      async (tx) => {
        const stored = await this.refreshTokens.findActiveByHash(tx, hashToken(refreshToken));
        if (!stored) throw AppError.unauthorized('Token de refresco inválido');

        // Ojo: la revocación NO puede hacerse aquí. Lanzar el error revierte la
        // transacción y con ella la revocación, de modo que la detección de
        // reuso detectaría sin revocar nada. Se marca y se revoca fuera.
        if (stored.revokedAt) return { reuseDetectedFor: stored.userId } as const;

        const user = await this.users.findById(tx, sub);
        if (!user || !canLogin(user)) throw AppError.unauthorized('Sesión no válida');

        const memberships = await this.memberships.listForUser(tx, user.id);
        const organizationId = memberships[0]?.organizationId;
        if (!organizationId) throw AppError.forbidden('Tu cuenta no pertenece a ninguna organización');

        return this.issueSession(tx, user, organizationId, meta, stored.id);
      },
      { userId: sub },
    );

    if ('reuseDetectedFor' in outcome) {
      // Transacción aparte, para que la revocación SÍ se confirme.
      await withoutTenant(
        this.pool,
        (tx) => this.refreshTokens.revokeAllForUser(tx, outcome.reuseDetectedFor),
        {
          userId: outcome.reuseDetectedFor,
        },
      );
      throw AppError.unauthorized('Se detectó un uso indebido del token. Vuelve a iniciar sesión.');
    }

    return outcome;
  }

  async logout(refreshToken: string): Promise<void> {
    await withoutTenant(this.pool, async (tx) => {
      const stored = await this.refreshTokens.findActiveByHash(tx, hashToken(refreshToken));
      if (stored) await this.refreshTokens.revoke(tx, stored.id);
    });
  }

  async logoutEverywhere(ctx: RequestContext): Promise<number> {
    return withoutTenant(this.pool, (tx) => this.refreshTokens.revokeAllForUser(tx, ctx.user.id));
  }

  private async issueSession(
    tx: Tx,
    user: User,
    organizationId: string,
    meta: RequestMeta,
    rotatingFrom?: string,
  ): Promise<AuthResult> {
    const membership = await this.memberships.find(tx, user.id, organizationId);
    if (!membership || membership.status !== 'ACTIVE') {
      throw AppError.forbidden('No perteneces a esa organización');
    }

    const pair = this.tokens.issue({
      sub: user.id,
      email: user.email,
      org: organizationId,
      mem: membership.id,
      sa: user.isSuperAdmin,
    });

    // El identificador de la fila ES el `jti` del token: no hay forma de que se
    // desincronicen.
    const tokenId = pair.refreshTokenId;
    await this.refreshTokens.save(tx, {
      id: tokenId,
      userId: user.id,
      tokenHash: hashToken(pair.refreshToken),
      expiresAt: this.tokens.refreshExpiresAt(this.clock.now()),
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
    });
    if (rotatingFrom) await this.refreshTokens.rotate(tx, rotatingFrom, tokenId);

    return { tokens: pair, session: await this.buildSession(tx, user, organizationId, membership) };
  }

  /** Sesión completa: usuario, organizaciones, permisos efectivos y roles. */
  async buildSession(tx: Tx, user: User, organizationId: string, membership: Membership): Promise<Session> {
    const orgRows = await tx.client.query<{
      id: string;
      trade_name: string;
      legal_name: string;
      tax_id: string | null;
      functional_currency: string;
      brand_hue: number | null;
      logo_file_id: string | null;
      membership_id: string;
    }>(
      `SELECT o.id, o.trade_name, o.legal_name, o.tax_id, o.functional_currency, o.brand_hue,
              o.logo_file_id, m.id AS membership_id
         FROM organizations o JOIN memberships m ON m.organization_id = o.id
        WHERE m.user_id = $1 AND m.status = 'ACTIVE' AND o.status <> 'CLOSED'
        ORDER BY o.trade_name`,
      [user.id],
    );

    // Los permisos viven en tablas con RLS: hay que estar dentro del tenant.
    const { permissions, roles } = await withTenant(
      this.pool,
      { organizationId, membershipId: membership.id, userId: user.id },
      async (t) => {
        const { fromRoles, overrides } = await this.roles.effectivePermissions(t, membership.id);
        const roleList = await this.roles.rolesOf(t, membership.id);
        return {
          permissions: PermissionSet.resolve(fromRoles, overrides, user.isSuperAdmin),
          roles: roleList.map((r) => ({ id: r.id, name: r.name })),
        };
      },
    );

    return {
      user: toPublicUser(user),
      organizations: orgRows.rows.map((o) => ({
        id: o.id,
        tradeName: o.trade_name,
        legalName: o.legal_name,
        taxId: o.tax_id,
        functionalCurrency: o.functional_currency,
        brandHue: o.brand_hue,
        logoUrl: o.logo_file_id ? `/api/v1/files/${o.logo_file_id}` : null,
        membershipId: o.membership_id,
      })),
      activeOrganizationId: organizationId,
      permissions: permissions.toJSON() as Record<string, PermissionScope>,
      roles,
    };
  }

  async session(ctx: RequestContext): Promise<Session> {
    return withoutTenant(
      this.pool,
      async (tx) => {
        const user = await this.users.findById(tx, ctx.user.id);
        if (!user) throw AppError.notFound('Usuario');
        const membership = await this.memberships.find(tx, user.id, ctx.organizationId);
        if (!membership) throw AppError.forbidden('No perteneces a esta organización');
        return this.buildSession(tx, user, ctx.organizationId, membership);
      },
      { userId: ctx.user.id },
    );
  }

  async switchOrganization(ctx: RequestContext, organizationId: string): Promise<AuthResult> {
    return withoutTenant(
      this.pool,
      async (tx) => {
        const user = await this.users.findById(tx, ctx.user.id);
        if (!user) throw AppError.notFound('Usuario');
        return this.issueSession(tx, user, organizationId, {});
      },
      { userId: ctx.user.id },
    );
  }

  // ── Perfil ────────────────────────────────────────────────────────────────

  async updateProfile(
    ctx: RequestContext,
    input: {
      firstName?: string;
      lastName?: string;
      phone?: string | null;
      locale?: string;
      avatarFileId?: string | null;
    },
  ): Promise<User> {
    return withoutTenant(
      this.pool,
      async (tx) => {
        const user = await this.users.findById(tx, ctx.user.id);
        if (!user) throw AppError.notFound('Usuario');
        const updated: User = { ...user, ...input, updatedAt: this.clock.now() };
        await this.users.update(tx, updated);
        return updated;
      },
      { userId: ctx.user.id },
    );
  }

  async changePassword(ctx: RequestContext, current: string, next: string): Promise<void> {
    await withoutTenant(
      this.pool,
      async (tx) => {
        const user = await this.users.findById(tx, ctx.user.id);
        if (!user) throw AppError.notFound('Usuario');
        if (!(await this.hasher.verify(current, user.passwordHash))) {
          throw AppError.unauthorized('La contraseña actual no es correcta');
        }
        await this.users.update(tx, { ...user, passwordHash: await this.hasher.hash(next) });
        // Cambiar la contraseña cierra el resto de sesiones: es la razón
        // principal por la que alguien la cambia.
        await this.refreshTokens.revokeAllForUser(tx, user.id);
      },
      { userId: ctx.user.id },
    );
  }

  // ── Invitaciones ──────────────────────────────────────────────────────────

  async invite(
    ctx: RequestContext,
    input: { email: string; roleIds: string[] },
  ): Promise<{ id: string; token: string }> {
    const email = input.email.toLowerCase().trim();
    const token = secureToken();
    const id = newId();

    // Dentro del tenant: así `findByEmail` solo alcanza a usuarios de ESTA
    // organización, que es justo lo que hay que comprobar, y la auditoría tiene
    // el tenant fijado.
    await withTenant(
      this.pool,
      { organizationId: ctx.organizationId, membershipId: ctx.membershipId, userId: ctx.user.id },
      async (tx) => {
        const existing = await this.users.findByEmail(tx, email);
        if (existing) {
          const membership = await this.memberships.find(tx, existing.id, ctx.organizationId);
          if (membership && membership.status === 'ACTIVE') {
            throw AppError.conflict('Esa persona ya pertenece a la organización');
          }
        }
        await this.invitations.save(tx, {
          id,
          organizationId: ctx.organizationId,
          email,
          roleIds: input.roleIds,
          tokenHash: hashToken(token),
          invitedBy: ctx.membershipId,
          expiresAt: new Date(this.clock.now().getTime() + INVITATION_TTL_DAYS * 86_400_000),
        });

        await this.audit.record(tx, ctx, {
          action: 'CREATE',
          entityType: 'invitation',
          entityId: id,
          entityLabel: email,
          after: { email, roleIds: input.roleIds },
        });
      },
    );

    await this.mailer.send({
      to: email,
      subject: 'Te han invitado a unirte',
      text:
        `${ctx.user.fullName} te ha invitado a unirte a su organización.\n\n` +
        `Acepta la invitación con este código: ${token}\n` +
        `Caduca en ${INVITATION_TTL_DAYS} días.`,
    });

    return { id, token };
  }

  private async acceptInvitationInternal(tx: Tx, user: User, token: string): Promise<string> {
    const invitation = await this.invitations.findPendingByHash(tx, hashToken(token));
    if (!invitation) throw AppError.validation('La invitación no es válida o ya caducó');
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      throw AppError.forbidden('Esta invitación es para otro correo');
    }

    await tx.client.query('SELECT set_config($1, $2, true)', [
      'app.organization_id',
      invitation.organizationId,
    ]);

    const membership: Membership = {
      id: newId(),
      userId: user.id,
      organizationId: invitation.organizationId,
      defaultBranchId: null,
      jobTitle: null,
      status: 'ACTIVE',
      isOwner: false,
    };
    await this.memberships.save(tx, membership);

    if (invitation.roleIds.length > 0) {
      await this.roles.assignRoles(tx, invitation.organizationId, membership.id, invitation.roleIds);
    }
    await this.invitations.markAccepted(tx, invitation.id, this.clock.now());

    await this.audit.recordRaw(tx, {
      organizationId: invitation.organizationId,
      actorMembershipId: membership.id,
      actorLabel: fullName(user),
      action: 'CREATE',
      entityType: 'membership',
      entityId: membership.id,
      entityLabel: user.email,
      after: { email: user.email, roleIds: invitation.roleIds, via: 'invitación' },
    });

    return invitation.organizationId;
  }

  async acceptInvitation(token: string, userId: string): Promise<string> {
    return withoutTenant(
      this.pool,
      async (tx) => {
        const user = await this.users.findById(tx, userId);
        if (!user) throw AppError.notFound('Usuario');
        return this.acceptInvitationInternal(tx, user, token);
      },
      { userId },
    );
  }

  async listInvitations(
    ctx: RequestContext,
  ): Promise<Array<{ id: string; email: string; roleIds: string[]; expiresAt: Date; createdAt: Date }>> {
    return withoutTenant(this.pool, (tx) => this.invitations.listPending(tx, ctx.organizationId));
  }

  async revokeInvitation(ctx: RequestContext, id: string): Promise<void> {
    await withoutTenant(this.pool, (tx) => this.invitations.revoke(tx, ctx.organizationId, id));
  }

  /** Nombre completo, para etiquetas de auditoría. */
  static labelOf(user: User): string {
    return fullName(user);
  }

  /** Miembros del equipo del usuario, para el alcance TEAM. */
  async teammatesOf(tx: Tx, membershipId: string): Promise<string[]> {
    return this.memberships.teammateIds(tx, membershipId);
  }

  /** Equipos de la organización, expuesto para el módulo de accesos. */
  teamRepository(): TeamRepository {
    return this.teams;
  }
}

export interface RequestMeta {
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
}
