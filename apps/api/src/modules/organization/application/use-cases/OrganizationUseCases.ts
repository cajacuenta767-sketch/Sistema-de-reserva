import { AppError, newId, type Clock } from '@erp/core';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { RequestContext } from '../../../../platform/authz/RequestContext.js';
import type { AuditRecorder } from '../../../../platform/audit/AuditRecorder.js';
import { assertCan } from '../../../../platform/authz/scope.js';
import { isValidNit, nitCheckDigit, type Branch, type Organization } from '../../domain/Organization.js';
import type {
  BranchRepository,
  OrganizationRepository,
  SettingsRepository,
} from '../ports/OrganizationRepository.js';

export interface CreateOrganizationInput {
  legalName: string;
  tradeName?: string;
  taxId?: string | null;
  taxIdDv?: string | null;
  country?: string;
  city?: string | null;
  functionalCurrency?: string;
  timezone?: string;
  brandHue?: number | null;
}

export interface UpdateOrganizationInput {
  legalName?: string;
  tradeName?: string;
  taxId?: string | null;
  taxIdDv?: string | null;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  functionalCurrency?: string;
  timezone?: string;
  locale?: string;
  fiscalYearStartMonth?: number;
  brandHue?: number | null;
  logoFileId?: string | null;
}

export class OrganizationUseCases {
  constructor(
    private readonly orgs: OrganizationRepository,
    private readonly branches: BranchRepository,
    private readonly settings: SettingsRepository,
    private readonly audit: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  /**
   * Crea la organización y su sucursal principal.
   *
   * Sin contexto de petición a propósito: se llama durante el registro, cuando
   * todavía no existe ninguna membresía ni permiso que comprobar.
   */
  async create(tx: Tx, input: CreateOrganizationInput): Promise<Organization> {
    const country = (input.country ?? 'CO').toUpperCase();
    const taxId = input.taxId?.replace(/\D/g, '') || null;

    if (taxId) {
      const existing = await this.orgs.findByTaxId(tx, country, taxId);
      if (existing) throw AppError.conflict(`Ya existe una organización con el NIT ${taxId}`);
    }

    // Si hay NIT colombiano y no dieron el dígito de verificación, se calcula:
    // pedírselo al usuario cuando es derivable solo genera errores de tecleo.
    const taxIdDv = input.taxIdDv ?? (taxId && country === 'CO' ? String(nitCheckDigit(taxId)) : null);

    if (taxId && country === 'CO' && input.taxIdDv && !isValidNit(taxId, input.taxIdDv)) {
      throw AppError.validation(
        `El dígito de verificación no corresponde al NIT ${taxId} (debería ser ${nitCheckDigit(taxId)})`,
      );
    }

    const now = this.clock.now();
    const org: Organization = {
      id: newId(),
      legalName: input.legalName.trim(),
      tradeName: (input.tradeName ?? input.legalName).trim(),
      taxId,
      taxIdDv,
      taxIdType: 'NIT',
      country,
      city: input.city ?? null,
      address: null,
      phone: null,
      email: null,
      website: null,
      functionalCurrency: (input.functionalCurrency ?? 'COP').toUpperCase(),
      timezone: input.timezone ?? 'America/Bogota',
      locale: 'es-CO',
      fiscalYearStartMonth: 1,
      brandHue: input.brandHue ?? null,
      logoFileId: null,
      plan: 'FREE',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };

    await this.orgs.save(tx, org);
    return org;
  }

  /** Sucursal principal. Se crea junto con la organización. */
  async createDefaultBranch(tx: Tx, organizationId: string, name = 'Principal'): Promise<Branch> {
    const branch: Branch = {
      id: newId(),
      organizationId,
      code: 'PRI',
      name,
      address: null,
      city: null,
      phone: null,
      isDefault: true,
      isActive: true,
    };
    await this.branches.save(tx, branch);
    return branch;
  }

  async get(ctx: RequestContext, tx: Tx): Promise<Organization> {
    assertCan(ctx, 'org:organization:read');
    const org = await this.orgs.findById(tx, ctx.organizationId);
    if (!org) throw AppError.notFound('Organización');
    return org;
  }

  async update(ctx: RequestContext, tx: Tx, input: UpdateOrganizationInput): Promise<Organization> {
    assertCan(ctx, 'org:organization:update');
    const before = await this.orgs.findById(tx, ctx.organizationId);
    if (!before) throw AppError.notFound('Organización');

    const taxId = input.taxId === undefined ? before.taxId : input.taxId?.replace(/\D/g, '') || null;
    if (taxId && before.country === 'CO') {
      const dv = input.taxIdDv ?? String(nitCheckDigit(taxId));
      if (!isValidNit(taxId, dv)) {
        throw AppError.validation(
          `El dígito de verificación no corresponde al NIT ${taxId} (debería ser ${nitCheckDigit(taxId)})`,
        );
      }
    }

    const after: Organization = {
      ...before,
      ...input,
      taxId,
      taxIdDv: input.taxIdDv ?? (taxId && before.country === 'CO' ? String(nitCheckDigit(taxId)) : null),
      updatedAt: this.clock.now(),
    };

    await this.orgs.update(tx, after);
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'organization',
      entityId: after.id,
      entityLabel: after.tradeName,
      before: { ...before },
      after: { ...after },
    });
    return after;
  }

  async listForUser(tx: Tx, userId: string): Promise<Array<Organization & { membershipId: string }>> {
    return this.orgs.listForUser(tx, userId);
  }

  // ── Sucursales ────────────────────────────────────────────────────────────

  async listBranches(ctx: RequestContext, tx: Tx): Promise<Branch[]> {
    assertCan(ctx, 'org:branch:read');
    return this.branches.listByOrganization(tx, ctx.organizationId);
  }

  async createBranch(
    ctx: RequestContext,
    tx: Tx,
    input: { code: string; name: string; city?: string | null; address?: string | null },
  ): Promise<Branch> {
    assertCan(ctx, 'org:branch:create');
    const branch: Branch = {
      id: newId(),
      organizationId: ctx.organizationId,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      address: input.address ?? null,
      city: input.city ?? null,
      phone: null,
      isDefault: false,
      isActive: true,
    };
    await this.branches.save(tx, branch);
    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'branch',
      entityId: branch.id,
      entityLabel: branch.name,
      after: { ...branch },
    });
    return branch;
  }

  async updateBranch(
    ctx: RequestContext,
    tx: Tx,
    id: string,
    input: Partial<Pick<Branch, 'code' | 'name' | 'city' | 'address' | 'phone' | 'isActive'>>,
  ): Promise<Branch> {
    assertCan(ctx, 'org:branch:update');
    const before = await this.branches.findById(tx, id);
    if (!before) throw AppError.notFound('Sucursal');

    const after = { ...before, ...input };
    await this.branches.update(tx, after);
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'branch',
      entityId: id,
      entityLabel: after.name,
      before: { ...before },
      after: { ...after },
    });
    return after;
  }

  async deleteBranch(ctx: RequestContext, tx: Tx, id: string): Promise<void> {
    assertCan(ctx, 'org:branch:delete');
    const branch = await this.branches.findById(tx, id);
    if (!branch) throw AppError.notFound('Sucursal');
    // Quedarse sin sucursal por defecto deja la organización sin dónde facturar.
    if (branch.isDefault) throw AppError.rule('No puedes eliminar la sucursal principal');

    await this.branches.delete(tx, id);
    await this.audit.record(tx, ctx, {
      action: 'DELETE',
      entityType: 'branch',
      entityId: id,
      entityLabel: branch.name,
      before: { ...branch },
    });
  }

  // ── Ajustes ───────────────────────────────────────────────────────────────

  async getSettings(ctx: RequestContext, tx: Tx): Promise<Record<string, unknown>> {
    assertCan(ctx, 'org:settings:read');
    return this.settings.all(tx, ctx.organizationId);
  }

  async setSetting(ctx: RequestContext, tx: Tx, key: string, value: unknown): Promise<void> {
    assertCan(ctx, 'org:settings:update');
    await this.settings.set(tx, ctx.organizationId, key, value);
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'organization_setting',
      entityLabel: key,
      before: null,
      after: { key, value },
    });
  }
}
