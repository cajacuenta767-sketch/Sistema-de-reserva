import { AppError, newId, type Clock } from '@erp/core';
import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { RequestContext } from '../../../../platform/authz/RequestContext.js';
import type { AuditRecorder } from '../../../../platform/audit/AuditRecorder.js';
import { assertCan, scopeFilter } from '../../../../platform/authz/scope.js';
import type { ListResult } from '../../../../platform/http/list.js';
import { fullContactName, type Contact, type PartyAddress } from '../../domain/Party.js';
import type {
  Activity,
  ActivityRepository,
  AddressRepository,
  ContactRepository,
  ContactRow,
  PartyRepository,
  Tag,
  TagRepository,
} from '../ports/CrmRepositories.js';

/** Contactos, direcciones, actividades y etiquetas. */
export class CrmUseCases {
  constructor(
    private readonly parties: PartyRepository,
    private readonly contacts: ContactRepository,
    private readonly addresses: AddressRepository,
    private readonly activities: ActivityRepository,
    private readonly tags: TagRepository,
    private readonly audit: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  private async assertPartyVisible(ctx: RequestContext, tx: Tx, partyId: string) {
    const party = await this.parties.findById(tx, partyId);
    if (!party || party.organizationId !== ctx.organizationId) throw AppError.notFound('Cliente');
    return party;
  }

  // ── Contactos ─────────────────────────────────────────────────────────────

  async listContacts(ctx: RequestContext, tx: Tx, query: ListQuery): Promise<ListResult<ContactRow>> {
    assertCan(ctx, 'crm:contact:read');
    return this.contacts.list(tx, query, scopeFilter(ctx, 'crm:contact:read'));
  }

  async createContact(
    ctx: RequestContext,
    tx: Tx,
    input: {
      partyId?: string | null;
      firstName: string;
      lastName?: string;
      jobTitle?: string | null;
      email?: string | null;
      phone?: string | null;
      mobile?: string | null;
      isPrimary?: boolean;
      notes?: string | null;
    },
  ): Promise<Contact> {
    assertCan(ctx, 'crm:contact:create');
    if (input.partyId) await this.assertPartyVisible(ctx, tx, input.partyId);

    const now = this.clock.now();
    const contact: Contact = {
      id: newId(),
      organizationId: ctx.organizationId,
      partyId: input.partyId ?? null,
      firstName: input.firstName.trim(),
      lastName: input.lastName?.trim() ?? '',
      jobTitle: input.jobTitle?.trim() || null,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      mobile: input.mobile?.trim() || null,
      isPrimary: input.isPrimary ?? false,
      notes: input.notes?.trim() || null,
      createdAt: now,
      updatedAt: now,
    };

    // El índice único parcial impide dos principales: hay que bajar el anterior
    // ANTES de insertar el nuevo.
    if (contact.isPrimary && contact.partyId) {
      await this.contacts.clearPrimary(tx, contact.partyId, contact.id);
    }
    await this.contacts.save(tx, contact);

    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'contact',
      entityId: contact.id,
      entityLabel: fullContactName(contact),
      after: { ...contact },
    });
    return contact;
  }

  async updateContact(
    ctx: RequestContext,
    tx: Tx,
    id: string,
    input: Partial<Omit<Contact, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Contact> {
    assertCan(ctx, 'crm:contact:update');
    const before = await this.contacts.findById(tx, id);
    if (!before || before.organizationId !== ctx.organizationId) throw AppError.notFound('Contacto');

    const after: Contact = { ...before, ...input, updatedAt: this.clock.now() };
    if (after.isPrimary && after.partyId) await this.contacts.clearPrimary(tx, after.partyId, id);
    await this.contacts.update(tx, after);

    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'contact',
      entityId: id,
      entityLabel: fullContactName(after),
      before: { ...before },
      after: { ...after },
    });
    return after;
  }

  async deleteContact(ctx: RequestContext, tx: Tx, id: string): Promise<void> {
    assertCan(ctx, 'crm:contact:delete');
    const contact = await this.contacts.findById(tx, id);
    if (!contact || contact.organizationId !== ctx.organizationId) throw AppError.notFound('Contacto');

    await this.contacts.delete(tx, id);
    await this.audit.record(tx, ctx, {
      action: 'DELETE',
      entityType: 'contact',
      entityId: id,
      entityLabel: fullContactName(contact),
      before: { ...contact },
    });
  }

  // ── Direcciones ───────────────────────────────────────────────────────────

  async addAddress(
    ctx: RequestContext,
    tx: Tx,
    partyId: string,
    input: Omit<PartyAddress, 'id' | 'organizationId' | 'partyId'>,
  ): Promise<PartyAddress> {
    assertCan(ctx, 'crm:party:update');
    await this.assertPartyVisible(ctx, tx, partyId);

    const existing = await this.addresses.listByParty(tx, partyId);
    const address: PartyAddress = {
      ...input,
      id: newId(),
      organizationId: ctx.organizationId,
      partyId,
      // La primera dirección es la principal, diga lo que diga el formulario.
      isDefault: existing.length === 0 ? true : input.isDefault,
    };

    if (address.isDefault) {
      for (const other of existing.filter((a) => a.isDefault)) {
        await this.addresses.update(tx, { ...other, isDefault: false });
      }
    }
    await this.addresses.save(tx, address);
    return address;
  }

  async updateAddress(
    ctx: RequestContext,
    tx: Tx,
    id: string,
    input: Partial<Omit<PartyAddress, 'id' | 'organizationId' | 'partyId'>>,
  ): Promise<PartyAddress> {
    assertCan(ctx, 'crm:party:update');
    const before = await this.addresses.findById(tx, id);
    if (!before || before.organizationId !== ctx.organizationId) throw AppError.notFound('Dirección');

    const after = { ...before, ...input };
    if (after.isDefault && !before.isDefault) {
      for (const other of await this.addresses.listByParty(tx, before.partyId)) {
        if (other.id !== id && other.isDefault) {
          await this.addresses.update(tx, { ...other, isDefault: false });
        }
      }
    }
    await this.addresses.update(tx, after);
    return after;
  }

  async deleteAddress(ctx: RequestContext, tx: Tx, id: string): Promise<void> {
    assertCan(ctx, 'crm:party:update');
    const address = await this.addresses.findById(tx, id);
    if (!address || address.organizationId !== ctx.organizationId) throw AppError.notFound('Dirección');
    await this.addresses.delete(tx, id);
  }

  // ── Actividades ───────────────────────────────────────────────────────────

  async logActivity(
    ctx: RequestContext,
    tx: Tx,
    input: {
      kind: Activity['kind'];
      entityType: string;
      entityId: string;
      subject: string;
      body?: string | null;
      dueAt?: Date | null;
      ownerMembershipId?: string | null;
    },
  ): Promise<Activity> {
    assertCan(ctx, 'crm:activity:create');

    const activity: Activity = {
      id: newId(),
      organizationId: ctx.organizationId,
      kind: input.kind,
      entityType: input.entityType,
      entityId: input.entityId,
      subject: input.subject.trim(),
      body: input.body?.trim() || null,
      dueAt: input.dueAt ?? null,
      // Una nota nace completada; una tarea con vencimiento, pendiente.
      completedAt: input.dueAt ? null : this.clock.now(),
      ownerMembershipId: input.ownerMembershipId ?? ctx.membershipId,
      createdAt: this.clock.now(),
    };
    await this.activities.save(tx, activity);
    return activity;
  }

  async completeActivity(ctx: RequestContext, tx: Tx, id: string): Promise<Activity> {
    assertCan(ctx, 'crm:activity:create');
    const activity = await this.activities.findById(tx, id);
    if (!activity || activity.organizationId !== ctx.organizationId) throw AppError.notFound('Actividad');

    const after = { ...activity, completedAt: this.clock.now() };
    await this.activities.update(tx, after);
    return after;
  }

  async listActivities(ctx: RequestContext, tx: Tx, entityType: string, entityId: string) {
    assertCan(ctx, 'crm:party:read');
    return this.activities.listForEntity(tx, entityType, entityId, 50);
  }

  // ── Etiquetas ─────────────────────────────────────────────────────────────

  async listTags(ctx: RequestContext, tx: Tx, kind?: string) {
    assertCan(ctx, 'crm:tag:read');
    return this.tags.list(tx, ctx.organizationId, kind);
  }

  async createTag(
    ctx: RequestContext,
    tx: Tx,
    input: { name: string; kind?: string; colorHue?: number | null },
  ): Promise<Tag> {
    assertCan(ctx, 'crm:tag:manage');
    const kind = input.kind ?? 'party';
    const name = input.name.trim();

    const existing = await this.tags.findByName(tx, ctx.organizationId, kind, name);
    if (existing) throw AppError.conflict(`Ya existe la etiqueta "${name}"`);

    const tag: Tag = {
      id: newId(),
      organizationId: ctx.organizationId,
      kind,
      name,
      colorHue: input.colorHue ?? null,
    };
    await this.tags.save(tx, tag);
    return tag;
  }

  async updateTag(
    ctx: RequestContext,
    tx: Tx,
    id: string,
    input: { name?: string; colorHue?: number | null },
  ): Promise<Tag> {
    assertCan(ctx, 'crm:tag:manage');
    const before = await this.tags.findById(tx, id);
    if (!before || before.organizationId !== ctx.organizationId) throw AppError.notFound('Etiqueta');

    const after: Tag = {
      ...before,
      name: input.name?.trim() ?? before.name,
      colorHue: input.colorHue === undefined ? before.colorHue : input.colorHue,
    };
    await this.tags.update(tx, after);
    return after;
  }

  async deleteTag(ctx: RequestContext, tx: Tx, id: string): Promise<void> {
    assertCan(ctx, 'crm:tag:manage');
    const tag = await this.tags.findById(tx, id);
    if (!tag || tag.organizationId !== ctx.organizationId) throw AppError.notFound('Etiqueta');
    // Las asignaciones caen en cascada: una etiqueta borrada no debe seguir
    // apareciendo en las fichas.
    await this.tags.delete(tx, id);
  }

  async setTags(
    ctx: RequestContext,
    tx: Tx,
    entityType: string,
    entityId: string,
    tagIds: string[],
  ): Promise<void> {
    assertCan(ctx, 'crm:party:update');
    await this.tags.setFor(tx, ctx.organizationId, entityType, entityId, tagIds);
  }
}
