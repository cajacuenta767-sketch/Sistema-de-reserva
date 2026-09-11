import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { ScopeFilter } from '../../../../platform/authz/scope.js';
import { runList, type ListResult, type ListSpec } from '../../../../platform/http/list.js';
import type { Contact, CustomerProfile, VendorProfile } from '../../domain/Party.js';
import type {
  Activity,
  ActivityRepository,
  ContactRepository,
  ContactRow,
  ProfileRepository,
  Tag,
  TagRepository,
} from '../../application/ports/CrmRepositories.js';

// ── Contactos ────────────────────────────────────────────────────────────────

interface ContactDbRow {
  id: string;
  organization_id: string;
  party_id: string | null;
  first_name: string;
  last_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  is_primary: boolean;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

const contactFromRow = (r: ContactDbRow): Contact => ({
  id: r.id,
  organizationId: r.organization_id,
  partyId: r.party_id,
  firstName: r.first_name,
  lastName: r.last_name,
  jobTitle: r.job_title,
  email: r.email,
  phone: r.phone,
  mobile: r.mobile,
  isPrimary: r.is_primary,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const CONTACT_COLUMNS = `id, organization_id, party_id, first_name, last_name, job_title, email,
  phone, mobile, is_primary, notes, created_at, updated_at`;

const contactListSpec = (): ListSpec => ({
  from: 'FROM contacts c LEFT JOIN parties p ON p.id = c.party_id',
  select: `c.id, c.first_name, c.last_name, (c.first_name || ' ' || c.last_name) AS full_name,
           c.job_title, c.email, c.phone, c.mobile, c.is_primary, c.party_id, c.created_at,
           p.display_name AS party_name`,
  fields: {
    full_name: {
      column: `(c.first_name || ' ' || c.last_name)`,
      type: 'text',
      sortable: true,
      filterable: true,
      searchable: true,
    },
    email: { column: 'c.email', type: 'text', sortable: true, filterable: true, searchable: true },
    phone: { column: 'c.phone', type: 'text', sortable: false, filterable: true, searchable: true },
    job_title: { column: 'c.job_title', type: 'text', sortable: true, filterable: true, searchable: true },
    party_id: { column: 'c.party_id', type: 'uuid', sortable: false, filterable: true },
    party_name: { column: 'p.display_name', type: 'text', sortable: true, filterable: true, searchable: true },
    is_primary: { column: 'c.is_primary', type: 'boolean', sortable: true, filterable: true },
    created_at: { column: 'c.created_at', type: 'timestamp', sortable: true, filterable: true },
  },
  baseWhere: ['(p.id IS NULL OR p.deleted_at IS NULL)'],
  defaultSort: [{ field: 'full_name', dir: 'asc' }],
  ownerColumn: 'p.owner_membership_id',
});

export class PgContactRepository implements ContactRepository {
  async findById(tx: Tx, id: string): Promise<Contact | null> {
    const { rows } = await tx.client.query<ContactDbRow>(
      `SELECT ${CONTACT_COLUMNS} FROM contacts WHERE id = $1`,
      [id],
    );
    return rows[0] ? contactFromRow(rows[0]) : null;
  }

  async list(tx: Tx, query: ListQuery, scope: ScopeFilter): Promise<ListResult<ContactRow>> {
    return runList<ContactRow>(tx, contactListSpec(), query, scope);
  }

  async listByParty(tx: Tx, partyId: string): Promise<Contact[]> {
    const { rows } = await tx.client.query<ContactDbRow>(
      `SELECT ${CONTACT_COLUMNS} FROM contacts WHERE party_id = $1 ORDER BY is_primary DESC, first_name`,
      [partyId],
    );
    return rows.map(contactFromRow);
  }

  async save(tx: Tx, c: Contact): Promise<void> {
    await tx.client.query(
      `INSERT INTO contacts (id, organization_id, party_id, first_name, last_name, job_title, email,
        phone, mobile, is_primary, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [c.id, c.organizationId, c.partyId, c.firstName, c.lastName, c.jobTitle, c.email, c.phone,
       c.mobile, c.isPrimary, c.notes],
    );
  }

  async update(tx: Tx, c: Contact): Promise<void> {
    await tx.client.query(
      `UPDATE contacts SET party_id=$2, first_name=$3, last_name=$4, job_title=$5, email=$6,
        phone=$7, mobile=$8, is_primary=$9, notes=$10 WHERE id=$1`,
      [c.id, c.partyId, c.firstName, c.lastName, c.jobTitle, c.email, c.phone, c.mobile,
       c.isPrimary, c.notes],
    );
  }

  async delete(tx: Tx, id: string): Promise<void> {
    await tx.client.query('DELETE FROM contacts WHERE id = $1', [id]);
  }

  async clearPrimary(tx: Tx, partyId: string, exceptId: string): Promise<void> {
    // El índice único parcial impide dos principales; hay que bajar el anterior
    // ANTES de subir el nuevo, no después.
    await tx.client.query(
      'UPDATE contacts SET is_primary = false WHERE party_id = $1 AND id <> $2 AND is_primary',
      [partyId, exceptId],
    );
  }
}

// ── Perfiles por rol ─────────────────────────────────────────────────────────

export class PgProfileRepository implements ProfileRepository {
  async customer(tx: Tx, partyId: string): Promise<CustomerProfile | null> {
    const { rows } = await tx.client.query<{
      party_id: string;
      price_list_id: string | null;
      payment_terms_days: number;
      credit_limit: string;
      receivable_account_id: string | null;
      default_currency: string;
      salesperson_membership_id: string | null;
      tax_group_id: string | null;
    }>(
      `SELECT party_id, price_list_id, payment_terms_days, credit_limit, receivable_account_id,
              default_currency, salesperson_membership_id, tax_group_id
         FROM customer_profiles WHERE party_id = $1`,
      [partyId],
    );
    const r = rows[0];
    return r
      ? {
          partyId: r.party_id,
          priceListId: r.price_list_id,
          paymentTermsDays: r.payment_terms_days,
          creditLimit: r.credit_limit,
          receivableAccountId: r.receivable_account_id,
          defaultCurrency: r.default_currency,
          salespersonMembershipId: r.salesperson_membership_id,
          taxGroupId: r.tax_group_id,
        }
      : null;
  }

  async vendor(tx: Tx, partyId: string): Promise<VendorProfile | null> {
    const { rows } = await tx.client.query<{
      party_id: string;
      payment_terms_days: number;
      payable_account_id: string | null;
      default_currency: string;
      tax_group_id: string | null;
      lead_time_days: number;
    }>(
      `SELECT party_id, payment_terms_days, payable_account_id, default_currency, tax_group_id,
              lead_time_days
         FROM vendor_profiles WHERE party_id = $1`,
      [partyId],
    );
    const r = rows[0];
    return r
      ? {
          partyId: r.party_id,
          paymentTermsDays: r.payment_terms_days,
          payableAccountId: r.payable_account_id,
          defaultCurrency: r.default_currency,
          taxGroupId: r.tax_group_id,
          leadTimeDays: r.lead_time_days,
        }
      : null;
  }

  async upsertCustomer(tx: Tx, organizationId: string, p: CustomerProfile): Promise<void> {
    await tx.client.query(
      `INSERT INTO customer_profiles (organization_id, party_id, price_list_id, payment_terms_days,
        credit_limit, receivable_account_id, default_currency, salesperson_membership_id, tax_group_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (party_id) DO UPDATE SET
         price_list_id = EXCLUDED.price_list_id,
         payment_terms_days = EXCLUDED.payment_terms_days,
         credit_limit = EXCLUDED.credit_limit,
         receivable_account_id = EXCLUDED.receivable_account_id,
         default_currency = EXCLUDED.default_currency,
         salesperson_membership_id = EXCLUDED.salesperson_membership_id,
         tax_group_id = EXCLUDED.tax_group_id`,
      [organizationId, p.partyId, p.priceListId, p.paymentTermsDays, p.creditLimit,
       p.receivableAccountId, p.defaultCurrency, p.salespersonMembershipId, p.taxGroupId],
    );
  }

  async upsertVendor(tx: Tx, organizationId: string, p: VendorProfile): Promise<void> {
    await tx.client.query(
      `INSERT INTO vendor_profiles (organization_id, party_id, payment_terms_days, payable_account_id,
        default_currency, tax_group_id, lead_time_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (party_id) DO UPDATE SET
         payment_terms_days = EXCLUDED.payment_terms_days,
         payable_account_id = EXCLUDED.payable_account_id,
         default_currency = EXCLUDED.default_currency,
         tax_group_id = EXCLUDED.tax_group_id,
         lead_time_days = EXCLUDED.lead_time_days`,
      [organizationId, p.partyId, p.paymentTermsDays, p.payableAccountId, p.defaultCurrency,
       p.taxGroupId, p.leadTimeDays],
    );
  }

  async removeCustomer(tx: Tx, partyId: string): Promise<void> {
    await tx.client.query('DELETE FROM customer_profiles WHERE party_id = $1', [partyId]);
  }

  async removeVendor(tx: Tx, partyId: string): Promise<void> {
    await tx.client.query('DELETE FROM vendor_profiles WHERE party_id = $1', [partyId]);
  }
}

// ── Actividades ──────────────────────────────────────────────────────────────

interface ActivityDbRow {
  id: string;
  organization_id: string;
  kind: string;
  entity_type: string;
  entity_id: string;
  subject: string;
  body: string | null;
  due_at: Date | null;
  completed_at: Date | null;
  owner_membership_id: string | null;
  created_at: Date;
}

const activityFromRow = (r: ActivityDbRow): Activity => ({
  id: r.id,
  organizationId: r.organization_id,
  kind: r.kind as Activity['kind'],
  entityType: r.entity_type,
  entityId: r.entity_id,
  subject: r.subject,
  body: r.body,
  dueAt: r.due_at,
  completedAt: r.completed_at,
  ownerMembershipId: r.owner_membership_id,
  createdAt: r.created_at,
});

const ACTIVITY_COLUMNS = `id, organization_id, kind, entity_type, entity_id, subject, body, due_at,
  completed_at, owner_membership_id, created_at`;

export class PgActivityRepository implements ActivityRepository {
  async findById(tx: Tx, id: string): Promise<Activity | null> {
    const { rows } = await tx.client.query<ActivityDbRow>(
      `SELECT ${ACTIVITY_COLUMNS} FROM activities WHERE id = $1`,
      [id],
    );
    return rows[0] ? activityFromRow(rows[0]) : null;
  }

  async listForEntity(tx: Tx, entityType: string, entityId: string, limit: number): Promise<Activity[]> {
    const { rows } = await tx.client.query<ActivityDbRow>(
      `SELECT ${ACTIVITY_COLUMNS} FROM activities
        WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC LIMIT $3`,
      [entityType, entityId, limit],
    );
    return rows.map(activityFromRow);
  }

  async save(tx: Tx, a: Activity): Promise<void> {
    await tx.client.query(
      `INSERT INTO activities (id, organization_id, kind, entity_type, entity_id, subject, body,
        due_at, completed_at, owner_membership_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [a.id, a.organizationId, a.kind, a.entityType, a.entityId, a.subject, a.body, a.dueAt,
       a.completedAt, a.ownerMembershipId],
    );
  }

  async update(tx: Tx, a: Activity): Promise<void> {
    await tx.client.query(
      `UPDATE activities SET kind=$2, subject=$3, body=$4, due_at=$5, completed_at=$6,
        owner_membership_id=$7 WHERE id=$1`,
      [a.id, a.kind, a.subject, a.body, a.dueAt, a.completedAt, a.ownerMembershipId],
    );
  }

  async delete(tx: Tx, id: string): Promise<void> {
    await tx.client.query('DELETE FROM activities WHERE id = $1', [id]);
  }
}

// ── Etiquetas ────────────────────────────────────────────────────────────────

const tagFromRow = (r: {
  id: string;
  organization_id: string;
  kind: string;
  name: string;
  color_hue: number | null;
}): Tag => ({
  id: r.id,
  organizationId: r.organization_id,
  kind: r.kind,
  name: r.name,
  colorHue: r.color_hue,
});

export class PgTagRepository implements TagRepository {
  async list(tx: Tx, organizationId: string, kind?: string): Promise<Array<Tag & { usageCount: number }>> {
    const { rows } = await tx.client.query<{
      id: string;
      organization_id: string;
      kind: string;
      name: string;
      color_hue: number | null;
      usage_count: string;
    }>(
      `SELECT t.id, t.organization_id, t.kind, t.name, t.color_hue,
              (SELECT count(*)::int FROM taggings tg WHERE tg.tag_id = t.id) AS usage_count
         FROM tags t
        WHERE t.organization_id = $1 AND ($2::text IS NULL OR t.kind = $2)
        ORDER BY t.kind, t.name`,
      [organizationId, kind ?? null],
    );
    return rows.map((r) => ({ ...tagFromRow(r), usageCount: Number(r.usage_count) }));
  }

  async findById(tx: Tx, id: string): Promise<Tag | null> {
    const { rows } = await tx.client.query<{
      id: string;
      organization_id: string;
      kind: string;
      name: string;
      color_hue: number | null;
    }>('SELECT id, organization_id, kind, name, color_hue FROM tags WHERE id = $1', [id]);
    return rows[0] ? tagFromRow(rows[0]) : null;
  }

  async findByName(tx: Tx, organizationId: string, kind: string, name: string): Promise<Tag | null> {
    const { rows } = await tx.client.query<{
      id: string;
      organization_id: string;
      kind: string;
      name: string;
      color_hue: number | null;
    }>(
      'SELECT id, organization_id, kind, name, color_hue FROM tags WHERE organization_id = $1 AND kind = $2 AND name = $3',
      [organizationId, kind, name],
    );
    return rows[0] ? tagFromRow(rows[0]) : null;
  }

  async save(tx: Tx, t: Tag): Promise<void> {
    await tx.client.query(
      'INSERT INTO tags (id, organization_id, kind, name, color_hue) VALUES ($1,$2,$3,$4,$5)',
      [t.id, t.organizationId, t.kind, t.name, t.colorHue],
    );
  }

  async update(tx: Tx, t: Tag): Promise<void> {
    await tx.client.query('UPDATE tags SET name=$2, color_hue=$3 WHERE id=$1', [t.id, t.name, t.colorHue]);
  }

  async delete(tx: Tx, id: string): Promise<void> {
    await tx.client.query('DELETE FROM tags WHERE id = $1', [id]);
  }

  async setFor(
    tx: Tx,
    organizationId: string,
    entityType: string,
    entityId: string,
    tagIds: string[],
  ): Promise<void> {
    await tx.client.query('DELETE FROM taggings WHERE entity_type = $1 AND entity_id = $2', [
      entityType,
      entityId,
    ]);
    if (tagIds.length === 0) return;
    await tx.client.query(
      `INSERT INTO taggings (organization_id, tag_id, entity_type, entity_id)
       SELECT $1, id, $2, $3 FROM unnest($4::uuid[]) AS id`,
      [organizationId, entityType, entityId, tagIds],
    );
  }

  async forEntity(tx: Tx, entityType: string, entityId: string): Promise<Tag[]> {
    const { rows } = await tx.client.query<{
      id: string;
      organization_id: string;
      kind: string;
      name: string;
      color_hue: number | null;
    }>(
      `SELECT t.id, t.organization_id, t.kind, t.name, t.color_hue
         FROM taggings tg JOIN tags t ON t.id = tg.tag_id
        WHERE tg.entity_type = $1 AND tg.entity_id = $2 ORDER BY t.name`,
      [entityType, entityId],
    );
    return rows.map(tagFromRow);
  }
}
