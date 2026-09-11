import { AppError, newId, type Clock } from '@erp/core';
import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { RequestContext } from '../../../../platform/authz/RequestContext.js';
import type { AuditRecorder } from '../../../../platform/audit/AuditRecorder.js';
import type { EventBus } from '../../../../platform/events/EventBus.js';
import { assertCan, assertWithinScope, scopeFilter } from '../../../../platform/authz/scope.js';
import type { ListResult } from '../../../../platform/http/list.js';
import {
  deriveDisplayName,
  normalizeTaxId,
  validateDocument,
  type Contact,
  type CustomerProfile,
  type Party,
  type PartyAddress,
  type VendorProfile,
} from '../../domain/Party.js';
import type {
  ActivityRepository,
  AddressRepository,
  ContactRepository,
  PartyOverview,
  PartyRepository,
  PartyRow,
  ProfileRepository,
  TagRepository,
} from '../ports/CrmRepositories.js';

export interface CreatePartyInput {
  kind?: Party['kind'];
  displayName?: string;
  legalName?: string | null;
  taxIdType?: Party['taxIdType'];
  taxId?: string | null;
  taxIdDv?: string | null;
  fiscalResponsibilities?: string[];
  taxRegime?: Party['taxRegime'];
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  website?: string | null;
  industry?: string | null;
  notes?: string | null;
  isCustomer?: boolean;
  isVendor?: boolean;
  ownerMembershipId?: string | null;
  tagIds?: string[];
  address?: Omit<PartyAddress, 'id' | 'organizationId' | 'partyId'> | undefined;
  customerProfile?: Partial<Omit<CustomerProfile, 'partyId'>> | undefined;
  vendorProfile?: Partial<Omit<VendorProfile, 'partyId'>> | undefined;
}

export type UpdatePartyInput = Partial<CreatePartyInput> & { status?: Party['status'] };

/** Ficha completa: lo que la pantalla de detalle necesita en una sola llamada. */
export interface PartyDetail {
  party: Party;
  addresses: PartyAddress[];
  contacts: Contact[];
  customerProfile: CustomerProfile | null;
  vendorProfile: VendorProfile | null;
  tags: Array<{ id: string; name: string; colorHue: number | null }>;
  activities: Array<{ id: string; kind: string; subject: string; createdAt: Date }>;
}

export class PartyUseCases {
  constructor(
    private readonly parties: PartyRepository,
    private readonly addresses: AddressRepository,
    private readonly contacts: ContactRepository,
    private readonly profiles: ProfileRepository,
    private readonly tags: TagRepository,
    private readonly activities: ActivityRepository,
    private readonly audit: AuditRecorder,
    private readonly events: EventBus,
    private readonly clock: Clock,
  ) {}

  async list(ctx: RequestContext, tx: Tx, query: ListQuery): Promise<ListResult<PartyRow>> {
    assertCan(ctx, 'crm:party:read');
    return this.parties.list(tx, query, scopeFilter(ctx, 'crm:party:read'));
  }

  async overview(ctx: RequestContext, tx: Tx): Promise<PartyOverview> {
    assertCan(ctx, 'crm:party:read');
    return this.parties.overview(tx, ctx.organizationId, scopeFilter(ctx, 'crm:party:read'));
  }

  async get(ctx: RequestContext, tx: Tx, id: string): Promise<PartyDetail> {
    assertCan(ctx, 'crm:party:read');
    const party = await this.parties.findById(tx, id);
    if (!party || party.organizationId !== ctx.organizationId) throw AppError.notFound('Cliente');
    assertWithinScope(ctx, 'crm:party:read', { ownerMembershipId: party.ownerMembershipId }, 'este cliente');

    // Secuencial: todas comparten el cliente de la transacción.
    const addresses = await this.addresses.listByParty(tx, id);
    const contacts = await this.contacts.listByParty(tx, id);
    const customerProfile = party.isCustomer ? await this.profiles.customer(tx, id) : null;
    const vendorProfile = party.isVendor ? await this.profiles.vendor(tx, id) : null;
    const tags = await this.tags.forEntity(tx, 'party', id);
    const activities = await this.activities.listForEntity(tx, 'party', id, 20);

    return {
      party,
      addresses,
      contacts,
      customerProfile,
      vendorProfile,
      tags: tags.map((t) => ({ id: t.id, name: t.name, colorHue: t.colorHue })),
      activities: activities.map((a) => ({
        id: a.id,
        kind: a.kind,
        subject: a.subject,
        createdAt: a.createdAt,
      })),
    };
  }

  async create(ctx: RequestContext, tx: Tx, input: CreatePartyInput): Promise<Party> {
    assertCan(ctx, 'crm:party:create');

    const taxIdType = input.taxIdType ?? 'NIT';
    const taxId = normalizeTaxId(input.taxId);

    const validation = validateDocument(taxIdType, taxId, input.taxIdDv);
    if (!validation.valid) throw AppError.validation(validation.reason ?? 'Documento inválido');

    if (taxId) {
      const existing = await this.parties.findByTaxId(tx, ctx.organizationId, taxIdType, taxId);
      if (existing) {
        throw AppError.conflict(`Ya existe "${existing.displayName}" con el documento ${taxId}`, {
          partyId: existing.id,
        });
      }
    }

    // Una ficha que no es cliente ni proveedor no sirve para nada; por defecto
    // es cliente, que es el caso mayoritario.
    const isCustomer = input.isCustomer ?? !input.isVendor;
    const isVendor = input.isVendor ?? false;

    const now = this.clock.now();
    const party: Party = {
      id: newId(),
      organizationId: ctx.organizationId,
      kind: input.kind ?? 'COMPANY',
      displayName: deriveDisplayName({
        kind: input.kind ?? 'COMPANY',
        displayName: input.displayName ?? null,
        legalName: input.legalName ?? null,
      }),
      legalName: input.legalName?.trim() || null,
      taxIdType,
      taxId,
      taxIdDv: validation.checkDigit ?? input.taxIdDv ?? null,
      fiscalResponsibilities: input.fiscalResponsibilities ?? [],
      taxRegime: input.taxRegime ?? 'COMUN',
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      mobile: input.mobile?.trim() || null,
      website: input.website?.trim() || null,
      industry: input.industry?.trim() || null,
      notes: input.notes?.trim() || null,
      isCustomer,
      isVendor,
      // Sin responsable explícito, lo es quien la crea: con alcance OWN, una
      // ficha sin dueño sería invisible incluso para quien acaba de crearla.
      ownerMembershipId: input.ownerMembershipId ?? ctx.membershipId,
      branchId: ctx.branchId,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    await this.parties.save(tx, party);
    await this.applyProfiles(tx, ctx, party, input);

    if (input.address) {
      await this.addresses.save(tx, {
        ...input.address,
        id: newId(),
        organizationId: ctx.organizationId,
        partyId: party.id,
        isDefault: true,
      });
    }
    if (input.tagIds?.length) {
      await this.tags.setFor(tx, ctx.organizationId, 'party', party.id, input.tagIds);
    }

    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'party',
      entityId: party.id,
      entityLabel: party.displayName,
      after: { ...party },
    });
    await this.events.publish(tx, {
      type: 'party.created',
      aggregateType: 'party',
      aggregateId: party.id,
      organizationId: ctx.organizationId,
      payload: { displayName: party.displayName, isCustomer, isVendor },
      actorMembershipId: ctx.membershipId,
    });

    return party;
  }

  async update(ctx: RequestContext, tx: Tx, id: string, input: UpdatePartyInput): Promise<Party> {
    assertCan(ctx, 'crm:party:update');
    const before = await this.parties.findById(tx, id);
    if (!before || before.organizationId !== ctx.organizationId) throw AppError.notFound('Cliente');
    assertWithinScope(ctx, 'crm:party:update', { ownerMembershipId: before.ownerMembershipId }, 'este cliente');

    const taxIdType = input.taxIdType ?? before.taxIdType;
    const taxId = input.taxId === undefined ? before.taxId : normalizeTaxId(input.taxId);

    const validation = validateDocument(taxIdType, taxId, input.taxIdDv ?? null);
    if (!validation.valid) throw AppError.validation(validation.reason ?? 'Documento inválido');

    if (taxId && (taxId !== before.taxId || taxIdType !== before.taxIdType)) {
      const existing = await this.parties.findByTaxId(tx, ctx.organizationId, taxIdType, taxId);
      if (existing && existing.id !== id) {
        throw AppError.conflict(`Ya existe "${existing.displayName}" con el documento ${taxId}`);
      }
    }

    const after: Party = {
      ...before,
      ...input,
      kind: input.kind ?? before.kind,
      displayName: input.displayName?.trim() || before.displayName,
      legalName: input.legalName === undefined ? before.legalName : input.legalName?.trim() || null,
      taxIdType,
      taxId,
      taxIdDv: validation.checkDigit ?? null,
      isCustomer: input.isCustomer ?? before.isCustomer,
      isVendor: input.isVendor ?? before.isVendor,
      status: input.status ?? before.status,
      updatedAt: this.clock.now(),
    };

    await this.parties.update(tx, after);
    await this.applyProfiles(tx, ctx, after, input);
    if (input.tagIds) await this.tags.setFor(tx, ctx.organizationId, 'party', id, input.tagIds);

    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'party',
      entityId: id,
      entityLabel: after.displayName,
      before: { ...before },
      after: { ...after },
    });

    return after;
  }

  /**
   * Crea o quita los perfiles según los roles que desempeñe la parte. Quitar el
   * rol de cliente borra su perfil: conservarlo dejaría datos de cobro de alguien
   * que ya no lo es.
   */
  private async applyProfiles(
    tx: Tx,
    ctx: RequestContext,
    party: Party,
    input: CreatePartyInput | UpdatePartyInput,
  ): Promise<void> {
    if (party.isCustomer) {
      const current = await this.profiles.customer(tx, party.id);
      await this.profiles.upsertCustomer(tx, ctx.organizationId, {
        partyId: party.id,
        priceListId: input.customerProfile?.priceListId ?? current?.priceListId ?? null,
        paymentTermsDays:
          input.customerProfile?.paymentTermsDays ?? current?.paymentTermsDays ?? 0,
        creditLimit: input.customerProfile?.creditLimit ?? current?.creditLimit ?? '0',
        receivableAccountId:
          input.customerProfile?.receivableAccountId ?? current?.receivableAccountId ?? null,
        defaultCurrency: input.customerProfile?.defaultCurrency ?? current?.defaultCurrency ?? 'COP',
        salespersonMembershipId:
          input.customerProfile?.salespersonMembershipId ??
          current?.salespersonMembershipId ??
          party.ownerMembershipId,
        taxGroupId: input.customerProfile?.taxGroupId ?? current?.taxGroupId ?? null,
      });
    } else {
      await this.profiles.removeCustomer(tx, party.id);
    }

    if (party.isVendor) {
      const current = await this.profiles.vendor(tx, party.id);
      await this.profiles.upsertVendor(tx, ctx.organizationId, {
        partyId: party.id,
        paymentTermsDays: input.vendorProfile?.paymentTermsDays ?? current?.paymentTermsDays ?? 0,
        payableAccountId: input.vendorProfile?.payableAccountId ?? current?.payableAccountId ?? null,
        defaultCurrency: input.vendorProfile?.defaultCurrency ?? current?.defaultCurrency ?? 'COP',
        taxGroupId: input.vendorProfile?.taxGroupId ?? current?.taxGroupId ?? null,
        leadTimeDays: input.vendorProfile?.leadTimeDays ?? current?.leadTimeDays ?? 0,
      });
    } else {
      await this.profiles.removeVendor(tx, party.id);
    }
  }

  async delete(ctx: RequestContext, tx: Tx, id: string): Promise<void> {
    assertCan(ctx, 'crm:party:delete');
    const party = await this.parties.findById(tx, id);
    if (!party || party.organizationId !== ctx.organizationId) throw AppError.notFound('Cliente');
    assertWithinScope(ctx, 'crm:party:delete', { ownerMembershipId: party.ownerMembershipId }, 'este cliente');

    await this.parties.softDelete(tx, id, this.clock.now());
    await this.audit.record(tx, ctx, {
      action: 'DELETE',
      entityType: 'party',
      entityId: id,
      entityLabel: party.displayName,
      before: { ...party },
    });
  }

  async search(ctx: RequestContext, tx: Tx, term: string, limit = 10) {
    assertCan(ctx, 'crm:party:read');
    return this.parties.search(tx, ctx.organizationId, term, limit);
  }
}
